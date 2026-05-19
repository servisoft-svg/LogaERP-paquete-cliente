-- Nº CAS (Chemical Abstracts Service): identificador único internacional de
-- sustancias químicas. Formato típico: XXXXXX-XX-X (ej: 7732-18-5 = agua).
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS numero_cas VARCHAR(20);
