# Vgrow Platform

Servidor Node.js + Express para vgrowapp.com.

- `public/index.html` — la plataforma
- `app.js` — servidor: `/api/ia` (IA: solo tipos de análisis fijos, con las plantillas en `ia.js`; 20 pedidos por hora por IP), `/api/lead` (registros), `/api/aviso` ("Avisame cuando esté disponible" de los planes pagos, en la tabla `eventos`), `/api/dataset` y `/api/benchmarks` (datos de referencia desde MySQL), `/api/salud`
- `db/datos/` — dataset de referencia (35 empresas) y benchmarks por sector; se cargan en la base con `bash deploy/cargar-datos.sh` (se puede repetir sin duplicar)
- `deploy/` — configuración de Nginx, instalación inicial y actualización automática
- `deploy/metricas.sh` — embudo, empresas activadas, segunda carga, IA por día y plan, y "Avisame" por plan y módulo (`bash deploy/metricas.sh 30` para los últimos 30 días)
- `deploy/migrar.sh` — crea las tablas de identidad y arquitectura y agrega las columnas nuevas (se puede repetir)
- `servidor/` — login y sesión, cuentas, planes, IA con cuota, comparaciones agregadas, métricas y envío de emails

Cualquier cambio que se suba a la rama `main` aparece en el sitio en menos de 5 minutos.

La clave de IA va en `.env` en el servidor (nunca en GitHub). Ver `.env.example`.

Integridad del diagnóstico: el riesgo principal y la acción prioritaria salen de una sola función (`vgRiesgo` en `public/index.html`); el diagnóstico, Mi empresa, Inicio, Mi semana y los pedidos a la IA parten de ahí. La historia ("en tu diagnóstico anterior…") solo aparece si hay un diagnóstico previo guardado (`vgDiagPrevio`), y cada comparación dice con qué grupo se compara, cuántas observaciones tiene y qué filtros respetó (`vgFuente`).

Modo demo: agregando `?demo=1` a la dirección aparecen los selectores de plan (Freemium / Basic / Pro) y de vista (Empresario / Completo), y los módulos internos (Leads, Base de datos, Marketplace, Inteligencia y VBE). Sin eso, todos ven Freemium y la vista Empresario. Los módulos de los planes pagos para el empresario (Benchmark, Historial y alertas, Planificación e Índices económicos) aparecen en el menú con candado, en la sección "Con plan Basic o Pro", y abren su pantalla de bloqueo. Simulación es gratis con un escenario; guardar, comparar y seguir escenarios es de Basic.

## Identidad y login (apagado por defecto)

Con `LOGIN_HABILITADO` apagado (o sin definir) la plataforma funciona como siempre: sin cuentas y con la IA limitada a 20 pedidos por hora por IP.

Al prenderlo:
- Ingreso con link mágico por email (vence a los 15 minutos, sirve una vez). Sesión en cookie `httpOnly`, `Secure`, de 30 días.
- Modelo de datos: `usuarios` → `miembros` (rol dueño o contador) → `organizaciones` → `empresas` → `periodos` → `diagnosticos`, más `acciones_catalogo`, `acciones_empresa` y `suscripciones` (todas arrancan en Freemium; `proveedor_pago` queda vacío).
- El servidor decide qué puede usar cada empresa según su plan (`servidor/planes.js`) y la API lo controla.
- IA: sin sesión no hay; con sesión, cuota por empresa (Freemium: 3 análisis por mes). La explicación queda guardada y solo se regenera si cambian los números. El briefing del mercado se genera una vez por día para todos con el modelo free.
- Al iniciar sesión, el diagnóstico guardado en el navegador (`last_diag`) pasa a ser el primero de la empresa.

Variables del `.env`:

| Variable | Para qué | Por defecto |
|---|---|---|
| `LOGIN_HABILITADO` | `1` prende el login | apagado |
| `BASE_URL` | dirección pública para armar el link del email, p. ej. `https://vgrowapp.com` | la del pedido |
| `EMAIL_MODO` | `prueba` escribe el email en el log y en `data/emails.log`; `ses` lo manda por Amazon SES | `prueba` |
| `EMAIL_REMITENTE`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | datos de Amazon SES | — |
| `ANTHROPIC_MODEL_FREE` | modelo de Freemium y del briefing | `claude-haiku-4-5` |
| `ANTHROPIC_MODEL_PAGO` | modelo de los planes pagos (y de todo, con el login apagado) | `ANTHROPIC_MODEL` o `claude-sonnet-5` |
| `ADMIN_EMAILS` | emails (separados por coma) que pueden ver `/api/metricas` y, con el login prendido, usar `?demo=1` | — |
| `CUOTA_IA_FREE`, `CUOTA_IA_BASIC`, `CUOTA_IA_PRO` | análisis con IA por mes y por empresa según el plan | 3, 20 y 50 |
| `METRICAS_TOKEN` | clave para pedir `/api/metricas` desde el servidor (`Authorization: Bearer …`), 20 caracteres o más | — |

Migrar la base: `bash deploy/migrar.sh`. Métricas: `bash deploy/metricas.sh`.

Datos de referencia: la página ya no trae el dataset. `/api/dataset` devuelve solo resultados agregados y ninguna comparación con menos de 5 empresas; con `?demo=1` devuelve el dataset completo para los módulos de demostración (con el login prendido, solo a administradores). Cuando un grupo no llega a 5 empresas, la pantalla lo dice en lugar de esconder la sección.
