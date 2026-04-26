# Manual de Usuario — Colas Loga ERP

## Indice

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

- **Stock minimo**: cuando el stock baja de este valor, aparece alerta naranja
- **Stock maximo**: para calcular cuanto pedir al proveedor
- **Caducidad (meses)**: vida util desde la fecha de fabricacion
- **Proveedor**: enlaza con la ficha del proveedor para pedidos automaticos

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

**Control de calidad (opcional):**

Definir rangos aceptables de:
- pH (ej: 6.5 - 7.5)
- Solidos % (ej: 48 - 55)
- Viscosidad mPa·s (ej: 3000 - 5000)

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
3. Seleccionar **Aprobado** e indicar motivo (ej: "Control calidad OK")
4. El stock del producto se actualiza automaticamente

> Solo los lotes aprobados cuentan para el stock disponible.

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

### Consumo FIFO

Todo consumo de stock (fabricacion, envasado, pedidos) sigue orden FIFO:
1. **Primero**: lotes que caducan antes
2. **Segundo**: a igualdad de caducidad, el mas antiguo
3. Se puede ver que lotes se van a usar antes de confirmar cualquier operacion

### Reservas de stock

Al crear un pedido, el sistema reserva lotes FIFO para ese pedido:
- La reserva **no resta** stock fisico
- Pero **impide** que otro pedido use esos mismos lotes
- Las reservas se liberan automaticamente al completar o cancelar el pedido

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
     - Lotes FIFO que se van a usar (con lote_interno y cantidad de cada uno)
     - Indicador verde si hay stock suficiente, rojo si falta
   - **Pasos del proceso**: si la receta tiene pasos definidos, se muestran uno a uno
3. Rellenar datos de calidad (opcional):
   - **pH**: valor medido
   - **Solidos %**: porcentaje de solidos
   - **Viscosidad**: viscosidad medida
4. **Cantidad real producida**: si se produjeron menos kg de los planificados (merma)
5. **Fotos**: se pueden adjuntar fotos del proceso
6. Pulsar **Confirmar fabricacion**

**Paso 3: Que pasa al confirmar**

Todo ocurre en una unica transaccion atomica (si algo falla, no se hace nada):
1. Se verifican stocks de TODOS los ingredientes
2. Se descuentan materias primas de lotes FIFO
3. Se crean stock_moves para cada consumo (trazabilidad)
4. Se crea un nuevo lote de cola granel con:
   - Cantidad = lo realmente producido
   - Precio = coste total ingredientes / cantidad producida
5. Se actualiza stock del producto fabricado
6. Se calcula merma si la cantidad real difiere de la planificada
7. Si habia un pedido vinculado, pasa a estado "fabricado"

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
   - Para cada material: nombre, cantidad necesaria, lotes FIFO que se usaran
   - Indicador verde/rojo si hay stock suficiente
3. Si todo esta OK, pulsar **Envasar X ud**
4. Animacion del tanque llenando el bote
5. Resultado: producto creado, lote asignado, cantidad

#### B) Envasado rapido

Para cuando necesitas envasar ya, sin planificar antes.

1. Ir a **Produccion** > tab **Envasado** > boton **Rapido**
2. Mismo flujo que planificado: producto → cola → envase → materiales → cantidad
3. Pulsar **Ver lotes y confirmar**
4. Ver preview de lotes → confirmar → animacion → resultado

**Tambien se puede acceder desde Pedidos**: cuando un pedido necesita envasado, el boton naranja "Envasar" abre el envasado rapido con el producto ya pre-seleccionado.

### Multiplicador de cajas/pales

Si seleccionas como envase una **Caja 18 uds (75g)**:
- La cantidad que pones es en **cajas**, no en frascos
- El sistema calcula automaticamente:
  - 10 cajas x 18 = **180 frascos**
  - 180 x 0.075 kg = **13.5 kg de cola** necesarios
- Se consume:
  - 13.5 kg de cola granel (FIFO)
  - 180 frascos de 75g (auto-detectados del nombre del producto)
  - 10 cajas de 18 uds
  - Materiales extra que hayas anadido (etiquetas, etc.)

### Coste del producto envasado

El coste por unidad envasada se calcula automaticamente:
- Coste cola = CMP de la cola x peso por unidad
- Coste envase = CMP del envase
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
- Se reservan lotes FIFO automaticamente
- Los totales se recalculan en el servidor (subtotal + portes + IVA = total)

### El boton inteligente

En la lista de pedidos, cada uno muestra un boton de color segun lo que necesita:

| Color | Boton | Significado | Que hacer |
|-------|-------|-------------|-----------|
| **Verde** | Consumir | Hay stock suficiente del producto envasado | Pulsar para seleccionar lotes y completar |
| **Naranja** | Envasar | Hay cola granel pero faltan botes | Pulsar para ir a envasar el producto |
| **Rojo** | Fabricar | No hay cola granel suficiente | Pulsar para crear orden de fabricacion |

La columna **Accion** muestra el estado con color para ver de un vistazo que pedidos necesitan atencion.

### Consumir stock (boton verde)

1. Pulsar **Consumir** en el pedido
2. Se abre modal con los lotes que se van a usar:
   - Pre-seleccionados por FIFO
   - Se puede ajustar la cantidad de cada lote manualmente
   - Barra de progreso muestra si esta cubierto al 100%
3. Pulsar **Consumir** cuando todo este al 100%
4. El stock se descuenta, las reservas se liberan, el pedido pasa a **Completado**

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

### Editar un pedido

1. Pulsar el **lapiz** en el pedido (solo admin, solo si no esta completado)
2. Modificar productos, cantidades, precios, fecha, cliente
3. Guardar

### Cancelar un pedido

1. Pulsar la **X** en el pedido
2. Confirmar cancelacion
3. Las reservas de stock se liberan automaticamente
4. Se puede reactivar un pedido cancelado cambiando su estado a Confirmado (re-reserva stock)

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

El sistema analiza automaticamente los pedidos historicos y predice:
- Que cliente va a pedir
- Que producto y cantidad aproximada
- Cuando (rango de fechas)
- Nivel de confianza (alta/media/baja)

Las predicciones aparecen como marcadores en el calendario.

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

### Rentabilidad por producto

Tabla con todos los productos vendibles:
- **Precio venta**: lo que cobras
- **Precio coste**: calculado recursivamente (materias primas → cola granel → producto envasado)
- **Margen %**: (venta - coste) / venta x 100
  - Verde: >40%
  - Naranja: 20-40%
  - Rojo: <20%
- Pulsar en una fila para ver **desglose de coste** por ingrediente

Se puede filtrar por: Todos / Granel / Envasado

### Valor inventario por tipo (donut)

Distribucion del valor del stock entre:
- Materia Prima (azul)
- Fabricado/Granel (rojo)
- Envasado (verde)
- Embalaje (naranja)

### Top 10 inmovilizado

Los 10 productos con mas valor en stock, usando el CMP (Coste Medio Ponderado) real de los lotes.

### Impacto de precios

Muestra como las subidas/bajadas de precio de materias primas afectan al margen de cada receta. Expandir para ver detalle por ingrediente.

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

---

## 10. Configuracion y Administracion

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

- **Stock minimo**: genera notificacion cuando un producto baja del minimo
- **Caducidad**: alerta 30 dias antes de que un lote caduque
- **Merma**: alerta cuando la merma de una orden supera el % configurado

### Backups

- **Backup manual**: pulsar para generar backup cifrado (AES-256)
- **Restaurar**: seleccionar un backup para restaurar toda la base de datos
- Los backups incluyen la base de datos completa + archivos subidos

### Auditoria

Registro de TODAS las acciones del sistema:
- Quien hizo que y cuando
- Cambios de precio (con precio anterior y nuevo)
- Cambios de estado de lotes y pedidos
- Fabricaciones y envasados completados
- Ajustes manuales de stock

### Reconciliacion de stock

Si crees que hay discrepancias:
1. **Configuracion** > **Reconciliar stock**
2. Muestra productos donde stock_actual != suma de lotes aprobados
3. Pulsar **Reconciliar** para corregir automaticamente

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
- Resultado: 1000 kg de Cola D2 granel en stock

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

**5. Crear pedido:**
- Pedidos > Nuevo Pedido
- Cliente: "Ferreteria Garcia"
- Producto: Cola D2 Bote 1kg > 500 ud > 5.50 EUR/ud
- Guardar → Pedido confirmado con stock reservado

**6. Preparar envio:**
- Boton verde **Consumir** en el pedido
- Ver lotes > Confirmar
- Pedido completado, stock descontado

**7. Generar albaran:**
- Icono descarga (PDF) o sobre (email) en el pedido completado

---

## Glosario

| Termino | Significado |
|---------|------------|
| **FIFO** | First In, First Out — primero que caduca, primero que se usa |
| **CMP** | Coste Medio Ponderado — media ponderada del precio de compra de todos los lotes en stock |
| **Merma** | Diferencia entre cantidad planificada y real producida (perdida en el proceso) |
| **Granel** | Cola sin envasar, directamente del reactor |
| **Trazabilidad** | Rastreo completo de un lote: de que materias primas viene, en que pedido acabo |
| **Albaran** | Documento de entrega que acompana al pedido |
| **Reserva** | Stock comprometido para un pedido confirmado (no descontado hasta el envio) |
| **stock_moves** | Registro inmutable de cada movimiento de stock (entrada, salida, ajuste, consumo, produccion) |
| **Transaccion SERIALIZABLE** | Garantia de que si dos personas hacen lo mismo a la vez, una espera a la otra sin corrupcion |
| **Reconciliacion** | Verificar y corregir que el stock mostrado coincide con los lotes reales |
