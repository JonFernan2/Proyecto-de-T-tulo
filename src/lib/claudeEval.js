const BATCH_SIZE = 15;

/**
 * Calls the local Express server to evaluate a delivery with Claude.
 * Images are handled separately via verifyImages().
 */
export async function evaluateWithClaude({ delivery, studentName, filesMap, images }) {
  const payload = {
    eett: filesMap.eett
      ? {
          text: filesMap.eett.text,
          hasHighlights: filesMap.eett.hasHighlights,
          hasStrikethrough: filesMap.eett.hasStrikethrough,
          wordCount: filesMap.eett.wordCount,
        }
      : null,
    cubicaciones: filesMap.cubicaciones ?? null,
    cotizaciones: filesMap.cotizaciones ?? null,
    cotizacionesFiles: (filesMap.cotizacionesFiles ?? []).map(f => ({
      name: f.name,
      parsed: f.parsed?.text !== undefined
        ? { text: f.parsed.text, hasHighlights: f.parsed.hasHighlights, hasStrikethrough: f.parsed.hasStrikethrough, wordCount: f.parsed.wordCount }
        : f.parsed,
    })),
    apu: filesMap.apu ?? null,
    pdfNames: filesMap.respaldoPdfNames ?? [],
  };

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
