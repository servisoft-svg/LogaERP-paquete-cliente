import { Request, Response } from 'express';
import { produccionService } from '../services/produccion.service';
import { pool }              from '../db/pool';
import PDFDocument           from 'pdfkit';
import nodemailer            from 'nodemailer';
import fs                    from 'fs';
import path                  from 'path';
import { invalidarCacheFinanzas } from '../routes/finanzas.routes';
import { alertaService }          from '../services/alerta.service';

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

  async confirmar(req: Request, res: Response) {
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

      // ── Everything passed to service runs inside a single SERIALIZABLE transaction ──
      const resultado = await produccionService.confirmarOrden(id, usuario_id, {
        ph, foto_url, foto_urls, solidos, viscosidad, fecha_fabricacion, cantidad_real_producida,
        qc_fuera_de_rango, registro_limpieza, nota_qc, fecha_inicio_cliente,
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
      const msg = err instanceof Error ? err.message : 'Error interno';

      if (msg.startsWith('STOCK_INSUFICIENTE')) {
        return res.status(422).json({
          error: 'STOCK_INSUFICIENTE',
          detalle: msg,
          mensaje: 'No hay suficiente stock de materias primas. La operación fue cancelada completamente.',
        });
      }
      if (msg.startsWith('ESTADO_INVALIDO')) {
        return res.status(409).json({
          error: 'ESTADO_INVALIDO',
          mensaje: 'La orden no está en un estado que permita confirmación.',
        });
      }
      if (msg === 'ORDEN_NO_ENCONTRADA') {
        return res.status(404).json({ error: 'Orden no encontrada' });
      }

      console.error('[ProduccionCtrl.confirmar]', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
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
                COALESCE(l.precio_compra, p.precio_unitario) AS precio_unitario,
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
        `SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre, p.unidad_medida
         FROM ordenes_produccion op
         JOIN recetas r ON r.id = op.receta_id
         JOIN productos p ON p.id = r.producto_id
         WHERE op.id = $1`,
        [id]
      );
      if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

      // Consumos por materia prima + lote (usa precio_compra del lote si existe, si no precio del producto)
      const { rows: consumos } = await pool.query(
        `SELECT
           sm.id, sm.tipo, sm.cantidad, sm.cantidad_antes, sm.cantidad_despues,
           sm.created_at, sm.lote_id,
           p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida, p.tipo AS producto_tipo,
           COALESCE(l.precio_compra, p.precio_unitario) AS precio_unitario,
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
  async eliminar(req: Request, res: Response) {
    const { id } = req.params;
    const modo = String(req.query.modo ?? 'revertir');

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
        return res.json({ ok: true, revertido: false });
      } catch (err: unknown) {
        console.error('[produccion.eliminar:borrar]', err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

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

      // Completada → revertir stock_moves de produccion_consumo y produccion_salida
      const { rows: moves } = await client.query(
        `SELECT sm.*, p.stock_actual AS stock_ahora
         FROM stock_moves sm
         JOIN productos p ON p.id = sm.producto_id
         WHERE sm.orden_id = $1`,
        [id]
      );

      for (const mv of moves) {
        const cantidadRevertida = -parseFloat(mv.cantidad); // invertir signo
        const stockAhora = parseFloat(mv.stock_ahora);
        const stockNuevo = stockAhora + cantidadRevertida;

        if (stockNuevo < 0) {
          await client.query('ROLLBACK');
          return res.status(422).json({
            error: `REVERSION_IMPOSIBLE`,
            mensaje: `Revertir consumo de "${mv.producto_nombre ?? mv.producto_id}" dejaría el stock en negativo (${stockNuevo.toFixed(3)}). El stock ya fue consumido en otra operación.`,
          });
        }

        // Actualizar stock producto
        await client.query(
          `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
          [stockNuevo.toFixed(6), mv.producto_id]
        );

        // Revertir lote si aplica
        if (mv.lote_id) {
          const delta = -parseFloat(mv.cantidad);
          await client.query(
            `UPDATE lotes SET cantidad_actual = GREATEST(0, cantidad_actual + $1::NUMERIC) WHERE id = $2`,
            [delta.toFixed(6), mv.lote_id]
          );
        }

        // Registrar stock_move de reversión (tipo ajuste)
        await client.query(
          `INSERT INTO stock_moves
             (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, motivo)
           VALUES ($1, $2, 'ajuste', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
          [
            mv.producto_id,
            mv.lote_id ?? null,
            cantidadRevertida.toFixed(6),
            stockAhora.toFixed(6),
            stockNuevo.toFixed(6),
            id,
            `Reversión por cancelación orden ${orden.numero_orden}`,
          ]
        );
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
      return res.json({ ok: true, revertido: true, numero_orden: orden.numero_orden });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      console.error('[produccion.eliminar]', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    } finally {
      client.release();
    }
  },
};
