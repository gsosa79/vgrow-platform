// Página de administración (solo lectura): empresas, sus diagnósticos y las métricas de los últimos 30 días.
// Las rutas de app.js solo llegan acá con una sesión de un email de ADMIN_EMAILS.
const cuentas = require('./cuentas');
const { metricas } = require('./metricas');

// Los mismos títulos que muestra la plataforma (vgRiesgo en public/index.html)
const RIESGOS = {
  perdida: 'Tus ventas no cubren la estructura',
  caja_critica: 'Tu caja alcanza para poco tiempo',
  holgura: 'Poca holgura sobre el punto de equilibrio',
  caja_justa: 'Tu caja está justa',
  margen_bajo: 'Margen por debajo del rango habitual del rubro',
  sin_riesgo: 'Sin riesgo principal',
};

const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const datosDe = f => { try { return typeof f.datos === 'string' ? JSON.parse(f.datos) : (f.datos || {}); } catch { return {}; } };

// Empresas como ver-registros.sh, ordenadas por la actividad más reciente. q filtra por nombre o email.
async function listarEmpresas(q) {
  const filtro = String(q || '').trim().slice(0, 100);
  const params = [];
  let where = '';
  if (filtro) {
    where = 'WHERE e.nombre LIKE ? OR e.email LIKE ?';
    const like = '%' + filtro.replace(/[\\%_]/g, c => '\\' + c) + '%';
    params.push(like, like);
  }
  const [filas] = await cuentas.pool().query(
    `SELECT e.id, e.nombre, e.email, e.sector, e.pais, e.ultimo_score AS score, e.ultimo_semaforo AS semaforo,
            e.organizacion_id IS NOT NULL AS con_cuenta,
            COUNT(d.id) AS diagnosticos,
            GREATEST(e.actualizado, COALESCE(MAX(d.creado), e.actualizado)) AS ultima_actividad
       FROM empresas e LEFT JOIN diagnosticos d ON d.empresa_id = e.id
       ${where}
      GROUP BY e.id ORDER BY ultima_actividad DESC, e.id DESC LIMIT 500`, params);
  const [[t]] = await cuentas.pool().query('SELECT COUNT(*) AS n FROM empresas');
  return {
    total: Number(t.n),
    empresas: filas.map(f => ({ id: f.id, nombre: f.nombre, email: f.email, sector: f.sector, pais: f.pais,
      score: num(f.score), semaforo: f.semaforo, con_cuenta: !!f.con_cuenta, diagnosticos: Number(f.diagnosticos),
      ultima_actividad: f.ultima_actividad })),
  };
}

// Una empresa: sus datos, su plan, quiénes tienen acceso y sus diagnósticos (del más nuevo al más viejo)
async function detalleEmpresa(id) {
  const eid = parseInt(id, 10);
  if (!eid) return null;
  const p = cuentas.pool();
  const [[e]] = await p.query(
    `SELECT id, nombre, email, sector, pais, tamano, moneda, ultimo_score AS score, ultimo_semaforo AS semaforo,
            organizacion_id, creado, actualizado FROM empresas WHERE id=?`, [eid]);
  if (!e) return null;
  const plan = await cuentas.planDeEmpresa(eid);
  const [usuarios] = e.organizacion_id ? await p.query(
    `SELECT u.email, m.rol, u.emails_mensuales FROM miembros m JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.organizacion_id=? ORDER BY u.id`, [e.organizacion_id]) : [[]];
  const [diags] = await p.query(
    `SELECT d.id, d.creado, d.score, d.semaforo, d.riesgo, d.datos, d.origen, a.titulo AS accion
       FROM diagnosticos d LEFT JOIN acciones_catalogo a ON a.codigo = d.accion_codigo
      WHERE d.empresa_id=? ORDER BY d.creado DESC, d.id DESC`, [eid]);
  return {
    empresa: { id: e.id, nombre: e.nombre, email: e.email, sector: e.sector, pais: e.pais, tamano: e.tamano,
      moneda: e.moneda || 'UYU', score: num(e.score), semaforo: e.semaforo, con_cuenta: !!e.organizacion_id,
      creado: e.creado, actualizado: e.actualizado },
    plan,
    usuarios: usuarios.map(u => ({ email: u.email, rol: u.rol, email_mensual: !!u.emails_mensuales })),
    diagnosticos: diags.map(d => {
      const x = datosDe(d); const s1 = x.step1 || {};
      return { fecha: d.creado, score: num(d.score), semaforo: d.semaforo, origen: d.origen,
        ventas: num(s1.ventas), margen: num(s1.margen), estructura: num(s1.costos), caja: num(s1.caja),
        riesgo: d.riesgo ? (RIESGOS[d.riesgo] || d.riesgo) : null, accion: d.accion || null };
    }),
  };
}

// Métricas de los últimos 30 días, en el formato de las tarjetas
async function resumen(dias = 30) {
  const m = await metricas(dias);
  const paso = k => m.embudo.find(f => f.paso === k) || { eventos: 0, personas: 0 };
  const ia = m.ia_por_dia_y_plan.reduce((s, f) => ({ pedidos: s.pedidos + f.pedidos, contados: s.contados + f.contados }), { pedidos: 0, contados: 0 });
  const iaPlan = {};
  for (const f of m.ia_por_dia_y_plan) iaPlan[f.plan] = (iaPlan[f.plan] || 0) + f.pedidos;
  const avisos = m.avisame_por_plan_y_modulo.reduce((s, f) => s + Number(f.pedidos), 0);
  const [[ay]] = await cuentas.pool().query(
    `SELECT COUNT(*) AS veces, COUNT(DISTINCT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(datos, '$.anon')), JSON_UNQUOTE(JSON_EXTRACT(datos, '$.empresa_id')), id)) AS personas
       FROM eventos WHERE tipo = 'abrio_ayuda' AND creado >= NOW() - INTERVAL ? DAY`, [dias]);
  return {
    dias,
    ayuda: { veces: Number(ay.veces), personas: Number(ay.personas) },
    diagnosticos_iniciados: paso('inicio_diagnostico'),
    diagnosticos_terminados: paso('vio_resultado'),
    cuentas_creadas: paso('creo_cuenta').eventos,
    segunda_carga: m.segunda_carga_30_dias,
    ia: { pedidos: ia.pedidos, por_plan: iaPlan },
    avisame: { pedidos: avisos, por_plan_y_modulo: m.avisame_por_plan_y_modulo },
    email_mensual: m.email_retorno,
  };
}

module.exports = { listarEmpresas, detalleEmpresa, resumen, RIESGOS };
