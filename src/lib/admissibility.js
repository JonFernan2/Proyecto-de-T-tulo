/**
 * Run admissibility checks for E1 or E2.
 * Returns { passed: bool, results: CheckResult[] }
 *
 * Checks are presence-based: verifica que cada entregable exista y tenga
 * contenido mínimo. Claude evalúa la calidad real en el paso siguiente.
 */
export function runAdmissibility(delivery, filesMap) {
  const results = [];

  // ── EETT ─────────────────────────────────────────────────────────────────────
  const eettPresent = Boolean(filesMap.eett?.text?.trim());
  results.push({
    id: 'eett',
    label: 'EETT (obligatorio)',
    passed: eettPresent,
    detail: eettPresent
      ? `Presente. ${filesMap.eett.wordCount?.toLocaleString('es-CL') ?? '?'} palabras.`
      : 'No se encontró archivo EETT.',
  });

  // ── Cubicaciones ─────────────────────────────────────────────────────────────
  const cubPresent = hasExcelContent(filesMap.cubicaciones);
  results.push({
    id: 'cubicaciones',
    label: 'Listado + Cubicaciones (obligatorio)',
    passed: cubPresent,
    detail: cubPresent
      ? `Presente. ${filesMap.cubicaciones.sheets?.length ?? '?'} hoja(s), ${filesMap.cubicaciones.totalRows?.toLocaleString('es-CL') ?? '?'} filas con datos.`
      : 'No se encontró archivo de cubicaciones.',
  });

  // ── Cotizaciones ─────────────────────────────────────────────────────────────
  const cotFiles = filesMap.cotizacionesFiles ?? [];
  const wordCotFiles = cotFiles.filter(f => f.parsed?.text !== undefined);
  const excelCotFile = filesMap.cotizaciones?.sheets ? filesMap.cotizaciones : null;

  let cotPassed, cotDetail, forceScore;

  if (excelCotFile) {
    cotPassed = true;
    cotDetail = `Presente en Excel. ${excelCotFile.sheets?.length ?? '?'} hoja(s).`;
  } else if (wordCotFiles.length > 0) {
    cotPassed = false;
    forceScore = 1.0;
    cotDetail = `Formato incorrecto: ${wordCotFiles.length} archivo(s) Word. La pauta exige Excel. Criterio se calificará con nota 1,0.`;
  } else {
    cotPassed = false;
    forceScore = 1.0;
    cotDetail = 'No se encontró archivo de cotizaciones. Criterio se calificará con nota 1,0.';
  }

  results.push({
    id: 'cotizaciones',
    label: 'Cotizaciones',
    passed: cotPassed,
    detail: cotDetail,
    forceScore,
  });

  // ── APU (solo E2) ────────────────────────────────────────────────────────────
  if (delivery === 'E2') {
    const apuPresent = hasExcelContent(filesMap.apu);
    results.push({
      id: 'apu',
      label: 'APU Cartillas (obligatorio)',
      passed: apuPresent,
      detail: apuPresent
        ? `Presente. ${filesMap.apu.sheets?.length ?? '?'} hoja(s).`
        : 'No se encontró archivo APU.',
    });
  }

  const passed = results.every(r => r.passed);
  return { passed, results };
}

function hasExcelContent(data) {
  return Boolean(data?.sheets?.length > 0 && data.totalRows > 0);
}
