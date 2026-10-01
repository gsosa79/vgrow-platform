// Cambio de plan a mano, mientras no haya pagos integrados. Lo usa deploy/plan.sh.
// Uso: node db/plan.js <email> <freemium|basic|pro> [id de la empresa]
// Cierra la suscripción activa de la empresa y abre una nueva desde hoy, sin fecha de fin (proveedor_pago = 'manual').
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { conectar } = require('./db');
const cuentas = require('../servidor/cuentas');

const PLANES = { freemium: 'Free', basic: 'Basic', pro: 'Pro' };

async function cambiarPlan(email, plan, empresaId) {
  email = String(email || '').trim().toLowerCase();
  plan = String(plan || '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Falta el email. Uso: bash deploy/plan.sh <email> <freemium|basic|pro> [id de la empresa]');
  if (!PLANES[plan]) throw new Error(`Plan desconocido: "${plan}". Tiene que ser freemium, basic o pro.`);
  const p = cuentas.pool();
  const [[u]] = await p.query('SELECT id FROM usuarios WHERE email=?', [email]);
  if (!u) throw new Error(`No hay ninguna cuenta con el email ${email}.`);
  const empresas = await cuentas.empresasDelUsuario(u.id);
  if (!empresas.length) throw new Error(`La cuenta ${email} no tiene empresas.`);
  let e;
  if (empresaId) {
    e = empresas.find(x => String(x.id) === String(empresaId));
    if (!e) throw new Error(`La empresa ${empresaId} no es de ${email}. Sus empresas: ${empresas.map(x => `${x.id} (${x.nombre})`).join(', ')}.`);
  } else if (empresas.length > 1) {
    throw new Error(`${email} tiene ${empresas.length} empresas. Decí cuál, agregando su id al final:\n`
      + empresas.map(x => `  ${x.id}  ${x.nombre}`).join('\n') + `\nEjemplo: bash deploy/plan.sh ${email} ${plan} ${empresas[0].id}`);
  } else e = empresas[0];
  const antes = await cuentas.planDeEmpresa(e.id);
  if (antes === plan) return { empresa: e, antes, plan, sinCambio: true };
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE suscripciones SET estado='cancelada', hasta=CURDATE() WHERE empresa_id=? AND estado='activa'", [e.id]);
    await conn.query("INSERT INTO suscripciones (empresa_id, plan, estado, desde, proveedor_pago) VALUES (?, ?, 'activa', CURDATE(), 'manual')", [e.id, plan]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { empresa: e, antes, plan: await cuentas.planDeEmpresa(e.id) };
}

module.exports = { cambiarPlan };

if (require.main === module) {
  const [email, plan, empresaId] = process.argv.slice(2);
  cambiarPlan(email, plan, empresaId)
    .then(r => console.log(r.sinCambio
      ? `${r.empresa.nombre} (empresa ${r.empresa.id}) ya está en el plan ${PLANES[r.plan]}. No cambié nada.`
      : `Listo: ${r.empresa.nombre} (empresa ${r.empresa.id}) pasó del plan ${PLANES[r.antes]} al plan ${PLANES[r.plan]}. Se ve al recargar la página.`))
    .catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(async () => { const p = conectar(); if (p) await p.end(); });
}
