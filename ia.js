// Tipos de análisis con IA que usa la plataforma.
// El navegador solo manda { tipo, datos } con números y valores de listas cerradas.
// Los textos que llegan a la IA (las plantillas) viven acá, en el servidor. No se acepta texto libre.

const SECTORES = ['Tecnología y Comunicaciones', 'Comercio', 'Industria', 'Gastronomía y Turismo', 'Logística y Transporte', 'Salud',
  'Servicios Profesionales', 'Educación', 'Construcción', 'Finanzas y Seguros', 'Agro', 'Otro'];
const PAISES = ['Argentina', 'Uruguay', 'Chile', 'Paraguay', 'Bolivia', 'Perú', 'Colombia', 'México', 'Brasil', 'Otro'];
const TAMANOS = ['Micro (1-4 emp.)', 'Pequeña (5-19 emp.)', 'Mediana (20-99 emp.)', 'Grande (100+ emp.)'];
const ESTADOS = ['Empresa sólida', 'Estable con margen de mejora', 'Estable con debilidades', 'Problemas estructurales', 'Situación crítica'];
const PATRONES = { P8: 'Colapso silencioso', P6: 'Trampa de liquidez', P3: 'Estructura rígida', P1: 'Crecimiento tóxico', WARN: 'Señal de atención' };
const OBJETIVOS = { crecer: 'Crecer', rentab: 'Rentabilidad', ordenar: 'Ordenar', estabilizar: 'Estabilizar', expandir: 'Expandirse',
  socios: 'Socios', vender: 'Vender la empresa', otro: 'Otro' };
const CLIENTES = ['uno', 'pocos', 'muchos'];
const COBRO = ['contado', '30d', '60d'];
const MODELO = ['b2b', 'b2c', 'mixto'];
const NIVEL = { si: 'Alta', parcial: 'Media', no: 'Baja' };
const PROVEEDORES = ['contado', '30d', '60d', 'sin', 'nose'];
const PLAZO_TXT = { contado: 'al contado', '30d': 'a 30 días', '60d': 'a 60 días o más', sin: 'no tiene proveedores importantes', nose: 'no lo sabe o prefirió no contestar' };
const MONEDAS = { UYU: '$', USD: 'US$', ARS: 'AR$', CLP: 'CLP$', PYG: 'Gs.', LOC: '$' };
// Riesgo principal y acción prioritaria: los define la plataforma (vgRiesgo). La IA explica, no elige otros.
const RIESGOS = {
  perdida: 'las ventas no cubren la estructura: el mes cierra en pérdida',
  caja_critica: 'la caja cubre menos de 1,5 meses de estructura',
  holgura: 'poca holgura sobre el punto de equilibrio (cobertura menor a 1,4x)',
  caja_justa: 'la caja cubre menos de 3 meses de estructura',
  margen_bajo: 'el margen de contribución está por debajo del rango habitual del rubro',
  sin_riesgo: 'con estos números no aparece un riesgo principal',
};
const ACCIONES = {
  margen: 'mejorar el margen de contribución (precios o mix de productos)',
  ventas: 'venderles más a los clientes actuales',
  estructura: 'revisar y renegociar los costos de estructura',
  caja: 'armar un plan de caja para las próximas 12 semanas',
};
// Reglas de integridad que valen para todos los análisis
const SIN_HISTORIA = 'No menciones meses anteriores, diagnósticos previos, recomendaciones anteriores ni resultados de acciones.';
const SIN_CAUSAS = 'Nunca digas que un resultado se debe a una acción ("gracias a", "por haber", "como resultado de"). Si hablás de cambios, usá "desde…" o "después de…".';
function riesgoTxt(r, a) {
  if (!r) return '';
  return `\nRIESGO PRINCIPAL (ya definido por Vgrow, partí de acá y no propongas otro): ${RIESGOS[r]}.` +
    (a ? ` ACCIÓN PRIORITARIA (ya definida, no propongas otra): ${ACCIONES[a]}.` : '');
}

class DatoInvalido extends Error {}

// Topes de presentación (los mismos que muestra la plataforma): con datos extremos, la IA no recibe números absurdos
const txtCaja = m => (m > 24 ? 'más de 24' : m);
const txtCob = c => (c > 10 ? 'más de 10' : c);

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
// Montos con separador de miles, como en la plataforma (así la IA los repite bien: $ 2.700.000)
const miles = n => { const x = Math.round(n); return (x < 0 ? '-' : '') + String(Math.abs(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const monto = (n, m) => (MONEDAS[m] || '$') + ' ' + miles(n);
const pesos = n => monto(n, 'UYU');

const ESTILO = 'Escribí en español rioplatense, con vos. Directo, sin títulos, sin firma ni atribución al final.';

const TIPOS = {
  // Mi empresa → "Qué está pasando en tu empresa"
  analisis_diagnostico: {
    max_tokens: 900,
    claves: ['sector', 'pais', 'tamano', 'ventas', 'margen', 'costos', 'crecimiento', 'meses_caja', 'cobertura', 'score',
      'score_eco', 'score_gestion', 'clientes', 'cobro', 'modelo', 'deudores', 'cuota_deuda', 'independencia_operativa',
      'moneda', 'diagnosticos_previos', 'riesgo', 'accion', 'pago_prov'],
    armar(d) {
      const x = {
        sector: lista(d, 'sector', SECTORES), pais: lista(d, 'pais', PAISES), tamano: lista(d, 'tamano', TAMANOS, true),
        ventas: num(d, 'ventas', 0, 1e11), margen: num(d, 'margen', -100, 100), costos: num(d, 'costos', 0, 1e11),
        crecimiento: num(d, 'crecimiento', -100, 1000, true), meses_caja: num(d, 'meses_caja', -1000, 1e9),
        cobertura: num(d, 'cobertura', -1000, 1e9), score: num(d, 'score', 0, 10), score_eco: num(d, 'score_eco', 0, 5),
        score_gestion: num(d, 'score_gestion', 0, 5), clientes: lista(d, 'clientes', CLIENTES, true),
        cobro: lista(d, 'cobro', COBRO, true), modelo: lista(d, 'modelo', MODELO, true),
        deudores: num(d, 'deudores', 0, 1e11, true), cuota_deuda: num(d, 'cuota_deuda', 0, 1e11, true),
        independencia_operativa: lista(d, 'independencia_operativa', Object.keys(NIVEL), true),
        moneda: lista(d, 'moneda', Object.keys(MONEDAS), true) || 'UYU', previos: num(d, 'diagnosticos_previos', 0, 240, true) || 0,
        riesgo: lista(d, 'riesgo', Object.keys(RIESGOS), true), accion: lista(d, 'accion', Object.keys(ACCIONES), true),
        pago_prov: lista(d, 'pago_prov', PROVEEDORES, true),
      };
      const $ = n => monto(n, x.moneda);
      const resultado = x.ventas * (x.margen / 100) - x.costos;
      const ctx = [
        `Sector: ${x.sector}, País: ${x.pais}` + (x.tamano ? `, Tamaño: ${x.tamano}` : ''),
        `Ventas: ${$(x.ventas)}/mes | Margen de contribución: ${x.margen}% | Estructura (costos fijos): ${$(x.costos)}/mes`,
        `Resultado: ${$(resultado)}/mes`,
        `Meses de caja: ${txtCaja(x.meses_caja)} | Cobertura: ${txtCob(x.cobertura)}x | Crecimiento: ${x.crecimiento ?? 0}%`,
        `Score: ${x.score}/10 (económico ${x.score_eco} | gestión ${x.score_gestion})`,
        `Clientes: ${x.clientes || 'sin dato'} | Plazo de cobro que declaró: ${x.cobro ? PLAZO_TXT[x.cobro] : 'sin dato'} | Modelo: ${x.modelo || 'sin dato'}`,
        `Pago a proveedores: ${x.pago_prov ? PLAZO_TXT[x.pago_prov] : 'sin dato'}`,
        x.deudores ? `Lo que le deben hoy sus clientes: ${$(x.deudores)}` : '',
        x.cuota_deuda ? `Cuota de deuda: ${$(x.cuota_deuda)}/mes` : '',
        x.independencia_operativa ? `Independencia operativa: ${NIVEL[x.independencia_operativa]}` : '',
      ].filter(Boolean).join(' | ');
      return 'Sos el asistente de Vgrow. Diagnosticás negocios PyME. Estilo: senior, cercano, directo. Sin tecnicismos. Datos autodeclarados.\n\n' +
        ctx + '\n\nDEFINICIONES: Ventas = lo vendido en el mes, cobrado o no. Margen = margen de contribución: lo que queda de cada venta ' +
        'después de pagar el costo directo (mercadería, materiales, comisiones); no incluye sueldos fijos ni alquiler, que son estructura.' +
        riesgoTxt(x.riesgo, x.accion) + '\n\nESTRUCTURA (seguir orden exacto, máximo 200 palabras):\n' +
        'FOTO GENERAL: Una frase que resume la situación de hoy.\n' +
        (x.riesgo ? 'RIESGO PRINCIPAL: Por qué ese es el riesgo principal, con números concretos.\n' : 'TENSION PRINCIPAL: El problema más urgente con números concretos.\n') +
        'SENSIBILIDAD: Qué pasa si las ventas caen 10-15%. Una línea.\n' +
        (x.accion ? 'ACCIÓN: Cómo encarar la acción prioritaria esta semana. Dos líneas.\n' : 'ALERTAS (3 máx.): Las más relevantes. Una línea cada una con guion.\n') +
        'INDICADORES (3): Los más críticos para este perfil. Una línea cada uno.\n' +
        'Sin títulos en negrita. Terminá con punto. Sin firma.\n\n' +
        'REGLAS:\n- ' + SIN_HISTORIA + (x.previos ? ' No recibís ese historial.' : ' Es el primer diagnóstico de esta empresa.') + '\n- ' + SIN_CAUSAS + '\n' +
        '- El plazo de cobro es el que declaró el usuario, no un dato medido.' +
        (x.pago_prov && x.pago_prov !== 'nose' ? '' : ' No hay dato de pago a proveedores: no calcules el ciclo de caja ni saques conclusiones sobre el capital de trabajo.') + '\n' +
        '- No calcules ROE, ROA ni EBITDA: faltan patrimonio, activos y depreciaciones.\n' +
        '- Si un número depende de un supuesto, decí cuál es el supuesto.\n' +
        'GUARDRAIL: No atribuyas causas que no puedan demostrarse con los datos disponibles. Si detectás una desviación relevante ' +
        'pero no podés determinar su causa, indicá que debe investigarse; no la expliques como hecho. Los datos son autodeclarados ' +
        'y pueden tener imprecisión.';
    },
  },

  // Alerta temprana cuando el historial muestra un patrón de riesgo
  alerta_temprana: {
    max_tokens: 300,
    claves: ['patron', 'historial', 'sector', 'pais', 'score', 'cobertura', 'meses_caja', 'riesgo', 'accion'],
    armar(d) {
      const patron = lista(d, 'patron', Object.keys(PATRONES));
      if (!Array.isArray(d.historial) || d.historial.length < 2 || d.historial.length > 24) throw new DatoInvalido('historial inválido.');
      const hist = d.historial.map(h => {
        soloEstasClaves(h, ['score', 'cobertura', 'meses_caja']);
        return `score ${num(h, 'score', 0, 10)} cobertura ${txtCob(num(h, 'cobertura', -1000, 1e9))}x caja ${txtCaja(num(h, 'meses_caja', -1000, 1e9))} meses`;
      });
      const x = { sector: lista(d, 'sector', SECTORES), pais: lista(d, 'pais', PAISES), score: num(d, 'score', 0, 10),
        cobertura: num(d, 'cobertura', -1000, 1e9), meses_caja: num(d, 'meses_caja', -1000, 1e9),
        riesgo: lista(d, 'riesgo', Object.keys(RIESGOS), true), accion: lista(d, 'accion', Object.keys(ACCIONES), true) };
      return 'Sos un sistema de alerta temprana financiera para PyMEs. Detectaste un patrón de riesgo.\n\n' +
        `Historial (${hist.length} diagnósticos, del más viejo al más nuevo): ${hist.join(' | ')}\n` +
        `Patrón detectado: ${patron} — ${PATRONES[patron]}\n` +
        `Empresa: ${x.sector}, ${x.pais}, score actual ${x.score}/10, cobertura ${txtCob(x.cobertura)}x, caja ${txtCaja(x.meses_caja)} meses.` +
        riesgoTxt(x.riesgo, x.accion) + '\n\n' +
        'Escribí UNA alerta directa, máximo 60 palabras:\n- Qué cambió entre los diagnósticos (con los números del historial)\n' +
        '- Por qué importa ahora\n- ' + (x.accion ? 'Recordá la acción prioritaria ya definida' : 'Qué acción tomar esta semana') + '\n\n' +
        'Hablá de cambios entre diagnósticos, no de causas. ' + SIN_CAUSAS + ' Sin bullets. ' + ESTILO;
    },
  },

  // Dashboard → briefing
  briefing_mercado: {
    max_tokens: 300,
    claves: ['indice_salud', 'indice_crecimiento', 'indice_riesgo', 'sector', 'score_sector', 'score', 'estado', 'cobertura', 'meses_caja', 'riesgo'],
    armar(d) {
      const x = { salud: num(d, 'indice_salud', 0, 10), crec: num(d, 'indice_crecimiento', 0, 10), riesgo: num(d, 'indice_riesgo', 0, 10),
        sector: lista(d, 'sector', SECTORES, true), score_sector: num(d, 'score_sector', 0, 10, true),
        score: num(d, 'score', 0, 10, true), estado: lista(d, 'estado', ESTADOS, true),
        cobertura: num(d, 'cobertura', -1000, 1e9, true), meses_caja: num(d, 'meses_caja', -1000, 1e9, true),
        riesgo: lista(d, 'riesgo', Object.keys(RIESGOS), true) };
      const tieneEmpresa = x.score !== null;
      const ctx = `Índices de los datos de referencia: salud ${x.salud}/10, crecimiento ${x.crec}/10, riesgo ${x.riesgo}/10. ` +
        (x.sector ? `Sector del usuario: ${x.sector}` + (x.score_sector !== null ? ` (score promedio de referencia ${x.score_sector}/10). ` : '. ') : '') +
        (tieneEmpresa ? `Empresa del usuario: score ${x.score}/10` + (x.estado ? `, ${x.estado}` : '') +
          (x.cobertura !== null ? `, cobertura ${txtCob(x.cobertura)}x` : '') + (x.meses_caja !== null ? `, caja ${txtCaja(x.meses_caja)} meses` : '') + '.' :
          'El usuario todavía no hizo el diagnóstico.');
      return 'Sos el sistema de inteligencia económica de Vgrow. Generá un briefing breve para el tablero de un empresario PyME.\n\n' +
        ctx + '\n\nEscribí 2 párrafos cortos:\n1. Qué muestran los índices de los datos de referencia (no los presentes como datos oficiales ni en tiempo real).\n2. ' +
        (tieneEmpresa ? 'Qué destacar de la situación del usuario frente a su sector.' + (x.riesgo ? ` Partí de su riesgo principal, ya definido: ${RIESGOS[x.riesgo]}. No propongas otro riesgo ni otra acción.` : '') :
          'Invitá al usuario a hacer el diagnóstico para ver su posición.') +
        '\n\n' + SIN_HISTORIA + ' ' + SIN_CAUSAS + '\nMáximo 80 palabras en total. Sin bullets. ' + ESTILO;
    },
  },

  // Planificación → lectura del plan
  lectura_plan: {
    max_tokens: 450,
    claves: ['ventas', 'margen', 'costos', 'resultado', 'caja_proyectada', 'cobertura', 'inversion', 'financiamiento',
      'ventas_actual', 'margen_actual', 'costos_actual', 'resultado_actual', 'sector', 'pais', 'score', 'crecimiento', 'objetivo', 'riesgo', 'moneda'],
    armar(d) {
      const x = { v: num(d, 'ventas', 0, 1e11), m: num(d, 'margen', -100, 100), c: num(d, 'costos', 0, 1e11),
        res: num(d, 'resultado', -1e11, 1e11), caja: num(d, 'caja_proyectada', -1e12, 1e12), cob: num(d, 'cobertura', -1000, 1e9),
        inv: num(d, 'inversion', 0, 1e11, true), fin: num(d, 'financiamiento', 0, 1e11, true),
        va: num(d, 'ventas_actual', 0, 1e11, true), ma: num(d, 'margen_actual', -100, 100, true), ca: num(d, 'costos_actual', 0, 1e11, true),
        ra: num(d, 'resultado_actual', -1e11, 1e11, true), sector: lista(d, 'sector', SECTORES, true), pais: lista(d, 'pais', PAISES, true),
        score: num(d, 'score', 0, 10, true), crec: num(d, 'crecimiento', -100, 1000, true), obj: lista(d, 'objetivo', Object.keys(OBJETIVOS), true),
        riesgo: lista(d, 'riesgo', Object.keys(RIESGOS), true), moneda: lista(d, 'moneda', Object.keys(MONEDAS), true) || 'UYU' };
      const pesos = n => monto(n, x.moneda);
      const ctx = `Plan proyectado: ventas ${pesos(x.v)}/mes, margen de contribución ${x.m}%, estructura ${pesos(x.c)}/mes. ` +
        `Resultado proyectado: ${pesos(x.res)}/mes. Caja proyectada: ${pesos(x.caja)}. Cobertura: ${txtCob(x.cob)}x.` +
        (x.inv ? ` Inversión: ${pesos(x.inv)}, financiamiento: ${pesos(x.fin || 0)}.` : '') +
        (x.va !== null ? ` Situación actual: ventas ${pesos(x.va)}/mes, margen ${x.ma}%, costos ${pesos(x.ca || 0)}/mes, resultado ${pesos(x.ra || 0)}/mes.` : '') +
        (x.sector ? ` Sector: ${x.sector}` + (x.pais ? `, país: ${x.pais}` : '') + (x.score !== null ? `, score actual ${x.score}/10.` : '.') : '') +
        (x.crec !== null ? ` Crecimiento proyectado: ${x.crec}%.` : '') + (x.obj ? ` Objetivo del negocio: ${OBJETIVOS[x.obj]}.` : '');
      return 'Sos un CFO experto en PyMEs de Uruguay y Argentina. Analizá este plan económico proyectado y dá una lectura clínica directa.\n\n' +
        ctx + '\n\nEscribí 3 párrafos cortos:\n1. Viabilidad real del plan: ¿es realista u optimista para el sector?\n' +
        '2. El riesgo principal del plan: qué variable es la más sensible y por qué.\n3. Qué habría que ajustar para que el plan sea más robusto.\n\n' +
        (x.riesgo ? `El riesgo principal de la empresa hoy, ya definido por Vgrow, es: ${RIESGOS[x.riesgo]}. No lo contradigas.\n` : '') +
        SIN_HISTORIA + ' ' + SIN_CAUSAS + ' El plan es un escenario: presentá sus números como supuestos, no como hechos.\n' +
        'Máximo 150 palabras. ' + ESTILO;
    },
  },
};

// Briefing del mercado para todos (uno por día): solo índices de los datos de referencia, nada de un usuario.
// No se puede pedir desde el navegador: lo arma el servidor.
function armarBriefingGeneral(ind) {
  const x = { salud: num(ind, 'iSalud', 0, 10), crec: num(ind, 'iCrec', 0, 10), riesgo: num(ind, 'iRiesgo', 0, 10), n: num(ind, 'n', 0, 1e6) };
  return { max_tokens: TIPOS.briefing_mercado.max_tokens, prompt:
    'Sos el sistema de inteligencia económica de Vgrow. Generá un briefing breve para el tablero de empresarios PyME.\n\n' +
    `Índices de los datos de referencia de Vgrow (${x.n} empresas): salud ${x.salud}/10, crecimiento ${x.crec}/10, riesgo ${x.riesgo}/10.\n\n` +
    'Escribí 2 párrafos cortos sobre qué muestran esos índices. No los presentes como datos oficiales ni en tiempo real, ' +
    'no hables de ninguna empresa en particular y no inventes cifras que no estén arriba.\n' +
    SIN_HISTORIA + ' ' + SIN_CAUSAS + '\nMáximo 80 palabras en total. Sin bullets. ' + ESTILO };
}

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

module.exports = { armarPedido, armarBriefingGeneral, DatoInvalido, TIPOS, RIESGOS, ACCIONES };
