# Vgrow Platform

Servidor Node.js + Express para vgrowapp.com.

- `public/index.html` — la plataforma
- `app.js` — servidor: `/api/ia` (IA: solo tipos de análisis fijos, con las plantillas en `ia.js`; 20 pedidos por hora por IP), `/api/lead` (registros), `/api/dataset` y `/api/benchmarks` (datos de referencia desde MySQL), `/api/salud`
- `db/datos/` — dataset de referencia (35 empresas) y benchmarks por sector; se cargan en la base con `bash deploy/cargar-datos.sh` (se puede repetir sin duplicar)
- `deploy/` — configuración de Nginx, instalación inicial y actualización automática

Cualquier cambio que se suba a la rama `main` aparece en el sitio en menos de 5 minutos.

La clave de IA va en `.env` en el servidor (nunca en GitHub). Ver `.env.example`.

Modo demo: agregando `?demo=1` a la dirección aparecen los selectores de plan (Freemium / Basic / Pro) y de vista (Empresario / Completo), y los módulos internos (Leads, Base de datos, Marketplace, Inteligencia y VBE). Sin eso, todos ven Freemium y la vista Empresario.
