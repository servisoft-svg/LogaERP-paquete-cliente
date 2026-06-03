import { Request, Response, NextFunction } from 'express';
import { produccionService } from '../services/produccion.service';
import { AppError } from '../lib/AppError';
import { pool, acquireProductLocks } from '../db/pool';
import PDFDocument           from 'pdfkit';
import nodemailer            from 'nodemailer';
import fs                    from 'fs';
import path                  from 'path';
import { invalidarCacheFinanzas } from '../routes/finanzas.routes';
import { alertaService }          from '../services/alerta.service';
import { logger }                 from '../lib/logger';
import { buildEtiquetaL800Pdf }   from '../lib/pdfEtiquetaL800';
import { buildEtiquetaL800Ezpx }  from '../lib/ezpxEtiquetaL800';

export const produccionController = {
  async crear(req: Request, res: Response) {
    try {
      const { receta_id, cantidad_planificada, fecha_planificada, notas, operario_id, cliente, cliente_id, pedido_id } = req.body;

      if (!receta_id || !cantidad_planificada) {
        return res.status(400).json({ error: 'receta_id y cantidad_planificada son obligatorios' });
      }
      if (Number(cantidad_planificada) <= 0) {
        return res.status(400).json({ error: 'cantidad_planificada debe ser > 0' });
      }

      const orden = await produccionService.crearOrden({
        receta_id,
        cantidad_planificada: Number(cantidad_planificada),
        fecha_planificada,
        notas,
        operario_id,
        creado_por_id: (req as any).user?.id,
        cliente,
        cliente_id,
      });

      // Link pedido to production order if provided
      if (pedido_id && orden.id) {
        await pool.query(
          `UPDATE pedidos SET estado = 'en_produccion', orden_produccion_id = $1 WHERE id = $2`,
          [orden.id, pedido_id]
        );
      }

      // Audit
      await pool.query(
        `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
         VALUES ($1, 'CREAR_ORDEN', 'ordenes_produccion', $2, $3)`,
        [(req as any).user?.id ?? null, orden.id, `Orden ${orden.numero_orden} creada${cliente ? ' para ' + cliente : ''}`]
      );

      return res.status(201).json(orden);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },

  async editar(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { cantidad_planificada, fecha_planificada, notas, cliente, cliente_id } = req.body;
      const { rows: [orden] } = await pool.query(
        `UPDATE ordenes_produccion SET
           cantidad_planificada = COALESCE($1::NUMERIC, cantidad_planificada),
           fecha_planificada = COALESCE($2, fecha_planificada),
           notas = COALESCE($3, notas),
           cliente = COALESCE($4, cliente),
           cliente_id = COALESCE($5, cliente_id)
         WHERE id = $6 AND estado IN ('borrador', 'confirmada')
         RETURNING *`,
        [cantidad_planificada ?? null, fecha_planificada ?? null, notas ?? null, cliente ?? null, cliente_id ?? null, id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada o no editable' });
      return res.json(orden);
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  async confirmar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const usuario_id: string | undefined = (req as any).user?.id;

      // Parse QC values — use explicit null check to allow pH=0, solidos=0, viscosidad=0
      const ph = req.body.ph != null && req.body.ph !== '' ? parseFloat(req.body.ph) : undefined;
      const solidos = req.body.solidos != null && req.body.solidos !== '' ? parseFloat(req.body.solidos) : undefined;
      const viscosidad = req.body.viscosidad != null && req.body.viscosidad !== '' ? parseFloat(req.body.viscosidad) : undefined;
      const fecha_fabricacion = req.body.fecha_fabricacion || undefined;
      const cantidad_real_producida = req.body.cantidad_real_producida != null && req.body.cantidad_real_producida !== '' ? parseFloat(req.body.cantidad_real_producida) : undefined;

      const files = (req as Request & { files?: Express.Multer.File[] }).files ?? [];
      const foto_urls = files.map(f => `/uploads/${f.filename}`);
      const foto_url = foto_urls[0] ?? undefined;

      const registro_limpieza = typeof req.body.registro_limpieza === 'string' && req.body.registro_limpieza.trim() ? req.body.registro_limpieza.trim() : undefined;

      // Captura de duración: timestamp de apertura del modal de fabricación (cliente)
      let fecha_inicio_cliente: string | undefined;
      if (typeof req.body.fecha_inicio_cliente === 'string' && req.body.fecha_inicio_cliente.trim()) {
        const t = Date.parse(req.body.fecha_inicio_cliente);
        const ahora = Date.now();
        // Solo aceptar si parsea, no es futuro y no más viejo que 24h
        if (!Number.isNaN(t) && t <= ahora + 60_000 && ahora - t < 24 * 3600 * 1000) {
          fecha_inicio_cliente = new Date(t).toISOString();
        }
      }

      // ── Load recipe config for QC enforcement ──
      const { rows: [ordenCheck] } = await pool.query(
        `SELECT r.ph_min, r.ph_max, r.solidos_min, r.solidos_max, r.viscosidad_min, r.viscosidad_max, r.pasos
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         WHERE op.id = $1`,
        [id]
      );

      // ── MANDATORY QC: if recipe defines ranges, values are required ──
      if (ordenCheck) {
        const qcRequired = ordenCheck.ph_min != null || ordenCheck.solidos_min != null || ordenCheck.viscosidad_min != null;
        if (qcRequired) {
          const missing: string[] = [];
          if (ordenCheck.ph_min != null && ph == null) missing.push('pH');
          if (ordenCheck.solidos_min != null && solidos == null) missing.push('Sólidos %');
          if (ordenCheck.viscosidad_min != null && viscosidad == null) missing.push('Viscosidad');
          if (missing.length > 0) {
            return res.status(400).json({
              error: 'QC_OBLIGATORIO',
              mensaje: `Control de calidad obligatorio. Faltan: ${missing.join(', ')}`,
              campos_faltantes: missing,
            });
          }
        }

        // ── MANDATORY LIMPIEZA: if recipe has a Limpieza step, registro is required ──
        const pasos: { fase?: string }[] = Array.isArray(ordenCheck.pasos) ? ordenCheck.pasos : [];
        const requiereLimpieza = pasos.some(p => p.fase?.toLowerCase() === 'limpieza');
        if (requiereLimpieza && !registro_limpieza) {
          return res.status(400).json({
            error: 'LIMPIEZA_OBLIGATORIA',
            mensaje: 'El registro de limpieza es obligatorio para esta receta. Indica el agente, volumen y destino del residuo.',
          });
        }
      }

      // ── QC Validation: compare values against recipe ranges ──
      let qc_fuera_de_rango = false;
      const qc_desviaciones: string[] = [];

      if (ordenCheck) {
        if (ph != null && ordenCheck.ph_min != null && ordenCheck.ph_max != null) {
          if (ph < parseFloat(ordenCheck.ph_min) || ph > parseFloat(ordenCheck.ph_max)) {
            qc_fuera_de_rango = true;
            qc_desviaciones.push(`pH ${ph} fuera de rango [${ordenCheck.ph_min}-${ordenCheck.ph_max}]`);
          }
        }
        if (solidos != null && ordenCheck.solidos_min != null && ordenCheck.solidos_max != null) {
          if (solidos < parseFloat(ordenCheck.solidos_min) || solidos > parseFloat(ordenCheck.solidos_max)) {
            qc_fuera_de_rango = true;
            qc_desviaciones.push(`Sólidos ${solidos}% fuera de rango [${ordenCheck.solidos_min}-${ordenCheck.solidos_max}]%`);
          }
        }
        if (viscosidad != null && ordenCheck.viscosidad_min != null && ordenCheck.viscosidad_max != null) {
          if (viscosidad < parseFloat(ordenCheck.viscosidad_min) || viscosidad > parseFloat(ordenCheck.viscosidad_max)) {
            qc_fuera_de_rango = true;
            qc_desviaciones.push(`Viscosidad ${viscosidad} fuera de rango [${ordenCheck.viscosidad_min}-${ordenCheck.viscosidad_max}]`);
          }
        }
      }

      // Build QC annotation note (passed to service, saved inside transaction)
      const nota_qc = qc_fuera_de_rango
        ? `Lote desviado de parámetros de calidad: ${qc_desviaciones.join('; ')}. Lote creado en CUARENTENA.`
        : undefined;

      // Parse ingredientes_ajustados (override de cantidades reales por el operario).
      // Llega como string JSON (multipart) o array (json). Validar formato y filtrar
      // entradas inválidas — silenciosamente, para no romper la fabricación.
      let ingredientes_ajustados: { materia_prima_id: string; cantidad: number }[] | undefined;
      try {
        const raw = req.body.ingredientes_ajustados;
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) {
          ingredientes_ajustados = arr
            .filter((x: unknown): x is { materia_prima_id: string; cantidad: number | string } =>
              !!x && typeof x === 'object' && 'materia_prima_id' in x && 'cantidad' in x
            )
            .map(x => ({ materia_prima_id: String(x.materia_prima_id), cantidad: Number(x.cantidad) }))
            .filter(x => x.materia_prima_id.length > 0 && Number.isFinite(x.cantidad) && x.cantidad >= 0);
          if (ingredientes_ajustados.length === 0) ingredientes_ajustados = undefined;
        }
      } catch { /* JSON malformado → ignorar ajustes, no romper */ }

      // Parse lotes_override: por materia prima, lista de {lote_id, cantidad}
      let lotes_override: { materia_prima_id: string; lotes: { lote_id: string; cantidad: number }[] }[] | undefined;
      try {
        const raw = req.body.lotes_override;
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) {
          lotes_override = arr
            .filter((x: any) => x && typeof x === 'object' && x.materia_prima_id && Array.isArray(x.lotes))
            .map((x: any) => ({
              materia_prima_id: String(x.materia_prima_id),
              lotes: x.lotes
                .filter((l: any) => l && l.lote_id && Number(l.cantidad) > 0)
                .map((l: any) => ({ lote_id: String(l.lote_id), cantidad: Number(l.cantidad) })),
            }))
            .filter((x: any) => x.lotes.length > 0);
          if (lotes_override && lotes_override.length === 0) lotes_override = undefined;
        }
      } catch { /* ignorar */ }

      // ── Everything passed to service runs inside a single SERIALIZABLE transaction ──
      const resultado = await produccionService.confirmarOrden(id, usuario_id, {
        ph, foto_url, foto_urls, solidos, viscosidad, fecha_fabricacion, cantidad_real_producida,
        qc_fuera_de_rango, registro_limpieza, nota_qc, fecha_inicio_cliente,
        ingredientes_ajustados,
        lotes_override,
      });

      // Post-transaction: only non-critical operations (cache + async alerts)
      invalidarCacheFinanzas();
      alertaService.checkStockMinimo().catch(() => {});

      return res.status(200).json({
        ...resultado,
        qc_fuera_de_rango,
        qc_desviaciones,
        lote_estado: qc_fuera_de_rango ? 'cuarentena' : 'aprobado',
      });
    } catch (err: unknown) {
      // El service tira Error('CODIGO[:detalle]'). El errorHandler global mapea
      // CODIGO al catálogo si existe. Aquí solo enriquecemos los detalles antes
      // de delegar, para que el cliente reciba info estructurada del faltante.
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('STOCK_INSUFICIENTE')) {
        const partes = msg.split(':');
        return next(new AppError(
          'STOCK_INSUFICIENTE',
          'No hay suficiente stock de materias primas. La operación fue cancelada completamente.',
          {
            ingrediente: partes[1] ?? null,
            necesario: partes[2]?.split('=')[1] ?? null,
            disponible: partes[3]?.split('=')[1] ?? null,
            raw: msg,
          }
        ));
      }
      return next(err);
    }
  },

  async listar(req: Request, res: Response) {
    try {
      const { estado, limit, offset } = req.query;
      const result = await produccionService.listarOrdenes({
        estado: estado ? String(estado) : undefined,
        limit:  limit  ? parseInt(String(limit), 10)  : undefined,
        offset: offset ? parseInt(String(offset), 10) : undefined,
      });
      return res.json(result.rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },

  // GET /api/produccion/:id/trazabilidad.pdf  (?sin_costes=1 oculta sección de coste para envío al cliente)
  async trazabilidadPdf(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const sinCostes = req.query.sin_costes === '1' || req.query.sin_costes === 'true';

      const { rows: [orden] } = await pool.query(
        `SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre,
                p.codigo AS producto_codigo, p.unidad_medida
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      const { rows: consumos } = await pool.query(
        `SELECT sm.tipo, sm.cantidad, sm.created_at,
                p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
                COALESCE(NULLIF(l.precio_compra, 0), NULLIF(p.coste_medio_actual, 0), p.precio_unitario, 0) AS precio_unitario,
                l.lote_interno, l.lote_proveedor, l.fecha_caducidad, l.precio_compra
         FROM stock_moves sm
         JOIN productos p ON p.id = sm.producto_id
         LEFT JOIN lotes l ON l.id = sm.lote_id
         WHERE sm.orden_id = $1
         ORDER BY sm.tipo DESC, p.nombre ASC, sm.created_at ASC`,
        [id]
      );

      const pt = consumos.filter((c: {tipo:string}) => c.tipo === 'produccion_salida');
      const mp = consumos.filter((c: {tipo:string}) => c.tipo !== 'produccion_salida');

      const mpMap = new Map<string, typeof mp>();
      for (const c of mp) {
        if (!mpMap.has(c.producto_codigo)) mpMap.set(c.producto_codigo, []);
        mpMap.get(c.producto_codigo)!.push(c);
      }

      // ── COLORES LOGA ──────────────────────────────────────────
      const RED      = '#E8001C'; // rojo corporativo Loga
      const RED_LIGHT= '#FFF0F2'; // fondo suave filas alternas
      const RED_MID  = '#FFCCD3'; // cabecera subtabla MP
      const WHITE    = '#FFFFFF';
      const DARK     = '#1A1A1A';
      const GRAY     = '#6B7280';
      const LGRAY    = '#F9FAFB';
      const BORDER   = '#E5E7EB';
      const GREEN     = '#15803D';
      const GREEN_LIGHT = '#F0FDF4';
      const W        = 495;

      const doc = new PDFDocument({ margin: 0, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="trazabilidad-${orden.numero_orden}.pdf"`);
      doc.pipe(res);

      const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo-real.png');
      const hasLogo   = fs.existsSync(LOGO_PATH);

      // Datos empresa desde config
      const { rows: [cfgEmp] } = await pool.query(`SELECT empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono FROM configuracion_global WHERE id = 1`);
      const EMPRESA = cfgEmp?.empresa_nombre || 'Colas Loga';

      // ── CABECERA: fondo rojo completo ────────────────────────
      const HDR_H = 120;
      doc.rect(0, 0, 595, HDR_H).fill(RED);

      // Logo: caja blanca grande y centrada verticalmente
      const LOGO_BOX = 100;
      const LOGO_X   = 20;
      const LOGO_Y   = (HDR_H - LOGO_BOX) / 2;
      doc.roundedRect(LOGO_X, LOGO_Y, LOGO_BOX, LOGO_BOX, 10).fill(WHITE);
      if (hasLogo) {
        try { doc.image(LOGO_PATH, LOGO_X + 2, LOGO_Y + 2, { fit: [LOGO_BOX - 4, LOGO_BOX - 4] }); } catch { /* skip */ }
      }

      // Línea vertical blanca separadora
      const SEP_X = LOGO_X + LOGO_BOX + 12;
      doc.fillOpacity(1).rect(SEP_X, 16, 2, HDR_H - 32).fill(WHITE);

      // Nombre empresa
      const TXT_X = SEP_X + 12;
      doc.fillColor(WHITE).fontSize(26).font('Helvetica-Bold')
         .text(EMPRESA.toUpperCase(), TXT_X, 22);
      doc.fillColor(WHITE).fontSize(10).font('Helvetica')
         .text('', TXT_X, 55);
      doc.fillColor(WHITE).fontSize(8).font('Helvetica')
         .text('CERTIFICADO DE TRAZABILIDAD DE PRODUCCION', TXT_X, 70);

      // Número orden + fecha — derecha
      doc.fillColor(WHITE).fontSize(18).font('Helvetica-Bold')
         .text(orden.numero_orden, 320, 22, { align: 'right', width: 255 });
      doc.fillColor(WHITE).fontSize(8.5).font('Helvetica')
         .text(`Emitido: ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`, 320, 55, { align: 'right', width: 255 });
      if (orden.estado === 'completada') {
        doc.roundedRect(390, 72, 185, 22, 5).fill(WHITE);
        doc.fillColor(RED).fontSize(8.5).font('Helvetica-Bold')
           .text('PRODUCCION COMPLETADA', 392, 78, { width: 181, align: 'center' });
      }

      // Franja blanca inferior cabecera (4px)
      doc.fillOpacity(1).rect(0, HDR_H, 595, 4).fill(WHITE);

      let y = HDR_H + 18;
      const L = 50; // margen izquierdo

      // Helper: título de sección
      const sectionHeader = (label: string, color: string = RED) => {
        if (y > 720) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
        doc.rect(L, y, W, 18).fill(color);
        doc.fillColor(WHITE).fontSize(8.5).font('Helvetica-Bold')
           .text(label, L + 8, y + 5);
        y += 22;
      };

      // Helper: fila datos clave/valor
      const dataRow = (label: string, value: string, idx: number) => {
        const bg = idx % 2 === 0 ? LGRAY : WHITE;
        doc.rect(L, y, W, 17).fill(bg).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').text(label, L + 8, y + 5);
        doc.fillColor(DARK).fontSize(8).font('Helvetica-Bold').text(value, L + 160, y + 5, { width: W - 168 });
        y += 17;
      };

      // ── SECCIÓN: DATOS DE FABRICACIÓN ────────────────────────
      sectionHeader('DATOS DE LA FABRICACIÓN');

      const filas: [string, string][] = [
        ['Producto',           `${orden.producto_nombre}  (${orden.producto_codigo})`],
        ['Receta',             orden.receta_nombre],
        ['Cantidad producida', `${parseFloat(orden.cantidad_producida ?? 0).toFixed(3)} ${orden.unidad_medida}`],
        ['Estado',             orden.estado.replace('_', ' ').toUpperCase()],
      ];
      if (orden.cliente)           filas.push(['Cliente',            orden.cliente]);
      if (orden.fecha_planificada) filas.push(['Fecha planificada',  new Date(orden.fecha_planificada).toLocaleDateString('es-ES')]);
      if (orden.fecha_inicio)      filas.push(['Inicio fabricación', new Date(orden.fecha_inicio).toLocaleString('es-ES')]);
      if (orden.fecha_fin)         filas.push(['Fin fabricación',    new Date(orden.fecha_fin).toLocaleString('es-ES')]);
      if (orden.fecha_fabricacion) filas.push(['Fecha fabricacion',  new Date(orden.fecha_fabricacion).toLocaleString('es-ES')]);
      if (orden.ph != null)        filas.push(['pH medido',          String(orden.ph)]);
      if (orden.solidos != null)   filas.push(['% Solidos',          `${orden.solidos}%`]);
      if (orden.viscosidad != null) filas.push(['Viscosidad',        `${orden.viscosidad} mPa-s`]);
      if (orden.notas)             filas.push(['Notas',              orden.notas]);
      if (orden.registro_limpieza) filas.push(['Limpieza / Medioambiente', orden.registro_limpieza]);

      filas.forEach(([k, v], i) => dataRow(k, v, i));
      y += 12;

      // ── SECCIÓN: PRODUCTO TERMINADO ───────────────────────────
      if (pt.length > 0) {
        sectionHeader('LOTE DE PRODUCTO TERMINADO', GREEN);

        const cols  = [190, 130, 100, 75];
        const heads = ['Producto', 'Lote interno', 'Cantidad', 'Fecha'];
        // cabecera subTabla
        doc.rect(L, y, W, 15).fill(GREEN_LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
        let x = L;
        heads.forEach((h, i) => {
          doc.fillColor(GREEN).fontSize(7).font('Helvetica-Bold').text(h, x + 4, y + 4, { width: cols[i] });
          x += cols[i];
        });
        y += 15;

        for (const c of pt) {
          doc.rect(L, y, W, 17).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
          x = L;
          const vals = [
            c.producto_nombre,
            c.lote_interno ?? '—',
            `${parseFloat(c.cantidad).toFixed(3)} ${c.unidad_medida}`,
            new Date(c.created_at).toLocaleDateString('es-ES'),
          ];
          vals.forEach((v, i) => {
            doc.fillColor(DARK).fontSize(7.5).font('Helvetica').text(v, x + 4, y + 5, { width: cols[i] - 4 });
            x += cols[i];
          });
          y += 17;
        }
        y += 12;
      }

      // ── SECCIÓN: MATERIAS PRIMAS ──────────────────────────────
      if (y > 680) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
      sectionHeader('MATERIAS PRIMAS CONSUMIDAS');

      const mpCols  = [175, 148, 82, 90];
      const mpHeads = ['Materia Prima', 'Lote / Ref. Proveedor', 'Caducidad', 'Cantidad'];
      doc.rect(L, y, W, 15).fill(RED_MID).strokeColor(BORDER).lineWidth(0.5).stroke();
      let mx = L;
      mpHeads.forEach((h, i) => {
        doc.fillColor(RED).fontSize(7).font('Helvetica-Bold').text(h, mx + 4, y + 4, { width: mpCols[i] });
        mx += mpCols[i];
      });
      y += 15;

      let rowIdx = 0;
      for (const [, lotes] of mpMap.entries()) {
        const total     = lotes.reduce((s: number, c: {cantidad: string}) => s + Math.abs(parseFloat(c.cantidad)), 0);
        const multiLote = lotes.length > 1;
        if (y > 740) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }

        for (let li = 0; li < lotes.length; li++) {
          const c    = lotes[li];
          const bg   = rowIdx % 2 === 0 ? LGRAY : WHITE;
          doc.rect(L, y, W, 17).fill(bg).strokeColor(BORDER).lineWidth(0.5).stroke();
          mx = L;

          if (li === 0) {
            doc.fillColor(DARK).fontSize(7.5).font('Helvetica-Bold')
               .text(c.producto_nombre, mx + 4, y + 5, { width: mpCols[0] - 4 });
          }
          mx += mpCols[0];

          const loteStr = [c.lote_interno, c.lote_proveedor].filter(Boolean).join(' / ') || '—';
          doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
             .text(loteStr, mx + 4, y + 5, { width: mpCols[1] - 4 });
          mx += mpCols[1];

          doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
             .text(c.fecha_caducidad ? new Date(c.fecha_caducidad).toLocaleDateString('es-ES') : '—', mx + 4, y + 5, { width: mpCols[2] });
          mx += mpCols[2];

          doc.fillColor(RED).fontSize(7.5).font('Helvetica-Bold')
             .text(`${Math.abs(parseFloat(c.cantidad)).toFixed(3)} ${c.unidad_medida}`, mx + 4, y + 5, { width: mpCols[3] });
          y += 17;
        }

        if (multiLote) {
          doc.rect(L, y, W, 14).fill(RED_LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
          mx = L + mpCols[0] + mpCols[1] + mpCols[2];
          doc.fillColor(GRAY).fontSize(7).font('Helvetica')
             .text('TOTAL:', mx - 48, y + 3, { width: 44, align: 'right' });
          doc.fillColor(RED).fontSize(8).font('Helvetica-Bold')
             .text(`${total.toFixed(3)} ${lotes[0].unidad_medida}`, mx + 4, y + 3, { width: mpCols[3] });
          y += 14;
        }
        rowIdx++;
      }
      y += 14;

      // ── SECCIÓN: COSTE DE PRODUCCIÓN ────────────────────────
      // Omitida cuando ?sin_costes=1 (envío al cliente: solo trazabilidad de
      // materias primas y lotes consumidos, sin información económica).
      if (!sinCostes) {
        const BLUE      = '#1D4ED8';
        const BLUE_LIGHT= '#EFF6FF';
        const costRows: { nombre: string; cantidad: number; unidad: string; precio: number; subtotal: number }[] = [];
        let costTotal = 0;
        for (const [, lotes] of mpMap.entries()) {
          const totalQty = lotes.reduce((s: number, c: { cantidad: string }) => s + Math.abs(parseFloat(c.cantidad)), 0);
          const precio   = parseFloat(lotes[0].precio_unitario ?? '0');
          const sub      = totalQty * precio;
          costRows.push({ nombre: lotes[0].producto_nombre, cantidad: totalQty, unidad: lotes[0].unidad_medida, precio, subtotal: sub });
          costTotal += sub;
        }

        if (y > 680) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
        sectionHeader('COSTE DE PRODUCCION', BLUE);

        const cCols  = [200, 90, 90, 115];
        const cHeads = ['Ingrediente', 'Cantidad', 'Precio unit.', 'Subtotal'];
        doc.rect(L, y, W, 15).fill(BLUE_LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
        let cx = L;
        cHeads.forEach((h, i) => {
          doc.fillColor(BLUE).fontSize(7).font('Helvetica-Bold').text(h, cx + 4, y + 4, { width: cCols[i] });
          cx += cCols[i];
        });
        y += 15;

        costRows.forEach((r, ri) => {
          if (y > 740) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
          const bg = ri % 2 === 0 ? LGRAY : WHITE;
          doc.rect(L, y, W, 17).fill(bg).strokeColor(BORDER).lineWidth(0.5).stroke();
          cx = L;
          const vals = [
            r.nombre,
            `${r.cantidad.toFixed(3)} ${r.unidad}`,
            `${r.precio.toFixed(4)} EUR/${r.unidad}`,
            `${r.subtotal.toFixed(2)} EUR`,
          ];
          vals.forEach((v, i) => {
            doc.fillColor(i === 3 ? BLUE : DARK).fontSize(7.5).font(i === 3 ? 'Helvetica-Bold' : 'Helvetica')
               .text(v, cx + 4, y + 5, { width: cCols[i] - 4 });
            cx += cCols[i];
          });
          y += 17;
        });

        // Total row
        doc.rect(L, y, W, 20).fill(BLUE).strokeColor(BLUE).lineWidth(0.5).stroke();
        doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
           .text('COSTE TOTAL', L + 8, y + 5);
        doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold')
           .text(`${costTotal.toFixed(2)} EUR`, L + cCols[0] + cCols[1] + cCols[2] + 4, y + 4, { width: cCols[3] - 4 });
        y += 24;
      }
      y += 10;

      // ── SECCIÓN: FOTOGRAFÍAS DEL LOTE ────────────────────────
      const allFotos: string[] = [];
      if (orden.foto_urls && Array.isArray(orden.foto_urls)) {
        allFotos.push(...orden.foto_urls);
      } else if (orden.foto_url) {
        allFotos.push(orden.foto_url);
      }

      const validFotos = allFotos
        .map(u => path.join(process.cwd(), u.replace(/^\//, '')))
        .filter(p => fs.existsSync(p));

      if (validFotos.length > 0) {
        if (y > 560) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
        sectionHeader(validFotos.length === 1 ? 'FOTOGRAFIA DEL LOTE' : `FOTOGRAFIAS DEL LOTE (${validFotos.length})`);
        for (const fotoPath of validFotos) {
          if (y > 560) { doc.addPage(); y = 30; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
          try {
            const fotoW = Math.min(W, 300);
            const fotoX = L + (W - fotoW) / 2;
            doc.rect(fotoX - 3, y - 3, fotoW + 6, 206).fill(LGRAY).strokeColor(BORDER).lineWidth(1).stroke();
            doc.image(fotoPath, fotoX, y, { fit: [fotoW, 200] });
            y += 215;
          } catch { /* imagen no legible */ }
        }
      }

      // ── PIE DE PÁGINA ─────────────────────────────────────────
      // Línea roja
      const PIE_Y = 818;
      doc.rect(0, PIE_Y - 4, 595, 3).fill(RED);
      doc.fillColor(GRAY).fontSize(7).font('Helvetica')
         .text(
           `  ·  ${new Date().toLocaleString('es-ES')}  ·  ${orden.numero_orden}  ·  Fábrica de Adhesivos Vinílicos Loga®`,
           L, PIE_Y + 4, { align: 'center', width: W }
         );

      doc.end();
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  // GET /api/produccion/:id/detalle
  // Devuelve la orden + consumos por lote de cada materia prima
  async detalle(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const { rows: [orden] } = await pool.query(
        `SELECT op.*, r.nombre AS receta_nombre,
                COALESCE(pe.nombre, p.nombre) AS producto_nombre,
                COALESCE(pe.codigo, p.codigo) AS producto_codigo,
                COALESCE(pe.unidad_medida, p.unidad_medida) AS unidad_medida,
                u.nombre AS operario_nombre, u.rol AS operario_rol,
                CASE
                  WHEN op.fecha_inicio IS NOT NULL AND op.fecha_fin IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (op.fecha_fin - op.fecha_inicio))::INT
                  ELSE NULL
                END AS duracion_segundos,
                -- Media histórica de duración de esta receta:
                -- todas las órdenes completadas de la MISMA receta con fecha_inicio
                -- y fecha_fin válidas y duración > 30s (filtra envasados rápidos / órdenes
                -- pre-feature que tienen fecha_inicio = fecha_fin = NOW()).
                (SELECT AVG(EXTRACT(EPOCH FROM (fecha_fin - fecha_inicio)))::INT
                 FROM ordenes_produccion
                 WHERE receta_id = op.receta_id
                   AND estado = 'completada'
                   AND fecha_inicio IS NOT NULL
                   AND fecha_fin IS NOT NULL
                   AND fecha_fin - fecha_inicio > INTERVAL '5 seconds'
                ) AS media_duracion_receta_segundos,
                (SELECT COUNT(*)::INT
                 FROM ordenes_produccion
                 WHERE receta_id = op.receta_id
                   AND estado = 'completada'
                   AND fecha_inicio IS NOT NULL
                   AND fecha_fin IS NOT NULL
                   AND fecha_fin - fecha_inicio > INTERVAL '5 seconds'
                ) AS num_ordenes_media
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         LEFT JOIN productos pe ON pe.id = op.producto_envasado_id
         LEFT JOIN usuarios u ON u.id = op.operario_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      // Solo admin ve quién la hizo y cuánto tardó. Operario recibe el resto
      // del detalle igual pero sin esos campos. Defensa server-side: aunque el
      // frontend filtre, un operario inspeccionando Network no verá los datos.
      const userRol = (req as any).user?.rol;
      if (userRol !== 'admin') {
        delete (orden as any).operario_id;
        delete (orden as any).operario_nombre;
        delete (orden as any).operario_rol;
        delete (orden as any).duracion_segundos;
        delete (orden as any).media_duracion_receta_segundos;
        delete (orden as any).num_ordenes_media;
      }

      // Consumos por materia prima + lote (usa precio_compra del lote si existe, si no precio del producto)
      const { rows: consumos } = await pool.query(
        `SELECT
           sm.id, sm.tipo, sm.cantidad, sm.cantidad_antes, sm.cantidad_despues,
           sm.created_at, sm.lote_id,
           p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida, p.tipo AS producto_tipo,
           COALESCE(NULLIF(l.precio_compra, 0), NULLIF(p.coste_medio_actual, 0), p.precio_unitario, 0) AS precio_unitario,
           l.lote_interno, l.lote_proveedor, l.fecha_caducidad, l.precio_compra
         FROM stock_moves sm
         JOIN productos p ON p.id = sm.producto_id
         LEFT JOIN lotes l ON l.id = sm.lote_id
         WHERE sm.orden_id = $1
         ORDER BY sm.tipo DESC, p.nombre ASC, sm.created_at ASC`,
        [id]
      );

      // Calcular coste total: usa precio del lote si existe, si no precio del producto
      const coste_total = consumos
        .filter((c: { tipo: string }) => c.tipo === 'produccion_consumo')
        .reduce((sum: number, c: { cantidad: string; precio_unitario: string | null }) => {
          const qty = Math.abs(parseFloat(c.cantidad));
          const precio = parseFloat(c.precio_unitario ?? '0');
          return sum + qty * precio;
        }, 0);

      return res.json({ orden, consumos, coste_total });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  // GET/POST /api/produccion/:id/receta.pdf — PDF minimalista con receta paso a paso.
  // POST acepta body { ajustes: { [materia_prima_id]: cantidad_kg } } para reflejar
  // cantidades modificadas por el operario en el modal de fabricación.
  async recetaPdf(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const ajustes: Record<string, number> = (req.body?.ajustes && typeof req.body.ajustes === 'object')
        ? req.body.ajustes : {};

      // Datos orden + receta + producto
      const { rows: [orden] } = await pool.query(
        `SELECT op.id, op.numero_orden, op.cantidad_planificada, op.fecha_planificada, op.notas,
                r.id AS receta_id, r.nombre AS receta_nombre, r.rendimiento,
                r.ph_min, r.ph_max, r.solidos_min, r.solidos_max,
                r.viscosidad_min, r.viscosidad_max, r.pasos,
                p.id AS producto_id, p.codigo AS producto_codigo, p.nombre AS producto_nombre,
                p.unidad_medida
         FROM ordenes_produccion op
         JOIN recetas r  ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      // Ingredientes con cantidad escalada según cantidad_planificada / rendimiento
      const factor = parseFloat(orden.cantidad_planificada) / parseFloat(orden.rendimiento ?? '1');
      const { rows: ingredientes } = await pool.query(
        `SELECT ir.id, ir.materia_prima_id, ir.cantidad, ir.porcentaje_merma, ir.unidad_medida,
                p.codigo AS mp_codigo, p.nombre AS mp_nombre
         FROM ingredientes_receta ir
         JOIN productos p ON p.id = ir.materia_prima_id
         WHERE ir.receta_id = $1
         ORDER BY p.nombre`,
        [orden.receta_id]
      );

      // Últimos lotes producidos del mismo producto (histórico QC)
      const { rows: ultimosQC } = await pool.query(
        `SELECT lote_interno, created_at, solidos, ph, viscosidad
         FROM lotes
         WHERE producto_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [orden.producto_id]
      );

      // Lotes FEFO disponibles por materia prima (aprobados, con stock).
      // Sirve para sugerir al operario cuáles usar y en qué orden.
      const ingIds = ingredientes.map((i: { materia_prima_id: string }) => i.materia_prima_id);
      const lotesFefo = new Map<string, { lote_interno: string; cantidad_actual: string; fecha_caducidad: string | null }[]>();
      if (ingIds.length > 0) {
        const { rows: lotes } = await pool.query(
          `SELECT producto_id, lote_interno, cantidad_actual, fecha_caducidad
           FROM lotes
           WHERE producto_id = ANY($1::uuid[])
             AND estado = 'aprobado' AND cantidad_actual > 0
           ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC`,
          [ingIds]
        );
        for (const l of lotes) {
          const arr = lotesFefo.get(l.producto_id) ?? [];
          arr.push({ lote_interno: l.lote_interno, cantidad_actual: l.cantidad_actual, fecha_caducidad: l.fecha_caducidad });
          lotesFefo.set(l.producto_id, arr);
        }
      }

      // Pasos: array JSONB con {fase, titulo, ingredientes:[materia_prima_id]} | {fase: 'mezcla'/'limpieza'}
      const pasosRaw: { fase?: string; titulo?: string; descripcion?: string; ingredientes_ids?: string[] }[] =
        Array.isArray(orden.pasos) ? orden.pasos : [];

      // Mapa maestro ingredientes — usa ajustes si el operario modificó cantidad.
      // El frontend puede mandar la clave como ingrediente_id (ir.id) o materia_prima_id.
      type Ing = { mp_id: string; mp_codigo: string; mp_nombre: string; cantidad: number; unidad: string };
      const ingMap = new Map<string, Ing>();
      for (const i of ingredientes) {
        const cantidadAjustada = ajustes[i.id] ?? ajustes[i.materia_prima_id];
        const cantidad = cantidadAjustada != null && !isNaN(Number(cantidadAjustada))
          ? Number(cantidadAjustada)
          : parseFloat(i.cantidad) * factor;
        ingMap.set(i.materia_prima_id, {
          mp_id: i.materia_prima_id,
          mp_codigo: i.mp_codigo, mp_nombre: i.mp_nombre,
          cantidad, unidad: i.unidad_medida,
        });
      }

      // Asignación paso→ingredientes:
      //  · Si algún paso tiene `ingredientes: []` poblado, respetamos ese mapping.
      //  · Si NO hay mapping, todos los ingredientes van en el primer paso de
      //    'mezcla' o, en su defecto, en el primer paso del array.
      const algunPasoConIng = pasosRaw.some(p => Array.isArray(p.ingredientes_ids) && p.ingredientes_ids!.length > 0);
      const idsAsignados = new Set<string>();
      if (algunPasoConIng) {
        for (const p of pasosRaw) (p.ingredientes_ids ?? []).forEach(x => idsAsignados.add(x));
      }
      const ingsHuerfanos = Array.from(ingMap.keys()).filter(id => !idsAsignados.has(id));
      const pasosFiltrados = pasosRaw.length > 0 ? pasosRaw.slice() : [{ fase: 'mezcla', titulo: 'Fabricación', ingredientes_ids: Array.from(ingMap.keys()) }];
      if (ingsHuerfanos.length > 0) {
        const idxMezcla = pasosFiltrados.findIndex(p => (p.fase ?? '').toLowerCase().startsWith('mezcla') || (p.fase ?? '').toLowerCase().startsWith('react'));
        const target = idxMezcla >= 0 ? idxMezcla : 0;
        pasosFiltrados[target] = {
          ...pasosFiltrados[target],
          ingredientes_ids: [...(pasosFiltrados[target].ingredientes_ids ?? []), ...ingsHuerfanos],
        };
      }

      // ── PDF minimalista (B/N + un toque rojo en línea cabecera) ─────────────
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receta-${orden.numero_orden ?? orden.id}.pdf"`);
      doc.pipe(res);

      const RED  = '#FF0000';
      const TXT  = '#000000';
      const GRAY = '#6B7280';

      const fmtNum = (n: number, d = 2) => n.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: 0 });

      // Cabecera: título a la izquierda (ancho limitado para no chocar con la
      // meta) + meta de la orden alineada a la derecha en la misma línea.
      let y = 40;
      const metaTxt = `Orden ${orden.numero_orden ?? '—'}  ·  ${fmtNum(parseFloat(orden.cantidad_planificada))} ${orden.unidad_medida}  ·  ${new Date().toLocaleDateString('es-ES')}${orden.fecha_planificada ? `  ·  planificada ${new Date(orden.fecha_planificada).toLocaleDateString('es-ES')}` : ''}`;
      // Meta a la derecha primero, alineada al baseline del título
      doc.font('Helvetica').fontSize(11).fillColor(GRAY)
        .text(metaTxt, 320, y + 8, { width: 235, align: 'right' });
      // Título a la izquierda con ancho acotado para no pisar la meta
      doc.fillColor(TXT).font('Helvetica-Bold').fontSize(20)
        .text(`Receta · ${orden.producto_codigo} — ${orden.producto_nombre}`, 40, y, { width: 270 });
      y = Math.max(y + 30, doc.y + 8);
      doc.moveTo(40, y).lineTo(555, y).strokeColor(RED).lineWidth(1).stroke();
      y += 14;

      // Rangos QC objetivo en una línea
      const rangosQc: string[] = [];
      if (orden.ph_min != null || orden.ph_max != null) rangosQc.push(`pH ${orden.ph_min ?? '?'}–${orden.ph_max ?? '?'}`);
      if (orden.solidos_min != null || orden.solidos_max != null) rangosQc.push(`Sól ${orden.solidos_min ?? '?'}–${orden.solidos_max ?? '?'}%`);
      if (orden.viscosidad_min != null || orden.viscosidad_max != null) rangosQc.push(`Visc ${orden.viscosidad_min ?? '?'}–${orden.viscosidad_max ?? '?'} cP`);
      if (rangosQc.length > 0) {
        doc.fontSize(12).fillColor(GRAY).text(`Rangos QC: ${rangosQc.join('  ·  ')}`, 40, y);
        y += 22;
      }

      // Últimas fabricaciones QC (tabla compacta, sin fondo)
      if (ultimosQC.length > 0) {
        if (y > 720) { doc.addPage(); y = 40; }
        doc.font('Helvetica-Bold').fontSize(12).fillColor(TXT)
          .text('Últimas fabricaciones', 40, y);
        y += 16;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY)
          .text('Lote',    40, y, { width: 110 })
          .text('Fecha',   155, y, { width: 75 })
          .text('pH',      235, y, { width: 55, align: 'right' })
          .text('Sól. %', 300, y, { width: 60, align: 'right' })
          .text('Visc.',   365, y, { width: 60, align: 'right' });
        y += 14;
        doc.moveTo(40, y - 2).lineTo(430, y - 2).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
        for (const l of ultimosQC) {
          doc.font('Helvetica').fontSize(10).fillColor(TXT)
            .text(l.lote_interno ?? '—', 40, y, { width: 110 })
            .text(l.created_at ? new Date(l.created_at).toLocaleDateString('es-ES') : '—', 155, y, { width: 75 })
            .text(l.ph != null ? fmtNum(parseFloat(l.ph)) : '—', 235, y, { width: 55, align: 'right' })
            .text(l.solidos != null ? fmtNum(parseFloat(l.solidos)) : '—', 300, y, { width: 60, align: 'right' })
            .text(l.viscosidad != null ? fmtNum(parseFloat(l.viscosidad)) : '—', 365, y, { width: 60, align: 'right' });
          y += 13;
        }
        y += 8;
      }

      // PASOS
      let acumulado = 0;
      if (y > 740) { doc.addPage(); y = 40; }
      doc.font('Helvetica-Bold').fontSize(16).fillColor(TXT)
        .text('Pasos', 40, y);
      y += 22;

      pasosFiltrados.forEach((paso, idx) => {
        if (y > 740) { doc.addPage(); y = 40; }

        const ingsPaso = (paso.ingredientes_ids ?? []).map(mpId => ingMap.get(mpId)).filter(Boolean) as Ing[];

        // Línea de cabecera del paso: una sola string sin continued (evita wrap bug)
        const faseLabel = (paso.fase ?? '').toUpperCase();
        const titulo = paso.titulo ? ` — ${paso.titulo}` : '';
        doc.font('Helvetica-Bold').fontSize(14).fillColor(TXT)
          .text(`${idx + 1}. `, 40, y, { width: 515, continued: true })
          .fillColor(RED).text(faseLabel, { continued: !!paso.titulo })
          .fillColor(TXT).font('Helvetica-Bold')
          .text(titulo);
        y = doc.y + 4;

        if (paso.descripcion) {
          doc.font('Helvetica').fontSize(12).fillColor(GRAY)
            .text(paso.descripcion, 58, y, { width: 497 });
          y = doc.y + 4;
        }

        // Ingredientes del paso — cada uno con acumulado parcial + lote FEFO sugerido
        if (ingsPaso.length > 0) {
          for (const ing of ingsPaso) {
            if (y > 750) { doc.addPage(); y = 40; }
            acumulado += ing.cantidad;
            // Línea ingrediente: código + nombre · cantidad → tanque
            const izq = `   ${ing.mp_codigo}  ${ing.mp_nombre}`;
            const der = `${fmtNum(ing.cantidad, 3)} ${ing.unidad}   /   ${fmtNum(acumulado)} ${orden.unidad_medida}`;
            doc.font('Helvetica').fontSize(13).fillColor(TXT)
              .text(izq, 58, y, { width: 310 });
            doc.font('Helvetica-Bold').fontSize(13).fillColor(TXT)
              .text(der, 368, y, { width: 187, align: 'right' });
            y += 18;
            // Lote FEFO sugerido (primer lote no agotado)
            const lotes = lotesFefo.get(ing.mp_id) ?? [];
            if (lotes.length > 0) {
              // Recomendar suficientes lotes para cubrir la cantidad
              let pend = ing.cantidad;
              const sug: string[] = [];
              for (const l of lotes) {
                if (pend <= 0) break;
                const usar = Math.min(pend, parseFloat(l.cantidad_actual));
                sug.push(`${l.lote_interno} (${fmtNum(usar, 2)})`);
                pend -= usar;
              }
              if (sug.length > 0) {
                doc.font('Helvetica-Oblique').fontSize(11).fillColor(GRAY)
                  .text(`   lotes: ${sug.join('  +  ')}`, 70, y, { width: 485 });
                y = doc.y + 4;
              }
            }
          }
        }

        y += 6;
      });

      // Total final
      if (y > 740) { doc.addPage(); y = 40; }
      doc.moveTo(40, y).lineTo(555, y).strokeColor(TXT).lineWidth(0.8).stroke();
      y += 8;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(TXT)
        .text(`TOTAL`, 40, y, { width: 380 })
        .text(`${fmtNum(acumulado)} ${orden.unidad_medida}`, 420, y, { width: 135, align: 'right' });
      y += 36;

      // ── OBSERVACIONES (notas de la orden) — caja grande al final ──
      {
        const obs = (orden.notas ?? '').toString().trim();
        const obsLineas = obs ? obs : '— (sin observaciones) —';
        doc.font('Helvetica').fontSize(13);
        const altoTexto = doc.heightOfString(obsLineas, { width: 495 });
        const boxH = Math.max(80, altoTexto + 36);
        if (y + boxH > 780) { doc.addPage(); y = 40; }
        doc.roundedRect(40, y, 515, boxH, 6).strokeColor('#F59E0B').lineWidth(1.5).stroke();
        doc.fillColor('#F59E0B').font('Helvetica-Bold').fontSize(13).text('OBSERVACIONES', 50, y + 8);
        doc.fillColor(obs ? TXT : GRAY).font(obs ? 'Helvetica' : 'Helvetica-Oblique').fontSize(13)
          .text(obsLineas, 50, y + 28, { width: 495 });
        y += boxH + 14;
      }

      // Firmas
      if (y > 770) { doc.addPage(); y = 40; }
      doc.font('Helvetica').fontSize(12).fillColor(GRAY)
        .text('Operario: _____________________________', 40, y)
        .text('QC: _____________________________', 320, y);
      y += 20;
      doc.text(`Fecha: ____/____/______`, 40, y)
        .text(`Fecha: ____/____/______`, 320, y);

      doc.end();
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  // POST /api/produccion/:id/adjuntar — añadir fotos/archivos a orden existente
  async adjuntar(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const files = (req as Request & { files?: Express.Multer.File[] }).files ?? [];
      if (files.length === 0) return res.status(400).json({ error: 'No se han subido archivos' });

      const { rows: [orden] } = await pool.query(`SELECT foto_urls, archivos FROM ordenes_produccion WHERE id = $1`, [id]);
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      const newUrls = files.map(f => `/uploads/${f.filename}`);
      const isImage = (f: Express.Multer.File) => f.mimetype.startsWith('image/');

      // Separar fotos de archivos
      const newFotos = files.filter(isImage).map(f => `/uploads/${f.filename}`);
      const newArchivos = files.filter(f => !isImage(f)).map(f => ({
        url: `/uploads/${f.filename}`,
        nombre: f.originalname,
        tipo: f.mimetype,
        size: f.size,
      }));

      const fotoUrls = [...(orden.foto_urls ?? []), ...newFotos];
      const archivos = [...(orden.archivos ?? []), ...newArchivos];

      await pool.query(
        `UPDATE ordenes_produccion SET foto_urls = $1::JSONB, archivos = $2::JSONB WHERE id = $3`,
        [JSON.stringify(fotoUrls), JSON.stringify(archivos), id]
      );

      return res.json({ ok: true, fotos: fotoUrls.length, archivos: archivos.length, nuevos: newUrls });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  // POST /api/produccion/:id/enviar-trazabilidad
  async enviarTrazabilidad(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'email es obligatorio' });

      // Load order + consumos
      const { rows: [orden] } = await pool.query(
        `SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre,
                p.codigo AS producto_codigo, p.unidad_medida
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      const { rows: consumos } = await pool.query(
        `SELECT sm.tipo, sm.cantidad,
                p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
                l.lote_interno, l.fecha_caducidad
         FROM stock_moves sm
         JOIN productos p ON p.id = sm.producto_id
         LEFT JOIN lotes l ON l.id = sm.lote_id
         WHERE sm.orden_id = $1
         ORDER BY sm.tipo DESC, p.nombre ASC`,
        [id]
      );

      // Build email body with traceability
      const fmtNum = (n: string) => parseFloat(n).toLocaleString('es-ES', { maximumFractionDigits: 3 });
      const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('es-ES') : '---';

      const lines: string[] = [];
      lines.push(`CERTIFICADO DE TRAZABILIDAD`);
      lines.push(`Orden: ${orden.numero_orden}`);
      lines.push(`Producto: ${orden.producto_nombre}`);
      if (orden.fecha_fabricacion) lines.push(`Fecha fabricacion: ${new Date(orden.fecha_fabricacion).toLocaleString('es-ES')}`);
      if (orden.ph != null) lines.push(`pH: ${orden.ph}`);
      if (orden.solidos != null) lines.push(`% Solidos: ${orden.solidos}%`);
      if (orden.viscosidad != null) lines.push(`Viscosidad: ${orden.viscosidad} mPa-s`);
      lines.push('');
      lines.push('=== MATERIAS PRIMAS CONSUMIDAS ===');
      lines.push('');

      // Group by product
      const mpConsumos = consumos.filter((c: { tipo: string }) => c.tipo !== 'produccion_salida');
      const ptConsumos = consumos.filter((c: { tipo: string }) => c.tipo === 'produccion_salida');

      const grupos = new Map<string, typeof mpConsumos>();
      for (const c of mpConsumos) {
        if (!grupos.has(c.producto_codigo)) grupos.set(c.producto_codigo, []);
        grupos.get(c.producto_codigo)!.push(c);
      }

      for (const [, lotes] of grupos.entries()) {
        const first = lotes[0];
        lines.push(`${first.producto_nombre} (${first.producto_codigo})`);
        for (const l of lotes) {
          lines.push(`    Lote: ${l.lote_interno ?? '---'}    Caducidad: ${fmtDate(l.fecha_caducidad)}`);
        }
        lines.push('');
      }

      // Producto terminado
      if (ptConsumos.length > 0) {
        lines.push('=== PRODUCTO TERMINADO ===');
        lines.push('');
        for (const c of ptConsumos) {
          lines.push(`${c.producto_nombre} (${c.producto_codigo})`);
          lines.push(`    Lote: ${c.lote_interno ?? '---'}`);
        }
        lines.push('');
      }

      lines.push('---');
      const { rows: [cfgEmail] } = await pool.query(`SELECT empresa_nombre FROM configuracion_global WHERE id = 1`);
      lines.push(cfgEmail?.empresa_nombre || 'Colas Loga');
      lines.push('Se adjunta el PDF de trazabilidad completo y las fotografias del lote.');

      const cuerpo = lines.join('\n');

      // Generate PDF to buffer (request to self)
      const pdfRes = await new Promise<Buffer>((resolve, reject) => {
        const pdfDoc = new PDFDocument({ margin: 0, size: 'A4' });
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (c: Buffer) => chunks.push(c));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);

        // Minimal branded PDF
        const RED2 = '#E8001C';
        const LOGO = path.join(process.cwd(), 'assets', 'logo-real.png');
        pdfDoc.rect(0, 0, 595, 70).fill(RED2);
        if (fs.existsSync(LOGO)) {
          pdfDoc.roundedRect(14, 7, 56, 56, 5).fill('#FFFFFF');
          try { pdfDoc.image(LOGO, 16, 9, { fit: [52, 52] }); } catch { /* skip */ }
        }
        pdfDoc.fillColor('#FFF').fontSize(16).font('Helvetica-Bold').text('COLAS LOGA', 80, 16);
        pdfDoc.fontSize(8).font('Helvetica').text('Certificado de Trazabilidad de Produccion', 80, 36);
        pdfDoc.fontSize(13).font('Helvetica-Bold').text(orden.numero_orden, 330, 18, { align: 'right', width: 230 });
        pdfDoc.fontSize(8).font('Helvetica').text(`Emitido: ${new Date().toLocaleDateString('es-ES')}`, 330, 38, { align: 'right', width: 230 });

        let py2 = 85;
        pdfDoc.fillColor('#333').fontSize(9).font('Helvetica');
        for (const line of cuerpo.split('\n')) {
          if (py2 > 780) { pdfDoc.addPage(); py2 = 40; pdfDoc.rect(0, 0, 595, 3).fill(RED2); py2 += 10; }
          if (line.startsWith('===')) {
            pdfDoc.rect(40, py2, 515, 14).fill(RED2);
            pdfDoc.fillColor('#FFF').fontSize(8).font('Helvetica-Bold').text(line.replace(/=/g, '').trim(), 46, py2 + 3);
            pdfDoc.fillColor('#333').fontSize(9).font('Helvetica');
            py2 += 18;
          } else if (line.startsWith('    ')) {
            pdfDoc.fillColor('#666').fontSize(8).font('Helvetica').text(line, 50, py2);
            pdfDoc.fillColor('#333').fontSize(9).font('Helvetica');
            py2 += 13;
          } else if (line === '') {
            py2 += 6;
          } else {
            pdfDoc.text(line, 50, py2);
            py2 += 13;
          }
        }
        pdfDoc.end();
      });

      // Photo attachments
      const fotoUrls: string[] = orden.foto_urls && Array.isArray(orden.foto_urls) ? orden.foto_urls : (orden.foto_url ? [orden.foto_url] : []);
      const photoAttachments = fotoUrls
        .map((u: string, i: number) => {
          const p = path.join(process.cwd(), u.replace(/^\//, ''));
          if (fs.existsSync(p)) return { filename: `foto-lote-${i + 1}${path.extname(p)}`, path: p };
          return null;
        })
        .filter(Boolean) as { filename: string; path: string }[];

      // Document attachments
      const docUrls: { url: string; nombre: string }[] = orden.archivos && Array.isArray(orden.archivos) ? orden.archivos : [];
      const docAttachments = docUrls
        .map((a: { url: string; nombre: string }) => {
          const p = path.join(process.cwd(), a.url.replace(/^\//, ''));
          if (fs.existsSync(p)) return { filename: a.nombre, path: p };
          return null;
        })
        .filter(Boolean) as { filename: string; path: string }[];

      // SMTP
      const { rows: [cfg] } = await pool.query(`SELECT * FROM configuracion_global WHERE id = 1`);
      const transporter = nodemailer.createTransport({
        host: cfg.smtp_host || process.env.SMTP_HOST,
        port: cfg.smtp_port || Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: cfg.smtp_user || process.env.SMTP_USER,
          pass: cfg.smtp_pass_enc || process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: cfg.email_remitente || process.env.EMAIL_FROM || 'Colas Loga <erp@loga.es>',
        to: email,
        subject: `Trazabilidad ${orden.numero_orden} - ${orden.producto_nombre} - Colas Loga`,
        text: cuerpo,
        attachments: [
          { filename: `trazabilidad-${orden.numero_orden}.pdf`, content: pdfRes, contentType: 'application/pdf' },
          ...photoAttachments,
          ...docAttachments,
        ],
      });

      return res.json({ ok: true, enviado_a: email });
    } catch (err: unknown) {
      console.error('[enviarTrazabilidad]', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al enviar' });
    }
  },

  // DELETE /api/produccion/:id?modo=revertir|borrar
  // Sin modo o modo=revertir: borrador/confirmada borra directo, completada revierte stock
  // modo=borrar: borra/cancela sin revertir (solo marca cancelada)
  //
  // Política de permisos:
  //   - admin: borra cualquier orden
  //   - trabajador: solo borra órdenes que él creó (creado_por_id) o ejecutó (operario_id)
  async eliminar(req: Request, res: Response) {
    const { id } = req.params;
    const modo = String(req.query.modo ?? 'revertir');
    const userId = (req as any).user?.id;
    const userRol = (req as any).user?.rol;

    // Pre-check de propiedad antes de cualquier operación destructiva.
    // Si no es admin, verificar que la orden le pertenezca.
    if (userRol !== 'admin') {
      const { rows: [own] } = await pool.query<{ creado_por_id: string | null; operario_id: string | null }>(
        `SELECT creado_por_id, operario_id FROM ordenes_produccion WHERE id = $1`,
        [id]
      );
      if (!own) return res.status(404).json({ error: 'Orden no encontrada' });
      const esSuya = own.creado_por_id === userId || own.operario_id === userId;
      if (!esSuya) {
        return res.status(403).json({
          error: 'Solo puedes borrar órdenes que tú hayas creado o ejecutado. Pide al administrador que borre las ajenas.',
        });
      }
    }

    // Modo borrar: simplemente cancelar sin revertir stock
    if (modo === 'borrar') {
      try {
        const { rows: [orden] } = await pool.query(
          `SELECT estado FROM ordenes_produccion WHERE id = $1`, [id]
        );
        if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
        if (['borrador', 'confirmada'].includes(orden.estado)) {
          await pool.query(
            `UPDATE pedidos SET orden_produccion_id = NULL, estado = CASE WHEN estado IN ('completado', 'cancelado') THEN estado ELSE 'confirmado' END WHERE orden_produccion_id = $1`,
            [id]
          );
          await pool.query(`DELETE FROM ordenes_produccion WHERE id = $1`, [id]);
        } else {
          await pool.query(`UPDATE ordenes_produccion SET estado = 'cancelada' WHERE id = $1`, [id]);
        }
        invalidarCacheFinanzas(); // [H1.3 audit v3] borrar/cancelar afecta KPIs producción
        // [H1.1 audit v3] Auditoría fail-soft: no bloquea la respuesta.
        pool.query(
          `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
           VALUES ($1, 'ELIMINAR_ORDEN_PRODUCCION', 'ordenes_produccion', $2, $3)`,
          [(req as any).user?.id ?? null, id, `Orden borrada/cancelada (modo=borrar) sin reversión de stock`]
        ).catch((e: unknown) => logger.warn('[auditoria ELIMINAR_ORDEN_PRODUCCION]', { err: e instanceof Error ? e.message : e }));
        return res.json({ ok: true, revertido: false });
      } catch (err: unknown) {
        console.error('[produccion.eliminar:borrar]', err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      const { rows: [orden] } = await client.query(
        `SELECT * FROM ordenes_produccion WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!orden) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Orden no encontrada' });
      }
      if (orden.estado === 'cancelada') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'La orden ya está cancelada' });
      }

      // Borrador/confirmada → eliminar directamente (deslinkar pedidos primero por FK)
      if (['borrador', 'confirmada'].includes(orden.estado)) {
        await client.query(
          `UPDATE pedidos SET orden_produccion_id = NULL, estado = CASE WHEN estado IN ('completado', 'cancelado') THEN estado ELSE 'confirmado' END WHERE orden_produccion_id = $1`,
          [id]
        );
        await client.query(`DELETE FROM ordenes_produccion WHERE id = $1`, [id]);
        await client.query('COMMIT');
        return res.json({ ok: true, revertido: false });
      }

      // Completada → revertir stock_moves de produccion_consumo y produccion_salida.
      // Estrategia O(1) en queries (antes era N+1 con timeout en órdenes grandes):
      //   1. Cargar todos los moves de la orden
      //   2. Pre-validar batch: ningún producto puede quedar negativo
      //   3. Aplicar UPDATE agregados (producto delta, lote delta) en lote
      //   4. INSERT stock_moves de reversión en batch (multi-VALUES)
      const { rows: moves } = await client.query<{
        id: string; producto_id: string; lote_id: string | null;
        cantidad: string; producto_nombre?: string;
      }>(
        `SELECT sm.id, sm.producto_id, sm.lote_id, sm.cantidad, p.nombre AS producto_nombre
         FROM stock_moves sm
         JOIN productos p ON p.id = sm.producto_id
         WHERE sm.orden_id = $1`,
        [id]
      );

      if (moves.length > 0) {
        // Bloquear todos los productos involucrados para evitar race
        const productoIds = [...new Set(moves.map(m => m.producto_id))];
        await acquireProductLocks(client, productoIds);

        // Delta neto por producto (suma de cantidades a revertir = suma con signo invertido)
        const deltaPorProducto = new Map<string, number>();
        for (const mv of moves) {
          const delta = -parseFloat(mv.cantidad);
          deltaPorProducto.set(mv.producto_id, (deltaPorProducto.get(mv.producto_id) ?? 0) + delta);
        }

        // Pre-check: ningún producto cae en negativo tras reversión
        const { rows: stocks } = await client.query<{ id: string; stock_actual: string; nombre: string }>(
          `SELECT id, stock_actual, nombre FROM productos WHERE id = ANY($1::uuid[]) FOR UPDATE`,
          [productoIds]
        );
        const stockMap = new Map(stocks.map(s => [s.id, { antes: parseFloat(s.stock_actual), nombre: s.nombre }]));
        for (const [pid, delta] of deltaPorProducto) {
          const cur = stockMap.get(pid);
          if (!cur) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `Producto ${pid} no encontrado` });
          }
          if (cur.antes + delta < 0) {
            await client.query('ROLLBACK');
            return res.status(422).json({
              error: 'REVERSION_IMPOSIBLE',
              mensaje: `Revertir consumo de "${cur.nombre}" dejaría el stock en negativo (${(cur.antes + delta).toFixed(3)}). El stock ya fue consumido en otra operación.`,
            });
          }
        }

        // [Hot-fix C-5]: stock_actual se actualiza vía trigger cuando los UPDATE
        // lotes de abajo se aplican. Aplicar delta manual aquí causaría doble
        // descuento (mismo bug que vimos en autoCompletarPedido — CHECK violation).

        // Aplicar deltas a lotes (un UPDATE por mv con lote_id, batch via VALUES)
        const lotesDelta = new Map<string, number>();
        for (const mv of moves) {
          if (!mv.lote_id) continue;
          const delta = -parseFloat(mv.cantidad);
          lotesDelta.set(mv.lote_id, (lotesDelta.get(mv.lote_id) ?? 0) + delta);
        }
        for (const [lid, delta] of lotesDelta) {
          await client.query(
            `UPDATE lotes SET cantidad_actual = GREATEST(0, cantidad_actual + $1::NUMERIC) WHERE id = $2`,
            [delta.toFixed(6), lid]
          );
        }

        // INSERT stock_moves de reversión en batch (multi-VALUES)
        const insertRows: string[] = [];
        const insertParams: unknown[] = [];
        let pIdx = 1;
        for (const mv of moves) {
          const delta = -parseFloat(mv.cantidad);
          const cur = stockMap.get(mv.producto_id);
          if (!cur) continue;
          const antes = cur.antes;
          const despues = antes + delta;
          // Actualizar mapa para que siguientes moves del mismo producto tengan referencia correcta
          stockMap.set(mv.producto_id, { antes: despues, nombre: cur.nombre });
          insertRows.push(`($${pIdx++}, $${pIdx++}, 'ajuste', $${pIdx++}::NUMERIC, $${pIdx++}::NUMERIC, $${pIdx++}::NUMERIC, $${pIdx++}, $${pIdx++})`);
          insertParams.push(
            mv.producto_id, mv.lote_id ?? null,
            delta.toFixed(6), antes.toFixed(6), despues.toFixed(6),
            id, `Reversión por cancelación orden ${orden.numero_orden}`
          );
        }
        if (insertRows.length > 0) {
          await client.query(
            `INSERT INTO stock_moves
               (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, motivo)
             VALUES ${insertRows.join(', ')}`,
            insertParams
          );
        }
      }

      // Deslinkar pedidos que referencian esta orden
      await client.query(
        `UPDATE pedidos SET orden_produccion_id = NULL, estado = 'confirmado' WHERE orden_produccion_id = $1 AND estado NOT IN ('completado', 'cancelado')`,
        [id]
      );

      // Quitar referencia al lote y cancelar orden (antes de borrar el lote para no violar FK)
      await client.query(
        `UPDATE ordenes_produccion SET estado = 'cancelada', lote_producido_id = NULL WHERE id = $1`,
        [id]
      );

      // Marcar lote producido como rechazado (no DELETE: stock_moves FK ON DELETE RESTRICT preserva trazabilidad)
      if (orden.lote_producido_id) {
        await client.query(
          `UPDATE lotes SET estado = 'rechazado', cantidad_actual = 0 WHERE id = $1`,
          [orden.lote_producido_id]
        );
      }

      await client.query('COMMIT');
      invalidarCacheFinanzas(); // [H1.3 audit v3] revertir afecta coste producción + valor inventario
      // [H1.1 audit v3] Auditoría fail-soft: no bloquea la respuesta.
      pool.query(
        `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
         VALUES ($1, 'REVERTIR_ORDEN_PRODUCCION', 'ordenes_produccion', $2, $3)`,
        [(req as any).user?.id ?? null, id, `Orden ${orden.numero_orden} revertida — stock_moves de reversión generados`]
      ).catch((e: unknown) => logger.warn('[auditoria REVERTIR_ORDEN_PRODUCCION]', { err: e instanceof Error ? e.message : e }));
      return res.json({ ok: true, revertido: true, numero_orden: orden.numero_orden });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      console.error('[produccion.eliminar]', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    } finally {
      client.release();
    }
  },

  // GET /api/produccion/:id/etiqueta-defaults — JSON con lote y cantidad
  // auto-detectados. Usado por el preview modal para pre-rellenar los inputs
  // editables sin tener que parsear el PDF.
  async etiquetaDefaults(req: Request, res: Response) {
    try {
      const { id } = req.params;
      // Para órdenes de envasado, el producto objetivo es el PE (no el granel).
      // Si op.producto_envasado_id está set → priorizar ese; si no, el de la receta.
      const { rows: [orden] } = await pool.query(
        `SELECT op.id, op.cantidad_planificada, op.tipo_orden, op.producto_envasado_id,
                COALESCE(pe.id, r.producto_id) AS producto_id,
                COALESCE(pe.nombre, p.nombre) AS producto_nombre,
                COALESCE(pe.nombre_comercial, p.nombre_comercial) AS producto_nombre_comercial
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         LEFT JOIN productos pe ON pe.id = op.producto_envasado_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      const { rows: [lote] } = await pool.query(
        `SELECT DISTINCT l.lote_interno, l.cantidad_inicial
         FROM stock_moves sm
         JOIN lotes l ON l.id = sm.lote_id AND l.producto_id = $2
         WHERE sm.orden_id = $1 AND sm.lote_id IS NOT NULL
         ORDER BY l.lote_interno
         LIMIT 1`,
        [id, orden.producto_id]
      );

      // URL del QR — misma lógica que el endpoint del PDF
      const frontendBase =
        (process.env.CORS_ORIGIN?.split(',')[0]?.trim()) ||
        (req.get('origin')) ||
        `${req.protocol}://${req.get('host')}`;
      const qrUrl = `${frontendBase.replace(/\/$/, '')}/produccion?detalle_id=${id}`;

      const nombreCom = (orden.producto_nombre_comercial ?? '').trim();
      const nombre = (orden.producto_nombre ?? '').trim();

      // Para envasado: extraer formato del nombre del PE (ej. "200 ml", "1 kg", "5 L").
      // Cada etiqueta muestra el CONTENIDO POR BOTE (no el total de la OF).
      let cantidadEtiq = lote ? parseFloat(lote.cantidad_inicial) : parseFloat(orden.cantidad_planificada);
      let unidadEtiq = 'Kg';
      if (orden.tipo_orden === 'envasado') {
        const m = (nombreCom || nombre).match(/(\d+(?:[.,]\d+)?)\s*(ml|mL|cl|cL|l|L|g|kg|Kg|KG)\b/);
        if (m) {
          cantidadEtiq = parseFloat(m[1].replace(',', '.'));
          unidadEtiq = m[2].toLowerCase() === 'ml' ? 'mL'
                    : m[2].toLowerCase() === 'cl' ? 'cL'
                    : m[2].toLowerCase() === 'l'  ? 'L'
                    : m[2].toLowerCase() === 'g'  ? 'g'
                    : 'Kg';
        }
      }

      return res.json({
        lote: lote?.lote_interno ?? '',
        cantidad: cantidadEtiq,
        unidad: unidadEtiq,
        qrUrl,
        titulo: nombreCom || nombre,
        subtitulo: nombreCom ? nombre : '',
        contenedorText: 'Contenedor nº: 1',
      });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  // GET /api/produccion/:id/etiqueta.pdf — Etiqueta L-800 con lote dinámico.
  // Lote y cantidad se sacan del lote producido por la orden (vía stock_moves).
  // Si la orden aún no produjo lote (estado planificado), usa cantidad_planificada
  // y un lote placeholder. Año del sello aniversario = añoActual − 1958.
  async etiquetaL800Pdf(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Buscar lote producido por esta orden. El stock_move tipo es 'produccion_salida'
      // y el lote.producto_id debe matchear el producto de la receta (PT, no MPs).
      // En envasado, prioriza op.producto_envasado_id (el PE producido, no el granel).
      const { rows: [orden] } = await pool.query(
        `SELECT op.id, op.cantidad_planificada, op.estado, op.tipo_orden, op.producto_envasado_id,
                COALESCE(pe.id, p.id)           AS producto_id,
                COALESCE(pe.codigo, p.codigo)   AS producto_codigo,
                COALESCE(pe.nombre, p.nombre)   AS producto_nombre,
                COALESCE(pe.nombre_comercial, p.nombre_comercial) AS producto_nombre_comercial
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         LEFT JOIN productos pe ON pe.id = op.producto_envasado_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      const { rows: [lote] } = await pool.query(
        `SELECT DISTINCT l.lote_interno, l.cantidad_inicial
         FROM stock_moves sm
         JOIN lotes l ON l.id = sm.lote_id AND l.producto_id = $2
         WHERE sm.orden_id = $1 AND sm.lote_id IS NOT NULL
         ORDER BY l.lote_interno
         LIMIT 1`,
        [id, orden.producto_id]
      );

      // Permite overrides desde query: lote / cantidad / contenedor / ean / qr
      // Útil cuando el operario quiere imprimir variante manual (corrección, prueba…).
      const loteAuto = lote?.lote_interno ?? 'PENDIENTE';
      const cantidadAuto = lote ? parseFloat(lote.cantidad_inicial) : parseFloat(orden.cantidad_planificada);

      // URL del QR → abre la orden en la app de fabricación.
      // Prioridad: CORS_ORIGIN (primer valor) → header Origin → host del request.
      const frontendBase =
        (process.env.CORS_ORIGIN?.split(',')[0]?.trim()) ||
        (req.get('origin')) ||
        `${req.protocol}://${req.get('host')}`;
      const qrUrlAuto = `${frontendBase.replace(/\/$/, '')}/produccion?detalle_id=${id}`;

      // Título principal: si hay nombre_comercial → es el título grande,
      // y nombre técnico va como subtítulo. Si no → solo nombre como título.
      const nombreCom = (orden.producto_nombre_comercial ?? '').trim();
      const nombre = (orden.producto_nombre ?? '').trim();
      const tituloAuto = nombreCom || nombre;
      const subtituloAuto = nombreCom ? nombre : '';

      // En envasado: extraer formato (200 ml, 1 kg, 5 L) del nombre del PE
      let cantidadEnvasado = cantidadAuto;
      let unidadEnvasado = 'Kg';
      if (orden.tipo_orden === 'envasado') {
        const m = (nombreCom || nombre).match(/(\d+(?:[.,]\d+)?)\s*(ml|mL|cl|cL|l|L|g|kg|Kg|KG)\b/);
        if (m) {
          cantidadEnvasado = parseFloat(m[1].replace(',', '.'));
          unidadEnvasado = m[2].toLowerCase() === 'ml' ? 'mL'
                        : m[2].toLowerCase() === 'cl' ? 'cL'
                        : m[2].toLowerCase() === 'l'  ? 'L'
                        : m[2].toLowerCase() === 'g'  ? 'g'
                        : 'Kg';
        }
      }

      const datos = {
        lote: typeof req.query.lote === 'string' && req.query.lote.trim() !== ''
          ? req.query.lote.trim() : loteAuto,
        cantidad: req.query.cantidad != null && !isNaN(Number(req.query.cantidad))
          ? Number(req.query.cantidad) : cantidadEnvasado,
        unidad: typeof req.query.unidad === 'string' && req.query.unidad.trim() !== ''
          ? req.query.unidad.trim() : unidadEnvasado,
        contenedorText: typeof req.query.contenedorText === 'string' && req.query.contenedorText.trim() !== ''
          ? req.query.contenedorText.trim() : `Contenedor nº: ${Number(req.query.contenedor ?? 1)}`,
        qrUrl: typeof req.query.qr === 'string' && req.query.qr.trim() !== ''
          ? req.query.qr.trim() : qrUrlAuto,
        titulo: typeof req.query.titulo === 'string' && req.query.titulo.trim() !== ''
          ? req.query.titulo.trim() : tituloAuto,
        subtitulo: typeof req.query.subtitulo === 'string'
          ? req.query.subtitulo.trim() : subtituloAuto,
        añoActual: new Date().getFullYear(),
        añoFundacion: 1958,
      };

      const doc = await buildEtiquetaL800Pdf(datos);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="etiqueta-${datos.lote}.pdf"`);
      doc.pipe(res);
      doc.end();
    } catch (err: unknown) {
      console.error('[produccion.etiquetaL800Pdf]', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },

  // GET /api/produccion/:id/etiqueta.ezpx — Etiqueta L-800 en formato GoDEX
  // QLabel. Genera un .ezpx con los campos dinámicos sustituidos en la
  // plantilla original. El operario lo descarga, abre con QLabel e imprime
  // directo a la impresora térmica.
  async etiquetaL800Ezpx(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const { rows: [orden] } = await pool.query(
        `SELECT op.id, op.cantidad_planificada, op.estado, op.tipo_orden, op.producto_envasado_id,
                COALESCE(pe.id, p.id)           AS producto_id,
                COALESCE(pe.codigo, p.codigo)   AS producto_codigo,
                COALESCE(pe.nombre, p.nombre)   AS producto_nombre,
                COALESCE(pe.nombre_comercial, p.nombre_comercial) AS producto_nombre_comercial
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         LEFT JOIN productos pe ON pe.id = op.producto_envasado_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      const { rows: [lote] } = await pool.query(
        `SELECT DISTINCT l.lote_interno, l.cantidad_inicial
         FROM stock_moves sm
         JOIN lotes l ON l.id = sm.lote_id AND l.producto_id = $2
         WHERE sm.orden_id = $1 AND sm.lote_id IS NOT NULL
         ORDER BY l.lote_interno
         LIMIT 1`,
        [id, orden.producto_id]
      );

      const loteAuto = lote?.lote_interno ?? 'PENDIENTE';
      const cantidadAuto = lote ? parseFloat(lote.cantidad_inicial) : parseFloat(orden.cantidad_planificada);
      const nombreCom = (orden.producto_nombre_comercial ?? '').trim();
      const nombre = (orden.producto_nombre ?? '').trim();

      // En envasado: extraer formato (200 ml, 1 kg…) del nombre
      let cantidadEnvasado = cantidadAuto;
      let unidadEnvasado = 'Kg';
      if (orden.tipo_orden === 'envasado') {
        const m = (nombreCom || nombre).match(/(\d+(?:[.,]\d+)?)\s*(ml|mL|cl|cL|l|L|g|kg|Kg|KG)\b/);
        if (m) {
          cantidadEnvasado = parseFloat(m[1].replace(',', '.'));
          unidadEnvasado = m[2].toLowerCase() === 'ml' ? 'mL'
                        : m[2].toLowerCase() === 'cl' ? 'cL'
                        : m[2].toLowerCase() === 'l'  ? 'L'
                        : m[2].toLowerCase() === 'g'  ? 'g'
                        : 'Kg';
        }
      }

      // URL del QR (igual lógica que etiqueta.pdf — para que .ezpx sea visual idéntico)
      const frontendBase =
        (process.env.CORS_ORIGIN?.split(',')[0]?.trim()) ||
        (req.get('origin')) ||
        `${req.protocol}://${req.get('host')}`;
      const qrUrlAuto = `${frontendBase.replace(/\/$/, '')}/produccion?detalle_id=${id}`;

      const datos = {
        lote: typeof req.query.lote === 'string' && req.query.lote.trim() !== ''
          ? req.query.lote.trim() : loteAuto,
        cantidad: req.query.cantidad != null && !isNaN(Number(req.query.cantidad))
          ? Number(req.query.cantidad) : cantidadEnvasado,
        unidad: typeof req.query.unidad === 'string' && req.query.unidad.trim() !== ''
          ? req.query.unidad.trim() : unidadEnvasado,
        contenedorText: typeof req.query.contenedorText === 'string' && req.query.contenedorText.trim() !== ''
          ? req.query.contenedorText.trim() : 'Contenedor nº: 1',
        titulo: typeof req.query.titulo === 'string' && req.query.titulo.trim() !== ''
          ? req.query.titulo.trim() : (nombreCom || nombre),
        subtitulo: typeof req.query.subtitulo === 'string'
          ? req.query.subtitulo.trim() : (nombreCom ? nombre : ''),
        qrUrl: typeof req.query.qr === 'string' && req.query.qr.trim() !== ''
          ? req.query.qr.trim() : qrUrlAuto,
        añoActual: new Date().getFullYear(),
        añoFundacion: 1958,
      };

      const ezpxXml = await buildEtiquetaL800Ezpx(datos);
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="etiqueta-${datos.lote}.ezpx"`);
      return res.send(ezpxXml);
    } catch (err: unknown) {
      console.error('[produccion.etiquetaL800Ezpx]', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
  },
};
