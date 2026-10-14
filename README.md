# VANCE — Espacio de estudio con memoria

VANCE une en una sola plataforma **libros**, **apuntes** y **memoria**: cuadernos con un editor tipo procesador de textos, libros verificados, contraste de apuntes con las fuentes y entrenamiento de **recuerdo activo**:

> Subir contenido → verificar información → organizar conocimiento → entrenar la recuperación → detectar errores → corregir conceptos → repetir de manera inteligente → medir la retención a largo plazo.

No es un generador de cuestionarios. El núcleo son actividades en las que hay que **recuperar de memoria** (explicar, reconstruir procesos, completar lo que falta, predecir, resolver casos nuevos) antes de ver la respuesta, con corrección adaptativa por niveles de pista y un motor de repetición espaciada propio.

---

## Puesta en marcha

Requisitos: **Node.js ≥ 22.9** y **PostgreSQL ≥ 14**.

```bash
# 1. Dependencias
npm install

# 2. Base de datos (opción A: Docker)
docker compose up -d          # crea el rol "vance" (sin superusuario) y las BD vance y vance_test
#    (opción B: un PostgreSQL existente) ejecuta scripts/init-db.sql como superusuario

# 3. Configuración
cp .env.example .env          # rellena ANTHROPIC_API_KEY para activar la IA

# 4. Migraciones (+ datos de demostración opcionales)
npm run db:migrate
npm run db:seed-demo          # crea demo@vance.local / demo-vance-2026 con una biblioteca DEMO

# 5. Ejecutar
npm run dev                   # http://localhost:3000 (con RUN_WORKER_IN_WEB=true procesa la cola también)
# Producción:
npm run build && npm start    # y, con RUN_WORKER_IN_WEB=false, en otro proceso: npm run worker
```

> **Importante (seguridad):** conecta la app con un rol de PostgreSQL que **no** sea superusuario ni tenga `BYPASSRLS`; de lo contrario PostgreSQL ignora las políticas Row Level Security. La app lo comprueba al arrancar y lo indica en `GET /api/health` (`"rls": true`).

### Pruebas

```bash
npm run typecheck
npm test              # pruebas unitarias + de integración (usa TEST_DATABASE_URL; la vacía y migra)
npm run build && npm run test:e2e   # E2E con Playwright: escritorio, iPad (vertical/horizontal) y móvil
```

### Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Las claves nunca llegan al navegador: toda llamada a la IA se hace desde el servidor.

| Variable | Para qué |
|---|---|
| `DATABASE_URL` / `TEST_DATABASE_URL` | PostgreSQL de la app y de las pruebas |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | Proveedor de IA (Claude). Por defecto `claude-opus-5-5` |
| `AI_DAILY_TOKEN_BUDGET_PER_USER` | Control de costes: tokens/24 h por usuario (0 = sin límite) |
| `VERIFY_WITH_WEB_SEARCH`, `VERIFY_WITH_PUBMED`, `NCBI_API_KEY` | Fuentes de verificación |
| `STORAGE_DIR`, `MAX_UPLOAD_MB`, `MAX_PAGES_PER_DOCUMENT` | Almacenamiento privado y límites |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `RETRIEVAL_PROVIDER` | Recuperación semántica en libros con Gemini File Search (opcional) |
| `SMTP_URL`, `MAIL_FROM` | Correo de recuperación de contraseña |
| `RUN_WORKER_IN_WEB`, `WORKER_CONCURRENCY` | Trabajos en segundo plano |

---

## Arquitectura

```
Next.js 15 (App Router, React 19, TypeScript)  ──  UI + API (route handlers con validación Zod)
        │
        ├── src/server/auth           sesiones propias (cookie httpOnly, scrypt, CSRF por Origin, rate limit)
        ├── src/server/documents      validación de archivos, almacenamiento privado, extracción, estructura
        ├── src/server/verification   auditoría: afirmaciones, PubMed, búsqueda web, contradicciones, revisión
        ├── src/server/knowledge      motor de conocimiento: conceptos, pasos, relaciones (solo lo validado)
        ├── src/server/activities     selección y generación de actividades (reglas + IA), trazabilidad
        ├── src/server/evaluation     evaluación determinista (reglas) y semántica (IA con rúbrica)
        ├── src/server/memory         repetición espaciada y perfil de dominio (funciones puras)
        ├── src/server/study          sesiones, pistas progresivas, máquina de estados de corrección
        ├── src/server/analytics      estadísticas del panel
        ├── src/server/jobs + worker  cola en PostgreSQL (SKIP LOCKED, reintentos con backoff)
        └── src/server/ai             único punto de llamada a la IA: presupuesto, registro de uso, reintentos
PostgreSQL 16  ──  Drizzle ORM + migraciones SQL + Row Level Security por usuario
```

**Decisiones técnicas relevantes**

- **Autenticación propia en lugar de Supabase.** Supabase exige un proyecto externo y credenciales; la autenticación propia (scrypt, sesiones con token aleatorio guardado como hash, cookie `httpOnly`+`SameSite=Lax`, comprobación de `Origin`, limitación de intentos) permite ejecutar todo localmente. Los módulos están separados para poder migrar a Supabase/Auth.js sin tocar el resto.
- **Defensa en profundidad para el aislamiento.** Cada consulta a datos de usuario pasa por `withUser()`, que fija `app.user_id` en la transacción; las políticas RLS de PostgreSQL (`FORCE ROW LEVEL SECURITY`) filtran todas las tablas de contenido. Sin usuario fijado, las consultas devuelven 0 filas. Además, la app filtra por `user_id` explícitamente.
- **Cola de trabajos en PostgreSQL** (sin Redis): `SELECT … FOR UPDATE SKIP LOCKED`, reintentos con espera exponencial, recuperación de trabajos colgados. El procesamiento es **reanudable**: si la auditoría falla a mitad, se conserva lo ya procesado.
- **La IA nunca decide sola lo que se aprende.** La auditoría solo marca como «verificada» una afirmación con al menos una fuente **comprobada en servidor**: un PMID real devuelto por PubMed o una URL devuelta realmente por la herramienta de búsqueda web. Cualquier otra referencia del modelo se descarta y se avisa.
- **La nota la calcula el servidor**, no el modelo: la IA juzga cada elemento de la rúbrica (presente/parcial/ausente/incorrecto) y el servidor aplica pesos y penalizaciones. Procesos, huecos y reconocimiento se evalúan con reglas verificables.
- **Salidas estructuradas** de Claude validadas con Zod, `fallbacks: "default"` para que una negativa de los clasificadores de seguridad se reintente en el modelo de respaldo, y un reintento si la salida no cumple el esquema.

### Modelo de datos (resumen)

`users` · `auth_sessions` · `password_reset_tokens` → `libraries` → `documents` → `sections` → `chunks` (texto original + corrección manual, página)
→ `claims` (texto original, cita literal comprobada, veredicto, categoría, propuesta, decisión, texto final, `validated`) → `claim_sources` (solo PubMed/búsqueda web) · `claim_revisions` (registro inmutable)
→ `concepts` (tipo, resumen, pasos con sus afirmaciones) ↔ `concept_claims` · `concept_relations` (con afirmaciones de respaldo)
→ `activities` (enunciado y payload visibles; `answer_key` y `rubric` solo servidor; `claim_ids` y `chunk_ids` obligatorios)
→ `study_sessions` → `session_items` (estado, nivel de pista, sin pistas) → `attempts` (fase, confianza, latencia) → `evaluations` · `hint_uses`
→ `concept_mastery` (9 dimensiones, estabilidad, dificultad, días con recuerdo independiente) · `review_logs` · `concept_errors` · `concept_confusions` · `ai_usage` · `jobs`

El esquema completo está en [`src/db/schema.ts`](src/db/schema.ts) y las migraciones en [`drizzle/`](drizzle) (`0001_rls.sql` contiene las políticas).

---

## Cuadernos y apuntes conectados

**Jerarquía:** cuaderno → sección → página (crear, renombrar, mover entre secciones y cuadernos, ordenar, duplicar y eliminar). Cada página conserva su identidad (id estable) aunque se mueva, así que sus conceptos, fuentes y actividades siguen enlazados.

**Editor** (Tiptap/ProseMirror): títulos, negrita, cursiva, subrayado, tachado, resaltado, listas numeradas, con viñetas y de tareas, tablas (añadir/eliminar filas y columnas, combinar celdas), imágenes (pegar, arrastrar o elegir; almacenamiento privado), enlaces, citas, separadores, fórmulas LaTeX con vista previa (KaTeX), deshacer/rehacer, atajos (⌘/Ctrl+B, I, U, K, F, Alt+1…), buscar y reemplazar, vista de hoja o continua, copiar y pegar con formato. Exportación real a **DOCX, PDF (fuentes Unicode incrustadas), Markdown y TXT**.

**Guardado en la nube:** automático (1,2 s tras dejar de escribir), independiente de la IA. «Guardado» solo aparece tras la confirmación del servidor. Copia local de seguridad mientras hay cambios sin confirmar, reintentos con espera creciente, guardado al cambiar de pestaña, control de versiones optimista entre dispositivos (si dos dispositivos editan a la vez se pregunta qué versión conservar), historial de versiones restaurable (instantáneas periódicas y antes de aplicar correcciones) y actualización automática al volver a una pestaña si otro dispositivo guardó.

**Adaptable:** escritorio con barra lateral y explorador del cuaderno; en el editor la navegación se reduce a un carril para dar espacio. iPad: carril de iconos y el panel del libro **junto** al editor para consultar mientras se escribe. Móvil: barra inferior de navegación (se oculta al escribir) y barra de formato inferior que se mantiene sobre el teclado. Modo claro/oscuro con selector propio. La interacción usa eventos de puntero estándar, base preparada para lápiz (Apple Pencil) en el futuro; no hay todavía escritura a mano.

### Libros + apuntes + memoria (los tres se relacionan, pero no se confunden)

| Tipo | Qué es | Cómo se guarda |
|---|---|---|
| Libro | Fuente documental | `documents`/`chunks` (página exacta); afirmaciones `source_kind = DOCUMENT` |
| Apunte | Lo que el estudiante escribió | `notebook_pages`; afirmaciones `source_kind = NOTE` con su cita literal |
| Historial | Lo que recuerda o falla | `concept_mastery`, `review_logs`, `concept_errors` (común a ambos) |

Desde una página: **Libro** (vincular libros, buscar en ellos sin salir del editor, insertar citas con su página), **Revisión** (analizar la página o «Contrastar con el libro» sobre una selección: conceptos → fragmentos del libro → comparación → errores, imprecisiones y omisiones con propuesta y referencia; aceptar, mantener o descartar sin perder el texto original; verificación externa opcional con PubMed/búsqueda web) y **Estudiar** (crear preguntas desde los apuntes, el libro o ambos; practicar la página, la sección, solo errores previos o una habilidad: reconstruir un mecanismo, explicar, completar el esquema, relacionar, resolver un caso). Las actividades guardan su origen (página o fragmento del libro) para volver a él al fallar, y sus repasos aparecen en la agenda general.

**Reutilización del motor existente:** no hay tablas paralelas. Afirmaciones, conceptos, relaciones y actividades se generalizaron (`document_id` o `page_id`), y se reutilizan la validación de fuentes, el constructor de conocimiento, el generador de actividades y sus rúbricas, la evaluación, los errores, el perfil de dominio y la repetición espaciada. El modo «El libro» reutiliza los conceptos y actividades ya validados del libro (sin coste de IA).

### Recuperación documental: Gemini File Search + búsqueda local

- **Gemini File Search** (`@google/genai`, `generateContent` con la herramienta `fileSearch`): cada usuario tiene su propio almacén, cada libro se sube una vez con el metadato `document_id` y las consultas filtran por los libros vinculados. Se leen los fragmentos recuperados (`groundingChunks[].retrievedContext`: texto, título, página) y se enlazan con el fragmento local equivalente para mostrar la página exacta. **No se envía el libro completo en cada consulta.**
- **Alternativa compatible** (siempre disponible, y respaldo si Gemini falla o no está configurado): búsqueda de texto completo de PostgreSQL (`tsvector` en español) sobre los fragmentos, sin coste y con página exacta.
- **Decisión técnica:** File Search se usa para *recuperar*; el contraste, la generación de preguntas y la evaluación siguen en el motor de IA existente, con salidas estructuradas y validación en servidor (las referencias P# solo son válidas si corresponden a un pasaje realmente recuperado). Así hay una única forma de evaluar y de validar fuentes. Nunca se muestra una página que no venga de la recuperación.

### Consumo de tokens

- El guardado nunca llama a la IA. El análisis y la creación de preguntas solo se ejecutan bajo demanda, en segundo plano.
- Un análisis de página no se repite si el contenido no ha cambiado (hash del contenido); se avisa discretamente («Contenido nuevo sin revisar») sin interrumpir.
- Caché de resultados deterministas por contenido (`ai_cache`: extracción de afirmaciones, comparación, construcción de conocimiento, generación de actividades).
- Se reutilizan las actividades existentes: solo se generan los tipos que faltan; las del libro se enlazan sin IA.
- No se generan preguntas por frase: se agrupan conceptos educativos y se descartan duplicados.
- Presupuesto diario por usuario y medición por operación (incluidos aciertos de caché) en **Ajustes → Consumo de IA**.

---

## Cómo funciona el aprendizaje

**Verificación (antes de generar nada).** Afirmaciones atómicas con cita literal (se comprueba que existe en el fragmento) → contraste con PubMed (biomédico) y búsqueda web → veredicto (respaldada, error confirmado, posible error, desactualizada, discrepancia entre fuentes, no verificable, error de extracción, contradicción interna) → informe en tres categorías: **verificada / requiere revisión / corrección propuesta**. El usuario acepta, edita o excluye; el original se conserva y cada cambio queda registrado. Solo lo validado alimenta el conocimiento.

**Actividades según la naturaleza del concepto.** Mecanismos → explicar, reconstruir, predecir, casos; procesos → reconstrucción de pasos; clasificaciones → relaciones; definiciones → recuperación libre y huecos. El reconocimiento (opción múltiple) es solo complementario: acertarlo **no programa el repaso** y obliga a recuperarlo después sin opciones.

**Corrección adaptativa.** Respuesta → evaluación con rúbrica (crédito parcial, sinónimos, ambigüedad reconocida) → pista adaptada al error (nivel 1–3; empieza más alto si el error ya se había cometido) → nuevo intento → explicación completa (nivel 4) → **nueva recuperación sin mirar** → registro del error → reprogramación. Los niveles máximos de ayuda y los reintentos son configurables.

**Memoria.** Modelo tipo FSRS (estabilidad, dificultad, R(t) = (1 + t/9S)⁻¹). La calificación combina primer intento, pistas usadas, si hizo falta la explicación, confianza declarada (detecta aciertos por casualidad) y errores recurrentes. Intervalos iniciales configurables y **calibración personal** (si recuerdas menos de lo predicho, los intervalos se acortan). Evaluaciones periódicas sin pistas, recuperación acumulativa intercalando temas.

**Dominio.** Perfil por concepto con 9 dimensiones (recuerdo sin ayuda, precisión, integridad del mecanismo, discriminación, aplicación, reconocimiento, independencia de pistas, retención demorada, corrección de errores). «Parece dominado» exige recuerdos independientes en al menos dos días, estabilidad ≥ 7 días, retención demostrada tras un intervalo y ningún error recurrente sin corregir. Se detecta la **falsa sensación de aprendizaje** (reconoce pero no recupera).

Las estadísticas muestran **rendimiento observado**; la app no afirma medir la memoria biológica, y separa el rendimiento inmediato del demostrado tras días o semanas.

---

## Estado de las funcionalidades

| Área | Estado | Notas |
|---|---|---|
| Registro, login, logout, sesiones, cambio y recuperación de contraseña | ✅ Terminado | Sin `SMTP_URL` el enlace de recuperación se escribe en el log del servidor (se indica en la UI) |
| Perfil, preferencias de aprendizaje, exportación JSON, eliminación de cuenta | ✅ Terminado | |
| Bibliotecas, subida con validación de contenido, eliminación de documentos | ✅ Terminado | Almacenamiento en disco privado; sustituible por S3/Supabase Storage |
| Extracción PDF con texto (por página), DOCX (incl. tablas), PPTX, TXT/MD | ✅ Terminado | Encabezados detectados por heurística; corrección manual de fragmentos |
| PDF escaneados e imágenes de apuntes (OCR) | 🟡 Requiere IA | OCR con visión de Claude; sin clave se informa del error. Límite práctico de páginas por petición del proveedor |
| Diagramas/figuras | 🟡 Parcial | Se avisa de las figuras no interpretadas; no se interpretan imágenes incrustadas en DOCX/PPTX |
| Auditoría científica (PubMed + búsqueda web, contradicciones, informe, decisiones, historial) | 🟡 Requiere IA | Lógica de validación de fuentes probada con IA simulada; **no se ha ejecutado contra la API real en este entorno (sin clave)** |
| Motor de conocimiento y generación de actividades abiertas | 🟡 Requiere IA | Actividades de orden, huecos y reconocimiento se generan por reglas |
| Recuerdo libre, explicación, predicción, casos, relaciones | ✅ Interfaz y flujo · 🟡 evaluación con IA | Sin IA: evaluación **provisional** por términos clave, marcada como tal y reevaluada después |
| Reconstrucción de procesos (arrastrar y soltar + teclado), huecos, reconocimiento | ✅ Terminado | Evaluación determinista en servidor |
| Respuesta oral | 🟡 Parcial | Dictado con la Web Speech API del navegador (Chrome/Edge/Safari); se evalúa el texto transcrito |
| Pistas progresivas, reintentos, explicación y recuperación posterior | ✅ Terminado | Pistas adaptativas con IA; sin IA, pistas predefinidas de la rúbrica |
| Repetición espaciada, calibración personal, sesiones diaria/documento/concepto/acumulativa, reanudación | ✅ Terminado | |
| Perfil de dominio, falsa sensación de aprendizaje, errores recurrentes, confusiones | ✅ Terminado | Confusiones detectadas por IA y por reconocimiento |
| Panel, agenda de repasos, estadísticas (inmediato vs. demorado, evolución, errores, historial, tiempo, objetivos) | ✅ Terminado | Sin datos ficticios: con 0 actividades se muestra vacío |
| Cuadernos, secciones y páginas (crear, mover, ordenar, duplicar, eliminar) | ✅ Terminado | |
| Editor enriquecido, buscar y reemplazar, fórmulas, tablas, imágenes | ✅ Terminado | Fórmulas exportadas como LaTeX en DOCX/PDF |
| Guardado en la nube, copia local, conflictos entre dispositivos, versiones | ✅ Terminado | |
| Exportación DOCX, PDF, Markdown, TXT | ✅ Terminado | WebP no se incrusta en DOCX/PDF (se indica) |
| Consultar el libro desde el editor e insertar citas | ✅ Terminado | Búsqueda local sin IA; semántica con `GEMINI_API_KEY` |
| Gemini File Search (indexación y consulta) | 🟡 Requiere `GEMINI_API_KEY` | Implementado con el SDK oficial; **no ejecutado contra la API real en este entorno** |
| Contraste de apuntes con libros y correcciones | 🟡 Requiere IA | Lógica de validación probada con IA simulada y búsqueda local real |
| Preguntas desde apuntes / libro / combinadas, sesiones por página y sección | ✅ Libro sin IA · 🟡 apuntes requieren IA | |
| «Completa el esquema» (arrastrar etiquetas a un esquema de proceso o estructura) | ✅ Terminado | Esquema generado desde los pasos validados; no se usan imágenes del libro |
| Escritura a mano con Apple Pencil | ⬜ Pendiente | La entrada por puntero ya funciona; falta un lienzo de dibujo |
| Mapas conceptuales visuales | ⬜ Pendiente | |
| Predicción de necesidades de repaso más allá del modelo actual, ajuste de dificultad fino (Fase 3) | ⬜ Pendiente | La base (calibración, dimensiones, confusiones) ya existe |

**Datos de demostración:** `npm run db:seed-demo` crea una biblioteca marcada como **DEMO** (capítulo breve de fisiología muscular). Sus afirmaciones figuran como «aprobadas, sin verificación externa» y sus actividades como `generated_by = DEMO`; no simulan un procesamiento de IA.

**Lo que necesitas configurar para el flujo completo con documentos reales:** `ANTHROPIC_API_KEY` (la verificación web tiene coste por búsqueda; desactívala con `VERIFY_WITH_WEB_SEARCH=false`), opcionalmente `NCBI_API_KEY` y `SMTP_URL`.

---

## Seguridad y privacidad

- Aislamiento por usuario con RLS + filtrado en la aplicación; recursos ajenos devuelven 404.
- Claves y rúbricas (`answer_key`, `rubric`) nunca se envían al cliente; toda evaluación ocurre en el servidor y los envíos duplicados o manipulados se rechazan.
- Validación de archivos por firma binaria, límite de tamaño y de páginas, rechazo de macros y de ZIP sospechosos, almacenamiento con nombres aleatorios fuera de `public/`.
- Protección CSRF por `Origin`, cookies `httpOnly`, cabeceras de seguridad, limitación de intentos (en memoria por proceso: en despliegues con varias réplicas, sustitúyelo por Redis).
- Derechos de autor: al subir, el usuario confirma que puede usar el material para su estudio personal; los documentos solo son visibles para su propietario.
- El contenido se envía a Anthropic para su análisis según las condiciones de su API; se informa en el registro, la subida y los ajustes.
