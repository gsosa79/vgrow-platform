// Qué puede usar cada empresa según su plan. Lo decide el servidor; el navegador solo muestra u oculta.
const PERMISOS = {
  freemium: { ia_mensual: 3, benchmark: false, historial: false, planificacion: false, indices: false, simulacion_completa: false, pro: false },
  basic:    { ia_mensual: null, benchmark: true, historial: true, planificacion: true, indices: true, simulacion_completa: true, pro: false },
  pro:      { ia_mensual: null, benchmark: true, historial: true, planificacion: true, indices: true, simulacion_completa: true, pro: true },
};
const PLANES = Object.keys(PERMISOS);
// Tope de análisis con IA por mes y por empresa, configurable: CUOTA_IA_FREE (3), CUOTA_IA_BASIC (20), CUOTA_IA_PRO (50)
function cuotaIA(plan) {
  const [variable, porDefecto] = { freemium: ['CUOTA_IA_FREE', 3], basic: ['CUOTA_IA_BASIC', 20], pro: ['CUOTA_IA_PRO', 50] }[plan] || ['CUOTA_IA_FREE', 3];
  const n = parseInt(process.env[variable], 10);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
}
const permisosDe = plan => { const p = PERMISOS[plan] ? plan : 'freemium'; return { ...PERMISOS[p], ia_mensual: cuotaIA(p) }; };

// Modelo de IA por plan. Freemium y el briefing usan el modelo free; los planes pagos, el modelo pago.
const modeloFree = () => process.env.ANTHROPIC_MODEL_FREE || 'claude-haiku-4-5';
const modeloPago = () => process.env.ANTHROPIC_MODEL_PAGO || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const modeloDe = plan => (plan === 'basic' || plan === 'pro') ? modeloPago() : modeloFree();

// Mes calendario de Uruguay (la cuota se renueva el día 1)
function mesActual(fecha = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit' }).formatToParts(fecha);
  return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}`;
}

module.exports = { PERMISOS, PLANES, permisosDe, cuotaIA, modeloFree, modeloPago, modeloDe, mesActual };
