import { countListadoItems, medirCotizaciones } from './excelMetrics.js';

// Umbral mínimo exigido para cubicaciones y cotizaciones (pauta: 50%).
export const UMBRAL_CUBICACIONES = 0.5;
export const UMBRAL_COTIZACIONES = 0.5;

/**
 * Run admissibility checks for E1 or E2.
 * Returns { passed, results, resumen }
 *
 * Cubicaciones and cotizaciones are cross-referenced against the listado:
 * the listado is the baseline (N actividades), and each Excel is expected to
 * carry roughly one sheet per activity.
 */
export function runAdmissibility(delivery, filesMap) {
  const results = [];

  // ── Cross-reference baseline ────────────────────────────────────────────────
  // El listado puede venir como archivo propio o dentro del libro de cubicaciones.
  const nItems = countListadoItems(filesMap.listado ?? filesMap.cubicaciones);

  // ── EETT ────────────────────────────────────────────────────────────────────
  results.push(checkEett(filesMap.eett));

  // ── Cubicaciones ────────────────────────────────────────────────────────────
  results.push(checkCubicaciones(filesMap.cubicaciones, nItems));

  // ── Cotizaciones ────────────────────────────────────────────────────────────
  results.push(checkCotizaciones(filesMap));

  // ── APU (solo E2) ───────────────────────────────────────────────────────────
  if (delivery === 'E2') {
    const apuPresent = hasExcelContent(filesMap.apu);
    const nApu = filesMap.apu?.sheets?.length ?? 0;
    const apuRatio = nItems > 0 ? Math.min(nApu, nItems) / nItems : undefined;
    results.push({
      id: 'apu',
      label: 'APU Cartillas (obligatorio)',
      passed: apuPresent,
      detail: apuPresent
        ? (nItems > 0
            ? `${nApu} cartilla(s) APU · ${nItems} actividad(es) en el listado (${pct(apuRatio)} con APU).`
            : `Presente. ${nApu} cartilla(s).`)
        : 'No se encontró archivo APU.',
      ...(apuRatio !== undefined ? { ratio: apuRatio, threshold: UMBRAL_CUBICACIONES } : {}),
    });
  }

  const passed = results.every(r => r.passed);
  return { passed, results, resumen: buildResumen(results, nItems) };
}

// ─── EETT ─────────────────────────────────────────────────────────────────────
function checkEett(eett) {
  const present = Boolean(eett?.text?.trim());
  if (!present) {
    return {
      id: 'eett',
      label: 'EETT (obligatorio)',
      passed: false,
      detail: 'No se encontró archivo EETT.',
    };
  }

  const words = eett.wordCount?.toLocaleString('es-CL') ?? '?';
  const hl = eett.highlightCount ?? 0;
  const st = eett.strikeCount ?? 0;
  const parts = [`Presente (${eett.source === 'pdf' ? 'PDF' : 'Word'}). ${words} palabras.`];

  if (eett.verifiable === false) {
    // Flattened PDF: colours survive visually but the annotations are gone.
    parts.push(
      'El archivo no contiene anotaciones digitales, por lo que los resaltados y tachados ' +
      'no son verificables automáticamente — deben revisarse a la vista.',
    );
  } else {
    parts.push(
      hl > 0
        ? `${hl} fragmento(s) resaltado(s)${eett.highlightColors?.length ? ` (${eett.highlightColors.join(', ')})` : ''}.`
        : 'No se encontraron marcas de resaltado en el documento.',
    );
    parts.push(
      st > 0
        ? `${st} fragmento(s) tachado(s).`
        : 'No se encontraron marcas de tachado en el documento.',
    );
  }

  return {
    id: 'eett',
    label: 'EETT (obligatorio)',
    passed: true,
    detail: parts.join(' '),
    marcas: { highlightCount: hl, strikeCount: st, verifiable: eett.verifiable !== false },
  };
}

// ─── Cubicaciones ─────────────────────────────────────────────────────────────
function checkCubicaciones(cub, nItems) {
  const base = { id: 'cubicaciones', label: 'Listado + Cubicaciones (obligatorio)' };

  if (!hasExcelContent(cub)) {
    return { ...base, passed: false, detail: 'No se encontró archivo de cubicaciones.' };
  }

  const nSheets = cub.sheets.length;
  if (nItems <= 0) {
    return {
      ...base,
      passed: true,
      detail: `Presente. ${nSheets} hoja(s). No se pudo identificar el listado con formato estándar (ítem + unidad + cantidad) para calcular el porcentaje cubicado.`,
    };
  }

  const ratio = Math.min(nSheets, nItems) / nItems;
  const cumple = ratio >= UMBRAL_CUBICACIONES;

  // El respaldo del cálculo puede venir incrustado en las propias hojas, y eso
  // cuenta igual que un archivo aparte.
  const incrustadas = cub.totalEmbeddedImages ?? 0;
  const respaldo = incrustadas > 0
    ? ` ${incrustadas} imagen(es) de respaldo incrustadas en las hojas.`
    : '';

  return {
    ...base,
    passed: true,
    detail:
      `${nSheets} hoja(s) de cubicaciones · ${nItems} actividad(es) en el listado ` +
      `(${pct(ratio)} cubicado). Exigencia mínima ${pct(UMBRAL_CUBICACIONES)}: ` +
      `${cumple ? 'CUMPLE' : 'NO CUMPLE'}.${respaldo}`,
    ratio,
    threshold: UMBRAL_CUBICACIONES,
    cumpleUmbral: cumple,
    imagenesIncrustadas: incrustadas,
  };
}

// ─── Cotizaciones ─────────────────────────────────────────────────────────────
function checkCotizaciones(filesMap) {
  const base = { id: 'cotizaciones', label: 'Cotizaciones' };
  const entries = filesMap.cotizacionesFiles ?? [];
  const excel = filesMap.cotizaciones;                       // ya resuelto por el store
  const pdfNames = filesMap.cotizacionesPdfNames ?? [];
  const wordFiles = entries.filter(f => f.parsed?.text !== undefined && f.ext !== 'pdf');

  // Nada entregado en ningún formato.
  if (!excel && !pdfNames.length && !wordFiles.length) {
    return {
      ...base,
      passed: false,
      forceScore: 1.0,
      detail: 'No se encontró archivo de cotizaciones en ningún formato. Criterio se calificará con nota 1,0.',
    };
  }

  const notas = [];
  let ratio;
  let cumple;

  if (excel) {
    // Se mide lo que la pauta exige —tres proveedores por material— y no hojas
    // contra actividades: las cotizaciones son tablas, no una hoja por partida.
    const m = medirCotizaciones(excel);

    if (m.materiales > 0) {
      ratio = m.ratio;
      cumple = ratio >= UMBRAL_COTIZACIONES;
      notas.push(
        `${m.materiales} material(es) en la planilla · ${m.conPrecio} con al menos un precio · ` +
        `${m.conTresProveedores} con los tres proveedores que exige la pauta (${pct(ratio)}). ` +
        `Exigencia mínima ${pct(UMBRAL_COTIZACIONES)}: ${cumple ? 'CUMPLE' : 'NO CUMPLE'}.`,
      );
    } else {
      notas.push(`Excel de cotizaciones presente con ${excel.sheets.length} hoja(s), sin filas de material reconocibles.`);
    }
  } else if (wordFiles.length) {
    notas.push(
      `Entregado en Word (${wordFiles.length} archivo(s)) y no en Excel como exige la pauta. ` +
      'Se evalúa el contenido, descontando por el formato.',
    );
  }

  if (pdfNames.length) {
    notas.push(`${pdfNames.length} PDF(s) de respaldo adjunto(s).`);
  } else if (excel?.totalEmbeddedImages > 0) {
    notas.push(`${excel.totalEmbeddedImages} imagen(es) de respaldo incrustadas en las hojas.`);
  } else if (excel || wordFiles.length) {
    notas.push('Sin respaldo adjunto ni incrustado en las hojas.');
  }

  return {
    ...base,
    passed: true,
    detail: notas.join(' '),
    ...(ratio !== undefined ? { ratio, threshold: UMBRAL_COTIZACIONES, cumpleUmbral: cumple } : {}),
    formatoCorrecto: Boolean(excel),
    nPdfRespaldo: pdfNames.length,
  };
}

// ─── Cuadro resumen ───────────────────────────────────────────────────────────
function buildResumen(results, nItems) {
  return {
    nActividades: nItems,
    filas: results.map(r => ({
      id: r.id,
      label: r.label,
      estado: !r.passed ? 'NO CUMPLE' : r.cumpleUmbral === false ? 'BAJO EXIGENCIA' : 'OK',
      porcentaje: r.ratio !== undefined ? pct(r.ratio) : '—',
      exigencia: r.threshold !== undefined ? pct(r.threshold) : '—',
      detalle: r.detail,
    })),
  };
}

function pct(r) {
  return r === undefined ? '—' : `${Math.round(r * 100)}%`;
}

function hasExcelContent(data) {
  return Boolean(data?.sheets?.length > 0 && data.totalRows > 0);
}
