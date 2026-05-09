# Manual de Usuario — Colas Loga ERP

## Indice

0. [Notificaciones del sistema](#0-notificaciones-del-sistema)
1. [Productos](#1-productos)
2. [Recetas](#2-recetas)
3. [Lotes y Stock](#3-lotes-y-stock)
4. [Fabricacion (Reactor)](#4-fabricacion-reactor)
5. [Envasado](#5-envasado)
6. [Pedidos](#6-pedidos)
7. [Dashboard y Calendario](#7-dashboard-y-calendario)
8. [Clientes](#8-clientes)
9. [Finanzas](#9-finanzas)
10. [Configuracion y Administracion](#10-configuracion-y-administracion)
11. [Automatizaciones](#11-automatizaciones)
12. [Uso desde movil](#12-uso-desde-movil)

---

## 0. Notificaciones del sistema

Todas las acciones de la aplicacion (crear, editar, eliminar, planificar, fabricar, envasar, consumir, enviar email, hacer backup, etc.) generan una **notificacion visual** en la parte **inferior central** de la pantalla. No hay alertas tipo `alert()` del navegador — todo es feedback en la interfaz.

### Tipos de notificacion

| Tipo | Color del estado | Cuando aparece |
|------|------------------|----------------|
| **Cargando** | Gris animado | Mientras dura la operacion (ej: "Guardando…", "Fabricando…") |
| **Exito** | Verde | Al completar correctamente. Incluye detalle de lo guardado (nombre, codigo, cantidad, total, etc.) |
| **Error** | Rojo | Si la operacion falla. Muestra el motivo exacto del servidor |
| **Aviso** | Ambar | Stock bajo, lote en cuarentena por QC, sesion proxima a caducar |
| **Info** | Azul | Sesion cerrada, mensajes informativos |

### Caracteristicas

- **Pill que se despliega**: la notificacion aparece como una pildora compacta con el titulo. A los 150 ms se despliega automaticamente a una tarjeta mas grande con la descripcion (animacion gooey morphing). Tras unos segundos colapsa de nuevo y desaparece.
- **Una sola operacion = una sola notificacion**: la notificacion de "Cargando…" se transforma en exito o error al terminar. No quedan notificaciones huerfanas.
- **Contenido enriquecido**: las notificaciones de exito muestran detalle del registro afectado (ej: al confirmar un pedido se ven las lineas del pedido y el total dentro del propio toast).
- **Boton de accion** (opcional): algunas notificaciones incluyen un boton para navegar al detalle (ej: "Ver detalle" tras fabricar).
- **Hover pausa**: al pasar el raton (o tocar en movil) por encima, el temporizador se pausa hasta que apartas el dedo.
- **Swipe para descartar**: en movil, deslizar la notificacion hacia abajo la cierra inmediatamente.
- **Posicion movil**: en pantallas pequenas la notificacion se eleva por encima de la barra inferior de navegacion para no taparla, y respeta el safe-area del notch/home indicator.
- **Stock bajo automatico**: tras cualquier operacion que consuma stock (fabricar, envasar, consumir pedido), si algun producto queda por debajo del stock minimo, salta una notificacion de aviso con la lista de productos afectados (codigo, nombre, stock actual). Throttled a 1 alerta cada 8 segundos para evitar spam.
- **Spinner de envio de email**: durante el envio de pedidos a proveedor o albaranes a cliente, el spinner es el logo de Loga llenandose y vaciandose en bucle.

### Acciones que generan notificacion

A continuacion aparece una lista de las acciones notificadas. Las marcadas con (rich) muestran detalle ampliado dentro del propio toast.

**Productos**
- Crear / editar producto (rich: nombre + codigo)
- Eliminar producto
- Anadir stock manual a un producto (rich: nombre + cantidad anadida + unidad)

**Recetas**
- Crear / editar / duplicar receta de fabricacion o envasado (rich: nombre + producto)
- Eliminar receta
- Anadir / eliminar ingrediente

**Lotes y stock**
- Crear lote (entrada de stock)
- Cambiar estado del lote (rich: lote + nuevo estado + motivo)
- Ajuste manual de stock
- Reconciliar stock

**Fabricacion**
- Planificar nueva orden (rich: receta + cantidad + cliente + fecha)
- Fabricar (rich: lote producido + cantidad real + duracion en minutos + boton "Ver detalle")
- Lote en cuarentena por QC fuera de rango (warning)
- Eliminar / revertir orden

**Envasado**
- Planificar envasado
- Envasado rapido y planificado (rich: producto + unidades producidas)
- Errores de stock con lista de materiales que faltan

**Pedidos**
- Crear / editar pedido (rich: cliente + numero de lineas + total EUR)
- Cambiar estado del pedido (rich: cliente + lista de lineas con cantidad + total)
- Consumir stock (rich: numero de pedido completado)
- Cancelar pedido
- Enviar albaran por email (loading "Enviando…" → "Email enviado")
- Descargar albaran PDF

**Clientes / Proveedores**
- Crear / editar / eliminar (rich: nombre)

**Configuracion**
- Guardar configuracion general
- Probar conexion SMTP (success o error de conexion)
- Backup manual (rich: tamano + fecha)
- Restaurar backup

**Sesion**
- Login correcto (rich: bienvenida con nombre del usuario)
- Credenciales invalidas
- Logout (info: "Sesion cerrada") — el token se revoca server-side, no solo se borra del navegador
- Sesion caducada (warning antes de logout automatico)
- Cron caido (error persistente con nombre del cron y minutos sin ejecutar)

---

## 1. Productos

### Tipos de producto

| Tipo | Descripcion | Ejemplo | Unidad habitual |
|------|------------|---------|-----------------|
| **Materia Prima** | Lo que se compra a proveedores | Acetato de Vinilo, Agua, PVOH | kg, L |
| **Producto Fabricado** | Cola granel salida del reactor | Cola Blanca D2, Cola Autoadhesiva | kg |
| **Producto Envasado** | Cola metida en bote/garrafa lista para vender | Cola D2 Frasco 75g, Logalkyl Bote 1kg | ud |
| **Material Embalaje** | Envases, cajas, etiquetas, tapones | Frasco 75g + tapon, Caja 18 uds, Etiqueta D2 | ud |

### Como crear un producto

1. Ir a **Productos** en el menu lateral
2. Pulsar **Nuevo producto** (arriba a la derecha)
3. Rellenar los campos:
   - **Codigo**: identificador unico (ej: PT-CB-001, ME-005, PE-003)
   - **Nombre**: nombre completo del producto
   - **Tipo**: seleccionar de la lista
   - **Unidad de medida**: kg, L, ud
   - **Precio de compra**: lo que pagas al proveedor (por unidad)
   - **Precio de venta**: lo que cobras al cliente (por unidad)
4. Pulsar **Guardar**

### Campos especiales para productos envasados

- **Peso unitario kg**: peso NETO de cola que lleva dentro cada unidad. Ej: Frasco 75g → poner 0.075
- **Cola que lleva dentro (granel_id)**: la cola fabricada que se mete dentro. Se asigna automaticamente al crear la receta de envasado

### Campos opcionales utiles

- **Stock minimo**: cuando el stock baja de este valor, aparece alerta naranja. Las alertas se disparan automaticamente tras cada fabricacion, envasado o consumo de pedido
- **Stock maximo**: para calcular cuanto pedir al proveedor
- **Caducidad (meses)**: vida util desde la fecha de fabricacion
- **Proveedor**: enlaza con la ficha del proveedor para pedidos automaticos
- **Peso plastico (kg)**: gramos de plastico por unidad del envase, necesario para el Informe de Plasticos (Ley 7/2022)

### Subir Ficha de Seguridad (SDS)

Para materias primas y productos quimicos, es obligatorio tener la ficha de seguridad accesible:

1. Ir a **Productos** > buscar el producto
2. Editar el producto
3. En la seccion de archivos, pulsar **Subir PDF de Seguridad**
4. Seleccionar el archivo PDF de la ficha SDS del proveedor
5. Una vez subido, aparece un icono de PDF rojo junto al producto

El icono de SDS aparece automaticamente:
- En la lista de materias primas en la pagina de productos
- Al lado de cada ingrediente en el modal de fabricacion, para que el operario pueda consultarlo con un clic antes de volcar el material

### Editar o desactivar producto

1. En la lista de productos, pulsar el **lapiz** en la fila del producto
2. Modificar los campos necesarios
3. Para desactivar: desmarcar "Activo". El producto deja de aparecer en listados pero mantiene su historial

---

## 2. Recetas

El sistema tiene dos tipos de recetas: **fabricacion** (reactor) y **envasado** (meter cola en botes).

### 2.1 Recetas de fabricacion

Definen la formula del reactor: que materias primas y en que cantidad para producir una tanda de cola granel.

**Como crear una receta de fabricacion:**

1. Ir a **Recetas** > tab **Fabricacion**
2. Pulsar **Nueva Receta**
3. Rellenar:
   - **Nombre**: ej "Cola Blanca D2 Standard"
   - **Rendimiento**: kg que salen por tanda (ej: 1000 kg)
4. Pulsar **Guardar**
5. Ahora se pueden **anadir ingredientes**:
   - Expandir la receta pulsando en ella
   - Pulsar **+ Ingrediente**
   - Buscar la materia prima (ej: "Acetato de Vinilo")
   - Indicar cantidad (ej: 460 kg) y % merma (ej: 2%)
   - Repetir para cada ingrediente

**Pasos del proceso (opcional):**

Se pueden definir los pasos del reactor paso a paso:
- Fase (Preparacion, Reaccion, Aditivos, Enfriamiento, Control)
- Titulo (ej: "Cargar agua al reactor")
- Descripcion
- Temperatura objetivo
- Duracion estimada

Estos pasos se muestran al operario durante la fabricacion.

**Control de calidad:**

Definir rangos aceptables de:
- pH (ej: 6.5 - 7.5)
- Solidos % (ej: 48 - 55)
- Viscosidad mPa·s (ej: 3000 - 5000)

> **Importante**: Estos rangos se validan automaticamente al confirmar la fabricacion. Si algun valor medido esta fuera del rango definido, el lote se crea automaticamente en estado **Cuarentena** en lugar de Aprobado, y se anade una nota a la orden indicando que parametros estan desviados. El operario recibe un aviso visual antes de que se complete el proceso. Ver seccion 4 para mas detalle.

### 2.2 Recetas de envasado

Definen que lleva cada producto envasado: que cola va dentro, que envase se usa, y que materiales extra (cajas, etiquetas).

**Como crear una receta de envasado:**

1. Ir a **Recetas** > tab **Envasado**
2. Pulsar **Nueva receta**
3. Rellenar:
   - **Nombre**: ej "Logalkyl Bote 1kg"
   - **Producto final**: buscar y seleccionar el producto envasado (ej: "Logalkyl Bote 1kg")
   - **Cola que lleva dentro**: se auto-selecciona segun el producto. Se puede cambiar manualmente
   - **Envase**: buscar el material de embalaje (ej: "Bote PET 1 kg con tapon seguridad")
   - **Materiales extra**: pulsar "+ Anadir" para cajas, etiquetas, etc.
4. Pulsar **Crear receta**

> **Importante**: La receta de envasado se carga automaticamente cuando planificas un envasado o usas el envasado rapido. No tienes que recordar que cola lleva cada producto.

**Editar una receta de envasado:**

1. En la lista de recetas de envasado, pulsar el **lapiz**
2. Modificar cola, envase o materiales
3. Pulsar **Guardar**

---

## 3. Lotes y Stock

### Que es un lote

Un lote es una cantidad concreta de un producto que entro en el almacen en un momento determinado, con su propio precio de compra y fecha de caducidad. El sistema lleva la trazabilidad lote por lote.

### Como dar entrada a material (crear lote)

1. Ir a **Stock** en el menu lateral
2. Pulsar **Nuevo lote**
3. Rellenar:
   - **Producto**: buscar el producto
   - **Cantidad**: cuantos kg/ud entran
   - **Precio de compra**: precio unitario de esta entrada
   - **Lote interno**: codigo del lote (se auto-genera si lo dejas vacio)
   - **Lote proveedor**: referencia del proveedor (opcional)
   - **Fecha caducidad**: si aplica
4. Pulsar **Guardar**
5. El lote se crea en **Cuarentena**

### Aprobar un lote

1. En la lista de lotes, buscar el lote en cuarentena
2. Pulsar **Cambiar estado**
3. Seleccionar **Aprobado** e indicar motivo
4. El stock del producto se actualiza automaticamente

> Solo los lotes aprobados cuentan para el stock disponible. Los lotes en estado **cuarentena** o **rechazado** NO suman al stock — están reservados para producto fuera de spec o pendiente de revisión.

### Aprobacion de lote en cuarentena (auditoria REACH)

Cuando un lote esta en cuarentena (QC fuera de rango o entrada manual sin aprobar), su aprobacion exige:

- **Solo administrador**: la transicion `cuarentena → aprobado` esta restringida server-side a usuarios con rol `admin` (responsable de calidad autorizado). Un trabajador no puede aprobar lotes desviados aunque conozca el endpoint API. Cumple normativa REACH.
- **Motivo obligatorio de minimo 10 caracteres**: explicar por que se aprueba pese a la desviacion. Ejemplo: "Revisado por laboratorio externo, valor de pH 4.2 dentro de tolerancia ampliada para esta receta. Aprobado por jefe de calidad."
- **Revisor automatico**: el sistema registra al usuario logueado como revisor y la fecha/hora exacta. No se puede aprobar sin sesion identificada.
- **Trazabilidad permanente**: el motivo y el revisor quedan en la ficha del lote (`revisor_id`, `revisado_at`, `motivo_revision`) para auditoria REACH y de calidad.

> Si un trabajador intenta aprobar un lote en cuarentena, recibe error 403 con mensaje explicativo sobre normativa REACH. Si el motivo introducido es menor de 10 caracteres, el sistema rechaza la operacion con un aviso.

### Rechazar un lote

1. Cambiar estado a **Rechazado** con motivo
2. El stock se descuenta automaticamente
3. Un lote rechazado no se puede volver a aprobar

### Ajustar stock manualmente

1. **Stock** > **Ajuste de stock**
2. Seleccionar producto y lote
3. Indicar nueva cantidad y motivo
4. Se crea un registro de ajuste en stock_moves para trazabilidad

### Reconciliar stock

Si sospechas que hay discrepancias entre el stock mostrado y los lotes reales:
1. **Configuracion** > **Reconciliar stock** (o `GET /api/stock/reconciliar`)
2. Muestra productos con diferencia entre stock_actual y suma de lotes
3. Puedes corregir automaticamente pulsando **Reconciliar**

> **Trazabilidad garantizada**: Cada correccion de reconciliacion genera automaticamente un registro en stock_moves de tipo **ajuste** con el motivo "Ajuste automatico via Reconciliacion", el usuario que lo ejecuto y las cantidades antes/despues. La cadena de auditoria nunca se rompe.

### Consumo FEFO (First Expiry, First Out)

Todo consumo de stock (fabricacion, envasado, pedidos) sigue orden FEFO:
1. **Primero**: lotes que caducan antes (los mas urgentes)
2. **Segundo**: a igualdad de caducidad (o sin caducidad), el mas antiguo por fecha de entrada
3. Los lotes sin fecha de caducidad se consumen en ultimo lugar
4. Se puede ver que lotes se van a usar antes de confirmar cualquier operacion

> **Nota**: FEFO es una variante de FIFO optimizada para productos quimicos con fecha de caducidad. Garantiza que el material mas proximo a caducar se usa primero, cumpliendo con buenas practicas de almacenamiento industrial y regulacion REACH.

### Reservas de stock

Al crear un pedido, el sistema reserva lotes FEFO para ese pedido dentro de una transaccion SERIALIZABLE con bloqueo de filas:
- La reserva **no resta** stock fisico
- Pero **impide** que otro pedido use esos mismos lotes
- Las reservas se liberan automaticamente al completar o cancelar el pedido
- **Proteccion contra doble reserva**: Si dos usuarios crean pedidos simultaneamente, la transaccion serializable garantiza que no se reserven los mismos lotes

### Alertas automaticas de stock

Las alertas se generan **automaticamente** cada vez que se completa una fabricacion, un envasado o un consumo de pedido:
- **Stock bajo**: cuando el stock cae por debajo del minimo configurado en el producto
- **Sin stock**: cuando el stock llega a cero
- **Caducidad**: alerta 30 dias antes de que un lote caduque

Las notificaciones aparecen al instante en el Dashboard sin necesidad de pulsar ningun boton. Tambien se pueden forzar manualmente desde Configuracion > Recheck alertas.

---

## 4. Fabricacion (Reactor)

### Proceso completo paso a paso

**Paso 1: Crear orden de fabricacion**

1. Ir a **Produccion** > tab **Fabricacion**
2. Pulsar **Nueva Fabricacion**
3. Paso 1 del formulario: **Seleccionar receta** (ej: "Cola Blanca D2 Standard")
4. Paso 2: **Cantidad** a producir (ej: 1000 kg), **fecha** planificada, **cliente** (opcional)
5. Paso 3: **Notas** y confirmar
6. Pulsar **Crear Orden**
7. La orden aparece en la lista como **borrador**

**Paso 2: Fabricar**

1. En la lista de ordenes, pulsar el boton rojo **Fabricar** en la orden
2. Se abre el **modal de fabricacion** paso a paso:
   - **Vista del reactor**: animacion del tanque rojo que se va llenando
   - **Ingredientes**: lista de materias primas necesarias con:
     - Cantidad exacta de cada una
     - Lotes FEFO que se van a usar (con lote_interno y cantidad de cada uno)
     - Indicador verde si hay stock suficiente, rojo si falta
   - **Pasos del proceso**: si la receta tiene pasos definidos, se muestran uno a uno
3. Rellenar datos de calidad:
   - **pH**: valor medido
   - **Solidos %**: porcentaje de solidos
   - **Viscosidad**: viscosidad medida
4. **Cantidad real producida**: si se produjeron menos kg de los planificados (merma)
5. **Fotos**: se pueden adjuntar fotos del proceso
6. Pulsar **Confirmar fabricacion**

**Paso 3: Que pasa al confirmar**

Todo ocurre en una unica transaccion atomica (si algo falla, no se hace nada):
1. Se verifican stocks de TODOS los ingredientes
2. Se descuentan materias primas de lotes FEFO
3. Se crean stock_moves para cada consumo (trazabilidad)
4. **Validacion de Control de Calidad**: se comparan pH, solidos y viscosidad contra los rangos definidos en la receta:
   - **Dentro de rango**: se crea un nuevo lote de cola granel en estado **Aprobado**
   - **Fuera de rango**: se crea el lote en estado **Cuarentena** y se anade nota automatica a la orden indicando que parametros estan desviados. El operario ve un aviso en pantalla explicando la desviacion
5. El lote se crea con:
   - Cantidad = lo realmente producido
   - Precio = coste total ingredientes / cantidad producida
6. Se actualiza stock del producto fabricado
7. Se calcula merma si la cantidad real difiere de la planificada
8. Si habia un pedido vinculado, pasa a estado "fabricado"
9. **Alertas automaticas**: el sistema comprueba si algun ingrediente ha bajado del stock minimo y genera notificacion instantanea
10. **Tiempo de fabricacion**: se guarda automaticamente la duracion real (`fecha_inicio` = momento en que se abrio el modal de Fabricar; `fecha_fin` = momento en que se confirmo). Estos datos solo se registran si la fabricacion se completa con exito. Si el operario abre el modal y lo cierra sin confirmar, no se guarda nada y el cronometro empieza de cero la siguiente vez.
11. **Snapshot meteorologico automatico**: justo antes de iniciar la transaccion, el sistema consulta Open-Meteo (gratuita, sin API key) para capturar las condiciones climaticas exteriores en la fabrica en ese momento exacto: temperatura, humedad, sensacion termica, precipitacion, codigo WMO del cielo, presion atmosferica, velocidad/direccion/rafagas de viento. Se guarda como JSONB en `ordenes_produccion.meteo` junto al resto de datos de la orden. Si la API falla (sin red, timeout 3s, error HTTP), `meteo` queda en NULL y la fabricacion continua igualmente — **nunca bloquea la orden**. El operario no ve nada durante el proceso; solo aparece un texto pequeno en la tarjeta de detalle de la orden completada (ej: `21.4°C · 68% HR · 14.5 km/h`). Permite analizar correlaciones futuras entre meteo y mermas / desviaciones QC.
12. **Registro de quien hizo la orden + duracion (visible solo a admin)**: al pulsar Confirmar fabricacion o Confirmar envasado, el sistema persiste el `operario_id` del usuario logueado en ese momento (sobrescribe el operario asignado al planificar — manda quien ejecuta). Tambien guarda `creado_por_id` (quien creo la orden originalmente), `fecha_inicio` (apertura del modal) y `fecha_fin` (confirmacion). En el panel de detalle de la orden:
    - **Si entras como admin**: ves "Hecha por <Nombre> · Duracion 47 min 12s" (y "(admin)" si quien ejecuto era admin).
    - **Si entras como trabajador (operario)**: NO ves nada de eso. Solo ves los datos tecnicos (pH, solidos, viscosidad, lote, fecha) sin saber quien la hizo ni cuanto tardo.
    - **Defensa server-side**: el endpoint `GET /api/produccion/:id/detalle` borra los campos `operario_id`, `operario_nombre`, `operario_rol` y `duracion_segundos` del JSON respuesta cuando el usuario no es admin. Inspeccionar Network en DevTools no devuelve esos datos.
    - **Para que la duracion sea util**: el modal de fabricacion del frontend manda `fecha_inicio_cliente` (timestamp en que el operario abrio el modal). Si no se manda, fecha_inicio queda como NOW() y la duracion sale 0 (no se muestra). En envasado planificado tambien se acepta este campo; en envasado rapido la duracion es ≈ 0 (proceso en una sola pulsacion).

**Tiempo de fabricacion (recopilacion automatica):**

Crear una nueva planificacion no inicia el cronometro. El cronometro empieza cuando se pulsa el boton **Fabricar** (se abre el modal) y se detiene cuando la fabricacion se confirma con exito. Permite calcular:
- Duracion real por orden (`fecha_fin - fecha_inicio`)
- Tiempo medio de fabricacion por receta
- Productividad por operario (cruzando con `operario_id`)

Consulta SQL ejemplo para ver duraciones:
```sql
SELECT numero_orden, fecha_inicio, fecha_fin, fecha_fin - fecha_inicio AS duracion
FROM ordenes_produccion
WHERE estado = 'completada' AND fecha_inicio IS NOT NULL
ORDER BY fecha_fin DESC;
```

**Registro de Limpieza (Medioambiente):**

Si la receta incluye un paso de tipo **Limpieza**, al confirmar la fabricacion aparece un cuadro de texto obligatorio:

- **Que anotar**: agente usado (agua caliente, sosa, disolvente), volumen aproximado y destino del residuo (depuradora, gestor autorizado)
- **Trazabilidad**: este comentario se adjunta permanentemente al lote producido y a la orden, para auditorias medioambientales
- **Obligatorio**: no se puede cerrar la fabricacion sin completar este registro
- **Ejemplo**: "Limpieza con 200L agua caliente a 80C. Residuo enviado a depuradora municipal. Aclarado final con 50L agua limpia."

**Consulta de Fichas de Seguridad (SDS):**

En el listado de ingredientes del reactor, veras un icono de PDF rojo junto a cada materia prima que tenga ficha de seguridad cargada:
- Pulsa el icono para abrir la ficha de seguridad oficial en una nueva pestana
- Usalo para verificar los EPIs necesarios (guantes, mascarilla, gafas) antes de manipular el producto
- Las fichas SDS se suben desde **Productos** > editar producto > **Subir PDF de Seguridad**

**Merma:**

Si planificas 1000 kg pero produces 980 kg:
- Merma = 20 kg (2%)
- Se registra en la orden
- Aparece en Finanzas valorada en EUR (20 kg x coste/kg)
- El coste por kg del producto SUBE porque gastaste las mismas materias primas para menos producto

**Control de calidad fuera de rango:**

Si los valores de pH, solidos o viscosidad estan fuera de los rangos definidos en la receta:
- La fabricacion se completa normalmente (materias primas descontadas, stock_moves creados)
- Pero el lote resultante queda en estado **Cuarentena** en lugar de Aprobado
- **El stock del producto fabricado NO sube hasta que el lote sea aprobado**: la cantidad fabricada queda registrada en el lote pero no aparece como disponible para vender ni envasar. Esto evita que el material fuera de spec llegue al cliente por error.
- El operario recibe un aviso en pantalla indicando que parametros estan desviados
- Se anade una nota automatica a la orden: "Lote desviado de parametros de calidad: pH 4.0 fuera de rango [6.5-7.5]"
- Un responsable de calidad debe ir a **Lotes** y aprobar (con motivo ≥10 caracteres) o rechazar el lote manualmente tras revision (ver seccion 3)
- Cuando se aprueba el lote desde cuarentena, el stock del producto sube automaticamente con la cantidad fabricada y se registra el revisor + motivo en la ficha del lote

---

## 5. Envasado

### Que es envasar

Envasar = coger cola granel del deposito y meterla en botes, garrafas, bidones o sacos. El sistema descuenta la cola granel, los envases vacios y los materiales, y crea stock del producto envasado.

### Dos formas de envasar

#### A) Envasado planificado (recomendado)

Para cuando quieres planificar el envasado con antelacion.

1. Ir a **Produccion** > tab **Envasado** > **Planificar envasado**
2. **Producto final**: buscar el producto envasado (ej: "Cola D2 Frasco 75g"). Todos los selectores son buscables y no importan las tildes.
3. La **cola** se auto-selecciona desde la receta de envasado. Si no hay receta, usa la asignacion del producto.
4. **Envase**: seleccionar el material (ej: "Frasco 75g + tapon" o "Caja 18 uds (75g)")
5. **Cantidad**: numero de unidades o cajas
6. **Materiales extra**: anadir etiquetas, cajas, etc. pulsando "+ Anadir material"
7. Opcionalmente: fecha planificada y cliente
8. Pulsar **Planificar envasado**
9. Se crea la orden como **borrador** en la lista de envasado

**Ejecutar la orden:**

1. En la lista, pulsar el boton verde **Envasar**
2. Se muestra **pantalla de confirmacion con lotes**:
   - Lista de TODO lo que se va a consumir
   - Para cada material: nombre, cantidad necesaria, lotes FEFO que se usaran
   - Indicador verde/rojo si hay stock suficiente
3. Si todo esta OK, pulsar **Envasar X ud**
4. Animacion del tanque llenando el bote
5. Resultado: producto creado, lote asignado, cantidad
6. **Alertas automaticas**: el sistema comprueba stock de cola, envases y etiquetas tras completar

#### B) Envasado rapido

Para cuando necesitas envasar ya, sin planificar antes.

1. Ir a **Produccion** > tab **Envasado** > boton **Rapido**
2. Mismo flujo que planificado: producto → cola → envase → materiales → cantidad
3. Pulsar **Ver lotes y confirmar**
4. Ver preview de lotes → confirmar → animacion → resultado

**Tambien se puede acceder desde Pedidos**: cuando un pedido necesita envasado, el boton naranja "Envasar" abre el envasado rapido con el producto ya pre-seleccionado.

### Multiplicador de cajas/pales

El multiplicador funciona tanto en envasado planificado como en envasado rapido. Si seleccionas como envase una **Caja 18 uds (75g)** o un **Pale 60**:

- La cantidad que pones es en **cajas** (o pales), no en frascos
- El sistema detecta automaticamente el multiplicador del nombre del envase (ej: "Caja 18" → multiplicador 18, "Pale 60" → multiplicador 60)
- El sistema calcula automaticamente:
  - 10 cajas x 18 = **180 frascos** (unidades reales producidas)
  - 180 x 0.075 kg = **13.5 kg de cola** necesarios
- Se consume:
  - 13.5 kg de cola granel (FEFO)
  - **10 cajas** de 18 uds (el envase caja/pale)
  - **180 etiquetas** (una por frasco)
  - Materiales extra que hayas anadido
- El lote producido contiene **180 unidades**, no 10

> **Ejemplo de coste con multiplicador**: Si una Caja 18 uds cuesta 2 EUR, el coste por unidad de la caja es 2/18 = 0.11 EUR. El sistema divide automaticamente el CMP del envase entre el multiplicador.

### Coste del producto envasado

El coste por unidad envasada se calcula automaticamente:
- Coste cola = CMP de la cola x peso por unidad
- Coste envase = CMP del envase / multiplicador (si aplica)
- Coste materiales = CMP de cada material extra (prorrateado por unidad)
- **Coste total = cola + envase + materiales**

Este coste se guarda en el lote producido (precio_compra) y se usa para calcular rentabilidad en Finanzas.

---

## 6. Pedidos

### Ciclo de vida completo

```
Crear pedido ──→ Confirmado ──→ segun stock:
                                  │
                                  ├─ Stock OK ──────→ Consumir ──→ Completado
                                  │
                                  ├─ Falta envase ──→ Envasar ──→ Consumir ──→ Completado
                                  │
                                  └─ Falta granel ──→ Fabricar ──→ Envasar ──→ Consumir ──→ Completado
```

> **Importante**: Solo los pedidos en estado **Completado** cuentan como facturacion/ingresos. Un pedido confirmado NO suma como venta hasta que se consume el stock.

### Como crear un pedido

1. Ir a **Pedidos** > **Nuevo Pedido**
2. **Cliente**: seleccionar de la lista o escribir nombre nuevo
3. **Productos**: pulsar para anadir lineas
   - Buscar producto (se agrupan en Granel y Envasado)
   - Indicar cantidad
   - Para envasados: elegir presentacion (unidades sueltas, cajas de 18, pales de 60, etc.)
   - Indicar precio unitario (solo admin)
   - Se puede anadir mas de una linea
4. **Portes**: gastos de envio (se suma al subtotal antes de IVA)
5. **IVA %**: por defecto 21%
6. **Fecha de entrega** y **notas**
7. Pulsar **Guardar**

Al guardar:
- El pedido se crea directamente como **Confirmado**
- Se reservan lotes FEFO automaticamente (transaccion SERIALIZABLE)
- Los totales se recalculan en el servidor (subtotal + portes + IVA = total)

> **Integridad de totales**: Tanto al crear como al editar un pedido, el servidor recalcula de forma independiente el subtotal sumando las lineas, aplica portes e IVA%, y genera el total. No es posible que un error de red o de navegador genere totales incoherentes.

### El boton inteligente

En la lista de pedidos, cada uno muestra un boton de color segun lo que necesita:

| Color | Boton | Significado | Que hacer |
|-------|-------|-------------|-----------|
| **Verde** | Consumir | Hay stock suficiente del producto envasado | Pulsar para seleccionar lotes y completar |
| **Naranja** | Envasar | Hay cola granel pero faltan botes | Pulsar para ir a envasar el producto |
| **Rojo** | Fabricar | No hay cola granel suficiente | Pulsar para crear orden de fabricacion |

Para pedidos en estados intermedios (`fabricado` o `envasado`) el boton de cierre es **"Consumir"** (desktop) o **"Consumir y completar"** (movil). Pulsarlo descuenta el stock del producto final segun los lotes FEFO seleccionados y deja el pedido en `completado` en una sola accion. **Nunca** existe un atajo "marcar completado" sin descontar stock — el unico camino al estado completado es a traves del consumo real.

La columna **Accion** muestra el estado con color para ver de un vistazo que pedidos necesitan atencion.

### Consumir stock (boton verde)

1. Pulsar **Consumir** en el pedido
2. Se abre modal con los lotes que se van a usar:
   - Pre-seleccionados por FEFO
   - Se puede ajustar la cantidad de cada lote manualmente
   - Barra de progreso muestra si esta cubierto al 100%
3. Pulsar **Consumir** cuando todo este al 100%
4. El stock se descuenta, las reservas se liberan, el pedido pasa a **Completado**
5. **Alertas automaticas**: el sistema comprueba si los productos consumidos han bajado del stock minimo

> **Proteccion de estado**: Solo se puede consumir un pedido en estado confirmado, en produccion, fabricado o envasado. Un pedido completado o cancelado no permite consumo.

### Envasar (boton naranja)

1. Pulsar **Envasar** en el pedido
2. Se navega a **Produccion > Envasado rapido** con el producto ya pre-seleccionado
3. Completar el envasado (ver seccion 5)
4. Volver a **Pedidos** — el boton habra cambiado a verde
5. Pulsar **Consumir** para completar

### Fabricar (boton rojo)

1. Pulsar **Fabricar** en el pedido
2. El pedido pasa a estado "en produccion"
3. Se navega a **Produccion > Fabricacion** con la receta pre-seleccionada
4. Completar la fabricacion (ver seccion 4)
5. El pedido pasa automaticamente a **Fabricado**
6. Si es producto envasado → el boton cambia a naranja (envasar primero)
7. Si es producto granel → el boton cambia a verde (consumir directamente)

### Editar un pedido (solo admin)

1. Pulsar el **lapiz** en el pedido (solo admin, solo si no esta completado)
2. Modificar productos, cantidades, precios, fecha, cliente
3. Guardar — los totales se recalculan automaticamente en el servidor

> **Restriccion server-side**: el endpoint `PUT /api/pedidos/:id` esta protegido por el middleware `adminOnly`. Si un usuario rol=trabajador intenta editar via API directa, recibe error 403. La proteccion no depende solo del boton del frontend.

### Cancelar un pedido (solo admin)

1. Pulsar la **X** en el pedido
2. Confirmar cancelacion
3. Las reservas de stock se liberan automaticamente
4. Se puede reactivar un pedido cancelado cambiando su estado a Confirmado (re-reserva stock)

> **Restriccion server-side**: el endpoint `DELETE /api/pedidos/:id` esta protegido por `adminOnly`. Trabajadores no pueden cancelar pedidos ni siquiera con llamadas API directas. Esto evita robos de stock por liberacion forzada de reservas.

### Albaran de entrega

Pedidos completados o confirmados pueden generar albaran:
1. Pulsar el icono de **descarga** (PDF morado) para descargar
2. Pulsar el icono de **sobre** (azul) para enviar por email
3. El albaran incluye:
   - Datos emisor (Colas Loga) y destinatario
   - Lineas de producto con cantidades y precios
   - Subtotal, portes, IVA y total
   - Trazabilidad de lotes usados con fechas de caducidad
   - Fotos de fabricacion si existen
   - Espacio para firma de entrega y recepcion

---

## 7. Dashboard y Calendario

### Vista calendario

1. Ir a **Dashboard** en el menu lateral
2. Calendario mensual con:
   - **Ordenes pendientes** (fabricacion y envasado)
   - **Ordenes completadas**
   - **Recordatorios** personales
   - **Predicciones** de pedidos (basadas en patrones de compra)
3. Filtros toggleables arriba a la derecha
4. Pulsar en un dia para ver detalle

### Crear recordatorio

1. Pulsar en un dia del calendario
2. Rellenar titulo, descripcion y color
3. Los recordatorios se pueden arrastrar a otro dia

### Predicciones de demanda

El sistema analiza los pedidos completados de los ultimos 2 anos y predice, por cada par cliente-producto:
- Que cliente va a pedir
- Que producto y cantidad esperada (mediana ajustada por tendencia)
- Cuando (fecha estimada + rango ±desviacion)
- Probabilidad: **Muy probable / Probable / Posible** (segun regularidad del intervalo)
- Tendencia: **subiendo / bajando / estable** comparando ultimos 90 dias vs los 90 anteriores
- Estado: **activo** (sigue en su ritmo habitual) o **dormido** (lleva mas del doble de su intervalo sin pedir)

#### Como leer la prediccion

En el Dashboard, la seccion "Prediccion de demanda" tiene dos pestanas:

- **Activos**: clientes en su ciclo normal. Salen las alertas a 60 dias o menos.
- **Recuperar**: clientes dormidos. Boton "Recuperar" sugiere email para reactivar.

Cada tarjeta muestra:
- Nombre cliente + nivel (oro/plata/bronce)
- Etiqueta probabilidad (verde/ambar/gris)
- Etiqueta tendencia con porcentaje (↑+12% / ↓−8% / −0%)
- Cantidad esperada y producto
- "En Xd" o "Hace Xd" si esta vencida

#### Boton "Por que"

En cada tarjeta hay un enlace **▾ Por que** que despliega:
- Linea de tiempo de los ultimos 5 pedidos con cantidad y fecha
- Gaps en dias entre pedidos consecutivos (ej: `→ 14d →`)
- Resumen: intervalo medio, numero de pedidos en el historico, lectura de la tendencia

Sirve para validar de un vistazo por que el sistema dice lo que dice antes de actuar.

#### Calendario

Las predicciones **activas** aparecen como marcadores morados en el dia estimado del calendario. Los dormidos NO aparecen para no ensuciar la vista.

#### Acciones rapidas

Desde cada tarjeta:
- **Sugerir pedido** (clientes activos) — abre email pre-rellenado al cliente
- **Recuperar** (clientes dormidos) — email de reactivacion
- **Fabricar** — abre orden de produccion con la cantidad esperada
- **Ver stock** — comprueba si hay stock suficiente para cubrir

#### Como mejora frente al modelo anterior

| Antes | Ahora |
|-------|-------|
| Promedia 2 anos por igual | Pondera lo reciente (decay 180 dias) |
| Media de cantidad (sesgada por outliers) | Mediana (estable) |
| Solo fecha | Fecha + cantidad ajustada por tendencia |
| Clientes que dejaron de pedir seguian apareciendo | Se separan en pestana "Recuperar" |
| Sin justificacion visible | Boton "Por que" con timeline |

> Nota: el modelo necesita al menos 2 pedidos completados del par cliente-producto para predecir. Clientes nuevos (cold start) no aparecen.

---

## 8. Clientes

### Crear cliente

1. Ir a **Clientes** > **Nuevo cliente**
2. Rellenar: nombre, NIF/CIF, email, telefono, direccion
3. Guardar

### Niveles de cliente

Los clientes se clasifican automaticamente por volumen de compra:

| Nivel | Color | Significado |
|-------|-------|-------------|
| **Oro** | Dorado | Mejores clientes (configurable) |
| **Plata** | Gris | Buenos clientes |
| **Bronce** | Marron | Clientes regulares |

Los umbrales se configuran en **Configuracion > Niveles de cliente**.

### Informacion del cliente

En la ficha de cada cliente se ve:
- Datos de contacto
- Consumo total acumulado
- Nivel actual
- Historial de pedidos

---

## 9. Finanzas

### Como interpretar el panel financiero

El panel financiero muestra datos en tiempo real. Solo se cuentan los pedidos **completados** como facturacion — los pedidos confirmados o en proceso no suman como venta.

### Selector de año

En la barra superior hay un selector **Año** (rojo). Al cambiarlo se filtra **todo** el panel: facturación, evolución mensual, top productos, coste de producción, mermas, clientes activos y los CSV de exportación (`pedidos-2025.csv`, `produccion-2025.csv`, `informe-plastico-2025.csv`).

Lo que **no** se filtra por año (porque siempre es estado actual): Rentabilidad por producto, Inmovilizado, Top 10 stock, Materias primas, Impacto de precios y CSV de Inventario.

### KPIs principales (tarjetas grandes)

| Tarjeta | Que muestra | De donde sale |
|---------|------------|---------------|
| **Facturacion** | Total vendido | Suma de totales de pedidos completados |
| **Coste produccion** | Lo gastado en materias primas | Suma de stock_moves tipo produccion_consumo |
| **Beneficio bruto** | Facturacion - Coste produccion | Calculo automatico |
| **Valor inventario** | Cuanto vale todo el stock | Suma de (cantidad_lote x precio_compra_lote) |

### KPIs secundarios (tarjetas pequenas)

- **Ticket medio**: facturacion / numero de pedidos completados
- **Coste medio/orden**: coste produccion / ordenes fabricadas
- **Produccion rechazada**: valor de ordenes canceladas + lotes rechazados
- **Mermas produccion**: kg perdidos en fabricacion, valorados en EUR (kg x coste/kg)

### Grafico de ventas por mes

Barras que muestran facturacion mensual:
- **Rojo oscuro**: meses por encima de la media
- **Rojo claro**: meses por debajo
- **Linea punteada**: media mensual
- Tooltip al pasar el raton: total, pedidos, % vs media

### Rentabilidad por producto · coste actual

Tabla con todos los productos vendibles:
- **Precio venta**: lo que cobras
- **Precio coste**: coste **real actual** del producto, calculado por asignación **"más barato primero"** sobre los lotes aprobados que tienes en almacén (ver detalle abajo)
- **Margen %**: (venta - coste) / venta x 100
  - Verde: >40%
  - Naranja: 20-40%
  - Rojo: <20%
- Pulsar en una fila para ver **desglose de coste** por ingrediente

Se puede filtrar por: Todos / Granel / Envasado

> Esta sección responde a: *"¿Cuánto gano hoy con cada producto, según los costes reales que ya he pagado?"*

#### Cómo calcula el coste actual ("cheapest-first")

Para cada ingrediente de la receta, el sistema simula que vas a fabricar AHORA con los lotes que tienes en almacén, **empezando siempre por el más barato disponible**. Cuando el lote más barato se agota, sigue por el siguiente más barato, y así sucesivamente.

**Ejemplo:** la receta necesita 10 kg de Persulfato Amónico.

| Lote | Stock | Precio compra |
|------|-------|---------------|
| LMP-A | 5 kg  | 3,66 €/kg     |
| LMP-B | 50 kg | 3,82 €/kg     |

Asignación cheapest-first:
- 5 kg del lote A × 3,66 €/kg = **18,30 €**
- 5 kg del lote B × 3,82 €/kg = **19,10 €**
- **Coste total** del ingrediente = 37,40 € → precio efectivo **3,74 €/kg**

El desglose muestra ese precio efectivo (3,74) en la columna PRECIO, no el del lote más barato ni el CMP.

**Si no hay stock suficiente** para cubrir la cantidad necesaria con los lotes existentes, el resto se valora al **precio ficha** del producto (campo `precio_unitario` que se muestra en la pantalla Productos). Así el desglose nunca queda subvalorado: refleja el coste real al que arrancaría la siguiente fabricación.

**Productos envasados**: el ingrediente "cola granel" tiene sus propios lotes con `precio_compra` igual al coste real al que se fabricó. La asignación cheapest-first se aplica también ahí, lo que permite ver cuándo conviene tirar primero de cola granel barata acumulada antes de fabricar más.

### Valor inventario por tipo (donut)

Distribucion del valor del stock entre:
- Materia Prima (azul)
- Fabricado/Granel (rojo)
- Envasado (verde)
- Embalaje (naranja)

### Top 10 inmovilizado

Los 10 productos con mas valor en stock, usando el CMP (Coste Medio Ponderado) real de los lotes.

### Impacto de precios · coste futuro

Muestra cómo las subidas/bajadas de precio de materias primas afectarán al margen de cada receta. Expandir para ver detalle por ingrediente.

A diferencia de la tabla de Rentabilidad (que usa el coste **actual** de los lotes en almacén), esta sección usa el coste **futuro proyectado**: lo que costará producir cuando los lotes actuales se agoten y haya que recomprar las materias primas a los precios ficha vigentes (los que aparecen en la pantalla de cada producto/MP).

- **Coste anterior**: con los precios anteriores de las MP (historial últimos 90 días)
- **Coste actual**: futuro proyectado con precios ficha de hoy
- **Δ Margen**: variación en puntos porcentuales

> Ejemplo: si una MP subió de 2 €/kg a 3 €/kg pero todavía tienes lotes viejos comprados a 2 €/kg en almacén, la **Rentabilidad** seguirá mostrando el coste bajo (real), mientras que **Impacto** ya muestra el coste alto (futuro) — para que veas el aviso antes de quedarte sin stock barato.

> Esta sección responde a: *"¿Cuánto voy a ganar cuando se acaben los lotes baratos y tenga que comprar al precio actual?"*

### Exportar datos

Boton para exportar a CSV:
- Pedidos
- Produccion
- Inventario

### Informe de plastico (Ley 7/2022)

Obligatorio para declarar el impuesto especial sobre envases de plastico no reutilizables.

**Como descargar el informe:**

1. Ir a **Finanzas**
2. Pulsar el boton verde **Plastico (Ley 7/2022)** arriba a la derecha
3. Se descarga un CSV con:

| Columna | Descripcion |
|---------|------------|
| Codigo | Codigo del material de embalaje |
| Material | Nombre (ej: Frasco 75g + tapon, Caja 18 uds) |
| Peso plastico/ud (kg) | Gramos de plastico por unidad |
| Unidades consumidas | Total de unidades usadas en el periodo |
| Kg plastico total | Peso total de plastico consumido |
| Coste material (EUR) | Coste total de ese material |
| Num ordenes | En cuantas ordenes de envasado se uso |
| Primera/Ultima fecha | Rango de uso |

Al final del CSV aparecen:
- **TOTALES**: suma de unidades y kg
- **IMPUESTO PLASTICO**: total kg x 0,45 EUR/kg (tasa vigente)
- **Periodo**: fechas del informe

**Configurar peso de plastico por material:**

1. Ir a **Productos** > buscar el material de embalaje
2. Editar > campo **Peso plastico (kg)**: indicar los gramos de plastico que tiene cada unidad
3. Ej: Frasco 75g + tapon → 0.012 kg (12 gramos de plastico)

> El sistema ya tiene pesos por defecto para todos los envases. Ajustalos si los pesos reales de tu proveedor son diferentes.

**Cobertura completa del informe (anti-falsa omision):**

El informe incluye **TODOS los productos tipo "material_embalaje" que se hayan consumido en el periodo**, no solo los que tienen peso configurado:

- Si un material tiene `peso_plastico_kg` configurado: aparece con su peso en kg y se suma al total de kg de plastico declarables.
- Si un material **NO tiene peso configurado** (por olvido al crear la ficha): aparece igualmente en el CSV con la etiqueta `PESO NO CONFIGURADO` en la columna de peso y `REVISAR` en la columna kg total. Al final del CSV se muestra una seccion "AVISO" con el listado de materiales que faltan de configurar.

> Esto evita el riesgo de que un envase plastico nuevo (etiquetas, film retractil, cajas con elementos plasticos) se omita silenciosamente del informe Hacienda por no haberse rellenado su peso. El admin ve la lista de pendientes y los completa antes de presentar la declaracion.

---

## 10. Configuracion y Administracion

### Permisos por rol (admin vs trabajador)

El sistema tiene dos roles. Las restricciones se aplican **server-side** (endpoint API), no solo en el frontend — un trabajador con su token llamando directamente a la API recibe 403 en operaciones no permitidas.

**Trabajador (operario) puede:**
- **Lotes y stock**: añadir nuevos lotes, ver lista de lotes, cambiar estado de lotes (excepto aprobar cuarentena), ajustar stock manualmente, reconciliar.
- **Fabricacion**: planificar nuevas ordenes de fabricacion, confirmar fabricaciones (ejecutar el reactor).
- **Envasado**: planificar y confirmar envasados (rapido y planificado).
- **Pedidos**: ver pedidos, crear pedidos nuevos, marcar consumo (consumir stock para completar).
- **Productos / Recetas / Clientes / Proveedores**: solo LECTURA. Puede ver fichas pero no editar ni crear ni borrar.
- **Borrar ordenes de fabricacion**: solo las que el mismo creo (creado_por_id) o ejecuto (operario_id). NO puede borrar ordenes ajenas.

**Trabajador NO puede:**
- Editar/crear/borrar productos, recetas, clientes, proveedores
- Aprobar lotes en cuarentena (transicion cuarentena → aprobado)
- Editar o cancelar pedidos (PUT/DELETE pedidos)
- Acceder a Finanzas, Configuracion, Automatizaciones, Recuento
- Ver precios de compra de lotes ni coste de produccion en panel detalle
- Ver quien hizo una orden ni cuanto tardo
- Borrar ordenes ajenas

**Admin puede todo lo del trabajador, ademas:**
- Editar/crear/borrar productos, recetas, clientes, proveedores
- Aprobar lotes en cuarentena (con motivo ≥10 chars)
- Editar y cancelar pedidos
- Acceso completo a Finanzas, Configuracion, Automatizaciones, Recuento
- Ver precios, costes, operario ejecutor, duraciones, media receta
- Borrar cualquier orden de fabricacion (no solo las suyas)
- Crear usuarios, ver login_logs, configurar SMTP, gestionar backups
- Restaurar BD desde backup (con red de seguridad de pre-backup automatico)

### Trazabilidad de quien hizo cada cosa

Cada orden de fabricacion y envasado registra dos campos distintos:

- **`creado_por_id`**: usuario que pulsa "Nueva fabricacion" / "Planificar envasado". Quien planifica.
- **`operario_id`**: usuario que pulsa "Confirmar fabricacion" / "Confirmar envasado". Quien ejecuta.

Pueden ser el mismo (un operario que planifica y luego fabrica) o distintos (admin planifica, operario ejecuta).

**Para envasados** (rapido, planificado y confirmar-envasado) tambien se capturan los mismos datos que en fabricacion:
- Snapshot meteorologico Open-Meteo en el momento de confirmar
- `fecha_inicio` (apertura del modal) y `fecha_fin` (confirmacion) → duracion real
- `operario_id` y `creado_por_id`

El admin ve en el panel detalle de cualquier orden:
- "Hecha por <Nombre>" (operario_id)
- "Duracion <tiempo>" + "Media receta <tiempo medio> (n)"
- Badge meteo "X°C · Y% HR · Z km/h"
- Coste total
- Si fue creada por otro usuario, aparece junto al nombre.

### Sesion y seguridad

- **Token JWT con TTL 8 horas**: el token de sesion caduca a las 8 horas de iniciado. Antes era 7 dias, demasiado para un entorno industrial multi-operario donde los moviles pueden perderse o compartirse. Tras 8 horas, el sistema redirige al login.
- **Auto-refresh proactivo**: la app refresca el token automaticamente cada 4 horas y al volver a la pestana tras inactividad, asi el operario no nota cortes durante un turno normal.
- **Logout efectivo (revocacion server-side)**: pulsar Cerrar sesion no solo borra el token del navegador — tambien lo registra en la tabla `sesiones_revocadas` del servidor. A partir de ese momento, ningun request con ese token sera aceptado, aunque alguien lo haya copiado antes. Esto resuelve el caso "operario pierde el movil": admin no necesita esperar a que caduque el token, basta con cerrar la sesion del usuario.
- **Cache de revocados**: el middleware mantiene una cache en memoria con los `jti` revocados (TTL 30s) para no consultar la BD en cada request. Tras un logout, la cache se invalida inmediatamente.

### Datos de empresa

**Configuracion** > **General**
- Nombre, CIF, direccion, telefono
- Logo (se muestra en albaranes y PDF)

### Email (SMTP)

Para enviar albaranes y trazabilidad por email:
- Servidor SMTP, puerto, usuario, contrasena
- Boton **Probar SMTP** para verificar

### Niveles de cliente

Configurar los umbrales de consumo para Oro/Plata/Bronce.

### Alertas

Las alertas se generan de dos formas:

1. **Automatica (push)**: tras cada fabricacion, envasado o consumo de pedido, el sistema comprueba automaticamente si los productos afectados han bajado del stock minimo y genera notificacion instantanea
2. **Manual (pull)**: pulsando **Recheck alertas** en Configuracion para forzar una revision global

Tipos de alerta:
- **Stock bajo**: cuando el stock de un producto cae por debajo del minimo configurado
- **Sin stock**: cuando el stock llega a cero
- **Caducidad**: 30 dias antes de que un lote caduque
- **Control de calidad**: lote creado en cuarentena por valores fuera de rango (ver seccion 4)

### Backups

- **Backup manual**: pulsar para generar backup cifrado (AES-256)
- **Validacion automatica antes de borrar**: tras crear el backup nuevo, el sistema **descifra y verifica que el contenido es un dump de PostgreSQL valido**. Solo si la validacion pasa, se borran los backups antiguos (mantenemos los 2 mas recientes en local). Si la validacion falla:
  - El backup corrupto se elimina del disco
  - **NO se borran los backups antiguos** — quedan preservados
  - El sistema devuelve error con detalle ("Backup creado pero validacion fallo: ...")
- **Restaurar (proceso a prueba de fallos)**: el restore tiene 4 etapas con red de seguridad en cada paso. **Es matematicamente imposible perder los datos por culpa del restore**:
  1. **Validacion previa del backup objetivo**: descifra y comprueba cabecera (`PostgreSQL database dump` o `SET`/`CREATE`) Y pie de archivo (marker `PostgreSQL database dump complete`). Si el archivo esta truncado o corrupto, el restore se aborta sin tocar la BD.
  2. **Pre-backup automatico de seguridad**: antes de borrar nada, el sistema crea un backup completo del estado actual con nombre `pre-restore-AAAA-MM-DD_HH-MM-SS.sql.gz.enc` en `/backups/`. Si el pre-backup falla, el restore se aborta.
  3. **Restore en transaccion atomica**: ejecuta DROP TABLES + COPY de datos dentro de una unica transaccion PostgreSQL con `ON_ERROR_STOP=1`. Si una sola sentencia falla, PostgreSQL hace ROLLBACK total — la BD queda exactamente como estaba antes.
  4. **Rollback automatico si algo falla**: si el restore principal aborta, el sistema **automaticamente** restaura el pre-backup creado en el paso 2. Resultado: BD vuelve al estado previo, sin intervencion humana, sin perdida de datos.
- En la respuesta del endpoint aparece el nombre del `pre_restore_backup` para que el admin pueda borrarlo a mano cuando confirme que el restore fue correcto (queda como copia adicional hasta que se decida).
- Los backups incluyen la base de datos completa + archivos subidos (fichas SDS, fotos)
- **Subida a Drive**: si rclone esta configurado, sube tambien a Google Drive (manteniendo los 10 mas recientes alli)

> **Garantia formal**: en cualquier escenario de fallo de restore (backup corrupto, disco lleno, psql interrumpido, error sintaxis, fallo electrico), la base de datos queda en uno de estos dos estados: (a) el original previo al restore, o (b) restaurada al pre-backup automatico. **Nunca queda vacia ni en estado inconsistente**.

### Auditoria

Registro de TODAS las acciones del sistema:
- Quien hizo que y cuando
- Cambios de precio (con precio anterior y nuevo)
- Cambios de estado de lotes y pedidos
- Fabricaciones y envasados completados
- Ajustes manuales de stock
- **Reconciliaciones de stock** (con detalle de cantidades corregidas por producto)

### Reconciliacion de stock

Si crees que hay discrepancias:
1. **Configuracion** > **Reconciliar stock**
2. Muestra productos donde stock_actual != suma de lotes aprobados
3. Pulsar **Reconciliar** para corregir automaticamente
4. Cada correccion queda registrada en stock_moves con el motivo, usuario y cantidades antes/despues

---

## 11. Automatizaciones

Sistema de reglas que ejecutan acciones automaticamente cuando se cumple un evento. Sustituye el trabajo manual repetitivo: pedidos a proveedor, ordenes de fabricacion/envasado, aprobacion de lotes, completar pedidos, enviar albaranes y backups.

Acceso: menu **Auto** (icono rayo en navbar). Solo admins crean/editan reglas.

### Estructura de la pagina

- **Hero** rojo en la parte superior con 4 stats (activas, ejecuciones hoy, errores hoy, productos cubiertos) y boton **+ Nueva automatizacion**.
- **Tabs**: `Reglas` (lo que el sistema hace) y `Historial` (todo lo que ha hecho).
- En `Reglas`: primero los **Comportamientos del sistema** (4 cards globales), debajo las **Reglas por producto** (las que has creado).
- Botones por card: **Play** (disparar manualmente sobre el estado actual), **Pencil** (configurar — solo donde aplica), **Power** (pausar/reanudar), **Toggle verde** en cabecera para activar.

### 11.1 Comportamientos del sistema

Son 4 toggles globales que cambian como funciona el flujo de trabajo. No estan ligados a productos concretos sino a procesos.

#### Auto-fabricar desde pedido
Cuando confirmas un pedido cuyo producto no tiene stock granel, el sistema crea automaticamente la orden de produccion con todos los datos: receta activa, cantidad ajustada al rendimiento, fecha planificada (= fecha de entrega del pedido o hoy + N dias), cliente y cliente_id, numero auto `OP-AUTO-AAAAMMDD-HHMMSS`. La orden queda en estado `confirmada` lista para fabricar y el pedido pasa a `en_produccion` linkado.

- Anti-duplicado: si ya existe orden borrador/confirmada/en_proceso del mismo granel en los ultimos 5 dias, omite con motivo `orden_ya_pendiente`.
- Si no hay receta activa para el producto: omite con motivo `sin_receta_fabricacion` (debes crear la receta primero).
- **Solo soportado para productos tipo `producto_fabricado` (granel)**. Si el pedido es de un producto envasado sin stock, la automatizacion registra `feature_envasado_no_disponible_todavia` en el historial y muestra el tip al admin: *"Auto-fabricar desde pedido envasado aun no soportado. Crea la orden de fabricacion del granel manualmente."* Es una limitacion conocida; mientras no este implementada, el operario debe planificar manualmente la fabricacion del granel cuando el pedido es envasado.

#### Auto-completar pedido con stock
Cuando confirmas (o cambia a fabricado/envasado) un pedido y hay stock disponible del producto envasado, el sistema descuenta lotes FEFO y deja el pedido en `completado` sin que tengas que pulsar Consumir.

- Funciona si las reservas propias del pedido cubren la cantidad O si hay stock libre suficiente (no reservado por otros pedidos).
- Si el stock esta bloqueado por otros pedidos confirmados, omite con motivo `stock_bloqueado_por_otros_pedidos` y muestra que pedido lo retiene.
- Tras completar, encadena con `Auto-email albaran` si esta activo.

#### Enviar albaran por email
Tras completar un pedido (manual o automatico), envia automaticamente el PDF del albaran + trazabilidad + fotos al email del cliente. Marca `pedidos.albaran_enviado = TRUE` para que **no se reenvie nunca al mismo pedido**, ni manual ni automaticamente.

- **Filtro por cliente**: pulsa el icono lapiz de la card → modal con dos modos: **Todos los clientes** o **Solo seleccionados** (multi-select con buscador). Sin filtro = todos.
- Si el cliente del pedido no esta en el filtro: omite (`cliente_fuera_filtro`).
- Si el cliente no tiene email: omite (`cliente_sin_email`).
- Si el albaran ya fue enviado: omite (`albaran_ya_enviado`).

#### Backup nocturno cifrado
Cada noche a la hora indicada (selector dentro de la card) hace un backup completo (DB + uploads) cifrado AES-256. Sube a Google Drive si rclone esta configurado. Idempotente: solo corre una vez al dia despues de la hora programada.

- Editas la hora con el time picker dentro de la card.
- Pulsando **Disparar** ejecuta backup ahora mismo (force) sin esperar a la hora programada.
- Muestra fecha de la ultima ejecucion.

### 11.2 Reglas por producto

Reglas individuales que tu creas con el boton **+ Nueva automatizacion**. Cada regla tiene un icono y color (segun plantilla), un disparador (CUANDO) y una accion (HACER) sobre uno o varios productos seleccionados.

#### Plantillas disponibles

Al pulsar **+ Nueva automatizacion** se abre un picker con 6 plantillas para reglas + 3 atajos para activar comportamientos del sistema:

| Plantilla | Cuando | Hacer | Aplica a |
|-----------|--------|-------|----------|
| **Email automatico al proveedor** | Stock baja del minimo | Crear orden compra borrador + enviar email al proveedor | materia_prima, material_embalaje |
| **Orden de compra borrador** | Stock baja del minimo | Crear orden compra borrador (sin enviar email — tu lo envias luego) | materia_prima, material_embalaje |
| **Crear orden de fabricacion** | Stock baja del minimo | Crear orden produccion borrador con receta y rendimiento | producto_fabricado |
| **Crear orden de envasado** | Stock baja del minimo | Crear orden envasado borrador con cola, envase, materiales | producto_envasado |
| **Aprobar lotes con QC OK** | Lote nuevo con QC dentro de rango | Marcar lote como `aprobado` automaticamente | producto_fabricado, producto_envasado |
| **Rechazar lotes fuera de rango** | Lote nuevo con QC fuera de rango | Marcar lote como `rechazado` y bajar cantidad a 0 | producto_fabricado, producto_envasado |

#### Wizard para crear una regla

1. Pulsa **+ Nueva automatizacion** → picker con plantillas.
2. Elige una plantilla → se abre wizard step-by-step:
   - **Productos**: multi-select con buscador. Marca uno o varios productos del tipo correspondiente.
   - **Cantidad** (solo plantillas de orden/email): cantidad fija opcional. Si la dejas vacia, el sistema calcula `stock_minimo × (1 + safety_pct%) - stock_actual`.
   - **Destinatario** (solo email proveedor): email al que mandar. Por defecto el email del proveedor del producto, sobreescribible.
   - **Nombre** + checkbox `Activar al guardar`. Resumen visual de la regla antes de confirmar.
3. Pulsa **Crear regla** → aparece como card en `Reglas por producto`.

#### Card de cada regla

- Header con gradiente segun plantilla, icono y boton toggle activar/desactivar.
- Visual `CUANDO -> HACER` con badges.
- Lista de productos afectados (o "N productos" si son varios).
- Footer: contador de ejecuciones, % exito, fecha ultima ejecucion + acciones:
  - **Play**: ejecutar la regla manualmente sobre los productos seleccionados.
  - **Edit**: re-abre el wizard para modificar la regla.
  - **Duplicate**: clona la regla con sufijo "(copia)" desactivada.
  - **Delete**: elimina la regla.

#### Reglas que se omiten en lugar de fallar

Las siguientes condiciones se loguean como `omitido` (no penalizan el % exito):

- `producto_sin_proveedor` — la regla email proveedor no encuentra proveedor en el producto. Tip mostrado: asigna proveedor al producto.
- `sin_receta_fabricacion` / `sin_receta_envasado` — no hay receta activa del producto.
- `orden_pendiente_en_ventana` / `orden_ya_pendiente` — ya hay una orden borrador/confirmada del mismo producto recientemente. Anti-spam.
- `stock_bloqueado_por_otros_pedidos` — el producto tiene reservas activas de otros pedidos.
- `albaran_ya_enviado` — el albaran de ese pedido ya se mando.
- `cliente_fuera_filtro` / `cliente_sin_email` — albaran no aplicable al cliente.

### 11.3 Stats por regla

Cada regla guarda 3 contadores: `ejecuciones_count` (total intentos), `ejecuciones_exito`, `ejecuciones_fallo`. La card muestra el ratio de exito y la ultima fecha. Las omisiones cuentan como ejecuciones pero no como fallo.

### 11.4 Sweep periodico (cron interno)

Un cron interno corre **cada 90 segundos** para procesar pendientes de los comportamientos del sistema:

- `auto_fabricar_desde_pedido` activo → busca pedidos `confirmado` sin orden asociada → crea orden.
- `auto_completar_pedidos_con_stock` activo → busca pedidos `confirmado/fabricado/envasado` → intenta completar.
- `auto_email_albaran` activo → busca pedidos `completado` con `albaran_enviado=false` y email cliente → manda albaran.

Tambien hooks directos en cada POST/PUT de pedidos para reaccion instantanea (no esperan al cron).

### 11.5 Historial

Tab `Historial`: lista las ultimas 100 ejecuciones (filtrable por tipo y resultado).

Cada entrada muestra:
- Icono y color segun tipo (verde exito, rojo error, ambar pendiente, gris omitido).
- Etiqueta legible del evento: `Pedido auto-completado`, `Albaran enviado`, `Copia backup`, `Orden auto-fabricacion`, `Orden compra creada`, `Email proveedor enviado`, `Lote aprobado QC`, `Duplicado evitado`, `Error`.
- Producto afectado + codigo.
- **Detalle estructurado** en grid 2 columnas con todas las claves del JSONB: accion, motivo, regla, pedido, orden, producto, cantidad, unidad, destinatario, fecha planificada, necesario, reservado propio, libre no reservado, bloqueado por, archivo backup, tamaño, retry count, etc.
- **Tip** en cursiva al final cuando aplique (p.ej. "Asigna un proveedor al producto en su ficha").
- Mensaje de error literal si fallo definitivo.
- Boton **Reintentar ahora** si el log es un email proveedor en estado `pendiente_reintento`.

### 11.6 Toasts en vivo

Mientras estas en cualquier pagina, un hook (polling 30s) detecta nuevas entradas no leidas y dispara un toast sileo con el detalle + boton "Ver orden" / "Ver historial". Asi te enteras de cada automatizacion sin tener que abrir el panel.

### 11.7 Vigilancia de los crons internos (heartbeat)

Los crons internos (`sweep_pedidos`, `sweep_stock_reglas`, `backup_nocturno_tick`, `retry_email_proveedor`) escriben un latido en la tabla `cron_heartbeat` cada vez que terminan correctamente. El frontend pollea cada 60 segundos el endpoint `/api/health/cron` y, si algun cron lleva mas tiempo del esperado sin ejecutar (umbral configurado por cron, tipicamente 3x su intervalo), dispara una notificacion sileo de error persistente al admin:

> *"Sistema caido: Auto-completar pedidos. No ha ejecutado en 12 min (umbral 5 min). Avisa al tecnico."*

Asi el admin se entera al instante de que un cron ha dejado de funcionar (proceso muerto, BD desconectada, excepcion no manejada), antes de que se acumulen pedidos sin auto-completar o albaranes sin enviar.

- La tabla `cron_heartbeat` guarda: `nombre`, `ultimo_run`, `ultimo_status` (`ok` | `error`), `ultimo_error`, `intervalo_ms`, `umbral_ms`.
- Si el cron lanza una excepcion, el heartbeat se actualiza con `status=error` y el mensaje, lo que tambien dispara la alerta sileo.
- Cuando el cron se recupera (vuelve a ejecutar OK antes del umbral), el frontend deja de avisar y permite que la siguiente caida vuelva a alertar.

### 11.8 Tabla de retencion de retry para emails

Los emails al proveedor que fallan se reintentan automaticamente:
- Maximo 3 reintentos (configurable en el endpoint `/automatizaciones/config`).
- Intervalo 10 minutos por defecto (configurable).
- Cron interno cada 5 minutos recoge logs `pendiente_reintento` con `next_retry_at <= NOW()` y reintenta.
- Tras `email_max_reintentos` agotados → log pasa a `fallo_definitivo`.

---

## 12. Uso desde movil

La aplicacion esta optimizada para usar comodamente desde telefono o tablet.

### Acceso desde movil

- En la misma red WiFi que el ordenador donde corre la app, abrir el navegador del telefono y entrar a `http://<IP-del-ordenador>:5173` (la IP local se muestra en la consola de Vite al arrancar).
- En produccion (Railway/dominio propio), entrar a la URL publica.
- Recomendado: anadir a pantalla inicio para que parezca una app nativa (en iOS Safari: boton compartir > Anadir a pantalla de inicio).

### Adaptaciones automaticas en pantallas pequenas

- **Barra inferior**: navegacion principal en la parte de abajo (Dashboard, Productos, Recetas, Produccion, Pedidos) + boton **Mas** para el resto. Respeta el safe-area del iPhone.
- **Tablas en cards**: en Productos, Pedidos, Ordenes de fabricacion, Lotes, Recuento y Dashboard las tablas se sustituyen por tarjetas verticales con la misma informacion mas legible.
- **Modales bottom-sheet**: los modales (nuevo pedido, editar producto, anadir lote, etc.) se anclan a la parte inferior de la pantalla con esquinas redondeadas arriba, en lugar de centrados.
- **Formularios apilados**: los campos que en desktop van en 2-3 columnas (telefono+email, fechas, niveles de cliente, etc.) se apilan verticalmente para evitar inputs estrechos.
- **Inputs sin zoom iOS**: todos los campos de texto/select/textarea fuerzan tamano minimo 16 px en movil para evitar que iOS haga zoom al hacer foco.
- **Tap targets de 36 px+**: botones de accion en cards y filas tienen una altura minima tactil comoda.
- **Notificaciones por encima de la barra**: las notificaciones aparecen por encima de la tab bar inferior para no taparla, con swipe-down para descartar.

### Lectura de codigo de barras

Al fabricar un lote o anadir stock, el icono de **escaner** abre la camara del movil y permite leer codigos de barras EAN/Code-128 directamente. Solo hace falta dar permiso de camara la primera vez.

### Limitaciones conocidas

- La descarga de PDF (albaran, trazabilidad CSV) abre el archivo en una pestana nueva — desde ahi se puede compartir o guardar.
- Algunos graficos de Finanzas se ven mejor en horizontal o desde tablet.
- El reporte de plastico (Ley 7/2022) se exporta como Excel — abrir desde Numbers/Sheets en movil.

---

## Guia rapida: Proceso completo de principio a fin

### Escenario: Un cliente pide 500 botes de Cola D2 1kg

**1. Recibir materia prima:**
- Stock > Nuevo lote > Acetato de Vinilo > 500 kg > Aprobar
- Stock > Nuevo lote > Agua > 400 L > Aprobar
- (repetir para cada MP)

**2. Fabricar cola:**
- Produccion > Fabricacion > Nueva > Receta "Cola D2" > 1000 kg
- Fabricar > confirmar ingredientes > datos calidad > Confirmar
- Si pH/solidos/viscosidad estan dentro del rango → lote Aprobado automatico
- Si algun valor esta fuera de rango → lote en Cuarentena, aviso al operario
- Resultado: 1000 kg de Cola D2 granel en stock
- Las alertas de stock de materias primas se generan automaticamente

**3. Crear receta de envasado (solo la primera vez):**
- Recetas > Envasado > Nueva receta
- Producto final: "Cola D2 Bote 1kg"
- Cola: Cola Blanca D2 (auto)
- Envase: Bote PET 1kg
- Material extra: Etiqueta D2

**4. Envasar:**
- Produccion > Envasado > Planificar
- Producto: Cola D2 Bote 1kg
- Cantidad: 500
- Planificar > Envasar > Ver lotes > Confirmar
- Resultado: 500 botes de Cola D2 1kg en stock
- Alertas de stock de envases/etiquetas se generan automaticamente

**5. Crear pedido:**
- Pedidos > Nuevo Pedido
- Cliente: "Ferreteria Garcia"
- Producto: Cola D2 Bote 1kg > 500 ud > 5.50 EUR/ud
- Guardar → Pedido confirmado con stock reservado (FEFO + SERIALIZABLE)
- Totales recalculados en servidor: 2750 EUR + IVA

**6. Preparar envio:**
- Boton verde **Consumir** en el pedido
- Ver lotes > Confirmar
- Pedido completado, stock descontado
- Alerta automatica si stock cae bajo minimo

**7. Generar albaran:**
- Icono descarga (PDF) o sobre (email) en el pedido completado

---

## Glosario

| Termino | Significado |
|---------|------------|
| **FEFO** | First Expiry, First Out — primero que caduca, primero que se usa (variante de FIFO optimizada para productos con caducidad) |
| **CMP** | Coste Medio Ponderado — media ponderada del precio de compra de todos los lotes en stock. Se usa como fallback cuando no hay stock suficiente para asignación cheapest-first |
| **Cheapest-first** | Algoritmo de asignación de coste: para cubrir la cantidad necesaria, empieza por el lote con el precio_compra más bajo y sube al siguiente cuando se agota. Refleja el coste real con el que arrancaría la próxima fabricación |
| **Coste actual** | Coste real calculado con asignación "cheapest-first" (más barato primero) sobre los lotes aprobados en almacén. Si no hay stock suficiente, se completa al precio ficha del producto. Aparece en la tabla **Rentabilidad** de Finanzas |
| **Coste futuro** | Coste proyectado usando el precio ficha de las materias primas (lo que costará la próxima compra). Se usa en **Impacto · Variación de margen** de Finanzas |
| **Merma** | Diferencia entre cantidad planificada y real producida (perdida en el proceso) |
| **Granel** | Cola sin envasar, directamente del reactor |
| **Trazabilidad** | Rastreo completo de un lote: de que materias primas viene, en que pedido acabo |
| **Albaran** | Documento de entrega que acompana al pedido |
| **Reserva** | Stock comprometido para un pedido confirmado (no descontado hasta el envio) |
| **stock_moves** | Registro inmutable de cada movimiento de stock (entrada, salida, ajuste, consumo, produccion, reconciliacion) |
| **Transaccion SERIALIZABLE** | Garantia de que si dos personas hacen lo mismo a la vez, una espera a la otra sin corrupcion |
| **Reconciliacion** | Verificar y corregir que el stock mostrado coincide con los lotes reales. Cada correccion queda registrada en stock_moves |
| **Multiplicador** | Factor que convierte cajas/pales en unidades individuales (ej: Caja 18 → multiplicador 18) |
| **Cuarentena QC** | Estado de un lote que no ha pasado control de calidad. Puede ser aprobado o rechazado por un responsable |
| **Meteo snapshot** | Captura automatica de condiciones climaticas exteriores (Open-Meteo) al confirmar una orden de fabricacion. Se guarda como JSONB en `ordenes_produccion.meteo` para correlacionar mermas con clima |
