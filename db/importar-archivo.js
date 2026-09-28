// Pasa a la base de datos los registros que se guardaron en data/leads.jsonl antes de tener MySQL.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { guardarLead, conectar } = require('./db');
(async () => {
  const f = path.join(__dirname, '..', 'data', 'leads.jsonl');
  if (!fs.existsSync(f)) { console.log('No hay registros previos para importar.'); process.exit(0); }
  const lineas = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  let ok = 0;
  for (const l of lineas) { try { const d = JSON.parse(l); if (await guardarLead(d, d.ip)) ok++; } catch (e) { console.error('fila omitida:', e.message); } }
  console.log(`Importados ${ok} de ${lineas.length} registros.`);
  await conectar().end(); process.exit(0);
})();
