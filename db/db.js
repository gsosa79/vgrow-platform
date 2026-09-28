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

module.exports = { conectar, salud, guardarLead };
