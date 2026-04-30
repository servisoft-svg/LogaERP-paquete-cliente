import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { signToken, verifyToken, authMiddleware, adminOnly } from '../middleware/auth';

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
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = getIp(req);
    const userAgent = req.headers['user-agent'] ?? '';

    if (!email || !password) return res.status(400).json({ error: 'Email y password obligatorios' });

    const emailNorm = email.toLowerCase().trim();

    // Comprobar bloqueo progresivo
    const bloqueo = await checkBloqueo(emailNorm);
    if (bloqueo.bloqueado) {
      return res.status(429).json({
        error: `Cuenta bloqueada por ${bloqueo.minutos_restantes} minuto${bloqueo.minutos_restantes !== 1 ? 's' : ''}. Demasiados intentos fallidos (${bloqueo.intentos}).`,
        minutos_restantes: bloqueo.minutos_restantes,
        intentos: bloqueo.intentos,
      });
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
      return res.status(401).json({ error: 'Credenciales incorrectas' });
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
        return res.status(429).json({
          error: `Cuenta bloqueada ${nuevo.minutos_restantes} minuto${nuevo.minutos_restantes !== 1 ? 's' : ''}. Demasiados intentos fallidos.`,
          minutos_restantes: nuevo.minutos_restantes,
        });
      }
      const restantes = MAX_INTENTOS - (nuevo.intentos % MAX_INTENTOS || MAX_INTENTOS);
      return res.status(401).json({
        error: restantes > 0
          ? `Credenciales incorrectas. ${restantes} intento${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''}.`
          : 'Credenciales incorrectas',
      });
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
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/auth/login-logs — admin only
router.get('/login-logs', authMiddleware, adminOnly, async (req, res) => {
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
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/auth/me — verify token
router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return res.status(401).json({ error: 'No autorizado' });

    const decoded = verifyToken(auth);
    const [userId] = [decoded.id];

    const { rows: [user] } = await pool.query(
      `SELECT id, nombre, email, rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [userId]
    );
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    return res.json(user);
  } catch {
    return res.status(401).json({ error: 'Token invalido' });
  }
});

// POST /api/auth/refresh - renew token. Acepta tokens recién expirados
// (gracia 30 días) para que la sesión sobreviva entre recargas/reinicios.
router.post('/refresh', async (req, res) => {
  try {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return res.status(401).json({ error: 'No autorizado' });

    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET ?? '';
    const JWT_VERIFY_OPTS = { algorithms: ['HS256' as const] };
    let decoded: { id: string; rol: string; iat?: number; exp?: number };
    try {
      decoded = jwt.verify(auth, JWT_SECRET, JWT_VERIFY_OPTS) as typeof decoded;
    } catch (err: unknown) {
      // Token expirado: aceptarlo solo si la expiración fue hace <24h.
      // (Antes 30 días — ventana excesiva para tokens robados.)
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        const payload = jwt.verify(auth, JWT_SECRET, { ...JWT_VERIFY_OPTS, ignoreExpiration: true }) as typeof decoded;
        const ageS = Date.now() / 1000 - (payload.exp ?? 0);
        if (ageS > 86400) return res.status(401).json({ error: 'Sesion expirada' });
        decoded = payload;
      } else {
        return res.status(401).json({ error: 'Token invalido' });
      }
    }

    const { rows: [user] } = await pool.query(
      `SELECT id, nombre, email, rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [decoded.id]
    );
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const token = signToken({ id: user.id, rol: user.rol });
    return res.json({ token, usuario: user });
  } catch {
    return res.status(401).json({ error: 'Token invalido' });
  }
});

// POST /api/auth/register — protegido: solo admins
router.post('/register', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Todos los campos son obligatorios' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Formato de email invalido' });

    // Password policy
    if (password.length < 8) return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres' });
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: 'La contrasena debe tener al menos una mayuscula y un numero' });

    const hash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol`,
      [nombre.trim(), email.toLowerCase().trim(), hash, rol ?? 'trabajador']
    );
    return res.status(201).json(user);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) return res.status(409).json({ error: 'Email ya registrado' });
    return res.status(500).json({ error: msg });
  }
});

export default router;
