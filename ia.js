// Tipos de análisis con IA que usa la plataforma.
// El navegador solo manda { tipo, datos } con números y valores de listas cerradas.
// Los textos que llegan a la IA (las plantillas) viven acá, en el servidor. No se acepta texto libre.

const SECTORES = ['Tecnología y Comunicaciones', 'Comercio', 'Industria', 'Gastronomía y Turismo', 'Logística y Transporte', 'Salud',
  'Servicios Profesionales', 'Educación', 'Construcción', 'Finanzas y Seguros', 'Agro', 'Otro'];
const PAISES = ['Argentina', 'Uruguay', 'Chile', 'Paraguay', 'Bolivia', 'Perú', 'Colombia', 'México', 'Brasil', 'Otro'];
const TAMANOS = ['Micro (1-4 emp.)', 'Pequeña (5-19 emp.)', 'Mediana (20-99 emp.)', 'Grande (100+ emp.)'];
const ESTADOS = ['Empresa sólida', 'Estable con margen de mejora', 'Estable con debilidades', 'Problemas estructurales', 'Situación crítica'];
const PATRONES = { P8: 'Colapso Silencioso', P6: 'Trampa de Liquidez', P3: 'Estructura Rígida', P1: 'Crecimiento Tóxico', WARN: 'Señal de atención' };
const OBJETIVOS = { crecer: 'Crecer', rentab: 'Rentabilidad', ordenar: 'Ordenar', estabilizar: 'Estabilizar', expandir: 'Expandirse',
  socios: 'Socios', vender: 'Vender la empresa', otro: 'Otro' };
const CLIENTES = ['uno', 'pocos', 'muchos'];
const COBRO = ['contado', '30d', '60d'];
const MODELO = ['b2b', 'b2c', 'mixto'];
const NIVEL = { si: 'Alta', parcial: 'Media', no: 'Baja' };

class DatoInvalido extends Error {}

// Lectores estrictos: si el dato no cumple, se rechaza el pedido entero.
function num(d, k, min, max, opcional = false) {
  const v = d[k];
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new DatoInvalido(`Falta ${k}.`);
  }
  const n = Number(v);
  if (typeof v === 'boolean' || !Number.isFinite(n) || n < min || n > max) throw new DatoInvalido(`${k} fuera de rango.`);
  return Math.round(n * 100) / 100;
}
function lista(d, k, valores, opcional = false) {
  const v = d[k];
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new DatoInvalido(`Falta ${k}.`);
  }
  if (!valores.includes(v)) throw new DatoInvalido(`${k} no es un valor permitido.`);
  return v;
}
function soloEstasClaves(d, claves) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new DatoInvalido('Faltan los datos.');
  const sobran = Object.keys(d).filter(k => !claves.includes(k));
  if (sobran.length) throw new DatoInvalido(`Datos no permitidos: ${sobran.join(', ')}.`);
}
const pesos = n => '$' + Math.round(n);

const ESTILO = 'Escribí en español rioplatense, con vos. Directo, sin títulos, sin firma ni atribución al final.';

const TIPOS = {
  // Mi empresa → "Qué está pasando en tu empresa"
  analisis_diagnostico: {
    max_tokens: 900,
    claves: ['sector', 'pais', 'tamano', 'ventas', 'margen', 'costos', 'crecimiento', 'meses_caja', 'cobertura', 'score',
      'score_eco', 'score_gestion', 'clientes', 'cobro', 'modelo', 'deudores', 'cuota_deuda', 'independencia_operativa'],
    armar(d) {
      const x = {
        sector: lista(d, 'sector', SECTORES), pais: lista(d, 'pais', PAISES), tamano: lista(d, 'tamano', TAMANOS, true),
        ventas: num(d, 'ventas', 0, 1e11), margen: num(d, 'margen', -100, 100), costos: num(d, 'costos', 0, 1e11),
        crecimiento: num(d, 'crecimiento', -100, 1000, true), meses_caja: num(d, 'meses_caja', -1000, 1000),
        cobertura: num(d, 'cobertura', -1000, 1000), score: num(d, 'score', 0, 10), score_eco: num(d, 'score_eco', 0, 5),
        score_gestion: num(d, 'score_gestion', 0, 5), clientes: lista(d, 'clientes', CLIENTES, true),
        cobro: lista(d, 'cobro', COBRO, true), modelo: lista(d, 'modelo', MODELO, true),
        deudores: num(d, 'deudores', 0, 1e11, true), cuota_deuda: num(d, 'cuota_deuda', 0, 1e11, true),
        independencia_operativa: lista(d, 'independencia_operativa', Object.keys(NIVEL), true),
      };
      const resultado = x.ventas * (x.margen / 100) - x.costos;
      const ctx = [
        `Sector: ${x.sector}, País: ${x.pais}` + (x.tamano ? `, Tamaño: ${x.tamano}` : ''),
        `Ventas: ${pesos(x.ventas)}/mes | Margen: ${x.margen}% | Costos fijos: ${pesos(x.costos)}/mes`,
        `Resultado: ${pesos(resultado)}/mes`,
        `Meses de caja: ${x.meses_caja} | Cobertura: ${x.cobertura}x | Crecimiento: ${x.crecimiento ?? 0}%`,
        `Score: ${x.score}/10 (económico ${x.score_eco} | gestión ${x.score_gestion})`,
        `Clientes: ${x.clientes || 'sin dato'} | Cobro: ${x.cobro || 'sin dato'} | Modelo: ${x.modelo || 'sin dato'}`,
        x.deudores ? `Deudores: ${pesos(x.deudores)}` : '',
        x.cuota_deuda ? `Cuota de deuda: ${pesos(x.cuota_deuda)}/mes` : '',
        x.independencia_operativa ? `Independencia operativa: ${NIVEL[x.independencia_operativa]}` : '',
      ].filter(Boolean).join(' | ');
      return 'Sos el asistente de Vgrow. Diagnosticás negocios PyME. Estilo: senior, cercano, directo. Sin tecnicismos. Datos autodeclarados.\n\n' +
        ctx + '\n\nESTRUCTURA (seguir orden exacto, máximo 200 palabras):\n' +
        'FOTO GENERAL: Una frase que resume la consecuencia real hoy.\n' +
        'TENSION PRINCIPAL: El problema más urgente con números concretos.\n' +
        'SENSIBILIDAD: Qué pasa si las ventas caen 10-15%. Una línea.\n' +
        'ALERTAS (3 máx.): Las más relevantes. Una línea cada una con guion.\n' +
        'INDICADORES (3): Los más críticos para este perfil. Una línea cada uno.\n' +
        'Sin títulos en negrita. Terminá con punto. Sin firma.\n\n' +
        'GUARDRAIL: No atribuyas causas que no puedan demostrarse con los datos disponibles. Si detectás una desviación relevante ' +
        'pero no podés determinar su causa, indicá que debe investigarse; no la expliques como hecho. Los datos son autodeclarados ' +
        'y pueden tener imprecisión.';
    },
  },

  // Alerta temprana cuando el historial muestra un patrón de riesgo
  alerta_temprana: {
    max_tokens: 300,
    claves: ['patron', 'historial', 'sector', 'pais', 'score', 'cobertura', 'meses_caja'],
    armar(d) {
      const patron = lista(d, 'patron', Object.keys(PATRONES));
      if (!Array.isArray(d.historial) || d.historial.length < 2 || d.historial.length > 24) throw new DatoInvalido('historial inválido.');
      const hist = d.historial.map(h => {
        soloEstasClaves(h, ['score', 'cobertura', 'meses_caja']);
        return `score ${num(h, 'score', 0, 10)} cobertura ${num(h, 'cobertura', -1000, 1000)}x caja ${num(h, 'meses_caja', -1000, 1000)} meses`;
      });
      const x = { sector: lista(d, 'sector', SECTORES), pais: lista(d, 'pais', PAISES), score: num(d, 'score', 0, 10),
        cobertura: num(d, 'cobertura', -1000, 1000), meses_caja: num(d, 'meses_caja', -1000, 1000) };
      return 'Sos un sistema de alerta temprana financiera para PyMEs. Detectaste un patrón de riesgo.\n\n' +
        `Historial (${hist.length} diagnósticos, del más viejo al más nuevo): ${hist.join(' | ')}\n` +
        `Patrón detectado: ${patron} — ${PATRONES[patron]}\n` +
        `Empresa: ${x.sector}, ${x.pais}, score actual ${x.score}/10, cobertura ${x.cobertura}x, caja ${x.meses_caja} meses.\n\n` +
        'Escribí UNA alerta directa, máximo 60 palabras:\n- Qué está pasando (con los números del historial)\n' +
        '- Por qué es urgente ahora\n- Qué acción tomar esta semana\n\nSin bullets. ' + ESTILO;
    },
  },

  // Dashboard → briefing
  briefing_mercado: {
    max_tokens: 300,
    claves: ['indice_salud', 'indice_crecimiento', 'indice_riesgo', 'sector', 'score_sector', 'score', 'estado', 'cobertura', 'meses_caja'],
    armar(d) {
      const x = { salud: num(d, 'indice_salud', 0, 10), crec: num(d, 'indice_crecimiento', 0, 10), riesgo: num(d, 'indice_riesgo', 0, 10),
        sector: lista(d, 'sector', SECTORES, true), score_sector: num(d, 'score_sector', 0, 10, true),
        score: num(d, 'score', 0, 10, true), estado: lista(d, 'estado', ESTADOS, true),
        cobertura: num(d, 'cobertura', -1000, 1000, true), meses_caja: num(d, 'meses_caja', -1000, 1000, true) };
      const tieneEmpresa = x.score !== null;
      const ctx = `Índices de los datos de referencia: salud ${x.salud}/10, crecimiento ${x.crec}/10, riesgo ${x.riesgo}/10. ` +
        (x.sector ? `Sector del usuario: ${x.sector}` + (x.score_sector !== null ? ` (score promedio de referencia ${x.score_sector}/10). ` : '. ') : '') +
        (tieneEmpresa ? `Empresa del usuario: score ${x.score}/10` + (x.estado ? `, ${x.estado}` : '') +
          (x.cobertura !== null ? `, cobertura ${x.cobertura}x` : '') + (x.meses_caja !== null ? `, caja ${x.meses_caja} meses` : '') + '.' :
          'El usuario todavía no hizo el diagnóstico.');
      return 'Sos el sistema de inteligencia económica de Vgrow. Generá un briefing breve para el tablero de un empresario PyME.\n\n' +
        ctx + '\n\nEscribí 2 párrafos cortos:\n1. Qué muestran los índices de los datos de referencia (no los presentes como datos oficiales ni en tiempo real).\n2. ' +
        (tieneEmpresa ? 'Qué destacar de la situación del usuario frente a su sector.' : 'Invitá al usuario a hacer el diagnóstico para ver su posición.') +
        '\n\nMáximo 80 palabras en total. Sin bullets. ' + ESTILO;
    },
  },

  // Planificación → lectura del plan
  lectura_plan: {
    max_tokens: 450,
    claves: ['ventas', 'margen', 'costos', 'resultado', 'caja_proyectada', 'cobertura', 'inversion', 'financiamiento',
      'ventas_actual', 'margen_actual', 'costos_actual', 'resultado_actual', 'sector', 'pais', 'score', 'crecimiento', 'objetivo'],
    armar(d) {
      const x = { v: num(d, 'ventas', 0, 1e11), m: num(d, 'margen', -100, 100), c: num(d, 'costos', 0, 1e11),
        res: num(d, 'resultado', -1e11, 1e11), caja: num(d, 'caja_proyectada', -1e12, 1e12), cob: num(d, 'cobertura', -1000, 1000),
        inv: num(d, 'inversion', 0, 1e11, true), fin: num(d, 'financiamiento', 0, 1e11, true),
        va: num(d, 'ventas_actual', 0, 1e11, true), ma: num(d, 'margen_actual', -100, 100, true), ca: num(d, 'costos_actual', 0, 1e11, true),
        ra: num(d, 'resultado_actual', -1e11, 1e11, true), sector: lista(d, 'sector', SECTORES, true), pais: lista(d, 'pais', PAISES, true),
        score: num(d, 'score', 0, 10, true), crec: num(d, 'crecimiento', -100, 1000, true), obj: lista(d, 'objetivo', Object.keys(OBJETIVOS), true) };
      const ctx = `Plan proyectado: ventas ${pesos(x.v)}/mes, margen ${x.m}%, costos fijos ${pesos(x.c)}/mes. ` +
        `Resultado proyectado: ${pesos(x.res)}/mes. Caja proyectada: ${pesos(x.caja)}. Cobertura: ${x.cob}x.` +
        (x.inv ? ` Inversión: ${pesos(x.inv)}, financiamiento: ${pesos(x.fin || 0)}.` : '') +
        (x.va !== null ? ` Situación actual: ventas ${pesos(x.va)}/mes, margen ${x.ma}%, costos ${pesos(x.ca || 0)}/mes, resultado ${pesos(x.ra || 0)}/mes.` : '') +
        (x.sector ? ` Sector: ${x.sector}` + (x.pais ? `, país: ${x.pais}` : '') + (x.score !== null ? `, score actual ${x.score}/10.` : '.') : '') +
        (x.crec !== null ? ` Crecimiento proyectado: ${x.crec}%.` : '') + (x.obj ? ` Objetivo del negocio: ${OBJETIVOS[x.obj]}.` : '');
      return 'Sos un CFO experto en PyMEs de Uruguay y Argentina. Analizá este plan económico proyectado y dá una lectura clínica directa.\n\n' +
        ctx + '\n\nEscribí 3 párrafos cortos:\n1. Viabilidad real del plan: ¿es realista u optimista para el sector?\n' +
        '2. El riesgo principal del plan: qué variable es la más sensible y por qué.\n3. Qué habría que ajustar para que el plan sea más robusto.\n\n' +
        'Máximo 150 palabras. ' + ESTILO;
    },
  },
};

// Devuelve { prompt, max_tokens } o lanza DatoInvalido.
function armarPedido(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new DatoInvalido('Solicitud inválida.');
  const extra = Object.keys(cuerpo).filter(k => k !== 'tipo' && k !== 'datos');
  if (extra.length) throw new DatoInvalido('Solicitud inválida.');
  const t = TIPOS[cuerpo.tipo];
  if (!t || !Object.prototype.hasOwnProperty.call(TIPOS, cuerpo.tipo)) throw new DatoInvalido('Tipo de análisis desconocido.');
  soloEstasClaves(cuerpo.datos, t.claves);
  return { prompt: t.armar(cuerpo.datos), max_tokens: t.max_tokens };
}

module.exports = { armarPedido, DatoInvalido, TIPOS };
