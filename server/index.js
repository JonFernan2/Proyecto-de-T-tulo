import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildDeepReviewRequests,
  formatFindingsForConsolidation,
} from './deepReview.js';
import { cargarReferencias, reportarReferencias } from './referencias.js';
import {
  guardarRevision, guardarResultado, cargarRevisiones, eliminarRevision, reportarRevisiones,
} from './revisiones.js';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '500mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-5';

// Contexto de cada revisión en curso, indexado por batchId. Se respalda en
// disco: el lote tarda y un reinicio a medio camino lo dejaría huérfano —
// terminaría igual y se cobraría, sin forma de recogerlo.
const revisiones = cargarRevisiones();

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─── Tool schemas ─────────────────────────────────────────────────────────────
const EVALUATE_TOOL = {
  name: 'submit_evaluation',
  description: 'Envía la evaluación completa de la entrega del estudiante.',
  input_schema: {
    type: 'object',
    properties: {
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            score: { type: 'number' },
            justification: { type: 'string' },
          },
          required: ['id', 'score', 'justification'],
        },
      },
      resumen: {
        type: 'array',
        description:
          'Cuadro resumen de la revisión: entre 6 y 12 puntos concretos verificados. ' +
          'Cada fila es un aspecto puntual de la pauta con su hallazgo concreto.',
        items: {
          type: 'object',
          properties: {
            aspecto: {
              type: 'string',
              description: 'Punto verificado, breve. Ej: "Resaltado de modificaciones en EETT".',
            },
            hallazgo: {
              type: 'string',
              description:
                'Hallazgo en voz impersonal ("se detecta...", "se observan..."), con dato ' +
                'concreto (cantidad, partida, celda o valor). Máx 2 líneas.',
            },
            estado: {
              type: 'string',
              enum: ['Cumple', 'Parcial', 'No cumple', 'No verificable'],
            },
          },
          required: ['aspecto', 'hallazgo', 'estado'],
        },
      },
      fortalezas: {
        type: 'array',
        description: '2 a 4 aspectos bien logrados, concretos.',
        items: { type: 'string' },
      },
      mejoras: {
        type: 'array',
        description: '3 a 6 acciones concretas de mejora para la próxima entrega.',
        items: { type: 'string' },
      },
      globalScore: { type: 'number' },
      globalJustification: { type: 'string' },
    },
    required: ['criteria', 'resumen', 'fortalezas', 'mejoras', 'globalScore', 'globalJustification'],
  },
};

const IMAGE_TOOL = {
  name: 'submit_image_findings',
  description: 'Envía los hallazgos de la revisión del respaldo fotográfico.',
  input_schema: {
    type: 'object',
    properties: {
      findings: { type: 'string' },
      hasErrors: { type: 'boolean' },
      errorCount: { type: 'integer' },
    },
    required: ['findings', 'hasErrors', 'errorCount'],
  },
};

// ─── Image verification endpoint ─────────────────────────────────────────────
app.post('/api/verify-images', async (req, res) => {
  try {
    const { studentName, cubicacionesContext, images, batchIndex, totalBatches } = req.body;

    const contentBlocks = [
      {
        type: 'text',
        text: `Eres el docente Jonathan Fernando Muñoz Alvarez revisando el respaldo fotográfico de cubicaciones del estudiante ${studentName}.

Compara las imágenes adjuntas (tanda ${batchIndex + 1} de ${totalBatches}) contra las fórmulas y resultados del Excel de cubicaciones.

CONTEXTO DEL EXCEL DE CUBICACIONES:
${cubicacionesContext}

Por cada imagen analizada indica:
- Qué partida/actividad representa (si es legible)
- Si los cálculos manuales son coherentes con las fórmulas del Excel
- Errores aritméticos o inconsistencias con valor concreto
- Si la imagen es ilegible, indícalo brevemente

Redacta en VOZ IMPERSONAL con "se" (pasiva refleja), sin primera persona y sin
atribuir la revisión a ninguna herramienta. Así: "Se observa que el cálculo manual
de la partida 2.3 arroja 45,80 m2, mientras que la hoja Excel informa 45,00 m2".
Nunca: "encontré", "revisé", "el sistema detecta". Sé específico con los números.`,
      },
    ];

    images.forEach(({ data, mediaType }) => {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    });

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [IMAGE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_image_findings' },
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) throw new Error('La IA no devolvió hallazgos de imágenes.');

    res.json({ ok: true, result: toolUse.input });
  } catch (err) {
    console.error('[verify-images] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
      tools: [EVALUATE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_evaluation' },
      messages: [{ role: 'user', content: userContent }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) throw new Error('La IA no devolvió una evaluación válida.');

    res.json({ ok: true, evaluation: toolUse.input });
  } catch (err) {
    console.error('[evaluate] ERROR:', err.message);
    console.error('[evaluate] status:', err.status);
    console.error('[evaluate] cause:', err.cause?.message ?? err.cause ?? '(sin causa)');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Revisión profunda por tandas (Batch API) ────────────────────────────────

// 0. Revisiones que quedaron a medio camino. El lote sigue procesándose del
//    lado de la API aunque se cierre el navegador, así que hay que poder
//    retomarlas en vez de relanzarlas y pagarlas dos veces.
app.get('/api/deep-review/pendientes', async (_req, res) => {
  try {
    const revs = [];
    for (const [batchId, ctx] of revisiones) {
      const base = {
        batchId,
        studentName: ctx.studentName,
        delivery: ctx.delivery,
        plan: ctx.plan,
        creado: ctx.creado,
        totalTandas: (ctx.plan ?? []).reduce((n, p) => n + (p.batches ?? 0), 0),
        // Al retomar tras cerrar la aplicación, esta es la única copia que
        // queda de la admisibilidad, y el informe la imprime.
        admissibility: ctx.payload?.admissibility ?? null,
      };

      // Ya consolidada: no hace falta consultar la API, el resultado está aquí.
      if (ctx.estado === 'completada') {
        revs.push({
          ...base,
          estado: 'completada',
          completado: ctx.completado,
          nota: ctx.evaluation?.globalScore ?? null,
          cobertura: ctx.cobertura ?? null,
        });
        continue;
      }

      let estado = 'desconocido';
      let counts = null;
      try {
        const batch = await anthropic.messages.batches.retrieve(batchId);
        const c = batch.request_counts ?? {};
        estado = batch.processing_status;
        counts = {
          procesando: c.processing ?? 0,
          listas: c.succeeded ?? 0,
          conError: (c.errored ?? 0) + (c.canceled ?? 0) + (c.expired ?? 0),
        };
      } catch {
        // El lote ya no existe del lado de la API: se informa igual para que
        // pueda descartarse desde la pantalla.
        estado = 'no encontrado';
      }
      revs.push({ ...base, estado, counts });
    }

    revs.sort((a, b) => b.creado - a.creado);
    res.json({ ok: true, pendientes: revs });
  } catch (err) {
    console.error('[deep-review/pendientes] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Readoptar un lote cuyo registro se perdió: el servidor olvidó a qué
// estudiante correspondía, pero el lote sigue del lado de la API y sus
// resultados viven 29 días. Con los archivos del estudiante se reconstruye el
// contexto y se consolida sin volver a enviar las tandas — una sola llamada en
// vez de todas otra vez.
app.post('/api/deep-review/adoptar', async (req, res) => {
  try {
    const { batchId, delivery, studentName, payload } = req.body;
    if (!batchId) return res.status(400).json({ ok: false, error: 'Falta el ID del lote.' });

    const ya = revisiones.get(batchId);
    if (ya?.estado === 'completada') {
      return res.json({ ok: true, batchId, yaConsolidada: true, totalTandas: 0, plan: ya.plan ?? [] });
    }

    let batch;
    try {
      batch = await anthropic.messages.batches.retrieve(batchId);
    } catch {
      return res.status(404).json({
        ok: false,
        error: `No existe el lote ${batchId} en esta cuenta de Anthropic. `
             + 'Revisa el identificador en console.anthropic.com.',
      });
    }

    // El plan se reconstruye a partir de los archivos, sin enviar nada: sirve
    // para mostrar el alcance y para avisar si los archivos no son los mismos
    // con los que se lanzó el lote.
    const { listadoText } = splitListadoYCubicaciones(payload.cubicaciones, payload.listado);
    const { requests, plan } = buildDeepReviewRequests({
      delivery,
      studentName,
      model: MODEL,
      rubric: getRubric(delivery),
      listadoText,
      referencias: cargarReferencias(delivery).texto,
      payload,
    });

    const c = batch.request_counts ?? {};
    const totalLote = (c.processing ?? 0) + (c.succeeded ?? 0) + (c.errored ?? 0)
                    + (c.canceled ?? 0) + (c.expired ?? 0);

    const ctx = { delivery, studentName, payload, plan, creado: Date.now() };
    revisiones.set(batchId, ctx);
    guardarRevision(batchId, ctx);

    console.log(`[deep-review] ${studentName}: lote ${batchId} readoptado · ${totalLote} tandas en la API`);
    res.json({
      ok: true,
      batchId,
      plan,
      totalTandas: totalLote || requests.length,
      estado: batch.processing_status,
      // Si no cuadran, los archivos cargados no son los del lote: la
      // consolidación saldría describiendo otra entrega.
      coincide: totalLote === requests.length,
      tandasEnElLote: totalLote,
      tandasSegunArchivos: requests.length,
    });
  } catch (err) {
    console.error('[deep-review/adoptar] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Recuperar la evaluación de una revisión ya consolidada, para repasarla,
// ajustar notas y exportar sin volver a correr ni pagar nada.
app.get('/api/deep-review/resultado', (req, res) => {
  const ctx = revisiones.get(req.query.batchId);
  if (ctx?.estado !== 'completada') {
    return res.status(404).json({ ok: false, error: 'Esa revisión no está consolidada.' });
  }
  res.json({
    ok: true,
    studentName: ctx.studentName,
    delivery: ctx.delivery,
    evaluation: ctx.evaluation,
    cobertura: ctx.cobertura ?? null,
    admissibility: ctx.payload?.admissibility ?? null,
  });
});

// Diagnóstico: por qué falló un lote. Los motivos vienen en los resultados y
// sin esto un lote entero caído no deja rastro de la causa.
app.get('/api/deep-review/errores', async (req, res) => {
  try {
    const porTipo = new Map();
    const porMotivo = new Map();
    let total = 0;
    let exitosas = 0;
    let muestra = null;   // primer resultado fallido, crudo, para diagnosticar

    for await (const entry of await anthropic.messages.batches.results(req.query.batchId)) {
      total++;
      if (entry.result?.type === 'succeeded') { exitosas++; continue; }

      const tipo = entry.result?.type ?? 'sin tipo';
      porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + 1);

      // Un lote "expired" o "canceled" no trae error: el tipo ES el motivo.
      const err = entry.result?.error?.error ?? entry.result?.error;
      const motivo = err?.message ?? err?.type ?? tipo;
      porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);

      if (!muestra) muestra = JSON.parse(JSON.stringify(entry.result)).toString === undefined
        ? entry.result
        : entry.result;
    }

    const motivos = [...porMotivo.entries()].map(([motivo, veces]) => ({ motivo, veces }));
    const tipos = [...porTipo.entries()].map(([tipo, veces]) => ({ tipo, veces }));

    console.log(`[deep-review/errores] ${req.query.batchId}: ${exitosas}/${total} exitosas`);
    for (const t of tipos) console.log(`  · ${t.veces}× tipo "${t.tipo}"`);
    for (const m of motivos) console.log(`  · ${m.veces}× ${m.motivo}`);
    if (muestra) console.log('  estructura cruda:', JSON.stringify(muestra).slice(0, 800));

    res.json({
      ok: true, total, exitosas, fallidas: total - exitosas,
      tipos, motivos,
      muestra: muestra ? JSON.parse(JSON.stringify(muestra)) : null,
    });
  } catch (err) {
    console.error('[deep-review/errores] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Ver los hallazgos crudos de cualquier lote terminado, aunque su contexto ya
// no esté. Los resultados viven 29 días del lado de la API: sin esto, descartar
// una revisión por error dejaba inaccesible un trabajo ya pagado.
app.get('/api/deep-review/hallazgos', async (req, res) => {
  try {
    const findings = [];
    let total = 0;
    let fallidas = 0;

    for await (const entry of await anthropic.messages.batches.results(req.query.batchId)) {
      total++;
      if (entry.result?.type !== 'succeeded') { fallidas++; continue; }
      const toolUse = entry.result.message.content.find(b => b.type === 'tool_use');
      if (toolUse) findings.push({ custom_id: entry.custom_id, result: toolUse.input });
      else fallidas++;
    }

    if (!findings.length) {
      return res.status(404).json({
        ok: false,
        error: `El lote tiene ${total} tanda(s) y ninguna con resultados utilizables.`,
      });
    }

    const { texto, totales } = formatFindingsForConsolidation(findings);
    const ctx = revisiones.get(req.query.batchId);

    const cabecera =
      `HALLAZGOS DEL LOTE ${req.query.batchId}\n` +
      (ctx ? `Estudiante: ${ctx.studentName} — ${ctx.delivery}\n` : '') +
      `Tandas: ${findings.length} de ${total} recogidas` +
      (fallidas ? ` (${fallidas} sin resultado)` : '') + `\n` +
      `Hojas revisadas: ${totales.hojas} · con errores de cálculo: ${totales.errores} · ` +
      `sin fórmulas visibles: ${totales.sinFormula}\n` +
      '═'.repeat(70) + '\n';

    res.type('text/plain; charset=utf-8').send(cabecera + texto);
  } catch (err) {
    console.error('[deep-review/hallazgos] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Descartar una revisión que ya no sirve (lote caducado o relanzada).
// Quita el registro de aquí. OJO: el lote sigue corriendo del lado de la API y
// se sigue cobrando — para detenerlo hay que cancelarlo, más abajo.
app.delete('/api/deep-review/pendientes', (req, res) => {
  const { batchId } = req.query;
  revisiones.delete(batchId);
  eliminarRevision(batchId);
  console.log(`[deep-review] descartada ${batchId} (el lote sigue en la API)`);
  res.json({ ok: true });
});

// Detiene el lote de verdad. Las tandas que aún no empezaron no se cobran; las
// que ya están en curso pueden alcanzar a terminar y sí se cobran, así que
// cancelar recupera parte del saldo, no todo.
app.post('/api/deep-review/cancelar', async (req, res) => {
  try {
    const { batchId } = req.body;
    if (!batchId) return res.status(400).json({ ok: false, error: 'Falta el ID del lote.' });

    const batch = await anthropic.messages.batches.cancel(batchId);
    const c = batch.request_counts ?? {};

    revisiones.delete(batchId);
    eliminarRevision(batchId);

    console.log(`[deep-review] CANCELADO ${batchId} · ${c.succeeded ?? 0} tandas ya completadas`);
    res.json({
      ok: true,
      estado: batch.processing_status,
      completadas: c.succeeded ?? 0,
      enCurso: c.processing ?? 0,
    });
  } catch (err) {
    console.error('[deep-review/cancelar] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// 1. Lanza la revisión: parte los libros en tandas y las envía al Batch API.
app.post('/api/deep-review/start', async (req, res) => {
  try {
    const { delivery, studentName, payload } = req.body;

    const { listadoText } = splitListadoYCubicaciones(payload.cubicaciones, payload.listado);

    const { requests, plan } = buildDeepReviewRequests({
      delivery,
      studentName,
      model: MODEL,
      rubric: getRubric(delivery),
      listadoText,
      referencias: cargarReferencias(delivery).texto,
      payload,
    });

    if (!requests.length) {
      return res.status(400).json({
        ok: false,
        error: 'No hay hojas que revisar. Verifica que los archivos Excel se hayan leído correctamente.',
      });
    }

    const batch = await anthropic.messages.batches.create({ requests });

    const ctx = { delivery, studentName, payload, plan, creado: Date.now() };
    revisiones.set(batch.id, ctx);
    guardarRevision(batch.id, ctx);

    console.log(`[deep-review] ${studentName}: ${requests.length} tandas enviadas (batch ${batch.id})`);
    res.json({ ok: true, batchId: batch.id, totalTandas: requests.length, plan });
  } catch (err) {
    console.error('[deep-review/start] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Consulta el avance. El Batch API es asíncrono: puede tardar minutos.
app.get('/api/deep-review/status', async (req, res) => {
  try {
    const batch = await anthropic.messages.batches.retrieve(req.query.batchId);
    const c = batch.request_counts ?? {};
    const listas = c.succeeded ?? 0;
    const conError = (c.errored ?? 0) + (c.canceled ?? 0) + (c.expired ?? 0);

    // Se registra cada consulta: sin esto no hay forma de saber desde el CMD si
    // la revisión avanza o si quedó detenida.
    const ctx = revisiones.get(req.query.batchId);
    const transcurrido = ctx ? Math.round((Date.now() - ctx.creado) / 1000) : 0;
    console.log(
      `[deep-review] ${ctx?.studentName ?? req.query.batchId}: ${batch.processing_status} · ` +
      `${listas} listas · ${c.processing ?? 0} en curso` +
      `${conError ? ` · ${conError} con error` : ''} · ${transcurrido}s`,
    );

    res.json({
      ok: true,
      status: batch.processing_status,          // in_progress | canceling | ended
      batchId: req.query.batchId,
      transcurrido,
      counts: { procesando: c.processing ?? 0, listas, conError },
    });
  } catch (err) {
    console.error('[deep-review/status] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Recoge los hallazgos de todas las tandas y produce la evaluación final.
app.post('/api/deep-review/finish', async (req, res) => {
  try {
    const { batchId } = req.body;
    const ctx = revisiones.get(batchId);

    // Ya consolidada: se devuelve lo guardado. Rehacerla costaría de nuevo.
    if (ctx?.estado === 'completada') {
      return res.json({ ok: true, evaluation: ctx.evaluation, cobertura: ctx.cobertura });
    }

    if (!ctx) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró el registro de esta revisión. Si el lote sigue en '
             + 'console.anthropic.com, habrá que volver a lanzarla.',
      });
    }

    // Recoger resultados de cada tanda
    const findings = [];
    const fallidas = [];
    for await (const entry of await anthropic.messages.batches.results(batchId)) {
      if (entry.result?.type !== 'succeeded') {
        // El motivo del fallo viene aquí y antes se descartaba, dejando sin
        // diagnóstico un lote entero caído.
        const err = entry.result?.error?.error ?? entry.result?.error ?? {};
        fallidas.push({
          custom_id: entry.custom_id,
          tipo: entry.result?.type ?? 'desconocido',
          motivo: err.message ?? err.type ?? JSON.stringify(err).slice(0, 300),
        });
        continue;
      }
      const toolUse = entry.result.message.content.find(b => b.type === 'tool_use');
      if (toolUse) findings.push({ custom_id: entry.custom_id, result: toolUse.input });
      else fallidas.push({ custom_id: entry.custom_id, tipo: 'sin tool_use', motivo: 'la respuesta no trae el resultado esperado' });
    }

    if (fallidas.length) {
      console.error(`[deep-review] ${ctx.studentName}: ${fallidas.length} tanda(s) fallidas`);
      // Los motivos se repiten entre tandas; se agrupan para no llenar la consola.
      const porMotivo = new Map();
      for (const f of fallidas) porMotivo.set(f.motivo, (porMotivo.get(f.motivo) ?? 0) + 1);
      for (const [motivo, n] of porMotivo) console.error(`  · ${n}× ${motivo}`);
    }

    if (!findings.length) {
      const motivos = [...new Set(fallidas.map(f => f.motivo))].slice(0, 3).join(' · ');
      throw new Error(
        `Las ${fallidas.length} tanda(s) fallaron. Motivo: ${motivos || 'no informado por la API'}`,
      );
    }

    const { texto, totales } = formatFindingsForConsolidation(findings);

    // Evaluación final sobre los hallazgos reales de todas las hojas
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: buildSystemPrompt(ctx.delivery),
      tools: [EVALUATE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_evaluation' },
      messages: [{ role: 'user', content: buildConsolidationContent(ctx, texto, totales) }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) throw new Error('No se pudo consolidar la evaluación final.');

    const cobertura = {
      ...totales,
      tandasFallidas: fallidas.length,
      motivosFallo: [...new Set(fallidas.map(f => f.motivo))].slice(0, 5),
    };

    guardarResultado(batchId, { evaluation: toolUse.input, cobertura });
    revisiones.set(batchId, {
      ...ctx, estado: 'completada', completado: Date.now(),
      evaluation: toolUse.input, cobertura,
      payload: {
        eett: ctx.payload?.eett ?? null,
        admissibility: ctx.payload?.admissibility ?? null,
      },
    });

    console.log(`[deep-review] ${ctx.studentName}: consolidado · ${totales.hojas} hojas · ${totales.errores} con errores`);
    res.json({
      ok: true,
      evaluation: toolUse.input,
      cobertura,
    });
  } catch (err) {
    console.error('[deep-review/finish] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function buildConsolidationContent(ctx, hallazgosTexto, totales) {
  const { delivery, studentName, payload } = ctx;

  let text = `## CORRECCIÓN ${delivery} — Estudiante: ${studentName}\n\n`;
  text += getRubric(delivery);
  text += cargarReferencias(delivery).texto;
  text += '\n\n---\n\n';
  text += formatHechos(payload.admissibility, payload);

  text += `REVISIÓN HOJA POR HOJA YA REALIZADA
El trabajo fue revisado completo, hoja por hoja. Abajo están los hallazgos
agrupados por documento. NO son una muestra: cubren ${totales.hojas} hoja(s).

Totales verificados: ${totales.errores} hoja(s) con errores de cálculo · ${totales.sinFormula} hoja(s) sin fórmulas visibles.

Usa estos hallazgos como base de la evaluación. Cita partidas, celdas y valores
concretos sacados de aquí — hay material real, no generalices. Si un documento no
aparece abajo, es que no tenía hojas que revisar; indícalo así, no afirmes que falta.
Recuerda el registro impersonal: "se detecta", "se observa", "no se visualizan".
${hallazgosTexto}
---

`;

  text += `<seccion id="eett" documento="Especificaciones Técnicas">\n`;
  text += formatEett(payload.eett);
  text += `</seccion>\n\n`;

  text += `---\nEntrega la evaluación final: notas por criterio, cuadro resumen, fortalezas y mejoras.`;
  return text;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────
function buildSystemPrompt(delivery) {
  return `Eres el docente Jonathan Fernando Muñoz Alvarez de la asignatura "Formulación de Proyecto de Título", modalidad Licitación, Ingeniería en Construcción, Universidad Viña del Mar (UVM), Chile.

REGISTRO DE TONO (obligatorio en todo texto que escribas):
Redacta en VOZ IMPERSONAL con "se" (pasiva refleja), que es el registro académico
formal chileno para este tipo de informe. Sin primera persona y sin atribuir la
revisión a ninguna herramienta.

Así SÍ:
- "Se detecta que las modificaciones no fueron destacadas en amarillo."
- "Se observan incongruencias entre la cubicación informada y la fórmula aplicada."
- "En las celdas D12 a D18 no se visualizan las fórmulas de cálculo."
- "Se encuentran diferencias entre el listado de actividades y las hojas cubicadas."
- "Se verifica el cumplimiento de los tres proveedores exigidos en la pauta."
- "Se sugiere incorporar el detalle de marca y formato en cada material."
- "La hoja 2.3 presenta un resultado de 45,00 m2 que no corresponde a la fórmula =B4*C4."

Así NO:
- Primera persona: "detecté", "encontré", "revisé", "verifiqué", "noté", "al revisar
  las EETT observé", "en mi revisión".
- Atribución a herramientas: "el sistema detecta", "la IA identifica", "el corrector
  determina", "el análisis automático arroja".

Cuando corresponda recomendar, usa "se sugiere", "se recomienda" o "deberá".

REGLA DE VERACIDAD (la más importante — no la incumplas):
1. Los bloques "MARCAS DE FORMATO VERIFICADAS" y "HECHOS VERIFICADOS" contienen
   conteos medidos directamente sobre los archivos. Son la verdad.
   Si dicen que hay 312 fragmentos resaltados, el estudiante SÍ resaltó: está
   PROHIBIDO escribir que no aplicó resaltados. Evalúa en cambio si son
   suficientes y pertinentes respecto del volumen del documento.
2. Si un archivo figura como presente en los hechos verificados, NUNCA escribas
   que no fue entregado. Si no ves su contenido, di que no pudiste revisarlo en
   detalle — no que falta.
3. Cuando un dato se marca como "no verificable" (por ejemplo un PDF sin
   anotaciones digitales), no afirmes ni que cumple ni que no cumple: indica que
   ese punto quedó pendiente de revisión visual.
4. No inventes partidas, valores ni proveedores. Cita solo lo que aparece en los
   archivos. Si necesitas ejemplificar un error, copia el dato textual.

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
Al escribir la justificación, indica en qué sección aparece el dato (ej: "En las cubicaciones se verifica...", "En las cotizaciones se observa...").

Evaluación cruzada que debes hacer:
- Actividades del listado que NO tienen hoja de cubicación (identifica cuáles)
- Materiales en cubicaciones sin cotización correspondiente (identifica cuáles)
- Inconsistencias de unidades entre listado, cubicaciones y cotizaciones

${delivery === 'E2' ? `EXIGENCIA DE COBERTURA (Entrega 2):
Esta entrega NO se filtra por admisibilidad: se evalúan todas.
Se espera que todas las partidas del itemizado tengan su cartilla APU (100%),
sin que sea obligatorio alcanzarlo. Con menos del 80% el estudiante NO APRUEBA
el ramo. El porcentaje real y las partidas sin cartilla vienen calculados en los
hechos verificados: úsalos tal cual y nómbralas.
Los pesos de cada criterio se mantienen sin alteración.` : `EXIGENCIA DE COBERTURA (pauta vigente):
Cubicaciones y cotizaciones exigen un mínimo del 50% de las actividades del
listado. El porcentaje real viene calculado en los hechos verificados:
- Cobertura ≥ 50% → el criterio se evalúa normalmente por su calidad
- Cobertura < 50% → el criterio no puede superar nota 3,5, e indícalo explícitamente
Los pesos de cada criterio se mantienen sin alteración.`}

La nota es HOLÍSTICA (no promedio matemático): los porcentajes son guía de importancia relativa.

ESCALA: 1,0 a 7,0 en pasos de 0,1. Nota mínima de aprobación: 4,0.

Cada justificación: 4-6 oraciones en voz impersonal, específica, con ejemplos
concretos (nombres de partidas, celdas, valores numéricos, nombres de hojas),
en español formal chileno.

Además del detalle por criterio debes completar:
- resumen: cuadro de 6 a 12 filas con los puntos concretos verificados
- fortalezas: 2 a 4 aspectos bien logrados
- mejoras: 3 a 6 acciones concretas para la próxima entrega
Todo en voz impersonal, sin mencionar sistemas, herramientas ni IA.`;
}

function buildUserContent(delivery, studentName, payload) {
  const { eett, cubicaciones, listado, cotizaciones, cotizacionesFiles, apu, pdfNames, respaldoPdfs, admissibility } = payload;

  const contentBlocks = [];

  let text = `## CORRECCIÓN ${delivery} — Estudiante: ${studentName}\n\n`;
  text += getRubric(delivery);
  text += cargarReferencias(delivery).texto;
  text += '\n\n---\n\n';
  text += formatHechos(admissibility, { cubicaciones, listado, cotizaciones, cotizacionesFiles, apu, pdfNames, respaldoPdfs });
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
      splitListadoYCubicaciones(cubicaciones, listado);

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
      splitListadoYCubicaciones(cubicaciones, listado);

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

  contentBlocks.push({
    type: 'text',
    text: '\n---\nDevuelve SOLO el JSON de evaluación. Recuerda: no mezcles contenido entre secciones en tus justificaciones.',
  });

  return contentBlocks;
}

// ─── Hechos verificados (inventario medido, no interpretado) ──────────────────
function formatHechos(admissibility, files) {
  let out = 'HECHOS VERIFICADOS — inventario medido sobre los archivos entregados.\n';
  out += 'Estos datos son exactos. Tu evaluación NO puede contradecirlos.\n\n';

  const inv = [];
  if (files.cubicaciones?.sheets?.length) {
    const incr = files.cubicaciones.totalEmbeddedImages ?? 0;
    inv.push(`- Excel de cubicaciones: ENTREGADO (${files.cubicaciones.sheets.length} hojas)`);
    if (incr > 0) {
      inv.push(`- Respaldo DENTRO de las hojas de cubicaciones: ${incr} imagen(es) incrustada(s). `
             + 'El respaldo existe; no escribas que falta.');
    }
  } else {
    inv.push('- Excel de cubicaciones: NO ENTREGADO');
  }

  if (files.listado?.sheets?.length) {
    inv.push(`- Listado/Itemizado como archivo aparte: ENTREGADO (${files.listado.sheets.length} hojas)`);
  }

  if (files.cotizaciones?.sheets?.length) {
    inv.push(`- Excel de cotizaciones: ENTREGADO (${files.cotizaciones.sheets.length} hojas)`);
  } else {
    const wordCots = (files.cotizacionesFiles ?? []).filter(f => f.parsed?.text !== undefined);
    inv.push(wordCots.length
      ? `- Cotizaciones: ENTREGADAS en Word (${wordCots.length} archivos), no en Excel`
      : '- Excel de cotizaciones: NO ENTREGADO');
  }

  const incrCot = files.cotizaciones?.totalEmbeddedImages ?? 0;
  if (incrCot > 0) {
    inv.push(`- Respaldo DENTRO de las hojas de cotizaciones: ${incrCot} imagen(es) incrustada(s).`);
  }

  const nPdf = files.pdfNames?.length ?? 0;
  inv.push(nPdf > 0
    ? `- PDFs de respaldo de cotizaciones: ${nPdf} archivo(s) ENTREGADOS — ${files.pdfNames.slice(0, 25).join(', ')}${nPdf > 25 ? ', …' : ''}`
    : '- PDFs de respaldo de cotizaciones: ninguno adjunto');

  for (const pdf of files.respaldoPdfs ?? []) {
    inv.push(pdf.escaneado
      ? `  · "${pdf.name}": ${pdf.numPages} páginas, ESCANEADO sin capa de texto. `
        + 'No se pudo leer su contenido. Indícalo como pendiente de revisión visual; '
        + 'NO concluyas que faltan cotizaciones.'
      : `  · "${pdf.name}": ${pdf.numPages} páginas, ${pdf.paginasConTexto} legibles y revisadas.`);
  }

  if (files.apu?.sheets?.length) {
    inv.push(`- Cartillas APU: ENTREGADAS (${files.apu.sheets.length} hojas)`);
  }

  out += inv.join('\n') + '\n\n';

  if (admissibility?.results?.length) {
    out += 'Verificación de admisibilidad (porcentajes ya calculados — úsalos tal cual):\n';
    for (const r of admissibility.results) {
      out += `- ${r.label}: ${r.detail}\n`;
    }
    out += '\n';
  }

  out += 'Si algo aparece aquí como ENTREGADO, no escribas que falta.\n\n---\n\n';
  return out;
}

// ─── Separar listado del resto de cubicaciones ────────────────────────────────
function splitListadoYCubicaciones(cubicacionesData, listadoData) {
  // El listado entregado como archivo propio manda: el libro de cubicaciones
  // se revisa entero y no se aparta ninguna de sus hojas.
  if (listadoData?.sheets?.length) {
    let listadoText = '';
    let nListado = 0;
    for (const hoja of listadoData.sheets) {
      listadoText += `Hoja: "${hoja.name}" — ${hoja.rows.length} filas\n\n`;
      hoja.rows.slice(0, 400).forEach(row => {
        const cells = row.map(c => (!c ? '' : String(c.value ?? ''))).filter(Boolean);
        if (cells.length) { listadoText += cells.join(' | ') + '\n'; nListado++; }
      });
      if (hoja.rows.length > 400) listadoText += `... (${hoja.rows.length - 400} filas más)\n`;
      listadoText += '\n';
    }
    return {
      listadoText,
      cubicacionesText: formatCubSheets(cubicacionesData?.sheets ?? []),
      nListado,
      nCubSheets: cubicacionesData?.sheets?.length ?? 0,
    };
  }

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

  return {
    listadoText,
    cubicacionesText: formatCubSheets(cubSheets),
    nListado,
    nCubSheets: cubSheets.length,
  };
}

function formatCubSheets(cubSheets) {
  let out = `Total hojas de cubicaciones: ${cubSheets.length}\n`;
  const sheetsToShow = cubSheets.slice(0, 20);
  out += `(Se muestran las primeras ${sheetsToShow.length} hojas)\n\n`;
  sheetsToShow.forEach(sheet => {
    out += `**Hoja: ${sheet.name}**\n`;
    sheet.rows.slice(0, 60).forEach(row => {
      const cells = row.map(c => {
        if (!c) return '';
        let val = String(c.value ?? '');
        if (c.formula) val += ` [fórmula: ${c.formula}]`;
        return val;
      }).filter(Boolean);
      if (cells.length) out += cells.join(' | ') + '\n';
    });
    if (sheet.rows.length > 60) out += `... (${sheet.rows.length - 60} filas más)\n`;
    out += '\n';
  });
  if (cubSheets.length > 20) out += `[... ${cubSheets.length - 20} hojas más no mostradas]\n`;
  return out;
}

// ─── Rubric text ──────────────────────────────────────────────────────────────
function getRubric(delivery) {
  if (delivery === 'E1') {
    return `## RÚBRICA ENTREGA 1 — Guía de Desarrollo Proyecto de Título (UVM)

EXIGENCIA MÍNIMA DE COBERTURA: 50% tanto en cubicaciones como en cotizaciones,
medido contra el número de actividades del listado. Bajo ese 50% el criterio no
puede superar nota 3,5. Los pesos de cada criterio NO cambian.

### 1. EETT — Especificaciones Técnicas (peso 25%, id: "eett")
Según la pauta el estudiante debe:
- Destacar en AMARILLO toda modificación o incorporación de información
- TACHAR toda eliminación de información
- Detallar cada material con: calidad, materialidad, tipo, formato, color, modelo
  y marca/proveedor — "de modo que no quede nada a interpretación del licitante"
- Convertir métodos constructivos, maquinarias, herramientas y equipos en
  SUGERENCIAS al contratista, nunca imposiciones
- En Edificación solo se revisan EETT de Arquitectura y Sanitarias (AALL, APF, APC, ALC)
- Entregar en formato WORD
Evalúa si las modificaciones resuelven ambigüedades reales del texto original
(ej: "lana mineral tipo AislánGlass o técnicamente superior" debe pasar a
especificar proveedor, espesor, formato y tipo concretos).

### 2. Listado de Actividades (peso 15%, id: "listado")
- ITEM: la numeración debe ser LA MISMA asignada en las EETT para esa actividad
- DESCRIPCIÓN: resumida, con características donde corresponda (medidas,
  espesores, dimensiones). Ej: "Radier H-25 (e=10cm)", "Porcelanato Budnik (45x20cm)"
- UNIDAD correcta según el tipo de partida:
  ml (guardapolvos, sellos, cercos) · m2 (revestimientos, cubiertas, pinturas)
  m3 (hormigón, excavaciones, rellenos) · kg (perfiles, enfierradura)
  un (puertas, artefactos sanitarios) · pm (madera en escuadría)
  gl (permisos, aseo y entrega, limpieza permanente)
- Formato Excel, orden coherente con la secuencia de las EETT

### 3. Cubicaciones (peso 35%, id: "cubicaciones")
- Fórmulas EXPLÍCITAS y desarrolladas, indicando a qué partida hacen referencia
- Al menos 2 decimales; NUNCA aproximar al entero superior
  (la pauta ejemplifica: 37.859,57 kg jamás debe informarse como 37.860 kg)
- Materiales medidos en UN siempre en enteros (no puede existir "4,8 unidades de WC")
- La cubicación informa "cuánto exactamente necesito para construir";
  las pérdidas y despuntes se agregan recién en el APU, no aquí
- Todo cálculo debe estar respaldado (planilla, hoja de apuntes o escaneo legible)
- En Edificación quedan EXCLUIDAS de evaluación: Instalaciones Eléctricas, CCDD,
  CCTV, Clima, Ascensores y Redes de Gases. NO penalices su ausencia.
- Sí deben analizarse en su totalidad: Sanitarias, Aguas Lluvias, Alcantarillado,
  Pavimentación y Urbanización
- En Obras Viales se analizan todas las partidas sin excepción

### 4. Cotizaciones (peso 25%, id: "cotizaciones")
- TRES cotizaciones de TRES proveedores distintos para cada material
- UNA sola cotización para herramientas, maquinarias y equipos
- Del año académico en curso; no tienen validez las de años anteriores
- Excepciones legítimas que NO debes penalizar: material de proveedor exclusivo
  (basta una cotización), material no distribuido en la región o en el país
  (vale respaldo por email del proveedor)
- Máquinas: debe informarse costo de arriendo/día o arriendo/hora
- Formato Excel con columnas: ITEM | Material | Proveedor 01 | 02 | 03 | Nombre archivo
- Tablas separadas para MATERIALES, HERRAMIENTAS, MÁQUINAS y EQUIPOS
- Respaldo en PDF identificado con nombre del material e ítem de la partida;
  si un PDF agrupa varios materiales se nombra "VARIOS" y se numera`;
  }

  return `## RÚBRICA ENTREGA 2 — Guía de Desarrollo Proyecto de Título (UVM)

EN ESTA ENTREGA NO SE FILTRA POR ADMISIBILIDAD: todas las entregas se evalúan.

COBERTURA DEL APU — se espera que TODAS las partidas del itemizado tengan su
cartilla (100%), aunque no es obligatorio alcanzarlo. Lo que sí es terminante:
con menos del 80% de las partidas con APU el estudiante NO APRUEBA el ramo, y
la nota final queda topada en 3,5 por bien resueltas que estén las cartillas
entregadas. El porcentaje ya viene calculado en los hechos verificados, con las
partidas que quedaron sin APU nombradas una por una: úsalo tal cual y cítalas.

Se registra en la Cartilla Excel del Anexo 01, siguiendo el orden del Listado de
Actividades de la Entrega 1. El estudiante puede poner UNA CARTILLA POR HOJA o
TODAS LAS CARTILLAS EN UNA MISMA HOJA: ambas formas son válidas y ninguna es
motivo de observación. Lo que se evalúa es qué partidas tienen cartilla y cómo
están hechas, no cómo se repartió el libro. Los pesos de cada criterio NO
cambian.

### 1. Métodos Constructivos (peso 30%, id: "metodos")
- Un método por cada actividad del listado de la Entrega 1
- Debe describir el PASO A PASO, especificando qué trabajador de la cuadrilla
  hace cada acción y qué materiales, herramientas o equipos manipula
- Debe indicar actividades PREVIAS y SUCESORAS (base para la Carta Gantt)
- Debe justificarse la decisión de fusionar o dividir actividades
- Nivel exigido: el "Método Mejorado" de los Ejemplos 6 y 7 de la pauta, que
  nombra materiales concretos (terciado estructural 11mm, bastidores pino 2"x3",
  clavos 2½"), herramientas por trabajador y la secuencia real de faena.
  Un método que solo dice "el maestro coordinará y los ayudantes clavarán"
  corresponde al "Método Deficiente" y debe calificarse como tal.
- Partidas de igual materialidad (ej: VA-1, VA-2, VA-3) comparten método:
  NO penalices que se repita, salvo que cambie la materialidad

### 2. APU — Mano de Obra (peso 25%, id: "mo")
- Cuadrilla básica: el grupo mínimo suficiente para ejecutar la partida
- Categorías MAESTRO, AYUDANTE y JORNAL; los dos primeros SIEMPRE con
  especialidad informada (carpintero, concretero, enfierrador, gasfíter, pintor)
- Nunca contabilizar supervisores, capataces ni jefes de terreno (van a Gastos Generales)
- COSTO DÍA = sueldo bruto mensual de mercado / 22 días hábiles
- Pesos chilenos SIN decimales, siempre redondeados hacia arriba
  ($10.504,1 → $10.505 y también $10.504,9 → $10.505)
- PARCIAL = Costo día / Rendimiento cuadrilla; TOTAL = Parcial × Cantidad
- Leyes sociales con porcentaje explícito
- Rendimiento SIEMPRE diario: Kg/día, M3/día, M2/día, Ml/día, Un/día
- Duración = Cubicación / Rendimiento

### 3. APU — Materiales + Fletes (peso 30%, id: "materiales")
- DESIGNACIÓN de cada material declarado en el método constructivo
- %P de pérdidas normalmente entre 2% y 7% (cortes, despuntes, manipulación,
  transporte, almacenamiento). No confundir pérdidas con robos.
- CANTIDAD (K): cuántas unidades se necesitan para materializar UNA unidad
  de la partida (1 m3, 1 m2, 1 kg, 1 ml)
- VALOR: el precio cotizado en la Entrega 1 — verifica la coherencia
- FLETES: todo material debe fletearse salvo que la cotización ya incluya
  transporte. Supuesto académico de 20 km con esta tabla:
    Camioneta Pick Up — 1,5 m3 — 1.000 kg — $15.000
    Camión ¾         — 28 m3  — 2.500 kg — $30.000
    Camión Standard  — 48 m3  — 5.000 kg — $50.000
    Camión Rampla    — 85 m3  — 30.000 kg — $100.000
  Valor unid = Valor viaje / CantxViaje; Total parcial FLE = K × Valor unid
  Verifica que el vehículo elegido sea coherente con el volumen y peso del material
- Fórmulas visibles en Excel, no solo resultados

### 4. APU — Equipos y Maquinarias (peso 15%, id: "equipos")
- Si el equipo tiene precio de venta INFERIOR a $300.000 se supone que la empresa
  lo adquiere: pasa a ser activo y solo se informa su DESGASTE, definido
  académicamente en 0,02% del valor comercial por unidad producida
  (ej: betonera de $275.000 → 275.000 × 0,02 / 100 = $55 por m3)
- Si es ARRENDADO: valor = precio de arriendo / rendimiento en condiciones
  REALES de obra, nunca ideales
  (ej: cargador frontal a $20.000/día con rendimiento 90 m3/día → $223/m3)
- Total parcial: arrendado = H×I ; propiedad de la empresa = H×I×K
- HERRAMIENTAS: solo se identifican, NO se valorizan, porque participan en más
  de una partida. Excepción: si la herramienta es específica de esa partida o no
  puede reutilizarse, debe valorizarse dentro de MATERIALES.
- Coherencia entre los equipos declarados aquí y el método constructivo`;
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function formatEett(eett) {
  if (!eett?.text) return '_(No entregado)_\n';

  let out = '';

  // Los conteos vienen de leer el XML del .docx (o las anotaciones del PDF).
  // Son HECHOS MEDIDOS: la evaluación debe basarse en ellos, no en suposiciones.
  if (eett.highlightCount !== undefined) {
    const hl = eett.highlightCount ?? 0;
    const st = eett.strikeCount ?? 0;

    out += `MARCAS DE FORMATO VERIFICADAS (conteo directo sobre el archivo):\n`;

    if (eett.verifiable === false) {
      out += `- El archivo es un PDF sin anotaciones digitales (probablemente exportado desde Word).\n`;
      out += `- Los resaltados y tachados NO son verificables automáticamente en este formato.\n`;
      out += `- NO afirmes que faltan resaltados o tachados: no hay evidencia en ningún sentido.\n`;
      out += `  Indica que ese punto debe revisarse visualmente sobre el documento.\n`;
    } else {
      out += `- Fragmentos RESALTADOS: ${hl}${eett.highlightColors?.length ? ` (colores: ${eett.highlightColors.join(', ')})` : ''}\n`;
      out += `- Fragmentos TACHADOS: ${st}\n`;
      out += `- Estos números son exactos. Si son mayores que cero, el estudiante SÍ marcó el documento;\n`;
      out += `  no afirmes lo contrario. Evalúa entonces si las marcas son suficientes y pertinentes\n`;
      out += `  respecto del volumen del documento (${eett.wordCount ?? '?'} palabras).\n`;

      if (eett.highlightSamples?.length) {
        out += `\nEjemplos de texto resaltado:\n`;
        eett.highlightSamples.forEach(s => { out += `  · "${s}"\n`; });
      }
      if (eett.strikeSamples?.length) {
        out += `\nEjemplos de texto tachado:\n`;
        eett.strikeSamples.forEach(s => { out += `  · "${s}"\n`; });
      }
    }
    out += '\n';
  }

  out += `Palabras totales: ${eett.wordCount ?? 'N/D'}\n\nCONTENIDO:\n`;
  const snippet = eett.text.length > 30000
    ? eett.text.slice(0, 30000) + '\n[... TRUNCADO ...]'
    : eett.text;
  out += `\`\`\`\n${snippet}\n\`\`\`\n`;

  return out;
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
app.listen(PORT, () => {
  console.log(`[API] Servidor corriendo en http://localhost:${PORT}`);
  reportarReferencias();
  reportarRevisiones(revisiones);
});
