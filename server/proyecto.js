/**
 * Evaluación de las entregas de Proyecto de Título (pauta, sección 1.2).
 *
 * Vive aparte de index.js para no mezclar sus reglas con las de Formulación:
 * aquí están la rúbrica, las instrucciones al evaluador, los hechos
 * verificados y el armado de las tandas de revisión de PT1 y PT2.
 */
import { clasificarHojasPT2 } from '../src/lib/ptMetrics.js';
import {
  BATCH_FINDINGS_TOOL, buildCachedPrefix, chunkArray, partirHojasLargas, formatSheetsChunk,
} from './deepReview.js';

export const esProyecto = delivery => delivery === 'PT1' || delivery === 'PT2';

// ─── Rúbricas ────────────────────────────────────────────────────────────────
export function getRubricProyecto(delivery) {
  if (delivery === 'PT1') {
    return `## RÚBRICA PROYECTO DE TÍTULO · ENTREGA 1 — Pauta de Desarrollo de Proyecto de Título (UVM), sección 1.2

EN ESTA ENTREGA NO SE FILTRA POR ADMISIBILIDAD: todas las entregas se evalúan.
El estudiante continúa lo desarrollado en Formulación de Proyecto de Título: los
rendimientos parten de las cartillas APU de la Entrega 2 de esa asignatura.

### 1. Rendimientos (peso 40%, id: "rendimientos")
- Planilla Excel como la del Ejemplo 11: ITEM | ACTIVIDAD | Unidad | Cantidad |
  Rendimiento | Tiempo Exacto (días) | Tiempo Aproximado (días) | Cuadrilla Considerada.
- El rendimiento se ASIGNA AJUSTADO a la cuadrilla básica declarada en el APU y
  a los elementos auxiliares de cada caso. Los proveedores informan rendimientos
  de condiciones ideales (Ejemplo 9: una retroexcavadora que el catálogo da en
  300 m3/día, estimada por ciclos rinde 216 m3/día): el rendimiento debe ser el
  de condiciones reales de obra. Un rendimiento copiado de catálogo sin ajuste,
  o incoherente con la cuadrilla declarada, es un hallazgo.
- Siempre en UNIDAD/día: kg/día, m3/día, m2/día, ml/día, un/día.
- Tiempo exacto = Cantidad / Rendimiento.
- Tiempo aproximado: al cuarto de jornada SUPERIOR (Ejemplo 10: 3,89 → 4;
  4,13 → 4,25; 4,43 → 4,5; 4,66 → 4,75; 4,76 → 5). Es la columna que se usa en
  la Carta Gantt.
- Actividades GLOBAL: se estima su tiempo sin calcular rendimiento, pero deben
  ser las MÍNIMAS. Las actividades fuera del campo ocupacional (especialidades)
  también se estiman, porque igual se programan.

### 2. Carta Gantt (peso 60%, id: "gantt")
- Elaborada en MS PROJECT a partir de la planilla de rendimientos, entregada en
  formato MS Project y en PDF. El PDF en A0 o A1, con toda la programación
  visible en UNA sola plana.
- Todas las actividades del proyecto vinculadas según orden lógico, declarando
  también los títulos y grupos de actividades (Ejemplo 12).
- Los títulos que agrupan actividades se dibujan con BARRA HORIZONTAL NEGRA (Ejemplo 13).
- Fecha de inicio: el PRIMER DÍA HÁBIL del año siguiente al que se cursa la asignatura.
- No se fuerzan plazos: ni el plazo final ni la duración de una actividad
  particular se ajustan a lo deseado.
- Calendario laboral de lunes a viernes, 45 h semanales (9 h diarias), con los
  feriados y festivos de Chile configurados como días no laborables que se ven
  como COLUMNAS GRISES en la gráfica.
- Vínculos FC, FF, CC y CF, con adelantos o retrasos cuando corresponda
  (Ejemplo 14: «14FC+3d» = la tarea 14 es predecesora, fin a comienzo, con tres
  días de retraso; «14FC-3d» = con tres días de adelanto).
- Ruta(s) crítica(s) marcadas en ROJO, tanto las barras como los vínculos.
- Solo las actividades críticas demasiado extensas pueden partirse en varios
  frentes de trabajo (Ejemplo 15).
- Debe identificarse claramente: ítem, nombre de actividad, duración, fecha de
  inicio y término, predecesora, ruta crítica y días no laborables (Ejemplo 16).
- Las duraciones de la Gantt deben ser los tiempos aproximados de la planilla
  de rendimientos.`;
  }

  return `## RÚBRICA PROYECTO DE TÍTULO · ENTREGA 2 — Pauta de Desarrollo de Proyecto de Título (UVM), sección 1.2

EN ESTA ENTREGA NO SE FILTRA POR ADMISIBILIDAD: todas las entregas se evalúan.
El estudiante puede entregar gastos generales, presupuesto, organigramas y
cartillas en un solo libro o en varios: ambas formas son válidas.

### 1. Gastos Generales (peso 40%, id: "gastosGenerales")
- GASTOS EN OBRA (Gastos Generales DIRECTOS), en Excel, tomando como base las
  tablas de la pauta e incorporando ítems propios del proyecto: personal técnico
  y administrativo; seguridad de faenas; transporte; herramientas y materiales
  transversales; pagos de derechos (permisos municipales según la ordenanza de
  la comuna del proyecto, intereses de boletas de garantía según el Ejemplo 17,
  pólizas y seguros según los m2 del proyecto); ensayos de laboratorio; insumos.
- GASTOS EN OFICINA CENTRAL (Gastos Generales INDIRECTOS): consumos y sueldos.
- Los costos de la pauta son referenciales y desactualizados: deben ajustarse
  al proyecto. Los MESES de cada ítem se ajustan al plazo obtenido en la Carta
  Gantt de la entrega anterior; no todo ítem dura toda la obra.
- Los gastos generales declaran lo TRANSVERSAL a todo el desarrollo del
  proyecto, no lo que ya está en una partida.
- %GG = [(0,32 · GG oficina central + GG obra) / Costo Directo] · 100: la obra
  en estudio absorbe todos sus gastos directos y el 32% de los de la oficina
  central (supuesto académico de cuatro obras en paralelo). Siempre con dos
  decimales.

### 2. Presupuesto Detallado (peso 40%, id: "presupuesto")
- En Excel, como el Ejemplo 18: ITEM | ACTIVIDAD | Unidad | Cantidad | Precio
  Unitario | Total, encabezado con el nombre exacto del proyecto, VINCULANDO las
  cantidades y precios unitarios de las cartillas APU de la Entrega 2 de
  Formulación.
- Total = cantidad × precio unitario, con la FÓRMULA registrada (Nota 9).
- Cantidades con los decimales necesarios (Nota 10). Montos con símbolo $,
  separador de miles y NUNCA decimales (Nota 11, Ejemplo 19).
- Recuadro final (Ejemplo 20): Costo Directo (suma de los totales) · Gastos
  Generales (el %GG de la planilla, sobre el CD) · Utilidades (sobre el CD) ·
  Imprevistos (sobre el CD) · Costo Neto (CD + GG + U + I) · IVA 19% del costo
  neto · Total (neto + IVA) · Valor UF del día de la entrega · Valor total en UF
  (dos decimales) · Superficie del proyecto · UF/m².
- Instalaciones eximidas estimadas como porcentaje del costo directo previo a
  su adición (eléctrico 7%, climatización 6%, gases 4%), ajustadas al proyecto;
  NO incluir las que el proyecto no contempla.
- Las cartillas APU deben completarse con las celdas que quedaron pendientes en
  Formulación: IMPREVISTOS, GASTOS GENERALES, UTILIDAD y PRECIO NETO.

### 3. Organigramas (peso 20%, id: "organigramas")
- Organigrama de la empresa EN TERRENO y de la OFICINA CENTRAL, en Excel.
- Representan CARGOS, no departamentos, unidades ni áreas.
- Coherentes y cruzados con la planilla de gastos generales: cada cargo pagado
  en ella debe aparecer en el organigrama, y al revés.`;
}

// ─── Instrucciones al evaluador final ────────────────────────────────────────
export function buildSystemPromptProyecto(delivery) {
  const cruce = delivery === 'PT1'
    ? `EVALUACIÓN CRUZADA (obligatorio):
- La planilla de rendimientos debe cubrir las partidas del itemizado, con la
  cuadrilla declarada en el APU de Formulación cuando este se adjunta.
- Las duraciones de la Carta Gantt deben ser los tiempos aproximados de la
  planilla de rendimientos.`
    : `EVALUACIÓN CRUZADA (obligatorio):
- El %GG del presupuesto y de las cartillas debe ser el de la planilla de gastos generales.
- Los meses de los gastos generales deben ajustarse al plazo de la Carta Gantt.
- Los precios unitarios del presupuesto deben salir de las cartillas APU.
- Los cargos del organigrama y los de la planilla de gastos generales deben coincidir.`;

  return `Eres el docente Jonathan Fernando Muñoz Alvarez de la asignatura "Proyecto de Título", modalidad Licitación, Ingeniería en Construcción, Universidad Viña del Mar (UVM), Chile.

REGISTRO DE TONO (obligatorio en todo texto que escribas):
Redacta en VOZ IMPERSONAL con "se" (pasiva refleja), registro académico formal
chileno. Sin primera persona y sin atribuir la revisión a ninguna herramienta.
Así SÍ: "Se detecta que el tiempo aproximado de la partida 2.5 no sigue el cuarto
de jornada superior." · "En la Carta Gantt no se visualizan los días no
laborables en gris." · "Se sugiere vincular las actividades de terminaciones."
Así NO: "detecté", "revisé", "noté", "el sistema detecta", "la IA identifica".
Cuando corresponda recomendar, usa "se sugiere", "se recomienda" o "deberá".

REGLA DE VERACIDAD (la más importante — no la incumplas):
1. El bloque "HECHOS VERIFICADOS" contiene mediciones hechas directamente sobre
   los archivos: aritmética de duraciones, del presupuesto y del %GG, tamaño de
   página, fechas y vínculos leídos. Son la verdad: tu evaluación NO puede
   contradecirlos.
2. Si un archivo figura como entregado, NUNCA escribas que no fue entregado. Si
   no pudiste ver su contenido, dilo así.
3. El archivo de MS Project no se puede abrir: se revisa a través del PDF. No
   afirmes nada sobre el .mpp más allá de si se entregó.
4. No inventes partidas, valores ni fechas. Cita solo lo que aparece en los
   archivos o en los hallazgos.

${cruce}

La nota es HOLÍSTICA (no promedio matemático): los porcentajes son guía de importancia relativa.

ESCALA: 1,0 a 7,0 en pasos de 0,1. Nota mínima de aprobación: 4,0.

Cada justificación: 4-6 oraciones en voz impersonal, específica, con ejemplos
concretos (partidas, celdas, valores, fechas, páginas), en español formal chileno.

Además del detalle por criterio debes completar:
- resumen: cuadro de 6 a 12 filas con los puntos concretos verificados
- fortalezas: 2 a 4 aspectos bien logrados
- mejoras: 3 a 6 acciones concretas para la próxima entrega
Todo en voz impersonal, sin mencionar sistemas, herramientas ni IA.`;
}

// ─── Hechos verificados ──────────────────────────────────────────────────────
export function formatHechosProyecto(admissibility, payload) {
  const inv = [];
  const libro = (etiqueta, data) => {
    if (data?.sheets?.length) inv.push(`- ${etiqueta}: ENTREGADO (${data.sheets.length} hoja(s): ${data.sheets.slice(0, 8).map(s => s.name).join(', ')}${data.sheets.length > 8 ? ', …' : ''})`);
  };
  libro('Planilla de rendimientos', payload.rendimientos);
  libro('Gastos generales', payload.gastosGenerales);
  libro('Presupuesto', payload.presupuesto);
  libro('Organigramas', payload.organigramas);
  libro('Cartillas APU', payload.apu);
  libro('Itemizado', payload.listado);
  for (const g of payload.gantt ?? []) {
    inv.push(`- Carta Gantt en PDF: ENTREGADA («${g.name}», ${g.numPages} página(s)${g.escaneado ? ', sin capa de texto' : ''})`);
  }
  if (payload.projectNames?.length) inv.push(`- Carta Gantt en MS Project: ENTREGADA (${payload.projectNames.join(', ')}). No se puede abrir: se revisa a través del PDF.`);
  else if (payload.gantt?.length) inv.push('- Carta Gantt en MS Project (.mpp): NO adjuntada.');

  let out = 'HECHOS VERIFICADOS — medidos directamente sobre los archivos entregados.\n';
  out += 'Estos datos son exactos. Tu evaluación NO puede contradecirlos.\n\n';
  out += inv.join('\n') + '\n\n';
  if (admissibility?.results?.length) {
    out += 'Mediciones (úsalas tal cual y cítalas):\n';
    for (const r of admissibility.results) out += `- ${r.label}: ${r.detail}\n`;
    out += '\n';
  }
  out += 'Si algo aparece aquí como ENTREGADO, no escribas que falta.\n\n---\n\n';
  return out;
}

// ─── Tandas de revisión ──────────────────────────────────────────────────────
const CHUNK_HOJAS = 12;

const INSTRUCCIONES_RENDIMIENTOS = `TAREA: revisar la PLANILLA DE RENDIMIENTOS (Ejemplo 11 de la pauta).

Entrega una entrada por cada ACTIVIDAD de la planilla que tenga algún reparo, y
una entrada de síntesis por hoja con lo que está correcto. En "item" pon el ítem
de la actividad.

Por cada actividad:
1. Rendimiento en UNIDAD/día y AJUSTADO a la cuadrilla considerada: ¿es
   razonable para esa cuadrilla y esa faena en condiciones reales de obra? Un
   rendimiento de catálogo sin ajuste, o que no guarda relación con la cuadrilla
   (p. ej. 500 m2/día de cerámica con un maestro y un ayudante), es un hallazgo.
2. Tiempo exacto = cantidad / rendimiento. Cada celda con fórmula viene anotada
   como [fórmula: =D5/E5]: verifica el cociente.
3. Tiempo aproximado al cuarto de jornada SUPERIOR (3,89 → 4; 4,13 → 4,25;
   4,43 → 4,5; 4,66 → 4,75; 4,76 → 5).
4. GLOBAL: solo se estima el tiempo; señala si se abusa de la unidad GLOBAL en
   actividades que sí pueden medirse.
5. Cuadrilla considerada: debe estar declarada y ser coherente con la del APU
   (si va abajo el resumen del APU, compárala).

Usa "Con errores" para cálculos que no cuadran o rendimientos sin sentido,
"Incompleta" cuando falte rendimiento, tiempo o cuadrilla, y "Correcta" cuando
la actividad esté bien.`;

const INSTRUCCIONES_GANTT = `TAREA: revisar la CARTA GANTT entregada en PDF.

Recibes el texto de la página (la tabla de tareas: ítem, nombre, duración,
comienzo, fin, predecesoras) y la página dibujada: primero la vista completa y
luego sus cuatro cuadrantes ampliados.

Entrega una entrada por ASPECTO verificado (no por tarea). En "hoja" pon "Gantt,
pág. N"; en "item", el aspecto. Aspectos obligatorios:
1. Vinculación: ¿todas las actividades están vinculadas según orden lógico, o
   hay tareas sueltas sin predecesora (además de la primera)? ¿Se usan vínculos
   FC, CC, FF, CF con adelantos o retrasos donde corresponde?
2. Títulos y grupos: ¿se declaran los títulos que agrupan actividades y se
   dibujan con barra horizontal NEGRA?
3. Ruta crítica: ¿hay barras y vínculos en ROJO? ¿Es una ruta continua de
   inicio a fin?
4. Días no laborables: ¿se ven columnas GRISES en los fines de semana y
   feriados? Revisa feriados chilenos dentro del período.
5. Fecha de inicio: primer día hábil del año siguiente al que se cursa la
   asignatura.
6. Formato: una sola plana en A0 o A1 donde se identifiquen ítem, nombre,
   duración, inicio, término, predecesora, ruta crítica y días no laborables.
7. Duraciones: deben ser cuartos de jornada (0,25 · 0,5 · 0,75 · 1 día…),
   coherentes con la planilla de rendimientos si va abajo.
8. Plazos forzados: duraciones o vínculos que solo se explican para calzar
   una fecha final.

Si un aspecto no se alcanza a distinguir en la imagen (texto ilegible, colores
dudosos), dilo: no supongas que cumple ni que no cumple.`;

const INSTRUCCIONES_GG = `TAREA: revisar la planilla de GASTOS GENERALES (pauta, págs. 17 a 20).

Entrega una entrada por TABLA o bloque de gastos (personal, seguridad,
transporte, herramientas, derechos, ensayos, insumos, oficina central, resumen).
En "item" pon el bloque.

1. ¿Están los gastos en obra (directos) y en oficina central (indirectos)?
2. ¿Los costos están actualizados y ajustados al proyecto, o copiados de las
   tablas referenciales de la pauta (mismas cifras: Administrador $600.000,
   Mascarillas $1.500, Arriendo oficina $200.000…)? Copiarlos es un hallazgo.
3. ¿Los meses de cada ítem se ajustan al plazo de la Carta Gantt y a cuándo se
   necesita cada gasto?
4. Boletas de garantía según el Ejemplo 17, permisos municipales según la
   ordenanza de la comuna, pólizas y seguros por los m2 del proyecto.
5. Aritmética: T. parcial = $/mes × meses (o $/unidad × cantidad); totales.
6. %GG = (0,32 · GG oficina + GG obra) / CD · 100, con dos decimales.
7. Que no se incluyan en gastos generales cosas que ya están en una partida.`;

const INSTRUCCIONES_PRESUPUESTO = `TAREA: revisar el PRESUPUESTO DETALLADO (Ejemplos 18 a 20).

Entrega una entrada por cada partida con reparo, y entradas de síntesis por hoja
para lo que está correcto y para el recuadro final. En "item" pon el ítem.

1. Total = cantidad × precio unitario, con la fórmula visible (Nota 9).
2. Cantidades con los decimales necesarios; montos con $, separador de miles y
   sin decimales (Notas 10 y 11).
3. Precios unitarios coherentes con las cartillas APU (si va abajo su resumen,
   compáralos partida por partida).
4. Recuadro final: CD = suma de totales; GG, utilidades e imprevistos sobre el
   CD; costo neto; IVA 19%; total; UF del día de la entrega; total en UF con dos
   decimales; superficie; UF/m².
5. Instalaciones eximidas estimadas (eléctrico 7%, climatización 6%, gases 4%
   del CD, ajustables) y no incluidas si el proyecto no las contempla.
6. Encabezado con el nombre exacto del proyecto.`;

const INSTRUCCIONES_ORGANIGRAMAS = `TAREA: revisar los ORGANIGRAMAS (pauta, pág. 22).

Los recuadros del organigrama vienen como texto ([CUADRO DE TEXTO] o
[SMARTART]) o en celdas. Entrega una entrada por organigrama.

1. ¿Hay organigrama EN TERRENO y de OFICINA CENTRAL?
2. ¿Representan CARGOS y no departamentos, unidades ni áreas?
3. ¿La jerarquía es coherente (quién depende de quién)?
4. ¿Los cargos coinciden con los pagados en la planilla de gastos generales?`;

const INSTRUCCIONES_CARTILLAS = `TAREA: revisar que las CARTILLAS APU estén COMPLETADAS (pauta, pág. 20).

En Formulación quedaron pendientes IMPREVISTOS, GASTOS GENERALES, UTILIDAD y
PRECIO NETO. En esta entrega deben completarse. Entrega una entrada por cartilla:
1. ¿Están las cuatro celdas con porcentaje y monto?
2. ¿El %GG es el de la planilla de gastos generales y los porcentajes de
   imprevistos y utilidad son los del recuadro del presupuesto?
3. ¿Precio neto = total costo directo + imprevistos + gastos generales + utilidad?
No vuelvas a revisar mano de obra, materiales ni equipos: se evaluaron en Formulación.`;

/** Resumen compacto de las cartillas APU, para cruzar sin mandarlas enteras. */
export function resumenApu(apu) {
  if (!apu?.sheets?.length) return '';
  const lineas = [];
  for (const hoja of apu.sheets) {
    const filas = hoja.rows ?? [];
    const textoFila = r => (r ?? []).map(c => String(c?.value ?? '').trim()).filter(Boolean);
    let partida = '';
    let rendimiento = '';
    let costoDirecto = '';
    let precioNeto = '';
    const cuadrilla = [];
    let enMO = false;
    for (const r of filas) {
      const t = textoFila(r);
      const j = t.join(' | ');
      if (!partida && /partida\s*-?\s*actividad/i.test(j)) partida = t.slice(1, 3).join(' ');
      if (!rendimiento && /rendimiento/i.test(j)) rendimiento = t.slice(1, 4).join(' ');
      if (/^mano de obra/i.test(t[0] ?? '')) { enMO = true; continue; }
      if (/^materiales/i.test(t[0] ?? '') || /costo\s+mano\s+de\s+obra|coto\s+de\s+mano/i.test(j)) enMO = false;
      if (enMO && /[a-záéíóúñ]{3}/i.test(t[0] ?? '') && !/cuadrilla|leyes|costo|^\(/i.test(t[0])) cuadrilla.push(`${t[1] ?? ''} ${t[0]}`.trim());
      if (/total\s+costo\s+directo/i.test(j)) costoDirecto = t.filter(x => /\d/.test(x)).slice(-1)[0] ?? '';
      if (/precio\s+neto/i.test(j)) precioNeto = t.filter(x => /\d/.test(x)).slice(-1)[0] ?? '';
    }
    if (!partida && !rendimiento) continue;
    lineas.push(`${hoja.name}: ${partida || '(sin partida)'} · ${rendimiento || 'sin rendimiento'} · cuadrilla: ${cuadrilla.slice(0, 5).join(', ') || '—'}`
      + `${costoDirecto ? ` · CD ${costoDirecto}` : ''}${precioNeto ? ` · precio neto ${precioNeto}` : ''}`);
  }
  if (!lineas.length) return '';
  return `\nRESUMEN DE LAS CARTILLAS APU (para cruzar):\n${lineas.slice(0, 400).join('\n')}\n`;
}

/**
 * Las tandas de Proyecto de Título. Devuelve { requests, plan } como
 * buildDeepReviewRequests.
 */
export function buildProyectoRequests({ delivery, studentName, model, rubric, listadoText, referencias = '', payload }) {
  const requests = [];
  const plan = [];
  const asignatura = 'Proyecto de Título';
  const apuResumen = resumenApu(payload.apu);

  const pedir = (kind, contenido, instrucciones, i) => {
    requests.push({
      custom_id: `${kind}-${String(i).padStart(3, '0')}`,
      params: {
        model,
        max_tokens: 8000,
        system: buildCachedPrefix({ studentName, rubric, listadoText, referencias, kind, instrucciones, asignatura }),
        tools: [BATCH_FINDINGS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_batch_findings' },
        messages: [{ role: 'user', content: contenido }],
      },
    });
  };

  const hojas = (kind, sheets, instrucciones, etiqueta) => {
    if (!sheets?.length) return;
    const partidas = partirHojasLargas(sheets);
    const chunks = chunkArray(partidas, CHUNK_HOJAS);
    chunks.forEach((chunk, i) => pedir(kind, formatSheetsChunk(chunk, kind, i + 1, chunks.length, etiqueta), instrucciones, i));
    plan.push({ kind, sheets: partidas.length, batches: chunks.length });
  };

  if (delivery === 'PT1') {
    hojas('ren', payload.rendimientos?.sheets, INSTRUCCIONES_RENDIMIENTOS + apuResumen, 'RENDIMIENTOS');

    // Una tanda por página de la Gantt: su texto y sus cinco imágenes.
    let n = 0;
    for (const g of payload.gantt ?? []) {
      const textoPorPagina = g.pages ?? [];
      const paginas = Math.max(textoPorPagina.length, ...(g.imagenes ?? []).map(x => x.pagina));
      for (let p = 1; p <= Math.min(paginas, 3); p++) {
        const bloques = [{
          type: 'text',
          text: `CARTA GANTT «${g.name}» — página ${p} de ${g.numPages}.\n\nTEXTO DE LA PÁGINA:\n${(textoPorPagina[p - 1] ?? '').slice(0, 60000) || '(sin capa de texto)'}\n\nIMÁGENES DE LA PÁGINA:`,
        }];
        for (const img of (g.imagenes ?? []).filter(x => x.pagina === p)) {
          bloques.push({ type: 'text', text: `— ${img.vista}:` });
          bloques.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
        }
        pedir('gantt', bloques, INSTRUCCIONES_GANTT, n++);
      }
    }
    if (n) plan.push({ kind: 'gantt', sheets: n, batches: n });
    return { requests, plan };
  }

  // PT2: las hojas se reparten por contenido, vengan en el libro que vengan.
  const grupos = clasificarHojasPT2([
    { libro: payload.gastosGenerales, rol: 'gastosGenerales' },
    { libro: payload.presupuesto, rol: 'presupuesto' },
    { libro: payload.organigramas, rol: 'organigramas' },
    { libro: payload.apu, rol: 'apu' },
  ]);
  hojas('gg', grupos.gastosGenerales, INSTRUCCIONES_GG, 'GASTOS GENERALES');
  hojas('pre', grupos.presupuesto, INSTRUCCIONES_PRESUPUESTO + apuResumen, 'PRESUPUESTO');
  hojas('org', grupos.organigramas, INSTRUCCIONES_ORGANIGRAMAS, 'ORGANIGRAMAS');
  hojas('apu', grupos.apu, INSTRUCCIONES_CARTILLAS, 'CARTILLAS APU');
  hojas('otras', grupos.otras, 'TAREA: estas hojas no se reconocieron como gastos generales, presupuesto, organigrama ni cartilla. Describe qué contienen y si aportan a alguno de los criterios.', 'OTRAS HOJAS');

  return { requests, plan };
}

export const ETIQUETAS_PROYECTO = {
  ren: 'PLANILLA DE RENDIMIENTOS',
  gantt: 'CARTA GANTT (PDF)',
  gg: 'GASTOS GENERALES',
  pre: 'PRESUPUESTO DETALLADO',
  org: 'ORGANIGRAMAS',
  apu: 'CARTILLAS APU COMPLETADAS',
  otras: 'OTRAS HOJAS',
};
