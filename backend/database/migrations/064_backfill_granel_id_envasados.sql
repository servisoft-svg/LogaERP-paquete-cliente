-- Backfill: para cada producto envasado que tenía una receta de envasado pero
-- granel_id quedó NULL (porque el PUT de productos no lo aceptaba antes), lo
-- rellenamos con el ingrediente de tipo producto_fabricado de su receta.
UPDATE public.productos pe
   SET granel_id = (
     SELECT ir.materia_prima_id
       FROM public.recetas r
       JOIN public.ingredientes_receta ir ON ir.receta_id = r.id
       JOIN public.productos mp ON mp.id = ir.materia_prima_id
      WHERE r.producto_id = pe.id
        AND r.tipo_receta = 'envasado'
        AND r.activa = TRUE
        AND mp.tipo = 'producto_fabricado'
      ORDER BY r.created_at DESC
      LIMIT 1
   )
 WHERE pe.tipo = 'producto_envasado'
   AND pe.granel_id IS NULL
   AND EXISTS (
     SELECT 1 FROM public.recetas r
       WHERE r.producto_id = pe.id AND r.tipo_receta = 'envasado' AND r.activa = TRUE
   );
