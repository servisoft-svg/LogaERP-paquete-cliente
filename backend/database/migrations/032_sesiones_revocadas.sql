-- =============================================================
-- Migración 032 — Sesiones revocadas (logout efectivo + revocación)
-- =============================================================
-- Problema:
--   JWT con TTL 7 días sin revocación server-side: si un operario pierde
--   el móvil o se compromete su cuenta, el token sigue activo 7 días aunque
--   admin desactive el usuario. Logout solo borra el token del cliente.
--
-- Solución:
--   - JWT pasa a TTL 8h (entorno industrial multi-operario).
--   - Cada token incluye jti (JWT ID) UUID único.
--   - Tabla sesiones_revocadas guarda jti revocados.
--   - authMiddleware verifica que jti no esté en la tabla.
--   - POST /api/auth/logout añade el jti del token actual a la tabla.
--   - Cleanup automático: filas con expira_at < NOW() pueden borrarse
--     (ya no son útiles, el token expiró por TTL natural).
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sesiones_revocadas (
  jti        UUID PRIMARY KEY,
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
  revocado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at  TIMESTAMPTZ NOT NULL,           -- exp del JWT (para cleanup)
  motivo     TEXT                            -- 'logout_usuario' | 'admin_desactivo' | etc.
);

-- Índice para cleanup eficiente de tokens ya expirados naturalmente.
CREATE INDEX IF NOT EXISTS idx_sesiones_revocadas_expira ON public.sesiones_revocadas(expira_at);

COMMENT ON TABLE public.sesiones_revocadas IS
  'Tokens JWT revocados antes de su expiración natural. authMiddleware verifica jti aquí.';

COMMIT;
