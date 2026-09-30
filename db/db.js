// Conexión a MySQL (RDS) y funciones para guardar datos.
const fs = require('fs');
const path = require('path');
let pool = null;

function conectar() {
  if (pool || !process.env.DB_HOST) return pool;
  const mysql = require('mysql2/promise');
  const esRDS = /rds\.amazonaws\.com$/.test(process.env.DB_HOST);
  const caPath = path.join(__dirname, 'rds-ca.pem');
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'vgrow',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    ssl: esRDS && fs.existsSync(caPath) ? { ca: fs.readFileSync(caPath) } : undefined,
  });
  return pool;
}

async function salud() {
  const p = conectar();
  if (!p) return false;
  try { await p.query('SELECT 1'); return true; } catch (e) { console.error('[db]', e.message); return false; }
}

const txt = (v, n) => (v === undefined || v === null || v === '') ? null : String(v).slice(0, n);
const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);

// Guarda un registro que llega desde la plataforma (empresa + email, y el diagnóstico si viene)
async function guardarLead(d, ip) {
  const p = conectar();
  if (!p) return false;
  const email = String(d.email || '').trim().toLowerCase();
  const nombre = String(d.empresa || '').trim();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO eventos (tipo, email, ip, datos) VALUES (?,?,?,?)',
      [d.diag_id ? 'diagnostico' : 'registro', email, txt(ip, 64), JSON.stringify(d)]);
    await conn.query(
      `INSERT INTO empresas (nombre, email, email_corporativo, sector, pais, tamano, ultimo_score, ultimo_semaforo, origen)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         email_corporativo=VALUES(email_corporativo),
         sector=COALESCE(VALUES(sector), sector), pais=COALESCE(VALUES(pais), pais), tamano=COALESCE(VALUES(tamano), tamano),
         ultimo_score=COALESCE(VALUES(ultimo_score), ultimo_score), ultimo_semaforo=COALESCE(VALUES(ultimo_semaforo), ultimo_semaforo)`,
      [txt(nombre, 200), txt(email, 200), d.email_corporativo ? 1 : 0, txt(d.sector, 100), txt(d.pais, 60), txt(d.tamano, 60),
       num(d.ultimo_score), txt(d.semaforo, 20), txt(d.origen, 40)]);
    const [[emp]] = await conn.query('SELECT id FROM empresas WHERE email=? AND nombre=?', [email, nombre]);
    if (d.diag_id && emp) {
      await conn.query(
        `INSERT IGNORE INTO diagnosticos (empresa_id, diag_ref, score, semaforo, sector, pais, tamano, datos)
         VALUES (?,?,?,?,?,?,?,?)`,
        [emp.id, txt(d.diag_id, 40), num(d.ultimo_score), txt(d.semaforo, 20), txt(d.sector, 100), txt(d.pais, 60),
         txt(d.tamano, 60), d.datos ? JSON.stringify(d.datos) : null]);
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── Dataset de referencia y benchmarks por sector ─────────────────────────────
// La plataforma los usa con los mismos nombres cortos que tenían en index.html.
const n = v => (v === null || v === undefined) ? null : Number(v); // DECIMAL llega como texto

async function leerDataset() {
  const p = conectar();
  if (!p) return null;
  const [filas] = await p.query('SELECT * FROM dataset_empresas WHERE activo=1 ORDER BY orden, ref');
  return filas.map(f => ({
    id: f.ref, s: f.sector, p: f.pais, t: f.tamano, m: n(f.margen), cr: n(f.crecimiento),
    eco: n(f.score_eco), gest: n(f.score_gestion), tot: n(f.score_total), caja: n(f.caja_meses),
    sem: f.semaforo, v: n(f.ventas), c: n(f.costos), etapa: f.etapa,
  }));
}

async function leerBenchmarks() {
  const p = conectar();
  if (!p) return null;
  const [filas] = await p.query('SELECT * FROM benchmarks_sector WHERE activo=1 ORDER BY orden, sector');
  const sectores = {};
  for (const f of filas) {
    sectores[f.sector] = {
      margen: [n(f.margen_min), n(f.margen_max)], margenAvg: n(f.margen_prom), crecAvg: n(f.crec_prom),
      cajaAvg: n(f.caja_prom), cobAvg: n(f.cobertura_prom), scoreAvg: n(f.score_prom),
      eenVab: n(f.een_vab), eenVabSector: f.een_vab_sector, podGrowth: n(f.empleo_var), podSector: f.empleo_sector,
      fuenteMargen: f.fuente_margen,
    };
  }
  return sectores;
}

// Carga (o actualiza) el dataset y los benchmarks. Se puede correr varias veces:
// actualiza por clave, no duplica, y desactiva lo que ya no está en los archivos.
async function cargarDatos(dataset, benchmarks) {
  const p = conectar();
  if (!p) throw new Error('Falta la configuración de la base (DB_HOST en .env).');
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    for (const [i, e] of dataset.entries()) {
      await conn.query(
        `INSERT INTO dataset_empresas (ref, sector, pais, tamano, margen, crecimiento, score_eco, score_gestion, score_total,
           caja_meses, semaforo, ventas, costos, etapa, orden, activo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE sector=VALUES(sector), pais=VALUES(pais), tamano=VALUES(tamano), margen=VALUES(margen),
           crecimiento=VALUES(crecimiento), score_eco=VALUES(score_eco), score_gestion=VALUES(score_gestion),
           score_total=VALUES(score_total), caja_meses=VALUES(caja_meses), semaforo=VALUES(semaforo), ventas=VALUES(ventas),
           costos=VALUES(costos), etapa=VALUES(etapa), orden=VALUES(orden), activo=1`,
        [e.id, e.s, e.p, e.t, e.m, e.cr, e.eco, e.gest, e.tot, e.caja, e.sem, e.v, e.c, e.etapa || null, i]);
    }
    await conn.query('UPDATE dataset_empresas SET activo=0 WHERE ref NOT IN (?)', [dataset.map(e => e.id)]);
    const sectores = Object.entries(benchmarks);
    for (const [i, [sector, r]] of sectores.entries()) {
      await conn.query(
        `INSERT INTO benchmarks_sector (sector, margen_min, margen_max, margen_prom, crec_prom, caja_prom, cobertura_prom,
           score_prom, een_vab, een_vab_sector, empleo_var, empleo_sector, fuente_margen, orden, activo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE margen_min=VALUES(margen_min), margen_max=VALUES(margen_max), margen_prom=VALUES(margen_prom),
           crec_prom=VALUES(crec_prom), caja_prom=VALUES(caja_prom), cobertura_prom=VALUES(cobertura_prom),
           score_prom=VALUES(score_prom), een_vab=VALUES(een_vab), een_vab_sector=VALUES(een_vab_sector),
           empleo_var=VALUES(empleo_var), empleo_sector=VALUES(empleo_sector), fuente_margen=VALUES(fuente_margen),
           orden=VALUES(orden), activo=1`,
        [sector, r.margen[0], r.margen[1], r.margenAvg, r.crecAvg, r.cajaAvg, r.cobAvg, r.scoreAvg, r.eenVab ?? null,
         r.eenVabSector ?? null, r.podGrowth ?? null, r.podSector ?? null, r.fuenteMargen ?? null, i]);
    }
    await conn.query('UPDATE benchmarks_sector SET activo=0 WHERE sector NOT IN (?)', [sectores.map(([s]) => s)]);
    await conn.commit();
    const [[a]] = await conn.query('SELECT COUNT(*) AS n FROM dataset_empresas WHERE activo=1');
    const [[b]] = await conn.query('SELECT COUNT(*) AS n FROM benchmarks_sector WHERE activo=1');
    return { empresas: a.n, sectores: b.n };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { conectar, salud, guardarLead, leerDataset, leerBenchmarks, cargarDatos };
