import {
  measureCubicacionesCoverage,
  measureCotizacionesCoverage,
  measureApuCoverage,
} from './fileParser.js';

/**
 * Run admissibility checks for E1 or E2.
 * Returns { passed: bool, results: CheckResult[] }
 *
 * CheckResult: { id, label, passed, detail, ratio?, threshold? }
 */
export function runAdmissibility(delivery, filesMap) {
  const results = [];

  // ── EETT ────────────────────────────────────────────────────────────────────
  const eettPresent = Boolean(filesMap.eett?.text?.trim());
  results.push({
    id: 'eett',
    label: 'EETT (Word obligatorio)',
    passed: eettPresent,
    detail: eettPresent
      ? `Presente. ${filesMap.eett.wordCount?.toLocaleString('es-CL') ?? '?'} palabras.`
      : 'Archivo Word no encontrado. La entrega se rechaza.',
  });

  // ── Cubicaciones ─────────────────────────────────────────────────────────────
  const cubCoverage = measureCubicacionesCoverage(filesMap.cubicaciones);
  const cubThreshold = 0.5;
  const cubPassed = cubCoverage.total > 0 && cubCoverage.ratio >= cubThreshold;
  results.push({
    id: 'cubicaciones',
    label: `Cubicaciones (mín. ${cubThreshold * 100}% de partidas)`,
    passed: cubPassed,
    ratio: cubCoverage.ratio,
    threshold: cubThreshold,
    detail:
      cubCoverage.total === 0
        ? 'No se encontró archivo de cubicaciones o no contiene partidas legibles.'
        : `${cubCoverage.covered} de ${cubCoverage.total} partidas cubicadas (${pct(cubCoverage.ratio)}).`,
  });

  // ── Cotizaciones ──────────────────────────────────────────────────────────────
  // Support Word-based cotizaciones (multiple .docx files) and Excel
  const cotFiles = filesMap.cotizacionesFiles ?? [];
  const wordCotFiles = cotFiles.filter(f => f.parsed?.text !== undefined);
  const excelCotFile = filesMap.cotizaciones?.sheets ? filesMap.cotizaciones : null;

  let cotPassed, cotDetail, cotRatio;
  const cotThreshold = 0.8;

  if (wordCotFiles.length > 0) {
    // Word-based: format is incorrect per pauta — force 1.0 on that criterion
    cotPassed = false;
    cotRatio = 0;
    cotDetail = `Formato incorrecto: se entregaron ${wordCotFiles.length} archivo(s) Word. La pauta exige Excel con tabla de proveedores. El criterio se calificará con nota 1,0.`;
  } else if (excelCotFile) {
    const cotCoverage = measureCotizacionesCoverage(excelCotFile);
    cotPassed = cotCoverage.total > 0 && cotCoverage.ratio >= cotThreshold;
    cotRatio = cotCoverage.ratio;
    cotDetail = cotCoverage.total === 0
      ? 'No se encontró archivo de cotizaciones o no contiene materiales legibles.'
      : `${cotCoverage.quoted} de ${cotCoverage.total} materiales cotizados (${pct(cotCoverage.ratio)}).`;
  } else {
    cotPassed = false;
    cotRatio = 0;
    cotDetail = 'No se encontró archivo de cotizaciones.';
  }

  results.push({
    id: 'cotizaciones',
    label: `Cotizaciones (mín. ${cotThreshold * 100}% de materiales)`,
    passed: cotPassed,
    ratio: cotRatio,
    threshold: cotThreshold,
    detail: cotDetail,
    forceScore: cotPassed ? undefined : 1.0,
  });

  // ── APU (solo E2) ────────────────────────────────────────────────────────────
  if (delivery === 'E2') {
    const apuCoverage = measureApuCoverage(filesMap.apu);
    const apuPassed = apuCoverage.total > 0 && apuCoverage.ratio >= 1.0;
    results.push({
      id: 'apu',
      label: 'APU Cartillas (100% de actividades completas)',
      passed: apuPassed,
      ratio: apuCoverage.ratio,
      threshold: 1.0,
      detail:
        apuCoverage.total === 0
          ? 'No se encontró archivo APU o no contiene hojas con datos.'
          : `${apuCoverage.complete} de ${apuCoverage.total} cartillas APU con contenido suficiente (${pct(apuCoverage.ratio)}).`,
    });
  }

  const passed = results.every(r => r.passed);
  return { passed, results };
}

function pct(ratio) {
  return `${Math.round(ratio * 100)}%`;
}
