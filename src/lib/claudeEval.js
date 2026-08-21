/**
 * Calls the local Express server to evaluate a delivery with Claude.
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
    images: images ?? [],
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
