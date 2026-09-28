# Vgrow Platform

Servidor Node.js + Express para vgrowapp.com.

- `public/index.html` — la plataforma
- `app.js` — servidor: `/api/ia` (IA con clave en el servidor), `/api/lead` (registros), `/api/salud`
- `deploy/` — configuración de Nginx, instalación inicial y actualización automática

Cualquier cambio que se suba a la rama `main` aparece en el sitio en menos de 5 minutos.

La clave de IA va en `.env` en el servidor (nunca en GitHub). Ver `.env.example`.
