// Preguntas en la consola para los scripts de administración (deploy/borrar.sh, deploy/unir.sh).
// Lee línea por línea de la entrada; si la entrada se termina, la respuesta es null (el script cancela).
const readline = require('readline');

let rl = null, lineas = [], esperando = null, cerrada = false;
function abrir() {
  if (rl) return;
  rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', l => { if (esperando) { const r = esperando; esperando = null; r(l); } else lineas.push(l); });
  rl.on('close', () => { cerrada = true; if (esperando) { const r = esperando; esperando = null; r(null); } });
}
function preguntar(texto) {
  abrir();
  process.stdout.write(texto);
  if (lineas.length) { const l = lineas.shift(); process.stdout.write(l + '\n'); return Promise.resolve(l); }
  if (cerrada) { process.stdout.write('\n'); return Promise.resolve(null); }
  return new Promise(r => { esperando = l => { if (!process.stdin.isTTY && l !== null) process.stdout.write(l + '\n'); r(l); }; });
}
function cerrar() { if (rl) rl.close(); }

// Quién corrió el script (usuario del sistema), para el registro
function quien() {
  let u = process.env.SUDO_USER || process.env.USER || process.env.LOGNAME;
  if (!u) try { u = require('os').userInfo().username; } catch { u = null; }
  return u ? String(u).slice(0, 60) : null;
}

module.exports = { preguntar, cerrar, quien };
