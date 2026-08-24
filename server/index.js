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
  return `Eres un corrector experto de la asignatura "Formulación de Proyecto de Título", modalidad Licitación, de Ingeniería en Construcción de la Universidad Viña del Mar (UVM), Chile.

Tu tarea es evaluar la ${delivery} de un estudiante según la rúbrica entregada. La nota es HOLÍSTICA (no promedio matemático): los porcentajes son guía de importancia relativa, no fórmula. La nota final debe reflejar el conjunto de la entrega.

ESCALA: 1,0 a 7,0 en pasos de 0,5. Nota mínima para aprobar: 4,0.

RESPONDE ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta estructura exacta:
{
  "criteria": [
    { "id": "...", "score": X.X, "justification": "..." }
  ],
  "globalScore": X.X,
  "globalJustification": "..."
}

Cada justificación debe ser concisa (3-5 oraciones), específica (señala qué cumple y qué falta), en español formal chileno.`;
}

function buildUserContent(delivery, studentName, payload) {
  const { eett, cubicaciones, cotizaciones, cotizacionesFiles, apu, images, pdfNames } = payload;

  const contentBlocks = [];

  let text = `## CORRECCIÓN: ${delivery} — Estudiante: ${studentName}\n\n`;
  text += getRubric(delivery);
  text += '\n\n---\n\n## ARCHIVOS ENTREGADOS\n\n';

  if (delivery === 'E1') {
    text += formatEett(eett);
    text += formatExcel('LISTADO DE ACTIVIDADES Y CUBICACIONES', cubicaciones);
    // Cotizaciones: accept Word docs or Excel
    const wordCots = (cotizacionesFiles ?? []).filter(f => f.parsed?.text !== undefined);
    if (wordCots.length > 0) {
      text += `\n### COTIZACIONES (${wordCots.length} archivos Word)\n`;
      wordCots.forEach(({ name, parsed }) => {
        text += `\n**Archivo: ${name}**\n`;
        text += formatEett(parsed);
      });
    } else {
      text += formatExcel('COTIZACIONES', cotizaciones);
    }
    if (pdfNames?.length) {
      text += `\n### PDFs de respaldo cotizaciones\n${pdfNames.map(n => `- ${n}`).join('\n')}\n`;
    }
  } else {
    text += formatEett(eett);
    text += formatExcel('LISTADO + CUBICACIONES (referencia E1)', cubicaciones);
    const wordCots = (cotizacionesFiles ?? []).filter(f => f.parsed?.text !== undefined);
    if (wordCots.length > 0) {
      text += `\n### COTIZACIONES E1 (${wordCots.length} archivos Word)\n`;
      wordCots.forEach(({ name, parsed }) => {
        text += `\n**Archivo: ${name}**\n`;
        text += formatEett(parsed);
      });
    } else {
      text += formatExcel('COTIZACIONES (referencia E1)', cotizaciones);
    }
    text += formatExcel('APU — ANÁLISIS DE PRECIOS UNITARIOS', apu);
  }

  contentBlocks.push({ type: 'text', text });

  // Attach images for cubicaciones respaldo (vision)
  if (images?.length) {
    contentBlocks.push({
      type: 'text',
      text: `\n## IMÁGENES DE RESPALDO CUBICACIONES (${images.length} adjuntas)\nVerifica coherencia entre fórmulas del Excel y estos cálculos manuales:\n`,
    });
    images.slice(0, 5).forEach(({ data, mediaType }) => {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data },
      });
    });
  }

  contentBlocks.push({
    type: 'text',
    text: '\n\n---\nDevuelve SOLO el JSON de evaluación según la estructura indicada en el system prompt.',
  });

  return contentBlocks;
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
  if (!data?.sheets?.length) return `\n### ${label}\n_(No entregado)_\n`;

  let out = `\n### ${label}\n`;
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
