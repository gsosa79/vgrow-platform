// Agrega a las tablas que ya existían las columnas nuevas (identidad y arquitectura, email mensual).
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
  // Email mensual: consentimiento (se pide al crear la cuenta) y token del link de baja
  ['usuarios', 'emails_mensuales', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['usuarios', 'baja_token', 'VARCHAR(64) NULL'],
  ['login_tokens', 'acepta_emails', 'TINYINT(1) NULL'],
];
const INDICES = [
  ['empresas', 'ix_empresa_org', 'CREATE INDEX ix_empresa_org ON empresas (organizacion_id)'],
  ['diagnosticos', 'ix_diag_periodo', 'CREATE INDEX ix_diag_periodo ON diagnosticos (periodo_id)'],
  ['usuarios', 'uq_baja_token', 'CREATE UNIQUE INDEX uq_baja_token ON usuarios (baja_token)'],
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
    // Eventos del navegador guardados antes: sin IP, y sin el identificador del navegador cuando tienen empresa
    // (ni claves vacías, que las métricas contaban como una misma persona). Los mismos tipos que EVENTOS_CLIENTE en app.js.
    const CLIENTE = "tipo IN ('inicio_diagnostico','vio_resultado','volvio','segunda_carga','inicio_ver_por_que','inicio_simular','abrio_ayuda') AND email IS NULL";
    const [ip] = await conn.query(`UPDATE eventos SET ip=NULL WHERE ${CLIENTE} AND ip IS NOT NULL`);
    const [an] = await conn.query(`UPDATE eventos SET datos=JSON_REMOVE(datos, '$.anon') WHERE ${CLIENTE}
      AND JSON_CONTAINS_PATH(datos, 'one', '$.anon') AND (JSON_TYPE(JSON_EXTRACT(datos, '$.anon'))='NULL' OR JSON_TYPE(JSON_EXTRACT(datos, '$.empresa_id'))='INTEGER')`);
    await conn.query(`UPDATE eventos SET datos=JSON_REMOVE(datos, '$.empresa_id') WHERE ${CLIENTE} AND JSON_TYPE(JSON_EXTRACT(datos, '$.empresa_id'))='NULL'`);
    if (ip.affectedRows || an.affectedRows) console.log(`Eventos del navegador: ${ip.affectedRows} sin IP, ${an.affectedRows} sin el identificador del navegador.`);
    console.log('Migración lista.');
  } catch (e) {
    console.error('No se pudo migrar:', e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
