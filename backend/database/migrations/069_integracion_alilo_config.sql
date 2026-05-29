-- Singleton para el secret compartido HMAC con Alilo.
-- El secret se auto-genera al arrancar el backend si no existe fila,
-- así el operario no tiene que configurar nada en .env manualmente.
-- Se puede regenerar desde la UI cuando se necesite rotar.
CREATE TABLE IF NOT EXISTS public.integracion_alilo_config (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  shared_secret VARCHAR(128) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
