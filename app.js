// Vgrow Platform · servidor
// Sirve la plataforma (public/index.html) y expone:
//   POST /api/ia    → análisis con IA: solo tipos fijos con plantilla en el servidor (ia.js), clave en .env
//   POST /api/lead  → guarda empresa + email + diagnóstico en MySQL (y copia de respaldo en data/leads.jsonl)
//   POST /api/aviso → "Avisame cuando esté disponible": guarda plan y módulo en la tabla eventos
//   GET  /api/salud → para chequear que el servidor responde
//   GET  /api/dataset    → resultados agregados de los datos de referencia (nunca registros individuales; con ?demo=1, el dataset completo)
//   POST /api/comparar   → comparaciones para un perfil (grupos de 5 empresas o más)
//   GET  /api/benchmark  → benchmark por sector, país y tamaño (plan Basic cuando el login está prendido)
//   GET  /api/benchmarks → referencias por sector desde MySQL
//   Con LOGIN_HABILITADO: /api/auth/* (link mágico), /entrar, /api/cuenta, /api/empresas/*, /api/evento, /api/metricas (administrador)
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db/db');
const { armarPedido, DatoInvalido } = require('./ia');
const { loginHabilitado, sesionDe, ponerCookieSesion, borrarCookieSesion, leerCookie, COOKIE, mismoOrigen } = require('./servidor/sesion');
const cuentas = require('./servidor/cuentas');
const { enviarEmail } = require('./servidor/correo');
const iaServ = require('./servidor/ia-servicio');
const comparar = require('./servidor/comparar');
const { metricas } = require('./servidor/metricas');
const { modeloPago, permisosDe } = require('./servidor/planes');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // detrás de Nginx
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'text/plain', limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cuerpo = req => { let d = req.body; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } } return d && typeof d === 'object' ? d : {}; };
const EMAIL_OK = e => e.length <= 200 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e);

// Límite simple por IP para que nadie gaste la cuenta de IA
function limitador(max, ventanaMs) {
  const hits = new Map();
  return (req, res, next) => {
    const ahora = Date.now();
    const k = req.ip;
    const lista = (hits.get(k) || []).filter(t => ahora - t < ventanaMs);
    if (lista.length >= max) return res.status(429).json({ error: 'Demasiadas solicitudes. Probá en unos minutos.' });
    lista.push(ahora); hits.set(k, lista); next();
  };
}

app.get('/api/salud', async (req, res) => res.json({ ok: true, ia: Boolean(API_KEY), db: await db.salud(), login: loginHabilitado(), hora: new Date().toISOString() }));

// Dataset y benchmarks: se leen de la base y se guardan 5 minutos en memoria.
// Si la base no responde, devuelven 503 y la plataforma usa los datos que trae el código.
function datosCacheados(nombre, leer, clave) {
  let cache = null, hasta = 0;
  return async (req, res) => {
    try {
      if (!cache || Date.now() > hasta) {
        const datos = await leer();
        const vacio = !datos || (Array.isArray(datos) ? !datos.length : !Object.keys(datos).length);
        if (vacio) return res.status(503).json({ error: `Sin ${nombre} en la base.` });
        cache = datos; hasta = Date.now() + 5 * 60 * 1000;
      }
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ [clave]: cache, total: Array.isArray(cache) ? cache.length : Object.keys(cache).length });
    } catch (e) {
      console.error(`[${nombre}]`, e.message);
      if (cache) return res.json({ [clave]: cache, total: Array.isArray(cache) ? cache.length : Object.keys(cache).length });
      res.status(503).json({ error: `No se pudo leer ${nombre}.` });
    }
  };
}
// Dataset: solo resultados agregados. Con ?demo=1 se puede ver completo (los módulos de demostración lo usan).
app.get('/api/dataset', a(async (req, res) => {
  if (req.query.demo === '1') {
    // Con el login prendido, el dataset completo es solo para administradores
    if (loginHabilitado()) {
      const s = await sesionDe(req);
      if (!s || !s.admin) return res.status(403).json({ error: 'El modo demo es solo para administradores.' });
    }
    const todas = await comparar.dataset();
    res.set('Cache-Control', 'private, no-store');
    return res.json({ empresas: todas, total: todas.length });
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await comparar.agregados());
}));

// Comparaciones para el perfil de una empresa (lo que muestra Mi empresa). Solo agregados de 5 empresas o más.
const SECTORES_OK = ['Tecnología y Comunicaciones', 'Comercio', 'Industria', 'Gastronomía y Turismo', 'Logística y Transporte', 'Salud',
  'Servicios Profesionales', 'Educación', 'Construcción', 'Finanzas y Seguros', 'Agro', 'Otro'];
const numEn = (v, min, max) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) || n < min || n > max ? null : n; };
app.post('/api/comparar', limitador(240, 60 * 60 * 1000), a(async (req, res) => {
  const d = cuerpo(req);
  if (!SECTORES_OK.includes(d.sector)) return res.status(400).json({ error: 'Rubro desconocido.' });
  res.json(await comparar.comparar({ sector: d.sector, pais: String(d.pais || 'Uruguay').slice(0, 40), score: numEn(d.score, 0, 10), margen_sector: numEn(d.margen_sector, 0, 100) }));
}));

// Benchmark con filtros (módulo Benchmark). Con login prendido, lo controla el plan de la empresa.
app.get('/api/benchmark', a(async (req, res) => {
  if (loginHabilitado()) {
    const s = await sesionDe(req);
    if (!s) return res.status(401).json({ error: 'Iniciá sesión para ver el benchmark.', sinSesion: true });
    if (!s.permisos.benchmark && !s.admin) return res.status(403).json({ error: 'El benchmark es parte del plan Basic.', plan: s.plan });
  }
  const { sector, pais, tamano } = req.query;
  if (sector && !SECTORES_OK.includes(sector)) return res.status(400).json({ error: 'Rubro desconocido.' });
  const ag = await comparar.agregados();
  res.json({ benchmark: sector ? await comparar.benchmark(sector, String(pais || 'Uruguay'), String(tamano || '')) : null,
    sectores: ag.sectores.map(x => ({ sector: x.sector, n: x.n, avgTot: x.avgTot })), total: ag.total, minimo: ag.minimo });
}));
app.get('/api/benchmarks', datosCacheados('los benchmarks', db.leerBenchmarks, 'sectores'));

// IA: solo tipos de análisis conocidos, con la plantilla armada acá (ver ia.js). max_tokens lo fija cada tipo.
// Login apagado: como siempre (20 pedidos por hora por IP, modelo pago). Login prendido: sin sesión no hay IA,
// cuota por empresa, respuestas guardadas y modelo según el plan (ver servidor/ia-servicio.js).
app.post('/api/ia', limitador(20, 60 * 60 * 1000), a(async (req, res) => {
  const b = cuerpo(req);
  const conLogin = loginHabilitado();
  const sesion = conLogin ? await sesionDe(req) : null;
  if (conLogin && !sesion) return res.status(401).json({ error: 'Creá tu cuenta para ver el análisis con IA.', sinSesion: true });
  let pedido;
  try {
    pedido = armarPedido(b);
  } catch (e) {
    if (e instanceof DatoInvalido) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!API_KEY) return res.status(503).json({ error: 'La IA no está configurada en el servidor.' });
  try {
    if (conLogin) {
      const r = await iaServ.pedidoConSesion(sesion, b.tipo, b.datos, pedido);
      return res.status(r.status).json(r.cuerpo);
    }
    const modelo = modeloPago();
    const texto = await iaServ.llamarClaude(pedido.prompt, pedido.max_tokens, modelo);
    if (db.conectar()) iaServ.registrarUso({ tipo: b.tipo, plan: 'sin_login', modelo }).catch(e => console.error('[ia uso]', e.message));
    res.json({ texto });
  } catch (e) {
    console.error('[IA]', e.message);
    res.status(502).json({ error: 'No se pudo contactar a la IA.' });
  }
}));

app.post('/api/lead', limitador(60, 60 * 60 * 1000), async (req, res) => {
  let d = req.body;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  const email = String(d.email || '').trim().toLowerCase();
  const empresa = String(d.empresa || '').trim();
  if (!email.includes('@') || empresa.length < 2) return res.status(400).json({ error: 'Faltan datos.' });
  const registro = { ...d, email, empresa, ip: req.ip, recibido: new Date().toISOString() };
  // Copia de respaldo en archivo (siempre)
  fs.appendFile(path.join(DATA_DIR, 'leads.jsonl'), JSON.stringify(registro) + '\n', err => { if (err) console.error('[lead archivo]', err.message); });
  try {
    await db.guardarLead(registro, req.ip);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lead db]', e.message);
    res.json({ ok: true, respaldo: true });
  }
});

// "Avisame cuando esté disponible" en las pantallas de bloqueo de los planes pagos.
// Guarda en eventos (tipo aviso_plan) el plan, el módulo y el email. Conteo: bash deploy/metricas.sh
const AVISO_PLANES = ['basic', 'pro'];
const AVISO_MODULOS = ['benchmark', 'historial', 'planificacion', 'simulacion', 'indices', 'ia', 'fpa',
  'vbe', 'dataset', 'inteligencia', 'leads', 'marketplace'];
app.post('/api/aviso', limitador(20, 60 * 60 * 1000), async (req, res) => {
  let d = req.body;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  if (!d || typeof d !== 'object') d = {};
  const plan = String(d.plan || '');
  const modulo = String(d.modulo || '');
  const email = String(d.email || '').trim().toLowerCase();
  if (!AVISO_PLANES.includes(plan) || !AVISO_MODULOS.includes(modulo)) return res.status(400).json({ error: 'Plan o módulo desconocido.' });
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return res.status(400).json({ error: 'Ingresá un email válido.' });
  const registro = { tipo: 'aviso_plan', plan, modulo, email, ip: req.ip, recibido: new Date().toISOString() };
  fs.appendFile(path.join(DATA_DIR, 'avisos.jsonl'), JSON.stringify(registro) + '\n', err => { if (err) console.error('[aviso archivo]', err.message); });
  try {
    const guardado = await db.guardarEvento('aviso_plan', email, req.ip, { plan, modulo });
    res.json(guardado ? { ok: true } : { ok: true, respaldo: true });
  } catch (e) {
    console.error('[aviso db]', e.message);
    res.json({ ok: true, respaldo: true });
  }
});

// ═══ Cuentas (solo con LOGIN_HABILITADO) ════════════════════════════════════
const soloConLogin = (req, res, next) => loginHabilitado() ? next() : res.status(404).json({ error: 'El ingreso con cuenta todavía no está habilitado.', login: false });
const conSesion = a(async (req, res, next) => {
  const s = await sesionDe(req);
  if (!s) return res.status(401).json({ error: 'Iniciá sesión.', sinSesion: true });
  req.sesion = s; next();
});
const mismoSitio = (req, res, next) => mismoOrigen(req) ? next() : res.status(403).json({ error: 'Origen no permitido.' });
const suEmpresa = a(async (req, res, next) => {
  const e = await cuentas.empresaDelUsuario(req.sesion.usuario_id, req.params.id);
  if (!e) return res.status(404).json({ error: 'No encontramos esa empresa.' });
  req.empresa = e; req.planEmpresa = await cuentas.planDeEmpresa(e.id); next();
});
const evento = (tipo, email, ip, datos) => db.guardarEvento(tipo, email, ip, datos).catch(e => console.error('[evento]', e.message));
const baseUrl = req => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

app.get('/api/cuenta', a(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!loginHabilitado()) return res.json({ login: false });
  const s = await sesionDe(req);
  if (!s) return res.json({ login: true, sesion: null });
  const e = s.empresa;
  const empresas = await cuentas.empresasDelUsuario(s.usuario_id);
  res.json({ login: true, sesion: {
    email: s.email, admin: s.admin, plan: s.plan, permisos: s.permisos,
    empresa: e ? { id: e.id, nombre: e.nombre, sector: e.sector, pais: e.pais, moneda: e.moneda, rol: e.rol } : null,
    empresas: empresas.map(x => ({ id: x.id, nombre: x.nombre, rol: x.rol })),
    cuota: e ? await iaServ.cuotaDe(e.id, s.permisos) : null,
    diagnosticos: e ? await cuentas.contarDiagnosticos(e.id) : 0,
  } });
}));

// Pedir el link mágico. Siempre responde lo mismo (no revela si el email tiene cuenta).
app.post('/api/auth/pedir', soloConLogin, mismoSitio, limitador(10, 60 * 60 * 1000), a(async (req, res) => {
  const email = String(cuerpo(req).email || '').trim().toLowerCase();
  if (!EMAIL_OK(email)) return res.status(400).json({ error: 'Ingresá un email válido.' });
  if (await cuentas.pedidosRecientes(email) < 5) {
    const token = await cuentas.crearLinkIngreso(email, req.ip);
    const link = `${baseUrl(req)}/entrar?t=${token}`;
    await enviarEmail({ para: email, asunto: 'Tu link para entrar a Vgrow',
      texto: `Hola:\n\nPara entrar a Vgrow, abrí este link:\n${link}\n\nVence en 15 minutos y sirve una sola vez. Si no lo pediste, ignorá este mensaje.\n\nVgrow`,
      html: `<p>Hola:</p><p>Para entrar a Vgrow, tocá este botón:</p><p><a href="${link}" style="display:inline-block;background:#0B7C87;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Entrar a Vgrow</a></p><p>Vence en 15 minutos y sirve una sola vez. Si no lo pediste, ignorá este mensaje.</p>` });
  }
  res.json({ ok: true, mensaje: `Te mandamos un link a ${email}. Vence en 15 minutos.` });
}));

// El link del email abre esta página; el ingreso se confirma con un botón (así los antivirus que abren links no gastan el token).
const pagina = (titulo, cuerpoHtml) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vgrow: ${titulo.toLowerCase()}</title>
<style>body{margin:0;background:#F5F6F8;font-family:'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,sans-serif;color:#16202E}main{max-width:420px;margin:12vh auto;padding:0 16px}
.c{background:#fff;border:1px solid #E3E7EC;border-radius:12px;padding:28px 24px}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{font-size:15px;line-height:1.55;color:#4A5B70;margin:0 0 20px}
button,a.b{display:block;width:100%;min-height:44px;background:#0B7C87;color:#fff;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;line-height:44px}</style></head>
<body><main><div class="c">${cuerpoHtml}</div></main></body></html>`;
app.get('/entrar', (req, res) => {
  res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'same-origin');
  if (!loginHabilitado()) return res.redirect(302, '/');
  const t = String(req.query.t || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t)) return res.status(400).send(pagina('Link inválido', '<h1>El link no es válido</h1><p>Pedí uno nuevo desde la plataforma.</p><a class="b" href="/">Ir a Vgrow</a>'));
  res.send(pagina('Entrar', `<h1>Entrar a Vgrow</h1><p>Tocá el botón para terminar de entrar.</p><form method="post" action="/api/auth/entrar"><input type="hidden" name="t" value="${t}"><button type="submit">Entrar a Vgrow</button></form>`));
});
app.post('/api/auth/entrar', soloConLogin, a(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!mismoOrigen(req)) return res.status(403).send(pagina('Link inválido', '<h1>No pudimos confirmar el ingreso</h1><p>Abrí el link desde tu email.</p><a class="b" href="/">Ir a Vgrow</a>'));
  const t = String((req.body && req.body.t) || '');
  const email = /^[A-Za-z0-9_-]{20,100}$/.test(t) ? await cuentas.usarLinkIngreso(t) : null;
  if (!email) return res.status(400).send(pagina('Link vencido', '<h1>El link venció o ya se usó</h1><p>Los links sirven una vez y vencen a los 15 minutos. Pedí uno nuevo desde la plataforma.</p><a class="b" href="/">Ir a Vgrow</a>'));
  const u = await cuentas.usuarioPorEmail(email);
  const empresas = await cuentas.empresasDelUsuario(u.id);
  const token = await cuentas.crearSesion(u.id, empresas[0] ? empresas[0].id : null);
  if (u.nuevo) evento('creo_cuenta', email, req.ip, { usuario_id: u.id, empresa_id: empresas[0] && empresas[0].id });
  ponerCookieSesion(res, token);
  res.redirect(303, '/?ingreso=1');
}));
app.post('/api/auth/salir', soloConLogin, mismoSitio, a(async (req, res) => {
  await cuentas.cerrarSesion(leerCookie(req, COOKIE));
  borrarCookieSesion(res);
  res.json({ ok: true });
}));
app.post('/api/cuenta/empresa', soloConLogin, mismoSitio, conSesion, a(async (req, res) => {
  const e = await cuentas.empresaDelUsuario(req.sesion.usuario_id, cuerpo(req).empresa_id);
  if (!e) return res.status(404).json({ error: 'No encontramos esa empresa.' });
  await cuentas.elegirEmpresaSesion(req.sesion.token, e.id);
  res.json({ ok: true, empresa: { id: e.id, nombre: e.nombre } });
}));

// Empresas de la organización (una organización puede administrar varias)
app.get('/api/empresas', soloConLogin, conSesion, a(async (req, res) => {
  res.json({ empresas: (await cuentas.empresasDelUsuario(req.sesion.usuario_id)).map(e => ({ id: e.id, nombre: e.nombre, sector: e.sector, rol: e.rol })) });
}));
app.post('/api/empresas', soloConLogin, mismoSitio, conSesion, a(async (req, res) => {
  const nombre = String(cuerpo(req).nombre || '').trim();
  if (nombre.length < 2 || nombre.length > 200) return res.status(400).json({ error: 'Poné el nombre de la empresa.' });
  const actual = req.sesion.empresa;
  const id = actual ? await cuentas.crearEmpresa(req.sesion.usuario_id, actual.organizacion_id, nombre) : null;
  if (!id) return res.status(403).json({ error: 'No podés agregar empresas a esta organización.' });
  res.json({ ok: true, id });
}));

// Diagnósticos de una empresa (siempre verificando que la empresa sea de una organización del usuario)
function diagValido(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || !d.step1 || typeof d.step1 !== 'object') return false;
  if (JSON.stringify(d).length > 60000) return false;
  const t = Number(d.total);
  return Number.isFinite(t) && t >= 0 && t <= 10 && Number(d.step1.ventas) >= 0;
}
app.get('/api/empresas/:id/ultimo', soloConLogin, conSesion, suEmpresa, a(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const h = await cuentas.historial(req.empresa.id);
  const anterior = h.length > 1 ? h[h.length - 2] : null;
  res.json({ diagnostico: await cuentas.ultimoDiagnostico(req.empresa.id),
    anterior: anterior ? { id: anterior.id, ts: anterior.ts, total: anterior.total, accion: anterior.accion } : null });
}));
app.get('/api/empresas/:id/historial', soloConLogin, conSesion, suEmpresa, a(async (req, res) => {
  if (!permisosDe(req.planEmpresa).historial) return res.status(403).json({ error: 'El historial es parte del plan Basic.', plan: req.planEmpresa });
  res.set('Cache-Control', 'no-store');
  res.json({ historial: await cuentas.historial(req.empresa.id) });
}));
app.post('/api/empresas/:id/diagnosticos', soloConLogin, mismoSitio, conSesion, suEmpresa, a(async (req, res) => {
  const d = cuerpo(req).diagnostico;
  if (!diagValido(d)) return res.status(400).json({ error: 'El diagnóstico no es válido.' });
  const r = await cuentas.guardarDiagnostico(req.empresa.id, req.sesion.usuario_id, d, 'plataforma');
  if (r.total === 2) evento('segunda_carga', req.sesion.email, req.ip, { empresa_id: req.empresa.id });
  res.json({ ok: true, id: r.id, diagnosticos: r.total });
}));
// Migración: el diagnóstico guardado en el navegador pasa a ser el primero de la empresa
app.post('/api/empresas/:id/migrar', soloConLogin, mismoSitio, conSesion, suEmpresa, a(async (req, res) => {
  const d = cuerpo(req).diagnostico;
  if (!diagValido(d)) return res.status(400).json({ error: 'El diagnóstico no es válido.' });
  if (await cuentas.contarDiagnosticos(req.empresa.id) > 0) return res.json({ ok: true, migrado: false, motivo: 'La empresa ya tiene diagnósticos.' });
  const r = await cuentas.guardarDiagnostico(req.empresa.id, req.sesion.usuario_id, d, 'migracion');
  res.json({ ok: true, migrado: true, id: r.id });
}));

// Eventos del embudo que manda el navegador (anónimos: un identificador al azar, sin datos personales)
const EVENTOS_CLIENTE = ['inicio_diagnostico', 'vio_resultado', 'volvio', 'segunda_carga'];
app.post('/api/evento', limitador(120, 60 * 60 * 1000), a(async (req, res) => {
  const d = cuerpo(req);
  if (!EVENTOS_CLIENTE.includes(d.tipo)) return res.status(400).json({ error: 'Evento desconocido.' });
  const anon = /^[a-z0-9-]{8,40}$/.test(String(d.anon || '')) ? d.anon : null;
  const s = loginHabilitado() ? await sesionDe(req) : null;
  if (db.conectar()) await evento(d.tipo, null, req.ip, { anon, empresa_id: s && s.empresa ? s.empresa.id : null });
  res.json({ ok: true });
}));

// Métricas: solo administrador (email en ADMIN_EMAILS con sesión) o, desde el servidor, con METRICAS_TOKEN
const crypto = require('crypto');
function tokenMetricasOk(req) {
  const esperado = process.env.METRICAS_TOKEN || '';
  const dado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (esperado.length < 20 || dado.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(esperado));
}
app.get('/api/metricas', a(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const s = loginHabilitado() ? await sesionDe(req) : null;
  if (!(s && s.admin) && !tokenMetricasOk(req)) return res.status(s ? 403 : 401).json({ error: 'Solo para administradores.' });
  const dias = Math.min(365, Math.max(1, parseInt(req.query.dias, 10) || 30));
  res.json(await metricas(dias));
}));

// Un cuerpo mal armado (JSON roto) responde un error corto, sin mostrar detalles del servidor
app.use('/api', (err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal armados.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiados datos.' });
  const st = err && err.status && err.status < 600 ? err.status : 500;
  if (st >= 500) console.error('[api]', err && err.message);
  res.status(st).json({ error: st === 503 ? 'Falta la base de datos.' : 'Error del servidor.' });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`Vgrow escuchando en http://127.0.0.1:${PORT}`));
