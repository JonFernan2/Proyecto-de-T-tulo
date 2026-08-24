import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

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

    for (let r = range.s.r; r <= Math.min(range.e.r, 600); r++) {
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

  const { value: text } = await mammoth.extractRawText({ arrayBuffer });
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  // Deep XML analysis — far more reliable than mammoth's style mapping
  const marks = await analyzeDocxMarks(arrayBuffer);

  return {
    text,
    wordCount,
    source: 'docx',
    verifiable: marks.verifiable,
    hasHighlights: marks.highlightCount > 0,
    hasStrikethrough: marks.strikeCount > 0,
    highlightCount: marks.highlightCount,
    strikeCount: marks.strikeCount,
    highlightSamples: marks.highlightSamples,
    strikeSamples: marks.strikeSamples,
    highlightColors: marks.highlightColors,
  };
}

/**
 * Reads word/document.xml (plus headers/footers) straight out of the .docx zip
 * and counts runs carrying highlight or strikethrough formatting.
 *
 * Detects BOTH ways Word marks text as highlighted:
 *   <w:highlight w:val="yellow"/>   → "Text Highlight Color" button
 *   <w:shd w:fill="FFFF00"/>        → "Shading" / paragraph fill
 * and both strikethrough variants (<w:strike>, <w:dstrike>) plus tracked
 * deletions (<w:del>), which students often use instead of manual striking.
 */
async function analyzeDocxMarks(arrayBuffer) {
  const empty = {
    verifiable: false, highlightCount: 0, strikeCount: 0,
    highlightSamples: [], strikeSamples: [], highlightColors: [],
  };

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const targets = Object.keys(zip.files).filter(n =>
      /^word\/(document|header\d*|footer\d*)\.xml$/.test(n),
    );
    if (!targets.length) return empty;

    let highlightCount = 0;
    let strikeCount = 0;
    const highlightSamples = [];
    const strikeSamples = [];
    const colors = new Set();

    for (const name of targets) {
      const xml = await zip.file(name).async('string');

      // Tracked deletions carry their text in <w:delText>
      const deletions = xml.match(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g) ?? [];
      for (const d of deletions) {
        const t = decodeXmlText(d.replace(/<[^>]+>/g, ''));
        if (!t) continue;
        strikeCount++;
        if (strikeSamples.length < 15) strikeSamples.push(t.slice(0, 140));
      }

      // Walk every run <w:r ...> ... </w:r>
      for (const run of xml.split(/<w:r[ >]/).slice(1)) {
        const propsEnd = run.indexOf('</w:rPr>');
        const props = propsEnd >= 0 ? run.slice(0, propsEnd) : '';

        const runText = decodeXmlText(
          [...run.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join(''),
        );
        if (!runText) continue;

        // ── Highlight ──────────────────────────────────────────────────────
        let highlighted = false;
        const hl = props.match(/<w:highlight[^>]*w:val="([^"]+)"/);
        if (hl && hl[1].toLowerCase() !== 'none') {
          highlighted = true;
          colors.add(hl[1]);
        }
        const shd = props.match(/<w:shd[^>]*w:fill="([^"]+)"/);
        if (shd && !/^(auto|FFFFFF|none)$/i.test(shd[1])) {
          highlighted = true;
          colors.add(`#${shd[1]}`);
        }
        if (highlighted) {
          highlightCount++;
          if (highlightSamples.length < 15) highlightSamples.push(runText.slice(0, 140));
        }

        // ── Strikethrough ──────────────────────────────────────────────────
        const st = props.match(/<w:(strike|dstrike)(\s[^>]*)?\/?>/);
        if (st && !/w:val="(false|0)"/.test(st[2] ?? '')) {
          strikeCount++;
          if (strikeSamples.length < 15) strikeSamples.push(runText.slice(0, 140));
        }
      }
    }

    return {
      verifiable: true,
      highlightCount,
      strikeCount,
      highlightSamples,
      strikeSamples,
      highlightColors: [...colors],
    };
  } catch (err) {
    console.warn('[parseWord] No se pudo analizar el XML del .docx:', err.message);
    return empty;
  }
}

function decodeXmlText(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

// ─── PDF (EETT) ───────────────────────────────────────────────────────────────
export async function parsePdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  let highlightCount = 0;
  let strikeCount = 0;
  let totalAnnotations = 0;
  const highlightSamples = [];
  const strikeSamples = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => item.str).join(' ') + '\n';

    for (const a of await page.getAnnotations()) {
      totalAnnotations++;
      const note = (a.contents ?? '').trim();
      if (a.subtype === 'Highlight') {
        highlightCount++;
        if (note && highlightSamples.length < 15) highlightSamples.push(note.slice(0, 140));
      } else if (a.subtype === 'StrikeOut') {
        strikeCount++;
        if (note && strikeSamples.length < 15) strikeSamples.push(note.slice(0, 140));
      }
    }
  }

  const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;

  // A PDF exported from Word ("flattened") keeps the colours visually but loses
  // the annotation objects — so zero annotations is NOT proof of zero marking.
  const verifiable = totalAnnotations > 0;

  return {
    text: fullText,
    wordCount,
    source: 'pdf',
    verifiable,
    hasHighlights: highlightCount > 0,
    hasStrikethrough: strikeCount > 0,
    highlightCount,
    strikeCount,
    highlightSamples,
    strikeSamples,
    highlightColors: [],
  };
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
 * Strategy:
 *  1. Look for a dedicated listado/itemizado sheet → count unit-bearing rows there.
 *  2. Fallback: search all sheets for rows with item# pattern + unit + quantity.
 */
export function countListadoItems(excelData) {
  if (!excelData?.sheets?.length) return 0;
  const UNIT_RE = /\b(m2|m²|ml|m3|m³|kg|un\.?|und\.?|unid\.?|gl\.?|glb\.?|pm|hr|h|lts?|ton|jgo|pza|pzas|vj|set|m\b)/i;
  const HEADER_RE = /^(item|ítem|n[°º]|nro|partida|descripci[oó]n|unidad|cantidad|total)/i;

  // 1. Dedicated listado sheet
  const listadoSheet = excelData.sheets.find(s =>
    /listado|itemizado|actividades?|partidas?/i.test(s.name)
  );

  if (listadoSheet) {
    let count = 0;
    for (const row of listadoSheet.rows) {
      if (!row || row.length < 2) continue;
      const firstCell = String(row[0]?.value ?? '').trim();
      if (!firstCell || HEADER_RE.test(firstCell)) continue;
      const rowText = row.map(c => String(c?.value ?? '')).join(' ');
      if (!UNIT_RE.test(rowText)) continue;
      const hasQty = row.some(c => {
        if (!c) return false;
        const v = parseFloat(String(c.value).replace(',', '.'));
        return !isNaN(v) && v > 0;
      });
      if (hasQty) count++;
    }
    if (count > 0) return count;
  }

  // 2. Fallback: item# pattern across all sheets (deduplicated)
  const seen = new Set();
  for (const sheet of excelData.sheets) {
    for (const row of sheet.rows) {
      if (!row[0]) continue;
      const firstCell = String(row[0].value ?? '').trim();
      if (!/^\d{1,3}(\.\d{1,3}){0,3}$/.test(firstCell)) continue;
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
