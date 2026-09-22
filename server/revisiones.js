/**
 * Persistencia de las revisiones en curso.
 *
 * Cada lote enviado al Batch API se procesa de forma asíncrona y puede tardar.
 * Mientras tanto el servidor debe recordar a qué estudiante corresponde para
 * poder consolidarlo al terminar. Si eso vive solo en memoria, un reinicio
 * huerfaniza el lote: termina igual y se cobra, pero ya no hay cómo recogerlo.
 *
 * Se guarda SOLO lo que la consolidación necesita. Las filas de las hojas y las
 * imágenes incrustadas ya viajaron dentro de las tandas y no hacen falta de
 * vuelta, así que un libro de 58 MB se reduce aquí a unos pocos kilobytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.revisiones');

// El Batch API descarta los lotes al cabo de unas semanas; pasado ese punto un
// registro guardado ya no sirve para nada.
const CADUCIDAD_DIAS = 21;

export function guardarRevision(batchId, ctx) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const liviano = {
      delivery: ctx.delivery,
      studentName: ctx.studentName,
      plan: ctx.plan,
      creado: ctx.creado,
      payload: adelgazar(ctx.payload),
    };
    fs.writeFileSync(archivo(batchId), JSON.stringify(liviano), 'utf8');
  } catch (err) {
    // Que no se pueda guardar no debe impedir lanzar la revisión: seguirá en
    // memoria y solo se perderá si además se reinicia el servidor.
    console.warn(`[revisiones] No se pudo guardar ${batchId}: ${err.message}`);
  }
}

export function cargarRevisiones() {
  const mapa = new Map();
  let archivos = [];
  try {
    archivos = fs.readdirSync(DIR).filter(n => n.endsWith('.json'));
  } catch {
    return mapa;
  }

  const limite = Date.now() - CADUCIDAD_DIAS * 24 * 60 * 60 * 1000;

  for (const nombre of archivos) {
    const ruta = path.join(DIR, nombre);
    try {
      const ctx = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      if ((ctx.creado ?? 0) < limite) { fs.unlinkSync(ruta); continue; }
      mapa.set(nombre.replace(/\.json$/, ''), ctx);
    } catch (err) {
      console.warn(`[revisiones] Se descarta ${nombre}: ${err.message}`);
      try { fs.unlinkSync(ruta); } catch { /* da igual */ }
    }
  }
  return mapa;
}

export function eliminarRevision(batchId) {
  try {
    fs.unlinkSync(archivo(batchId));
  } catch { /* ya no estaba */ }
}

export function reportarRevisiones(mapa) {
  if (!mapa.size) return;
  console.log(`[revisiones] ${mapa.size} revisión(es) pendiente(s) recuperada(s) del disco:`);
  for (const [id, ctx] of mapa) {
    const horas = ((Date.now() - (ctx.creado ?? Date.now())) / 3_600_000).toFixed(1);
    console.log(`  · ${ctx.studentName} — ${ctx.delivery} · lanzada hace ${horas} h · ${id}`);
  }
}

// ─── Interno ─────────────────────────────────────────────────────────────────
function archivo(batchId) {
  // El id del lote viene de la API, pero se sanea igual: nunca debe poder
  // escribirse fuera de su carpeta.
  return path.join(DIR, `${String(batchId).replace(/[^A-Za-z0-9_-]/g, '')}.json`);
}

/**
 * Conserva lo que la consolidación necesita y descarta lo que ya cumplió su
 * función: filas, fórmulas, imágenes incrustadas y páginas de PDF.
 */
function adelgazar(payload = {}) {
  const resumenLibro = libro => (libro?.sheets?.length
    ? {
        sheets: libro.sheets.map(s => ({ name: s.name })),
        totalRows: libro.totalRows,
        totalEmbeddedImages: libro.totalEmbeddedImages ?? 0,
      }
    : null);

  return {
    // El texto de las EETT sí se necesita: la consolidación lo evalúa.
    eett: payload.eett ?? null,
    admissibility: payload.admissibility ?? null,

    cubicaciones: resumenLibro(payload.cubicaciones),
    listado: resumenLibro(payload.listado),
    cotizaciones: resumenLibro(payload.cotizaciones),
    apu: resumenLibro(payload.apu),

    // El inventario solo cuenta cuántas cotizaciones llegaron en Word; basta
    // con conservar esa marca, no el texto.
    cotizacionesFiles: (payload.cotizacionesFiles ?? []).map(f => ({
      name: f.name,
      ext: f.ext,
      parsed: f.parsed?.text !== undefined ? { text: '' } : null,
    })),
    pdfNames: payload.pdfNames ?? [],
    respaldoPdfs: (payload.respaldoPdfs ?? []).map(p => ({
      name: p.name,
      numPages: p.numPages,
      escaneado: p.escaneado,
      paginasConTexto: p.paginasConTexto,
    })),
  };
}
