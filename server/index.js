import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─── Evaluate endpoint ────────────────────────────────────────────────────────
app.post('/api/evaluate', async (req, res) => {
  try {
    const { delivery, studentName, payload } = req.body;

    const systemPrompt = buildSystemPrompt(delivery);
    const userContent = buildUserContent(delivery, studentName, payload);

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    const rawText = message.content.find(b => b.type === 'text')?.text ?? '';

    // Extract JSON robustly (might be wrapped in ```json ... ```)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('La IA no devolvió JSON válido.');

    const evaluation = JSON.parse(jsonMatch[0]);
    res.json({ ok: true, evaluation });
  } catch (err) {
    console.error('[evaluate] ERROR:', err.message);
    console.error('[evaluate] status:', err.status);
    console.error('[evaluate] cause:', err.cause?.message ?? err.cause ?? '(sin causa)');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Prompt builders ──────────────────────────────────────────────────────────
function buildSystemPrompt(delivery) {
  return `Eres el docente Jonathan Fernando Muñoz Alvarez de la asignatura "Formulación de Proyecto de Título", modalidad Licitación, Ingeniería en Construcción, Universidad Viña del Mar (UVM), Chile.

Revisaste personalmente los archivos del estudiante. Escribe TODA la retroalimentación en primera persona, como si fueras Jonathan describiendo lo que encontraste al revisar. Ejemplos de tono correcto: "Al revisar las EETT encontré que...", "En el listado de actividades noté que...", "Verifiqué que las cubicaciones presentan...", "Al analizar las cotizaciones observé...". PROHIBIDO usar frases como "el sistema detecta", "la IA identifica", "se observa en el análisis", "el documento presenta".

VALIDACIÓN ARITMÉTICA DE CUBICACIONES (obligatorio):
- Revisa cada fórmula de Excel entregada (columna "fórmula: ...")
- Verifica si el resultado almacenado es coherente con la fórmula (ej: si fórmula dice =C5*D5 con valores 5 y 3, el resultado debe ser 15,0)
- Identifica y señala explícitamente las partidas donde encuentres errores aritméticos o inconsistencias
- Señala partidas donde faltan fórmulas (solo hay números duros sin fórmula explícita)
- Señala si hay menos de 2 decimales o redondeos incorrectos

EVALUACIÓN CRUZADA (obligatorio):
Los archivos llegan separados en bloques <seccion id="...">. Cada sección es un documento distinto:
- <seccion id="listado"> = el listado de actividades (REFERENCIA BASE)
- <seccion id="cubicaciones"> = las hojas con fórmulas y mediciones (NO tiene precios)
- <seccion id="cotizaciones"> = las cotizaciones con proveedores y precios (NO tiene fórmulas)
- <seccion id="apu"> = el APU con mano de obra, materiales y equipos (solo E2)

NUNCA atribuyas a cotizaciones algo que esté en cubicaciones, ni viceversa.
Al escribir la justificación, cita en qué sección encontraste el dato (ej: "En las cubicaciones verifiqué...", "Al revisar las cotizaciones observé...").

Evaluación cruzada que debes hacer:
- Actividades del listado que NO tienen hoja de cubicación (identifica cuáles)
- Materiales en cubicaciones sin cotización correspondiente (identifica cuáles)
- Inconsistencias de unidades entre listado, cubicaciones y cotizaciones

La nota es HOLÍSTICA (no promedio matemático): los porcentajes son guía de importancia relativa.

ESCALA: 1,0 a 7,0 en pasos de 0,5. Nota mínima de aprobación: 4,0.

RESPONDE ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después:
{
  "criteria": [
    { "id": "...", "score": X.X, "justification": "..." }
  ],
  "globalScore": X.X,
  "globalJustification": "..."
}

Cada justificación: 4-6 oraciones en primera persona (Jonathan revisando), específica con ejemplos concretos encontrados, en español formal chileno.`;
}

function buildUserContent(delivery, studentName, payload) {
  const { eett, cubicaciones, cotizaciones, cotizacionesFiles, apu, images, pdfNames } = payload;

  const contentBlocks = [];

  let text = `## CORRECCIÓN ${delivery} — Estudiante: ${studentName}\n\n`;
  text += getRubric(delivery);
  text += '\n\n---\n\n';
  text += `IMPORTANTE: Cada bloque <seccion> corresponde a un DOCUMENTO DISTINTO del estudiante.
No mezcles información entre secciones. Al citar un dato, indica explícitamente de qué sección proviene.
La sección LISTADO es la referencia base para la evaluación cruzada.\n\n`;

  if (delivery === 'E1') {
    // ── SECCIÓN 1: EETT ──────────────────────────────────────────────────────
    text += `<seccion id="eett" documento="Especificaciones Técnicas">\n`;
    text += formatEett(eett);
    text += `</seccion>\n\n`;

    // ── SECCIÓN 2 y 3: Separar listado de cubicaciones ───────────────────────
    const { listadoText, cubicacionesText, nListado, nCubSheets } =
      splitListadoYCubicaciones(cubicaciones);

    text += `<seccion id="listado" documento="Listado de Actividades" n_actividades="${nListado}">\n`;
    text += `ESTE ES EL LISTADO DE ACTIVIDADES — referencia base para la evaluación cruzada.\n`;
    text += `Cada fila aquí debe tener cubicación en la sección cubicaciones y material cotizado en cotizaciones.\n\n`;
    text += listadoText;
    text += `</seccion>\n\n`;

    text += `<seccion id="cubicaciones" documento="Hojas de Cubicaciones" n_hojas="${nCubSheets}">\n`;
    text += `ESTE ES EL LIBRO DE CUBICACIONES — contiene las mediciones y fórmulas por actividad.\n`;
    text += `No contiene precios ni proveedores; eso está en la sección cotizaciones.\n\n`;
    text += cubicacionesText;
    text += `</seccion>\n\n`;

    // ── SECCIÓN 4: COTIZACIONES ───────────────────────────────────────────────
    text += `<seccion id="cotizaciones" documento="Cotizaciones de materiales">\n`;
    text += `ESTE ES EL ARCHIVO DE COTIZACIONES — contiene precios y proveedores.\n`;
    text += `No contiene fórmulas de medición; eso está en la sección cubicaciones.\n\n`;
    const wordCots = (cotizacionesFiles ?? []).filter(f => f.parsed?.text !== undefined);
    if (wordCots.length > 0) {
      text += `Formato: ${wordCots.length} archivo(s) Word\n`;
      wordCots.forEach(({ name, parsed }) => {
        text += `\n**Archivo: ${name}**\n`;
        text += formatEett(parsed);
      });
    } else {
      text += formatExcel('', cotizaciones);
    }
    if (pdfNames?.length) {
      text += `\nPDFs de respaldo adjuntos: ${pdfNames.join(', ')}\n`;
    }
    text += `</seccion>\n\n`;

  } else {
    // ── E2 ───────────────────────────────────────────────────────────────────
    text += `<seccion id="eett" documento="Especificaciones Técnicas E1">\n`;
    text += formatEett(eett);
    text += `</seccion>\n\n`;

    const { listadoText, cubicacionesText, nListado, nCubSheets } =
      splitListadoYCubicaciones(cubicaciones);

    text += `<seccion id="listado" documento="Listado de Actividades E1" n_actividades="${nListado}">\n`;
    text += listadoText;
    text += `</seccion>\n\n`;

    text += `<seccion id="cubicaciones" documento="Cubicaciones E1" n_hojas="${nCubSheets}">\n`;
    text += cubicacionesText;
    text += `</seccion>\n\n`;

    text += `<seccion id="cotizaciones" documento="Cotizaciones E1">\n`;
    const wordCots = (cotizacionesFiles ?? []).filter(f => f.parsed?.text !== undefined);
    if (wordCots.length > 0) {
      wordCots.forEach(({ name, parsed }) => {
        text += `\n**Archivo: ${name}**\n`;
        text += formatEett(parsed);
      });
    } else {
      text += formatExcel('', cotizaciones);
    }
    text += `</seccion>\n\n`;

    text += `<seccion id="apu" documento="APU — Análisis de Precios Unitarios">\n`;
    text += `ESTE ES EL APU — contiene mano de obra, materiales, fletes y equipos por partida.\n`;
    text += `Los precios de materiales deben ser coherentes con la sección cotizaciones.\n\n`;
    text += formatExcel('', apu);
    text += `</seccion>\n\n`;
  }

  contentBlocks.push({ type: 'text', text });

  if (images?.length) {
    contentBlocks.push({
      type: 'text',
      text: `<seccion id="imagenes_respaldo" documento="Respaldo fotográfico cubicaciones" n_imagenes="${images.length}">\nVerifica coherencia entre fórmulas del Excel (sección cubicaciones) y estos cálculos manuales:\n`,
    });
    images.slice(0, 5).forEach(({ data, mediaType }) => {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    });
    contentBlocks.push({ type: 'text', text: `</seccion>\n` });
  }

  contentBlocks.push({
    type: 'text',
    text: '\n---\nDevuelve SOLO el JSON de evaluación. Recuerda: no mezcles contenido entre secciones en tus justificaciones.',
  });

  return contentBlocks;
}

// ─── Separar listado del resto de cubicaciones ────────────────────────────────
function splitListadoYCubicaciones(cubicacionesData) {
  if (!cubicacionesData?.sheets?.length) {
    return { listadoText: '_(No entregado)_\n', cubicacionesText: '_(No entregado)_\n', nListado: 0, nCubSheets: 0 };
  }

  // Buscar hoja de listado por nombre
  const listadoIdx = cubicacionesData.sheets.findIndex(s =>
    /listado|itemizado|actividades?|partidas?/i.test(s.name),
  );

  const listadoSheet = listadoIdx >= 0 ? cubicacionesData.sheets[listadoIdx] : null;
  const cubSheets = cubicacionesData.sheets.filter((_, i) => i !== listadoIdx);

  // Formatear listado
  let listadoText = '';
  let nListado = 0;
  if (listadoSheet) {
    listadoText += `Hoja: "${listadoSheet.name}" — ${listadoSheet.rows.length} filas\n\n`;
    listadoSheet.rows.slice(0, 200).forEach(row => {
      const cells = row.map(c => (!c ? '' : String(c.value ?? ''))).filter(Boolean);
      if (cells.length) { listadoText += cells.join(' | ') + '\n'; nListado++; }
    });
    if (listadoSheet.rows.length > 200) listadoText += `... (${listadoSheet.rows.length - 200} filas más)\n`;
  } else {
    // Sin hoja de listado: tomar primera hoja como referencia
    const firstSheet = cubicacionesData.sheets[0];
    listadoText += `(No se encontró hoja "Listado" — mostrando primera hoja: "${firstSheet.name}")\n\n`;
    firstSheet.rows.slice(0, 100).forEach(row => {
      const cells = row.map(c => (!c ? '' : String(c.value ?? ''))).filter(Boolean);
      if (cells.length) { listadoText += cells.join(' | ') + '\n'; nListado++; }
    });
  }

  // Formatear cubicaciones (sin la hoja listado)
  let cubicacionesText = '';
  const sheetsToShow = cubSheets.slice(0, 20);
  cubicacionesText += `Total hojas de cubicaciones: ${cubSheets.length}\n`;
  cubicacionesText += `(Se muestran las primeras ${sheetsToShow.length} hojas)\n\n`;
  sheetsToShow.forEach(sheet => {
    cubicacionesText += `**Hoja: ${sheet.name}**\n`;
    sheet.rows.slice(0, 60).forEach(row => {
      const cells = row.map(c => {
        if (!c) return '';
        let val = String(c.value ?? '');
        if (c.formula) val += ` [fórmula: ${c.formula}]`;
        return val;
      }).filter(Boolean);
      if (cells.length) cubicacionesText += cells.join(' | ') + '\n';
    });
    if (sheet.rows.length > 60) cubicacionesText += `... (${sheet.rows.length - 60} filas más)\n`;
    cubicacionesText += '\n';
  });
  if (cubSheets.length > 20) cubicacionesText += `[... ${cubSheets.length - 20} hojas más no mostradas]\n`;

  return { listadoText, cubicacionesText, nListado, nCubSheets: cubSheets.length };
}

// ─── Rubric text ──────────────────────────────────────────────────────────────
function getRubric(delivery) {
  if (delivery === 'E1') {
    return `## RÚBRICA ENTREGA 1

### 1. EETT — Especificaciones Técnicas (peso 25%, id: "eett")
- Modificaciones correctamente destacadas en AMARILLO
- Eliminaciones correctamente TACHADAS
- Cada material con: calidad, materialidad, tipo, formato, color, modelo y marca/proveedor (no dejar ambigüedades)
- Métodos constructivos convertidos a sugerencias, no imposiciones
- Para edificación: solo AALL, APF, APC, ALC revisadas

### 2. Listado de Actividades (peso 15%, id: "listado")
- Numeración de ítem coincide exactamente con las EETT
- Descripción resumida con características técnicas donde aplica (medidas, espesores)
- Unidad de medida correcta: ml, m2, m3, kg, un, pm, gl según tipo de partida
- Orden coherente con la secuencia de las EETT

### 3. Cubicaciones (peso 35%, id: "cubicaciones")
- Fórmulas EXPLÍCITAS y VISIBLES en Excel (no solo resultados numéricos)
- Mínimo 2 decimales; NUNCA redondeado al entero superior
- Materiales en UN expresados en enteros (nunca fraccionados)
- Cada cálculo referenciado a su partida correspondiente
- Coherencia entre fórmulas Excel y respaldo fotográfico/manual
- Cumple NCh 353 y Manual de Cubicaciones MOP

### 4. Cotizaciones (peso 25%, id: "cotizaciones")
- 3 cotizaciones de 3 proveedores DISTINTOS para cada material
- 1 cotización para herramientas, maquinarias y equipos (por separado)
- Cotizaciones del año académico en curso (2026); rechazar años anteriores
- Formato correcto: ítem | material | proveedor 01 | proveedor 02 | proveedor 03 | nombre archivo PDF
- PDFs de respaldo presentes y correctamente nombrados`;
  }

  return `## RÚBRICA ENTREGA 2

### 1. Métodos Constructivos (peso 30%, id: "metodos")
- Descripción paso a paso detallada de cada actividad del itemizado
- Cuadrilla básica completa: categoría (Maestro/Ayudante/Jornal) con especialidad para cada trabajador
- Herramientas, equipos y maquinarias declarados coherentemente
- Actividades previas y sucesoras identificadas
- Criterio de fusión/división de actividades justificado
- Nivel de detalle suficiente (equivalente a "Método Mejorado" del Documento Guía)

### 2. APU — Mano de Obra (peso 25%, id: "mo")
- Maestros y Ayudantes con especialidad especificada (carpintero, concretero, etc.)
- Sueldos brutos diarios actualizados al mercado 2026 (sueldo mensual / 22 días)
- Leyes sociales declaradas con porcentaje explícito
- Cantidad de trabajadores consistente con el método constructivo
- Rendimiento informado en UNIDAD/Día (Kg/día, M2/día, etc.)

### 3. APU — Materiales + Fletes (peso 30%, id: "materiales")
- Designación completa de cada material necesario para la actividad
- Porcentaje de pérdidas (%P) justificado (generalmente 2%–7%)
- Precios coherentes con cotizaciones de E1
- Flete: vehículo adecuado (camioneta/camión ¾/camión std/rampla), CantxViaje, valor viaje → valor/unidad
- Fórmulas visibles en Excel (no solo resultados)

### 4. APU — Equipos y Maquinarias (peso 15%, id: "equipos")
- Distinción correcta entre arrendado y propiedad de empresa
- Equipos precio < $300.000 → propiedad, desgaste 0,02% de valor comercial por unidad producida
- Equipos arrendados → valor = (precio arriendo) / rendimiento en condiciones reales de obra
- Herramientas: solo listadas, no valorizadas (salvo que sean específicas de una partida)
- Coherencia entre equipos declarados y método constructivo`;
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function formatEett(eett) {
  if (!eett?.text) return '\n### EETT\n_(No entregado)_\n';
  const flags = [];
  if (eett.hasHighlights) flags.push('contiene texto resaltado en amarillo');
  if (eett.hasStrikethrough) flags.push('contiene texto tachado');
  if (!eett.hasHighlights) flags.push('⚠ NO se detectaron resaltados en amarillo');
  if (!eett.hasStrikethrough) flags.push('⚠ NO se detectaron tachados');

  const snippet = eett.text.length > 30000 ? eett.text.slice(0, 30000) + '\n[... TRUNCADO ...]' : eett.text;
  return `\n### EETT — Especificaciones Técnicas
Indicadores de formato: ${flags.join('; ')}
Palabras totales: ${eett.wordCount ?? 'N/D'}

\`\`\`
${snippet}
\`\`\`\n`;
}

function formatExcel(label, data) {
  if (!data?.sheets?.length) return label ? `\n### ${label}\n_(No entregado)_\n` : '_(No entregado)_\n';

  let out = label ? `\n### ${label}\n` : '';
  out += `Hojas: ${data.sheets.length} | Filas totales con datos: ${data.totalRows ?? 'N/D'}\n\n`;

  data.sheets.slice(0, 20).forEach(sheet => {
    out += `**Hoja: ${sheet.name}**\n`;
    if (sheet.rows?.length) {
      sheet.rows.slice(0, 80).forEach(row => {
        const cells = row.map(c => {
          if (!c) return '(vacío)';
          let val = c.value ?? '';
          if (c.formula) val += ` [fórmula: ${c.formula}]`;
          return String(val);
        });
        out += cells.join(' | ') + '\n';
      });
      if (sheet.rows.length > 80) out += `... (${sheet.rows.length - 80} filas más)\n`;
    }
    out += '\n';
  });

  if (data.sheets.length > 20) out += `[... ${data.sheets.length - 20} hojas más no mostradas]\n`;
  return out;
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`[API] Servidor corriendo en http://localhost:${PORT}`));
