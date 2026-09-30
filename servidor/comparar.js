// Comparaciones con los datos de referencia, calculadas en el servidor.
// El navegador recibe solo resultados agregados; ningún grupo con menos de MINIMO empresas.
const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const MINIMO = 5;
let cache = null, hasta = 0;

// Dataset: de la base (5 minutos en memoria) o, si no hay base, del archivo del repositorio.
async function dataset() {
  if (cache && Date.now() < hasta) return cache;
  let filas = null;
  try { filas = await db.leerDataset(); } catch (e) { console.error('[dataset]', e.message); }
  if (!filas || !filas.length) filas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'datos', 'dataset.json'), 'utf8'));
  cache = filas.map(e => ({ ...e, m: +e.m, cr: +e.cr, eco: +e.eco, gest: +e.gest, tot: +e.tot, caja: +e.caja, v: +e.v, c: +e.c }));
  hasta = Date.now() + 5 * 60 * 1000;
  return cache;
}

const r1 = x => Math.round(x * 10) / 10;
const prom = (arr, f) => arr.reduce((s, e) => s + f(e), 0) / arr.length;
const tam = x => String(x || '').split(' ')[0];
const cobDe = e => e.c > 0 ? e.v * (e.m / 100) / e.c : 0;

function indices(pool) {
  const n = pool.length;
  const pct = f => Math.round(pool.filter(f).length / n * 100);
  return {
    n, iSalud: r1(prom(pool, e => e.tot)), iGest: r1(prom(pool, e => e.gest) * 2), iCrec: r1(Math.min(10, prom(pool, e => e.cr) / 3.5)),
    iMargen: r1(Math.min(10, prom(pool, e => e.m) / 7)), iRiesgo: r1(10 - prom(pool, e => e.tot)),
    pctRojo: pct(e => e.sem === 'Rojo'), pctCaja: pct(e => e.caja < 1.8), pctCrec: pct(e => e.cr > 15), pctSolid: pct(e => e.tot >= 7.5),
    avgM: r1(prom(pool, e => e.m)), avgCr: r1(prom(pool, e => e.cr)), avgCaja: r1(prom(pool, e => e.caja)),
  };
}

// Crecimiento del sector: cuántas empresas crecen, están estables o caen
function iss(todas, sector, pais) {
  let conPais = true;
  let pool = todas.filter(e => e.s === sector && e.p === pais);
  if (pool.length < 10) { pool = todas.filter(e => e.s === sector); conPais = false; }
  if (pool.length < MINIMO) return null;
  const n = pool.length;
  const pct = f => Math.round(pool.filter(f).length / n * 100);
  return { n, conPais, crPromedio: r1(prom(pool, e => e.cr)), scorePromedio: r1(prom(pool, e => e.tot)),
    pctExpansion: pct(e => e.cr > 5), pctEstabilidad: pct(e => e.cr >= -5 && e.cr <= 5), pctContraccion: pct(e => e.cr < -5), pctConCaida: pct(e => e.cr < 0) };
}

// Agregados generales: índices, rubros y resumen por sector (solo sectores con 5 empresas o más)
async function agregados() {
  const todas = await dataset();
  const sectores = [...new Set(todas.map(e => e.s))].map(s => {
    const pool = todas.filter(e => e.s === s);
    if (pool.length < MINIMO) return null;
    return { sector: s, n: pool.length, avgTot: r1(prom(pool, e => e.tot)), avgM: r1(prom(pool, e => e.m)), avgCr: r1(prom(pool, e => e.cr)),
      iRiesgo: r1(10 - prom(pool, e => e.tot)), iss: iss(todas, s, 'Uruguay') };
  }).filter(Boolean).sort((a, b) => b.avgTot - a.avgTot);
  return { agregado: true, minimo: MINIMO, total: todas.length, rubros: new Set(todas.map(e => e.s)).size, indices: indices(todas), sectores };
}

// Benchmark: sector + país + tamaño, y si no hay 5 empresas, se van soltando filtros
async function benchmark(sector, pais, tamano) {
  const todas = await dataset();
  const niveles = [
    ['exacto', e => e.s === sector && e.p === pais && tam(e.t) === tam(tamano), ['sector', 'país', 'tamaño'], []],
    ['sector+tamaño', e => e.s === sector && tam(e.t) === tam(tamano), ['sector', 'tamaño'], ['país']],
    ['sector', e => e.s === sector, ['sector'], ['país', 'tamaño']],
    ['general', () => true, [], ['sector', 'país', 'tamaño']],
  ];
  for (const [mt, f, filtros, sinFiltro] of niveles) {
    const pool = todas.filter(f);
    if (pool.length >= MINIMO) {
      return { n: pool.length, mt, filtros, sinFiltro, margen: r1(prom(pool, e => e.m)), crecimiento: r1(prom(pool, e => e.cr)),
        eco: r1(prom(pool, e => e.eco)), gest: r1(prom(pool, e => e.gest)), total: r1(prom(pool, e => e.tot)) };
    }
  }
  return null;
}

// Lo que muestra Mi empresa para un perfil: crecimiento del sector, posición, empresas en verde y empresas parecidas
async function comparar(p) {
  const todas = await dataset();
  const sector = p.sector;
  const pool = todas.filter(e => e.s === sector && e.tot > 0);
  const out = { minimo: MINIMO, iss: iss(todas, sector, p.pais || 'Uruguay'), a13: null, verdes: null, similares: null };
  if (pool.length >= MINIMO) {
    out.a13 = { n: pool.length, pctileScore: p.score != null ? Math.round(pool.filter(e => e.tot < p.score).length / pool.length * 100) : null,
      scoreProm: r1(prom(pool, e => e.tot)), pctCrecimiento: Math.round(pool.filter(e => e.cr > 0).length / pool.length * 100), margenProm: r1(prom(pool, e => e.m)) };
  }
  const verdes = pool.filter(e => e.tot >= 7.5);
  if (verdes.length >= MINIMO) {
    out.verdes = { n: verdes.length, margen: r1(prom(verdes, e => e.m)), cobertura: Math.round(prom(verdes, cobDe) * 100) / 100, caja: r1(prom(verdes, e => e.caja)) };
  }
  if (p.score != null) {
    const pares = pool.filter(e => Math.abs(e.tot - p.score) <= 1.5);
    if (pares.length >= MINIMO) {
      const margenSector = p.margen_sector;
      out.similares = { n: pares.length, avgCr: r1(prom(pares, e => e.cr)),
        pctMargenAlto: margenSector != null ? Math.round(pares.filter(e => e.m > margenSector).length / pares.length * 100) : null,
        pctCobAlta: Math.round(pares.filter(e => cobDe(e) >= 1.3).length / pares.length * 100) };
    }
  }
  return out;
}

module.exports = { MINIMO, dataset, agregados, benchmark, comparar, indices };
