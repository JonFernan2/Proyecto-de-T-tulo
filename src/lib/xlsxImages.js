import JSZip from 'jszip';

// La API solo acepta estos formatos. Un .xlsx puede traer además emf/wmf
// (gráficos vectoriales de Office), que se descartan.
const TIPOS = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Extrae las imágenes incrustadas de cada hoja de un .xlsx.
 *
 * SheetJS lee celdas y fórmulas pero no ve las imágenes, y ahí es donde muchos
 * estudiantes dejan el respaldo de sus cubicaciones: capturas de AutoCAD con el
 * área o la longitud medida en el panel de propiedades. Ese número es el que
 * debe coincidir con el total de la hoja.
 *
 * Un .xlsx es un zip y la cadena que une una hoja con sus imágenes es:
 *   workbook.xml (nombre de hoja → r:id)
 *     → _rels/workbook.xml.rels (r:id → worksheets/sheetN.xml)
 *       → sheetN.xml (<drawing r:id>)
 *         → worksheets/_rels/sheetN.xml.rels (r:id → ../drawings/drawingM.xml)
 *           → drawings/_rels/drawingM.xml.rels (→ ../media/imagenK.png)
 *
 * Devuelve { [hoja]: [{ data, mediaType }] } con la imagen ya en base64.
 * Ante cualquier problema devuelve {}: no ver las imágenes es aceptable,
 * romper el parseo del libro no.
 */
export async function extraerImagenesIncrustadas(arrayBuffer, opciones = {}) {
  const { maxPorHoja = 3, maxTotal = 300, maxLado = 1400 } = opciones;

  const porHoja = {};
  let total = 0;

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const leer = async ruta => (zip.file(ruta) ? zip.file(ruta).async('string') : null);

    const wbXml = await leer('xl/workbook.xml');
    if (!wbXml) return porHoja;

    const wbRels = parsearRels(await leer('xl/_rels/workbook.xml.rels'));

    for (const tag of wbXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
      // El orden de los atributos varía entre generadores, así que se extraen
      // por separado en vez de asumir que name precede a r:id.
      const name = tag.match(/\bname="([^"]*)"/)?.[1];
      const rid = tag.match(/\br:id="([^"]+)"/)?.[1];
      if (name === undefined || !rid) continue;

      const hoja = decodificarXml(name);
      porHoja[hoja] = [];

      if (total >= maxTotal) continue;

      const rutas = await rutasDeImagenes(zip, leer, wbRels, rid);
      for (const ruta of rutas.slice(0, maxPorHoja)) {
        if (total >= maxTotal) break;
        const img = await procesarImagen(zip, ruta, maxLado);
        if (img) { porHoja[hoja].push(img); total++; }
      }
    }
  } catch (err) {
    console.warn('[xlsx] No se pudieron extraer las imágenes incrustadas:', err.message);
  }

  return porHoja;
}

async function rutasDeImagenes(zip, leer, wbRels, rid) {
  const destino = wbRels[rid];
  if (!destino) return [];

  const rutaHoja = resolverRuta('xl/workbook.xml', destino);
  const hojaXml = await leer(rutaHoja);
  const ridDibujo = hojaXml?.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!ridDibujo) return [];

  const relsHoja = parsearRels(await leer(rutaRels(rutaHoja)));
  const destinoDibujo = relsHoja[ridDibujo];
  if (!destinoDibujo) return [];

  const rutaDibujo = resolverRuta(rutaHoja, destinoDibujo);
  const relsDibujo = await leer(rutaRels(rutaDibujo));
  if (!relsDibujo) return [];

  return Object.values(parsearRels(relsDibujo))
    .filter(t => /media\//.test(t))
    .map(t => resolverRuta(rutaDibujo, t));
}

async function procesarImagen(zip, ruta, maxLado) {
  const archivo = zip.file(ruta);
  if (!archivo) return null;

  const mediaType = TIPOS[ruta.split('.').pop().toLowerCase()];
  if (!mediaType) return null;

  // Las capturas de AutoCAD suelen venir a resolución de pantalla completa.
  // Reducirlas baja el peso del envío y el costo sin perder legibilidad de las
  // cifras del panel de propiedades, que es lo que hay que leer.
  const reducida = await reducir(archivo, mediaType, maxLado);
  if (reducida) return reducida;

  return { data: await archivo.async('base64'), mediaType };
}

/**
 * Reduce la imagen con canvas. Solo existe en el navegador; en Node devuelve
 * null y se usa la original, que es lo que permite probar esto fuera del browser.
 */
async function reducir(archivo, mediaType, maxLado) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;

  try {
    const blob = new Blob([await archivo.async('uint8array')], { type: mediaType });
    const bitmap = await createImageBitmap(blob);

    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    if (escala === 1 && blob.size < 400_000) { bitmap.close?.(); return null; }

    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = new OffscreenCanvas(ancho, alto);
    const ctx = canvas.getContext('2d');
    // Fondo blanco: los PNG con transparencia saldrían negros al pasar a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close?.();

    const salida = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const buf = new Uint8Array(await salida.arrayBuffer());

    let binario = '';
    for (let i = 0; i < buf.length; i += 8192) {
      binario += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    return { data: btoa(binario), mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

function parsearRels(xml) {
  const mapa = {};
  if (!xml) return mapa;
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = tag.match(/\bId="([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) mapa[id] = target;
  }
  return mapa;
}

// "xl/worksheets/sheet1.xml" + "../drawings/drawing1.xml" → "xl/drawings/drawing1.xml"
function resolverRuta(desde, destino) {
  if (destino.startsWith('/')) return destino.slice(1);
  const partes = desde.split('/').slice(0, -1);
  for (const segmento of destino.split('/')) {
    if (segmento === '..') partes.pop();
    else if (segmento && segmento !== '.') partes.push(segmento);
  }
  return partes.join('/');
}

// "xl/drawings/drawing1.xml" → "xl/drawings/_rels/drawing1.xml.rels"
function rutaRels(ruta) {
  const partes = ruta.split('/');
  const archivo = partes.pop();
  return [...partes, '_rels', `${archivo}.rels`].join('/');
}

function decodificarXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
