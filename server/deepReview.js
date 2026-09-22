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
// Las páginas de cotización son cortas; entran bastantes por tanda.
export const CHUNK_PDF_PAGINAS = 30;

// Filas máximas que se envían por hoja dentro de una tanda.
const MAX_ROWS_PER_SHEET = 200;

// Presupuesto de imágenes por petición. Dos límites de la API obligan a acotar:
// pasadas las 20 imágenes cada una debe ser más pequeña, y una petición con
// decenas de capturas sin comprimir supera el tamaño admitido y falla entera,
// llevándose consigo todas las hojas de esa tanda.
const MAX_IMAGENES_POR_TANDA = 18;
const MAX_BYTES_IMAGENES_POR_TANDA = 4 * 1024 * 1024;

// El base64 ocupa cuatro caracteres por cada tres bytes.
const bytesDeBase64 = data => Math.floor((data?.length ?? 0) * 0.75);

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
              enum: ['Correcta', 'Con errores', 'Incompleta', 'Sin formulas', 'Medida en software'],
              description:
                '"Medida en software" cuando el cálculo se respalda con una captura de ' +
                'AutoCAD/BIM y la cifra medida coincide con el total de la hoja: es válido ' +
                'según la pauta y no debe tratarse como falta de fórmula. Si la cifra NO ' +
                'coincide, usa "Con errores".',
            },
            hallazgo: {
              type: 'string',
              description:
                'Hallazgo en voz impersonal ("se observa...", "no se visualizan..."), con el dato ' +
                'concreto. Si hay error aritmético, cita la fórmula, ' +
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
export function buildDeepReviewRequests({ delivery, studentName, model, rubric, listadoText, referencias = '', payload }) {
  const { cubicaciones, cotizaciones, apu, listado } = payload;
  const requests = [];
  const plan = [];

  const push = (kind, sheets, chunkSize, instrucciones) => {
    if (!sheets?.length) return;

    // Las hojas con respaldo incrustado pesan mucho más: cada captura de AutoCAD
    // ocupa lo que cientos de filas de texto. Se reduce la tanda para que el
    // modelo pueda atender a cada imagen en vez de sobrevolarlas.
    const conImagenes = sheets.filter(s => s.images?.length).length;
    const tam = conImagenes > sheets.length / 4 ? Math.min(chunkSize, 8) : chunkSize;

    const chunks = chunkArray(sheets, tam);
    chunks.forEach((chunk, i) => {
      requests.push({
        custom_id: `${kind}-${String(i).padStart(3, '0')}`,
        params: {
          model,
          max_tokens: 8000,
          system: buildCachedPrefix({ studentName, rubric, listadoText, referencias, kind, instrucciones }),
          tools: [BATCH_FINDINGS_TOOL],
          tool_choice: { type: 'tool', name: 'submit_batch_findings' },
          messages: [{ role: 'user', content: formatSheetsChunk(chunk, kind, i + 1, chunks.length) }],
        },
      });
    });
    plan.push({ kind, sheets: sheets.length, batches: chunks.length, conImagenes });
  };

  // Si el listado vino como archivo aparte, el libro de cubicaciones se revisa
  // entero. Solo cuando el listado vive DENTRO de ese libro hay que apartar su
  // hoja — y únicamente esa: los libros nombran sus hojas "1.1 PARTIDAS
  // PRELIMINARES", y filtrar por nombre sobre todas dejaría la revisión vacía.
  const todasCub = cubicaciones?.sheets ?? [];
  const idxListado = listado?.sheets?.length
    ? -1
    : todasCub.findIndex(s => esHojaListado(s.name));
  const cubSheets = todasCub.filter((_, i) => i !== idxListado);
  push('cub', cubSheets, CHUNK_CUBICACIONES, INSTRUCCIONES_CUBICACIONES);

  push('cot', cotizaciones?.sheets ?? [], CHUNK_COTIZACIONES, INSTRUCCIONES_COTIZACIONES);

  if (delivery === 'E2') {
    push('apu', apu?.sheets ?? [], CHUNK_APU, INSTRUCCIONES_APU);
  }

  // ── Respaldo de cotizaciones en PDF ────────────────────────────────────────
  // Se reparten las páginas de todos los PDF en tandas, arrastrando el nombre
  // del archivo para poder citarlo en el hallazgo.
  const paginas = (payload.respaldoPdfs ?? []).flatMap(pdf =>
    (pdf.pages ?? []).map((texto, i) => ({
      archivo: pdf.name,
      pagina: i + 1,
      deTotal: pdf.numPages,
      texto,
      escaneado: pdf.escaneado,
    })),
  );

  const legibles = paginas.filter(p => p.texto?.length > 20);
  if (legibles.length) {
    const chunks = chunkArray(legibles, CHUNK_PDF_PAGINAS);
    chunks.forEach((chunk, i) => {
      requests.push({
        custom_id: `pdf-${String(i).padStart(3, '0')}`,
        params: {
          model,
          max_tokens: 8000,
          system: buildCachedPrefix({
            studentName, rubric, listadoText, referencias,
            kind: 'pdf',
            instrucciones: instruccionesRespaldoPdf(cotizaciones),
          }),
          tools: [BATCH_FINDINGS_TOOL],
          tool_choice: { type: 'tool', name: 'submit_batch_findings' },
          messages: [{ role: 'user', content: formatPaginasPdf(chunk, i + 1, chunks.length) }],
        },
      });
    });
    plan.push({ kind: 'pdf', sheets: legibles.length, batches: chunks.length });
  }

  // Un PDF escaneado no tiene capa de texto: no es que venga vacío, es que no
  // se puede leer. Debe informarse como tal y no como cotizaciones ausentes.
  const escaneados = (payload.respaldoPdfs ?? []).filter(p => p.escaneado);
  if (escaneados.length) {
    plan.push({
      kind: 'pdf-escaneado',
      sheets: escaneados.reduce((s, p) => s + (p.numPages ?? 0), 0),
      batches: 0,
      archivos: escaneados.map(p => p.name),
    });
  }

  return { requests, plan };
}

function formatPaginasPdf(paginas, n, total) {
  let out = `TANDA ${n} de ${total} — ${paginas.length} página(s) de respaldo de cotizaciones.\n`;
  out += `Entrega una entrada por página revisada.\n\n`;
  for (const p of paginas) {
    out += `━━━ HOJA: ${p.archivo} · pág. ${p.pagina} de ${p.deTotal} ━━━\n`;
    out += p.texto.slice(0, 6000) + '\n\n';
  }
  return out;
}

function instruccionesRespaldoPdf(cotizaciones) {
  let out = `TAREA: revisar el RESPALDO EN PDF de las cotizaciones.

Cada "hoja" de esta tanda es una página del PDF de respaldo. Por cada una:
1. Identifica qué cotiza: material, proveedor y precio.
2. AÑO: la pauta exige cotizaciones del año académico en curso y no da validez
   a las de años anteriores. Si la página muestra una fecha de año anterior,
   es un hallazgo. Si no hay fecha visible, dilo como dato faltante, no como
   incumplimiento.
3. PROVEEDOR: anota cuál es, para poder comprobar después que cada material
   tenga tres proveedores DISTINTOS.
4. PRECIO: compáralo con el de la planilla de cotizaciones que va más abajo.
   Si no coinciden, cita ambas cifras: es un hallazgo importante.
5. Si la página no es una cotización (portada, índice, página en blanco),
   márcala "Correcta" e indícalo en una línea, sin penalizar.

Usa "Con errores" cuando el año no sirva, el precio no cuadre con la planilla
o el proveedor se repita donde deberían ser distintos. Usa "Incompleta" cuando
falte el precio, el proveedor o la identificación del material.

En el campo "item" pon el ítem de la partida al que corresponde el material,
si se puede determinar; si no, escribe "sin identificar".
`;

  if (cotizaciones?.sheets?.length) {
    out += `\nPLANILLA DE COTIZACIONES CONTRA LA QUE DEBES COTEJAR:\n`;
    for (const hoja of cotizaciones.sheets.slice(0, 10)) {
      out += `\n**Hoja: ${hoja.name}**\n`;
      for (const row of (hoja.rows ?? []).slice(0, 120)) {
        const cells = row.map(c => (!c ? '' : String(c.value ?? ''))).filter(Boolean);
        if (cells.length) out += cells.join(' | ') + '\n';
      }
    }
  } else {
    out += `\nNo se entregó planilla Excel de cotizaciones: no hay contra qué cotejar
los precios. Evalúa las páginas por sí solas e indícalo.\n`;
  }

  return out;
}

export function esHojaListado(name) {
  return /listado|itemizado|actividades?|partidas?/i.test(name ?? '');
}

// ─── Prefijo cacheado ────────────────────────────────────────────────────────
// Idéntico byte a byte en todas las tandas del mismo tipo, para que el listado
// se cobre una vez y las tandas siguientes lo lean del caché.
function buildCachedPrefix({ studentName, rubric, listadoText, referencias, kind, instrucciones }) {
  const cabecera = `Corrección de la entrega de ${studentName} en la asignatura Formulación de Proyecto de Título (Ingeniería en Construcción, Universidad Viña del Mar), a cargo del docente Jonathan Fernando Muñoz Alvarez.

REGISTRO DE TONO (obligatorio en cada hallazgo que redactes):
Voz IMPERSONAL con "se" (pasiva refleja), registro académico formal chileno.
Sin primera persona y sin atribuir la revisión a ninguna herramienta.

Así SÍ:
- "Se observa que el resultado informado (45,00) no corresponde a la fórmula =B4*C4, que arroja 45,80."
- "En las celdas D12 a D18 no se visualizan las fórmulas de cálculo."
- "Se detecta redondeo al entero superior en la partida 3.2."
- "Se sugiere desarrollar el cálculo con al menos dos decimales."

Así NO: "encontré", "revisé", "verifiqué", "noté", "el sistema detecta", "la IA identifica".

No inventes nada. Cita solo datos que aparezcan literalmente en las hojas entregadas. Si una hoja no permite concluir, indícalo en vez de suponer.

${rubric}
${referencias}
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
3. Revisa que haya al menos 2 decimales y que no se haya redondeado al entero
   superior. La pauta es explícita: 37.859,57 kg jamás debe informarse 37.860 kg.
4. Los materiales medidos en UN van en enteros. Una cubicación de 4,8 unidades
   de WC es un error.
5. Marca "Incompleta" si faltan partidas del listado que esa hoja debería cubrir.

MEDICIÓN CON SOFTWARE: CUENTA COMO CÁLCULO DESARROLLADO.
La pauta acepta expresamente dimensionar con AutoCAD o BIM. Cuando la hoja trae
una captura del panel de propiedades con el área, longitud o volumen medido,
ESO ES el cálculo desarrollado y está correcto así. NO marques "Sin formulas"
ni penalices la falta de fórmula en esas hojas.

Lo que sí debes verificar en ellas es LA COINCIDENCIA DE LOS NÚMEROS:
- Lee la cifra del panel de propiedades de la captura (ej: "Área 4895.8503",
  "Longitud 252.2016").
- Compárala con el total informado en las celdas de la hoja (ej: 4895,85 · 252,20).
- Deben coincidir, admitiendo el truncado a 2 decimales que exige la pauta.
- Si no coinciden, es un hallazgo importante: cita ambas cifras.
- Si el valor del Excel está redondeado hacia arriba respecto del medido,
  señálalo: la pauta lo prohíbe expresamente.
- Si la captura corresponde a una partida distinta de la que declara la hoja,
  señálalo.
- Si la imagen es ilegible o no alcanzas a leer la cifra, dilo: no inventes
  un número ni supongas que coincide.

EL RESPALDO ADMITE VARIAS FORMAS Y NINGUNA VALE MENOS QUE OTRA:
captura de medición en software, fórmulas desarrolladas en las celdas, cálculo
escrito en filas anexas, o archivos aparte (PDF escaneado, fotos del cuaderno).
Marca "Sin formulas" únicamente cuando la hoja entregue un resultado sin fórmula,
sin desarrollo y sin imagen alguna que lo respalde.

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
   El respaldo admite tres formas y ninguna vale menos que otra: PDFs adjuntos
   aparte, imágenes incrustadas en la propia hoja (van anotadas arriba de cada
   hoja), o pegado dentro de la misma planilla. Si la hoja trae imágenes
   incrustadas, el respaldo existe aunque no haya PDFs sueltos. Señala falta
   de respaldo solo cuando no se dé ninguna de las tres.
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
/**
 * Devuelve los bloques de contenido de una tanda: el texto de las hojas y, si
 * las traen, sus imágenes de respaldo intercaladas donde corresponde, para que
 * cada captura quede junto a las filas de su propia hoja.
 */
function formatSheetsChunk(sheets, kind, n, total) {
  const etiqueta = { cub: 'CUBICACIONES', cot: 'COTIZACIONES', apu: 'APU' }[kind] ?? kind;
  const bloques = [];
  let texto = `TANDA ${n} de ${total} — ${sheets.length} hoja(s) de ${etiqueta}.\n`;
  texto += `Revisa TODAS las hojas de esta tanda y entrega una entrada por cada una.\n\n`;

  let imagenesUsadas = 0;
  let bytesUsados = 0;
  let omitidas = 0;

  for (const sheet of sheets) {
    texto += `━━━ HOJA: ${sheet.name} ━━━\n`;

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
      if (cells.length) texto += cells.join(' | ') + '\n';
    }
    if (rows.length > MAX_ROWS_PER_SHEET) {
      texto += `... (${rows.length - MAX_ROWS_PER_SHEET} filas más en esta hoja)\n`;
    }

    // Solo entran las imágenes que caben en el presupuesto: pasarse hace fallar
    // la petición completa y se pierden también las hojas de la tanda.
    const caben = [];
    for (const img of sheet.images ?? []) {
      const bytes = bytesDeBase64(img.data);
      if (imagenesUsadas >= MAX_IMAGENES_POR_TANDA || bytesUsados + bytes > MAX_BYTES_IMAGENES_POR_TANDA) {
        omitidas++;
        continue;
      }
      caben.push(img);
      imagenesUsadas++;
      bytesUsados += bytes;
    }

    if (caben.length) {
      texto += `\nRespaldo incrustado en la hoja "${sheet.name}" (${caben.length} imagen(es)), a continuación:\n`;
      bloques.push({ type: 'text', text: texto });
      texto = '';
      for (const img of caben) {
        bloques.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      }
      texto += `(fin del respaldo de "${sheet.name}")\n`;
    } else if (sheet.images?.length) {
      texto += `[Esta hoja tiene ${sheet.images.length} imagen(es) de respaldo incrustada(s) que no `
             + `caben en esta tanda. El respaldo EXISTE — no afirmes que falta.]\n`;
    }

    texto += '\n';
  }

  if (omitidas > 0) {
    texto += `\n(${omitidas} imagen(es) de esta tanda quedaron fuera por tamaño; su respaldo existe igualmente.)\n`;
  }

  if (texto.trim()) bloques.push({ type: 'text', text: texto });
  return bloques;
}

// ─── Consolidación ───────────────────────────────────────────────────────────
/**
 * Convierte los hallazgos de todas las tandas en el bloque de texto que
 * alimenta la evaluación final.
 */
export function formatFindingsForConsolidation(findings) {
  const grupos = { cub: [], cot: [], apu: [], pdf: [] };
  for (const f of findings) {
    const kind = f.custom_id.split('-')[0];
    if (grupos[kind]) grupos[kind].push(f);
  }

  const etiquetas = {
    cub: 'CUBICACIONES',
    cot: 'COTIZACIONES',
    apu: 'APU — ANÁLISIS DE PRECIOS UNITARIOS',
    pdf: 'RESPALDO EN PDF DE LAS COTIZACIONES',
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
    out += `${kind === 'pdf' ? 'Páginas' : 'Hojas'} revisadas: ${partidas.length} · Con errores de cálculo: ${errores} · Sin fórmulas visibles: ${sinFormula}\n\n`;

    const porEstado = agrupar(partidas, p => p.estado);
    for (const [estado, items] of Object.entries(porEstado)) {
      out += `── ${estado} (${items.length} hoja/s) ──\n`;
      // Las hojas sin reparos no necesitan detallarse una por una.
      const limpia = estado === 'Correcta' || estado === 'Medida en software';
      const muestra = limpia ? items.slice(0, 8) : items.slice(0, 60);
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
