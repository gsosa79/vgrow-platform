// Muestra cuántas personas pidieron "Avisame cuando esté disponible", por plan y por módulo.
// Uso: node db/metricas.js          (todo el historial)
//      node db/metricas.js 30       (solo los últimos 30 días)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { contarAvisos, conectar } = require('./db');

const NOMBRES = {
  benchmark: 'Benchmark', historial: 'Historial y alertas', planificacion: 'Planificación', simulacion: 'Simulación',
  indices: 'Índices económicos', ia: 'Análisis con IA', fpa: 'FP&A', vbe: 'VBE', dataset: 'Base de datos',
  inteligencia: 'Inteligencia', leads: 'Leads', marketplace: 'Marketplace',
};
const PLANES = { basic: 'Basic', pro: 'Pro' };

(async () => {
  const dias = parseInt(process.argv[2], 10) || 0;
  try {
    const { filas, total } = await contarAvisos(dias);
    console.log(`Pedidos de "Avisame cuando esté disponible" ${dias ? `(últimos ${dias} días)` : '(desde el principio)'}\n`);
    if (!filas.length) { console.log('Todavía no hay pedidos.'); return; }
    const col = (t, n) => String(t).padEnd(n);
    const num = (t, n) => String(t).padStart(n);
    console.log(col('Plan', 7) + col('Módulo', 22) + num('Pedidos', 8) + num('Personas', 10));
    for (const f of filas) console.log(col(PLANES[f.plan] || f.plan, 7) + col(NOMBRES[f.modulo] || f.modulo, 22) + num(f.pedidos, 8) + num(f.personas, 10));
    const porPlan = {};
    for (const f of filas) porPlan[f.plan] = (porPlan[f.plan] || 0) + f.pedidos;
    console.log('\nPor plan: ' + Object.entries(porPlan).map(([p, n]) => `${PLANES[p] || p} ${n}`).join(', '));
    console.log(`Total: ${total.pedidos} pedidos de ${total.personas} personas distintas.`);
  } catch (e) {
    console.error('No se pudo leer la base:', e.message);
    process.exitCode = 1;
  } finally {
    const p = conectar(); if (p) await p.end();
  }
})();
