// Borra los datos de un email o de una empresa, ante un pedido de privacidad. Lo usa deploy/borrar.sh.
// Uso: node db/borrar.js <email>
//      node db/borrar.js --empresa <id>
//      node db/borrar.js --registro [email]      (muestra qué se borró y cuándo)
// Primero muestra todo lo que hay y pide escribir BORRAR. Todo se borra en una sola transacción:
// si algo falla, no se borra nada. Queda un registro en registro_borrados, sin los datos borrados.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { conectar } = require('./db');
const cuentas = require('../servidor/cuentas');
const { preguntar, cerrar, quien } = require('./consola');

const PLANES = { freemium: 'Free', basic: 'Basic', pro: 'Pro' };
const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'set.', 'oct.', 'nov.', 'dic.'];
const fecha = f => { if (!f) return '—'; const d = new Date(f); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`; };
const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const dec = v => v == null ? '—' : String(v).replace('.', ',');
const lista = ids => JSON.stringify(ids.map(Number));
// Eventos ligados a una empresa o a un usuario por el id que guardan en sus datos
const EV_EMPRESA = "JSON_CONTAINS(?, JSON_EXTRACT(datos, '$.empresa_id'))";
const EV_USUARIO = "JSON_CONTAINS(?, JSON_EXTRACT(datos, '$.usuario_id'))";

// ── Qué hay ──────────────────────────────────────────────────────────────────
async function datosEmpresa(p, id, sinUsuario) {
  const [[e]] = await p.query('SELECT id, nombre, email, sector, pais, organizacion_id, creado FROM empresas WHERE id=?', [id]);
  if (!e) return null;
  const [diags] = await p.query('SELECT creado, score, semaforo FROM diagnosticos WHERE empresa_id=? ORDER BY creado', [id]);
  const [usuarios] = e.organizacion_id ? await p.query(
    'SELECT u.id, u.email, m.rol FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.organizacion_id=? ORDER BY u.id', [e.organizacion_id]) : [[]];
  const c = async (sql, args) => Number((await p.query(sql, args))[0][0].n);
  return {
    ...e, plan: await cuentas.planDeEmpresa(id), diagnosticos: diags, usuarios,
    otros: usuarios.filter(u => u.id !== sinUsuario),
    conteos: {
      periodos: await c('SELECT COUNT(*) AS n FROM periodos WHERE empresa_id=?', [id]),
      acciones: await c('SELECT COUNT(*) AS n FROM acciones_empresa WHERE empresa_id=?', [id]),
      suscripciones: await c('SELECT COUNT(*) AS n FROM suscripciones WHERE empresa_id=?', [id]),
      ia_uso: await c('SELECT COUNT(*) AS n FROM ia_uso WHERE empresa_id=?', [id]),
      ia_respuestas: await c('SELECT COUNT(*) AS n FROM ia_respuestas WHERE empresa_id=?', [id]),
      emails_enviados: await c('SELECT COUNT(*) AS n FROM emails_retorno WHERE empresa_id=?', [id]),
      eventos: await c(`SELECT COUNT(*) AS n FROM eventos WHERE ${EV_EMPRESA}`, [lista([id])]),
    },
  };
}

async function relevarEmail(email) {
  const p = cuentas.pool();
  const [[u]] = await p.query('SELECT id, email, creado, ultimo_acceso, emails_mensuales FROM usuarios WHERE email=?', [email]);
  // Sus empresas: las de sus organizaciones y las que se registraron con su email (también las de antes del login)
  const [filas] = await p.query(
    `SELECT DISTINCT e.id FROM empresas e
      WHERE e.email=? ${u ? 'OR e.organizacion_id IN (SELECT organizacion_id FROM miembros WHERE usuario_id=?)' : ''}
      ORDER BY e.id`, u ? [email, u.id] : [email]);
  const empresas = [];
  for (const f of filas) empresas.push(await datosEmpresa(p, f.id, u && u.id));
  const [eventos] = await p.query(
    `SELECT tipo, COUNT(*) AS n, MIN(creado) AS desde, MAX(creado) AS hasta FROM eventos
      WHERE email=? ${u ? `OR ${EV_USUARIO}` : ''} GROUP BY tipo ORDER BY n DESC`, u ? [email, lista([u.id])] : [email]);
  const [enviados] = u ? await p.query('SELECT tipo, enviado, clic FROM emails_retorno WHERE usuario_id=? ORDER BY enviado', [u.id]) : [[]];
  const [[ses]] = u ? await p.query('SELECT COUNT(*) AS n FROM sesiones WHERE usuario_id=?', [u.id]) : [[{ n: 0 }]];
  const [[links]] = await p.query('SELECT COUNT(*) AS n FROM login_tokens WHERE email=?', [email]);
  return { email, usuario: u || null, empresas, eventos: eventos.map(e => ({ ...e, n: Number(e.n) })), enviados, sesiones: Number(ses.n), links: Number(links.n) };
}

function mostrarEmpresa(e, sangria = '  ') {
  const out = [];
  out.push(`${sangria}Empresa ${e.id}: ${e.nombre}  (email ${e.email}, plan ${PLANES[e.plan] || e.plan}, registrada el ${fecha(e.creado)})`);
  if (e.sector || e.pais) out.push(`${sangria}  Rubro y país: ${e.sector || '—'}${e.pais ? ', ' + e.pais : ''}`);
  out.push(`${sangria}  Diagnósticos: ${e.diagnosticos.length}` + (e.diagnosticos.length
    ? ` (${e.diagnosticos.map(d => `${fecha(d.creado)}, score ${dec(d.score)}`).join('; ')})` : ''));
  const c = e.conteos;
  out.push(`${sangria}  Además: ${pl(c.periodos, 'período', 'períodos')}, ${pl(c.acciones, 'acción', 'acciones')}, ${pl(c.suscripciones, 'suscripción', 'suscripciones')}, `
    + `${pl(c.ia_uso, 'pedido a la IA', 'pedidos a la IA')}, ${pl(c.ia_respuestas, 'respuesta de la IA guardada', 'respuestas de la IA guardadas')}, `
    + `${pl(c.emails_enviados, 'email mensual', 'emails mensuales')}, ${pl(c.eventos, 'evento', 'eventos')}`);
  out.push(`${sangria}  Usuarios con acceso: ${e.usuarios.length ? e.usuarios.map(u => `${u.email} (${u.rol === 'contador' ? 'contador' : 'dueño'})`).join(', ') : 'ninguno (sin cuenta)'}`);
  return out.join('\n');
}

function mostrarEmail(r) {
  const out = [`Datos de ${r.email}`, ''];
  if (r.usuario) {
    const u = r.usuario;
    out.push(`Usuario ${u.id}: creado el ${fecha(u.creado)}, último ingreso ${fecha(u.ultimo_acceso)}, email mensual ${u.emails_mensuales ? 'sí' : 'no'}`);
  } else out.push('Usuario: no tiene cuenta.');
  out.push('', `Empresas (${r.empresas.length}):`);
  out.push(r.empresas.length ? r.empresas.map(e => mostrarEmpresa(e)).join('\n') : '  ninguna');
  out.push('', `Eventos de este email o de su usuario (${r.eventos.reduce((s, e) => s + e.n, 0)}):`);
  out.push(r.eventos.length ? r.eventos.map(e => `  ${e.tipo}: ${e.n} (${fecha(e.desde)}${e.n > 1 ? ' a ' + fecha(e.hasta) : ''})`).join('\n') : '  ninguno');
  out.push('', `Emails mensuales enviados a este usuario (${r.enviados.length}):`);
  out.push(r.enviados.length ? r.enviados.map(e => `  ${e.tipo}, ${fecha(e.enviado)}${e.clic ? ', con clic' : ''}`).join('\n') : '  ninguno');
  out.push('', `Sesiones abiertas: ${r.sesiones}. Links de ingreso pedidos: ${r.links}.`);
  return out.join('\n');
}

// ── Borrado ──────────────────────────────────────────────────────────────────
// Borra empresas completas (con todo lo que cuelga de ellas). Devuelve los conteos.
async function borrarEmpresas(conn, ids, cont) {
  if (!ids.length) return;
  const sum = (k, r) => { cont[k] = (cont[k] || 0) + r.affectedRows; };
  sum('eventos', (await conn.query(`DELETE FROM eventos WHERE ${EV_EMPRESA}`, [lista(ids)]))[0]);
  sum('emails_enviados', (await conn.query('DELETE FROM emails_retorno WHERE empresa_id IN (?)', [ids]))[0]);
  sum('acciones', (await conn.query('DELETE FROM acciones_empresa WHERE empresa_id IN (?)', [ids]))[0]);
  sum('ia_uso', (await conn.query('DELETE FROM ia_uso WHERE empresa_id IN (?)', [ids]))[0]);
  sum('ia_respuestas', (await conn.query('DELETE FROM ia_respuestas WHERE empresa_id IN (?)', [ids]))[0]);
  // Las sesiones de otros usuarios que tenían elegida esta empresa siguen abiertas, sin empresa elegida
  await conn.query('UPDATE sesiones SET empresa_id=NULL WHERE empresa_id IN (?)', [ids]);
  await conn.query('UPDATE usuarios SET empresa_id=NULL WHERE empresa_id IN (?)', [ids]);
  sum('diagnosticos', (await conn.query('DELETE FROM diagnosticos WHERE empresa_id IN (?)', [ids]))[0]);
  sum('periodos', (await conn.query('DELETE FROM periodos WHERE empresa_id IN (?)', [ids]))[0]);
  sum('suscripciones', (await conn.query('DELETE FROM suscripciones WHERE empresa_id IN (?)', [ids]))[0]);
  sum('empresas', (await conn.query('DELETE FROM empresas WHERE id IN (?)', [ids]))[0]);
}
// Organizaciones que quedaron sin empresas y sin usuarios
async function borrarOrganizacionesVacias(conn, orgs, cont) {
  for (const o of new Set(orgs.filter(Boolean))) {
    const [r] = await conn.query(
      `DELETE FROM organizaciones WHERE id=? AND NOT EXISTS (SELECT 1 FROM empresas WHERE organizacion_id=?)
         AND NOT EXISTS (SELECT 1 FROM miembros WHERE organizacion_id=?)`, [o, o, o]);
    cont.organizaciones = (cont.organizaciones || 0) + r.affectedRows;
  }
}
async function registrar(conn, accion, email, empresas, detalle) {
  await conn.query('INSERT INTO registro_borrados (accion, email_hash, empresas, detalle, hecho_por) VALUES (?,?,?,?,?)',
    [accion, email ? cuentas.hash(email) : null, empresas.length ? empresas.join(',').slice(0, 200) : null, JSON.stringify(detalle), quien()]);
}
async function enTransaccion(fn) {
  const conn = await cuentas.pool().getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// borrarEmpresas: ids a borrar completos. conservar: [{ id, email }] empresas que quedan (si su email era el borrado, pasa a `email`).
async function ejecutarEmail(r, borrar, conservar) {
  return enTransaccion(async conn => {
    const cont = {};
    // Organizaciones a revisar al final: las de sus empresas y aquellas de las que es miembro
    const [mias] = r.usuario ? await conn.query('SELECT organizacion_id FROM miembros WHERE usuario_id=?', [r.usuario.id]) : [[]];
    const orgs = [...r.empresas.map(e => e.organizacion_id), ...mias.map(m => m.organizacion_id)];
    await borrarEmpresas(conn, borrar, cont);
    for (const c of conservar) if (c.email) await conn.query('UPDATE empresas SET email=? WHERE id=? AND email=?', [c.email, c.id, r.email]);
    const u = r.usuario;
    const [ev] = await conn.query(`DELETE FROM eventos WHERE email=? ${u ? `OR ${EV_USUARIO}` : ''}`, u ? [r.email, lista([u.id])] : [r.email]);
    cont.eventos = (cont.eventos || 0) + ev.affectedRows;
    cont.links = (await conn.query('DELETE FROM login_tokens WHERE email=?', [r.email]))[0].affectedRows;
    if (u) {
      cont.emails_enviados = (cont.emails_enviados || 0) + (await conn.query('DELETE FROM emails_retorno WHERE usuario_id=?', [u.id]))[0].affectedRows;
      // Lo que queda de las empresas que siguen deja de apuntar a este usuario
      await conn.query('UPDATE diagnosticos SET usuario_id=NULL WHERE usuario_id=?', [u.id]);
      await conn.query('UPDATE ia_uso SET usuario_id=NULL WHERE usuario_id=?', [u.id]);
      cont.sesiones = (await conn.query('DELETE FROM sesiones WHERE usuario_id=?', [u.id]))[0].affectedRows;
      cont.accesos = (await conn.query('DELETE FROM miembros WHERE usuario_id=?', [u.id]))[0].affectedRows;
      cont.usuarios = (await conn.query('DELETE FROM usuarios WHERE id=?', [u.id]))[0].affectedRows;
    }
    await borrarOrganizacionesVacias(conn, orgs, cont);
    await registrar(conn, 'borrar_email', r.email, borrar, { borrado: cont, empresas_que_quedan: conservar.map(c => c.id) });
    return cont;
  });
}

async function ejecutarEmpresa(e) {
  return enTransaccion(async conn => {
    const cont = {};
    await borrarEmpresas(conn, [e.id], cont);
    await borrarOrganizacionesVacias(conn, [e.organizacion_id], cont);
    await registrar(conn, 'borrar_empresa', null, [e.id], { borrado: cont });
    return cont;
  });
}

const NOMBRES = { usuarios: ['usuario', 'usuarios'], accesos: ['acceso a empresas', 'accesos a empresas'], empresas: ['empresa', 'empresas'],
  diagnosticos: ['diagnóstico', 'diagnósticos'], periodos: ['período', 'períodos'], acciones: ['acción', 'acciones'], suscripciones: ['suscripción', 'suscripciones'],
  ia_uso: ['pedido a la IA', 'pedidos a la IA'], ia_respuestas: ['respuesta de la IA', 'respuestas de la IA'], emails_enviados: ['email mensual', 'emails mensuales'],
  eventos: ['evento', 'eventos'], sesiones: ['sesión', 'sesiones'], links: ['link de ingreso', 'links de ingreso'], organizaciones: ['organización', 'organizaciones'] };
const resumen = cont => Object.keys(NOMBRES).filter(k => cont[k]).map(k => pl(cont[k], ...NOMBRES[k])).join(', ') || 'nada';

// ── Flujo con preguntas ──────────────────────────────────────────────────────
async function confirmar() {
  const r = await preguntar('\nPara borrar, escribí BORRAR (cualquier otra cosa cancela): ');
  return r !== null && r.trim() === 'BORRAR';
}

async function porEmail(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Falta el email. Uso: bash deploy/borrar.sh <email>   o   bash deploy/borrar.sh --empresa <id>');
  const r = await relevarEmail(email);
  if (!r.usuario && !r.empresas.length && !r.eventos.length && !r.links) {
    console.log(`No hay ningún dato de ${email}. No hay nada que borrar.`);
    return;
  }
  console.log(mostrarEmail(r));
  const borrar = [], conservar = [];
  for (const e of r.empresas) {
    if (!e.otros.length) { borrar.push(e.id); continue; }
    console.log(`\nOjo: la empresa ${e.id} (${e.nombre}) también la usan ${e.otros.map(u => u.email).join(', ')}.`);
    console.log('  1. Borrar solo al usuario: la empresa y sus diagnósticos quedan para los demás.');
    console.log('  2. Borrar también la empresa, con todos sus diagnósticos, para todos.');
    const op = await preguntar('Elegí 1 o 2: ');
    if (op === null || !['1', '2'].includes(op.trim())) { console.log('Cancelado. No se borró nada.'); return; }
    if (op.trim() === '2') borrar.push(e.id);
    else conservar.push({ id: e.id, email: e.email === email ? e.otros.find(u => u.rol === 'dueno')?.email || e.otros[0].email : null });
  }
  console.log('\nSe va a borrar:');
  if (r.usuario) console.log(`  - El usuario ${email}, sus sesiones y su acceso a las empresas.`);
  if (borrar.length) console.log(`  - ${borrar.length === 1 ? 'La empresa' : 'Las empresas'} ${borrar.join(', ')}, con sus diagnósticos, períodos, acciones, suscripciones, uso de la IA, emails y eventos.`);
  for (const c of conservar) console.log(`  - La empresa ${c.id} queda para sus otros usuarios${c.email ? `; su email de contacto pasa a ser ${c.email}` : ''}.`);
  console.log(`  - Los eventos, los emails mensuales y los links de ingreso de ${email}.`);
  if (!(await confirmar())) { console.log('Cancelado. No se borró nada.'); return; }
  const cont = await ejecutarEmail(r, borrar, conservar);
  console.log(`\nListo. Se borró: ${resumen(cont)}.`);
  console.log('Quedó registrado en registro_borrados (sin el email ni los datos: solo la huella del email, qué se borró y cuándo).');
}

async function porEmpresa(id) {
  const eid = parseInt(id, 10);
  if (!eid) throw new Error('Falta el id de la empresa. Uso: bash deploy/borrar.sh --empresa <id>');
  const p = cuentas.pool();
  const e = await datosEmpresa(p, eid, null);
  if (!e) throw new Error(`No hay ninguna empresa con el id ${eid}.`);
  console.log('Datos de la empresa\n');
  console.log(mostrarEmpresa(e, ''));
  // Quién se queda sin ninguna empresa
  const sinEmpresa = [];
  for (const u of e.usuarios) {
    const otras = (await cuentas.empresasDelUsuario(u.id)).filter(x => x.id !== eid);
    if (!otras.length) sinEmpresa.push(u.email);
  }
  console.log('\nSe va a borrar la empresa con sus diagnósticos, períodos, acciones, suscripciones, uso de la IA, emails mensuales y eventos.');
  if (e.usuarios.length) console.log(`Los usuarios no se borran: ${e.usuarios.map(u => u.email).join(', ')}.`);
  if (sinEmpresa.length) console.log(`Ojo: ${sinEmpresa.join(', ')} ${sinEmpresa.length === 1 ? 'se queda' : 'se quedan'} sin ninguna empresa. Para borrar también la cuenta: bash deploy/borrar.sh <email>`);
  if (!(await confirmar())) { console.log('Cancelado. No se borró nada.'); return; }
  const cont = await ejecutarEmpresa(e);
  console.log(`\nListo. Se borró: ${resumen(cont)}.`);
  console.log('Quedó registrado en registro_borrados (qué se borró y cuándo, sin los datos).');
}

async function verRegistro(email) {
  const p = cuentas.pool();
  const e = email ? String(email).trim().toLowerCase() : null;
  const [filas] = await p.query(
    `SELECT id, accion, empresas, detalle, hecho_por, creado FROM registro_borrados ${e ? 'WHERE email_hash=?' : ''} ORDER BY creado DESC, id DESC LIMIT 50`,
    e ? [cuentas.hash(e)] : []);
  if (!filas.length) { console.log(e ? `No hay ningún borrado registrado de ${e}.` : 'Todavía no hay borrados registrados.'); return; }
  const ACC = { borrar_email: 'Borrado de un email', borrar_empresa: 'Borrado de una empresa', unir: 'Unión de empresas' };
  for (const f of filas) {
    const d = typeof f.detalle === 'string' ? JSON.parse(f.detalle) : (f.detalle || {});
    const cuando = new Date(f.creado);
    console.log(`${f.id}. ${ACC[f.accion] || f.accion}, ${fecha(cuando)} ${String(cuando.getHours()).padStart(2, '0')}:${String(cuando.getMinutes()).padStart(2, '0')}`
      + `${f.hecho_por ? ` (por ${f.hecho_por})` : ''}${f.empresas ? `. Empresas: ${f.empresas}` : ''}. ${f.accion === 'unir' ? d.texto : 'Se borró: ' + resumen(d.borrado || {})}.`);
  }
}

module.exports = { relevarEmail, ejecutarEmail, ejecutarEmpresa, borrarEmpresas, registrar, enTransaccion, resumen };

if (require.main === module) {
  const args = process.argv.slice(2);
  const tarea = args[0] === '--empresa' ? porEmpresa(args[1]) : args[0] === '--registro' ? verRegistro(args[1]) : porEmail(args[0]);
  tarea.catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => { cerrar(); const p = conectar(); if (p) await p.end(); });
}
