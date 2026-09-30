// Métricas desde el servidor, sin pasar por la web.
// Uso: node db/metricas.js        (últimos 30 días)
//      node db/metricas.js 7      (últimos 7 días)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { conectar } = require('./db');
const { metricas } = require('../servidor/metricas');

const NOMBRES = { inicio_diagnostico: 'Inició el diagnóstico', vio_resultado: 'Vio el resultado', creo_cuenta: 'Creó la cuenta',
  volvio: 'Volvió otro día', segunda_carga: 'Cargó un segundo diagnóstico' };
const MODULOS = { benchmark: 'Benchmark', historial: 'Historial y alertas', planificacion: 'Planificación', simulacion: 'Simulación',
  indices: 'Índices económicos', ia: 'Análisis con IA', fpa: 'FP&A', vbe: 'VBE', dataset: 'Base de datos', inteligencia: 'Inteligencia',
  leads: 'Leads', marketplace: 'Marketplace' };
const col = (t, n) => String(t).padEnd(n);
const num = (t, n) => String(t).padStart(n);

(async () => {
  const dias = parseInt(process.argv[2], 10) || 30;
  try {
    const m = await metricas(dias);
    console.log(`Métricas de los últimos ${dias} días\n`);
    console.log('Embudo');
    for (const f of m.embudo) console.log('  ' + col(NOMBRES[f.paso] || f.paso, 30) + num(f.personas, 6) + ' personas' + num(f.eventos, 7) + ' eventos');
    console.log(`\nEmpresas activadas (con cuenta y al menos un diagnóstico): ${m.empresas_activadas}`);
    const s = m.segunda_carga_30_dias;
    console.log(`Segunda carga dentro de 30 días: ${s.porcentaje == null ? 'sin datos todavía' : s.porcentaje + ' %'} (${s.con_segunda} de ${s.cohorte}; ${s.empresas_en_curso} empresas todavía dentro de sus primeros 30 días)`);
    console.log('\nPedidos de IA por día y por plan');
    if (!m.ia_por_dia_y_plan.length) console.log('  Todavía no hay pedidos.');
    for (const f of m.ia_por_dia_y_plan) console.log('  ' + col(f.dia, 12) + col(f.plan, 11) + num(f.pedidos, 5) + ' pedidos' + num(f.contados, 5) + ' contados' + num(f.guardados, 5) + ' guardados');
    console.log('\n"Avisame cuando esté disponible", por plan y módulo');
    if (!m.avisame_por_plan_y_modulo.length) console.log('  Todavía no hay pedidos.');
    for (const f of m.avisame_por_plan_y_modulo) console.log('  ' + col(f.plan === 'pro' ? 'Pro' : 'Basic', 7) + col(MODULOS[f.modulo] || f.modulo, 22) + num(f.pedidos, 5) + ' pedidos' + num(f.personas, 5) + ' personas');
  } catch (e) {
    console.error('No se pudieron leer las métricas:', e.message);
    process.exitCode = 1;
  } finally {
    const p = conectar(); if (p) await p.end();
  }
})();
