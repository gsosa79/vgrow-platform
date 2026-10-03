// Posibles duplicados: empresas que podrían ser la misma. Solo marca; para unirlas está deploy/unir.sh.
// Criterios:
//   - Nombres parecidos: iguales sin tildes, mayúsculas, signos ni "S.A."/"SRL", o casi iguales (1 letra cada 8), o uno contiene al otro.
//     Si los números del nombre son distintos, no son parecidos ("Sucursal 1" y "Sucursal 2").
//     "Mi empresa" (el nombre que trae toda cuenta nueva) no cuenta.
//   - Mismo email, en empresas de organizaciones distintas (por ejemplo, la del registro de antes del login y la de la cuenta).
//   - Mismo dominio de email, en organizaciones distintas, salvo los dominios públicos (gmail, hotmail, outlook, etc.).
// Dos empresas de la misma organización con el mismo email son normales (una cuenta puede tener varias empresas): no se marcan por el email.
const cuentas = require('./cuentas');

const MAXIMO = 3000; // empresas revisadas (las de actividad más reciente)
const PUBLICOS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|zoho|yandex|mail|adinet|montevideo|vera|netgate)\./;
const LEGALES = new Set(['sa', 'srl', 'sas', 'ltda', 'sociedad', 'anonima', 'limitada', 'responsabilidad', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'cia', 'hnos']);
const GENERICOS = new Set(['', 'mi empresa', 'empresa', 'sin nombre']);

// "Panadería La Esquina S.R.L." → "panaderia esquina"
function clave(nombre) {
  const base = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bs\.?\s?r\.?\s?l\.?(?=\s|$)/g, ' srl ').replace(/\bs\.?\s?a\.?\s?s\.?(?=\s|$)/g, ' sas ').replace(/\bs\.?\s?a\.?(?=\s|$)/g, ' sa ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const k = base.split(' ').filter(t => !LEGALES.has(t)).join(' ');
  return GENERICOS.has(base) || GENERICOS.has(k) ? '' : k;
}
const dominio = email => { const d = String(email || '').toLowerCase().split('@')[1] || ''; return d && !PUBLICOS.test(d) ? d : ''; };

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > Math.ceil(Math.max(a.length, b.length) / 8)) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function nombresParecidos(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  // Si los números del nombre no coinciden, son distintas ("Farmacia Pocitos 1" y "Farmacia Pocitos 2")
  if ((a.match(/\d+/g) || []).join(' ') !== (b.match(/\d+/g) || []).join(' ')) return false;
  if (Math.min(a.length, b.length) >= 5 && distancia(a, b) <= Math.floor(Math.max(a.length, b.length) / 8)) return true;
  // Uno contiene al otro, palabra por palabra, si el más corto tiene al menos 2 palabras ("kiosco sol" y "kiosco sol centro")
  const [c, l] = a.length <= b.length ? [a, b] : [b, a];
  const tc = c.split(' '), tl = new Set(l.split(' '));
  return tc.length >= 2 && tc.every(t => tl.has(t));
}

function agrupar(empresas) {
  const padre = new Map(empresas.map(e => [e.id, e.id]));
  const raiz = x => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
  const motivos = new Map(); // raíz → Set de motivos (se juntan al final)
  const aristas = [];
  const unir = (a, b, motivo) => { aristas.push([a.id, b.id, motivo]); padre.set(raiz(a.id), raiz(b.id)); };
  const distintaOrg = (a, b) => !a.organizacion_id || !b.organizacion_id || a.organizacion_id !== b.organizacion_id;

  for (let i = 0; i < empresas.length; i++) {
    const a = empresas[i];
    for (let j = i + 1; j < empresas.length; j++) {
      const b = empresas[j];
      if (nombresParecidos(a.clave, b.clave)) unir(a, b, `Nombres parecidos: "${a.nombre}" y "${b.nombre}"`);
      else if (distintaOrg(a, b) && a.email && a.email === b.email) unir(a, b, `Mismo email: ${a.email}`);
      else if (distintaOrg(a, b) && a.dominio && a.dominio === b.dominio) unir(a, b, `Mismo dominio de email: ${a.dominio}`);
    }
  }
  for (const [x, , m] of aristas) { const r = raiz(x); if (!motivos.has(r)) motivos.set(r, new Set()); motivos.get(r).add(m); }
  const grupos = new Map();
  for (const e of empresas) { const r = raiz(e.id); if (motivos.has(r)) { if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(e); } }
  const directas = new Set(aristas.map(([x, y]) => x < y ? `${x}-${y}` : `${y}-${x}`));
  const directo = (x, y) => directas.has(x < y ? `${x}-${y}` : `${y}-${x}`);
  return [...grupos.entries()].map(([r, es]) => ({ empresas: es, motivos: [...motivos.get(r)], directo }));
}

// La que conviene dejar: la que tiene cuenta, después la de más diagnósticos, después la más vieja
const orden = (a, b) => (b.con_cuenta - a.con_cuenta) || (b.diagnosticos - a.diagnosticos) || (new Date(a.creado) - new Date(b.creado)) || (a.id - b.id);

async function posiblesDuplicados() {
  const [filas] = await cuentas.pool().query(
    `SELECT e.id, e.nombre, e.email, e.organizacion_id, e.ultimo_score AS score, e.ultimo_semaforo AS semaforo, e.creado,
            e.organizacion_id IS NOT NULL AS con_cuenta, COUNT(d.id) AS diagnosticos,
            GREATEST(e.actualizado, COALESCE(MAX(d.creado), e.actualizado)) AS ultima_actividad
       FROM empresas e LEFT JOIN diagnosticos d ON d.empresa_id = e.id
      GROUP BY e.id ORDER BY ultima_actividad DESC, e.id DESC LIMIT ${MAXIMO}`);
  const empresas = filas.map(f => ({
    id: f.id, nombre: f.nombre, email: String(f.email || '').toLowerCase(), organizacion_id: f.organizacion_id,
    score: f.score === null ? null : Number(f.score), semaforo: f.semaforo, creado: f.creado, ultima_actividad: f.ultima_actividad,
    con_cuenta: f.con_cuenta ? 1 : 0, diagnosticos: Number(f.diagnosticos), clave: clave(f.nombre), dominio: dominio(f.email),
  }));
  const grupos = agrupar(empresas).map(g => {
    const es = g.empresas.sort(orden);
    const queda = es[0];
    return {
      motivos: g.motivos.slice(0, 5), mas_motivos: Math.max(0, g.motivos.length - 5), queda: queda.id,
      empresas: es.map(e => ({ id: e.id, nombre: e.nombre, email: e.email, con_cuenta: !!e.con_cuenta, diagnosticos: e.diagnosticos,
        score: e.score, semaforo: e.semaforo, creado: e.creado, ultima_actividad: e.ultima_actividad })),
      // Solo se sugiere unir las que coinciden directamente con la que queda; las otras están en el grupo por cadena
      // (por ejemplo, dos empresas de una misma cuenta que comparten dominio con otra cuenta) y hay que revisarlas a mano.
      comandos: es.slice(1).filter(e => g.directo(queda.id, e.id)).map(e => `bash deploy/unir.sh ${queda.id} ${e.id}`),
      sin_comando: es.slice(1).filter(e => !g.directo(queda.id, e.id)).map(e => e.id),
    };
  }).sort((a, b) => new Date(b.empresas.reduce((m, e) => e.ultima_actividad > m ? e.ultima_actividad : m, 0))
    - new Date(a.empresas.reduce((m, e) => e.ultima_actividad > m ? e.ultima_actividad : m, 0)));
  return { revisadas: empresas.length, maximo: MAXIMO, grupos };
}

module.exports = { posiblesDuplicados, clave, dominio, nombresParecidos, agrupar };
