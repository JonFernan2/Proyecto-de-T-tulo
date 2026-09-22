/**
 * Asignación de roles a los archivos entregados, y armado del mapa que consume
 * la revisión.
 *
 * Vive aparte para que la carga de a un estudiante y la del curso completo usen
 * exactamente la misma lógica: duplicarla sería garantizar que con el tiempo se
 * separen y que un estudiante se evalúe distinto según por dónde entró.
 */

/** Deduce el rol de un archivo por su nombre y extensión. */
export function guessRole(file, delivery) {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop();

  if (ext === 'docx' || ext === 'doc') {
    if (/cotiz|cot_|proveedor|presupuesto/.test(name)) return 'cotizaciones';
    return 'eett';
  }
  if (ext === 'pdf') {
    if (/eett|especificaci|et_|_et_|tecnica/.test(name)) return 'eett';
    return 'respaldo';
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'imagen';
  if (ext === 'xlsx' || ext === 'xls') {
    if (/apu|analisis|análisis|precios|unitarios|cartilla/.test(name)) return 'apu';
    // "cubica" gana sobre "itemizado": un libro llamado "LISTADO Y CUBICACIONES"
    // trae ambas cosas y debe revisarse como cubicaciones.
    if (/cubica/.test(name)) return 'cubicaciones';
    if (/itemizado|listado|partidas/.test(name)) return 'listado';
    if (/cotiz|cot_|proveedor/.test(name)) return 'cotizaciones';
    return 'cubicaciones';
  }
  return 'respaldo';
}

/**
 * Arma el mapa de archivos que consume la revisión, a partir de entradas
 * { file, role, parsed }.
 *
 * Dos reglas que importan:
 *  - Los archivos de un rol se eligen por CONTENIDO, no por orden de subida:
 *    un rol con un PDF y un Excel debe exponer el Excel como fuente de hojas.
 *  - Varios Excel en el mismo rol se FUSIONAN. Un estudiante puede partir sus
 *    cubicaciones en dos libros, y quedarse con el primero perdería el resto.
 */
export function construirFilesMap(entradas) {
  const ext = e => e.file.name.split('.').pop().toLowerCase();
  const ofRole = role => entradas.filter(e => e.role === role);

  const mergeExcel = role => {
    const libros = ofRole(role).filter(e => e.parsed?.sheets?.length);
    if (!libros.length) return null;
    if (libros.length === 1) return libros[0].parsed;

    // Al fusionar se antepone el nombre del libro a cada hoja, para que en la
    // revisión se sepa de cuál viene cada una.
    return {
      sheets: libros.flatMap(e => {
        const libro = e.file.name.replace(/\.[^.]+$/, '');
        return e.parsed.sheets.map(s => ({ ...s, name: `${libro} › ${s.name}` }));
      }),
      totalRows: libros.reduce((sum, e) => sum + (e.parsed.totalRows ?? 0), 0),
      totalEmbeddedImages: libros.reduce((sum, e) => sum + (e.parsed.totalEmbeddedImages ?? 0), 0),
      fuentes: libros.map(e => e.file.name),
    };
  };

  const textOf = role => ofRole(role).find(e => e.parsed?.text !== undefined)?.parsed ?? null;
  const namesOf = (role, exts) => ofRole(role).filter(e => exts.includes(ext(e))).map(e => e.file.name);

  const cotEntries = ofRole('cotizaciones').map(e => ({
    name: e.file.name,
    ext: ext(e),
    parsed: e.parsed,
  }));

  return {
    eett: mergeExcel('eett') ?? textOf('eett'),
    eettName: ofRole('eett')[0]?.file.name ?? null,

    // El listado puede venir como archivo aparte o dentro del libro de
    // cubicaciones; si no hay archivo propio, queda null y se busca adentro.
    listado: mergeExcel('listado'),
    listadoName: ofRole('listado')[0]?.file.name ?? null,

    cubicaciones: mergeExcel('cubicaciones'),
    cubicacionesName: ofRole('cubicaciones').map(e => e.file.name).join(' + ') || null,

    cotizaciones: mergeExcel('cotizaciones'),
    cotizacionesFiles: cotEntries,
    cotizacionesPdfNames: namesOf('cotizaciones', ['pdf']),

    // Los PDF de respaldo traen proveedor, precio y año: se cotejan contra la
    // planilla. Se conserva de qué archivo viene cada página para poder citarlo.
    respaldoPdfs: [...ofRole('respaldo'), ...ofRole('cotizaciones')]
      .filter(e => ext(e) === 'pdf' && e.parsed?.pages)
      .map(e => ({
        name: e.file.name,
        pages: e.parsed.pages,
        numPages: e.parsed.numPages,
        escaneado: e.parsed.escaneado,
        paginasConTexto: e.parsed.paginasConTexto,
      })),

    apu: mergeExcel('apu'),

    respaldoPdfNames: [
      ...namesOf('respaldo', ['pdf']),
      ...namesOf('cotizaciones', ['pdf']),
    ],
    imageCount: ofRole('imagen').length,
  };
}

/** Las imágenes de respaldo de cubicaciones, ya en base64. */
export function extraerImagenes(entradas) {
  return entradas.filter(e => e.role === 'imagen').map(e => e.parsed).filter(Boolean);
}
