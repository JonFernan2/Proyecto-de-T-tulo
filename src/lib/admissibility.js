import { countListadoItems } from './fileParser.js';

/**
 * Run admissibility checks for E1 or E2.
 * Returns { passed: bool, results: CheckResult[] }
 *
 * Cubicaciones and cotizaciones use cross-reference: count listado items (N)
 * and compare against sheet count in each Excel (1 sheet per activity).
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

  // ── Cross-reference baseline ──────────────────────────────────────────────────
  // Count listado items (item# + unit + quantity) from cubicaciones Excel
  const nItems = countListadoItems(filesMap.cubicaciones);

  // ── Cubicaciones ─────────────────────────────────────────────────────────────
  const cubPresent = hasExcelContent(filesMap.cubicaciones);
  if (cubPresent) {
    const nSheets = filesMap.cubicaciones.sheets.length;
    // All sheets count as cubicaciones (1 sheet per activity is the expected format)
    const nCub = nSheets;

    if (nItems > 0) {
      const ratio = Math.min(nCub, nItems) / nItems;
      results.push({
        id: 'cubicaciones',
        label: 'Listado + Cubicaciones (obligatorio)',
        passed: true,
        detail: `${nCub} hoja(s) de cubicaciones · ${nItems} actividad(es) en el listado (${Math.round(ratio * 100)}% cubicado).`,
        ratio,
        threshold: 0.5,
      });
    } else {
      results.push({
        id: 'cubicaciones',
        label: 'Listado + Cubicaciones (obligatorio)',
        passed: true,
        detail: `Presente. ${nSheets} hoja(s). Sin actividades con formato estándar (ítem + unidad + cantidad) detectadas en el listado.`,
      });
    }
  } else {
    results.push({
      id: 'cubicaciones',
      label: 'Listado + Cubicaciones (obligatorio)',
      passed: false,
      detail: 'No se encontró archivo de cubicaciones.',
    });
  }

  // ── Cotizaciones ─────────────────────────────────────────────────────────────
  const cotFiles = filesMap.cotizacionesFiles ?? [];
  const wordCotFiles = cotFiles.filter(f => f.parsed?.text !== undefined);
  const excelCotFile = filesMap.cotizaciones?.sheets ? filesMap.cotizaciones : null;

  let cotPassed, cotDetail, forceScore, cotRatio;

  if (excelCotFile) {
    const nCotSheets = excelCotFile.sheets.length;
    cotPassed = true;
    if (nItems > 0) {
      cotRatio = Math.min(nCotSheets, nItems) / nItems;
      cotDetail = `${nCotSheets} hoja(s) de cotizaciones · ${nItems} actividad(es) en el listado (${Math.round(cotRatio * 100)}% cotizado).`;
    } else {
      cotDetail = `Presente en Excel. ${nCotSheets} hoja(s).`;
    }
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
    ...(cotRatio !== undefined ? { ratio: cotRatio, threshold: 0.8 } : {}),
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
