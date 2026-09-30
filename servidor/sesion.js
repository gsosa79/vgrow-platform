// Sesión: cookie "vg_sesion" httpOnly, Secure, SameSite=Lax, 30 días. Solo existe si LOGIN_HABILITADO está prendido.
const cuentas = require('./cuentas');
const { permisosDe, mesActual } = require('./planes');

const COOKIE = 'vg_sesion';
const loginHabilitado = () => ['1', 'true', 'si', 'sí', 'on'].includes(String(process.env.LOGIN_HABILITADO || '').trim().toLowerCase());
const admins = () => String(process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

function leerCookie(req, nombre) {
  const h = req.headers.cookie || '';
  for (const parte of h.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}
function ponerCookieSesion(res, token) {
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
}
function borrarCookieSesion(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// Resuelve la sesión del pedido (una vez por pedido): usuario, empresa activa, plan y permisos
async function sesionDe(req) {
  if (req._sesion !== undefined) return req._sesion;
  req._sesion = null;
  if (!loginHabilitado()) return null;
  const token = leerCookie(req, COOKIE);
  if (!token) return null;
  const s = await cuentas.leerSesion(token);
  if (!s) return null;
  let empresa = s.empresa_id ? await cuentas.empresaDelUsuario(s.usuario_id, s.empresa_id) : null;
  if (!empresa) {
    const lista = await cuentas.empresasDelUsuario(s.usuario_id);
    empresa = lista[0] || null;
    if (empresa) await cuentas.elegirEmpresaSesion(token, empresa.id);
  }
  const plan = empresa ? await cuentas.planDeEmpresa(empresa.id) : 'freemium';
  req._sesion = { token, usuario_id: s.usuario_id, email: s.email, empresa, plan, permisos: permisosDe(plan),
    admin: admins().includes(String(s.email).toLowerCase()) };
  return req._sesion;
}

// Pedidos que cambian algo: si el navegador manda Origin, tiene que ser el mismo sitio
function mismoOrigen(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origen).host === host;
  } catch { return false; }
}

module.exports = { COOKIE, loginHabilitado, leerCookie, ponerCookieSesion, borrarCookieSesion, sesionDe, mismoOrigen, mesActual };
