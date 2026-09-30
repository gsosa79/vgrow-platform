// Carga en la base el dataset de referencia y los benchmarks por sector (db/datos/*.json).
// Se puede correr las veces que haga falta: actualiza lo que existe y no duplica.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { cargarDatos, conectar } = require('./db');
const dataset = require('./datos/dataset.json');
const benchmarks = require('./datos/benchmarks.json');

const numero = v => typeof v === 'number' && Number.isFinite(v);
function revisar() {
  const errores = [];
  const ids = new Set();
  for (const e of dataset) {
    if (!e.id || ids.has(e.id)) errores.push(`empresa sin id o repetida: ${e.id}`);
    ids.add(e.id);
    for (const k of ['s', 'p', 't', 'sem']) if (!e[k]) errores.push(`${e.id}: falta ${k}`);
    for (const k of ['m', 'cr', 'eco', 'gest', 'tot', 'caja', 'v', 'c']) if (!numero(e[k])) errores.push(`${e.id}: ${k} no es un número`);
  }
  for (const [s, r] of Object.entries(benchmarks)) {
    if (!Array.isArray(r.margen) || r.margen.length !== 2) errores.push(`${s}: margen debe ser [mín, máx]`);
    for (const k of ['margenAvg', 'crecAvg', 'cajaAvg', 'cobAvg', 'scoreAvg']) if (!numero(r[k])) errores.push(`${s}: ${k} no es un número`);
  }
  if (!dataset.length || !Object.keys(benchmarks).length) errores.push('los archivos están vacíos');
  return errores;
}

(async () => {
  const errores = revisar();
  if (errores.length) { console.error('Los datos tienen errores; no se cargó nada:\n- ' + errores.join('\n- ')); process.exit(1); }
  try {
    const r = await cargarDatos(dataset, benchmarks);
    console.log(`Cargado: ${r.empresas} empresas en dataset_empresas y ${r.sectores} sectores en benchmarks_sector.`);
  } catch (e) {
    console.error('No se pudo cargar:', e.message);
    process.exitCode = 1;
  } finally {
    const p = conectar(); if (p) await p.end();
  }
})();
