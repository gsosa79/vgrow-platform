// Envío de emails. EMAIL_MODO=prueba (por defecto) escribe el mensaje en el log y en data/emails.log;
// EMAIL_MODO=ses lo manda por Amazon SES (API v2, firmada con AWS Signature Version 4, sin librerías extra).
// Variables para SES: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_REMITENTE.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha256 = x => crypto.createHash('sha256').update(x, 'utf8').digest('hex');
const hmac = (clave, x) => crypto.createHmac('sha256', clave).update(x, 'utf8').digest();

// Clave de firma de SigV4: kDate → kRegion → kService → kSigning
function claveFirma(secreto, fecha, region, servicio) {
  return hmac(hmac(hmac(hmac('AWS4' + secreto, fecha), region), servicio), 'aws4_request');
}

// Firma un pedido HTTP para AWS. Devuelve los headers a mandar.
function firmarAws({ metodo, host, ruta, cuerpo, region, servicio, clave, secreto, ahora = new Date() }) {
  const amzDate = ahora.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const fecha = amzDate.slice(0, 8);
  const headers = { 'content-type': 'application/json', host, 'x-amz-date': amzDate };
  const nombres = Object.keys(headers).sort();
  const canonicos = nombres.map(h => `${h}:${headers[h]}\n`).join('');
  const firmados = nombres.join(';');
  const pedido = [metodo, ruta, '', canonicos, firmados, sha256(cuerpo)].join('\n');
  const alcance = `${fecha}/${region}/${servicio}/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', amzDate, alcance, sha256(pedido)].join('\n');
  const firma = crypto.createHmac('sha256', claveFirma(secreto, fecha, region, servicio)).update(aFirmar, 'utf8').digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${clave}/${alcance}, SignedHeaders=${firmados}, Signature=${firma}` };
}

async function enviarSes({ para, asunto, texto, html }) {
  const region = process.env.AWS_REGION || 'us-east-1';
  const host = `email.${region}.amazonaws.com`;
  const ruta = '/v2/email/outbound-emails';
  const cuerpo = JSON.stringify({
    FromEmailAddress: process.env.EMAIL_REMITENTE,
    Destination: { ToAddresses: [para] },
    Content: { Simple: {
      Subject: { Data: asunto, Charset: 'UTF-8' },
      Body: { Text: { Data: texto, Charset: 'UTF-8' }, ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}) },
    } },
  });
  const headers = firmarAws({ metodo: 'POST', host, ruta, cuerpo, region, servicio: 'ses',
    clave: process.env.AWS_ACCESS_KEY_ID, secreto: process.env.AWS_SECRET_ACCESS_KEY });
  const r = await fetch(`https://${host}${ruta}`, { method: 'POST', headers, body: cuerpo, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`SES respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { enviado: true };
}

async function enviarEmail({ para, asunto, texto, html }) {
  const modo = (process.env.EMAIL_MODO || 'prueba').toLowerCase();
  if (modo === 'ses') return enviarSes({ para, asunto, texto, html });
  // Modo de prueba: nada sale del servidor
  const linea = `[email de prueba] ${new Date().toISOString()} para=${para} asunto="${asunto}"\n${texto}\n`;
  console.log(linea);
  try { fs.appendFileSync(path.join(__dirname, '..', 'data', 'emails.log'), linea + '\n'); } catch (e) { /* sin archivo, queda el log */ }
  return { enviado: false, prueba: true };
}

module.exports = { enviarEmail, firmarAws, claveFirma };
