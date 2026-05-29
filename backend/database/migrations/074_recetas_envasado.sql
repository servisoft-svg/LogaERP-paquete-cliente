-- Receta de envasado con 4 bloques fijos (estilo Lego):
--   Líquido base (producto_fabricado) + cantidad por bote
--   Envase     (material_embalaje · subcategoria 'Bote')
--   Etiqueta   (material_embalaje · subcategoria 'Etiqueta')
--   Caja opcional (material_embalaje · subcategoria 'Caja')
--
-- El producto resultado es un producto_envasado existente (PT del envasado).
-- Sustituye al uso anterior de la tabla genérica `recetas` para envasados.

CREATE TABLE IF NOT EXISTS public.recetas_envasado (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(150) NOT NULL,
  codigo        VARCHAR(50)  UNIQUE,
  -- Producto envasado resultante (PT del envasado)
  producto_envasado_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  -- Líquido base
  liquido_id        UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  liquido_cantidad  NUMERIC(20,6) NOT NULL CHECK (liquido_cantidad > 0),
  liquido_unidad    VARCHAR(10)   NOT NULL DEFAULT 'g',
  -- Envase
  envase_id         UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  envases_por_bote  INTEGER NOT NULL DEFAULT 1 CHECK (envases_por_bote > 0),
  -- Etiqueta
  etiqueta_id       UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
  etiquetas_por_bote INTEGER NOT NULL DEFAULT 1 CHECK (etiquetas_por_bote >= 0),
  -- Caja (opcional)
  lleva_caja        BOOLEAN NOT NULL DEFAULT FALSE,
  caja_id           UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
  -- Auditoría
  activa            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Integridad: si lleva caja, debe haber caja_id
  CONSTRAINT receta_envasado_caja_coherente
    CHECK ((lleva_caja = FALSE) OR (lleva_caja = TRUE AND caja_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_recetas_envasado_activa
  ON public.recetas_envasado (activa, nombre) WHERE activa = TRUE;

CREATE INDEX IF NOT EXISTS idx_recetas_envasado_producto
  ON public.recetas_envasado (producto_envasado_id);

-- Marcador para órdenes que usan el nuevo flujo de envasado (distinto al de
-- producción/fabricación líquido). Reutilizamos ordenes_produccion existente
-- y añadimos referencia a la receta de envasado usada.
ALTER TABLE public.ordenes_produccion
  ADD COLUMN IF NOT EXISTS receta_envasado_id UUID REFERENCES public.recetas_envasado(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_op_receta_envasado
  ON public.ordenes_produccion (receta_envasado_id) WHERE receta_envasado_id IS NOT NULL;
