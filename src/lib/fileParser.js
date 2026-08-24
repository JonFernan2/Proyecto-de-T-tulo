import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// ─── Excel ────────────────────────────────────────────────────────────────────
export async function parseExcel(file) {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, {
    type: 'array',
    cellFormula: true,
    cellText: true,
    cellDates: true,
  });

  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
    const rows = [];

    for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
      const row = [];
      for (let c = range.s.c; c <= Math.min(range.e.c, 20); c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellRef];
        if (!cell) { row.push(null); continue; }
        row.push({
          value: cell.w ?? cell.v ?? '',   // formatted text
          formula: cell.f ?? null,          // raw formula string
          type: cell.t,                     // type: n=number, s=string, b=bool
        });
      }
      // Skip entirely empty rows
      if (row.every(c => !c || (c.value === '' && !c.formula))) continue;
      rows.push(row);
    }

    return { name, rows, totalRows: range.e.r - range.s.r + 1 };
  });

  return {
    sheets,
    totalRows: sheets.reduce((acc, s) => acc + s.totalRows, 0),
  };
}

// ─── Word (EETT) ──────────────────────────────────────────────────────────────
export async function parseWord(file) {
  const arrayBuffer = await file.arrayBuffer();

  // Extract HTML to detect highlights and strikethrough
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "r[highlight] => mark",
        "r[strike] => s",
        "r[dstrike] => s",
      ],
    }
  );

  const hasHighlights = /<mark>/i.test(html) || /background-color:\s*yellow/i.test(html);
  const hasStrikethrough = /<s[ >]/i.test(html) || /<del[ >]/i.test(html);

  // Extract plain text
  const { value: text } = await mammoth.extractRawText({ arrayBuffer });
  const wordCount = text.trim().split(/\s+/).length;

  return { text, html, hasHighlights, hasStrikethrough, wordCount };
}

// ─── Image → base64 ───────────────────────────────────────────────────────────
export async function parseImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const [header, data] = dataUrl.split(',');
      const mediaType = header.match(/data:([^;]+)/)[1];
      resolve({ data, mediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Student name extraction from filename ────────────────────────────────────
const NOISE = new Set([
  'entrega', 'e1', 'e2', 'eett', 'apu', 'cubicacion', 'cubicaciones',
  'cotizacion', 'cotizaciones', 'listado', 'actividades', 'formulacion',
  'proyecto', 'titulo', 'uvm', 'icon2140', 'icon2143', 'metodos',
  'constructivos', 'respaldo', 'formulario', 'oferta', 'especificaciones',
  'tecnicas', 'analisis', 'precios', 'unitarios', 'reparaciones', 'obra',
]);

export function detectStudentName(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const parts = base.split(/[_\-\s.]+/);
  const candidates = parts
    .filter(p => p.length > 1)
    .filter(p => !/^\d+$/.test(p))
    .filter(p => !NOISE.has(p.toLowerCase()));
  return candidates.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// ─── Admissibility helpers ────────────────────────────────────────────────────

/**
 * Count distinct listado items across an Excel file.
 * An item row is: col A matches item# pattern (e.g. "1", "1.1", "2.3.1")
 *   AND the row contains a unit keyword AND a positive quantity.
 * Uses a Set so the same item# is counted once even if repeated across sheets.
 */
export function countListadoItems(excelData) {
  if (!excelData?.sheets?.length) return 0;
  const UNIT_RE = /\b(m2|m²|ml|m3|m³|kg|un\.?|und\.?|unid\.?|gl\.?|glb\.?|pm|hr|h|lts?|ton|jgo|m\b)/i;
  const seen = new Set();

  for (const sheet of excelData.sheets) {
    for (const row of sheet.rows) {
      if (!row[0]) continue;
      const firstCell = String(row[0].value ?? '').trim();
      if (!/^\d{1,2}(\.\d{1,2}){0,2}$/.test(firstCell)) continue;
      const rowText = row.map(c => String(c?.value ?? '')).join(' ');
      if (!UNIT_RE.test(rowText)) continue;
      const hasQty = row.some(c => {
        if (!c) return false;
        const v = parseFloat(String(c.value).replace(',', '.'));
        return !isNaN(v) && v > 0;
      });
      if (hasQty) seen.add(firstCell);
    }
  }
  return seen.size;
}

/**
 * Estimate fraction of activities that have a quantity (cubicaciones).
 * Looks for rows where: col A has an item code AND a later column has a number.
 */
export function measureCubicacionesCoverage(excelData) {
  if (!excelData?.sheets?.length) return { covered: 0, total: 0, ratio: 0 };

  let total = 0;
  let covered = 0;

  for (const sheet of excelData.sheets) {
    for (const row of sheet.rows) {
      // Row must have content in first cell (item code or description)
      if (!row[0]) continue;
      const firstCell = String(row[0].value ?? '').trim();
      if (!firstCell) continue;

      // Skip header-like rows
      if (/^(item|ítem|n°|nro|partida|desc)/i.test(firstCell)) continue;

      // Check if any cell beyond index 1 contains a numeric value
      const hasQuantity = row.slice(1).some(c => {
        if (!c) return false;
        const v = parseFloat(String(c.value).replace(',', '.'));
        return !isNaN(v) && v > 0;
      });

      total++;
      if (hasQuantity) covered++;
    }
  }

  const ratio = total > 0 ? covered / total : 0;
  return { covered, total, ratio };
}

/**
 * Estimate fraction of materials with at least one proveedor quoted.
 * Detects the cotizaciones format: ITEM | material | prov1 | prov2 | prov3 | ...
 */
export function measureCotizacionesCoverage(excelData) {
  if (!excelData?.sheets?.length) return { quoted: 0, total: 0, ratio: 0 };

  let total = 0;
  let quoted = 0;

  for (const sheet of excelData.sheets) {
    // Find first data row (skip header)
    let headerRow = -1;
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const text = row.map(c => String(c?.value ?? '').toLowerCase()).join(' ');
      if (text.includes('material') || text.includes('proveedor') || text.includes('prov')) {
        headerRow = i;
        break;
      }
    }
    const startRow = headerRow >= 0 ? headerRow + 1 : 0;

    for (let i = startRow; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      if (!row[0]) continue;
      const firstCell = String(row[0].value ?? '').trim();
      if (!firstCell || /^(item|ítem|herramienta|maquina|equipo)/i.test(firstCell)) continue;

      // If first col looks like a number (item number), it's a material row
      const isItemRow = /^\d/.test(firstCell);
      if (!isItemRow) continue;

      // Check if any column from index 2 onwards has a price
      const hasPrice = row.slice(2).some(c => {
        if (!c) return false;
        const v = parseFloat(String(c.value).replace(/[$.\s,]/g, '').replace(',', '.'));
        return !isNaN(v) && v > 0;
      });

      total++;
      if (hasPrice) quoted++;
    }
  }

  const ratio = total > 0 ? quoted / total : 0;
  return { quoted, total, ratio };
}

/**
 * Estimate APU completeness: each sheet should have method + MO + materials.
 * Returns fraction of sheets deemed "complete".
 */
export function measureApuCoverage(excelData) {
  if (!excelData?.sheets?.length) return { complete: 0, total: 0, ratio: 0 };

  const total = excelData.sheets.length;
  let complete = 0;

  for (const sheet of excelData.sheets) {
    const allText = sheet.rows
      .flat()
      .map(c => String(c?.value ?? '').toLowerCase())
      .join(' ');

    // A sheet is considered complete if it has method text AND a numeric value (cost)
    const hasText = allText.length > 100;
    const hasNumbers = sheet.rows.flat().some(c => {
      if (!c) return false;
      const v = parseFloat(String(c.value).replace(/[$.\s,]/g, ''));
      return !isNaN(v) && v > 1000; // price > $1.000
    });

    if (hasText && hasNumbers) complete++;
  }

  const ratio = total > 0 ? complete / total : 0;
  return { complete, total, ratio };
}
