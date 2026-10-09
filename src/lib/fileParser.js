import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extraerImagenesIncrustadas } from './xlsxImages.js';
import { extraerCuadrosDeTexto } from './xlsxTextboxes.js';
// La versión «legacy» de pdf.js: la moderna usa funciones de JavaScript tan
// recientes (Map.getOrInsertComputed) que en navegadores de hace un año falla
// al dibujar una página, y sin dibujo no hay imágenes de la Carta Gantt.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// La ruta va relativa a este archivo: escrita como «pdfjs-dist/…» se buscaba
// dentro de src/lib, daba 404, y pdf.js trabajaba sin worker, en el hilo de la
// página.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
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

  // Tampoco ve los cuadros de texto, y algunos estudiantes redactan ahí el
  // método constructivo en vez de escribirlo en la celda bajo «MÉTODO DE
  // TRABAJO»: sin esto esa cartilla se revisaba como si el método estuviera
  // en blanco, cuando en realidad era invisible para la revisión.
  const textosPorHoja = await extraerCuadrosDeTexto(arrayBuffer);

  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
    const rows = [];

    // Un itemizado de hospital llega a 900 filas: cortar en 600 dejaba fuera
    // los últimos capítulos y sus partidas no se exigían a nadie.
    for (let r = range.s.r; r <= Math.min(range.e.r, 3000); r++) {
      const row = [];
      for (let c = range.s.c; c <= Math.min(range.e.c, 20); c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellRef];
        if (!cell) { row.push(null); continue; }
        row.push({
          value: cell.w ?? cell.v ?? '',   // formatted text
          formula: cell.f ?? null,          // raw formula string
          type: cell.t,                     // type: n=number, s=string, b=bool
          // El número sin formato: «0,18» en pantalla puede ser 0,1764, y
          // comprobar duraciones o montos con lo redondeado daría falsos errores.
          ...(cell.t === 'n' && typeof cell.v === 'number' ? { raw: cell.v } : {}),
        });
      }
      // Skip entirely empty rows
      if (row.every(c => !c || (c.value === '' && !c.formula))) continue;
      rows.push(row);
    }

    // Se agrega como una fila más, con una marca que avisa que no es una
    // celda: así llega a todo lo que ya recorre `rows` —la revisión con
    // Claude, el cruce con el itemizado— sin que cada uno tenga que aprender
    // a mirar también los dibujos.
    const textoCuadros = textosPorHoja[name];
    if (textoCuadros) {
      rows.push([{ value: `[CUADRO DE TEXTO] ${textoCuadros}`, formula: null, type: 's' }]);
    }

    return {
      name,
      rows,
      totalRows: range.e.r - range.s.r + 1,
      images: imagenesPorHoja[name] ?? [],
      embeddedImages: (imagenesPorHoja[name] ?? []).length,
      textoCuadros: textoCuadros ?? null,
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
// La Carta Gantt viene en A0 o A1. Se dibuja al doble del lado que admite la
// API para poder partirla en cuadrantes legibles; el texto se toma aparte, de
// la capa de texto del PDF. La pauta pide una sola plana, así que se dibujan
// las primeras páginas nada más.
const GANTT_LADO_IMAGEN = 3136;
const GANTT_MAX_PAGINAS_IMAGEN = 3;

export async function parsePdf(file, { imagenes = false } = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages = [];
  // Tamaño de cada página en milímetros: la pauta exige la Gantt en A0 o A1.
  const tamanos = [];
  const imagenesPaginas = [];
  let highlightCount = 0;
  let strikeCount = 0;
  let totalAnnotations = 0;
  const highlightSamples = [];
  const strikeSamples = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    const textContent = await page.getTextContent();
    pages.push(textoPorRenglones(textContent.items));

    const vista = page.getViewport({ scale: 1 });
    tamanos.push({ anchoMm: Math.round(vista.width * 25.4 / 72), altoMm: Math.round(vista.height * 25.4 / 72) });

    if (imagenes && i <= GANTT_MAX_PAGINAS_IMAGEN) {
      for (const img of await renderizarPagina(page, GANTT_LADO_IMAGEN)) {
        imagenesPaginas.push({ ...img, pagina: i });
      }
    }

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
    tamanos,
    ...(imagenes ? { imagenes: imagenesPaginas } : {}),
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

/**
 * El texto de una página respetando los renglones.
 *
 * pdfjs entrega los fragmentos sueltos; unirlos todos con espacios mezcla las
 * columnas de una tabla —el nombre de una tarea, su duración y su predecesora
 * quedaban en una sola tira—. Se corta un renglón cada vez que cambia la altura.
 */
function textoPorRenglones(items) {
  let texto = '';
  let y = null;
  for (const it of items) {
    const yi = it.transform?.[5];
    if (y !== null && yi !== undefined && Math.abs(yi - y) > 2) texto += '\n';
    else if (texto && !texto.endsWith(' ')) texto += ' ';
    texto += it.str;
    if (yi !== undefined) y = yi;
  }
  return texto.replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Dibuja una página del PDF como imágenes JPEG. Solo en el navegador.
 *
 * La API reduce toda imagen a unos 1.568 px de lado: una Gantt A0 entera a ese
 * tamaño deja ver los colores pero no qué barra es de qué tarea. Por eso se
 * entrega la vista completa y además la página partida en cuatro cuadrantes,
 * cada uno a resolución útil.
 */
async function renderizarPagina(page, ladoMax) {
  if (typeof document === 'undefined') return [];
  try {
    const base = page.getViewport({ scale: 1 });
    const escala = Math.min(6, ladoMax / Math.max(base.width, base.height));
    const vista = page.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vista.width);
    canvas.height = Math.round(vista.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vista }).promise;

    const recorte = (x, y, w, h, lado, vistaNombre) => {
      const k = Math.min(1, lado / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/jpeg', 0.82).split(',')[1], mediaType: 'image/jpeg', vista: vistaNombre };
    };

    const W = canvas.width;
    const H = canvas.height;
    const mw = Math.ceil(W / 2);
    const mh = Math.ceil(H / 2);
    return [
      recorte(0, 0, W, H, 1568, 'página completa'),
      recorte(0, 0, mw, mh, 1568, 'cuadrante superior izquierdo'),
      recorte(W - mw, 0, mw, mh, 1568, 'cuadrante superior derecho'),
      recorte(0, H - mh, mw, mh, 1568, 'cuadrante inferior izquierdo'),
      recorte(W - mw, H - mh, mw, mh, 1568, 'cuadrante inferior derecho'),
    ];
  } catch (err) {
    console.warn('[pdf] No se pudo dibujar la página:', err.message);
    return [];
  }
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
