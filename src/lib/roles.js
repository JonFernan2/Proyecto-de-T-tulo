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

/**
 * Agrupa los archivos por estudiante cuando lo seleccionado es la carpeta del
 * curso. Devuelve null si es la carpeta de un solo estudiante o archivos
 * sueltos, que se cargan directo.
 *
 * El estudiante es la PRIMERA carpeta bajo la raíz elegida, no la que contiene
 * al archivo: un alumno puede ordenar lo suyo en subcarpetas (COTIZACIONES,
 * PLANOS…) y agrupar por la carpeta inmediata lo partiría en varios «alumnos».
 */
export function agruparPorEstudiante(archivos) {
  // Al elegir una carpeta con el selector viene webkitRelativePath; al
  // arrastrarla, react-dropzone deja la ruta en path.
  const rutas = archivos.map(f =>
    (f.webkitRelativePath || f.path || '').split('/').filter(Boolean),
  );

  // Sin carpeta de por medio no hay nada que agrupar.
  if (rutas.some(p => p.length < 2)) return null;

  // Un archivo suelto en la raíz delata que lo elegido es la carpeta de UN
  // estudiante: la del curso contiene carpetas, no entregas.
  if (rutas.some(p => p.length === 2)) return null;

  const grupos = new Map();
  archivos.forEach((f, i) => {
    const alumno = rutas[i][1];
    if (!grupos.has(alumno)) grupos.set(alumno, []);
    grupos.get(alumno).push(f);
  });

  return grupos.size > 1 ? grupos : null;
}

// Palabras que aparecen en los nombres de archivo y no son de nadie. Sirven
// para quedarse con lo que sí puede ser un apellido.
const PALABRAS_DE_DOCUMENTO = new Set([
  'eett', 'ee', 'tt', 'et', 'especificaciones', 'tecnicas', 'técnicas',
  'cubicacion', 'cubicaciones', 'cotizacion', 'cotizaciones', 'cotizacon',
  'itemizado', 'listado', 'partidas', 'actividades', 'apu', 'apus', 'cartilla',
  'cartillas', 'respaldo', 'respaldos', 'respaldocotizaciones', 'anexo',
  'entrega', 'e1', 'e2', 'oficial', 'modificadas', 'modificada', 'modificado',
  'arquitectura', 'estructura', 'especialidades', 'terminaciones', 'maquinas',
  'máquinas', 'equipos', 'materiales', 'mano', 'obra', 'proyecto', 'titulo',
  'título', 'formulacion', 'formulación', 'uvm', 'final', 'copia', 'version',
  'versión', 'pdf', 'word', 'excel', 'doc', 'docx', 'xlsx', 'memoria',
  'presupuesto', 'proveedor', 'proveedores', 'planos', 'plano', 'agua',
  'potable', 'hormigones', 'y', 'de', 'del', 'la', 'el', 'los', 'las',
]);

/**
 * Busca indicios de que lo cargado son entregas de más de un estudiante.
 *
 * Importa porque mezclarlas no falla: produce una corrección que evalúa a tres
 * personas como si fueran una, y cuesta lo mismo que una revisión buena.
 *
 * Devuelve null si no hay indicios, o { nombres, duplicados } para avisar. No
 * decide por el docente: los nombres de archivo son demasiado irregulares para
 * eso, y solo él sabe si «EETT Arquitectura» y «EETT Estructura» son del mismo.
 */
export function detectarMezcla(entradas) {
  const porArchivo = entradas.map(e => [...new Set(apellidosProbables(e.file.name))]);

  // Un apellido suelto suele ser un proveedor o el nombre del proyecto; se
  // consideran solo los que se repiten.
  const frecuencia = new Map();
  for (const tokens of porArchivo) {
    for (const t of tokens) frecuencia.set(t, (frecuencia.get(t) ?? 0) + 1);
  }
  const frecuentes = new Set([...frecuencia].filter(([, n]) => n >= 2).map(([t]) => t));

  // El nombre de una persona son varios tokens —«VASQUEZ OLGUIN RAFAEL
  // ALBERTO» son cuatro— así que contarlos por separado daría cuatro
  // estudiantes donde hay uno. Los que aparecen juntos en un archivo son la
  // misma persona: se unen y se cuentan los grupos resultantes.
  const padre = new Map([...frecuentes].map(t => [t, t]));
  const raiz = t => { while (padre.get(t) !== t) t = padre.get(t); return t; };
  const unir = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) padre.set(ra, rb); };

  for (const tokens of porArchivo) {
    const propios = tokens.filter(t => frecuentes.has(t));
    for (let i = 1; i < propios.length; i++) unir(propios[0], propios[i]);
  }

  const grupos = new Map();
  for (const t of frecuentes) {
    const r = raiz(t);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(t);
  }
  const nombres = [...grupos.values()]
    .map(g => g.sort().join(' '))
    .sort();

  // Roles que una entrega trae una sola vez. Dos EETT pueden ser arquitectura y
  // especialidades; tres cotizaciones o itemizados ya no se explican así.
  const duplicados = ['eett', 'listado', 'cotizaciones']
    .map(rol => ({ rol, n: entradas.filter(e => e.role === rol).length }))
    .filter(({ rol, n }) => n >= (rol === 'eett' ? 3 : 3));

  if (nombres.length < 2 && !duplicados.length) return null;
  return { nombres, duplicados };
}

function apellidosProbables(nombreArchivo) {
  return nombreArchivo
    .replace(/\.[^.]+$/, '')
    .split(/[_\-\s.,()]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 4)
    .filter(t => !/\d/.test(t))
    .filter(t => !PALABRAS_DE_DOCUMENTO.has(t));
}

/** Las imágenes de respaldo de cubicaciones, ya en base64. */
export function extraerImagenes(entradas) {
  return entradas.filter(e => e.role === 'imagen').map(e => e.parsed).filter(Boolean);
}
