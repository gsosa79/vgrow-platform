# DESIGN.md · Vgrow Platform

Este archivo define cómo se ve y cómo habla Vgrow. Cualquier cambio de diseño, hecho por una persona o por Claude, tiene que seguirlo. Si algo de acá choca con lo que pide una tarea puntual, gana la tarea, pero después se actualiza este archivo.

---

## 1. Para quién diseñamos

**Usuario principal:** el dueño o gerente de una PyME uruguaya o latinoamericana. Sabe de su negocio, no de finanzas. Entra desde el celular, muchas veces entre dos tareas.

**Usuario secundario:** el contador o consultor que acompaña a varias empresas. Entra desde la computadora y quiere ver números y comparar.

**El trabajo de la plataforma:** decirle a la persona, en menos de un minuto, cómo está su negocio y qué hacer esta semana. Todo lo demás es detalle para quien quiera profundizar.

**Referencias:** tomamos de **Linear** la calma y el orden, de **Stripe** la claridad con los números y de **Supabase** la estructura de panel oscuro con contenido claro. Lo aplicamos a alguien que no es técnico: lenguaje simple, una sola cosa importante por pantalla.

---

## 2. El elemento memorable: el semáforo

Vgrow tiene una sola cosa que se tiene que recordar: **el score con su semáforo**. Es el "diagnóstico médico" del negocio.

- Aparece grande una sola vez por pantalla (en Diagnóstico y en Mi empresa).
- Es el único lugar donde usamos color fuerte de estado a gran tamaño.
- Es el único elemento con animación propia: el anillo se completa una vez cuando termina un diagnóstico. Nada más se anima solo.

Todo lo demás acompaña en silencio: blanco, gris y el turquesa para las acciones.

---

## 3. Color

### Paleta base

| Nombre | Hex | Uso |
|---|---|---|
| Marino | `#0F1E3C` | Menú lateral, barra superior, menú inferior en celular |
| Turquesa (marca) | `#12B8C7` | Solo sobre fondo marino, en el logo y en rellenos (barras, anillos). **Nunca para texto sobre blanco** (contraste 2,4:1) |
| Turquesa acción | `#0B7C87` | Botones principales, links, texto destacado sobre blanco (contraste 4,9:1) |
| Turquesa oscuro | `#08646D` | Estado *hover* y *pressed* de botones |
| Tinta | `#16202E` | Texto principal |
| Gris texto | `#5B6778` | Texto secundario, etiquetas (contraste 5,7:1) |
| Gris borde | `#E3E7EC` | Bordes y divisores |
| Papel | `#F6F7F9` | Fondo del área de contenido |
| Blanco | `#FFFFFF` | Tarjetas, tablas, campos de formulario |

### Semáforo

| Estado | Texto / ícono | Fondo suave |
|---|---|---|
| Verde | `#18864B` | `#E8F5EE` |
| Amarillo | `#A36A00` | `#FBF3E0` |
| Naranja | `#C4531B` | `#FCEEE6` |
| Rojo | `#C93434` | `#FBEAEA` |

Los colores de semáforo están ajustados para pasar contraste AA **sobre blanco**. Texto de color va siempre dentro de una tarjeta blanca, nunca directo sobre el fondo papel.

### Reglas de color

- **Texto oscuro sobre fondo claro, texto claro sobre fondo oscuro. Siempre.** Antes de dar por terminado un componente, verificar contraste mínimo 4,5:1 para texto normal y 3:1 para números grandes.
- El turquesa es para **acciones** (lo que se puede tocar) y para la marca. No se usa para decorar.
- El violeta del plan Pro y el azul de "Mercado" se mantienen solo en sus insignias; no se extienden a otros componentes.
- Sin degradados decorativos. Si algo necesita destacarse, se destaca con tamaño y espacio, no con degradados.

---

## 4. Tipografía

**Familia única: IBM Plex Sans** (Google Fonts), pesos 400, 500, 600 y 700. Tiene un aire técnico y serio, como un informe contable bien hecho, sin ser frío. Respaldo: `-apple-system, "Segoe UI", Roboto, sans-serif`.

**Números:** siempre con `font-variant-numeric: tabular-nums;` para que las columnas de cifras queden alineadas. No usamos tipografía monoespaciada para datos ni etiquetas.

### Escala

| Rol | Tamaño / interlineado | Peso |
|---|---|---|
| Número del score | 56 / 1 | 700 |
| Título de página | 28 / 1,2 (24 en celular) | 700 |
| Título de sección | 18 / 1,3 | 600 |
| Cifra destacada (KPI) | 28 / 1,1 | 600 |
| Texto | 15 / 1,55 (16 en celular) | 400 |
| Texto secundario | 13 / 1,45 | 400 |
| Etiqueta de campo o dato | 12 / 1,3 | 500 |

- Tamaño mínimo de texto en celular: **12 px**. Nada más chico.
- Campos de formulario en celular: **16 px** (evita que el iPhone haga zoom solo).
- Largo de línea máximo en textos: unos 70 caracteres.

### Lo que no hacemos con la tipografía

- **Nada de etiquetas en MAYÚSCULAS con letras separadas** arriba de cada título ("MI EMPRESA · SCORE VGROW"). Si una sección necesita contexto, va en una línea de texto secundario debajo del título, en minúscula normal.
- Nada de resaltar una sola palabra de un título con otro color o itálica.
- Nada de cadenas de datos unidas con puntos medios ("Tecnología · Uruguay · Micro"). Se usan insignias separadas o una oración.

---

## 5. Espacio, bordes y sombras

**Escala de espacio (px):** 4, 8, 12, 16, 24, 32, 48. No se usan valores intermedios.

**Radios, según jerarquía:**
- 6 px: botones, campos, insignias.
- 10 px: tarjetas y tablas.
- 16 px: ventanas modales.

**Sombras:** casi ninguna. Las tarjetas se separan con borde `1px solid #E3E7EC`. Solo los modales y menús desplegables llevan sombra (`0 8px 24px rgba(15,30,60,.12)`).

**Tarjetas: solo cuando agrupan algo.** No todo tiene que ser una tarjeta. Un bloque de texto explicativo va sobre el fondo papel, sin caja. Si una pantalla es una grilla de tarjetas iguales, probablemente sobra alguna.

---

## 6. Estructura de pantalla

### Computadora

```
┌──────────┬────────────────────────────────────────────┐
│          │ Barra superior: título · score · plan       │
│  Menú    ├────────────────────────────────────────────┤
│  marino  │  Título de página                           │
│  232 px  │  Una línea que explica para qué sirve       │
│          │                                             │
│          │  ┌── La respuesta ──────────────────────┐   │
│          │  │ Lo más importante de esta pantalla    │   │
│          │  └───────────────────────────────────────┘   │
│          │  Detalle (tablas, ratios, gráficos)          │
└──────────┴────────────────────────────────────────────┘
```

Ancho máximo del contenido: 1120 px, alineado a la izquierda.

### Celular (menos de 768 px)

```
┌──────────────────────────┐
│ V  Título      [Modo]    │  ← barra marina, 2 líneas máximo
│ [Plan: Free | $19 | $29] │
├──────────────────────────┤
│ La respuesta primero     │
│ Detalle en una columna   │
│ …                        │
├──────────────────────────┤
│ ⌂   🔍   ▦   ✓   ▣       │  ← menú inferior, 5 accesos
└──────────────────────────┘
```

**Regla de oro de cada pantalla: la respuesta primero.** Lo primero que se ve contesta la pregunta de esa sección ("¿cómo está mi negocio?", "¿qué hago esta semana?"). Las explicaciones, tablas y ratios van después.

---

## 7. Componentes

### Botones

| Tipo | Estilo | Cuándo |
|---|---|---|
| Principal | Fondo turquesa acción, texto blanco, 600 | Una sola acción principal por pantalla |
| Secundario | Borde gris, fondo blanco, texto tinta | Acciones alternativas |
| Texto | Sin fondo, texto turquesa acción | Acciones menores, "Ver más" |
| Peligro | Borde y texto rojo | Borrar, cancelar plan |

- Alto mínimo 44 px en celular (área de toque).
- El texto dice exactamente lo que pasa: "Guardar diagnóstico", "Ver plan de acción". No "Enviar", no "Continuar" si se puede ser más preciso.
- **Sin flecha "→" al final del texto.** La flecha solo aparece si el botón lleva a otra pantalla y el diseño lo necesita, y va como ícono aparte.

### Cifras destacadas (KPI)

```
Punto de equilibrio            ← etiqueta, 12 px, gris
$ 225.000                      ← cifra, 28 px, tinta, tabular
Vendés $ 75.000 por encima     ← contexto, 13 px, color de estado
```

La cifra va en tinta. El color de estado solo en la línea de contexto o en una insignia. Nunca cifras en celeste claro sobre blanco.

### Tablas

- Números alineados a la derecha, con `tabular-nums`.
- Filas de 44 px, divisor gris entre filas, sin rayado de colores alternados.
- **Celular: máximo 3 columnas.** Si la tabla tiene más, se transforma en lista de tarjetas (una por fila) o se oculta la columna menos importante.
- Encabezados en texto secundario normal, sin mayúsculas forzadas.

### Insignias de semáforo

Fondo suave + texto en tinta (`#16202E`) + un punto de 8 px del color del estado. Texto: "Verde", "Amarillo", "Naranja", "Rojo". Radio 6 px, texto 13 px, peso 600.

El texto no va en el color del semáforo: sobre su propio fondo suave da entre 4,0:1 y 4,5:1 y no pasa el mínimo de 4,5:1 (sección 10). El estado lo marcan el fondo suave y el punto.

### Formularios

- Campos blancos con borde `#CBD5E1`, foco con borde turquesa acción y anillo suave.
- La etiqueta va arriba del campo, nunca solo como texto de ejemplo adentro.
- Los errores aparecen debajo del campo, en rojo, diciendo qué pasó y cómo arreglarlo: "Ese email parece tener un error de tipeo. ¿Quisiste decir @gmail.com?".

### Menú inferior (celular)

5 accesos: Inicio, Diagnóstico, Mi empresa, Mi semana, Planificación. Íconos de línea (no emojis), 24 px, texto 11 px. Activo: turquesa marca con rayita arriba.

### Íconos

Íconos de línea de un mismo set (trazo 1,75). **No usar emojis en la interfaz**: se ven distinto en cada celular y restan seriedad. Los emojis se reemplazan de a poco, empezando por los más visibles.

### Pantallas vacías y bloqueos de plan

- Vacía: una oración que dice qué falta y un botón para hacerlo. "Todavía no hiciste un diagnóstico. Tarda 5 minutos." + [Hacer diagnóstico].
- Bloqueo de plan: vista previa desenfocada del contenido real + tarjeta blanca con qué se desbloquea y el precio. Fondo del bloqueo claro, no oscuro.

---

## 8. Movimiento

- Una sola animación protagonista: el anillo del score al terminar un diagnóstico (600 ms).
- Respuestas a acciones del usuario: sí (abrir, cerrar, confirmar), cortas (150–200 ms).
- Sin animaciones de entrada en cada sección ni efectos al pasar el mouse sobre cada tarjeta.
- Respetar `prefers-reduced-motion`: si el usuario lo pide, nada se anima.

---

## 9. Cómo habla Vgrow

**Voz:** una contadora de confianza que te explica tu negocio con claridad y sin rodeos. Cercana, rioplatense, con voseo, sin exagerar el tono informal.

**Reglas:**
- Oraciones en minúscula normal (sentence case), también en títulos y botones.
- Primero lo que importa, después la explicación.
- Palabras del usuario, no del sistema: "lo que te queda después de pagar todo", antes que "resultado operativo neto". El término técnico puede ir al lado, entre paréntesis, para el contador.
- Oraciones cortas. Párrafos de 2 o 3 líneas.
- Sin frases de relleno ni tono de IA: nada de "en conclusión", "es esencial", "desbloqueá", "sumergite".
- Los errores no piden perdón y no son vagos: dicen qué pasó y qué hacer.

**Formato de números (Uruguay):**
- Miles con punto, decimales con coma: `$ 1.250.000`, `1,5 meses`, `40,5 %`.
- Moneda: `$` para pesos, `US$` para dólares. Si la plataforma no sabe la moneda, usar la que eligió el usuario.
- Fechas: `28 set. 2026`.

**Ejemplos:**

| Así no | Así sí |
|---|---|
| ANÁLISIS IA · VGROW | Qué está pasando en tu empresa |
| Empezar diagnóstico → | Hacer diagnóstico |
| No se pudo generar el análisis. | No pudimos generar el análisis. Probá de nuevo en un minuto. |
| Ciclo de conversión de efectivo: -24 días | Cobrás 24 días antes de lo que pagás. Eso te da aire. |

---

## 10. Accesibilidad y celular (obligatorio)

- Contraste mínimo 4,5:1 en texto; 3:1 en números grandes e íconos.
- Nada provoca desplazamiento lateral de la página en 360 px de ancho.
- Área de toque mínima 44 × 44 px.
- Foco visible con teclado en todo lo que se puede tocar.
- Imágenes e íconos que transmiten información llevan texto alternativo.
- Probar cada cambio en 390 px (iPhone) y en 1366 px (notebook) antes de publicarlo.

---

## 11. Tokens para el código

Reemplazan a las variables actuales del `index.html`. La tabla de la derecha indica a qué variable vieja corresponde cada una, para migrar sin romper nada.

```css
:root {
  /* marca */
  --marino: #0F1E3C;           /* antes: fondo de .sidebar y .topbar */
  --turquesa: #12B8C7;         /* antes: --green (solo sobre marino) */
  --turquesa-accion: #0B7C87;  /* nuevo: botones y links sobre blanco */
  --turquesa-oscuro: #08646D;

  /* superficies */
  --papel: #F6F7F9;            /* antes: --bg */
  --blanco: #FFFFFF;           /* antes: --bg2 / --bg3 dentro de .content */
  --borde: #E3E7EC;            /* antes: --border */

  /* texto */
  --tinta: #16202E;            /* antes: --text */
  --gris: #5B6778;             /* antes: --muted / --m2 */

  /* semáforo */
  --verde: #18864B;   --verde-suave: #E8F5EE;
  --amarillo: #A36A00; --amarillo-suave: #FBF3E0;
  --naranja: #C4531B; --naranja-suave: #FCEEE6;
  --rojo: #C93434;    --rojo-suave: #FBEAEA;

  /* forma */
  --r-control: 6px; --r-tarjeta: 10px; --r-modal: 16px;
  --sombra-flotante: 0 8px 24px rgba(15, 30, 60, .12);

  /* tipografía */
  --fuente: "IBM Plex Sans", -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

---

## 12. Checklist antes de publicar un cambio

- [ ] ¿Lo primero que se ve responde la pregunta de la pantalla?
- [ ] ¿Hay una sola acción principal?
- [ ] ¿Todo el texto pasa contraste? (Nada de texto oscuro sobre fondo oscuro ni turquesa claro sobre blanco.)
- [ ] ¿Se ve bien en 390 px sin moverse para los costados?
- [ ] ¿Las cifras están alineadas y con formato uruguayo?
- [ ] ¿Sin etiquetas en mayúsculas separadas, sin "→" en botones, sin emojis nuevos?
- [ ] ¿Los textos suenan a una persona y no a una IA?

---

## 13. Cómo usar este archivo con Claude

Al pedir un cambio de diseño, empezar así:

> Leé DESIGN.md y seguilo al pie de la letra. Quiero [el cambio]. Antes de tocar código, decime qué vas a cambiar y cómo cumple con el DESIGN.md. Después aplicalo, revisalo en 390 px y 1366 px, y confirmame el checklist de la sección 12.

**Orden sugerido para el rediseño**, de mayor a menor impacto:
1. Tokens y tipografía (secciones 3, 4 y 11): cambia toda la plataforma de una vez.
2. Sacar etiquetas en mayúsculas, flechas y puntos medios (secciones 4 y 7).
3. Mi empresa y Diagnóstico: "la respuesta primero" con el semáforo como protagonista.
4. Tablas en celular (máximo 3 columnas).
5. Reemplazar emojis por íconos de línea.
6. Revisión de textos con la sección 9.
