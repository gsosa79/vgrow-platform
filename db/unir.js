// Une dos empresas que son la misma. Lo usa deploy/unir.sh.
// Uso: node db/unir.js <id_que_queda> <id_que_se_borra>
// Pasa a la que queda los usuarios y los diagnósticos de la otra (con sus períodos, acciones, emails mensuales, uso de la IA
// y eventos), y después borra la otra. Pide escribir UNIR. Todo va en una sola transacción y queda en registro_borrados.
// Un diagnóstico que está en las dos (mismo diagnóstico guardado dos veces) queda una sola vez.
// El plan de la que queda no cambia.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { conectar } = require('./db');
const cuentas = require('../servidor/cuentas');
const { preguntar, cerrar } = require('./consola');
const { registrar, enTransaccion } = require('./borrar');

const PLANES = { freemium: 'Free', basic: 'Basic', pro: 'Pro' };
const NIVEL = { freemium: 0, basic: 1, pro: 2 };
const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'set.', 'oct.', 'nov.', 'dic.'];
const fecha = f => { if (!f) return '—'; const d = new Date(f); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`; };
const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

async function leer(p, id) {
  const [[e]] = await p.query('SELECT id, nombre, email, organizacion_id, creado FROM empresas WHERE id=?', [id]);
  if (!e) return null;
  const [[d]] = await p.query('SELECT COUNT(*) AS n, MIN(creado) AS desde, MAX(creado) AS hasta FROM diagnosticos WHERE empresa_id=?', [id]);
  const [usuarios] = e.organizacion_id ? await p.query(
    'SELECT u.id, u.email, m.rol FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.organizacion_id=? ORDER BY u.id', [e.organizacion_id]) : [[]];
  const [[otras]] = e.organizacion_id ? await p.query('SELECT COUNT(*) AS n FROM empresas WHERE organizacion_id=? AND id<>?', [e.organizacion_id, id]) : [[{ n: 0 }]];
  return { ...e, diagnosticos: Number(d.n), desde: d.desde, hasta: d.hasta, usuarios, otrasEnSuOrg: Number(otras.n), plan: await cuentas.planDeEmpresa(id) };
}
function mostrar(t, e) {
  return [`${t}: empresa ${e.id}, ${e.nombre} (email ${e.email}, plan ${PLANES[e.plan] || e.plan})`,
    `  Diagnósticos: ${e.diagnosticos}${e.diagnosticos ? ` (del ${fecha(e.desde)} al ${fecha(e.hasta)})` : ''}`,
    `  Usuarios: ${e.usuarios.length ? e.usuarios.map(u => `${u.email} (${u.rol === 'contador' ? 'contador' : 'dueño'})`).join(', ') : 'ninguno (sin cuenta)'}`].join('\n');
}

async function ejecutar(q, b) {
  return enTransaccion(async conn => {
    const cont = { usuarios: 0, diagnosticos: 0, repetidos: 0, periodos: 0, acciones: 0, emails: 0, eventos: 0 };
    // 1. Usuarios: los de la organización de la que se borra pasan a la de la que queda
    let orgQ = q.organizacion_id;
    if (b.organizacion_id && !orgQ) {
      // La que queda no tenía cuenta: toma la organización de la otra
      await conn.query('UPDATE empresas SET organizacion_id=? WHERE id=?', [b.organizacion_id, q.id]);
      orgQ = b.organizacion_id;
      cont.usuarios = b.usuarios.length;
    } else if (b.organizacion_id && b.organizacion_id !== orgQ) {
      for (const u of b.usuarios) {
        const [r] = await conn.query('INSERT IGNORE INTO miembros (usuario_id, organizacion_id, rol) VALUES (?,?,?)', [u.id, orgQ, u.rol]);
        cont.usuarios += r.affectedRows;
      }
    }
    await conn.query('UPDATE sesiones SET empresa_id=? WHERE empresa_id=?', [q.id, b.id]);
    await conn.query('UPDATE usuarios SET empresa_id=? WHERE empresa_id=?', [q.id, b.id]);

    // 2. Diagnósticos repetidos (mismo diagnóstico guardado en las dos): queda el de la empresa que queda
    const [rep] = await conn.query(
      'SELECT db.id FROM diagnosticos db JOIN diagnosticos dq ON dq.empresa_id=? AND dq.diag_ref = db.diag_ref WHERE db.empresa_id=? AND db.diag_ref IS NOT NULL', [q.id, b.id]);
    const repIds = rep.map(r => r.id);
    if (repIds.length) {
      await conn.query('DELETE FROM emails_retorno WHERE diagnostico_id IN (?)', [repIds]);
      await conn.query('UPDATE acciones_empresa SET diagnostico_id=NULL WHERE diagnostico_id IN (?)', [repIds]);
      cont.repetidos = (await conn.query('DELETE FROM diagnosticos WHERE id IN (?)', [repIds]))[0].affectedRows;
    }

    // 3. Períodos: cada mes de la que se borra pasa al mismo mes de la que queda (si no existe, se crea)
    const [pers] = await conn.query('SELECT id, anio, mes FROM periodos WHERE empresa_id=?', [b.id]);
    for (const p of pers) {
      await conn.query('INSERT IGNORE INTO periodos (empresa_id, anio, mes) VALUES (?,?,?)', [q.id, p.anio, p.mes]);
      const [[pq]] = await conn.query('SELECT id FROM periodos WHERE empresa_id=? AND anio=? AND mes=?', [q.id, p.anio, p.mes]);
      await conn.query('UPDATE diagnosticos SET periodo_id=? WHERE periodo_id=?', [pq.id, p.id]);
      // Acciones: si la misma acción ya está en ese mes en la que queda, la repetida se descarta
      await conn.query(
        `DELETE ab FROM acciones_empresa ab JOIN acciones_empresa aq ON aq.empresa_id=? AND aq.periodo_id=? AND aq.accion_codigo = ab.accion_codigo
          WHERE ab.empresa_id=? AND ab.periodo_id=?`, [q.id, pq.id, b.id, p.id]);
      const [ra] = await conn.query('UPDATE acciones_empresa SET periodo_id=?, empresa_id=? WHERE periodo_id=? AND empresa_id=?', [pq.id, q.id, p.id, b.id]);
      cont.acciones += ra.affectedRows;
      await conn.query('UPDATE acciones_empresa SET periodo_siguiente_id=? WHERE periodo_siguiente_id=?', [pq.id, p.id]);
      cont.periodos++;
    }
    await conn.query('DELETE FROM periodos WHERE empresa_id=?', [b.id]);

    // 4. Diagnósticos, emails mensuales, uso de la IA y eventos pasan a la que queda
    cont.diagnosticos = (await conn.query('UPDATE diagnosticos SET empresa_id=? WHERE empresa_id=?', [q.id, b.id]))[0].affectedRows;
    cont.emails = (await conn.query('UPDATE emails_retorno SET empresa_id=? WHERE empresa_id=?', [q.id, b.id]))[0].affectedRows;
    await conn.query('UPDATE ia_uso SET empresa_id=? WHERE empresa_id=?', [q.id, b.id]);
    await conn.query('DELETE FROM ia_respuestas WHERE empresa_id=?', [b.id]); // explicaciones guardadas: se vuelven a generar
    cont.eventos = (await conn.query(
      "UPDATE eventos SET datos = JSON_SET(datos, '$.empresa_id', ?) WHERE JSON_CONTAINS(?, JSON_EXTRACT(datos, '$.empresa_id'))", [q.id, JSON.stringify([b.id])]))[0].affectedRows;

    // 5. La que queda toma el score del diagnóstico más reciente; la otra se borra con sus suscripciones
    const [[ult]] = await conn.query('SELECT score, semaforo FROM diagnosticos WHERE empresa_id=? ORDER BY creado DESC, id DESC LIMIT 1', [q.id]);
    if (ult) await conn.query('UPDATE empresas SET ultimo_score=?, ultimo_semaforo=? WHERE id=?', [ult.score, ult.semaforo, q.id]);
    await conn.query('DELETE FROM suscripciones WHERE empresa_id=?', [b.id]);
    await conn.query('DELETE FROM empresas WHERE id=?', [b.id]);

    // 6. Si la organización de la que se borra quedó sin empresas, sus usuarios ya están en la otra: se borra
    if (b.organizacion_id && b.organizacion_id !== orgQ) {
      const [[x]] = await conn.query('SELECT COUNT(*) AS n FROM empresas WHERE organizacion_id=?', [b.organizacion_id]);
      if (!Number(x.n)) {
        await conn.query('DELETE FROM miembros WHERE organizacion_id=?', [b.organizacion_id]);
        await conn.query('DELETE FROM organizaciones WHERE id=?', [b.organizacion_id]);
      }
    }
    const texto = `La empresa ${b.id} se unió a la ${q.id}: ${pl(cont.diagnosticos, 'diagnóstico pasado', 'diagnósticos pasados')}`
      + `${cont.repetidos ? ` y ${pl(cont.repetidos, 'repetido descartado', 'repetidos descartados')}` : ''}`
      + `${cont.usuarios ? `, ${pl(cont.usuarios, 'usuario sumado', 'usuarios sumados')}` : ''}`;
    await registrar(conn, 'unir', null, [q.id, b.id], { queda: q.id, se_borra: b.id, ...cont, texto });
    return { cont, texto };
  });
}

async function unir(idQueda, idBorra) {
  const qId = parseInt(idQueda, 10), bId = parseInt(idBorra, 10);
  if (!qId || !bId) throw new Error('Uso: bash deploy/unir.sh <id_que_queda> <id_que_se_borra>');
  if (qId === bId) throw new Error('Los dos ids son iguales: no hay nada que unir.');
  const p = cuentas.pool();
  const q = await leer(p, qId), b = await leer(p, bId);
  if (!q) throw new Error(`No hay ninguna empresa con el id ${qId}.`);
  if (!b) throw new Error(`No hay ninguna empresa con el id ${bId}.`);
  console.log(mostrar('Queda', q));
  console.log(mostrar('Se borra', b));
  const nuevos = b.usuarios.filter(u => !q.usuarios.some(x => x.id === u.id));
  const [[rep]] = await p.query(
    'SELECT COUNT(*) AS n FROM diagnosticos db JOIN diagnosticos dq ON dq.empresa_id=? AND dq.diag_ref = db.diag_ref WHERE db.empresa_id=?', [q.id, b.id]);
  const repetidos = Number(rep.n);
  console.log(`\nDespués: la empresa ${q.id} va a tener ${pl(q.diagnosticos + b.diagnosticos - repetidos, 'diagnóstico', 'diagnósticos')}`
    + `${repetidos ? ` (${repetidos === 1 ? '1 estaba en las dos y queda una vez' : `${repetidos} estaban en las dos y quedan una vez`})` : ''}`
    + `${nuevos.length ? ` y suma ${nuevos.length === 1 ? 'al usuario' : 'a los usuarios'} ${nuevos.map(u => u.email).join(', ')}` : ''}. Mantiene su nombre, su email y su plan.`);
  if (b.organizacion_id && q.organizacion_id && b.organizacion_id !== q.organizacion_id && b.otrasEnSuOrg)
    console.log(`Los usuarios de la ${b.id} siguen teniendo acceso a ${pl(b.otrasEnSuOrg, 'otra empresa', 'otras empresas')} de su cuenta.`);
  if (NIVEL[b.plan] > NIVEL[q.plan])
    console.log(`Ojo: la que se borra tiene plan ${PLANES[b.plan]} y la que queda ${PLANES[q.plan]}. Si corresponde, después corré: bash deploy/plan.sh <email> ${b.plan} ${q.id}`);
  const r = await preguntar('\nPara unirlas, escribí UNIR (cualquier otra cosa cancela): ');
  if (r === null || r.trim() !== 'UNIR') { console.log('Cancelado. No se cambió nada.'); return; }
  const { texto } = await ejecutar(q, b);
  console.log(`\nListo. ${texto}. La empresa ${b.id} ya no existe.`);
  console.log('Quedó registrado en registro_borrados.');
}

module.exports = { unir };

if (require.main === module) {
  unir(process.argv[2], process.argv[3])
    .catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => { cerrar(); const p = conectar(); if (p) await p.end(); });
}
