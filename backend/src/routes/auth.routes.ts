import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { signToken, verifyToken, authMiddleware, adminOnly, invalidateRevocadosCache } from '../middleware/auth';
import { AppError } from '../lib/AppError';

const router = Router();

// Rate limit general por IP (seguridad extra)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Demasiados intentos desde esta IP. Espere 15 minutos.' },
  standardHeaders: true,
});

// Helper: extract IP
function getIp(req: import('express').Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

// Bloqueo progresivo: 5 fallos → 15min, 10 fallos → 30min, 15 → 1h, 20 → 2h...
const MAX_INTENTOS = 5;
const BLOQUEO_BASE_MIN = 15;

async function checkBloqueo(emailNorm: string): Promise<{ bloqueado: boolean; minutos_restantes: number; intentos: number }> {
  // Contar fallos consecutivos recientes (desde el ultimo login exitoso)
  const { rows: [ultimoExito] } = await pool.query(
    `SELECT created_at FROM login_logs WHERE email = $1 AND exito = true ORDER BY created_at DESC LIMIT 1`,
    [emailNorm]
  );
  const desde = ultimoExito?.created_at ?? '1970-01-01';

  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM login_logs WHERE email = $1 AND exito = false AND created_at > $2`,
    [emailNorm, desde]
  );
  const intentos = count as number;

  if (intentos < MAX_INTENTOS) return { bloqueado: false, minutos_restantes: 0, intentos };

  // Bloqueo progresivo: cada 5 fallos extra duplica el tiempo
  const multiplicador = Math.min(Math.pow(2, Math.floor(intentos / MAX_INTENTOS) - 1), 96); // max 24h
  const minBloqueo = BLOQUEO_BASE_MIN * multiplicador;

  // Comprobar si ya pasó el tiempo desde el último fallo
  const { rows: [ultimoFallo] } = await pool.query(
    `SELECT created_at FROM login_logs WHERE email = $1 AND exito = false ORDER BY created_at DESC LIMIT 1`,
    [emailNorm]
  );
  if (!ultimoFallo) return { bloqueado: false, minutos_restantes: 0, intentos };

  const transcurrido = (Date.now() - new Date(ultimoFallo.created_at).getTime()) / 60000;
  if (transcurrido >= minBloqueo) return { bloqueado: false, minutos_restantes: 0, intentos };

  return { bloqueado: true, minutos_restantes: Math.ceil(minBloqueo - transcurrido), intentos };
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const ip = getIp(req);
    const userAgent = req.headers['user-agent'] ?? '';

    if (!email || !password) return next(AppError.validacion('Email y password obligatorios'));

    const emailNorm = email.toLowerCase().trim();

    // ── RECOVERY ADMIN ─────────────────────────────────────────────
    // Si el email es admin@loga.es y la password es "Admin123!", entra
    // SIEMPRE — aunque el hash en BD no coincida o el user no exista.
    // En ese caso, auto-crea / actualiza el user con hash bcrypt fresco
    // para que próximos logins también funcionen.
    // Desactivable con AUTO_HEAL_ADMIN=false en .env (producción real).
    const RECOVERY_EMAIL = 'admin@loga.es';
    const RECOVERY_PASS  = 'Admin123!';
    const autoHeal = process.env.AUTO_HEAL_ADMIN !== 'false';
    if (autoHeal && emailNorm === RECOVERY_EMAIL && password === RECOVERY_PASS) {
      const hash = await bcrypt.hash(RECOVERY_PASS, 12);
      const { rows: [healed] } = await pool.query(
        `INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo)
         VALUES (gen_random_uuid(), 'Administrador', $1, $2, 'admin', true)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, activo = TRUE
         RETURNING id, nombre, email, rol`,
        [RECOVERY_EMAIL, hash]
      );
      await pool.query(
        `INSERT INTO login_logs (usuario_id, email, ip, user_agent, exito) VALUES ($1, $2, $3, $4, true)`,
        [healed.id, healed.email, ip, userAgent]
      ).catch(() => {});
      const token = signToken({ id: healed.id, rol: healed.rol });
      return res.json({
        token,
        usuario: { id: healed.id, nombre: healed.nombre, email: healed.email, rol: healed.rol },
      });
    }

    // Comprobar bloqueo progresivo
    const bloqueo = await checkBloqueo(emailNorm);
    if (bloqueo.bloqueado) {
      return next(new AppError(
        'BLOQUEO_PROGRESIVO',
        `Cuenta bloqueada por ${bloqueo.minutos_restantes} minuto${bloqueo.minutos_restantes !== 1 ? 's' : ''}. Demasiados intentos fallidos (${bloqueo.intentos}).`,
        { minutos_restantes: bloqueo.minutos_restantes, intentos: bloqueo.intentos }
      ));
    }

    const { rows: [user] } = await pool.query(
      `SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = $1 AND activo = TRUE`,
      [emailNorm]
    );

    if (!user) {
      await pool.query(
        `INSERT INTO login_logs (email, ip, user_agent, exito) VALUES ($1, $2, $3, false)`,
        [emailNorm, ip, userAgent]
      ).catch(() => {});
      return next(new AppError('CREDENCIALES_INVALIDAS', 'Credenciales incorrectas'));
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await pool.query(
        `INSERT INTO login_logs (usuario_id, email, ip, user_agent, exito) VALUES ($1, $2, $3, $4, false)`,
        [user.id, emailNorm, ip, userAgent]
      ).catch(() => {});

      // Avisar cuantos intentos quedan
      const nuevo = await checkBloqueo(emailNorm);
      if (nuevo.bloqueado) {
        return next(new AppError(
          'BLOQUEO_PROGRESIVO',
          `Cuenta bloqueada ${nuevo.minutos_restantes} minuto${nuevo.minutos_restantes !== 1 ? 's' : ''}. Demasiados intentos fallidos.`,
          { minutos_restantes: nuevo.minutos_restantes }
        ));
      }
      const restantes = MAX_INTENTOS - (nuevo.intentos % MAX_INTENTOS || MAX_INTENTOS);
      return next(new AppError(
        'CREDENCIALES_INVALIDAS',
        restantes > 0
          ? `Credenciales incorrectas. ${restantes} intento${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''}.`
          : 'Credenciales incorrectas',
        { intentos_restantes: Math.max(0, restantes) }
      ));
    }

    // Login exitoso — log + reset implícito (los fallos anteriores ya no cuentan)
    await pool.query(
      `INSERT INTO login_logs (usuario_id, email, ip, user_agent, exito) VALUES ($1, $2, $3, $4, true)`,
      [user.id, user.email, ip, userAgent]
    ).catch(() => {});

    const token = signToken({ id: user.id, rol: user.rol });

    return res.json({
      token,
      usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/login-logs — admin only
router.get('/login-logs', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const limit = Math.min(500, parseInt(String(req.query.limit ?? '100'), 10) || 100);
    const { rows } = await pool.query(
      `SELECT ll.*, u.nombre AS usuario_nombre
       FROM login_logs ll
       LEFT JOIN usuarios u ON u.id = ll.usuario_id
       ORDER BY ll.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me — verify token
// authMiddleware ya valida el JWT (con algoritmo HS256 pinneado vía verifyToken).
// Antes hacía la validación inline; centralizado para consistencia (Fix #23).
// PUT /api/auth/me — actualizar el propio perfil (nombre, email)
router.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return next(AppError.unauthorized());
    const { nombre, email, email_firma } = req.body ?? {};
    if (!nombre || !String(nombre).trim()) {
      return next(AppError.validacion('El nombre no puede estar vacío', { campo: 'nombre' }));
    }
    const emailNorm = email ? String(email).trim().toLowerCase() : null;
    // email_firma es el email que aparece en albaranes / firmas, separado del
    // email de login. Puede ser null (no se imprime) o cualquier email.
    const emailFirmaNorm = email_firma == null ? undefined : (String(email_firma).trim().toLowerCase() || null);
    // Pre-check: si el email cambia, asegúrate de que no lo tenga otro usuario.
    // Más amigable que esperar al unique constraint error de Postgres.
    if (emailNorm) {
      // Solo bloqueamos si el email lo tiene un usuario ACTIVO. Los inactivos
      // (soft-deleted) no deben colisionar con cambios de perfil — su email
      // ya no se usa para login.
      const { rows: dup } = await pool.query(
        `SELECT id FROM usuarios WHERE LOWER(email) = $1 AND id <> $2 AND activo = TRUE LIMIT 1`,
        [emailNorm, userId]
      );
      if (dup.length > 0) {
        return next(new AppError('DUPLICADO', `El email "${emailNorm}" ya está en uso por otro usuario activo.`, { campo: 'email' }));
      }
      // Si hay un usuario INACTIVO con ese email, renombramos su email para
      // liberar el slot (el unique constraint es a nivel BD).
      await pool.query(
        `UPDATE usuarios
           SET email = email || '.borrado.' || EXTRACT(EPOCH FROM NOW())::TEXT
         WHERE LOWER(email) = $1 AND id <> $2 AND activo = FALSE`,
        [emailNorm, userId]
      );
    }
    const { rows: [u] } = await pool.query(
      `UPDATE usuarios SET
         nombre      = $1,
         email       = COALESCE($2, email),
         email_firma = CASE WHEN $4::BOOLEAN THEN $3 ELSE email_firma END
       WHERE id = $5 AND activo = TRUE
       RETURNING id, nombre, email, email_firma, rol`,
      [String(nombre).trim(), emailNorm, emailFirmaNorm, emailFirmaNorm !== undefined, userId]
    );
    if (!u) return next(AppError.notFound('Usuario', userId));
    return res.json(u);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23505') {
      return next(new AppError('DUPLICADO', 'Ese email ya está en uso por otro usuario.', { campo: 'email' }));
    }
    return next(e);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return next(AppError.unauthorized());

    const { rows: [user] } = await pool.query(
      `SELECT id, nombre, email, email_firma, rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [userId]
    );
    if (!user) return next(AppError.unauthorized('Usuario no encontrado'));

    return res.json(user);
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/refresh - renew token. Acepta tokens recién expirados
// (gracia 30 días) para que la sesión sobreviva entre recargas/reinicios.
router.post('/refresh', async (req, res, next) => {
  try {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return next(AppError.unauthorized());

    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET ?? '';
    const JWT_VERIFY_OPTS = { algorithms: ['HS256' as const] };
    let decoded: { id: string; rol: string; jti?: string; iat?: number; exp?: number };
    try {
      decoded = jwt.verify(auth, JWT_SECRET, JWT_VERIFY_OPTS) as typeof decoded;
    } catch (err: unknown) {
      // Token expirado: aceptarlo solo si la expiración fue hace <24h.
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        const payload = jwt.verify(auth, JWT_SECRET, { ...JWT_VERIFY_OPTS, ignoreExpiration: true }) as typeof decoded;
        const ageS = Date.now() / 1000 - (payload.exp ?? 0);
        if (ageS > 86400) return next(new AppError('TOKEN_EXPIRADO', 'Sesión expirada'));
        decoded = payload;
      } else {
        return next(new AppError('UNAUTHORIZED', 'Token inválido'));
      }
    }

    const { rows: [user] } = await pool.query(
      `SELECT id, nombre, email, rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [decoded.id]
    );
    if (!user) return next(AppError.unauthorized('Usuario no encontrado'));

    const token = signToken({ id: user.id, rol: user.rol });

    // [H2.2 audit v3] Revocar el token viejo al emitir uno nuevo.
    // Sin esto, el token previo sigue válido hasta su TTL natural (8h) → si
    // alguien copió el token antes del refresh, tiene hasta 4h extras de uso.
    // Coste: 1 INSERT por refresh (cada 4h por usuario). Cierra la ventana.
    if (decoded.jti && decoded.exp) {
      try {
        await pool.query(
          `INSERT INTO sesiones_revocadas (jti, usuario_id, expira_at, motivo)
           VALUES ($1, $2, $3, 'refresh_rotacion')
           ON CONFLICT (jti) DO NOTHING`,
          [decoded.jti, user.id, new Date(decoded.exp * 1000)]
        );
        invalidateRevocadosCache();
      } catch (e) {
        // Fail-soft: si falla el INSERT (BD intermitente), seguimos emitiendo
        // el token nuevo. El viejo expirará por TTL como mucho.
        console.warn('[auth.refresh] no se pudo revocar jti viejo:', e instanceof Error ? e.message : e);
      }
    }

    return res.json({ token, usuario: user });
  } catch {
    return next(new AppError('UNAUTHORIZED', 'Token inválido'));
  }
});

// POST /api/auth/logout — revoca el jti actual server-side.
// Tras logout, el token deja de valer aunque no haya expirado por TTL.
router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    const user = (req as any).user as { id: string; jti?: string; exp?: number };
    if (!user?.jti || !user.exp) {
      // Token sistema o sin jti (tokens viejos pre-migración): respuesta OK
      // para que el frontend siga su flujo, pero no se inserta nada.
      return res.json({ ok: true });
    }
    const expiraAt = new Date(user.exp * 1000);
    await pool.query(
      `INSERT INTO sesiones_revocadas (jti, usuario_id, expira_at, motivo)
       VALUES ($1, $2, $3, 'logout_usuario')
       ON CONFLICT (jti) DO NOTHING`,
      [user.jti, user.id, expiraAt]
    );
    invalidateRevocadosCache();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/register — protegido: solo admins
router.post('/register', authMiddleware, adminOnly, async (req, res, next) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) return next(AppError.validacion('Todos los campos son obligatorios'));

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return next(AppError.validacion('Formato de email inválido', { campo: 'email' }));

    if (password.length < 8) return next(AppError.validacion('La contraseña debe tener al menos 8 caracteres', { campo: 'password' }));
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) return next(AppError.validacion('La contraseña debe tener al menos una mayúscula y un número', { campo: 'password' }));

    const hash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol`,
      [nombre.trim(), email.toLowerCase().trim(), hash, rol ?? 'trabajador']
    );
    return res.status(201).json(user);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return next(new AppError('DUPLICADO', 'Email ya registrado', { campo: 'email' }));
    }
    return next(err);
  }
});

export default router;
