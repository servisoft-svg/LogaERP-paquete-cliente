import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { produccionController } from '../controllers/produccion.controller';
import { pool } from '../db/pool';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { isAllowedExtension } from '../lib/fileValidation';
import { alertaService } from '../services/alerta.service';
import { automatizacionesService } from '../services/automatizaciones.service';
import { fetchMeteoSnapshot } from '../services/meteo.service';
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
router.get ('/:id/receta.pdf',       produccionController.recetaPdf);
router.post('/:id/receta.pdf',       produccionController.recetaPdf);
router.get ('/:id/etiqueta.pdf',     produccionController.etiquetaL800Pdf);
router.get ('/:id/etiqueta.ezpx',    produccionController.etiquetaL800Ezpx);
router.get ('/:id/etiqueta-defaults', produccionController.etiquetaDefaults);
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
  // Snapshot meteo ANTES del BEGIN (timeout 3s, fail-soft).
  const meteoEnvasadoRapido = await fetchMeteoSnapshot();
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

    // peso_unitario_kg representa el peso TOTAL de cola que entra en 1 envase
    // (Bidón 30kg → 30, Caja 40×250g → 10). Por tanto: cola consumida =
    // cantidad de envases × peso_envase. NO multiplicar por totalUnidades:
    // eso multiplicaría por el factor multiplicador 2 veces (bug anterior 4×).
    const pesoTotal = cantidadEnvases * pesoEnvase;

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
    let peCreado = false; // <-- flag para sugerir crear receta al frontend
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
      peCreado = true;
    }

    // Verificar si el PE tiene receta envasado activa (para sugerir crearla
    // al frontend si falta — Hallazgo #4 auditoría coste auto desde receta)
    const { rows: [recetaExiste] } = await client.query(
      `SELECT 1 FROM recetas
       WHERE producto_id = $1 AND tipo_receta = 'envasado' AND activa = TRUE
       LIMIT 1`,
      [pe.id]
    );
    const sugerirCrearReceta = !recetaExiste;

    // ── CREAR ORDEN DE PRODUCCIÓN para trazabilidad ──
    const notaOrden = multiplicador > 1
      ? `Envasado rápido: ${cantidadEnvases} ${envase?.nombre ?? 'cajas'} × ${multiplicador} = ${totalUnidades} ud de ${cola.nombre}`
      : `Envasado rápido: ${totalUnidades} × ${fmtLabel} de ${cola.nombre}`;
    // Captura inicio cliente para duración real (envasado rápido también)
    let fechaInicioRapido: string | null = null;
    if (typeof req.body.fecha_inicio_cliente === 'string' && req.body.fecha_inicio_cliente.trim()) {
      const t = Date.parse(req.body.fecha_inicio_cliente);
      const ahora = Date.now();
      if (!Number.isNaN(t) && t <= ahora + 60_000 && ahora - t < 24 * 3600 * 1000) {
        fechaInicioRapido = new Date(t).toISOString();
      }
    }
    const { rows: [orden] } = await client.query(
      `INSERT INTO ordenes_produccion (receta_id, cantidad_planificada, cantidad_real_producida, estado, cliente, fecha_planificada, fecha_inicio, fecha_fin, notas, tipo_orden, cola_id, envase_id, formato_label, operario_id, creado_por_id, meteo)
       VALUES (
         (SELECT id FROM recetas WHERE activa = true LIMIT 1),
         $1, $1, 'completada', $2, CURRENT_DATE, COALESCE($7::TIMESTAMPTZ, NOW()), NOW(), $3, 'envasado', $4, $5, $6, $8::UUID, $8::UUID, $9::JSONB
       ) RETURNING id, numero_orden`,
      [totalUnidades, cliente ?? null, notaOrden, cola_id, envase_id || null, fmtLabel, fechaInicioRapido, userId, meteoEnvasadoRapido ? JSON.stringify(meteoEnvasadoRapido) : null]
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
    // [Hot-fix C-5]: trigger fn_trg_lotes_stock_actual ya gestionó stock_actual
    // tras los UPDATE lotes anteriores. Solo bumpeamos version (optimistic lock).
    await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [cola_id]);

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
      // [Hot-fix C-5]: trigger ya gestionó stock_actual desde lotes.
      await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [envase_id]);
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
      // [Hot-fix C-5]: trigger ya gestionó stock_actual desde lotes.
      await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [etiqueta_id]);
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
        // [Hot-fix C-5]: trigger ya gestionó stock_actual desde lotes.
        await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [ing.materia_prima_id]);
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
    // [Hot-fix C-5]: el INSERT INTO lotes anterior dispara trigger que ya
    // actualizó productos.stock_actual con el nuevo total desde lotes.
    await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [pe.id]);
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
      producto_envasado_id: pe.id,
      producto_envasado_creado: peCreado, // <-- Hallazgo #4
      sugerir_crear_receta: sugerirCrearReceta, // <-- prompt al frontend
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

    const userIdPlan = (req as any).user?.id ?? null;
    const { rows: [orden] } = await pool.query(
      `INSERT INTO ordenes_produccion (receta_id, cantidad_planificada, estado, cliente, cliente_id, fecha_planificada, notas, tipo_orden, cola_id, envase_id, formato_label, producto_final_id, materiales, creado_por_id)
       VALUES (
         (SELECT id FROM recetas WHERE activa = true LIMIT 1),
         $1, 'borrador', $2, $3, $4, $5, 'envasado', $6, $7, $8, $9, $10::JSONB, $11::UUID
       ) RETURNING id, numero_orden`,
      [cantidad_unidades, cliente ?? null, cliente_id ?? null, fecha_planificada ?? null,
       notas ?? `Envasado: ${cantidad_unidades} × ${productoFinalNombre || fmtLabel} — ${cola.nombre}`,
       cola_id, envase_id, fmtLabel, producto_final_id ?? null, materialesJson, userIdPlan]
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
  const { rows: [envase] } = await pool.query(`SELECT id, nombre, codigo, stock_actual, coste_medio_actual, precio_unitario, unidades_por_envase, peso_unitario_kg FROM productos WHERE id = $1`, [orden.envase_id]);
  if (!cola || !envase) throw new Error('Producto no encontrado.');

  // Multiplicador: prioridad campo explícito BD > regex del nombre > 1.
  let multiplicador = 1;
  if (envase.unidades_por_envase && envase.unidades_por_envase > 1) {
    multiplicador = envase.unidades_por_envase;
  } else {
    const multMatch = envase.nombre.match(/(?:caja|pal[eé]|palet)\s*(?:de\s*)?(\d+)/i);
    if (multMatch) multiplicador = parseInt(multMatch[1], 10);
  }

  // Peso de cola por envase. Estrategia (más fiable primero):
  //   1. envase.peso_unitario_kg (kg de cola que entra en 1 envase). Funciona
  //      uniforme para sueltos (Bidón 30kg → 30) y cajas (Caja 40×250g → 10).
  //   2. producto_final.peso_unitario_kg × multiplicador (config legacy donde
  //      el peso vive en el producto envasado, no en el envase).
  //   3. Regex del nombre del envase (último fallback).
  let pesoColaPorEnvase = parseFloat(envase.peso_unitario_kg ?? '0');
  let pesoUnitario = multiplicador > 0 ? pesoColaPorEnvase / multiplicador : pesoColaPorEnvase;

  if (!pesoColaPorEnvase && orden.producto_final_id) {
    const { rows: [pf] } = await pool.query(`SELECT peso_unitario_kg FROM productos WHERE id = $1`, [orden.producto_final_id]);
    const pfPeso = parseFloat(pf?.peso_unitario_kg ?? '0');
    if (pfPeso > 0) {
      pesoUnitario = pfPeso;
      pesoColaPorEnvase = pfPeso * multiplicador;
    }
  }
  if (!pesoColaPorEnvase) {
    const match = envase.nombre.match(/(\d+(?:\.\d+)?)\s*(g|kg|L)/i);
    if (match) {
      let v = parseFloat(match[1]);
      if (match[2].toLowerCase() === 'g') v /= 1000;
      pesoColaPorEnvase = v;
      pesoUnitario = multiplicador > 0 ? v / multiplicador : v;
    }
  }
  if (!pesoColaPorEnvase) throw new Error('No se puede determinar el peso de cola por envase. Configura peso_unitario_kg en la ficha del envase.');

  const cantidadInput = parseFloat(orden.cantidad_planificada);
  const totalUnidades = cantidadInput * multiplicador;
  const pesoColaNecesario = cantidadInput * pesoColaPorEnvase;

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
  // Snapshot meteo ANTES del BEGIN (timeout 3s, fail-soft).
  const meteoEnvasado = await fetchMeteoSnapshot();
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
    let peCreado = false; // <-- track si se acaba de crear (Hallazgo #4)
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
        peCreado = true;
      }
      pe = found;
    }

    // Verificar si el PE tiene receta envasado activa (para sugerir crearla)
    const { rows: [recetaExiste] } = await client.query(
      `SELECT 1 FROM recetas
       WHERE producto_id = $1 AND tipo_receta = 'envasado' AND activa = TRUE
       LIMIT 1`,
      [pe.id]
    );
    const sugerirCrearReceta = !recetaExiste;

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
      // [Hot-fix C-5]: trigger ya gestionó stock_actual desde lotes.
      await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [c.producto_id]);
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
    // [Hot-fix C-5]: trigger ya gestionó stock_actual tras INSERT lote.
    await client.query(`UPDATE productos SET version = version + 1 WHERE id = $1`, [pe.id]);

    await client.query(
      `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
       VALUES ($1, $2, 'produccion_salida', $3, 0, $3, $4, $5, $6)`,
      [pe.id, lotePE.id, calc.totalUnidades, id, userId, `Envasado ${orden.numero_orden}: ${calc.totalUnidades} ud`]
    );

    // Captura de duración: timestamp de apertura del modal de envasar (cliente)
    // — mismo patrón que en fabricación. Si el cliente no lo manda, fecha_inicio
    // queda como NOW() (orden inmediata, duración ≈ 0).
    let fechaInicioEnv: string | null = null;
    if (typeof req.body.fecha_inicio_cliente === 'string' && req.body.fecha_inicio_cliente.trim()) {
      const t = Date.parse(req.body.fecha_inicio_cliente);
      const ahora = Date.now();
      if (!Number.isNaN(t) && t <= ahora + 60_000 && ahora - t < 24 * 3600 * 1000) {
        fechaInicioEnv = new Date(t).toISOString();
      }
    }

    await client.query(
      `UPDATE ordenes_produccion
         SET estado = 'completada',
             cantidad_real_producida = $1,
             lote_producido_id = $2,
             fecha_inicio = COALESCE($4::TIMESTAMPTZ, NOW()),
             fecha_fin = NOW(),
             operario_id = COALESCE($5::UUID, operario_id),
             meteo = COALESCE($6::JSONB, meteo)
       WHERE id = $3`,
      [calc.totalUnidades, lotePE.id, id, fechaInicioEnv, userId, meteoEnvasado ? JSON.stringify(meteoEnvasado) : null]
    );

    await client.query('COMMIT');
    invalidarCacheFinanzas();

    return res.json({
      ok: true,
      producto_envasado: pe.nombre,
      producto_envasado_id: pe.id,
      producto_envasado_creado: peCreado,        // <-- Hallazgo #4
      sugerir_crear_receta: sugerirCrearReceta,  // <-- prompt al frontend
      cola_id: orden.cola_id,
      envase_id: orden.envase_id,
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
         l.lote_interno, l.fecha_caducidad, COALESCE(NULLIF(l.precio_compra, 0), NULLIF(p.coste_medio_actual, 0), p.precio_unitario, 0) AS precio_unitario
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

// ── DOSIFICACIÓN PARCIAL (echadas durante fabricación) ─────────────────────
// Permite registrar echadas parciales de materias primas mientras la orden
// está en curso. Cada echada descuenta stock del lote elegido al instante
// (stock_moves tipo 'produccion_consumo'). El "pendiente" se calcula
// comparando con la cantidad planificada de la receta (ajustada al ratio
// cantidad_planificada / rendimiento).

// GET /api/produccion/:id/dosificaciones — estado por MP (plan/echado/pte) + historial
router.get('/:id/dosificaciones', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: [orden] } = await pool.query(
      `SELECT op.id, op.numero_orden, op.receta_id, op.estado,
              op.cantidad_planificada, r.rendimiento
       FROM ordenes_produccion op
       JOIN recetas r ON r.id = op.receta_id
       WHERE op.id = $1`, [id]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(orden.rendimiento);
    const { rows: ingredientes } = await pool.query(
      `SELECT ir.id AS ingrediente_id, ir.materia_prima_id AS producto_id,
              ir.cantidad AS cantidad_unitaria, ir.porcentaje_merma, ir.unidad_medida,
              p.nombre, p.codigo, p.stock_actual, p.unidad_medida AS producto_unidad,
              p.subcategoria_mp, p.es_aditivo
       FROM ingredientes_receta ir
       JOIN productos p ON p.id = ir.materia_prima_id
       WHERE ir.receta_id = $1
       ORDER BY p.nombre ASC`,
      [orden.receta_id]
    );

    const { rows: dosificaciones } = await pool.query(
      `SELECT d.id, d.producto_id, d.ingrediente_receta_id, d.paso_index, d.lote_id, d.cantidad, d.unidad_medida,
              d.notas, d.created_at, l.lote_interno, u.nombre AS operario_nombre
       FROM dosificaciones_orden d
       LEFT JOIN lotes l ON l.id = d.lote_id
       LEFT JOIN usuarios u ON u.id = d.operario_id
       WHERE d.orden_id = $1
       ORDER BY d.created_at ASC`,
      [id]
    );

    // Agregado por (ingrediente, paso) — el frontend usa esto para
    // redistribuir el sobrante de un paso al siguiente.
    const echadoPorPaso: Record<string, Record<number, number>> = {};
    for (const d of dosificaciones) {
      if (d.ingrediente_receta_id == null || d.paso_index == null) continue;
      const k = d.ingrediente_receta_id;
      if (!echadoPorPaso[k]) echadoPorPaso[k] = {};
      echadoPorPaso[k][d.paso_index] = (echadoPorPaso[k][d.paso_index] ?? 0) + parseFloat(d.cantidad);
    }

    // Echado por fila de receta (clave preferida si está disponible) y por
    // producto como fallback retro-compat.
    const echadoPorIngrediente: Record<string, number> = {};
    const echadoPorProducto: Record<string, number> = {};
    for (const d of dosificaciones) {
      if (d.ingrediente_receta_id) {
        echadoPorIngrediente[d.ingrediente_receta_id] = (echadoPorIngrediente[d.ingrediente_receta_id] ?? 0) + parseFloat(d.cantidad);
      } else {
        echadoPorProducto[d.producto_id] = (echadoPorProducto[d.producto_id] ?? 0) + parseFloat(d.cantidad);
      }
    }

    // Cuántas filas hay del mismo producto (para no doblar el echado huérfano)
    const conteoPorProducto: Record<string, number> = {};
    for (const ing of ingredientes) {
      conteoPorProducto[ing.producto_id] = (conteoPorProducto[ing.producto_id] ?? 0) + 1;
    }
    const items = ingredientes.map((ing: any) => {
      const planificado = parseFloat(ing.cantidad_unitaria) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
      // Echado de esta fila: el directo (clave preferida) o fallback por
      // producto solo si hay UNA única fila del producto (compat antiguo).
      const echadoIng = echadoPorIngrediente[ing.ingrediente_id];
      const huerfanoProd = (conteoPorProducto[ing.producto_id] ?? 0) === 1 ? echadoPorProducto[ing.producto_id] : undefined;
      const echado = echadoIng ?? huerfanoProd ?? 0;
      return {
        ingrediente_id: ing.ingrediente_id,
        producto_id: ing.producto_id,
        nombre: ing.nombre,
        codigo: ing.codigo,
        subcategoria_mp: ing.subcategoria_mp,
        es_aditivo: ing.es_aditivo,
        unidad_medida: ing.unidad_medida ?? ing.producto_unidad,
        planificado: +planificado.toFixed(6),
        echado: +echado.toFixed(6),
        pendiente: +Math.max(0, planificado - echado).toFixed(6),
        stock_actual: parseFloat(ing.stock_actual ?? '0'),
      };
    });

    return res.json({
      orden: { id: orden.id, numero_orden: orden.numero_orden, estado: orden.estado },
      items,
      dosificaciones,
      echadoPorPaso,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al cargar dosificaciones.' });
  }
});

// POST /api/produccion/:id/dosificar — registra una echada parcial + descuenta stock
// POST /api/produccion/:id/revisar-lotes — admin firma la revisión pre-fabricación.
// Persiste el override de lotes elegido por el admin para que cualquier operario
// que abra después la OF entre directo a producción con los mismos lotes.
router.post('/:id/revisar-lotes', async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'No autenticado' });
    if (user.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede firmar la revisión' });

    const override = req.body?.lotes_override ?? null;
    if (override !== null && !Array.isArray(override)) {
      return res.status(400).json({ error: 'lotes_override debe ser un array' });
    }

    const { rowCount, rows: [orden] } = await pool.query(
      `UPDATE ordenes_produccion
          SET lotes_revisados_at = NOW(),
              lotes_revisados_por_id = $2,
              lotes_override = $3::jsonb
        WHERE id = $1
        RETURNING id, lotes_revisados_at, lotes_revisados_por_id, lotes_override`,
      [id, user.id, override ? JSON.stringify(override) : null]
    );
    if (!rowCount) return res.status(404).json({ error: 'Orden no encontrada' });
    // Auditoría · firma de revisión pre-fabricación
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'FIRMA_REVISION_OF', 'ordenes_produccion', $2, $3)`,
      [user.id, id, `Revisión pre-fabricación firmada${override ? ` · ${override.length} ingrediente(s) con lote forzado` : ''}`]
    ).catch(() => undefined);
    return res.json(orden);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── Confirmaciones manuales de ingredientes (source-of-truth en BD) ────────
// El estado de "ingrediente confirmado" sobrevive a recargas, cambios de
// operario y restarts del servidor. Reemplaza el localStorage volátil.

// GET /api/produccion/:id/confirmaciones
// Devuelve array con { ingrediente_receta_id, paso_index, confirmado_at, … }.
// El paso_index hace que el checklist de cada paso sea independiente: el mismo
// ingrediente puede aparecer en paso 1 y paso 2 sin compartir estado.
router.get('/:id/confirmaciones', async (req, res) => {
  try {
    const { rows } = await pool.query<{ ingrediente_receta_id: string; paso_index: number; confirmado_at: string; confirmado_por_nombre: string | null }>(
      `SELECT c.ingrediente_receta_id, c.paso_index, c.confirmado_at, u.nombre AS confirmado_por_nombre
       FROM confirmaciones_ingrediente c
       LEFT JOIN usuarios u ON u.id = c.confirmado_por_id
       WHERE c.orden_id = $1
       ORDER BY c.confirmado_at ASC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/produccion/:id/confirmaciones
// Body: { ingrediente_receta_id, paso_index }. paso_index obligatorio para que
// cada paso tenga su propio estado (req. usuario explícito: confirmar paso 1
// no debe marcar el mismo ingrediente en paso 2).
router.post('/:id/confirmaciones', async (req, res) => {
  try {
    const { ingrediente_receta_id, paso_index } = req.body ?? {};
    if (!ingrediente_receta_id) return res.status(400).json({ error: 'ingrediente_receta_id obligatorio' });
    const pasoIdx = Number.isFinite(Number(paso_index)) ? Number(paso_index) : -1;

    const userId = (req as any).user?.id ?? null;
    const { rows: [c] } = await pool.query<{
      orden_id: string; ingrediente_receta_id: string; paso_index: number; confirmado_at: string;
    }>(
      `INSERT INTO confirmaciones_ingrediente (orden_id, ingrediente_receta_id, paso_index, confirmado_por_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (orden_id, ingrediente_receta_id, paso_index) DO UPDATE
         SET confirmado_por_id = COALESCE(confirmaciones_ingrediente.confirmado_por_id, EXCLUDED.confirmado_por_id),
             confirmado_at = confirmaciones_ingrediente.confirmado_at
       RETURNING orden_id, ingrediente_receta_id, paso_index, confirmado_at`,
      [req.params.id, ingrediente_receta_id, pasoIdx, userId]
    );
    return res.json(c);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    return res.status(500).json({ error: msg });
  }
});

// DELETE /api/produccion/:id/confirmaciones — wipe TODAS las confirmaciones
// de la orden (todos los pasos). Útil para reiniciar tras marcar por error.
router.delete('/:id/confirmaciones', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM confirmaciones_ingrediente WHERE orden_id = $1`,
      [req.params.id]
    );
    return res.json({ ok: true, eliminadas: r.rowCount ?? 0 });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/produccion/:id/confirmaciones/:ingId?paso=N
// Deshace una confirmación específica. Si se pasa ?paso=N, borra solo esa
// combinación; si no, borra todas las del ingrediente en cualquier paso.
router.delete('/:id/confirmaciones/:ingId', async (req, res) => {
  try {
    const pasoQ = req.query.paso;
    if (pasoQ != null && pasoQ !== '') {
      const pasoIdx = Number(pasoQ);
      await pool.query(
        `DELETE FROM confirmaciones_ingrediente WHERE orden_id = $1 AND ingrediente_receta_id = $2 AND paso_index = $3`,
        [req.params.id, req.params.ingId, pasoIdx]
      );
    } else {
      await pool.query(
        `DELETE FROM confirmaciones_ingrediente WHERE orden_id = $1 AND ingrediente_receta_id = $2`,
        [req.params.id, req.params.ingId]
      );
    }
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/:id/dosificar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: ordenId } = req.params;
    const { producto_id, lote_id, cantidad, notas, ingrediente_receta_id, paso_index } = req.body ?? {};
    const userId = (req as any).user?.id ?? null;

    const cant = Number(cantidad);
    if (!producto_id || !Number.isFinite(cant) || cant <= 0) {
      return res.status(400).json({ error: 'producto_id y cantidad (>0) son obligatorios' });
    }

    await client.query('BEGIN');

    const { rows: [orden] } = await client.query(
      `SELECT id, numero_orden, estado FROM ordenes_produccion WHERE id = $1 FOR UPDATE`,
      [ordenId]
    );
    if (!orden) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    if (!['borrador', 'confirmada', 'en_proceso'].includes(orden.estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `No se puede dosificar una orden en estado "${orden.estado}".` });
    }

    const { rows: [prod] } = await client.query(
      `SELECT id, nombre, unidad_medida FROM productos WHERE id = $1`,
      [producto_id]
    );
    if (!prod) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Si se indica lote, descontar de ese lote. Si no, FIFO.
    let loteUsado: string | null = null;
    let antes = 0, despues = 0;
    if (lote_id) {
      const { rows: [lote] } = await client.query<{
        id: string; cantidad_actual: string; reservado: string;
      }>(
        `SELECT l.id, l.cantidad_actual,
           COALESCE((SELECT SUM(rs.cantidad) FROM reservas_stock rs
                     WHERE rs.lote_id = l.id AND rs.estado = 'activa'), 0) AS reservado
         FROM lotes l
         WHERE l.id = $1 AND l.producto_id = $2 AND l.estado = 'aprobado'
         FOR UPDATE`,
        [lote_id, producto_id]
      );
      if (!lote) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Lote no encontrado o no aprobado para este producto.' });
      }
      antes = parseFloat(lote.cantidad_actual);
      const reservado = parseFloat(lote.reservado);
      const disponibleReal = antes - reservado;
      if (disponibleReal < cant - 1e-6) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuficiente en lote: disponible ${disponibleReal.toFixed(3)} ${prod.unidad_medida} (lote tiene ${antes.toFixed(3)} pero ${reservado.toFixed(3)} están reservados para pedidos), pedido ${cant.toFixed(3)}.`,
        });
      }
      despues = antes - cant;
      await client.query(`UPDATE lotes SET cantidad_actual = $1 WHERE id = $2`, [despues.toFixed(6), lote.id]);
      loteUsado = lote.id;
      await client.query(
        `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
         VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
        [producto_id, lote.id, (-cant).toFixed(6), antes.toFixed(6), despues.toFixed(6), ordenId, userId, `Dosificación parcial ${orden.numero_orden}`]
      );
    } else {
      // FIFO
      const { rows: lotes } = await client.query(
        `SELECT id, cantidad_actual FROM lotes
         WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`,
        [producto_id]
      );
      let resta = cant;
      for (const l of lotes) {
        if (resta <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, resta);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id = $2`, [usar.toFixed(6), l.id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
           VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
          [producto_id, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6), ordenId, userId, `Dosificación parcial ${orden.numero_orden}`]
        );
        loteUsado = l.id; // último lote tocado (para mostrar en historial; FIFO puede tocar varios)
        resta -= usar;
      }
      if (resta > 1e-6) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Stock insuficiente: faltan ${resta.toFixed(3)} ${prod.unidad_medida}.` });
      }
    }

    const pasoIdx = paso_index != null && !isNaN(Number(paso_index)) ? Number(paso_index) : null;
    const { rows: [dosif] } = await client.query(
      `INSERT INTO dosificaciones_orden
         (orden_id, producto_id, lote_id, cantidad, unidad_medida, operario_id, notas, ingrediente_receta_id, paso_index)
       VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, $7, $8, $9::INT)
       RETURNING *`,
      [ordenId, producto_id, loteUsado, cant.toFixed(6), prod.unidad_medida ?? 'kg', userId, notas?.trim() || null, ingrediente_receta_id ?? null, pasoIdx]
    );

    // Al primera dosificación, marcar orden como en_proceso si estaba confirmada/borrador
    if (orden.estado !== 'en_proceso') {
      await client.query(
        `UPDATE ordenes_produccion SET estado = 'en_proceso', fecha_inicio = COALESCE(fecha_inicio, NOW()) WHERE id = $1`,
        [ordenId]
      );
    }

    await client.query('COMMIT');
    invalidarCacheFinanzas();
    // Auditoría · echada (dosificación parcial)
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'ECHAR_INGREDIENTE', 'ordenes_produccion', $2, $3)`,
      [userId, ordenId,
       `${orden.numero_orden} · ${prod.nombre} → ${cant.toFixed(3)} ${prod.unidad_medida ?? 'kg'}${pasoIdx != null ? ` (paso ${pasoIdx + 1})` : ''}${notas?.trim() ? ` · ${notas.trim().slice(0, 80)}` : ''}`]
    ).catch(() => undefined);
    return res.status(201).json({ ok: true, dosificacion: dosif });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al dosificar.' });
  } finally {
    client.release();
  }
});

// DELETE /api/produccion/:id/dosificar/:dosifId — revertir una echada (devuelve stock al lote)
router.delete('/:id/dosificar/:dosifId', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: ordenId, dosifId } = req.params;
    await client.query('BEGIN');

    // Si la orden ya está completada/cancelada, el consumo final ya descontó
    // el resto y devolver el stock parcial al lote crea kilos fantasma.
    // Solo se puede revertir mientras la orden está en estado mutable.
    const { rows: [orden] } = await client.query<{ estado: string }>(
      `SELECT estado FROM ordenes_produccion WHERE id = $1 FOR UPDATE`,
      [ordenId]
    );
    if (!orden) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    if (!['borrador', 'confirmada', 'en_proceso'].includes(orden.estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `No se puede revertir una echada en una orden "${orden.estado}". Para devolver stock, cancela la orden (revierte todo el consumo de forma coherente).`,
      });
    }

    const { rows: [d] } = await client.query(
      `SELECT id, producto_id, lote_id, cantidad FROM dosificaciones_orden
       WHERE id = $1 AND orden_id = $2 FOR UPDATE`,
      [dosifId, ordenId]
    );
    if (!d) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dosificación no encontrada' });
    }
    const cant = parseFloat(d.cantidad);
    if (d.lote_id) {
      const { rows: [lote] } = await client.query(
        `SELECT cantidad_actual FROM lotes WHERE id = $1 FOR UPDATE`, [d.lote_id]
      );
      const antes = parseFloat(lote?.cantidad_actual ?? '0');
      const despues = antes + cant;
      await client.query(`UPDATE lotes SET cantidad_actual = $1 WHERE id = $2`, [despues.toFixed(6), d.lote_id]);
      await client.query(
        `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
         VALUES ($1, $2, 'ajuste', $3, $4, $5, $6, $7, $8)`,
        [d.producto_id, d.lote_id, cant.toFixed(6), antes.toFixed(6), despues.toFixed(6), ordenId, (req as any).user?.id ?? null, 'Revertir dosificación parcial']
      );
    }
    await client.query(`DELETE FROM dosificaciones_orden WHERE id = $1`, [dosifId]);
    await client.query('COMMIT');
    invalidarCacheFinanzas();
    // Auditoría · reversión echada
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'REVERTIR_ECHADA', 'ordenes_produccion', $2, $3)`,
      [(req as any).user?.id ?? null, ordenId, `Reversión de echada · ${cant.toFixed(3)} unidades devueltas al lote`]
    ).catch(() => undefined);
    return res.json({ ok: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al revertir.' });
  } finally {
    client.release();
  }
});

export default router;
