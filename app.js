// Vgrow Platform · servidor
// Sirve la plataforma (public/index.html) y expone:
//   POST /api/ia    → análisis con IA: solo tipos fijos con plantilla en el servidor (ia.js), clave en .env
//   POST /api/lead  → guarda empresa + email + diagnóstico en MySQL (y copia de respaldo en data/leads.jsonl)
//   POST /api/aviso → "Avisame cuando esté disponible": guarda plan y módulo en la tabla eventos
//   GET  /api/salud → para chequear que el servidor responde
//   GET  /api/dataset    → dataset de referencia (empresas anónimas) desde MySQL
//   GET  /api/benchmarks → referencias por sector desde MySQL
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db/db');
const { armarPedido, DatoInvalido } = require('./ia');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // detrás de Nginx
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'text/plain', limit: '1mb' }));

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

app.get('/api/salud', async (req, res) => res.json({ ok: true, ia: Boolean(API_KEY), db: await db.salud(), hora: new Date().toISOString() }));

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
app.get('/api/dataset', datosCacheados('el dataset', db.leerDataset, 'empresas'));
app.get('/api/benchmarks', datosCacheados('los benchmarks', db.leerBenchmarks, 'sectores'));

// IA: solo tipos de análisis conocidos, con la plantilla armada acá (ver ia.js).
// Límite: 20 pedidos por hora por IP. max_tokens lo fija cada tipo, no el navegador.
app.post('/api/ia', limitador(20, 60 * 60 * 1000), async (req, res) => {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch { b = null; } }
  let pedido;
  try {
    pedido = armarPedido(b);
  } catch (e) {
    if (e instanceof DatoInvalido) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!API_KEY) return res.status(503).json({ error: 'La IA no está configurada en el servidor.' });
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 25000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: pedido.max_tokens, messages: [{ role: 'user', content: pedido.prompt }] }),
      signal: corte.signal,
    });
    const datos = await r.json();
    if (!r.ok) {
      console.error('[IA] error', r.status, datos?.error?.message);
      return res.status(502).json({ error: 'La IA no pudo responder.' });
    }
    const texto = (datos.content || []).filter(x => x.type === 'text').map(x => x.text).join('').trim();
    res.json({ texto });
  } catch (e) {
    console.error('[IA] fallo de red', e.message);
    res.status(502).json({ error: 'No se pudo contactar a la IA.' });
  } finally {
    clearTimeout(reloj);
  }
});

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

// Un cuerpo mal armado (JSON roto) responde un error corto, sin mostrar detalles del servidor
app.use('/api', (err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal armados.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiados datos.' });
  next(err);
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`Vgrow escuchando en http://127.0.0.1:${PORT}`));
