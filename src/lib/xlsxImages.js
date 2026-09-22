import JSZip from 'jszip';

/**
 * Cuenta las imágenes incrustadas en cada hoja de un .xlsx.
 *
 * SheetJS lee celdas y fórmulas pero no ve las imágenes, y muchos estudiantes
 * pegan ahí el respaldo de sus cubicaciones. Sin esto la revisión concluiría
 * que no hay respaldo cuando sí lo hay, solo que dentro de la hoja.
 *
 * Un .xlsx es un zip y la cadena que une una hoja con sus imágenes es:
 *   workbook.xml (nombre de hoja → r:id)
 *     → _rels/workbook.xml.rels (r:id → worksheets/sheetN.xml)
 *       → sheetN.xml (<drawing r:id>)
 *         → worksheets/_rels/sheetN.xml.rels (r:id → ../drawings/drawingM.xml)
 *           → drawings/_rels/drawingM.xml.rels (→ ../media/imagenK.png)
 *
 * Devuelve { [nombreHoja]: cantidad }. Ante cualquier problema devuelve {}:
 * no contar imágenes es aceptable, romper el parseo del libro no.
 */
export async function contarImagenesIncrustadas(arrayBuffer) {
  const porHoja = {};
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
      porHoja[hoja] = 0;

      const destino = wbRels[rid];
      if (!destino) continue;

      const rutaHoja = resolverRuta('xl/workbook.xml', destino);
      const hojaXml = await leer(rutaHoja);
      const ridDibujo = hojaXml?.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1];
      if (!ridDibujo) continue;

      const relsHoja = parsearRels(await leer(rutaRels(rutaHoja)));
      const destinoDibujo = relsHoja[ridDibujo];
      if (!destinoDibujo) continue;

      const rutaDibujo = resolverRuta(rutaHoja, destinoDibujo);
      const relsDibujo = await leer(rutaRels(rutaDibujo));
      if (!relsDibujo) continue;

      porHoja[hoja] = (relsDibujo.match(/Target="[^"]*media\/[^"]+"/g) ?? []).length;
    }
  } catch (err) {
    console.warn('[xlsx] No se pudieron contar las imágenes incrustadas:', err.message);
  }
  return porHoja;
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
