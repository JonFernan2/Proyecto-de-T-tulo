/**
 * Revisión profunda por tandas (Batch API).
 *
 * En vez de mandar una muestra truncada del Excel en una sola llamada, se parte
 * el libro en tandas y cada una se revisa hoja por hoja contra el listado, que
 * viaja como prefijo cacheado y compartido por todas las tandas.
 */

// Hojas por tanda. Las cubicaciones son livianas (20–60 filas); las cartillas
// APU son mucho más densas, así que van de a menos.
export const CHUNK_CUBICACIONES = 25;
export const CHUNK_COTIZACIONES = 25;
export const CHUNK_APU = 12;

// Filas máximas que se envían por hoja dentro de una tanda.
const MAX_ROWS_PER_SHEET = 200;

// ─── Herramienta de hallazgos por tanda ──────────────────────────────────────
export const BATCH_FINDINGS_TOOL = {
  name: 'submit_batch_findings',
  description: 'Entrega los hallazgos de la revisión de esta tanda de hojas.',
  input_schema: {
    type: 'object',
    properties: {
      partidas: {
        type: 'array',
        description: 'Una entrada por hoja revisada en esta tanda.',
        items: {
          type: 'object',
          properties: {
            hoja: { type: 'string', description: 'Nombre exacto de la hoja.' },
            item: { type: 'string', description: 'N° de ítem del listado al que corresponde, o "sin identificar".' },
            estado: {
              type: 'string',
              enum: ['Correcta', 'Con errores', 'Incompleta', 'Sin formulas'],
            },
            hallazgo: {
              type: 'string',
              description:
                'Qué encontraste, con el dato concreto. Si hay error aritmético, cita la fórmula, ' +
                'el resultado informado y el valor correcto. Máximo 3 líneas.',
            },
          },
          required: ['hoja', 'item', 'estado', 'hallazgo'],
        },
      },
      erroresAritmeticos: { type: 'integer', description: 'Cuántas hojas de esta tanda tienen errores de cálculo.' },
      hojasSinFormula: { type: 'integer', description: 'Cuántas hojas traen solo números duros, sin fórmula visible.' },
      resumenTanda: { type: 'string', description: '2 a 3 oraciones sobre el conjunto de esta tanda.' },
    },
    required: ['partidas', 'erroresAritmeticos', 'hojasSinFormula', 'resumenTanda'],
  },
};

// ─── Construcción de las tandas ──────────────────────────────────────────────
/**
 * Devuelve { requests, plan } listos para messages.batches.create().
 * `plan` describe qué se va a revisar, para mostrarlo en pantalla.
 */
export function buildDeepReviewRequests({ delivery, studentName, model, rubric, listadoText, payload }) {
  const { cubicaciones, cotizaciones, apu } = payload;
  const requests = [];
  const plan = [];

  const push = (kind, sheets, chunkSize, instrucciones) => {
    if (!sheets?.length) return;
    const chunks = chunkArray(sheets, chunkSize);
    chunks.forEach((chunk, i) => {
      requests.push({
        custom_id: `${kind}-${String(i).padStart(3, '0')}`,
        params: {
          model,
          max_tokens: 8000,
          system: buildCachedPrefix({ studentName, rubric, listadoText, kind, instrucciones }),
          tools: [BATCH_FINDINGS_TOOL],
          tool_choice: { type: 'tool', name: 'submit_batch_findings' },
          messages: [{ role: 'user', content: formatSheetsChunk(chunk, kind, i + 1, chunks.length) }],
        },
      });
    });
    plan.push({ kind, sheets: sheets.length, batches: chunks.length });
  };

  // Las cubicaciones excluyen la hoja del listado: ya viaja en el prefijo.
  const cubSheets = (cubicaciones?.sheets ?? []).filter(s => !esHojaListado(s.name));
  push('cub', cubSheets, CHUNK_CUBICACIONES, INSTRUCCIONES_CUBICACIONES);

  push('cot', cotizaciones?.sheets ?? [], CHUNK_COTIZACIONES, INSTRUCCIONES_COTIZACIONES);

  if (delivery === 'E2') {
    push('apu', apu?.sheets ?? [], CHUNK_APU, INSTRUCCIONES_APU);
  }

  return { requests, plan };
}

export function esHojaListado(name) {
  return /listado|itemizado|actividades?|partidas?/i.test(name ?? '');
}

// ─── Prefijo cacheado ────────────────────────────────────────────────────────
// Idéntico byte a byte en todas las tandas del mismo tipo, para que el listado
// se cobre una vez y las tandas siguientes lo lean del caché.
function buildCachedPrefix({ studentName, rubric, listadoText, kind, instrucciones }) {
  const cabecera = `Eres el docente Jonathan Fernando Muñoz Alvarez revisando la entrega de ${studentName} de la asignatura Formulación de Proyecto de Título (Ingeniería en Construcción, Universidad Viña del Mar).

Estás revisando el trabajo hoja por hoja. Escribe todo hallazgo en primera persona, como quien abrió el archivo y lo revisó. Nunca uses expresiones como "el sistema detecta" o "se observa en el análisis".

No inventes nada. Cita solo datos que aparezcan literalmente en las hojas entregadas. Si una hoja no permite concluir, dilo en vez de suponer.

${rubric}

═══════════════════════════════════════════════════════════
LISTADO DE ACTIVIDADES — referencia base de toda la revisión
═══════════════════════════════════════════════════════════
${listadoText}
═══════════════════════════════════════════════════════════

${instrucciones}`;

  // Un solo bloque, con el punto de caché al final del prefijo estable.
  return [
    {
      type: 'text',
      text: cabecera,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
  ];
}

// ─── Instrucciones por tipo de pasada ────────────────────────────────────────
const INSTRUCCIONES_CUBICACIONES = `TAREA: revisar hojas de CUBICACIONES.

Por cada hoja de esta tanda:
1. Identifica a qué ítem del listado corresponde (por nombre o numeración).
2. VERIFICA LA ARITMÉTICA. Cada celda con fórmula viene anotada como
   [fórmula: =B5*C5]. Comprueba que el resultado informado sea coherente con
   la fórmula y con los valores de las celdas que referencia. Cuando encuentres
   un descuadre, cita la fórmula, el resultado informado y el valor correcto.
3. Marca "Sin formulas" si la hoja trae solo números duros: la pauta exige
   fórmulas explícitas y desarrolladas.
4. Revisa que haya al menos 2 decimales y que no se haya redondeado al entero
   superior. La pauta es explícita: 37.859,57 kg jamás debe informarse 37.860 kg.
5. Los materiales medidos en UN van en enteros. Una cubicación de 4,8 unidades
   de WC es un error.
6. Marca "Incompleta" si faltan partidas del listado que esa hoja debería cubrir.

NO penalices la ausencia de Instalaciones Eléctricas, CCDD, CCTV, Clima,
Ascensores ni Redes de Gases: la pauta las excluye en proyectos de Edificación.`;

const INSTRUCCIONES_COTIZACIONES = `TAREA: revisar hojas de COTIZACIONES.

Por cada hoja de esta tanda:
1. Verifica que cada material tenga TRES cotizaciones de TRES proveedores
   distintos. Nombra los materiales que traen menos de tres.
2. Herramientas, maquinarias y equipos requieren UNA sola cotización: no los
   penalices por tener una.
3. Comprueba que los materiales cotizados correspondan a los que exigen las
   actividades del listado. Señala materiales del listado que no aparecen
   cotizados.
4. Revisa que se indique el nombre del archivo PDF de respaldo por cotización.
5. Las cotizaciones deben ser del año académico en curso. Si aparece un año
   anterior, señálalo; si no hay año visible, dilo como dato faltante y no
   como incumplimiento.

Excepciones válidas de la pauta que NO debes penalizar: material de proveedor
exclusivo (basta una cotización), y material no distribuido en la región o en
el país (vale respaldo por correo del proveedor).`;

const INSTRUCCIONES_APU = `TAREA: revisar cartillas de ANÁLISIS DE PRECIOS UNITARIOS.

Por cada cartilla de esta tanda:
1. Mano de obra: Maestros y Ayudantes deben llevar especialidad (carpintero,
   concretero, enfierrador, gasfíter, pintor). El costo día debe ser el sueldo
   bruto mensual dividido en 22 días. Los pesos van sin decimales, redondeados
   hacia arriba. No deben aparecer supervisores ni jefes de terreno.
2. Rendimiento siempre diario (Kg/día, M2/día, M3/día). Duración = Cubicación /
   Rendimiento: verifica el cuociente.
3. Materiales: %P de pérdidas normalmente entre 2% y 7%. La cantidad (K) es
   cuánto se necesita para UNA unidad de la partida.
4. Fletes: verifica que el vehículo sea coherente con volumen y peso.
   Camioneta 1,5 m3 / 1.000 kg / $15.000 · Camión ¾ 28 m3 / 2.500 kg / $30.000
   Camión Standard 48 m3 / 5.000 kg / $50.000 · Rampla 85 m3 / 30.000 kg / $100.000
   Valor unid = Valor viaje / CantxViaje.
5. Equipos bajo $300.000 pasan a ser propiedad de la empresa: solo se informa
   desgaste de 0,02% del valor comercial por unidad producida. Los arrendados
   valen precio de arriendo dividido por el rendimiento en condiciones reales.
6. Las herramientas se listan pero NO se valorizan, salvo que sean específicas
   de esa partida.
7. Verifica la aritmética de cada fórmula, igual que en cubicaciones.`;

// ─── Formato de una tanda de hojas ───────────────────────────────────────────
function formatSheetsChunk(sheets, kind, n, total) {
  const etiqueta = { cub: 'CUBICACIONES', cot: 'COTIZACIONES', apu: 'APU' }[kind] ?? kind;

  let out = `TANDA ${n} de ${total} — ${sheets.length} hoja(s) de ${etiqueta}.\n`;
  out += `Revisa TODAS las hojas de esta tanda y entrega una entrada por cada una.\n\n`;

  for (const sheet of sheets) {
    out += `━━━ HOJA: ${sheet.name} ━━━\n`;
    const rows = sheet.rows ?? [];
    for (const row of rows.slice(0, MAX_ROWS_PER_SHEET)) {
      const cells = row
        .map(c => {
          if (!c) return '';
          let v = String(c.value ?? '');
          if (c.formula) v += ` [fórmula: =${String(c.formula).replace(/^=/, '')}]`;
          return v;
        })
        .filter(Boolean);
      if (cells.length) out += cells.join(' | ') + '\n';
    }
    if (rows.length > MAX_ROWS_PER_SHEET) {
      out += `... (${rows.length - MAX_ROWS_PER_SHEET} filas más en esta hoja)\n`;
    }
    out += '\n';
  }

  return out;
}

// ─── Consolidación ───────────────────────────────────────────────────────────
/**
 * Convierte los hallazgos de todas las tandas en el bloque de texto que
 * alimenta la evaluación final.
 */
export function formatFindingsForConsolidation(findings) {
  const grupos = { cub: [], cot: [], apu: [] };
  for (const f of findings) {
    const kind = f.custom_id.split('-')[0];
    if (grupos[kind]) grupos[kind].push(f);
  }

  const etiquetas = {
    cub: 'CUBICACIONES',
    cot: 'COTIZACIONES',
    apu: 'APU — ANÁLISIS DE PRECIOS UNITARIOS',
  };

  let out = '';
  let totalErrores = 0;
  let totalSinFormula = 0;
  let totalHojas = 0;

  for (const [kind, lista] of Object.entries(grupos)) {
    if (!lista.length) continue;

    lista.sort((a, b) => a.custom_id.localeCompare(b.custom_id));

    const partidas = lista.flatMap(f => f.result.partidas ?? []);
    const errores = lista.reduce((s, f) => s + (f.result.erroresAritmeticos ?? 0), 0);
    const sinFormula = lista.reduce((s, f) => s + (f.result.hojasSinFormula ?? 0), 0);

    totalErrores += errores;
    totalSinFormula += sinFormula;
    totalHojas += partidas.length;

    out += `\n<hallazgos seccion="${kind}" documento="${etiquetas[kind]}">\n`;
    out += `Hojas revisadas: ${partidas.length} · Con errores de cálculo: ${errores} · Sin fórmulas visibles: ${sinFormula}\n\n`;

    const porEstado = agrupar(partidas, p => p.estado);
    for (const [estado, items] of Object.entries(porEstado)) {
      out += `── ${estado} (${items.length} hoja/s) ──\n`;
      // Las hojas correctas no necesitan detallarse una por una.
      const muestra = estado === 'Correcta' ? items.slice(0, 8) : items.slice(0, 60);
      for (const p of muestra) {
        out += `· [${p.item}] ${p.hoja}: ${p.hallazgo}\n`;
      }
      if (items.length > muestra.length) {
        out += `  (… y ${items.length - muestra.length} hoja(s) más en el mismo estado)\n`;
      }
      out += '\n';
    }

    out += 'Síntesis por tanda:\n';
    lista.forEach(f => { out += `· ${f.result.resumenTanda}\n`; });
    out += `</hallazgos>\n`;
  }

  return {
    texto: out,
    totales: { hojas: totalHojas, errores: totalErrores, sinFormula: totalSinFormula },
  };
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function agrupar(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}
