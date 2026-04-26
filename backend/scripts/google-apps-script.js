/**
 * GOOGLE APPS SCRIPT — Detector de Pedidos por Email para Colas Loga ERP
 * =========================================================================
 *
 * INSTRUCCIONES DE INSTALACION:
 *
 * 1. Ve a https://script.google.com
 * 2. Crea un nuevo proyecto: "Loga ERP - Detector Pedidos"
 * 3. Copia TODO este codigo en el editor
 * 4. Cambia WEBHOOK_URL por tu URL real (IP local o ngrok/tunnel)
 * 5. Cambia WEBHOOK_TOKEN si lo has cambiado en el .env
 * 6. Guarda el proyecto (Ctrl+S)
 * 7. Ve a "Activadores" (icono reloj) > "Añadir activador":
 *    - Funcion: checkNewEmails
 *    - Evento: basado en tiempo
 *    - Intervalo: cada 5 minutos
 * 8. Autoriza los permisos cuando te lo pida
 *
 * COMO FUNCIONA:
 * - Cada 5 minutos revisa los emails nuevos (no leidos) en Gmail
 * - Busca palabras clave de pedido: "pedido", "necesitamos", "solicitar", etc.
 * - Si detecta un pedido, extrae: cliente, producto, cantidad, fecha
 * - Envia los datos al webhook del ERP
 * - Marca el email con una etiqueta "ERP-Procesado"
 *
 * PARA PRUEBAS:
 * - Ejecuta testWebhook() manualmente para verificar la conexion
 */

// ============================================
// CONFIGURACION — CAMBIA ESTOS VALORES
// ============================================
var WEBHOOK_URL = 'http://TU_IP_LOCAL:3001/api/pedidos/webhook';  // Ej: http://192.168.1.100:3001/api/pedidos/webhook
var WEBHOOK_TOKEN = 'loga-webhook-2026';
var LABEL_PROCESADO = 'ERP-Procesado';
// ============================================

/**
 * Funcion principal — se ejecuta cada 5 minutos via trigger
 */
function checkNewEmails() {
  // Buscar emails no leidos que parezcan pedidos
  var threads = GmailApp.search('is:unread -label:' + LABEL_PROCESADO, 0, 20);

  // Crear etiqueta si no existe
  var label = GmailApp.getUserLabelByName(LABEL_PROCESADO);
  if (!label) {
    label = GmailApp.createLabel(LABEL_PROCESADO);
  }

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();
    var msg = messages[messages.length - 1]; // Ultimo mensaje del hilo

    var asunto = msg.getSubject();
    var cuerpo = msg.getPlainBody();
    var from = msg.getFrom();
    var email = extractEmail(from);
    var nombre = extractName(from);

    // Detectar si parece un pedido
    if (esPedido(asunto, cuerpo)) {
      var datos = extraerDatosPedido(asunto, cuerpo);

      var payload = {
        cliente_nombre: nombre || email,
        cliente_email: email,
        producto_nombre: datos.producto || null,
        cantidad: datos.cantidad || null,
        unidad_medida: datos.unidad || 'kg',
        fecha_entrega: datos.fecha || null,
        asunto: asunto,
        cuerpo: cuerpo.substring(0, 2000), // Limitar longitud
        token: WEBHOOK_TOKEN
      };

      // Enviar al webhook
      try {
        var response = UrlFetchApp.fetch(WEBHOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        var code = response.getResponseCode();
        if (code === 201 || code === 200) {
          Logger.log('Pedido creado: ' + asunto + ' de ' + email);
          // Marcar como procesado
          thread.addLabel(label);
        } else {
          Logger.log('Error webhook (' + code + '): ' + response.getContentText());
        }
      } catch (e) {
        Logger.log('Error conexion webhook: ' + e.message);
      }
    }
  }
}

/**
 * Detecta si un email parece un pedido
 */
function esPedido(asunto, cuerpo) {
  var texto = (asunto + ' ' + cuerpo).toLowerCase();
  var keywords = [
    'pedido', 'pedir', 'solicitar', 'solicitud',
    'necesitamos', 'necesito', 'enviar',
    'presupuesto', 'cotizacion',
    'cola blanca', 'cola amarilla', 'adhesivo',
    'kg de', 'kilos de', 'litros de',
    'orden de compra', 'compra',
    'entregar', 'entrega',
    'unidades de', 'bidones de', 'garrafas de'
  ];

  for (var i = 0; i < keywords.length; i++) {
    if (texto.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  return false;
}

/**
 * Extrae datos del pedido del texto del email
 */
function extraerDatosPedido(asunto, cuerpo) {
  var texto = asunto + '\n' + cuerpo;
  var resultado = { producto: null, cantidad: null, unidad: 'kg', fecha: null };

  // Extraer cantidad + unidad: "500 kg", "200 litros", "100 unidades"
  var cantidadMatch = texto.match(/(\d+[\.,]?\d*)\s*(kg|kilos?|litros?|l|unidades?|ud|bidones?|garrafas?|botes?|cajas?)/i);
  if (cantidadMatch) {
    resultado.cantidad = parseFloat(cantidadMatch[1].replace(',', '.'));
    var u = cantidadMatch[2].toLowerCase();
    if (u.match(/^(kg|kilo)/)) resultado.unidad = 'kg';
    else if (u.match(/^(l$|litro)/)) resultado.unidad = 'L';
    else if (u.match(/^(ud|unidad)/)) resultado.unidad = 'ud';
    else resultado.unidad = u;
  }

  // Extraer producto: buscar nombres conocidos
  var productos = [
    'cola blanca', 'cola amarilla', 'cola rapida',
    'cola autoadhesiva', 'cola estandar', 'cola tinte',
    'adhesivo', 'cola d2', 'cola d3'
  ];
  for (var i = 0; i < productos.length; i++) {
    if (texto.toLowerCase().indexOf(productos[i]) !== -1) {
      resultado.producto = productos[i];
      break;
    }
  }

  // Si no matchea producto conocido, buscar "de XXXX" despues de la cantidad
  if (!resultado.producto) {
    var prodMatch = texto.match(/\d+\s*(?:kg|litros?|unidades?)\s+(?:de\s+)?([A-Za-zÁ-ú\s]+?)(?:\.|,|\n|$)/i);
    if (prodMatch) {
      resultado.producto = prodMatch[1].trim().substring(0, 100);
    }
  }

  // Extraer fecha: "para el 25/04", "entrega 25 abril", "antes del viernes"
  var fechaMatch = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-]?(\d{2,4})?/);
  if (fechaMatch) {
    var dia = fechaMatch[1];
    var mes = fechaMatch[2];
    var anio = fechaMatch[3] || new Date().getFullYear().toString();
    if (anio.length === 2) anio = '20' + anio;
    resultado.fecha = anio + '-' + mes.padStart(2, '0') + '-' + dia.padStart(2, '0');
  }

  return resultado;
}

/**
 * Extrae email de un string tipo "Nombre <email@test.com>"
 */
function extractEmail(from) {
  var match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

/**
 * Extrae nombre de un string tipo "Nombre <email@test.com>"
 */
function extractName(from) {
  var match = from.match(/^([^<]+)/);
  return match ? match[1].trim().replace(/"/g, '') : '';
}

/**
 * PRUEBA — ejecuta esta funcion manualmente para verificar la conexion
 */
function testWebhook() {
  var payload = {
    cliente_nombre: 'Test Google Apps Script',
    cliente_email: 'test@google.com',
    producto_nombre: 'Cola Blanca Test',
    cantidad: 100,
    unidad_medida: 'kg',
    asunto: 'Test de conexion',
    cuerpo: 'Este es un pedido de prueba desde Google Apps Script',
    token: WEBHOOK_TOKEN
  };

  var response = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log('Respuesta: ' + response.getResponseCode() + ' - ' + response.getContentText());
}
