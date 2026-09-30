// Usuarios, organizaciones, empresas, suscripciones, períodos y diagnósticos (con login).
// Toda consulta de una empresa pasa por empresaDelUsuario: un usuario solo ve las empresas de sus organizaciones.
const crypto = require('crypto');
const { conectar } = require('../db/db');

const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
const txt = (v, n) => (v === undefined || v === null || v === '') ? null : String(v).slice(0, n);
const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

function pool() {
  const p = conectar();
  if (!p) { const e = new Error('Falta la base de datos.'); e.status = 503; throw e; }
  return p;
}

// ── Links mágicos ────────────────────────────────────────────────────────────
async function crearLinkIngreso(email, ip) {
  const token = nuevoToken();
  await pool().query('INSERT INTO login_tokens (token_hash, email, vence, ip) VALUES (?,?, NOW() + INTERVAL 15 MINUTE, ?)', [hash(token), email, txt(ip, 64)]);
  return token;
}
async function pedidosRecientes(email) {
  const [[r]] = await pool().query('SELECT COUNT(*) AS n FROM login_tokens WHERE email=? AND creado > NOW() - INTERVAL 1 HOUR', [email]);
  return r.n;
}
// Consume el token (una sola vez, antes de que venza). Devuelve el email o null.
async function usarLinkIngreso(token) {
  const h = hash(token);
  const [r] = await pool().query('UPDATE login_tokens SET usado=NOW() WHERE token_hash=? AND usado IS NULL AND vence > NOW()', [h]);
  if (!r.affectedRows) return null;
  const [[t]] = await pool().query('SELECT email FROM login_tokens WHERE token_hash=?', [h]);
  return t ? t.email : null;
}

// ── Usuario, organización, empresa y suscripción ─────────────────────────────
// Primer ingreso: crea el usuario, su organización (rol dueño), una empresa y la suscripción Freemium.
async function usuarioPorEmail(email) {
  const p = pool();
  const [[u]] = await p.query('SELECT id, email FROM usuarios WHERE email=?', [email]);
  if (u) {
    await p.query('UPDATE usuarios SET verificado=1, ultimo_acceso=NOW() WHERE id=?', [u.id]);
    return { ...u, nuevo: false };
  }
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const [ru] = await conn.query("INSERT INTO usuarios (email, rol, verificado, ultimo_acceso) VALUES (?, 'dueno', 1, NOW())", [email]);
    const [ro] = await conn.query('INSERT INTO organizaciones (nombre) VALUES (?)', [email.split('@')[1] || email]);
    await conn.query("INSERT INTO miembros (usuario_id, organizacion_id, rol) VALUES (?,?, 'dueno')", [ru.insertId, ro.insertId]);
    const [re] = await conn.query("INSERT INTO empresas (organizacion_id, nombre, email, origen) VALUES (?, 'Mi empresa', ?, 'cuenta')", [ro.insertId, email]);
    await conn.query("INSERT INTO suscripciones (empresa_id, plan, estado, desde) VALUES (?, 'freemium', 'activa', CURDATE())", [re.insertId]);
    await conn.commit();
    return { id: ru.insertId, email, nuevo: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function empresasDelUsuario(usuarioId) {
  const [filas] = await pool().query(
    `SELECT e.id, e.nombre, e.sector, e.pais, e.tamano, e.moneda, e.organizacion_id, m.rol
       FROM empresas e JOIN miembros m ON m.organizacion_id = e.organizacion_id
      WHERE m.usuario_id=? ORDER BY e.id`, [usuarioId]);
  return filas;
}
// La empresa, solo si pertenece a una organización del usuario. Si no, null (la API responde 404).
async function empresaDelUsuario(usuarioId, empresaId) {
  const id = parseInt(empresaId, 10);
  if (!id) return null;
  const [[e]] = await pool().query(
    `SELECT e.id, e.nombre, e.sector, e.pais, e.tamano, e.moneda, e.organizacion_id, m.rol
       FROM empresas e JOIN miembros m ON m.organizacion_id = e.organizacion_id
      WHERE m.usuario_id=? AND e.id=?`, [usuarioId, id]);
  return e || null;
}
async function crearEmpresa(usuarioId, organizacionId, nombre) {
  const [[m]] = await pool().query('SELECT rol FROM miembros WHERE usuario_id=? AND organizacion_id=?', [usuarioId, organizacionId]);
  if (!m) return null;
  const [[u]] = await pool().query('SELECT email FROM usuarios WHERE id=?', [usuarioId]);
  const [re] = await pool().query("INSERT INTO empresas (organizacion_id, nombre, email, origen) VALUES (?,?,?, 'cuenta')", [organizacionId, txt(nombre, 200), u.email]);
  await pool().query("INSERT INTO suscripciones (empresa_id, plan, estado, desde) VALUES (?, 'freemium', 'activa', CURDATE())", [re.insertId]);
  return re.insertId;
}

// Plan vigente: la suscripción activa más reciente dentro de sus fechas. Sin ninguna, Freemium.
async function planDeEmpresa(empresaId) {
  const [[s]] = await pool().query(
    `SELECT plan FROM suscripciones WHERE empresa_id=? AND estado='activa' AND desde <= CURDATE() AND (hasta IS NULL OR hasta >= CURDATE())
      ORDER BY desde DESC, id DESC LIMIT 1`, [empresaId]);
  return s ? s.plan : 'freemium';
}

// ── Sesiones ─────────────────────────────────────────────────────────────────
async function crearSesion(usuarioId, empresaId) {
  const token = nuevoToken();
  await pool().query('INSERT INTO sesiones (token_hash, usuario_id, empresa_id, vence, ultimo_uso) VALUES (?,?,?, NOW() + INTERVAL 30 DAY, NOW())', [hash(token), usuarioId, empresaId || null]);
  return token;
}
async function leerSesion(token) {
  if (!token) return null;
  const [[s]] = await pool().query(
    `SELECT s.usuario_id, s.empresa_id, u.email FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash=? AND s.vence > NOW()`, [hash(token)]);
  return s || null;
}
async function cerrarSesion(token) { if (token) await pool().query('DELETE FROM sesiones WHERE token_hash=?', [hash(token)]); }
async function elegirEmpresaSesion(token, empresaId) { await pool().query('UPDATE sesiones SET empresa_id=? WHERE token_hash=?', [empresaId, hash(token)]); }

// ── Diagnósticos, períodos y acciones ────────────────────────────────────────
function periodoDe(fecha) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit' }).formatToParts(fecha);
  return { anio: +p.find(x => x.type === 'year').value, mes: +p.find(x => x.type === 'month').value };
}
async function periodoId(conn, empresaId, fecha) {
  const { anio, mes } = periodoDe(fecha);
  await conn.query('INSERT IGNORE INTO periodos (empresa_id, anio, mes) VALUES (?,?,?)', [empresaId, anio, mes]);
  const [[p]] = await conn.query('SELECT id FROM periodos WHERE empresa_id=? AND anio=? AND mes=?', [empresaId, anio, mes]);
  return p.id;
}

// Guarda un diagnóstico de la empresa (nuevo o migrado desde el navegador). Devuelve { id, periodo_id, segunda_carga }.
async function guardarDiagnostico(empresaId, usuarioId, d, origen) {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const fecha = d.ts && Number.isFinite(+d.ts) ? new Date(+d.ts) : new Date();
    const pid = await periodoId(conn, empresaId, fecha);
    const s1 = d.step1 || {};
    const accion = txt(d.accion_codigo, 40);
    const [[cat]] = accion ? await conn.query('SELECT codigo FROM acciones_catalogo WHERE codigo=?', [accion]) : [[null]];
    const [r] = await conn.query(
      `INSERT INTO diagnosticos (empresa_id, periodo_id, usuario_id, diag_ref, score, semaforo, sector, pais, tamano, riesgo, accion_codigo, origen, datos, creado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, ?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [empresaId, pid, usuarioId, txt(d.id, 40), num(d.total), txt(d.sem, 20), txt(s1.sector, 100), txt(s1.pais, 60), txt(s1.tamano, 60),
       txt(d.riesgo, 20), cat ? cat.codigo : null, txt(origen, 20),
       JSON.stringify({ step1: s1, context: d.context || {}, answers: d.answers || [], ecoData: d.ecoData || {}, gestScore: d.gestScore, total: d.total, sem: d.sem, ts: +fecha }),
       fecha]);
    const diagId = r.insertId;
    // La empresa toma nombre, rubro y moneda del diagnóstico
    await conn.query('UPDATE empresas SET nombre=COALESCE(?, nombre), sector=COALESCE(?, sector), pais=COALESCE(?, pais), tamano=COALESCE(?, tamano), moneda=COALESCE(?, moneda), ultimo_score=?, ultimo_semaforo=? WHERE id=?',
      [txt(s1.nombreEmpresa, 200), txt(s1.sector, 100), txt(s1.pais, 60), txt(s1.tamano, 60), txt(d.moneda, 3), num(d.total), txt(d.sem, 20), empresaId]);
    // Acción recomendada en este período; las de períodos anteriores quedan ligadas a este como "período siguiente"
    if (cat) {
      await conn.query(`INSERT INTO acciones_empresa (empresa_id, accion_codigo, periodo_id, diagnostico_id) VALUES (?,?,?,?)
                        ON DUPLICATE KEY UPDATE diagnostico_id=VALUES(diagnostico_id)`, [empresaId, cat.codigo, pid, diagId]);
    }
    await conn.query(
      `UPDATE acciones_empresa ae JOIN periodos p ON p.id = ae.periodo_id JOIN periodos pn ON pn.id = ?
          SET ae.periodo_siguiente_id = pn.id
        WHERE ae.empresa_id = ? AND ae.periodo_siguiente_id IS NULL AND (p.anio * 12 + p.mes) < (pn.anio * 12 + pn.mes)`, [pid, empresaId]);
    const [[c]] = await conn.query('SELECT COUNT(*) AS n FROM diagnosticos WHERE empresa_id=?', [empresaId]);
    await conn.commit();
    return { id: diagId, periodo_id: pid, total: c.n };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
async function contarDiagnosticos(empresaId) {
  const [[c]] = await pool().query('SELECT COUNT(*) AS n FROM diagnosticos WHERE empresa_id=?', [empresaId]);
  return c.n;
}
function armarDiag(f) {
  const datos = typeof f.datos === 'string' ? JSON.parse(f.datos) : (f.datos || {});
  return { id: f.diag_ref, total: num(f.score), sem: f.semaforo, riesgo: f.riesgo, accion_codigo: f.accion_codigo, creado: f.creado, ...datos };
}
async function ultimoDiagnostico(empresaId) {
  const [[f]] = await pool().query('SELECT * FROM diagnosticos WHERE empresa_id=? ORDER BY creado DESC, id DESC LIMIT 1', [empresaId]);
  return f ? armarDiag(f) : null;
}
async function historial(empresaId) {
  const [filas] = await pool().query(
    `SELECT d.diag_ref, d.score, d.semaforo, d.riesgo, d.accion_codigo, d.creado, d.datos, a.titulo AS accion
       FROM diagnosticos d LEFT JOIN acciones_catalogo a ON a.codigo = d.accion_codigo
      WHERE d.empresa_id=? ORDER BY d.creado`, [empresaId]);
  return filas.map(f => {
    const x = armarDiag(f); const e = x.ecoData || {};
    return { id: x.id, ts: x.ts || +new Date(f.creado), total: x.total, sem: x.sem, riesgo: x.riesgo, accion: f.accion || null,
      eco: e.score, gest: x.gestScore, cobertura: e.cobertura, caja: e.meses_caja, margen: e.margen,
      ventas: num(x.step1?.ventas), costos: num(x.step1?.costos) };
  });
}

module.exports = {
  hash, crearLinkIngreso, pedidosRecientes, usarLinkIngreso, usuarioPorEmail, empresasDelUsuario, empresaDelUsuario, crearEmpresa,
  planDeEmpresa, crearSesion, leerSesion, cerrarSesion, elegirEmpresaSesion, guardarDiagnostico, contarDiagnosticos,
  ultimoDiagnostico, historial, pool,
};
