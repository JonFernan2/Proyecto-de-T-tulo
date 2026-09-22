/**
 * Persistencia de las revisiones, en curso y terminadas.
 *
 * Cada lote enviado al Batch API se procesa de forma asíncrona y puede tardar
 * horas. Mientras tanto el servidor debe recordar a qué estudiante corresponde
 * para poder consolidarlo al terminar: si eso vive solo en memoria, un reinicio
 * huerfaniza el lote —termina igual y se cobra, pero ya no hay cómo recogerlo.
 *
 * Una vez consolidada, la revisión NO se borra: guarda su evaluación para que
 * el curso completo pueda repasarse después, ajustar notas y exportar sin
 * volver a correr nada.
 *
 * De lo pendiente se guarda solo lo que la consolidación necesita. Las filas de
 * las hojas y las imágenes ya viajaron dentro de las tandas y no hacen falta de
 * vuelta, así que un libro de 58 MB se reduce aquí a unos pocos kilobytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.revisiones');

// El Batch API descarta los lotes al cabo de unas semanas; pasado ese punto un
// registro PENDIENTE ya no sirve. Las completadas se conservan.
const CADUCIDAD_DIAS = 21;

export function guardarRevision(batchId, ctx) {
  escribir(batchId, {
    delivery: ctx.delivery,
    studentName: ctx.studentName,
    plan: ctx.plan,
    creado: ctx.creado,
    estado: 'pendiente',
    payload: adelgazar(ctx.payload),
  });
}

/** Marca la revisión como terminada y conserva su evaluación. */
export function guardarResultado(batchId, { evaluation, cobertura }) {
  const previo = leer(batchId);
  if (!previo) return;
  escribir(batchId, {
    ...previo,
    estado: 'completada',
    completado: Date.now(),
    evaluation,
    cobertura,
    // El payload ya cumplió su función en la consolidación.
    payload: { eett: previo.payload?.eett ?? null },
  });
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
      // Solo caducan las que nunca se recogieron: una completada es un
      // resultado, no un lote a la espera.
      if (ctx.estado !== 'completada' && (ctx.creado ?? 0) < limite) {
        fs.unlinkSync(ruta);
        continue;
      }
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
  const pendientes = [...mapa.values()].filter(c => c.estado !== 'completada').length;
  const completadas = mapa.size - pendientes;

  console.log(`[revisiones] ${mapa.size} en disco: ${pendientes} pendiente(s), ${completadas} completada(s)`);
  for (const [id, ctx] of mapa) {
    if (ctx.estado === 'completada') continue;
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

function escribir(batchId, datos) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(archivo(batchId), JSON.stringify(datos), 'utf8');
  } catch (err) {
    // Que no se pueda guardar no debe impedir seguir: la revisión continúa en
    // memoria y solo se pierde si además se reinicia el servidor.
    console.warn(`[revisiones] No se pudo guardar ${batchId}: ${err.message}`);
  }
}

function leer(batchId) {
  try {
    return JSON.parse(fs.readFileSync(archivo(batchId), 'utf8'));
  } catch {
    return null;
  }
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
