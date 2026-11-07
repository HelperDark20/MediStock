// Envío de correos (avisos de asistencia). Toma la configuración de las
// variables de entorno de cPanel ("Setup Node.js App"):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  — cuenta que envía
//   SMTP_FROM (opcional)                        — remitente; por defecto SMTP_USER
// Sin SMTP_HOST no se envía nada (solo queda una línea en el log).
// SMTP_HOST=log (laboratorio): no envía; escribe el correo en el log.
let _transporte;

function _crearTransporte() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (e) { console.error('Correo: falta el paquete nodemailer (npm install)'); return null; }
  if (host === 'log') return nodemailer.createTransport({ jsonTransport: true });
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;
  return nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
}

function configurado() { return !!process.env.SMTP_HOST; }

// Devuelve true si se envió (o se registró en modo log)
async function enviarCorreo({ para, asunto, html, texto, adjuntos }) {
  if (_transporte === undefined) _transporte = _crearTransporte();
  if (!_transporte || !para) {
    console.log(`Correo no enviado (SMTP sin configurar): ${asunto}`);
    return false;
  }
  const info = await _transporte.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'notificaciones@novabridge.com.co',
    to: para,
    subject: asunto,
    html,
    text: texto,
    attachments: adjuntos || []
  });
  if (process.env.SMTP_HOST === 'log') console.log(`[correo de prueba] Para: ${para} · ${asunto}`);
  return !!info;
}

module.exports = { enviarCorreo, configurado };
