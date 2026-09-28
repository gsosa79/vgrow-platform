// Vgrow Platform · servidor
// Sirve la plataforma (public/index.html) y expone:
//   POST /api/ia    → llama a la IA de Anthropic con la clave guardada en el servidor (.env)
//   POST /api/lead  → guarda empresa + email + diagnóstico en MySQL (y copia de respaldo en data/leads.jsonl)
//   GET  /api/salud → para chequear que el servidor responde
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db/db');

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

app.post('/api/ia', limitador(30, 60 * 60 * 1000), async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'La IA no está configurada en el servidor.' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!Array.isArray(b.messages) || !b.messages.length) return res.status(400).json({ error: 'Solicitud inválida.' });
  const cuerpo = {
    model: MODEL,
    max_tokens: Math.min(Number(b.max_tokens) || 800, 1500),
    messages: b.messages,
  };
  if (typeof b.system === 'string') cuerpo.system = b.system;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json();
    if (!r.ok) console.error('[IA] error', r.status, datos?.error?.message);
    res.status(r.status).json(datos);
  } catch (e) {
    console.error('[IA] fallo de red', e.message);
    res.status(502).json({ error: 'No se pudo contactar a la IA.' });
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

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`Vgrow escuchando en http://127.0.0.1:${PORT}`));
