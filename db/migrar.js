// Agrega a las tablas que ya existían las columnas nuevas de identidad y arquitectura.
// Se corre con el usuario admin de la base (lo hace deploy/migrar.sh). Se puede repetir: solo agrega lo que falta.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const COLUMNAS = [
  ['empresas', 'organizacion_id', 'INT NULL AFTER id'],
  ['empresas', 'moneda', "VARCHAR(3) NULL"],
  ['diagnosticos', 'periodo_id', 'INT NULL AFTER empresa_id'],
  ['diagnosticos', 'usuario_id', 'INT NULL'],
  ['diagnosticos', 'riesgo', 'VARCHAR(20) NULL'],
  ['diagnosticos', 'accion_codigo', 'VARCHAR(40) NULL'],
  ['diagnosticos', 'origen', "VARCHAR(20) NULL"],
];
const INDICES = [
  ['empresas', 'ix_empresa_org', 'CREATE INDEX ix_empresa_org ON empresas (organizacion_id)'],
  ['diagnosticos', 'ix_diag_periodo', 'CREATE INDEX ix_diag_periodo ON diagnosticos (periodo_id)'],
];

(async () => {
  const mysql = require('mysql2/promise');
  const esRDS = /rds\.amazonaws\.com$/.test(process.env.DB_HOST || '');
  const ca = path.join(__dirname, 'rds-ca.pem');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS,
    database: process.env.DB_NAME || 'vgrow', charset: 'utf8mb4', multipleStatements: true,
    ssl: esRDS && fs.existsSync(ca) ? { ca: fs.readFileSync(ca) } : undefined,
  });
  try {
    const bd = process.env.DB_NAME || 'vgrow';
    for (const [tabla, col, def] of COLUMNAS) {
      const [[x]] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [bd, tabla, col]);
      if (!x.n) { await conn.query(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`); console.log(`+ ${tabla}.${col}`); }
    }
    for (const [tabla, idx, sql] of INDICES) {
      const [[x]] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?', [bd, tabla, idx]);
      if (!x.n) { await conn.query(sql); console.log(`+ índice ${idx}`); }
    }
    console.log('Migración lista.');
  } catch (e) {
    console.error('No se pudo migrar:', e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
