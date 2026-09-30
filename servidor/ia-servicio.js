// IA con login prendido: sin sesión no hay IA; cuota mensual por empresa; respuestas guardadas por huella;
// modelo según el plan; briefing del mercado uno por día para todos.
const crypto = require('crypto');
const cuentas = require('./cuentas');
const { modeloDe, modeloFree, mesActual } = require('./planes');
const { armarBriefingGeneral } = require('../ia');
const comparar = require('./comparar');

const API_URL = () => process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';

async function llamarClaude(prompt, max_tokens, modelo) {
  const r = await fetch(API_URL(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelo, max_tokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`La IA respondió ${r.status}: ${datos?.error?.message || ''}`); e.status = 502; throw e; }
  if (datos.stop_reason === 'refusal') { const e = new Error('La IA declinó el pedido.'); e.status = 502; throw e; }
  return (datos.content || []).filter(x => x.type === 'text').map(x => x.text).join('').trim();
}

// Huella de los números: el mismo pedido con los mismos datos da la misma huella (orden de claves normalizado)
function ordenar(x) {
  if (Array.isArray(x)) return x.map(ordenar);
  if (x && typeof x === 'object') return Object.keys(x).sort().reduce((o, k) => { o[k] = ordenar(x[k]); return o; }, {});
  return x;
}
const huellaDe = (tipo, datos) => crypto.createHash('sha256').update(tipo + JSON.stringify(ordenar(datos || {}))).digest('hex');

async function registrarUso({ empresa_id = null, usuario_id = null, tipo, plan, modelo = null, cuenta = 0, guardado = 0 }) {
  const [r] = await cuentas.pool().query('INSERT INTO ia_uso (empresa_id, usuario_id, tipo, plan, modelo, mes, cuenta, guardado) VALUES (?,?,?,?,?,?,?,?)',
    [empresa_id, usuario_id, tipo, plan, modelo, mesActual(), cuenta ? 1 : 0, guardado ? 1 : 0]);
  return r.insertId;
}
async function cuotaDe(empresaId, permisos) {
  const [[c]] = await cuentas.pool().query('SELECT COUNT(*) AS n FROM ia_uso WHERE empresa_id=? AND mes=? AND cuenta=1', [empresaId, mesActual()]);
  return { usados: c.n, limite: permisos.ia_mensual, mes: mesActual() };
}

// Briefing del día (igual para todos, modelo free, no cuenta en la cuota)
let generandoBriefing = null;
async function briefingDelDia() {
  const p = cuentas.pool();
  const [[b]] = await p.query('SELECT texto FROM ia_briefing WHERE fecha = CURDATE()');
  if (b) return { texto: b.texto, guardado: true };
  if (!generandoBriefing) {
    generandoBriefing = (async () => {
      const ag = await comparar.agregados();
      const { prompt, max_tokens } = armarBriefingGeneral(ag.indices);
      const modelo = modeloFree();
      const texto = await llamarClaude(prompt, max_tokens, modelo);
      await p.query('INSERT INTO ia_briefing (fecha, texto, modelo) VALUES (CURDATE(), ?, ?) ON DUPLICATE KEY UPDATE fecha=fecha', [texto, modelo]);
      await registrarUso({ tipo: 'briefing_mercado', plan: 'todos', modelo, cuenta: 0 });
      return texto;
    })().finally(() => { generandoBriefing = null; });
  }
  return { texto: await generandoBriefing, guardado: false };
}

// Pedido con sesión. Devuelve { status, cuerpo }.
async function pedidoConSesion(sesion, tipo, datos, pedido) {
  if (!sesion.empresa) return { status: 409, cuerpo: { error: 'Tu cuenta todavía no tiene una empresa.' } };
  const empresaId = sesion.empresa.id;
  const { plan, permisos } = sesion;
  if (tipo === 'briefing_mercado') return { status: 200, cuerpo: await briefingDelDia() };
  if (tipo === 'lectura_plan' && !permisos.planificacion) return { status: 403, cuerpo: { error: 'La lectura del plan es parte del plan Basic.', plan } };

  const p = cuentas.pool();
  const huella = huellaDe(tipo, datos);
  const [[guardada]] = await p.query('SELECT texto FROM ia_respuestas WHERE empresa_id=? AND tipo=? AND huella=?', [empresaId, tipo, huella]);
  if (guardada) {
    await registrarUso({ empresa_id: empresaId, usuario_id: sesion.usuario_id, tipo, plan, guardado: 1 });
    return { status: 200, cuerpo: { texto: guardada.texto, guardado: true, cuota: await cuotaDe(empresaId, permisos) } };
  }

  // Qué cuenta: análisis del diagnóstico y lectura del plan. La alerta temprana va con su análisis (juntos valen uno).
  let cuenta = 1;
  let reserva = null;
  if (tipo === 'alerta_temprana') {
    const [r] = await p.query("UPDATE ia_uso SET alerta_usada=1 WHERE empresa_id=? AND mes=? AND tipo='analisis_diagnostico' AND cuenta=1 AND alerta_usada=0 ORDER BY id DESC LIMIT 1", [empresaId, mesActual()]);
    if (r.affectedRows) cuenta = 0;
  }
  if (cuenta) {
    reserva = await registrarUso({ empresa_id: empresaId, usuario_id: sesion.usuario_id, tipo, plan, cuenta: 1 });
    if (permisos.ia_mensual != null) {
      const [[c]] = await p.query('SELECT COUNT(*) AS n FROM ia_uso WHERE empresa_id=? AND mes=? AND cuenta=1 AND id <= ?', [empresaId, mesActual(), reserva]);
      if (c.n > permisos.ia_mensual) {
        await p.query('DELETE FROM ia_uso WHERE id=?', [reserva]);
        const cuota = await cuotaDe(empresaId, permisos);
        return { status: 429, cuerpo: { error: `Usaste los ${permisos.ia_mensual} análisis con IA de este mes. Se renuevan el 1 del mes que viene.`, sinCuota: true, cuota } };
      }
    }
  }
  const modelo = modeloDe(plan);
  let texto;
  try {
    texto = await llamarClaude(pedido.prompt, pedido.max_tokens, modelo);
  } catch (e) {
    if (reserva) await p.query('DELETE FROM ia_uso WHERE id=?', [reserva]); // si la IA falla, no se cobra
    throw e;
  }
  if (reserva) await p.query('UPDATE ia_uso SET modelo=? WHERE id=?', [modelo, reserva]);
  else await registrarUso({ empresa_id: empresaId, usuario_id: sesion.usuario_id, tipo, plan, modelo, cuenta: 0 });
  await p.query('INSERT INTO ia_respuestas (empresa_id, tipo, huella, texto, modelo) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE texto=VALUES(texto), modelo=VALUES(modelo)', [empresaId, tipo, huella, texto, modelo]);
  return { status: 200, cuerpo: { texto, guardado: false, cuota: await cuotaDe(empresaId, permisos) } };
}

module.exports = { llamarClaude, huellaDe, registrarUso, cuotaDe, briefingDelDia, pedidoConSesion };
