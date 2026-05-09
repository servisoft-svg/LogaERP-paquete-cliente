# Mapa de Efectos del Sistema — ERP Colas Loga

> **Documento técnico para el desarrollador.** Detalla cada operación expuesta por la API y traza exhaustivamente sus efectos: tablas modificadas, triggers que se disparan, hooks asíncronos post-COMMIT, invalidaciones de cache y side-effects.
>
> Sirve de referencia obligatoria al modificar cualquier endpoint: revisa qué dependencias tiene una operación antes de tocar su código y qué tendrás que verificar tras el cambio.
>
> Última revisión: tras migrations 030–034 + correcciones audit v3. Repo en `/Users/adrianmartinlopez/Documents/Loga`.

---

## ⚡ Cambios audit v3 (delta vs versión anterior)

### Auditoría: cobertura ampliada (H1.1)
Se añade INSERT en `auditoria` para 6 operaciones que antes no quedaban registradas. **Patrón fail-soft uniforme** en todas:

```ts
// Patrón estándar — sin await, no bloquea respuesta. Si la BD falla
// al escribir auditoria, la operación principal ya está completada.
pool.query(
  `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
   VALUES ($1, $2, $3, $4, $5)`,
  [...]
).catch((e: unknown) => logger.warn('[auditoria NOMBRE_ACCION]', {
  err: e instanceof Error ? e.message : e
}));
```

Acciones nuevas registradas:
| Acción | Operación | Endpoint |
|---|---|---|
| `ELIMINAR_PRODUCTO` | Soft delete producto | `DELETE /api/productos/:id` |
| `CREAR_PEDIDO` | Pedido creado | `POST /api/pedidos` |
| `CANCELAR_PEDIDO` | Cancelación pedido | `DELETE /api/pedidos/:id` |
| `ELIMINAR_ORDEN_PRODUCCION` | Borrado de orden sin reversión | `DELETE /api/produccion/:id?modo=borrar` |
| `REVERTIR_ORDEN_PRODUCCION` | Reversión de orden completada | `DELETE /api/produccion/:id?modo=revertir` |
| `BACKUP_MANUAL` | Backup manual ejecutado | `POST /api/configuracion/backup` |
| `RESTORE_BACKUP` | Restore ejecutado (OK o KO) | `POST /api/configuracion/restaurar` |

**Excepción `RESTORE_BACKUP`**: usa `await` + `try/catch` silencioso. Razón: necesitamos intentar registrar antes de responder al cliente (forensia post-restore), pero el catch nunca devuelve error al cliente — la respuesta del restore va siempre.

### Permisos: stock contable es admin (H1.2)
- `POST /api/stock/ajuste` → `adminOnly`
- `POST /api/stock/reconciliar` → `adminOnly`

Trabajador conserva: lectura, lotes (POST/PUT/PATCH), producción.

### Endpoint nuevo: `GET /api/health/db` (H4.2)
- 🔐 admin
- Verifica:
  1. Triggers críticos activos: `trg_lotes_stock_actual`, `trg_lotes_cmp`, `trg_alerta_stock`, `trg_numero_orden`, `trg_numero_pedido`
  2. Tablas críticas existen
  3. **Invariante stock_actual**: para cada producto activo, `stock_actual ≈ SUM(lotes aprobados con cantidad>0)` con tolerancia 0.001
- Devuelve **503** si algo no cuadra, con muestra de productos descuadrados.
- Llamar tras un restore para verificar integridad.

### Restore atómico: DROP TYPE dinámico (H6.1)
`backup.service.ts restaurarBackup` ya no enumera ENUMs manualmente. Recorre `pg_type WHERE typtype='e'` y borra todos los del esquema public. Aplicado en ambos sitios (script principal + script de rollback). Antes fallaba con cada migración nueva que añadiera ENUMs.

### Stock_actual: trigger es la única fuente (H2.1)
Eliminados los `UPDATE productos SET stock_actual = (SELECT SUM ...)` defensivos en `lotes.routes.ts` (POST, PUT, PATCH /estado). El trigger `fn_trg_lotes_stock_actual` (migración 025) es ahora la fuente autoritativa única. Cierra ventana de inconsistencia bajo concurrencia.

### Auth: token viejo se revoca al refrescar (H2.2)
`POST /api/auth/refresh` ahora hace INSERT en `sesiones_revocadas` con el `jti` viejo + motivo `refresh_rotacion`. Cierra ventana de hasta 4h en que el token viejo seguía siendo válido tras un refresh.

### Pedidos: trabajador no puede manipular precio (H3.2)
`POST /api/pedidos`: si `req.user.rol !== 'admin'`, el servidor **sobrescribe** `precio_unitario` de cada línea con `productos.precio_venta` del catálogo. Ignora lo que envíe el body.

**Edge case**: producto sin `precio_venta` configurado (NULL o 0):
- Fallback `?? 0` para evitar NaN en el total
- `logger.warn` con producto + usuario para que el admin lo arregle
- NO bloquea la creación del pedido

### Albaranes: enviar restringido a admin (H3.1)
`POST /api/pedidos/:id/enviar-albaran` → `adminOnly`. Operario no puede enviar documentos fiscales con precios.

### DELETE produccion: invalida cache (H1.3)
Ambos modos (`borrar` y `revertir`) ahora llaman `invalidarCacheFinanzas()` antes de responder. Evita 60s de KPIs desfasados tras revertir.

---

---

## 0. Tabla de contenidos

1. [Mapa global del sistema](#1-mapa-global-del-sistema)
2. [Tablas core de la BD](#2-tablas-core-de-la-bd)
3. [Triggers SQL automáticos](#3-triggers-sql-automáticos)
4. [Funciones SQL públicas](#4-funciones-sql-públicas)
5. [Crons internos (`setInterval`)](#5-crons-internos-setinterval)
6. [Caches en memoria](#6-caches-en-memoria)
7. [Middlewares](#7-middlewares)
8. [Operaciones por área](#8-operaciones-por-área)
   - [8.1 Productos](#81-productos)
   - [8.2 Lotes / Stock](#82-lotes--stock)
   - [8.3 Recetas](#83-recetas)
   - [8.4 Fabricación (reactor)](#84-fabricación-reactor)
   - [8.5 Envasado](#85-envasado)
   - [8.6 Pedidos](#86-pedidos)
   - [8.7 Albaranes y emails](#87-albaranes-y-emails)
   - [8.8 Clientes / Proveedores](#88-clientes--proveedores)
   - [8.9 Configuración y backups](#89-configuración-y-backups)
   - [8.10 Automatizaciones](#810-automatizaciones)
   - [8.11 Sesión / autenticación](#811-sesión--autenticación)
   - [8.12 Finanzas (lectura)](#812-finanzas-lectura)
9. [Auditoría](#9-auditoría)
10. [Matriz de permisos por rol](#10-matriz-de-permisos-por-rol)
11. [Notas operativas para el desarrollador](#11-notas-operativas-para-el-desarrollador)

---

## 1. Mapa global del sistema

```
┌────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                           │
│  Productos, Lotes, Pedidos, Producción, Finanzas, Recuento, etc.   │
└────────────────────────────────────────────────────────────────────┘
                              │ HTTPS
┌────────────────────────────▼───────────────────────────────────────┐
│                     BACKEND (Express + TS)                          │
│                                                                     │
│   middlewares: traceId → rateLimit → cors → auth → adminOnly       │
│                                                                     │
│   routes ──► controllers ──► services ──► db/pool                  │
│                                                                     │
│   crons (setInterval): sweepPedidos, sweepStockReglas,             │
│                        retryEmailProveedor, backupNocturno          │
└────────────────────────────────────────────────────────────────────┘
                              │ pg connection pool
┌────────────────────────────▼───────────────────────────────────────┐
│                       PostgreSQL                                    │
│                                                                     │
│   triggers: fn_trg_lotes_stock_actual (lotes → productos.stock)    │
│             fn_trg_lotes_cmp           (lotes → productos.CMP)      │
│             fn_check_alerta_stock      (stock_moves → notifs)       │
│             fn_set_updated_at          (updated_at automático)      │
│             fn_numero_orden/pedido/oc  (correlativos automáticos)   │
└────────────────────────────────────────────────────────────────────┘
```

### Observabilidad
- `cron_heartbeat`: heartbeat de los 4 crons internos. Endpoint `/api/health/cron` retorna 503 si alguno cae.
- `auditoria`: log inmutable de operaciones críticas.
- `automatizaciones_log`: log de cada disparo de regla automática.
- `login_logs`: cada intento de login (éxito o fallo).
- `sesiones_revocadas`: jti de tokens JWT invalidados (logout efectivo).

---

## 2. Tablas core de la BD

| Tabla | Propósito | Triggers que la modifican |
|---|---|---|
| `productos` | Catálogo (MP, fabricado, envasado, embalaje) | `fn_trg_lotes_stock_actual` (stock_actual), `fn_trg_lotes_cmp` (coste_medio_actual), `fn_set_updated_at` |
| `lotes` | Stock real por lote, con precio_compra, fechas, estado | `fn_set_updated_at` |
| `stock_moves` | **Inmutable**. Registro de cada movimiento de stock | (none — append only) |
| `recetas` | Plantillas de fabricación / envasado | `fn_set_updated_at` |
| `ingredientes_receta` | Ingredientes de cada receta + cantidades + merma | (none) |
| `ordenes_produccion` | Órdenes de fabricación / envasado | `fn_set_updated_at`, `fn_numero_orden` |
| `pedidos` | Pedidos cliente | `fn_set_updated_at`, `fn_numero_pedido` |
| `lineas_pedido` | Líneas de cada pedido | (none) |
| `reservas_stock` | Reservas de lotes para pedidos confirmados | (none) |
| `pedidos_proveedor` | Órdenes compra a proveedor | `fn_numero_oc` |
| `clientes` / `proveedores` | Maestro | `fn_set_updated_at` |
| `notificaciones` | Alertas stock bajo / caducidad | (none — insertadas por código + trigger alerta) |
| `auditoria` | Log inmutable acciones críticas | (none — append only) |
| `automatizaciones_reglas` | Reglas configuradas | (none) |
| `automatizaciones_log` | Histórico ejecuciones reglas | (none — append) |
| `historial_precios` | Cambios de precios MP/PV | (none — insertado al editar productos) |
| `usuarios` | Cuentas (admin, trabajador) | (none) |
| `login_logs` | Intentos login | (none — append) |
| `sesiones_revocadas` | jti revocados | (none) |
| `cron_heartbeat` | Latido crons internos | (actualizada por código) |
| `configuracion_global` | Config empresa, SMTP, etc. (1 fila) | (none) |
| `configuracion_automatizaciones` | Toggles globales auto (1 fila) | (none) |

> **stock_moves es inmutable** (migración 015). Ninguna operación lo borra ni lo actualiza, solo INSERT. Si necesitas "deshacer" un movimiento, se inserta otro de signo opuesto.

---

## 3. Triggers SQL automáticos

> **CRÍTICO:** todos estos triggers viven en BD. Si alguno se desactiva (migración mal aplicada, restore parcial), el sistema lo nota tarde y mal. Verifícalos siempre tras un restore.

### 3.1 `fn_trg_lotes_stock_actual` — sincroniza `productos.stock_actual`
- **Disparador:** AFTER INSERT/UPDATE/DELETE en `lotes`
- **Cuándo se dispara:**
  - Al INSERT de un lote (entrada de stock, fabricación, envasado)
  - Al UPDATE si cambia `cantidad_actual` o `estado`
  - Al cambiar `producto_id` (raro: recalcula ambos)
  - Al DELETE
- **Qué hace:** ejecuta `fn_recalcular_stock_actual(producto_id)` que pone `productos.stock_actual = SUM(lotes.cantidad_actual WHERE estado='aprobado' AND cantidad_actual > 0)`.
- **Implicación:** los lotes en `cuarentena` o `rechazado` NO suman al stock disponible. El código no debe hacer `UPDATE productos SET stock_actual = ...` manualmente — el trigger es la única fuente autoritativa.
- **Definido en:** `backend/database/migrations/025_stock_actual_trigger_consistencia.sql`

### 3.2 `fn_trg_lotes_cmp` — sincroniza `productos.coste_medio_actual` (CMP)
- **Disparador:** AFTER INSERT/UPDATE/DELETE en `lotes`
- **Qué hace:** ejecuta `fn_recalcular_cmp(producto_id)` que calcula CMP ponderado de los lotes aprobados con stock.
- **Implicación:** si un lote nuevo entra con precio_compra distinto, el CMP del producto se actualiza solo. El campo `productos.coste_medio_actual` es derivado, no se debe escribir manualmente.
- **Definido en:** `migrations/024_cmp_trigger_automatico.sql`

### 3.3 `fn_check_alerta_stock` — alertas tras stock_moves
- **Disparador:** AFTER INSERT en `stock_moves`
- **Qué hace:** comprueba si tras el movimiento `productos.stock_actual <= stock_minimo` y emite señal NOTIFY (sistema legacy; las notifs reales vienen de `alertaService.checkStockMinimo` en código).
- **Definido en:** `database/schema.sql` (función + trigger)

### 3.4 `fn_set_updated_at` — timestamp auto
- **Disparador:** BEFORE UPDATE en: `productos`, `lotes`, `recetas`, `ordenes_produccion`, `pedidos`, `clientes`, `ordenes_compra`
- **Qué hace:** `NEW.updated_at = NOW()`

### 3.5 `fn_numero_*` — correlativos
- `fn_numero_orden`: BEFORE INSERT en `ordenes_produccion` → genera `OP-AAAA-NNNNN`.
- `fn_numero_pedido`: BEFORE INSERT en `pedidos` → genera `PED-AAAA-NNNNN`.
- `fn_numero_oc`: BEFORE INSERT en `ordenes_compra` (legacy) → `OC-AAAA-NNNNN`.
- Todas usan secuencias defensivas con SECURITY DEFINER (migración 022).

### 3.6 `fn_calcular_coste_receta_*` — funciones puras (no son triggers)
Recursivas para calcular coste real / futuro de una receta:
- `fn_calcular_coste_receta(producto_id)` → coste actual desde CMP de MP
- `fn_calcular_coste_receta_futuro(producto_id)` → coste con precios ficha (proyección)

Llamadas desde `/api/finanzas/*`. No modifican datos, solo leen.

### 3.7 Anti-modificación de stock_moves y auditoria
- Migration 015: trigger inmutabilidad `stock_moves` (sólo INSERT permitido).
- Migration 021: trigger inmutabilidad `auditoria` (sólo INSERT permitido).

---

## 4. Funciones SQL públicas

| Función | Devuelve | Uso |
|---|---|---|
| `fn_stock_disponible(producto_id)` | NUMERIC | SUM(cantidad_actual aprobados) — usada en vista `productos_con_disponible` |
| `fn_recalcular_stock_actual(producto_id)` | VOID | Setea `productos.stock_actual = fn_stock_disponible(...)` |
| `fn_recalcular_cmp(producto_id)` | VOID | Setea `productos.coste_medio_actual` ponderado |
| `fn_calcular_coste_receta(producto_id)` | NUMERIC | Coste real producto vía receta + CMP MP |
| `fn_calcular_coste_receta_futuro(producto_id)` | NUMERIC | Coste futuro vía receta + precio ficha MP |
| `fn_actualizar_coste_si_no_manual(producto_id)` | VOID | Recalcula `precio_unitario` si no está en modo manual |

---

## 5. Crons internos (`setInterval`)

Definidos en `backend/src/index.ts`. Cada uno actualiza `cron_heartbeat` al terminar (OK o error).

| Cron | Intervalo | Umbral caída | Función | Efectos |
|---|---:|---:|---|---|
| `sweep_pedidos` | 90 s | 5 min | `sweepPedidos()` | Auto-completar pedidos pendientes + auto-email albaranes |
| `sweep_stock_reglas` | 5 min | 16 min | `sweepStockReglas()` | Disparar reglas de stock bajo (crear OC, fabricación, etc.) |
| `backup_nocturno_tick` | 60 s | 4 min | `tickBackupNocturno()` | Idempotente: solo corre el backup una vez tras la hora programada |
| `retry_email_proveedor` | 5 min | 16 min | `procesarReintentosEmail()` | Reintenta emails proveedor en estado `pendiente_reintento` |

**Si un cron cae:**
- `cron_heartbeat.ultimo_run` deja de actualizarse.
- Endpoint `/api/health/cron` devuelve 503 con detalle.
- Hook `useCronHealth` en frontend dispara toast `notify.error` cada 60 s.
- El backend NO se cae. El cron en cuestión simplemente deja de ejecutar acciones.

---

## 6. Caches en memoria

### 6.1 Cache de Finanzas
- Variable: `resumenCacheByYear` en `routes/finanzas.routes.ts`
- TTL: 60 s
- Indexado por año (selector UI)
- **Función `invalidarCacheFinanzas()`** debe llamarse tras CUALQUIER mutación que afecte al panel de finanzas: ajustes de stock, fabricación, envasado, pedidos, recetas, productos, lotes.

### 6.2 Cache de configuración automatizaciones
- En `automatizaciones.service.ts`, TTL 30 s
- Se invalida con `automatizacionesService.invalidateConfig()` al actualizar `configuracion_automatizaciones`.

### 6.3 Cache de tokens revocados
- En `middleware/auth.ts`, TTL 30 s
- Se invalida vía `invalidateRevocadosCache()` al hacer logout (POST `/api/auth/logout`).

---

## 7. Middlewares

Aplicados en `backend/src/index.ts` en este orden:

1. `helmet` (CSP, HSTS)
2. `compression`
3. `traceIdMiddleware` → req.traceId UUID por request
4. `rateLimit` global → 200 req/min por IP
5. Request logger (`logger.info` para mutaciones)
6. `cors`
7. `express.json({ limit: '1mb' })`
8. `auditoriaMiddleware` → contexto request en `auditoria`
9. `uploadsAuthMiddleware` (uploads protegidos)
10. Por ruta: `authMiddleware` → `adminOnly` (cuando aplica)

### authMiddleware
- Verifica JWT con HS256 pinneado.
- Si tiene `jti` y NO está en `sesiones_revocadas` → continúa.
- Tokens "sistema" (PDF interno, sin jti) → permitidos.
- TTL token: **8 horas**. Refresh proactivo cada 4 h en frontend.

### adminOnly
- Requiere `req.user.rol === 'admin'`. Si no, 403.

---

## 8. Operaciones por área

> **Convención:** cada operación lista
> - 🔐 Permiso (admin / trabajador / público)
> - ✅ Validaciones server-side
> - 📝 Tablas modificadas (en orden cronológico de la transacción)
> - ⚡ Triggers que se disparan
> - 🔄 Hooks post-COMMIT (asíncronos)
> - 🗑️ Cache invalidations
> - 📋 Auditoría
> - ⚠️ Errores frecuentes / casos borde

### 8.1 Productos

#### `POST /api/productos` — Crear producto
- 🔐 admin
- ✅ `validarProductoPayload`: nombre obligatorio, tipo válido, unidad_medida válida (lowercase normalizado), precios ≥ 0 y < 1e9, stock_minimo ≤ stock_maximo
- ✅ Auto-genera código (`MP-001`, `PE-002`, etc.) si no viene
- 📝 INSERT en `productos`
- ⚡ `fn_set_updated_at` (BEFORE UPDATE — no aplica en INSERT)
- 🗑️ `invalidarCacheFinanzas()`
- 📋 No genera fila en `auditoria` (gap menor: deberían registrarse altas).
- ⚠️ 409 si código duplicado.

#### `PUT /api/productos/:id` — Editar producto
- 🔐 admin
- ✅ Comprueba stock_minimo ≤ stock_maximo
- 📝 UPDATE `productos` (incluye `unidades_por_envase`, `peso_unitario_kg`, `peso_plastico_kg`, `precio_coste_manual`)
- 📝 INSERT `historial_precios` si cambió precio_unitario o precio_venta
- 📝 INSERT `auditoria` con `accion='CAMBIO_PRECIO'` si cambió cualquier precio
- ⚡ `fn_set_updated_at` (UPDATE `updated_at`)
- 🔄 Si `reset_coste_auto=true`: ejecuta `fn_actualizar_coste_si_no_manual` y devuelve producto refrescado.
- 🗑️ `invalidarCacheFinanzas()` si cambió precio
- ⚠️ El backend marca `precio_coste_manual=true` automáticamente si `precio_unitario` enviado difiere del calculado por receta. Esto evita que el trigger de costes lo sobrescriba.

#### `DELETE /api/productos/:id` — Eliminar producto
- 🔐 admin
- 📝 UPDATE `productos SET activo=FALSE` (soft delete — preserva referencias FK)
- ⚡ `fn_set_updated_at`
- 🗑️ `invalidarCacheFinanzas()`

#### `POST /api/productos/:id/sds` — Subir ficha de seguridad
- 🔐 admin
- ✅ `multer` valida MIME (PDF) y tamaño
- 📝 UPDATE `productos.sds_url` con la URL del archivo subido
- 📋 Auditoría: ENTRADA en sistema de archivos (`uploads/sds/`)
- ⚠️ El archivo va a disco, no a BD. Si haces backup de BD sin uploads, pierdes los SDS. El `backupService` los incluye via `tar | base64`.

#### `POST /api/productos/importar` — Importar CSV/JSON
- 🔐 admin
- 📝 N × INSERT productos (uno por fila)
- 🗑️ `invalidarCacheFinanzas()`

---

### 8.2 Lotes / Stock

#### `POST /api/lotes` — Crear lote (entrada de stock)
- 🔐 trabajador OK
- ✅ `producto_id` y `cantidad` obligatorios. `cantidad > 0`.
- ✅ Lote interno auto-generado si no viene (`LMP-DDMMYY-XXXX`).
- ✅ `fecha_caducidad` auto-calculada desde `productos.caducidad_meses` si no viene.
- 📝 INSERT `lotes` (estado por defecto = `cuarentena`)
- ⚡ `fn_trg_lotes_stock_actual` recalcula `productos.stock_actual` (sólo si lote es 'aprobado'; en cuarentena queda igual)
- ⚡ `fn_trg_lotes_cmp` recalcula CMP del producto
- 📝 UPDATE `productos.stock_actual = SUM(lotes aprobados)` defensivo (redundante con trigger, hay que limpiar)
- 🔄 Auto-completar `pedidos_proveedor` pendientes del mismo producto (lead-time calculado)
- 📝 INSERT `stock_moves tipo='entrada'` solo si lote es 'aprobado' y cantidad > 0
- 📝 INSERT `auditoria accion='ENTRADA_STOCK'`
- 🗑️ `invalidarCacheFinanzas()` (afecta inmovilizado)
- ⚠️ Si el operario añade lote sin precio (campo oculto para no-admin), `precio_compra` queda NULL → no contribuye a CMP ni a coste futuro.

#### `PUT /api/lotes/:id` — Modificar lote
- 🔐 trabajador OK
- ✅ Cantidad ≥ 0
- 📝 UPDATE `lotes` (cantidad, ubicación, observaciones, precio_compra)
- ⚡ `fn_trg_lotes_stock_actual` (si cambió cantidad o estado)
- ⚡ `fn_trg_lotes_cmp` (si cambió cantidad o precio)
- 📝 INSERT `stock_moves tipo='ajuste'` si cambió cantidad
- 📝 UPDATE `productos.stock_actual` defensivo
- 📝 INSERT `auditoria accion='MODIFICAR_LOTE'`
- 🗑️ `invalidarCacheFinanzas()`

#### `PATCH /api/lotes/:id/estado` — Cambiar estado lote
- 🔐 trabajador puede transiciones simples; **admin obligatorio para cuarentena → aprobado**
- ✅ Estado válido (`cuarentena`, `aprobado`, `rechazado`)
- ✅ Motivo obligatorio
- ✅ Transición permitida (matriz `TRANS_LOTE`)
- ✅ **Si cuarentena → aprobado**: requiere `req.user.rol === 'admin'` + motivo ≥ 10 chars
- 📝 UPDATE `lotes` con nuevo estado
- 📝 Si aprobación REACH: setea `revisor_id`, `revisado_at`, `motivo_revision` (migración 030)
- ⚡ `fn_trg_lotes_stock_actual` (cambio de estado afecta stock_actual)
- ⚡ `fn_trg_lotes_cmp`
- 📝 INSERT `stock_moves`:
  - cuarentena → aprobado: `tipo='entrada'`
  - aprobado → rechazado: `tipo='salida'` (cantidad negativa)
  - aprobado → cuarentena: `tipo='salida'`
- 📝 UPDATE `productos.stock_actual` defensivo
- 📝 INSERT `auditoria accion='CAMBIO_ESTADO_LOTE'`
- 🗑️ `invalidarCacheFinanzas()`
- ⚠️ Operario intentando aprobar cuarentena vía API directa → 403 con mensaje REACH.

#### `GET /api/lotes/:id/historial-estado` — Historial de cambios
- 🔐 cualquier auth
- 📝 Solo lectura: lote + JOIN auditoría + JOIN usuarios
- Devuelve: `revisor` (si pasó por cuarentena→aprobado) + `cambios` (timeline)

#### `POST /api/stock/ajuste` — Ajuste manual stock
- 🔐 admin (acceso vía `/api/stock` que está en authMiddleware solo, **revisar si necesita adminOnly**)
- ✅ Producto existe, lote pertenece al producto si se da, no deja stock negativo
- 📝 UPDATE `productos.stock_actual`
- 📝 UPDATE `lotes.cantidad_actual` con GREATEST(0, ...) si lote_id viene
- ⚡ `fn_trg_lotes_stock_actual` (si modificó lote)
- 📝 INSERT `stock_moves tipo='entrada'|'salida'`
- ⚡ `fn_check_alerta_stock`
- 🗑️ `invalidarCacheFinanzas()` (en `stock.controller.ts`)
- 🔄 SERIALIZABLE + advisory lock por producto

#### `GET/POST /api/stock/reconciliar`
- 🔐 admin (`/api/stock` está actualmente sin adminOnly por endpoint — verificar)
- 📝 Para cada producto donde `stock_actual ≠ SUM(lotes)`:
  - UPDATE `productos.stock_actual` al valor real
  - INSERT `stock_moves tipo='ajuste'` con motivo "Reconciliación"
  - INSERT `auditoria`
- 🗑️ `invalidarCacheFinanzas()`

---

### 8.3 Recetas

> Todas las operaciones de creación/edición/eliminación de recetas e ingredientes son **admin only**.

#### `POST /api/recetas`, `PUT /:id`, `DELETE /:id`
- 🔐 admin
- 📝 INSERT/UPDATE/DELETE `recetas`
- ⚡ `fn_set_updated_at` en UPDATE
- 🔄 Si receta tiene `tipo_receta='fabricacion'` y producto está en modo auto: recalcula `productos.precio_unitario` al editar ingredientes
- 🗑️ `invalidarCacheFinanzas()` (en cada operación)

#### `POST /api/recetas/:id/ingredientes`, `PUT /:id/ingredientes/:ingId`, `DELETE`
- 🔐 admin
- ✅ Validación anti-ciclo (migración 027): un producto no puede aparecer en su propia receta directa o indirectamente
- 📝 INSERT/UPDATE/DELETE `ingredientes_receta`
- 🗑️ `invalidarCacheFinanzas()`
- 🔄 Trigger interno `fn_calcular_coste_receta` recalcula coste

---

### 8.4 Fabricación (reactor)

> Núcleo del ERP. La transacción de `confirmarOrden` es la más compleja del sistema.

#### `POST /api/produccion` — Crear orden borrador
- 🔐 trabajador OK
- ✅ `receta_id` y `cantidad_planificada` obligatorios, > 0
- 📝 INSERT `ordenes_produccion` (estado=`borrador`)
- 📝 Setea `creado_por_id = req.user.id` (migración 034)
- ⚡ `fn_numero_orden` genera `OP-AAAA-NNNNN`
- 🔄 Si `pedido_id` viene: UPDATE pedidos a `en_produccion` + linkar
- 📝 INSERT `auditoria accion='CREAR_ORDEN'`

#### `PUT /api/produccion/:id` — Editar orden (solo borrador/confirmada)
- 🔐 trabajador
- ✅ Solo permite editar si estado IN ('borrador', 'confirmada')
- 📝 UPDATE `ordenes_produccion`
- ⚡ `fn_set_updated_at`

#### `POST /api/produccion/:id/confirmar` — **CONFIRMAR FABRICACIÓN** ⚡
- 🔐 trabajador OK
- ✅ Validaciones server-side previas (en controller):
  - Si receta tiene rangos QC → pH/sólidos/viscosidad obligatorios, sino 400 `QC_OBLIGATORIO`
  - Si receta tiene paso "limpieza" → `registro_limpieza` obligatorio, sino 400 `LIMPIEZA_OBLIGATORIA`
  - QC fuera de rango se calcula y se anota
- 🌐 **Snapshot meteo**: ANTES del BEGIN, fetch a Open-Meteo (timeout 3 s, fail-soft)
- 🔒 **Transacción SERIALIZABLE** + advisory locks por producto:
  1. SELECT FOR UPDATE `ordenes_produccion`
  2. Validación estado IN ('borrador', 'confirmada'), si no → ESTADO_INVALIDO
  3. SELECT receta con rangos QC
  4. **Validación QC server-side**: compara pH/sol/viscosidad contra rangos. Si fuera → `qcOk=false` + nota `desviacionesQC`
  5. SELECT ingredientes
  6. `acquireProductLocks` (advisory locks por producto en orden)
  7. SELECT productos FOR UPDATE (prefetch stocks)
  8. Para cada ingrediente:
     - SELECT `lotes` FOR UPDATE FEFO (excluye reservas activas)
     - Verifica stock total ≥ cantidad necesaria, si no → STOCK_INSUFICIENTE
     - Descuenta lote a lote (UPDATE `lotes.cantidad_actual`)
     - ⚡ `fn_trg_lotes_stock_actual` recalcula `productos.stock_actual` automáticamente
     - ⚡ `fn_trg_lotes_cmp` recalcula CMP
     - INSERT batch `stock_moves tipo='produccion_consumo'` (con `cantidad_antes`/`cantidad_despues`, `orden_id`, `usuario_id`)
     - ⚡ `fn_check_alerta_stock` se dispara por cada INSERT
     - UPDATE `productos.stock_actual` defensivo (será regenerado por trigger; redundante)
  9. SELECT `productos.stock_actual` ANTES (para `cantidad_antes` del PT)
  10. INSERT `lotes` PT con estado `aprobado` o `cuarentena` según QC
  11. ⚡ `fn_trg_lotes_stock_actual` recalcula stock del PT
  12. ⚡ `fn_trg_lotes_cmp` recalcula CMP del PT
  13. SELECT `productos.stock_actual` DESPUÉS
  14. INSERT `stock_moves tipo='produccion_salida'` para PT
  15. UPDATE `ordenes_produccion`:
      - `estado='completada'`
      - `cantidad_real_producida`, `merma_proceso`, `merma_pct`
      - `lote_producido_id`, `fecha_inicio` (cliente o NOW), `fecha_fin=NOW()`
      - `ph`, `solidos`, `viscosidad`, `foto_url`, `foto_urls`, `fecha_fabricacion`
      - `meteo` (JSONB del snapshot)
      - `operario_id = req.user.id` (sobrescribe planificador)
  16. UPDATE `ordenes_produccion.notas` con desviaciones QC + nota_qc del operario
  17. UPDATE `ordenes_produccion.registro_limpieza` y UPDATE `lotes.registro_limpieza`
  18. UPDATE `pedidos SET estado='fabricado'` para los linkados a esta orden
  19. INSERT `auditoria accion='CONFIRMAR_PRODUCCION'`
  20. COMMIT
- 🔄 **Post-COMMIT** (`setImmediate`):
  - `automatizacionesService.intentarAutoAprobacionLote(lotePT, qcOk)` → reglas con trigger `lote_qc_ok`/`lote_qc_fuera_rango`
  - `automatizacionesService.checkStockAndTrigger(prodFinalId)` → reglas stock bajo del producto fabricado
  - Para cada MP consumida: `automatizacionesService.checkStockAndTrigger(mpId)` → reglas stock bajo MP
- 🗑️ `invalidarCacheFinanzas()` (en controller, post-service)
- 🔄 `alertaService.checkStockMinimo()` → INSERT en `notificaciones` si productos cayeron bajo mínimo
- ⚠️ **Errores tras este flujo:**
  - QC fuera de rango → lote en cuarentena → stock_actual no sube hasta aprobación admin
  - Stock_moves NUNCA se borran. Si confirmas mal, hay que cancelar la orden (revierte con stock_moves de signo opuesto).
  - Si cron `sweep_pedidos` está caído → pedidos linkados pasan a `fabricado` pero NO auto-completan.

#### `DELETE /api/produccion/:id?modo=revertir|borrar` — Cancelar/borrar orden
- 🔐 trabajador puede borrar **solo las órdenes que él creó o ejecutó** (`creado_por_id` o `operario_id` = req.user.id)
- 🔐 admin borra cualquiera
- ✅ Pre-check ownership server-side (404 → 403)
- 📝 Si `modo=borrar`:
  - Si orden está en borrador/confirmada → DELETE pedidos.orden_produccion_id link + DELETE orden
  - Si está más avanzada → UPDATE estado='cancelada' (sin revertir stock)
- 📝 Si `modo=revertir` y completada:
  - SERIALIZABLE + advisory locks
  - Carga `stock_moves` de la orden
  - Pre-check: ningún producto cae en negativo tras revertir
  - UPDATE `lotes.cantidad_actual + delta` para cada lote tocado
  - ⚡ Triggers `fn_trg_lotes_stock_actual` y `fn_trg_lotes_cmp` recalculan
  - INSERT batch `stock_moves tipo='ajuste'` con motivo "Reversión"
  - UPDATE `pedidos.orden_produccion_id=NULL, estado='confirmado'` para los linkados
  - UPDATE `ordenes_produccion.estado='cancelada', lote_producido_id=NULL`
  - UPDATE `lotes.estado='rechazado', cantidad_actual=0` para el lote PT
- 📋 No genera fila en `auditoria` (gap menor).
- 🗑️ Sin `invalidarCacheFinanzas()` (gap — debería invalidarse).

---

### 8.5 Envasado

#### `POST /api/produccion/envasado-rapido`
- 🔐 trabajador OK
- 🌐 **Snapshot meteo** antes del BEGIN
- ✅ Cola y cantidad obligatorios
- 🔒 SERIALIZABLE + locks por producto
- 📝 Lock cola + envase (FOR UPDATE ORDER BY id)
- 📝 Calcular `multiplicador`: prioridad `envase.unidades_por_envase` > regex nombre > 1
- 📝 Calcular `pesoEnvase` (kg cola por envase): prioridad `peso_unitario_kg` ficha > regex nombre
- 📝 `pesoTotal = cantidadEnvases × pesoEnvase` (kg cola necesaria)
- 📝 Verificar stock cola, envase, etiqueta
- 📝 INSERT `ordenes_produccion`:
  - `tipo_orden='envasado', estado='completada'`
  - `cola_id, envase_id, formato_label, cantidad_planificada, cantidad_real_producida = totalUnidades`
  - `fecha_inicio` (del cliente o NOW), `fecha_fin = NOW()`
  - `operario_id = req.user.id`
  - `creado_por_id = req.user.id` (rápido = mismo usuario crea y ejecuta)
  - `meteo` JSONB
- ⚡ `fn_numero_orden`
- 📝 Descontar cola FIFO: UPDATE lotes + INSERT stock_moves
- ⚡ `fn_trg_lotes_stock_actual` × N (uno por lote consumido)
- 📝 Descontar envases (cantidadEnvases) + etiquetas (totalUnidades) + materiales extra
- 📝 INSERT `lotes` PE (producto envasado) con coste calculado
- ⚡ `fn_trg_lotes_stock_actual` (entrada PE)
- 📝 INSERT `stock_moves tipo='produccion_salida'` para PE
- 📝 UPDATE orden con `lote_producido_id`
- COMMIT
- 🗑️ `invalidarCacheFinanzas()`
- 🔄 `alertaService.checkStockMinimo([cola_id, envase_id, etiqueta_id, ...materialesExtra])`
- 🔄 Post-COMMIT (`setImmediate`):
  - `automatizacionesService.checkStockAndTrigger(pe.id)` (PE producido)
  - `automatizacionesService.checkStockAndTrigger(materialId)` por cada material consumido

#### `POST /api/produccion/envasado-planificar`
- 🔐 trabajador OK
- 📝 INSERT `ordenes_produccion` con `estado='borrador'`, `tipo_orden='envasado'`, `creado_por_id = req.user.id`
- ⚡ `fn_numero_orden`
- Sin movimiento de stock (solo planifica)

#### `POST /api/produccion/:id/confirmar-envasado`
- 🔐 trabajador OK
- 🌐 **Snapshot meteo** antes del BEGIN
- ✅ Orden existe, tipo_orden='envasado', estado IN ('borrador','confirmada')
- 🔒 SERIALIZABLE
- Igual que envasado-rapido pero usando datos de la orden ya creada
- UPDATE `ordenes_produccion`:
  - `estado='completada'`, `cantidad_real_producida`, `lote_producido_id`
  - `fecha_inicio` (cliente o NOW), `fecha_fin=NOW()`
  - `operario_id = req.user.id`
  - `meteo` JSONB

---

### 8.6 Pedidos

#### `POST /api/pedidos` — Crear pedido
- 🔐 trabajador OK
- ✅ Server-side recalcula totales (subtotal + portes + IVA)
- 🔒 SERIALIZABLE
- 📝 INSERT `pedidos` (estado='confirmado')
- ⚡ `fn_numero_pedido` genera PED-AAAA-NNNNN
- 📝 INSERT `lineas_pedido` (batch)
- 📝 INSERT `reservas_stock` FEFO para cubrir cantidad
- COMMIT
- 🔄 Post-COMMIT: `automatizacionesService.autoFabricarPedido` y `autoCompletarPedido` si toggles activos

#### `PUT /api/pedidos/:id` — Editar pedido
- 🔐 **admin only**
- ✅ Validar transición de estado (matriz `TRANSICIONES_VALIDAS`)
- 📝 UPDATE `pedidos`
- 📝 Si confirmar tras cancelado: re-reservar stock (SERIALIZABLE)
- 📝 Si cancelar: DELETE `reservas_stock`
- 📝 Reemplazo atómico de líneas: DELETE + INSERT batch en transacción
- 📝 Recalcular totales server-side
- ⚡ `fn_set_updated_at`
- 🔄 Post-COMMIT (estados confirmado/fabricado/envasado):
  - `automatizacionesService.autoFabricarPedido`
  - `automatizacionesService.autoCompletarPedido`
  - `automatizacionesService.autoEmailTrazabilidadFabricado` (si fabricado/envasado)

#### `DELETE /api/pedidos/:id` — Cancelar pedido
- 🔐 **admin only**
- 📝 DELETE `reservas_stock` del pedido
- 📝 UPDATE `pedidos.estado='cancelado'`
- ⚡ `fn_set_updated_at`

#### `POST /api/pedidos/:id/consumir` — Consumir stock (completar pedido)
- 🔐 trabajador OK
- ✅ Pedido en estado IN ('confirmado','en_produccion','fabricado','envasado')
- ✅ Cubrir cantidad al 100% con lotes seleccionados
- 🔒 SERIALIZABLE + advisory locks
- 📝 Para cada línea + lote seleccionado:
  - UPDATE `lotes.cantidad_actual -= cantidad`
  - INSERT `stock_moves tipo='salida'` con `pedido_id`
- ⚡ Triggers actualizan stock_actual y CMP
- 📝 UPDATE `reservas_stock SET estado='consumida'` para las del pedido
- 📝 UPDATE `pedidos SET estado='completado'`
- 📝 INSERT `auditoria`
- 🗑️ `invalidarCacheFinanzas()` (afecta facturación)
- 🔄 Post-COMMIT: `alertaService.checkStockMinimo([productos consumidos])`
- 🔄 Si toggle `auto_email_albaran` activo: `automatizacionesService.autoEmailAlbaran(pedidoId)`

#### `POST /api/pedidos/webhook` — Crear pedido público
- 🔐 público (rate-limited por email + IP)
- ✅ Validación payload + lookup cliente por email
- 📝 INSERT pedido + líneas + reservas (igual que POST)
- ⚠️ Endpoint sensible: rate limit 5/min por email + 60/min global por IP

---

### 8.7 Albaranes y emails

#### `GET /api/pedidos/:id/albaran.pdf`
- 🔐 trabajador
- Genera PDF on-the-fly con PDFKit. No modifica BD.

#### `POST /api/pedidos/:id/enviar-albaran`
- 🔐 admin
- 📝 SELECT pedido + cliente + líneas + lotes
- 📝 Genera PDF + adjunta SDS de productos químicos
- ✉️ SMTP envío con nodemailer
- 📝 UPDATE `pedidos.albaran_enviado=TRUE`, `albaran_enviado_at`, `albaran_enviado_a`
- 📝 INSERT `auditoria`
- ⚠️ Tras enviar, `albaran_enviado=TRUE` impide reenvío automático del cron. Endpoint manual permite override.

---

### 8.8 Clientes / Proveedores

> Todas las operaciones CUD son **admin only**.

#### `GET /api/clientes`, `/api/proveedores`
- 🔐 trabajador (lectura OK)

#### `POST/PUT/DELETE /api/clientes`, `/api/proveedores`
- 🔐 **admin only**
- 📝 INSERT/UPDATE/DELETE
- ⚡ `fn_set_updated_at` en clientes

---

### 8.9 Configuración y backups

> Todo bajo `/api/configuracion` requiere `adminOnly`.

#### `POST /api/configuracion/backup`
- 🔐 admin
- ✅ `BACKUP_PASSWORD` env var ≥ 12 chars
- 📝 Crea archivo `backup-AAAA-MM-DD_HH-MM-SS.sql.gz.enc` en `/backups/`:
  - `pg_dump | gzip | openssl aes-256-cbc` (pipeline shell)
  - Incluye `uploads/` vía `tar | base64` con separador
- ✅ **Validación post-creación**: descifra primeros 4 KB y verifica magic header pg_dump. Si falla → borra el archivo nuevo, preserva antiguos.
- 🌐 Si rclone configurado: `rclone copy` a Google Drive (`y:Loga-Backups`). Mantiene 10 más recientes.
- 🗑️ Cleanup local: mantiene 2 más recientes.

#### `POST /api/configuracion/restaurar` — **PROCESO A PRUEBA DE FALLOS**
- 🔐 admin
- ✅ Validación: ruta dentro de BACKUP_DIR + nombre patrón válido + archivo existe
- **Etapa 1: validación previa del backup objetivo**
  - Descifra a `tmp_restore/dump.sql`
  - Comprueba cabecera Y pie del dump (`PostgreSQL database dump complete`). Si truncado → aborta.
- **Etapa 2: pre-backup automático del estado actual**
  - Crea `pre-restore-AAAA-MM-DD_HH-MM-SS.sql.gz.enc` con DB + uploads actuales
  - Si falla la creación → aborta sin tocar BD
- **Etapa 3: restore atómico**
  - psql con `-v ON_ERROR_STOP=1`
  - Script: BEGIN; DROP TABLES + TYPES; <dump original>; COMMIT;
  - Si una sentencia falla → ROLLBACK total → BD intacta
- **Etapa 4: rollback automático**
  - Si etapa 3 falló → restaura el pre-backup automáticamente
  - Si rollback también falla → catastrófico, mensaje al usuario
- **Etapa 5: restore uploads** post-COMMIT (no atómico con DB pero recuperable via pre-backup)
- 📝 No queda en `auditoria` (gap — sería bueno registrar quién restauró).

#### `GET /api/configuracion`, `PUT /api/configuracion`
- 🔐 admin
- 📝 SELECT/UPDATE `configuracion_global` (1 fila id=1)
- 🔄 `automatizacionesService.invalidateConfig()` no se llama aquí — solo cuando se modifica `configuracion_automatizaciones`.

---

### 8.10 Automatizaciones

> Toda la zona `/api/automatizaciones/*` es **admin only**.

#### `GET /api/automatizaciones/config`, `PUT /config`
- 🔐 admin
- 📝 SELECT/UPDATE `configuracion_automatizaciones`
- 🔄 `invalidateConfig()` tras UPDATE

#### `POST /api/automatizaciones/reglas`, `PUT /:id`, `DELETE /:id`, `POST /:id/duplicar`
- 🔐 admin
- 📝 INSERT/UPDATE/DELETE `automatizaciones_reglas`
- 📝 Sincroniza `regla_productos` con productos seleccionados

#### `POST /api/automatizaciones/reglas/:id/ejecutar`
- 🔐 admin
- 🔄 `automatizacionesService.ejecutarReglaManual(reglaId)` — dispara la regla sobre todos sus productos
- 📝 Crea filas en `automatizaciones_log` por cada acción

#### `POST /api/automatizaciones/sistema/:accion/run`
- 🔐 admin
- 🔄 Disparo manual de comportamientos sistema (sweepPedidos, sweepStockReglas, backup, etc.)

#### Sweeps automáticos (no son endpoints HTTP)

##### `automatizacionesService.checkStockAndTrigger(productoId)`
Llamado desde:
- `produccion.confirmarOrden` (post-COMMIT, todos los productos consumidos + el fabricado)
- `envasado-rapido` (post-COMMIT)
- `pedidos.consumir` (post-COMMIT)
- `lotes.actualizar`, `lotes.estado`, `stock.ajustar`
- `sweepStockReglas` cron

Efectos:
- Carga producto + reglas activas con trigger `stock_bajo_minimo` o `stock_cero`
- Para cada regla: ejecuta acción → INSERT `automatizaciones_log`
- Acciones posibles:
  - `crear_orden_compra` → INSERT `pedidos_proveedor` (sin enviar email)
  - `email_proveedor` → INSERT `pedidos_proveedor` + envío SMTP, retry policy
  - `crear_orden_fabricacion` → INSERT `ordenes_produccion` borrador
  - `crear_orden_envasado` → INSERT `ordenes_produccion` borrador

##### `automatizacionesService.autoCompletarPedido(pedidoId)`
Llamado desde: hook tras editar pedido + cron `sweepPedidos`.
- 🔒 SERIALIZABLE + lock pedido NOWAIT
- ✅ Solo si toggle `auto_completar_pedidos_con_stock` ON
- ✅ Pedido en estado IN ('confirmado','fabricado','envasado')
- ✅ Stock disponible (reservas propias + libre)
- 📝 Consume FIFO + UPDATE lotes + INSERT stock_moves
- 📝 UPDATE `reservas_stock SET estado='consumida'`
- 📝 UPDATE `pedidos SET estado='completado'`
- 📝 INSERT `automatizaciones_log`
- 🔄 Encadena `autoEmailAlbaran` si toggle ON

##### `automatizacionesService.autoEmailAlbaran(pedidoId)`
- ✅ `pedido.albaran_enviado === false`
- ✅ Cliente tiene email
- ✅ Filtro de clientes (config) si aplica
- ✉️ Genera PDF + envío SMTP
- 📝 UPDATE `pedidos.albaran_enviado=TRUE`
- 📝 INSERT `automatizaciones_log`

##### `automatizacionesService.autoFabricarPedido(pedidoId)`
- ✅ Toggle `auto_fabricar_desde_pedido` ON
- ✅ Pedido en estado='confirmado', sin orden_produccion_id
- ⚠️ Solo soporta productos tipo `producto_fabricado`. Para envasados loguea `feature_envasado_no_disponible_todavia`.
- 📝 INSERT `ordenes_produccion borrador`
- 📝 UPDATE `pedidos SET orden_produccion_id, estado='en_produccion'`
- 📝 INSERT `automatizaciones_log`

##### `automatizacionesService.tickBackupNocturno()`
- Cada 60 s comprueba si toca backup según `backup_auto_hora`. Idempotente.

##### `automatizacionesService.procesarReintentosEmail()`
- Cron 5 min. SELECT logs `pendiente_reintento` con `next_retry_at <= NOW()`. Reintenta hasta `email_max_reintentos`.

---

### 8.11 Sesión / autenticación

#### `POST /api/auth/login`
- 🔐 público (rate limited)
- ✅ Bloqueo progresivo: 5 fallos → 15 min, 10 → 30 min, ...
- 📝 INSERT `login_logs` (éxito o fallo)
- ✅ Si éxito: genera JWT con `jti` UUID, TTL 8h, HS256

#### `POST /api/auth/logout`
- 🔐 auth
- 📝 INSERT `sesiones_revocadas` con jti del token actual
- 🗑️ `invalidateRevocadosCache()` → próximo authMiddleware refrescará cache

#### `POST /api/auth/refresh`
- 🔐 token expirado válido < 24 h
- ✅ Re-emite token con nuevo jti
- ⚠️ El token viejo sigue válido hasta TTL natural a no ser que se revoque manualmente

#### `POST /api/auth/register`
- 🔐 admin only
- ✅ Política: ≥ 8 chars, mayúscula + número
- 📝 INSERT `usuarios` con `bcrypt.hash(password, 12)`

#### `GET /api/auth/login-logs`
- 🔐 admin
- Solo lectura

---

### 8.12 Finanzas (lectura)

> Toda la zona `/api/finanzas/*` es **admin only**.

#### `GET /api/finanzas/resumen?año=YYYY`
- Cache 60 s por año
- Calcula: facturación, coste producción, beneficio bruto, valor inventario, top productos, mermas, rentabilidad por producto (cheapest-first), inmovilizado, etc.

#### `GET /api/finanzas/impacto-costes`
- No cacheado
- Calcula coste anterior (90d historial) vs futuro (precio ficha) por receta
- Devuelve `precio_stock_min`/`max` por ingrediente (lotes propios o recursivo si granel sin stock)

#### `GET /api/finanzas/informe-plastico?desde&hasta`
- CSV Ley 7/2022
- Multiplica por `unidades_por_envase` para contar botes individuales dentro de cajas
- Marca materiales sin `peso_plastico_kg` configurado

#### `GET /api/finanzas/predicciones` (v2)
- No cacheado. Read-only sobre `pedidos` + `clientes` + `productos`.
- Rango: pedidos `estado='completado'` últimos 2 años, agrupados por par `(cliente_id, producto_id)`.
- Filtro: necesita ≥2 pedidos del par, intervalo > 0, mediana cantidad > 10.
- Devuelve hasta 150 predicciones ordenadas: activos primero → días restantes asc → cantidad total desc.

**Algoritmo** (CTEs `base` → `gaps` → `analisis` → `ultimos`):
- **Decay exponencial** sobre fecha del pedido: `EXP(-(NOW - created_at)/86400/180)`. Pedido de hoy pesa 1.0, hace 180d ≈ 0.37, hace 1 año ≈ 0.13.
- **Intervalo medio ponderado** por decay: `SUM(gap × w_decay) / SUM(w_decay)`.
- **Mediana cantidad** vía `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cantidad)` (anti outlier; el campo de salida sigue llamándose `cantidad_media` por compatibilidad con consumidores existentes).
- **Factor tendencia**: `qty_90d / qty_prev90d`, capado entre 0.5 y 1.5 para evitar valores patológicos.
- **`cantidad_esperada`** = mediana × factor_tendencia (la cifra que se usa en calendario, acciones de email/fabricar/stock).
- **Estado**: `dormido` si `(NOW - ultimo_pedido) > 2 × dias_intervalo`, si no `activo`.
- **`ultimos_pedidos`**: array JSON con los últimos 5 pedidos `{fecha, cantidad}` por par, para timeline en UI.

**Campos clave de la respuesta**:
| Campo | Tipo | Notas |
|---|---|---|
| `cantidad_media` | number | **Es la mediana** (nombre legacy) |
| `cantidad_esperada` | number | mediana × factor_tendencia |
| `dias_intervalo` | int | Ponderado por decay |
| `estado` | `'activo'\|'dormido'` | Filtro principal del calendario |
| `tendencia` | `'subiendo'\|'bajando'\|'estable'` | Umbral ±5% sobre 1.0 |
| `tendencia_pct` | int | `(factor − 1) × 100` |
| `factor_tendencia` | float | 0.5 ≤ x ≤ 1.5 |
| `ultimos_pedidos` | array | Últimos 5, orden DESC |
| `probabilidad` | `'alta'\|'media'\|'baja'` | Sin cambios — basada en `desviacion / intervalo` |

**Side-effects**: ninguno. Solo lectura. No invalida cache. No escribe auditoría (consulta admin habitual).

**Frontend**: consumido por `Dashboard.tsx`. Renderiza:
- Tabs Activos / Recuperar (filtra `estado`).
- Calendario (chips morados): solo `estado === 'activo'`, label usa `cantidad_esperada`.
- Card con timeline expandible (botón "Por qué") — usa `ultimos_pedidos` para chips + gaps calculados en cliente.
- Botones de acción (Sugerir pedido / Fabricar / Ver stock) usan `cantidad_esperada`.

---

## 9. Auditoría

Tabla `auditoria` (inmutable). Cada fila: `id`, `usuario_id`, `accion`, `tabla_afectada`, `registro_id`, `motivo`, `created_at`.

Acciones registradas actualmente:

| Acción | Origen | Cobertura |
|---|---|---|
| `CONFIRMAR_PRODUCCION` | confirmarOrden | ✅ |
| `CREAR_ORDEN` | crearOrden | ✅ |
| `ENTRADA_STOCK` | crear lote | ✅ |
| `MODIFICAR_LOTE` | actualizar lote | ✅ |
| `CAMBIO_ESTADO_LOTE` | PATCH /lotes/:id/estado | ✅ |
| `CAMBIO_PRECIO` | PUT productos | ✅ |
| `ELIMINAR_PRODUCTO` | DELETE producto (soft delete) | ✅ audit v3 |
| `CREAR_PEDIDO` | POST pedidos | ✅ audit v3 |
| `CANCELAR_PEDIDO` | DELETE pedidos | ✅ audit v3 |
| `ELIMINAR_ORDEN_PRODUCCION` | DELETE produccion modo=borrar | ✅ audit v3 |
| `REVERTIR_ORDEN_PRODUCCION` | DELETE produccion modo=revertir | ✅ audit v3 |
| `BACKUP_MANUAL` | POST /configuracion/backup | ✅ audit v3 |
| `RESTORE_BACKUP` | POST /configuracion/restaurar | ✅ audit v3 (registro OK/KO incluso si restore falla) |

**Gaps residuales (sin cobertura aún):**
- DELETE cliente, proveedor, receta (rara vez ocurren — soft delete sin auditoría)
- PUT pedido (edición admin) — debería registrar cambios

**Patrón uniforme aplicado:**
Todos los INSERTs de auditoría usan **fail-soft sin await**:

```ts
pool.query(
  `INSERT INTO auditoria ...`,
  [...]
).catch((e: unknown) => logger.warn('[auditoria NOMBRE]', {
  err: e instanceof Error ? e.message : e
}));
```

Esto garantiza que un fallo en BD al escribir auditoría NUNCA bloquea la respuesta principal ni revierte la operación. Excepción: `RESTORE_BACKUP` usa `await + try/catch` silencioso para registrar antes de responder, pero igualmente no propaga errores al cliente.

---

## 10. Matriz de permisos por rol

| Endpoint / Operación | trabajador | admin |
|---|:-:|:-:|
| **Productos** | | |
| GET listar / detalle | ✓ | ✓ |
| POST/PUT/DELETE | ✗ | ✓ |
| Subir SDS | ✗ | ✓ |
| Ver precio_compra en lotes (filtrado server-side) | ✗ | ✓ |
| **Lotes / Stock** | | |
| GET listar / trazabilidad / historial-estado | ✓ | ✓ |
| POST crear lote (entrada) | ✓ | ✓ |
| PUT modificar lote | ✓ | ✓ |
| PATCH cuarentena → aprobado | ✗ (REACH) | ✓ |
| PATCH otras transiciones | ✓ | ✓ |
| POST stock/ajuste | ✗ | ✓ |
| POST stock/reconciliar | ✗ | ✓ |
| **Recetas** | | |
| GET | ✓ | ✓ |
| POST/PUT/DELETE recetas + ingredientes | ✗ | ✓ |
| **Producción** | | |
| POST crear orden | ✓ | ✓ |
| POST confirmar fabricación | ✓ | ✓ |
| POST confirmar / rápido envasado | ✓ | ✓ |
| DELETE orden propia | ✓ | ✓ |
| DELETE orden ajena | ✗ | ✓ |
| **Pedidos** | | |
| GET listar | ✓ | ✓ |
| POST crear | ✓ | ✓ |
| PUT editar | ✗ | ✓ |
| DELETE cancelar | ✗ | ✓ |
| POST consumir | ✓ | ✓ |
| POST enviar-albaran | ✗ | ✓ |
| **Clientes / Proveedores** | | |
| GET | ✓ | ✓ |
| POST/PUT/DELETE | ✗ | ✓ |
| **Finanzas** | ✗ | ✓ (toda la sección) |
| **Configuración** | ✗ | ✓ (toda) |
| **Recuento** | ✗ | ✓ |
| **Automatizaciones** | ✗ | ✓ |
| **Auth** | | |
| Login / refresh / logout | ✓ | ✓ |
| Register | ✗ | ✓ |
| Login-logs | ✗ | ✓ |

> ✅ Audit v3: `stock/ajuste` y `stock/reconciliar` ahora protegidos con `adminOnly`. El operario conserva acceso a `GET /api/stock` (lectura), notificaciones, historial.

---

## 11. Notas operativas para el desarrollador

### 11.1 Antes de tocar código que afecte stock

Verifica este checklist:

1. **¿Genero `stock_moves`?** Toda mutación de stock debe dejar registro inmutable (auditoría legal).
2. **¿Confío en triggers o hago UPDATE manual?** El sistema usa triggers `fn_trg_lotes_stock_actual` + `fn_trg_lotes_cmp` como fuente de verdad. NO hagas `UPDATE productos SET stock_actual = X` salvo casos específicos como reconciliación.
3. **¿Estoy en SERIALIZABLE?** Toda operación que descuenta stock debe estar en transacción SERIALIZABLE + advisory locks por producto. Sin ello, race conditions casi seguras.
4. **¿Invalido cache finanzas?** Si afecta inmovilizado, facturación, coste o margen → `invalidarCacheFinanzas()`.
5. **¿Disparo `checkStockAndTrigger`?** Si productos pueden caer bajo mínimo tras la operación → llama post-COMMIT en `setImmediate`.
6. **¿Dejo registro en `auditoria`?** Para acciones admin críticas, sí.

### 11.2 Antes de cambiar el flujo de pedidos

- Estado-machine: `nuevo → confirmado → en_produccion/fabricado/envasado → completado` o `→ cancelado`. Está en `TRANSICIONES_VALIDAS` (`pedidos.routes.ts:217`).
- **Solo `completado` cuenta como facturación.** No marques pedidos como completados sin descontar stock real.
- Reservas: al confirmar pedido, reserva FEFO. Al cancelar, libera reservas. Al consumir, marca reservas como `consumida`.

### 11.3 Antes de tocar producción

- `produccion.service.ts confirmarOrden` es la pieza más sensible. Lee comentarios en código antes de modificarla.
- El meteo se captura ANTES del BEGIN para no afectar latencia DB.
- El `operario_id` registra quién confirmó (no quien planificó). `creado_por_id` registra el planificador.
- QC: si receta tiene rangos `ph_min/max`, etc., son OBLIGATORIOS. Si valor está fuera → lote en `cuarentena`.
- Lotes en cuarentena NO suman a `stock_actual` (gracias al trigger 025).

### 11.4 Antes de mover archivos de uploads

`/uploads/` contiene SDS, fotos, archivos adjuntos. Si los borras o reorganizas, las URLs en BD (`productos.sds_url`, `ordenes_produccion.foto_urls`, etc.) quedan rotas. El backup los incluye via tar+base64.

### 11.5 Antes de aplicar migraciones

- Las migraciones están numeradas (`001_*` ... `034_*`). Aplica en orden.
- Algunas son destructivas o costosas (recálculo masivo): correr en mantenimiento.
- Tras aplicar, ejecuta `inspectAllSequences()` para verificar secuencias.

### 11.6 Si un cron deja de funcionar

1. Revisa `/api/health/cron` → identifica cuál cron y cuándo fue su último tick.
2. Mira logs backend: `[auto.sweep]`, `[auto.backup]`, etc.
3. Si la BD está caída → todos los crons fallan, fail-soft.
4. Si solo uno cae → revisa qué hace su `tick` correspondiente y por qué falla.
5. El watchdog frontend (`useCronHealth`) avisa con sileo.error en cada caída.

### 11.7 Si un trigger SQL deja de funcionar

Síntomas:
- `productos.stock_actual` no coincide con SUM lotes aprobados → `fn_trg_lotes_stock_actual` desactivado.
- `productos.coste_medio_actual` no se actualiza al entrar lotes → `fn_trg_lotes_cmp` desactivado.

**Diagnóstico rápido (audit v3):** llamar `GET /api/health/db` con token admin. Devuelve:
```json
{
  "status": "degraded" | "ok",
  "triggers": { "esperados": [...], "activos": [...], "faltantes": [...] },
  "tablas": { "esperadas": [...], "faltantes": [...] },
  "stock_drift": {
    "productos_descuadrados": N,
    "muestra": [{ "codigo": "MP-001", "stock_actual": X, "suma_lotes": Y, "delta": ... }]
  }
}
```
Si `triggers.faltantes` no está vacío o `stock_drift.productos_descuadrados > 0` → algo falló (probablemente migración mal aplicada o restore incompleto).

Verificación manual:
```sql
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'lotes';
```

Reactivación: re-aplicar migraciones 024 y 025 idempotentemente.

### 11.8 Performance hotspots conocidos

- `Recuento.tsx cargar()`: ahora 2 requests paralelos. Soporta hasta ~500 lotes aprobados (LIMIT del endpoint). Más → paginar.
- `produccion.confirmarOrden`: O(N ingredientes × M lotes por ingrediente) en INSERT stock_moves. Batch insertion ya implementado. Para recetas con 20+ MP × 50+ lotes, considerar paralelización.
- `finanzas.impacto-costes`: bucle recursivo de `fn_calcular_coste_receta_futuro` puede ser lento con grafos profundos de recetas anidadas. Considera cachear o pre-calcular si crece.

### 11.9 Próximas mejoras pendientes (según auditoría)

- DELETE produccion sin auditoría (gap)
- Cleanup automático de `sesiones_revocadas` (cron diario)
- Cleanup automático de `automatizaciones_log` (>90 días)
- Política passwords más estricta (10 chars + símbolo)
- Versionado SDS para auditoría REACH
- Sensor meteo on-site (Open-Meteo es estimación regional)
- Pre-aviso al admin cuando cron lleva varios fallos consecutivos

---

> **Nota final:** este documento es una foto del estado actual (post migrations 030-034). Cada vez que añadas o modifiques un endpoint, actualiza la sección correspondiente. La verdad está en el código — este doc es derivado pero ayuda a navegarlo.
