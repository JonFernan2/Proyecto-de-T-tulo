const BATCH_SIZE = 15;
const POLL_MS = 8000;
// Tope de espera. El Batch API es asíncrono y puede tardar, pero sin límite la
// pantalla se queda girando para siempre cuando algo falla del lado de la API.
const MAX_ESPERA_MS = 30 * 60 * 1000;

/**
 * Revisión profunda: parte los libros en tandas, las manda al Batch API y
 * consolida los hallazgos en la evaluación final.
 *
 * A diferencia de evaluateWithClaude(), aquí se revisan TODAS las hojas, no una
 * muestra truncada. A cambio es asíncrona y tarda varios minutos.
 *
 * onProgress({ fase, plan, counts }) informa el avance.
 */
export async function deepReview({ delivery, studentName, filesMap, admissibility, onProgress, shouldCancel }) {
  const payload = buildPayload({ filesMap, admissibility });

  // 1. Lanzar las tandas
  onProgress?.({ fase: 'enviando' });
  const startRes = await fetch('/api/deep-review/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delivery, studentName, payload }),
  });
  const start = await startRes.json();
  if (!start.ok) throw new Error(start.error ?? 'No se pudo iniciar la revisión.');

  const { batchId, totalTandas, plan } = start;
  onProgress?.({ fase: 'revisando', plan, totalTandas, counts: { listas: 0, procesando: totalTandas, conError: 0 } });

  // 2. Esperar a que terminen
  const limite = Date.now() + MAX_ESPERA_MS;
  for (;;) {
    if (shouldCancel?.()) throw new Error('CANCELADO');

    if (Date.now() > limite) {
      throw new Error(
        `La revisión superó los ${Math.round(MAX_ESPERA_MS / 60000)} minutos de espera sin completarse. ` +
        'Suele deberse a que la cuenta de Anthropic se quedó sin créditos. ' +
        'Revisa el saldo en console.anthropic.com y vuelve a lanzarla.',
      );
    }

    await sleep(POLL_MS);

    const statusRes = await fetch(`/api/deep-review/status?batchId=${encodeURIComponent(batchId)}`);
    const status = await statusRes.json();
    if (!status.ok) throw new Error(status.error ?? 'Error consultando el avance.');

    onProgress?.({ fase: 'revisando', plan, totalTandas, counts: status.counts });

    if (status.status === 'ended') {
      // Terminó, pero puede haber terminado mal: si ninguna tanda salió bien,
      // consolidar no tiene sentido y el error real se pierde.
      if (status.counts.listas === 0) {
        throw new Error(
          `Las ${totalTandas} tanda(s) terminaron sin resultados utilizables. ` +
          'La causa habitual es falta de créditos en la cuenta de Anthropic. ' +
          'Verifica el saldo en console.anthropic.com.',
        );
      }
      break;
    }
  }

  // 3. Consolidar
  onProgress?.({ fase: 'consolidando', plan, totalTandas });
  const finishRes = await fetch('/api/deep-review/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId }),
  });
  const finish = await finishRes.json();
  if (!finish.ok) throw new Error(finish.error ?? 'No se pudo consolidar la revisión.');

  return { evaluation: finish.evaluation, cobertura: finish.cobertura };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Calls the local Express server to evaluate a delivery with Claude.
 * Images are handled separately via verifyImages().
 */
function buildPayload({ filesMap, admissibility }) {
  const e = filesMap.eett;
  return {
    eett: e
      ? {
          text: e.text,
          wordCount: e.wordCount,
          source: e.source,
          verifiable: e.verifiable,
          hasHighlights: e.hasHighlights,
          hasStrikethrough: e.hasStrikethrough,
          highlightCount: e.highlightCount,
          strikeCount: e.strikeCount,
          highlightSamples: e.highlightSamples,
          strikeSamples: e.strikeSamples,
          highlightColors: e.highlightColors,
        }
      : null,
    cubicaciones: filesMap.cubicaciones ?? null,
    listado: filesMap.listado ?? null,
    cotizaciones: filesMap.cotizaciones ?? null,
    cotizacionesFiles: (filesMap.cotizacionesFiles ?? []).map(f => ({
      name: f.name,
      ext: f.ext,
      parsed: f.parsed?.text !== undefined
        ? { text: f.parsed.text, wordCount: f.parsed.wordCount }
        : f.parsed,
    })),
    apu: filesMap.apu ?? null,
    pdfNames: filesMap.respaldoPdfNames ?? [],
    respaldoPdfs: filesMap.respaldoPdfs ?? [],
    admissibility: admissibility
      ? { results: admissibility.results.map(r => ({ label: r.label, detail: r.detail })) }
      : null,
  };
}

export async function evaluateWithClaude({ delivery, studentName, filesMap, admissibility }) {
  const payload = buildPayload({ filesMap, admissibility });

  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delivery, studentName, payload }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'Error desconocido del servidor');
  return data.evaluation;
}

/**
 * Verifies photographic backup images against cubicaciones Excel data.
 * Processes images in batches of BATCH_SIZE and returns merged findings.
 * onProgress(batchIndex, totalBatches) is called before each batch request.
 */
export async function verifyImages({ studentName, cubicaciones, images, onProgress }) {
  if (!images?.length) return null;

  // Build a compact cubicaciones context (first 15 sheets, 40 rows each)
  const cubicacionesContext = buildCubicacionesContext(cubicaciones);

  const batches = [];
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    batches.push(images.slice(i, i + BATCH_SIZE));
  }

  const allFindings = [];
  let totalErrors = 0;

  for (let i = 0; i < batches.length; i++) {
    if (onProgress) onProgress(i, batches.length);

    const res = await fetch('/api/verify-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName,
        cubicacionesContext,
        images: batches[i],
        batchIndex: i,
        totalBatches: batches.length,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.warn(`[verify-images] Tanda ${i + 1} falló:`, data.error);
      continue;
    }

    if (data.result?.findings) allFindings.push(data.result.findings);
    if (data.result?.errorCount) totalErrors += data.result.errorCount;
  }

  if (!allFindings.length) return null;

  return {
    findings: allFindings.join('\n\n'),
    totalImages: images.length,
    totalErrors,
  };
}

function buildCubicacionesContext(cubicaciones) {
  if (!cubicaciones?.sheets?.length) return '(Sin archivo de cubicaciones)';

  let ctx = `Total hojas: ${cubicaciones.sheets.length}\n\n`;
  cubicaciones.sheets.slice(0, 15).forEach(sheet => {
    ctx += `**Hoja: ${sheet.name}**\n`;
    sheet.rows.slice(0, 40).forEach(row => {
      const cells = row.map(c => {
        if (!c) return '';
        let val = String(c.value ?? '');
        if (c.formula) val += ` [fórmula: ${c.formula}]`;
        return val;
      }).filter(Boolean);
      if (cells.length) ctx += cells.join(' | ') + '\n';
    });
    ctx += '\n';
  });
  if (cubicaciones.sheets.length > 15) {
    ctx += `[... ${cubicaciones.sheets.length - 15} hojas más no incluidas en este contexto]\n`;
  }
  return ctx;
}
