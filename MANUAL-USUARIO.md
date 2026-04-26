# Manual de Usuario — ERP Colas Loga

## Indice

1. [Acceso al sistema](#1-acceso-al-sistema)
2. [Dashboard](#2-dashboard)
3. [Productos](#3-productos)
4. [Recetas](#4-recetas)
5. [Produccion](#5-produccion)
6. [Lotes](#6-lotes)
7. [Pedidos](#7-pedidos)
8. [Clientes](#8-clientes)
9. [Proveedores](#9-proveedores)
10. [Finanzas](#10-finanzas)
11. [Configuracion](#11-configuracion)
12. [Backups y seguridad](#12-backups-y-seguridad)
13. [Acceso desde movil](#13-acceso-desde-movil)
14. [Roles y permisos](#14-roles-y-permisos)
15. [Preguntas frecuentes](#15-preguntas-frecuentes)

---

## 1. Acceso al sistema

### Desde el ordenador
Abrir el navegador y entrar en la direccion de la aplicacion (por defecto `http://localhost:5173`).

### Desde el movil
Entrar en la misma direccion usando la IP del ordenador donde esta el servidor (ejemplo: `http://192.168.1.100:5173`).

### Usuarios
El sistema tiene dos tipos de usuario:

| Rol | Email por defecto | Contraseña | Que puede hacer |
|-----|-------------------|-----------|-----------------|
| **Administrador** | admin@loga.es | admin123 | Todo |
| **Operario** | operario@loga.es | operario123 | Producir, ver stock, ver pedidos (sin precios) |

Al iniciar sesion se muestra una animacion del logo de Colas Loga.

La opcion "Recordar sesion" mantiene la sesion abierta y recuerda el email para la proxima vez.

---

## 2. Dashboard

Pantalla principal con resumen de toda la actividad.

### KPIs (indicadores)
- **Productos**: total de productos registrados
- **Stock bajo**: productos por debajo del minimo configurado
- **Pendientes**: ordenes de produccion pendientes de fabricar
- **Completadas**: ordenes de produccion completadas

### Grafico de produccion
Barras rojas mostrando los kg producidos cada dia durante los ultimos 7 dias.

### Alertas
- **Stock bajo** (rojo): productos que han bajado del stock minimo. Boton "Reponer stock" redirige a Productos.
- **Caducidad proxima** (ambar): lotes que caducan en los proximos 30 dias. Boton "Ver lotes" redirige a Lotes.
- **Error backup** (rojo, solo admin): si el ultimo backup automatico ha fallado.

### Pedidos recientes
Muestra los ultimos pedidos de clientes. Los pedidos nuevos tienen un boton "Confirmar" para aceptarlos.

### Proximas fabricaciones
Ordenes planificadas para hoy y dias siguientes con boton "Fabricar" para ir directamente a produccion.

### Prediccion de demanda
El sistema analiza el historial de pedidos de cada cliente y predice cuando hara el proximo pedido. Muestra:
- Cliente, producto, cantidad habitual, intervalo entre pedidos
- Fecha estimada con rango (ej: "31/5/2026 - 2/6/2026")
- Probabilidad: Alta (muy constante), Media, Baja
- Medalla del cliente (Oro, Plata, Bronce)
- Botones: "Sugerir pedido" (envia email via SMTP del programa), "Fabricar" (va a Produccion), "Ver stock" (va a Productos con banner)

Las predicciones se ordenan por proximidad: primero las que estan a punto de llegar, despues las vencidas.

### Calendario de produccion
Vista mensual interactiva con ordenes, recordatorios y predicciones.

**Filtros** (barra superior, se mantienen al recargar):
- **Todo**: activa todos los filtros
- **Pendientes**: ordenes pendientes/confirmadas (ambar)
- **Completadas**: ordenes completadas (verde)
- **Recordatorios**: notas personales con 📌
- **Predicciones**: fechas estimadas de proximos pedidos (lila)

Cada filtro es independiente. Puedes tener varios activos a la vez (ej: Pendientes + Predicciones).

**Acciones del calendario:**
- **Click en un dia** → abre panel con todo lo del dia (ordenes, recordatorios, predicciones)
- **Click en "+ Recordatorio"** → crea nota con titulo y color (indigo, rojo, verde)
- **Arrastrar una orden** a otro dia → cambia la fecha planificada
- **Arrastrar un recordatorio** a otro dia → cambia la fecha
- **Click en una orden** → va a Produccion

**Colores:**
- **Ambar**: pendientes/confirmadas
- **Verde**: completadas
- **Lila**: predicciones de demanda
- **Indigo/Rojo/Verde**: recordatorios (segun color elegido)

### Ultimas ordenes
Tabla con las ordenes mas recientes. Click en una fila para ir a esa orden.

---

## 3. Productos

Gestiona todos los productos organizados por tipo.

### Tipos de producto
| Tipo | Codigo | Descripcion |
|------|--------|-------------|
| **Materia Prima** | MP-xxx | Lo que compras a proveedores (VAM, PVOH, agua...) |
| **Prod. Fabricado** | PF-xxx | Lo que sale del reactor a granel (Cola D2, Cola Rapida...) |
| **Prod. Envasado** | PE-xxx | Botes, garrafas, bidones listos para vender |
| **Material Embalaje** | ME-xxx | Frascos vacios, cajas, etiquetas, sacos |

### Filtros
Barra de pestañas: Todos | Materia Prima | Fabricado (granel) | Envasado (botes) | Embalaje

### Indicador de stock
- **Verde "OK"**: stock suficiente
- **Ambar "Justo"**: stock cerca del minimo (configurable en Configuracion, % sobre el minimo)
- **Rojo "Bajo"**: stock por debajo del minimo

### Como añadir un producto nuevo (cola)

**Forma correcta** — crear desde Recetas (no desde Productos):
1. Ir a **Recetas** → tab **Fabricacion** → "Nueva Fabricacion"
2. Poner nombre (ej: "Cola Vinilica Extra") y rendimiento (ej: 1000 kg)
3. Guardar → el sistema crea automaticamente el producto fabricado (PF-xxx)
4. Expandir la receta → añadir ingredientes (materias primas, cantidades)
5. Para vender en botes: ir a tab **Envasado** → "Nuevo Envasado"
6. Nombre (ej: "Env. Vinilica — Bote 1kg"), guardar → crea producto envasado (PE-xxx)
7. Añadir ingredientes: cola granel + bote + etiqueta
8. Ir a **Productos** → buscar los nuevos → poner precios de coste y venta

**Para materias primas o embalaje**: si, crear directamente desde Productos → "Nuevo Producto".

### Campos del producto
- **Codigo**: se genera automaticamente, se puede cambiar
- **Precio coste**: precio de compra al proveedor
- **Precio venta**: precio al cliente
- **Stock minimo/maximo**: para alertas
- **Caducidad automatica (meses)**: si se define, al crear un lote se calcula la fecha de caducidad automaticamente. Ej: poner 36 en Acetato de Vinilo = todos los lotes caducan a 3 años
- **Peso por unidad (kg)**: solo para envasados. Ej: Garrafa 5kg = 5. Se usa para calcular peso total en pedidos (10 garrafas = 50 kg)

### Añadir stock
1. Pulsar el boton verde "+"
2. Introducir cantidad, proveedor, precio de compra del lote
3. El codigo de lote se genera automaticamente (LMP-260420-A3F2). Se puede cambiar.
4. Opcionalmente: referencia proveedor, fecha de caducidad, ubicacion en almacen
5. Si el precio ha cambiado respecto al anterior, se muestra "Subida: +X%" o "Bajada: -X%"
6. Pulsar "Registrar entrada"

### Editar stock
1. Pulsar el lapiz de un producto
2. En la seccion "Ajuste de stock": modificar el stock actual
3. Seleccionar el lote afectado en el desplegable (solo muestra lotes con stock > 0)
4. Guardar

### Pedir stock por email
1. Pulsar el sobre azul
2. Se muestra el email del proveedor, cantidad sugerida y preview del email
3. Modificar cantidad si se desea — el email se actualiza automaticamente
4. Se puede editar el texto del email antes de enviar
5. Pulsar "Confirmar y enviar"

### Recuento de inventario
1. Pulsar el boton "Recuento" en Productos
2. Se muestran todos los productos con lotes activos
3. Introducir la **cantidad contada fisicamente** en cada lote
4. Pulsar "Calcular diferencias" para comparar con el sistema
5. Si hay diferencias, se muestran en tabla con color (verde = sobrante, rojo = faltante)
6. Pulsar "Aplicar cambios" para ajustar el sistema a las cantidades reales

### Escanear codigo de barras
Pulsar el boton "Escanear" para abrir la camara del movil y buscar un producto por su codigo de barras.

---

## 4. Recetas

Define las formulas de fabricacion de cada producto terminado.

### Lista de recetas
Cada receta muestra:
- Nombre y version
- Producto que genera, rendimiento por batch, numero de ingredientes
- **Borde verde**: hay stock suficiente para producir
- **Borde rojo**: falta stock de alguna materia prima
- **Max: X kg** (azul): maxima cantidad que se puede producir con el stock actual
- Badges de control de calidad: pH, % solidos, viscosidad (si estan definidos)

### Crear receta
1. Pulsar "Nueva Receta"
2. Introducir nombre (obligatorio)
3. Introducir rendimiento (kg que produce un batch con las cantidades de la receta)
4. Opcionalmente: definir rangos de control de calidad (pH min/max, % solidos min/max, viscosidad min/max)
5. Notas opcionales
6. Guardar — se crea automaticamente el producto terminado asociado

### Añadir ingredientes
1. Expandir la receta (flecha)
2. Pulsar "Añadir ingrediente"
3. Seleccionar materia prima, cantidad por batch, % de merma prevista
4. Guardar

### Pasos del proceso de fabricacion
Cada receta puede tener pasos detallados que guian al operario durante la fabricacion:

1. Editar la receta (lapiz)
2. En la seccion "Pasos del proceso", pulsar "Añadir paso"
3. Para cada paso definir:
   - **Fase**: Preparacion, Reaccion, Aditivos, Enfriamiento, Control, Envasado
   - **Titulo**: nombre del paso (ej: "Cargar agua desmineralizada")
   - **Descripcion**: instrucciones detalladas para el operario
   - **Temperatura**: temperatura objetivo en ese paso
   - **Duracion**: tiempo de simulacion para la visualizacion
   - **Ingredientes**: seleccionar que materias primas se añaden en este paso
4. Guardar

### Visualizacion del reactor
Al expandir una receta que tiene pasos definidos, se muestra una **simulacion visual** con:
- Tanque rojo minimalista con logo Colas Loga
- Animacion de llenado progresivo al avanzar por los pasos
- Termometro animado con temperatura de cada fase
- Timeline interactiva con todos los pasos clickeables
- Panel con instrucciones detalladas del paso actual

Pulsar "Simular" para ver la animacion automatica o hacer click en cada paso para verlo individualmente.

### Fabricar desde receta
Pulsar el boton "Play" de una receta para ir directamente a Produccion con la receta pre-seleccionada.

---

## 5. Produccion (Ordenes de Fabricacion)

Gestiona el proceso de fabricacion desde la planificacion hasta la finalizacion.

### Crear orden de produccion
1. Pulsar "Nueva Orden"
2. **Paso 1**: Seleccionar receta
3. **Paso 2**: Cantidad a producir, fecha planificada, cliente
4. **Paso 3**: Notas, confirmar y crear

### Fabricar (proceso de fabricacion)
1. Pulsar "Fabricar" en una orden pendiente
2. Se abre el modal de fabricacion con el **tanque rojo animado** con logo Colas Loga

#### Si la receta tiene pasos definidos (modo guiado):
3. Se muestra el **paso actual** con:
   - Fase y titulo del paso
   - Instrucciones detalladas para el operario
   - Temperatura objetivo
   - Ingredientes que hay que añadir en este paso con **cantidad exacta por lote** (FIFO)
4. **Confirmar ingredientes**: pulsar "OK" en cada materia prima de ese paso
5. Pulsar **"Siguiente paso"** o **"Confirmar paso"** para avanzar — el tanque se llena proporcionalmente
6. Timeline de pasos arriba: bolitas numeradas que se ponen verdes al completar
7. Si sales del modal y vuelves a entrar, **continuas en el paso donde ibas** (se guarda automaticamente)

#### Si la receta NO tiene pasos (modo clasico):
3. **Confirmar cada ingrediente** uno a uno pulsando "OK". El tanque se va llenando.

#### En ambos modos, al confirmar todos:
8. Rellenar datos de control de calidad:
   - **Fecha/hora de fabricacion**
   - **pH** (aviso amarillo si fuera de rango)
   - **% Solidos** (aviso si fuera de rango)
   - **Viscosidad** (aviso si fuera de rango)
   - **Fotos del lote** (se pueden subir varias)
9. Pulsar "Fabricar ahora"
10. El sistema:
    - Descuenta las materias primas del stock (FIFO: consume primero los lotes mas antiguos)
    - Crea un lote de producto terminado con codigo automatico
    - Registra todos los movimientos de stock
    - Si hay un pedido vinculado, lo marca como completado
    - Muestra el **lote producido en grande** al completar

#### Lotes por ingrediente
Cada ingrediente muestra que lotes se van a usar y **cuanto echar de cada uno**:
- Ejemplo: `LMP-260422-GXB8: 95.00 kg` + `LMP-260422-MWF6: 148.71 kg`
- El sistema calcula automaticamente cuanto tomar de cada lote siguiendo FIFO (primero el mas antiguo/proximo a caducar)

### Trazabilidad
Pulsar el ojo en una orden completada para ver:
- Datos de fabricacion (pH, solidos, viscosidad, fecha, notas)
- Coste de produccion (solo admin)
- Lotes consumidos de cada materia prima con cantidades
- Lote de producto terminado generado
- Fotos y archivos adjuntos

### Adjuntar documentos
Pulsar el clip en una orden completada para adjuntar fotos o documentos adicionales (certificados de calidad, analisis, etc).

### Descargar PDF de trazabilidad
Pulsar la flecha de descarga para obtener un PDF con:
- Cabecera con logo Colas Loga y datos de la empresa
- Datos de fabricacion completos
- Tabla de materias primas consumidas con lotes
- Coste de produccion desglosado
- Fotografias del lote

### Enviar trazabilidad por email
Pulsar el icono de envio para enviar al cliente:
- PDF de trazabilidad (sin costes ni cantidades internas)
- Fotos del lote adjuntas
- Documentos adjuntos

### Revertir o cancelar
Al borrar una orden completada, el sistema ofrece dos opciones:
- **Revertir stock y cancelar**: devuelve las materias primas al inventario y elimina el lote producido
- **Borrar sin revertir**: cancela la orden sin tocar el inventario

### Buscador
Buscar por numero de orden, receta, producto, cliente, fecha o cantidad.

---

## 6. Lotes

Gestiona todos los lotes de materias primas y productos terminados.

### Informacion de cada lote
- Codigo de lote, producto, cantidad actual/inicial
- Estado: cuarentena, aprobado, rechazado
- Fecha de entrada, caducidad, ubicacion
- Precio de compra del lote

### Cambiar estado
Pulsar en el estado del lote para cambiarlo (cuarentena → aprobado/rechazado).

### Trazabilidad de un lote
Pulsar "Trazabilidad" para ver en que ordenes de produccion se ha utilizado cada lote. Muestra:
- Tipo de movimiento (consumo, produccion, salida)
- Orden de produccion vinculada
- Cantidad consumida
- Fecha

---

## 7. Pedidos

Gestiona los pedidos de clientes.

### Crear pedido
1. Pulsar "Nuevo Pedido"
2. **Cliente**: seleccionar de la lista o escribir nombre
3. **Productos**: buscar por nombre en el buscador inteligente
   - Se agrupa por: **Fabricado (granel)** en rojo y **Envasado (botes)** en verde
   - Muestra stock disponible de cada producto
4. **Formato de caja** (solo envasados): si el producto es 75g, 250g, 500g o botes → aparece selector de formato:
   - Unidades sueltas
   - Caja 18 uds (75g), Caja 40 uds (250g), Caja 24 uds (500g)
   - Caja 12/24 uds (botes 1kg)
   - Pale (garrafas/bidones)
   - Otro formato (escribir numero de unidades por caja)
5. **Cantidad**: si seleccionas caja, pones numero de cajas. El total se calcula: "3 cajas × 24 = 72 ud"
6. **Precio/ud**: se rellena del producto, se puede cambiar
7. **Unidad**: para envasados siempre es "ud" (no se puede cambiar a kg)
8. Portes e IVA (por defecto 21%)

### Info de stock en cada pedido
Para productos envasados muestra dos lineas:
- **Envasado**: X ud (botes listos)
- **Cola granel**: X kg (cola disponible para envasar)

### Estados del pedido (flujo completo)

| Estado | Descripcion | Boton que aparece |
|--------|-------------|-------------------|
| **Nuevo** | Recien creado | Confirmar |
| **Confirmado** | Aceptado | Consumir / Envasar / Fabricar (segun stock) |
| **En produccion** | Fabricando cola | Marcar fabricado |
| **Fabricado** | Cola lista | Envasar (si envasado) / Completar (si granel) |
| **Envasado** | Botes listos | Completar |
| **Completado** | Entregado | — |
| **Cancelado** | Anulado | Reactivar |

**Boton inteligente segun stock:**
- Si hay botes envasados suficientes → **Consumir** (verde)
- Si hay cola granel pero no botes → **Envasar** (verde)
- Si no hay ni cola granel → **Fabricar** (rojo)

### Paginacion
25 pedidos por pagina. Barra inferior con: rango (1-25 de 426), botones de pagina, "Ir a [pagina]".

### Albaran de entrega
El albaran PDF cumple con la legislacion española e incluye:
- Datos del emisor (razon social, CIF, direccion) configurados en Configuracion
- Datos del destinatario (cliente, NIF, direccion)
- Detalle de la mercancia con precios
- Desglose: base imponible + portes + IVA + total
- Trazabilidad de lotes expedidos
- Fotografias del lote
- Zona de firmas (entrega y recepcion)

### Operario
El operario puede ver los pedidos pero sin precios ni acciones de confirmar/editar/cancelar. Esas acciones son solo para el administrador.

---

## 8. Clientes

Gestiona la base de datos de clientes con sistema de medallas por consumo.

### Datos de cada cliente
- Nombre (obligatorio)
- Email, telefono, NIF/CIF, direccion, notas
- **Consumo total**: suma de todos los pedidos completados (se calcula automaticamente)
- **Nivel/medalla**: segun consumo acumulado

### Medallas de cliente
| Medalla | Umbral por defecto | Badge |
|---------|-------------------|-------|
| **ORO** | >150.000 EUR | Dorado |
| **PLATA** | >80.000 EUR | Gris metalico |
| **BRONCE** | >20.000 EUR | Cobre |

Los umbrales se pueden cambiar en **Configuracion → Niveles de cliente**. Al guardar, todos los clientes se recalculan automaticamente.

Los clientes se ordenan por consumo (mejores primero).

### Uso
Los clientes se usan en: pedidos, ordenes de produccion, albaranes, emails y predicciones de demanda.

---

## 9. Proveedores

Gestiona la base de datos de proveedores de materias primas.

### Datos de cada proveedor
- Nombre, email, telefono, direccion

### Uso
Los proveedores se asignan a las materias primas. Cuando el stock baja, se puede enviar un email de pedido directamente desde Productos.

---

## 10. Finanzas (solo administrador)

Panel financiero con toda la informacion economica.

### KPIs
- **Facturacion total**: suma de todos los pedidos completados
- **Coste produccion**: suma de materias primas consumidas en fabricacion
- **Beneficio bruto**: facturacion - coste
- **Valor inventario**: valor de todo el stock a precio de coste

### Grafico de ventas
Barras verdes con facturacion por mes (ultimos 6 meses).

### Rentabilidad por producto
Tabla con cada producto terminado:
- Precio de venta vs precio de coste (coste medio ponderado real de los lotes en stock)
- Margen porcentual: verde (>40%), ambar (20-40%), rojo (<20%)
- Beneficio por unidad

El coste se calcula automaticamente usando el **coste medio ponderado** de cada materia prima segun los lotes que quedan en stock. Cuando se acaba un lote barato y solo queda el caro, el margen se actualiza solo.

### Impacto de precios en rentabilidad
Muestra como afectan las subidas de precio de materias primas al margen de cada receta:
- Click en una receta para ver que ingrediente ha subido y cuanto impacta por batch
- Diferencia de margen anterior vs actual (ejemplo: "Margen: 35.7% → -2.5pp")

### Precios de materias primas
Tabla con precio anterior vs actual de cada materia prima y variacion porcentual.

### Historial de precios
Cada vez que se cambia el precio de compra o venta de un producto, se registra automaticamente. Se puede ver la evolucion en el tiempo.

---

## 11. Configuracion (solo administrador)

### Datos de la empresa
- Razon social, CIF, direccion, telefono, web
- Estos datos aparecen en albaranes, PDFs y emails

### Alertas de stock
- Porcentaje de alerta: umbral para considerar stock bajo
- Boton "Re-evaluar alertas": recalcula que productos estan bajo minimos

### Email (SMTP)
- Configuracion del servidor de correo (host, puerto, usuario, contraseña)
- Plantilla del email de pedido a proveedores con variables: {{producto}}, {{cantidad}}, {{unidad}}, {{proveedor}}
- Preview en vivo del email
- Boton "Probar SMTP": envia un email de prueba para verificar la configuracion

### Backup
- Boton "Hacer backup": genera backup cifrado de la base de datos
- Se guarda en local y se sube automaticamente a Google Drive
- El backup se ejecuta automaticamente cada noche a las 3:00

---

## 12. Backups y seguridad

### Backup automatico
Cada noche a las 3:00 se ejecuta un backup automatico que:
1. Exporta toda la base de datos
2. La comprime (de ~2MB a ~36KB)
3. La cifra con AES-256 (clave configurada)
4. La guarda en el ordenador (ultimas 2 copias: hoy + ayer)
5. La sube a Google Drive (ultimas 10 copias)

### Restaurar un backup
```bash
openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass "pass:CLAVE" -in backup.sql.gz.enc | gunzip | psql loga_erp
```

### Seguridad del sistema
- **Autenticacion JWT**: todas las peticiones requieren un token firmado que expira en 24 horas
- **Roles**: el operario no puede acceder a finanzas, configuracion, proveedores ni clientes
- **Bloqueo progresivo**: 5 intentos fallidos → bloqueo 15 min, 10 → 30 min, 15 → 1 hora (se duplica cada 5 fallos)
- **Registro de accesos**: cada login (exitoso o fallido) se registra con IP, navegador, fecha y hora. El administrador puede consultarlos desde la API
- **Trazabilidad de peticiones**: cada operacion genera un Trace ID unico visible en los logs del servidor
- **CORS cerrado**: solo acepta peticiones desde el dominio configurado
- **Cifrado de backups**: AES-256, imposible de leer sin la clave
- **Contraseñas**: almacenadas con bcrypt (hash irreversible)
- **Registro protegido**: solo un administrador autenticado puede crear nuevos usuarios
- **Validacion de datos**: stock no puede ser negativo, transiciones de estado controladas, limites en todas las operaciones

---

## 13. Acceso desde movil

La aplicacion esta adaptada para movil:
- **Barra inferior**: 4 pestañas principales (Dashboard, Productos, Produccion, Pedidos) + boton "Mas" para acceder al resto
- **Fabricacion**: optimizada para usar en planta con el movil
- **Escaneo**: usa la camara del movil para leer codigos de barras
- **Fotos**: sube fotos directamente desde la camara del movil

Para acceder desde el movil, ambos dispositivos deben estar en la misma red WiFi.

---

## 14. Roles y permisos

### Administrador
Acceso completo a todas las secciones:
- Dashboard, Productos, Recetas, Produccion, Lotes
- Pedidos (con precios y acciones completas)
- Clientes, Proveedores
- Finanzas
- Configuracion

### Operario
Acceso limitado:
- Dashboard (sin info financiera de backup)
- Productos (sin precio de venta, puede añadir stock)
- Recetas (puede ver ingredientes)
- Produccion (puede fabricar, registrar QC, subir fotos)
- Lotes (puede ver trazabilidad)
- Pedidos (solo ver, sin precios ni acciones de confirmar/editar)

**NO puede ver**: Proveedores, Clientes, Finanzas, Configuracion, costes de produccion, precios de venta, albaranes.

---

## 15. Preguntas frecuentes

### No puedo iniciar sesion
- Verificar email y contraseña
- Si has intentado muchas veces, espera 15 minutos (bloqueo de seguridad)
- Contactar con el administrador para resetear la contraseña

### El stock no coincide con lo que tengo en el almacen
1. Ir a Productos → buscar el producto
2. Pulsar el lapiz → editar stock actual
3. Seleccionar el lote afectado
4. El sistema registra el ajuste automaticamente

### Quiero fabricar pero dice "STOCK_INSUFICIENTE"
Significa que no hay suficientes materias primas. Opciones:
- Añadir stock de las materias primas que faltan (boton "+" en Productos)
- Pedir al proveedor (boton de sobre en Productos)
- Fabricar una cantidad menor

### Como se el coste real de lo que fabrico
1. Fabricar la orden normalmente
2. Pulsar el ojo en la orden completada
3. El coste aparece desglosado (solo admin)
4. El PDF de trazabilidad tambien incluye la seccion de costes

### Como envio un albaran al cliente
1. Ir a Pedidos
2. Completar el pedido (consumir stock o fabricar)
3. Pulsar el icono de envio (avion)
4. Introducir email del destinatario
5. Se envia el albaran PDF + trazabilidad + fotos

### El backup ha fallado
1. El dashboard muestra un banner rojo si el backup falla
2. Ir a Configuracion → pulsar "Hacer backup" manualmente
3. Si sigue fallando, verificar que Google Drive esta configurado

### Como añado un nuevo operario
El administrador puede crear usuarios desde la API (endpoint protegido). Contactar con el responsable tecnico para añadir nuevos operarios.

### Puedo usar la aplicacion sin internet
La aplicacion necesita conexion al servidor. Si el servidor esta en la red local, no necesitas internet para usar la app. Los backups a Google Drive si necesitan internet.

---

## Datos tecnicos

| Componente | Tecnologia |
|-----------|-----------|
| Frontend | React + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Base de datos | PostgreSQL |
| Autenticacion | JWT (JSON Web Tokens) |
| PDF | pdfkit |
| Email | Nodemailer |
| Backups | pg_dump + AES-256 + rclone (Google Drive) |

### Requisitos minimos del servidor
- Node.js 18+
- PostgreSQL 14+
- 1 GB RAM
- 5 GB disco

### Puertos
- Frontend: 5173 (Vite dev) o 80/443 (produccion)
- Backend: 3001
- PostgreSQL: 5432

---

*Colas Loga — Adhesivos Vinilicos de Alta Resistencia*
*Manual actualizado el 24 de abril de 2026*
