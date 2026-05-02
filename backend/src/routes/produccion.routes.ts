import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { produccionController } from '../controllers/produccion.controller';
import { pool } from '../db/pool';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { isAllowedExtension } from '../lib/fileValidation';
import { alertaService } from '../services/alerta.service';
import { automatizacionesService } from '../services/automatizaciones.service';
import { toNum } from '../types';
import { logger } from '../lib/logger';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `foto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
  },
});

const uploadImages = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imagenes'));
  },
});

// Archivos generales (PDF, docs, imagenes) — with extension whitelist
const uploadFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `archivo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedExtension(file.originalname)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'));
  },
});

const router = Router();

router.get ('/',                produccionController.listar);
router.post('/',                produccionController.crear);
router.put ('/:id',             produccionController.editar);
router.post('/:id/confirmar',   uploadImages.array('fotos', 10), produccionController.confirmar);
router.post('/:id/adjuntar',    uploadFiles.array('archivos', 10), produccionController.adjuntar);
router.get ('/:id/trazabilidad.pdf', produccionController.trazabilidadPdf);
router.get ('/:id/detalle',     produccionController.detalle);
router.post('/:id/enviar-trazabilidad', produccionController.enviarTrazabilidad);
router.delete('/:id',           produccionController.eliminar);

// ── RECORDATORIOS ────────────────────────────────────────────
router.get('/recordatorios', async (req, res) => {
  try {
    const mes = req.query.mes as string;
    let sql = `SELECT id, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, titulo, descripcion, color, completado, usuario_id, created_at FROM recordatorios WHERE 1=1`;
    const params: string[] = [];
    if (mes) { sql += ` AND TO_CHAR(fecha, 'YYYY-MM') = $1`; params.push(mes); }
    sql += ` ORDER BY fecha ASC, created_at ASC`;
    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch { return res.status(500).json({ error: 'Error al cargar recordatorios.' }); }
});

router.post('/recordatorios', async (req, res) => {
  try {
    const { fecha, titulo, descripcion, color } = req.body;
    if (!fecha || !titulo) return res.status(400).json({ error: 'Fecha y título son obligatorios.' });
    const { rows: [rec] } = await pool.query(
      `INSERT INTO recordatorios (fecha, titulo, descripcion, color, usuario_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [fecha, titulo.trim(), descripcion ?? null, color ?? 'indigo', (req as any).user?.id ?? null]
    );
    return res.status(201).json(rec);
  } catch { return res.status(500).json({ error: 'Error al crear recordatorio.' }); }
});

router.put('/recordatorios/:id', async (req, res) => {
  try {
    const { fecha, titulo, color } = req.body;
    const { rows: [rec] } = await pool.query(
      `UPDATE recordatorios SET fecha = COALESCE($1, fecha), titulo = COALESCE($2, titulo), color = COALESCE($3, color) WHERE id = $4 RETURNING id, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, titulo, color`,
      [fecha ?? null, titulo ?? null, color ?? null, req.params.id]
    );
    if (!rec) return res.status(404).json({ error: 'Recordatorio no encontrado.' });
    return res.json(rec);
  } catch { return res.status(500).json({ error: 'Error al mover recordatorio.' }); }
});

router.delete('/recordatorios/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM recordatorios WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Error al eliminar recordatorio.' }); }
});

// POST /api/produccion/envasado-rapido — envasado dinámico con orden + trazabilidad (SERIALIZABLE)
router.post('/envasado-rapido', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const { cola_id, envase_id, etiqueta_id, cantidad_unidades, cliente, formato_label } = req.body;
    const userId = (req as any).user?.id ?? null;

    if (!cola_id || !cantidad_unidades || cantidad_unidades <= 0) {
      return res.status(400).json({ error: 'Cola y cantidad son obligatorios.' });
    }

    // Lock cola + envase en una sola query (orden determinístico evita deadlocks)
    interface ProdLock { id: string; nombre: string; codigo: string; stock_actual: string; coste_medio_actual: string | null; precio_unitario: string | null; unidades_por_envase: number | null }
    const lockIds = envase_id ? [cola_id, envase_id] : [cola_id];
    const { rows: lockedRows } = await client.query<ProdLock>(
      `SELECT id, nombre, codigo, stock_actual, coste_medio_actual, precio_unitario, unidades_por_envase
       FROM productos WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [lockIds]
    );
    const cola = lockedRows.find(r => r.id === cola_id);
    const envase: ProdLock | null = envase_id ? (lockedRows.find(r => r.id === envase_id) ?? null) : null;

    if (!cola) {
      await client.query('ROLLBACK').catch(rbErr => logger.error('[envasado-rapido] ROLLBACK fallo', { err: rbErr }));
      return res.status(404).json({ error: 'Cola no encontrada.' });
    }
    if (envase_id && !envase) {
      await client.query('ROLLBACK').catch(rbErr => logger.error('[envasado-rapido] ROLLBACK fallo', { err: rbErr }));
      return res.status(404).json({ error: 'Envase no encontrado.' });
    }

    // ── Multiplicador caja/palé (Fix C-1) ──
    // Fuente primaria: campo explícito productos.unidades_por_envase.
    // Fallback (compatibilidad): regex sobre nombre solo si la columna es NULL.
    // El backfill de migración 023 ya rellenó los envases existentes con
    // patrón válido; los nuevos deben setear el campo en la UI.
    let multiplicador = 1;
    if (envase) {
      if (envase.unidades_por_envase && envase.unidades_por_envase > 1) {
        multiplicador = envase.unidades_por_envase;
      } else {
        const multMatch = envase.nombre.match(/(?:caja|pal[eé]|palet)\s*(?:de\s*)?(\d+)/i);
        if (multMatch) multiplicador = parseInt(multMatch[1], 10);
      }
    }
    const totalUnidades = cantidad_unidades * multiplicador; // actual units to produce
    const cantidadEnvases = cantidad_unidades; // boxes/pallets consumed

    // Calcular peso por envase desde peso_unitario_kg del producto envasado o del envase
    const { rows: [envInfo] } = await client.query(`SELECT peso_unitario_kg FROM productos WHERE id = $1`, [envase_id || cola_id]);
    let pesoEnvase = toNum(envInfo?.peso_unitario_kg, 0);
    if (pesoEnvase <= 0 && envase) {
      const match = envase.nombre.match(/(\d+(?:\.\d+)?)\s*(g|kg|L)/i);
      if (match) {
        pesoEnvase = parseFloat(match[1]);
        if (match[2].toLowerCase() === 'g') pesoEnvase /= 1000;
      }
    }
    if (!Number.isFinite(pesoEnvase) || pesoEnvase <= 0) {
      await client.query('ROLLBACK').catch(rbErr => logger.error('[envasado-rapido] ROLLBACK fallo', { err: rbErr }));
      return res.status(400).json({ error: 'Peso de envase no válido (debe ser > 0). Define peso_unitario_kg en el producto.' });
    }

    const pesoTotal = pesoEnvase * totalUnidades;

    // Verificar stock
    const stockCola = parseFloat(cola.stock_actual);
    if (stockCola < pesoTotal) return res.status(422).json({ error: `Stock insuficiente de ${cola.nombre}: necesitas ${pesoTotal.toFixed(1)} kg, tienes ${stockCola.toFixed(1)} kg.` });
    if (envase_id && envase) {
      const stockEnvase = parseFloat(envase.stock_actual);
      if (stockEnvase < cantidadEnvases) return res.status(422).json({ error: `Stock insuficiente de ${envase.nombre}: necesitas ${cantidadEnvases}, tienes ${Math.floor(stockEnvase)}.` });
    }

    // Buscar o crear producto envasado (PE)
    const fmtLabel = formato_label || envase?.nombre || `${pesoEnvase}kg`;
    const peNombre = `${cola.nombre} ${fmtLabel}`;
    let { rows: [pe] } = await client.query(
      `SELECT id, nombre FROM productos WHERE nombre ILIKE $1 AND tipo = 'producto_envasado' LIMIT 1`,
      [`%${cola.nombre}%${fmtLabel.split(' ')[0]}%`]
    );
    if (!pe) {
      ({ rows: [pe] } = await client.query(
        `SELECT id, nombre FROM productos WHERE nombre ILIKE $1 AND tipo = 'producto_envasado' LIMIT 1`,
        [`%${peNombre}%`]
      ));
    }
    if (!pe) {
      const { rows: [maxCode] } = await client.query(`SELECT codigo FROM productos WHERE codigo LIKE 'PE-%' ORDER BY codigo DESC LIMIT 1`);
      let nextNum = 1;
      if (maxCode) { const m = maxCode.codigo.match(/PE-(\d+)/); if (m) nextNum = parseInt(m[1], 10) + 1; }
      const codigo = `PE-${String(nextNum).padStart(3, '0')}`;
      const costePE = (parseFloat(String(cola.coste_medio_actual || cola.precio_unitario || '0')) * pesoEnvase) + parseFloat(String(envase?.coste_medio_actual || envase?.precio_unitario || '0'));
      const { rows: [nuevo] } = await client.query(
        `INSERT INTO productos (codigo, nombre, tipo, unidad_medida, peso_unitario_kg, granel_id, precio_unitario)
         VALUES ($1, $2, 'producto_envasado', 'ud', $3, $4, $5) RETURNING id, nombre`,
        [codigo, peNombre, pesoEnvase, cola_id, costePE.toFixed(6)]
      );
      pe = nuevo;
    }

    // ── CREAR ORDEN DE PRODUCCIÓN para trazabilidad ──
    const notaOrden = multiplicador > 1
      ? `Envasado rápido: ${cantidadEnvases} ${envase?.nombre ?? 'cajas'} × ${multiplicador} = ${totalUnidades} ud de ${cola.nombre}`
      : `Envasado rápido: ${totalUnidades} × ${fmtLabel} de ${cola.nombre}`;
    const { rows: [orden] } = await client.query(
      `INSERT INTO ordenes_produccion (receta_id, cantidad_planificada, cantidad_real_producida, estado, cliente, fecha_planificada, fecha_inicio, fecha_fin, notas, tipo_orden, cola_id, envase_id, formato_label)
       VALUES (
         (SELECT id FROM recetas WHERE activa = true LIMIT 1),
         $1, $1, 'completada', $2, CURRENT_DATE, NOW(), NOW(), $3, 'envasado', $4, $5, $6
       ) RETURNING id, numero_orden`,
      [totalUnidades, cliente ?? null, notaOrden, cola_id, envase_id || null, fmtLabel]
    );

    // ── Descontar cola granel FIFO + stock_moves ──
    const { rows: lotesCola } = await client.query(
      `SELECT id, cantidad_actual FROM lotes WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
       ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`, [cola_id]
    );
    let restaCola = pesoTotal;
    for (const l of lotesCola) {
      if (restaCola <= 0) break;
      const disp = parseFloat(l.cantidad_actual);
      const usar = Math.min(disp, restaCola);
      await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2`, [usar.toFixed(6), l.id]);
      await client.query(
        `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
         VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
        [cola_id, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6), orden.id, userId, `Envasado ${orden.numero_orden}`]
      );
      restaCola -= usar;
    }
    if (restaCola > 0.001) throw new Error(`STOCK_INSUFICIENTE:${cola.nombre}:falta=${restaCola.toFixed(6)} kg en lotes`);
    await client.query(`UPDATE productos SET stock_actual = stock_actual - $1, version = version + 1 WHERE id = $2`, [pesoTotal.toFixed(6), cola_id]);

    // ── Descontar envases FIFO (cantidadEnvases = boxes/pallets, not individual units) ──
    if (envase_id) {
      const { rows: lotesEnvase } = await client.query(
        `SELECT id, cantidad_actual FROM lotes WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`, [envase_id]
      );
      let restaEnv = cantidadEnvases;
      for (const l of lotesEnvase) {
        if (restaEnv <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, restaEnv);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2`, [usar.toFixed(6), l.id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
           VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
          [envase_id, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6), orden.id, userId, `Envase ${orden.numero_orden}`]
        );
        restaEnv -= usar;
      }
      if (restaEnv > 0.001) throw new Error(`STOCK_INSUFICIENTE:${envase?.nombre ?? 'envase'}:falta=${restaEnv.toFixed(0)} en lotes`);
      await client.query(`UPDATE productos SET stock_actual = stock_actual - $1, version = version + 1 WHERE id = $2`, [cantidadEnvases, envase_id]);
    }

    // ── Descontar etiquetas FIFO (totalUnidades = individual units, one label per unit) ──
    if (etiqueta_id) {
      const { rows: lotesEtiq } = await client.query(
        `SELECT id, cantidad_actual FROM lotes WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`, [etiqueta_id]
      );
      let restaEtiq = totalUnidades;
      for (const l of lotesEtiq) {
        if (restaEtiq <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, restaEtiq);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2`, [usar.toFixed(6), l.id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
           VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
          [etiqueta_id, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6), orden.id, userId, `Etiqueta ${orden.numero_orden}`]
        );
        restaEtiq -= usar;
      }
      if (restaEtiq > 0.001) throw new Error(`STOCK_INSUFICIENTE:etiqueta:falta=${restaEtiq.toFixed(0)} en lotes`);
      await client.query(`UPDATE productos SET stock_actual = stock_actual - $1, version = version + 1 WHERE id = $2`, [totalUnidades, etiqueta_id]);
    }

    // ── Materiales extra de la receta envasado (Fix C-2) ──
    // Antes: envasado rápido solo descontaba cola + envase + etiqueta opcional.
    // El manual prometía consumo de "todos los materiales extra" (cajas, tapones,
    // selladores, sellos QR...) pero el código los ignoraba. Ahora: si el
    // producto envasado destino tiene receta tipo='envasado' activa, se
    // consumen TODOS sus ingredientes (excepto cola/envase/etiqueta ya
    // descontados arriba para evitar doble descuento).
    const idsYaDescontados = new Set<string>([cola_id, envase_id, etiqueta_id].filter(Boolean) as string[]);
    const materialesExtraConsumidos: { id: string; nombre: string; cantidad: number }[] = [];
    let costeMaterialesExtra = 0;
    const { rows: [recetaEnv] } = await client.query<{ id: string }>(
      `SELECT id FROM recetas WHERE producto_id = $1 AND tipo_receta = 'envasado' AND activa = TRUE
       ORDER BY version DESC LIMIT 1`,
      [pe.id]
    );
    if (recetaEnv) {
      const { rows: ingredientesExtra } = await client.query<{
        materia_prima_id: string; cantidad: string; nombre: string; tipo: string;
        coste_medio_actual: string | null; precio_unitario: string | null;
      }>(
        `SELECT ir.materia_prima_id, ir.cantidad, p.nombre, p.tipo::text AS tipo,
                p.coste_medio_actual, p.precio_unitario
         FROM ingredientes_receta ir JOIN productos p ON p.id = ir.materia_prima_id
         WHERE ir.receta_id = $1`,
        [recetaEnv.id]
      );
      for (const ing of ingredientesExtra) {
        if (idsYaDescontados.has(ing.materia_prima_id)) continue;
        const cantidadPorUd = parseFloat(ing.cantidad);
        if (!Number.isFinite(cantidadPorUd) || cantidadPorUd <= 0) continue;
        const cantidadNecesaria = cantidadPorUd * totalUnidades;
        const { rows: lotesExtra } = await client.query<{ id: string; cantidad_actual: string }>(
          `SELECT id, cantidad_actual FROM lotes
           WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
           ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`,
          [ing.materia_prima_id]
        );
        let resta = cantidadNecesaria;
        for (const l of lotesExtra) {
          if (resta <= 0) break;
          const disp = parseFloat(l.cantidad_actual);
          const usar = Math.min(disp, resta);
          await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2`, [usar.toFixed(6), l.id]);
          await client.query(
            `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
             VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
            [ing.materia_prima_id, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6), orden.id, userId, `Material receta ${orden.numero_orden}: ${ing.nombre}`]
          );
          resta -= usar;
        }
        if (resta > 0.001) throw new Error(`STOCK_INSUFICIENTE:${ing.nombre}:falta=${resta.toFixed(0)} en lotes`);
        await client.query(
          `UPDATE productos SET stock_actual = stock_actual - $1, version = version + 1 WHERE id = $2`,
          [cantidadNecesaria.toFixed(6), ing.materia_prima_id]
        );
        materialesExtraConsumidos.push({ id: ing.materia_prima_id, nombre: ing.nombre, cantidad: cantidadNecesaria });
        const cmpExtra = parseFloat(ing.coste_medio_actual ?? ing.precio_unitario ?? '0');
        costeMaterialesExtra += cantidadPorUd * cmpExtra; // coste por unidad envasada
        idsYaDescontados.add(ing.materia_prima_id);
      }
    }

    // ── Crear lote de producto envasado + stock_move de salida ──
    const loteInterno = `PE-${orden.numero_orden}-${Date.now()}`;
    // Cost per unit: (cola CMP * weight) + (envase CMP / multiplicador) + etiqueta CMP + materiales extra
    const colaCMP = parseFloat(String(cola.coste_medio_actual || cola.precio_unitario || '0'));
    const envaseCMP = parseFloat(String(envase?.coste_medio_actual || envase?.precio_unitario || '0'));
    let costePE = (colaCMP * pesoEnvase) + (multiplicador > 1 ? envaseCMP / multiplicador : envaseCMP);
    if (etiqueta_id) {
      const { rows: [etiq] } = await client.query(`SELECT coste_medio_actual, precio_unitario FROM productos WHERE id = $1`, [etiqueta_id]);
      if (etiq) costePE += parseFloat(etiq.coste_medio_actual || etiq.precio_unitario || '0');
    }
    costePE += costeMaterialesExtra;
    // Read current stock for accurate stock_move antes/despues
    const { rows: [peStock] } = await client.query(`SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`, [pe.id]);
    const peStockAntes = parseFloat(peStock?.stock_actual ?? '0');
    const { rows: [lotePE] } = await client.query(
      `INSERT INTO lotes (producto_id, lote_interno, cantidad_inicial, cantidad_actual, estado, precio_compra)
       VALUES ($1, $2, $3, $3, 'aprobado', $4) RETURNING id`,
      [pe.id, loteInterno, totalUnidades, costePE.toFixed(6)]
    );
    await client.query(`UPDATE productos SET stock_actual = stock_actual + $1, version = version + 1 WHERE id = $2`, [totalUnidades, pe.id]);
    await client.query(
      `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
       VALUES ($1, $2, 'produccion_salida', $3, $4, $5, $6, $7, $8)`,
      [pe.id, lotePE.id, totalUnidades, peStockAntes.toFixed(6), (peStockAntes + totalUnidades).toFixed(6), orden.id, userId, `Envasado ${orden.numero_orden}: ${totalUnidades} ud${multiplicador > 1 ? ` (${cantidadEnvases} × ${multiplicador})` : ''}`]
    );

    await client.query(`UPDATE ordenes_produccion SET lote_producido_id = $1 WHERE id = $2`, [lotePE.id, orden.id]);

    await client.query('COMMIT');
    invalidarCacheFinanzas();

    // Push-based stock alerts for consumed materials (incluye extras de receta)
    const alertIds = [
      cola_id,
      envase_id,
      etiqueta_id,
      ...materialesExtraConsumidos.map(m => m.id),
    ].filter(Boolean) as string[];
    alertaService.checkStockMinimo(alertIds).catch(() => {});

    // Automatizaciones: producto envasado producido + materiales consumidos
    setImmediate(() => {
      automatizacionesService.checkStockAndTrigger(pe.id).catch(err => console.error('[auto.envasado-pe]', err));
      for (const id of alertIds) {
        automatizacionesService.checkStockAndTrigger(id).catch(err => console.error('[auto.envasado-mat]', err));
      }
    });

    return res.json({
      ok: true,
      producto_envasado: pe.nombre,
      cantidad: totalUnidades,
      multiplicador,
      cajas_consumidas: multiplicador > 1 ? cantidadEnvases : undefined,
      peso_cola_consumido: pesoTotal,
      envases_consumidos: envase_id ? cantidadEnvases : 0,
      materiales_extra: materialesExtraConsumidos,
      lote: loteInterno,
      orden_id: orden.id,
      numero_orden: orden.numero_orden,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(rbErr => logger.error('[envasado-rapido] ROLLBACK fallo', { err: rbErr }));
    logger.error('[envasado-rapido]', { err });
    const msg = err instanceof Error ? err.message : '';
    return res.status(500).json({ error: msg || 'Error al envasar.' });
  } finally {
    client.release();
  }
});

// POST /api/produccion/envasado-planificar — crear orden de envasado como borrador
router.post('/envasado-planificar', async (req, res) => {
  try {
    const { producto_final_id, cola_id, envase_id, cantidad_unidades, fecha_planificada, cliente, cliente_id, formato_label, notas, materiales } = req.body;

    if (!cola_id || !envase_id || !cantidad_unidades || cantidad_unidades <= 0) {
      return res.status(400).json({ error: 'Cola, envase y cantidad son obligatorios.' });
    }

    // Validar productos
    const { rows: [cola] } = await pool.query(`SELECT id, nombre, stock_actual FROM productos WHERE id = $1`, [cola_id]);
    const { rows: [envase] } = await pool.query(`SELECT id, nombre, peso_unitario_kg FROM productos WHERE id = $1`, [envase_id]);
    if (!cola || !envase) return res.status(404).json({ error: 'Producto no encontrado.' });

    // Nombre del producto final
    let productoFinalNombre = '';
    if (producto_final_id) {
      const { rows: [pf] } = await pool.query(`SELECT nombre FROM productos WHERE id = $1`, [producto_final_id]);
      productoFinalNombre = pf?.nombre ?? '';
    }

    const fmtLabel = formato_label || envase.nombre || '';
    const materialesJson = Array.isArray(materiales) ? JSON.stringify(materiales) : '[]';

    const { rows: [orden] } = await pool.query(
      `INSERT INTO ordenes_produccion (receta_id, cantidad_planificada, estado, cliente, cliente_id, fecha_planificada, notas, tipo_orden, cola_id, envase_id, formato_label, producto_final_id, materiales)
       VALUES (
         (SELECT id FROM recetas WHERE activa = true LIMIT 1),
         $1, 'borrador', $2, $3, $4, $5, 'envasado', $6, $7, $8, $9, $10::JSONB
       ) RETURNING id, numero_orden`,
      [cantidad_unidades, cliente ?? null, cliente_id ?? null, fecha_planificada ?? null,
       notas ?? `Envasado: ${cantidad_unidades} × ${productoFinalNombre || fmtLabel} — ${cola.nombre}`,
       cola_id, envase_id, fmtLabel, producto_final_id ?? null, materialesJson]
    );

    return res.status(201).json({
      ok: true,
      orden_id: orden.id,
      numero_orden: orden.numero_orden,
      cola_nombre: cola.nombre,
      envase_nombre: envase.nombre,
      cantidad: cantidad_unidades,
      formato_label: fmtLabel,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    return res.status(500).json({ error: msg || 'Error al planificar envasado.' });
  }
});

// Helper: calculate envasado consumption from an order
async function calcularConsumoEnvasado(orden: any) {
  const { rows: [cola] } = await pool.query(`SELECT id, nombre, codigo, stock_actual, coste_medio_actual, precio_unitario FROM productos WHERE id = $1`, [orden.cola_id]);
  const { rows: [envase] } = await pool.query(`SELECT id, nombre, codigo, stock_actual, coste_medio_actual, precio_unitario, unidades_por_envase FROM productos WHERE id = $1`, [orden.envase_id]);
  if (!cola || !envase) throw new Error('Producto no encontrado.');

  // Get peso from producto_final (not envase!)
  let pesoUnitario = 0;
  if (orden.producto_final_id) {
    const { rows: [pf] } = await pool.query(`SELECT peso_unitario_kg FROM productos WHERE id = $1`, [orden.producto_final_id]);
    pesoUnitario = parseFloat(pf?.peso_unitario_kg ?? '0');
  }
  // Fallback: parse from envase name
  if (!pesoUnitario) {
    const match = envase.nombre.match(/(\d+(?:\.\d+)?)\s*(g|kg|L)/i);
    if (match) { pesoUnitario = parseFloat(match[1]); if (match[2].toLowerCase() === 'g') pesoUnitario /= 1000; }
  }
  if (!pesoUnitario) throw new Error('No se puede determinar el peso unitario.');

  const cantidadInput = parseFloat(orden.cantidad_planificada);

  // Multiplicador caja/palé (Fix C-1): campo explícito → fallback regex.
  let multiplicador = 1;
  if (envase.unidades_por_envase && envase.unidades_por_envase > 1) {
    multiplicador = envase.unidades_por_envase;
  } else {
    const multMatch = envase.nombre.match(/(?:caja|pal[eé]|palet)\s*(?:de\s*)?(\d+)/i);
    if (multMatch) multiplicador = parseInt(multMatch[1], 10);
  }

  const totalUnidades = cantidadInput * multiplicador;
  const pesoColaNecesario = totalUnidades * pesoUnitario;

  // Materials from order
  const materialesArr: { producto_id: string; cantidad: number }[] = Array.isArray(orden.materiales)
    ? orden.materiales : (typeof orden.materiales === 'string' ? JSON.parse(orden.materiales || '[]') : []);

  // Build consumption list
  const consumos: { producto_id: string; nombre: string; cantidad: number; unidad: string; tipo: string }[] = [
    { producto_id: cola.id, nombre: cola.nombre, cantidad: pesoColaNecesario, unidad: 'kg', tipo: 'cola' },
  ];

  // If envase is a caja/palet (multiplier > 1), find and consume the individual container (frasco/bote)
  if (multiplicador > 1) {
    // Find individual container matching product final format: "Frasco 75g", "Bote 1kg", etc.
    // Extract format from producto_final name
    let contenedorId: string | null = null;
    if (orden.producto_final_id) {
      const { rows: [pf] } = await pool.query(`SELECT nombre FROM productos WHERE id = $1`, [orden.producto_final_id]);
      if (pf) {
        // Extract format: "Cola Blanca Autoadhesiva Frasco 75g" → "Frasco 75g"
        const fmtMatch = pf.nombre.match(/(frasco|bote|garrafa|bidón|bidon|saco)\s*\d+/i);
        if (fmtMatch) {
          const fmtSearch = fmtMatch[0]; // e.g. "Frasco 75"
          const { rows: [contenedor] } = await pool.query(
            `SELECT id, nombre FROM productos WHERE tipo = 'material_embalaje' AND activo = true
             AND LOWER(nombre) LIKE '%' || LOWER($1) || '%' LIMIT 1`, [fmtSearch]
          );
          if (contenedor) contenedorId = contenedor.id;
        }
      }
    }
    // Fallback: try matching by peso_unitario_kg if name search failed
    if (!contenedorId && pesoUnitario > 0) {
      const { rows: [contByPeso] } = await pool.query(
        `SELECT id, nombre FROM productos WHERE tipo = 'material_embalaje' AND activo = true
         AND peso_unitario_kg = $1 AND LOWER(nombre) NOT LIKE '%caja%' AND LOWER(nombre) NOT LIKE '%pal%'
         LIMIT 1`, [pesoUnitario]
      );
      if (contByPeso) contenedorId = contByPeso.id;
    }
    if (contenedorId) {
      const { rows: [cont] } = await pool.query(`SELECT id, nombre FROM productos WHERE id = $1`, [contenedorId]);
      consumos.push({ producto_id: cont.id, nombre: cont.nombre, cantidad: totalUnidades, unidad: 'ud', tipo: 'contenedor' });
    }
    // Caja/palet = cantidadInput
    consumos.push({ producto_id: envase.id, nombre: envase.nombre, cantidad: cantidadInput, unidad: 'ud', tipo: 'envase' });
  } else {
    // Direct container (bote, garrafa, etc.) — consume at totalUnidades rate
    consumos.push({ producto_id: envase.id, nombre: envase.nombre, cantidad: totalUnidades, unidad: 'ud', tipo: 'envase' });
  }

  // Extra materials from order
  for (const mat of materialesArr) {
    if (!mat.producto_id || !mat.cantidad) continue;
    const { rows: [mp] } = await pool.query(`SELECT nombre FROM productos WHERE id = $1`, [mat.producto_id]);
    consumos.push({ producto_id: mat.producto_id, nombre: mp?.nombre ?? '?', cantidad: parseFloat(String(mat.cantidad)), unidad: 'ud', tipo: 'material' });
  }

  return { cola, envase, pesoUnitario, multiplicador, cantidadInput, totalUnidades, pesoColaNecesario, consumos };
}

// GET /api/produccion/:id/preview-envasado — preview lots before executing
router.get('/:id/preview-envasado', async (req, res) => {
  try {
    const { rows: [orden] } = await pool.query(`SELECT * FROM ordenes_produccion WHERE id = $1`, [req.params.id]);
    if (!orden || orden.tipo_orden !== 'envasado') return res.status(404).json({ error: 'Orden de envasado no encontrada.' });

    const calc = await calcularConsumoEnvasado(orden);
    // For each consumo, get FIFO lots
    const preview: { producto_id: string; nombre: string; cantidad_necesaria: number; unidad: string; stock_actual: number; suficiente: boolean; lotes: any[] }[] = [];

    for (const c of calc.consumos) {
      const { rows: [prod] } = await pool.query(`SELECT stock_actual FROM productos WHERE id = $1`, [c.producto_id]);
      const stockActual = parseFloat(prod?.stock_actual ?? '0');
      const { rows: lotes } = await pool.query(
        `SELECT l.id, l.lote_interno, l.cantidad_actual, l.precio_compra, TO_CHAR(l.fecha_caducidad, 'DD/MM/YYYY') AS fecha_caducidad
         FROM lotes l WHERE l.producto_id = $1 AND l.estado = 'aprobado' AND l.cantidad_actual > 0
         ORDER BY l.fecha_caducidad ASC NULLS LAST, l.fecha_entrada ASC LIMIT 20`, [c.producto_id]
      );
      // Mark which lots will be used (FIFO)
      let falta = c.cantidad;
      const lotesConUso = lotes.map(l => {
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, Math.max(0, falta));
        falta -= usar;
        return { ...l, cantidad_a_usar: Math.round(usar * 1000) / 1000 };
      });
      preview.push({
        producto_id: c.producto_id, nombre: c.nombre,
        cantidad_necesaria: Math.round(c.cantidad * 1000) / 1000,
        unidad: c.unidad, stock_actual: stockActual,
        suficiente: stockActual >= c.cantidad,
        lotes: lotesConUso.filter(l => l.cantidad_a_usar > 0),
      });
    }

    return res.json({
      orden_id: orden.id, numero_orden: orden.numero_orden,
      producto_final: orden.producto_final_id,
      multiplicador: calc.multiplicador,
      cantidad_input: calc.cantidadInput,
      total_unidades: calc.totalUnidades,
      peso_cola: calc.pesoColaNecesario,
      consumos: preview,
      todo_ok: preview.every(p => p.suficiente),
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/produccion/:id/confirmar-envasado — ejecutar orden de envasado (SERIALIZABLE)
router.post('/:id/confirmar-envasado', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const { id } = req.params;
    const userId = (req as any).user?.id ?? null;

    const { rows: [orden] } = await client.query(`SELECT * FROM ordenes_produccion WHERE id = $1`, [id]);
    if (!orden) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    if (orden.tipo_orden !== 'envasado') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No es orden de envasado.' }); }
    if (!['borrador', 'confirmada'].includes(orden.estado)) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Estado "${orden.estado}" no permite confirmar.` }); }
    if (!orden.cola_id || !orden.envase_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Orden sin cola o envase.' }); }

    const calc = await calcularConsumoEnvasado(orden);
    const fmtLabel = orden.formato_label || '';

    // Verify stock for ALL items before consuming
    for (const c of calc.consumos) {
      const { rows: [prod] } = await client.query(`SELECT stock_actual, nombre FROM productos WHERE id = $1`, [c.producto_id]);
      const stock = parseFloat(prod?.stock_actual ?? '0');
      if (stock < c.cantidad) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: `Stock insuficiente de ${prod?.nombre}: necesitas ${c.cantidad.toFixed(1)}, tienes ${stock.toFixed(1)}.` });
      }
    }

    // Resolve producto final
    let pe: { id: string; nombre: string };
    if (orden.producto_final_id) {
      const { rows: [pf] } = await client.query(`SELECT id, nombre FROM productos WHERE id = $1`, [orden.producto_final_id]);
      if (!pf) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Producto final no encontrado.' }); }
      pe = pf;
    } else {
      const peNombre = `${calc.cola.nombre} ${fmtLabel}`;
      let { rows: [found] } = await client.query(`SELECT id, nombre FROM productos WHERE nombre ILIKE $1 AND tipo = 'producto_envasado' LIMIT 1`, [`%${peNombre}%`]);
      if (!found) {
        const { rows: [maxCode] } = await client.query(`SELECT codigo FROM productos WHERE codigo LIKE 'PE-%' ORDER BY codigo DESC LIMIT 1`);
        let nextNum = 1;
        if (maxCode) { const m = maxCode.codigo.match(/PE-(\d+)/); if (m) nextNum = parseInt(m[1], 10) + 1; }
        const costePE = (parseFloat(calc.cola.coste_medio_actual || calc.cola.precio_unitario) * calc.pesoUnitario) + parseFloat(calc.envase?.coste_medio_actual || calc.envase?.precio_unitario || '0');
        ({ rows: [found] } = await client.query(
          `INSERT INTO productos (codigo, nombre, tipo, unidad_medida, peso_unitario_kg, granel_id, precio_unitario)
           VALUES ($1, $2, 'producto_envasado', 'ud', $3, $4, $5) RETURNING id, nombre`,
          [`PE-${String(nextNum).padStart(3, '0')}`, peNombre, calc.pesoUnitario, orden.cola_id, costePE.toFixed(6)]
        ));
      }
      pe = found;
    }

    // Consume each item FIFO (within transaction)
    for (const c of calc.consumos) {
      const { rows: lotes } = await client.query(
        `SELECT id, cantidad_actual FROM lotes WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`, [c.producto_id]
      );
      let falta = c.cantidad;
      for (const l of lotes) {
        if (falta <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, falta);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2`, [usar.toFixed(6), l.id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
           VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
          [c.producto_id, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6), id, userId, `Envasado ${orden.numero_orden}`]
        );
        falta -= usar;
      }
      await client.query(`UPDATE productos SET stock_actual = stock_actual - $1, version = version + 1 WHERE id = $2`, [c.cantidad.toFixed(6), c.producto_id]);
    }

    // Crear lote de producto envasado — coste = cola + envase + todos los materiales
    const loteInterno = `PE-${orden.numero_orden}-${Date.now()}`;
    let costePE = (parseFloat(calc.cola.coste_medio_actual || calc.cola.precio_unitario) * calc.pesoUnitario)
      + parseFloat(calc.envase?.coste_medio_actual || calc.envase?.precio_unitario || '0');
    // Add cost of all consumed materials (contenedor + extras)
    for (const c of calc.consumos) {
      if (c.tipo === 'contenedor' || c.tipo === 'material') {
        const { rows: [mp] } = await client.query(`SELECT coste_medio_actual, precio_unitario FROM productos WHERE id = $1`, [c.producto_id]);
        if (mp) costePE += (parseFloat(mp.coste_medio_actual || mp.precio_unitario || '0') * c.cantidad) / calc.totalUnidades;
      }
    }
    const { rows: [lotePE] } = await client.query(
      `INSERT INTO lotes (producto_id, lote_interno, cantidad_inicial, cantidad_actual, estado, precio_compra)
       VALUES ($1, $2, $3, $3, 'aprobado', $4) RETURNING id`,
      [pe.id, loteInterno, calc.totalUnidades, costePE.toFixed(6)]
    );
    await client.query(`UPDATE productos SET stock_actual = stock_actual + $1, version = version + 1 WHERE id = $2`, [calc.totalUnidades, pe.id]);

    await client.query(
      `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
       VALUES ($1, $2, 'produccion_salida', $3, 0, $3, $4, $5, $6)`,
      [pe.id, lotePE.id, calc.totalUnidades, id, userId, `Envasado ${orden.numero_orden}: ${calc.totalUnidades} ud`]
    );

    await client.query(
      `UPDATE ordenes_produccion SET estado = 'completada', cantidad_real_producida = $1, lote_producido_id = $2, fecha_inicio = NOW(), fecha_fin = NOW() WHERE id = $3`,
      [calc.totalUnidades, lotePE.id, id]
    );

    await client.query('COMMIT');
    invalidarCacheFinanzas();

    return res.json({
      ok: true,
      producto_envasado: pe.nombre,
      cantidad: calc.totalUnidades,
      peso_cola_consumido: calc.pesoColaNecesario,
      envases_consumidos: calc.cantidadInput,
      lote: loteInterno,
      orden_id: id,
      numero_orden: orden.numero_orden,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(rbErr => logger.error('[confirmar-envasado] ROLLBACK fallo', { err: rbErr }));
    logger.error('[confirmar-envasado]', { err });
    const msg = err instanceof Error ? err.message : '';
    return res.status(500).json({ error: msg || 'Error al confirmar envasado.' });
  } finally {
    client.release();
  }
});

// GET /api/produccion/dashboard — solo datos necesarios para dashboard (rápido)
router.get('/dashboard', async (req, res) => {
  try {
    const mes = req.query.mes as string || new Date().toISOString().slice(0, 7); // YYYY-MM
    // Órdenes del mes (calendario) + últimas 15
    const { rows } = await pool.query(`
      (SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre
       FROM ordenes_produccion op
       JOIN recetas r ON r.id = op.receta_id
       JOIN productos p ON p.id = r.producto_id
       WHERE TO_CHAR(COALESCE(op.fecha_planificada, op.created_at), 'YYYY-MM') = $1)
      UNION
      (SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre
       FROM ordenes_produccion op
       JOIN recetas r ON r.id = op.receta_id
       JOIN productos p ON p.id = r.producto_id
       ORDER BY op.created_at DESC LIMIT 15)
      ORDER BY created_at DESC
    `, [mes]);
    return res.json(rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: 'Error al cargar dashboard.' });
  }
});

// GET /api/produccion/lote/:loteId/origen — trazabilidad: qué orden produjo este lote y qué consumió
router.get('/lote/:loteId/origen', async (req, res) => {
  try {
    const { loteId } = req.params;
    // Buscar stock_move de tipo produccion_salida con este lote
    const { rows: [move] } = await pool.query(
      `SELECT sm.orden_id FROM stock_moves sm WHERE sm.lote_id = $1 AND sm.tipo = 'produccion_salida' LIMIT 1`,
      [loteId]
    );
    if (!move?.orden_id) return res.json({ consumos: [] });

    // Buscar consumos de esa orden de fabricación
    const { rows: consumos } = await pool.query(
      `SELECT sm.id, sm.tipo, sm.cantidad,
         p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
         l.lote_interno, l.fecha_caducidad, COALESCE(l.precio_compra, p.precio_unitario) AS precio_unitario
       FROM stock_moves sm
       JOIN productos p ON p.id = sm.producto_id
       LEFT JOIN lotes l ON l.id = sm.lote_id
       WHERE sm.orden_id = $1 AND sm.tipo = 'produccion_consumo'
       ORDER BY p.nombre ASC`,
      [move.orden_id]
    );
    return res.json({ orden_id: move.orden_id, consumos });
  } catch (err: unknown) {
    return res.status(500).json({ error: 'Error al obtener trazabilidad del lote.' });
  }
});

export default router;
