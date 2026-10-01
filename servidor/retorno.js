// Email mensual de retorno (solo usuarios con cuenta que lo aceptaron al crearla).
// - A los 30 días del último diagnóstico de la empresa: "Es momento de actualizar tus números".
// - Si a los 7 días de ese email la empresa no cargó otro diagnóstico: un solo recordatorio. Nada más.
// Cada email queda registrado en emails_retorno antes de mandarse (clave única por diagnóstico, usuario y tipo),
// así nunca se manda dos veces el mismo. Lo revisa un proceso diario (iniciar) o, a mano, deploy/retorno.sh.
const crypto = require('crypto');
const cuentas = require('./cuentas');
const { enviarEmail } = require('./correo');

const DIAS_MENSUAL = 30;
const DIAS_RECORDATORIO = 7;

// Los mismos títulos que muestra la plataforma (vgRiesgo en public/index.html)
const RIESGOS = {
  perdida: 'tus ventas no cubren la estructura',
  caja_critica: 'tu caja alcanza para poco tiempo',
  holgura: 'tenés poca holgura sobre el punto de equilibrio',
  caja_justa: 'tu caja está justa',
  margen_bajo: 'tu margen está por debajo del rango habitual de tu rubro',
};
const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'set.', 'oct.', 'nov.', 'dic.'];
function fechaCorta(f) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(f));
  const v = t => +p.find(x => x.type === t).value;
  return `${v('day')} ${MESES[v('month') - 1]} ${v('year')}`;
}
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const base = () => (process.env.BASE_URL || 'https://vgrowapp.com').replace(/\/$/, '');

// La línea con el riesgo y la acción del último diagnóstico. Solo lo que quedó guardado en ese diagnóstico.
function lineaDiagnostico(riesgo, accion) {
  const r = riesgo === 'sin_riesgo' ? 'En ese diagnóstico no aparecía un riesgo principal.'
    : RIESGOS[riesgo] ? `En ese diagnóstico, lo principal era que ${RIESGOS[riesgo]}.` : '';
  const a = accion ? ` La acción que te sugerimos: ${accion.charAt(0).toLowerCase() + accion.slice(1)}.` : '';
  return (r + a).trim();
}

function armarEmail({ tipo, empresa, fecha, riesgo, accion, linkIr, linkBaja }) {
  const nombre = empresa && empresa !== 'Mi empresa' ? empresa : 'tu empresa';
  const linea = lineaDiagnostico(riesgo, accion);
  const asunto = tipo === 'mensual' ? 'Es momento de actualizar tus números' : 'Recordatorio: actualizá tus números';
  const intro = tipo === 'mensual'
    ? `Pasaron 30 días desde el último diagnóstico de ${nombre}, del ${fecha}. Es momento de actualizar tus números.`
    : `Hace una semana te escribimos para actualizar los números de ${nombre}. Tu último diagnóstico es del ${fecha}. Este es el único recordatorio.`;
  const pie = 'Te llega este email porque lo aceptaste al crear tu cuenta en Vgrow.';
  const texto = `Hola:\n\n${intro}\n${linea ? '\n' + linea + '\n' : ''}\nActualizar mis números: ${linkIr}\n\n${pie}\nPara no recibir más estos emails: ${linkBaja}\n\nVgrow`;
  const html = `<div style="font-family:'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,sans-serif;color:#16202E;font-size:15px;line-height:1.55;max-width:520px">`
    + `<p>Hola:</p><p>${esc(intro)}</p>${linea ? `<p>${esc(linea)}</p>` : ''}`
    + `<p><a href="${esc(linkIr)}" style="display:inline-block;background:#0B7C87;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Actualizar mis números</a></p>`
    + `<p style="font-size:13px;color:#5B6778">${esc(pie)} <a href="${esc(linkBaja)}" style="color:#5B6778">No quiero recibir más estos emails</a>.</p></div>`;
  return { asunto, texto, html };
}

// Último diagnóstico de cada empresa (el más nuevo; si empatan en fecha, el de id mayor)
const ES_ULTIMO = `NOT EXISTS (SELECT 1 FROM diagnosticos d2 WHERE d2.empresa_id = d.empresa_id
                     AND (d2.creado > d.creado OR (d2.creado = d.creado AND d2.id > d.id)))`;
const DESTINATARIOS = `JOIN empresas e ON e.id = d.empresa_id AND e.organizacion_id IS NOT NULL
  JOIN miembros mi ON mi.organizacion_id = e.organizacion_id
  JOIN usuarios u ON u.id = mi.usuario_id AND u.emails_mensuales = 1 AND u.verificado = 1
  LEFT JOIN acciones_catalogo ac ON ac.codigo = d.accion_codigo`;
const CAMPOS = 'd.id AS diagnostico_id, d.empresa_id, d.creado, d.riesgo, ac.titulo AS accion, e.nombre AS empresa, u.id AS usuario_id, u.email, u.baja_token';

async function aEnviar() {
  const p = cuentas.pool();
  const [mensuales] = await p.query(
    `SELECT ${CAMPOS}, 'mensual' AS tipo FROM diagnosticos d ${DESTINATARIOS}
      WHERE d.creado <= NOW() - INTERVAL ${DIAS_MENSUAL} DAY AND ${ES_ULTIMO}
        AND NOT EXISTS (SELECT 1 FROM emails_retorno r WHERE r.diagnostico_id = d.id AND r.usuario_id = u.id AND r.tipo = 'mensual')`);
  const [recordatorios] = await p.query(
    `SELECT ${CAMPOS}, 'recordatorio' AS tipo FROM emails_retorno m JOIN diagnosticos d ON d.id = m.diagnostico_id ${DESTINATARIOS}
      WHERE m.tipo = 'mensual' AND u.id = m.usuario_id AND m.enviado <= NOW() - INTERVAL ${DIAS_RECORDATORIO} DAY AND ${ES_ULTIMO}
        AND NOT EXISTS (SELECT 1 FROM emails_retorno r WHERE r.diagnostico_id = d.id AND r.usuario_id = u.id AND r.tipo = 'recordatorio')`);
  return [...mensuales, ...recordatorios];
}

// Revisa a quién le toca y manda. Devuelve cuántos mandó de cada tipo.
async function revisar() {
  const p = cuentas.pool();
  const hecho = { mensual: 0, recordatorio: 0, errores: 0 };
  for (const f of await aEnviar()) {
    const token = crypto.randomBytes(32).toString('base64url');
    // Primero se registra: si ya existía (otra instancia, otra corrida), no se manda
    const [r] = await p.query(
      'INSERT IGNORE INTO emails_retorno (empresa_id, usuario_id, diagnostico_id, tipo, token_hash) VALUES (?,?,?,?,?)',
      [f.empresa_id, f.usuario_id, f.diagnostico_id, f.tipo, cuentas.hash(token)]);
    if (!r.affectedRows) continue;
    let baja = f.baja_token;
    if (!baja) {
      baja = crypto.randomBytes(32).toString('base64url');
      await p.query('UPDATE usuarios SET baja_token=? WHERE id=? AND baja_token IS NULL', [baja, f.usuario_id]);
      const [[u]] = await p.query('SELECT baja_token FROM usuarios WHERE id=?', [f.usuario_id]);
      baja = u.baja_token;
    }
    const email = armarEmail({ tipo: f.tipo, empresa: f.empresa, fecha: fechaCorta(f.creado), riesgo: f.riesgo, accion: f.accion,
      linkIr: `${base()}/email/ir?t=${token}`, linkBaja: `${base()}/baja?t=${baja}` });
    try {
      await enviarEmail({ para: f.email, ...email });
      hecho[f.tipo]++;
    } catch (e) {
      // No salió: se borra el registro para que se intente en la próxima revisión
      await p.query('DELETE FROM emails_retorno WHERE token_hash=?', [cuentas.hash(token)]);
      hecho.errores++;
      console.error('[email retorno]', f.email, e.message);
    }
  }
  return hecho;
}

// Clic en "Actualizar mis números": se registra la primera vez. Devuelve el email o null.
async function registrarClic(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token || ''))) return null;
  const p = cuentas.pool();
  const h = cuentas.hash(token);
  const [[r]] = await p.query('SELECT id, empresa_id, usuario_id, tipo, clic FROM emails_retorno WHERE token_hash=?', [h]);
  if (!r) return null;
  if (!r.clic) await p.query('UPDATE emails_retorno SET clic=NOW() WHERE id=? AND clic IS NULL', [r.id]);
  return r;
}

// Baja de un clic. Devuelve true si el link es válido.
async function darDeBaja(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token || ''))) return false;
  const [r] = await cuentas.pool().query('UPDATE usuarios SET emails_mensuales=0 WHERE baja_token=?', [token]);
  return r.affectedRows > 0;
}

// Proceso diario: cada 15 minutos mira si ya es la hora (RETORNO_HORA, por defecto 10, hora de Montevideo)
// y si hoy todavía no corrió. La marca del día va en la base, así corre una vez aunque la app se reinicie.
function horaMontevideo(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = t => p.find(x => x.type === t).value;
  return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: +v('hour') };
}
async function tareaDelDia() {
  const { fecha, hora } = horaMontevideo();
  const desde = parseInt(process.env.RETORNO_HORA, 10);
  if (hora < (Number.isFinite(desde) ? desde : 10)) return null;
  const [r] = await cuentas.pool().query("INSERT IGNORE INTO tareas_diarias (nombre, fecha) VALUES ('email_retorno', ?)", [fecha]);
  if (!r.affectedRows) return null;
  const hecho = await revisar();
  console.log(`[email retorno] ${fecha}: ${hecho.mensual} mensuales, ${hecho.recordatorio} recordatorios, ${hecho.errores} con error`);
  return hecho;
}
function iniciar() {
  const correr = () => tareaDelDia().catch(e => console.error('[email retorno]', e.message));
  setTimeout(correr, 60 * 1000).unref();
  setInterval(correr, 15 * 60 * 1000).unref();
}

module.exports = { revisar, registrarClic, darDeBaja, iniciar, tareaDelDia, armarEmail, lineaDiagnostico, DIAS_MENSUAL, DIAS_RECORDATORIO };

// A mano desde el servidor (deploy/retorno.sh): revisa y manda ahora lo que corresponda
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const { conectar } = require('../db/db');
  revisar().then(h => console.log(`Listo: ${h.mensual} mensuales, ${h.recordatorio} recordatorios, ${h.errores} con error.`))
    .catch(e => { console.error('No se pudo revisar:', e.message); process.exitCode = 1; })
    .finally(async () => { const p = conectar(); if (p) await p.end(); });
}
