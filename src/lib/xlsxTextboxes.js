import JSZip from 'jszip';

/**
 * Extrae el texto de los cuadros de texto (shapes) dibujados sobre cada hoja
 * de un .xlsx.
 *
 * SheetJS lee celdas y fórmulas pero no ve los dibujos, y ahí es donde algunos
 * estudiantes redactan el método constructivo: en vez de escribirlo en una
 * celda bajo «MÉTODO DE TRABAJO», insertan un cuadro de texto flotante sobre
 * la cartilla. Antes de esto, esas cartillas se revisaban como si el método
 * estuviera en blanco —ERA invisible para la revisión, no es que faltara—.
 *
 * Sigue la misma cadena de relaciones que `xlsxImages.js` usa para las
 * imágenes incrustadas, pero mirando `<a:t>` dentro de `<xdr:sp>` en vez de
 * referencias a `media/`.
 *
 * Devuelve { [hoja]: texto }. Ante cualquier problema devuelve {}: no ver los
 * cuadros de texto es aceptable, romper el parseo del libro no.
 */
export async function extraerCuadrosDeTexto(arrayBuffer) {
  const porHoja = {};

  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const leer = async ruta => (zip.file(ruta) ? zip.file(ruta).async('string') : null);

    const wbXml = await leer('xl/workbook.xml');
    if (!wbXml) return porHoja;

    const wbRels = parsearRels(await leer('xl/_rels/workbook.xml.rels'));

    for (const tag of wbXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
      const name = tag.match(/\bname="([^"]*)"/)?.[1];
      const rid = tag.match(/\br:id="([^"]+)"/)?.[1];
      if (name === undefined || !rid) continue;

      const hoja = decodificarXml(name);
      const texto = await textoDeLaHoja(zip, leer, wbRels, rid);
      if (texto) porHoja[hoja] = texto;
    }
  } catch (err) {
    console.warn('[xlsx] No se pudieron extraer los cuadros de texto:', err.message);
  }

  return porHoja;
}

async function textoDeLaHoja(zip, leer, wbRels, rid) {
  const destino = wbRels[rid];
  if (!destino) return '';

  const rutaHoja = resolverRuta('xl/workbook.xml', destino);
  const hojaXml = await leer(rutaHoja);
  const ridDibujo = hojaXml?.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!ridDibujo) return '';

  const relsHoja = parsearRels(await leer(rutaRels(rutaHoja)));
  const destinoDibujo = relsHoja[ridDibujo];
  if (!destinoDibujo) return '';

  const rutaDibujo = resolverRuta(rutaHoja, destinoDibujo);
  const drawingXml = await leer(rutaDibujo);
  if (!drawingXml) return '';

  // Cada <xdr:sp> es un cuadro de texto; sus párrafos <a:p> traen los
  // renglones y cada uno sus fragmentos <a:t>. Se separan los shapes con un
  // salto de línea para no pegar el método de uno con el rótulo del
  // siguiente, y no se intenta reconstruir párrafos: para cruzar contra el
  // itemizado basta con el texto corrido.
  const shapes = drawingXml.match(/<xdr:sp\b[\s\S]*?<\/xdr:sp>/g) ?? [];
  const textos = shapes
    .map(shape => [...shape.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => decodificarXml(m[1])).join(''))
    .filter(t => t.trim());

  return textos.join('\n');
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
