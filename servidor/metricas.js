// Métricas para el administrador: embudo, empresas activadas, segunda carga, IA por día y plan, "Avisame".
const cuentas = require('./cuentas');
const db = require('../db/db');

const EMBUDO = ['inicio_diagnostico', 'vio_resultado', 'creo_cuenta', 'volvio', 'segunda_carga'];

async function metricas(dias = 30) {
  const p = cuentas.pool();
  const [emb] = await p.query(
    `SELECT tipo, COUNT(*) AS eventos,
            COUNT(DISTINCT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(datos, '$.anon')), JSON_UNQUOTE(JSON_EXTRACT(datos, '$.empresa_id')), email, id)) AS personas
       FROM eventos WHERE tipo IN (?) AND creado >= NOW() - INTERVAL ? DAY GROUP BY tipo`, [EMBUDO, dias]);
  const embudo = EMBUDO.map(t => { const f = emb.find(x => x.tipo === t); return { paso: t, eventos: f ? f.eventos : 0, personas: f ? f.personas : 0 }; });

  const [[act]] = await p.query(
    `SELECT COUNT(DISTINCT e.id) AS n FROM empresas e JOIN diagnosticos d ON d.empresa_id = e.id WHERE e.organizacion_id IS NOT NULL`);
  const [[seg]] = await p.query(
    `SELECT COUNT(*) AS cohorte, SUM(con_segunda) AS con_segunda FROM (
       SELECT f.empresa_id, EXISTS(SELECT 1 FROM diagnosticos d2 WHERE d2.empresa_id = f.empresa_id AND d2.creado > f.primero AND d2.creado <= f.primero + INTERVAL 30 DAY) AS con_segunda
         FROM (SELECT d.empresa_id, MIN(d.creado) AS primero FROM diagnosticos d JOIN empresas e ON e.id = d.empresa_id
                WHERE e.organizacion_id IS NOT NULL GROUP BY d.empresa_id) f
        WHERE f.primero <= NOW() - INTERVAL 30 DAY) x`);
  const [[enCurso]] = await p.query(
    `SELECT COUNT(*) AS n FROM (SELECT d.empresa_id, MIN(d.creado) AS primero FROM diagnosticos d JOIN empresas e ON e.id = d.empresa_id
       WHERE e.organizacion_id IS NOT NULL GROUP BY d.empresa_id) f WHERE f.primero > NOW() - INTERVAL 30 DAY`);
  const cohorte = Number(seg.cohorte) || 0, conSegunda = Number(seg.con_segunda) || 0;

  const [ia] = await p.query(
    `SELECT DATE_FORMAT(creado, '%Y-%m-%d') AS dia, plan, COUNT(*) AS pedidos, SUM(cuenta) AS contados, SUM(guardado) AS guardados
       FROM ia_uso WHERE creado >= NOW() - INTERVAL ? DAY GROUP BY dia, plan ORDER BY dia DESC, plan`, [dias]);
  const avisos = await db.contarAvisos(dias);

  return {
    dias,
    embudo,
    empresas_activadas: act.n,
    segunda_carga_30_dias: { cohorte, con_segunda: conSegunda, porcentaje: cohorte ? Math.round(conSegunda / cohorte * 100) : null,
      nota: 'Cohorte: empresas con cuenta cuyo primer diagnóstico tiene 30 días o más.', empresas_en_curso: enCurso.n },
    ia_por_dia_y_plan: ia.map(f => ({ ...f, pedidos: Number(f.pedidos), contados: Number(f.contados), guardados: Number(f.guardados) })),
    avisame_por_plan_y_modulo: avisos.filas,
  };
}

module.exports = { metricas, EMBUDO };
