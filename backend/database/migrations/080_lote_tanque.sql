-- Asociación lote → tanque físico (1..4).
-- NULL = lote no está en ningún tanque (granel embotellado, sólido, materia prima
-- que no usa tanque). Solo emulsiones líquidas usan tanque.

ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS tanque SMALLINT
    CHECK (tanque IS NULL OR tanque BETWEEN 1 AND 4);

CREATE INDEX IF NOT EXISTS idx_lotes_tanque ON lotes(tanque) WHERE tanque IS NOT NULL;
