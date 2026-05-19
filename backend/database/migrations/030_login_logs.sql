-- ============================================================
-- 030: Tabla login_logs (faltaba en el dump base)
-- Usada por backend/src/routes/auth.routes.ts para rate-limit
-- progresivo y auditoria de intentos de acceso. Sin esta tabla
-- todo POST /api/auth/login devuelve 500.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS login_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    email        VARCHAR(255) NOT NULL,
    ip           VARCHAR(64),
    user_agent   TEXT,
    exito        BOOLEAN NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_logs_email_created
    ON login_logs (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_logs_email_exito_created
    ON login_logs (email, exito, created_at DESC);

ALTER TABLE login_logs OWNER TO loga;

COMMIT;
