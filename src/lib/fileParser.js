import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extraerImagenesIncrustadas } from './xlsxImages.js';
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

  // SheetJS no ve las imágenes incrustadas, y ahí es donde muchos estudiantes
  // dejan el respaldo: capturas de AutoCAD con el área medida. Ese número es el
  // que debe coincidir con el total de la hoja.
  const imagenesPorHoja = await extraerImagenesIncrustadas(arrayBuffer);

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

    return {
      name,
      rows,
      totalRows: range.e.r - range.s.r + 1,
      images: imagenesPorHoja[name] ?? [],
      embeddedImages: (imagenesPorHoja[name] ?? []).length,
    };
  });

  return {
    sheets,
    totalRows: sheets.reduce((acc, s) => acc + s.totalRows, 0),
    totalEmbeddedImages: sheets.reduce((acc, s) => acc + s.embeddedImages, 0),
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

  const pages = [];
  let highlightCount = 0;
  let strikeCount = 0;
  let totalAnnotations = 0;
  const highlightSamples = [];
  const strikeSamples = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    const textContent = await page.getTextContent();
    pages.push(textContent.items.map(item => item.str).join(' ').trim());

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

  const fullText = pages.join('\n');
  const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;

  // Un PDF escaneado no tiene capa de texto: pdfjs no devuelve nada aunque el
  // documento esté lleno de contenido. Hay que distinguirlo de un PDF vacío,
  // porque en ese caso la revisión no puede leerlo y debe decirlo en vez de
  // concluir que no hay cotizaciones.
  const paginasConTexto = pages.filter(p => p.length > 20).length;
  const escaneado = pdf.numPages > 0 && paginasConTexto / pdf.numPages < 0.2;

  return {
    text: fullText,
    pages,
    numPages: pdf.numPages,
    paginasConTexto,
    escaneado,
    wordCount,
    source: 'pdf',
    // Un PDF exportado desde Word ("aplanado") conserva los colores pero pierde
    // las anotaciones — cero anotaciones NO prueba que no haya marcas.
    verifiable: totalAnnotations > 0,
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
