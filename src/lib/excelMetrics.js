/**
 * Métricas sobre los libros de Excel: cuántas actividades trae el listado y qué
 * cobertura real alcanzan las cotizaciones.
 *
 * Viven aparte de fileParser porque son funciones puras sobre datos ya
 * parseados: no dependen de pdfjs ni de ninguna API del navegador, y así se
 * pueden probar fuera de él.
 */


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
 * Mide la cobertura real de una planilla de cotizaciones.
 *
 * Contar hojas no sirve: la pauta (Ejemplo 4) describe las cotizaciones como
 * tablas —materiales, herramientas, máquinas y equipos—, no como una hoja por
 * actividad. Un estudiante con sus 161 materiales en una sola hoja no cotizó
 * el 1%, cotizó todo.
 *
 * Lo que sí exige la pauta es TRES proveedores distintos por material, así que
 * se cuentan las filas de material y cuántas los alcanzan.
 */
export function medirCotizaciones(excelData) {
  if (!excelData?.sheets?.length) return { materiales: 0, conPrecio: 0, conTresProveedores: 0, ratio: 0 };

  const HEADER_RE = /^(item|ítem|n[°º]|nro|material|herramienta|maquina|máquina|equipo|total|cotizaci)/i;
  let materiales = 0;
  let conPrecio = 0;
  let conTresProveedores = 0;

  for (const sheet of excelData.sheets) {
    for (const row of sheet.rows ?? []) {
      if (!row || row.length < 3) continue;

      const primera = String(row[0]?.value ?? '').trim();
      if (!primera || HEADER_RE.test(primera)) continue;

      // Debe haber una designación de material, no solo números sueltos.
      const descripcion = row.slice(0, 3).map(c => String(c?.value ?? '')).join(' ');
      if (!/[a-záéíóúñ]{4}/i.test(descripcion)) continue;

      const precios = row.filter(c => esPrecio(c?.value)).length;
      materiales++;
      if (precios >= 1) conPrecio++;
      if (precios >= 3) conTresProveedores++;
    }
  }

  return {
    materiales,
    conPrecio,
    conTresProveedores,
    ratio: materiales > 0 ? conTresProveedores / materiales : 0,
  };
}

// En pesos chilenos: "$ 20.480", "20480", "20.480". Se descartan cantidades
// pequeñas, que suelen ser unidades o metrajes, no precios.
function esPrecio(v) {
  if (v === null || v === undefined || v === '') return false;
  const s = String(v);
  const n = parseFloat(s.replace(/[$\s.]/g, '').replace(',', '.'));
  return !isNaN(n) && n >= 100;
}
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

// Los itemizados escriben el código con o sin punto final —«3.2.1» y «3.2.1.»—
// y bajan más niveles de lo que parece: un itemizado real llega a «6.2.1.2.5»
// y a seis niveles. Quedarse en cuatro dejaba fuera un tercio de las partidas,
// que además se confundían con el correlativo de la fila.
const CODIGO_ITEM_RE = /^\d{1,3}(\.\d{1,3}){0,6}\.?$/;

/** Sin tildes, sin puntuación y en minúsculas, para poder comparar nombres. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

/**
 * Lleva un código de partida a una forma única, o devuelve null si no lo es.
 *
 * Cada estudiante los escribe a su manera, y una entrega real trae de todo:
 * «3.2.1.» con punto final, «1,3,1» con comas, «A.1» con capítulo por letra,
 * y «1/2.1.1» en el itemizado que en la hoja aparece como «1-2.1.1», porque
 * Excel no admite la barra en el nombre de una hoja. Todas son la misma cosa.
 */
export function codigoCanonico(v) {
  const s = String(v ?? '').trim().toUpperCase()
    .replace(/^A\.?P\.?U\.?[\s._-]*\d*[\s._-]*/, '')   // «APU_01 », «A.P.U. 3»
    .replace(/[,/\\|_\s-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '');
  if (!s) return null;

  const partes = s.split('.');
  // Un código es corto y tiene números: «1.2.1.1», «A.1». «LETRERO.DE.OBRA» no.
  if (partes.length > 7) return null;
  if (!partes.every(p => /^[A-Z]{0,2}\d{0,3}$/.test(p) && p)) return null;
  if (!/\d/.test(s)) return null;
  // «1.5.M3» o «28.M3» no son partidas: son una cantidad con su unidad pegada.
  if (partes.some(p => UNIDADES_SUELTAS.has(p))) return null;
  return s;
}

const UNIDADES_SUELTAS = new Set([
  'M', 'M2', 'M3', 'ML', 'KG', 'UN', 'UD', 'GL', 'HR', 'HH', 'TON', 'LT', 'LTS', 'SG', 'PZA',
]);

/**
 * Los números de partida del listado, en orden.
 *
 * Son la referencia del cruce: lo que se evalúa no es cuántas cartillas hay,
 * sino cuáles de las partidas del itemizado tienen su APU.
 */
/**
 * Partidas de especialidades: instalaciones que en la práctica van por
 * subcontrato y cuyas cartillas el estudiante no siempre desarrolla.
 *
 * Cuentan igual en la cobertura —la pauta descarta los subcontratos— pero el
 * informe las nombra aparte, para que el docente decida caso a caso si las
 * penaliza. Se reconocen por la designación de la partida.
 */
const ESPECIALIDAD_RE = new RegExp(
  [
    'el[eé]ctric', 'electricidad', 'iluminaci[oó]n', 'empalme', 'tablero',
    'sanitari', 'alcantarillado', 'agua\\s+potable', 'aguas\\s+lluvias',
    '\\ba+ll\\b', '\\bapf\\b', '\\bapc\\b', '\\balc\\b', 'gasfiter', 'gasfíter',
    '\\bgas\\b', 'red\\s+h[uú]meda', 'red\\s+seca', 'incendio', 'rociador',
    'clima', 'climatiza', 'calefacc', 'ventilaci[oó]n', 'extracci[oó]n\\s+de\\s+aire',
    'ascensor', 'montacarga', 'cor+ientes\\s+d[eé]biles', 'telecomunicaci',
    'cit[oó]fon', 'cctv', 'dom[oó]tica', 'fotovolt', 'solar\\s+t[eé]rmic',
    'riego', 'alarma',
  ].join('|'),
  'i',
);

// Cuando el itemizado marca él mismo sus especialidades —«ver detalle en
// especialidad correspondiente», «S/ESP»— esa marca manda sobre cualquier
// palabra clave. Adivinar por el nombre de la partida da falsos positivos:
// «PUERTAS METÁLICAS SALA CLIMA, ELECTRICIDAD» o «ARTEFACTOS SANITARIOS» son
// partidas que sí se desarrollan.
const MARCA_ESPECIALIDAD_RE = /ver\s+detalle\s+en\s+especialidad|en\s+especialidad\s+correspondiente|\bs\/\s*esp\b|por\s+especialidad/i;

/** ¿La designación de la partida corresponde a una especialidad? */
export function esEspecialidad(designacion) {
  return ESPECIALIDAD_RE.test(String(designacion ?? ''));
}

/** Las filas que el itemizado marca explícitamente como de especialidad. */
function marcaEspecialidad(texto) {
  return MARCA_ESPECIALIDAD_RE.test(String(texto ?? ''));
}

// Lo que va a Gastos Generales no se costea en el APU: la pauta lo determina
// más adelante, en Proyecto de Título. Contarlo como partida sin cartilla
// cargaba al estudiante una deuda que la propia pauta le dice que no tenga.
const EN_GASTOS_GENERALES_RE = /gastos\s+generales/i;

// Una partida cuyo costo va dentro de otra no lleva cartilla propia. La pauta
// permite expresamente fusionar actividades, y el itemizado lo deja escrito:
// «Considerado en ítem 3.4.6», «Se incluye en…». Exigirle cartilla sería
// reprochar precisamente lo que la pauta recomienda.
const INCLUIDA_EN_OTRA_RE = /(considerad[oa]|inclu[íi]d[oa]|se\s+incluye|contemplad[oa])\s+(en|dentro)/i;

/**
 * Las partidas del listado con su designación, para poder distinguirlas.
 * Devuelve [{ codigo, designacion, especialidad }].
 */
export function extraerPartidasListado(excelData) {
  const filas = extraerFilasListado(excelData);

  // Si el itemizado marca sus especialidades, se hace caso a esa marca y solo a
  // ella. Las palabras clave son el último recurso, para los que no las marcan.
  const seMarcanSolas = filas.some(p => marcaEspecialidad(p.fila));
  const esEsp = p => (seMarcanSolas ? marcaEspecialidad(p.fila) : esEspecialidad(p.designacion));

  // Las especialidades van agrupadas en su propio capítulo: si el itemizado
  // marca alguna partida de un capítulo, el capítulo entero es de
  // instalaciones. Sin esto quedaban fuera las subpartidas que no repiten la
  // marca —doce luminarias del capítulo eléctrico— y se exigía cartilla para
  // trabajo que va por especialidad.
  //
  // Solo se hereda cuando la marca es explícita. Heredar de una palabra clave
  // condenaba capítulos enteros por una coincidencia de nombre: en un itemizado
  // sin marcas dio 442 especialidades de 444 partidas.
  const capitulos = seMarcanSolas
    ? new Set(filas.filter(esEsp).map(p => p.codigo.split('.')[0]))
    : null;

  return filas.map(({ fila, ...p }) => ({
    ...p,
    especialidad: capitulos ? capitulos.has(p.codigo.split('.')[0]) : esEsp({ fila, ...p }),
  }));
}

export function extraerItemsListado(excelData) {
  return extraerFilasListado(excelData).map(p => p.codigo);
}

/** Lo que va a Gastos Generales no lleva APU y no entra en el itemizado. */
function esGastoGeneral(fila) {
  return EN_GASTOS_GENERALES_RE.test(fila);
}

/**
 * Las partidas de un itemizado entregado en PDF.
 *
 * Al leer un PDF se pierde la estructura de filas —todo el texto de la página
 * llega seguido— así que no se puede recorrer por líneas. Sí se puede trocear
 * por los códigos: entre un código y el siguiente está la designación, y al
 * final de ella la unidad, que es lo que distingue una partida de un título de
 * capítulo.
 */
export function extraerPartidasDePdf(paginas) {
  const texto = (Array.isArray(paginas) ? paginas : [paginas]).join(' ')
    .replace(/\s+/g, ' ');

  const codigos = [...texto.matchAll(/(?<![\d.,])\d{1,3}(?:[.,]\d{1,3}){1,6}(?![\d.,])/g)];
  const partidas = [];
  const vistos = new Set();

  for (let i = 0; i < codigos.length; i++) {
    const codigo = codigoCanonico(codigos[i][0]);
    if (!codigo || vistos.has(codigo)) continue;

    const desde = codigos[i].index + codigos[i][0].length;
    const hasta = codigos[i + 1]?.index ?? texto.length;
    const resto = texto.slice(desde, hasta).trim();

    // Una partida termina en su unidad; un título de capítulo no la lleva.
    if (!resto || resto.length > 160) continue;
    if (!UNIDAD_RE.test(resto)) continue;
    if (!/[a-záéíóúñ]{4}/i.test(resto)) continue;
    if (esGastoGeneral(resto) || INCLUIDA_EN_OTRA_RE.test(resto)) continue;

    vistos.add(codigo);
    partidas.push({ codigo, designacion: resto, fila: `${codigo} ${resto}` });
  }

  return partidas;
}

function extraerFilasListado(excelData) {
  if (!excelData?.sheets?.length) return [];

  // Se prefiere una hoja que se llame listado/itemizado. Si ninguna lo dice
  // —el itemizado suele ser la primera hoja del libro, con cualquier nombre— se
  // miran todas MENOS las que son cartillas: tomar el ítem de cada cartilla
  // daría tantas partidas como cartillas, y por tanto un 100% siempre.
  const porNombre = excelData.sheets.filter(s =>
    /listado|itemizado|actividades?|partidas?/i.test(s.name),
  );
  // Si ninguna hoja se llama itemizado, solo valen las que tengan pinta de
  // serlo. Antes se miraba cualquier hoja que no fuera una cartilla, y en un
  // libro sin itemizado se acababa leyendo la planilla de sueldos como si lo
  // fuera: partidas inventadas y una cobertura del 7% que habría reprobado a
  // quien tenía casi todo hecho.
  const hojas = porNombre.length
    ? porNombre
    : excelData.sheets.filter(s => !pareceCartillaApu(s) && pareceItemizado(s));

  // Dos pasadas: primero exigiendo que la fila mida algo —unidad o cantidad—,
  // que es lo propio de una partida y deja fuera los títulos de capítulo; si
  // así no sale nada, basta con que describa algo. Las unidades se escriben de
  // mil maneras («UD», «C/U», «M.L.», «N°») y perseguirlas una por una dejaba
  // partidas sin contar: un itemizado real perdía seis de sus cuarenta filas.
  return buscarItems(hojas, true) ?? buscarItems(hojas, false) ?? [];
}

// El borde \b de JavaScript no considera letra a las vocales acentuadas, así
// que \bm\b coincidía con la «m» de «máquina» y una fila sin unidad parecía
// traerla. Se usa un borde propio que sí cuenta las tildes y la ñ.
const NO_LETRA = '[^0-9a-záéíóúüñ]';
const UNIDAD_RE = new RegExp(
  `(?<=^|${NO_LETRA})(m2|m²|ml|m3|m³|kg|un|u/n|c/u|ud|und|unid|gl|glb|pm|hr|hh|h|lts?|ton|jgo|pza|pzas|vj|set|saco|sg|m)(?=$|${NO_LETRA})`,
  'i',
);
const CABECERA_RE = /^(item|ítem|n[°º]|nro|partida|designaci[oó]n|descripci[oó]n|unidad|cantidad|total)/i;

function buscarItems(hojas, exigirUnidad) {
  const partidas = [];
  const vistos = new Set();

  for (const hoja of hojas) {
    for (const row of hoja.rows ?? []) {
      if (!row?.length) continue;

      // El código no siempre está en la columna A: hay libros con columnas en
      // blanco a la izquierda, o con un correlativo antes del ítem.
      const celdas = row.map(c => String(c?.value ?? '').trim());
      const candidatos = celdas.slice(0, 4)
        .map((v, i) => ({ i, codigo: v && !CABECERA_RE.test(v) ? codigoCanonico(v) : null }))
        .filter(c => c.codigo);

      // Ante un correlativo (1, 2, 3…) y un ítem (1.1, A.1, 1/2.1.1) en la
      // misma fila, el ítem es el que tiene más de un nivel: quedarse con el
      // primero devolvía la numeración de filas en vez de las partidas.
      const elegido = candidatos.find(c => c.codigo.includes('.')) ?? candidatos[0] ?? null;
      const codigo = elegido?.codigo ?? null;
      if (!codigo || vistos.has(codigo)) continue;

      const texto = celdas.join(' ');
      if (esGastoGeneral(texto) || INCLUIDA_EN_OTRA_RE.test(texto)) continue;

      // Una partida mide algo: trae unidad o cantidad. Un título de capítulo no
      // trae ninguna de las dos, y así queda fuera sin tener que reconocer cada
      // forma de escribir las unidades. La cantidad se busca DESPUÉS del código,
      // para no confundirla con el correlativo que va antes.
      if (exigirUnidad) {
        const tieneCantidad = celdas.slice(elegido.i + 1).some(v => {
          const n = parseFloat(v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
          return Number.isFinite(n) && n > 0;
        });
        if (!UNIDAD_RE.test(texto) && !tieneCantidad) continue;
      }
      // Una partida tiene designación: sin texto es una fila de números sueltos.
      if (!/[a-záéíóúñ]{4}/i.test(texto)) continue;

      // La designación es lo que queda de la fila sin el código ni los números:
      // es lo que permite reconocer una especialidad.
      const designacion = row
        .map(c => String(c?.value ?? '').trim())
        .filter(v => v && v !== codigo && !/^[\d.,$%\s-]+$/.test(v))
        .join(' ');

      vistos.add(codigo);
      // La fila entera se conserva para poder leer las marcas que el propio
      // itemizado pone («ver detalle en especialidad correspondiente»).
      partidas.push({ codigo, designacion, fila: texto });
    }
  }

  return partidas.length ? partidas : null;
}

// Hojas que enumeran partidas pero no las analizan. Sus números de partida no
// pueden tomarse como prueba de que exista la cartilla.
const ES_HOJA_DE_LISTADO = /listado|itemizado|actividades?|partidas?|presupuesto|resumen|car[aá]tula|portada|[ií]ndice/i;

// Ruido que aparece en las designaciones y no identifica a nadie.
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'con', 'sin', 'para', 'por',
  'en', 'ref', 'un', 'una', 'm', 'm2', 'm3', 'ml', 'kg', 'gl', 'hr', 'ton', 'ud',
  'und', 'unid', 'cu', 'c', 'u', 'lt', 'lts', 'pza', 'mes', 'dia', 'dias', 'apu',
]);

/** Las palabras que de verdad nombran la partida, sin plural ni relleno. */
function palabrasDePartida(texto) {
  return [...new Set(
    normalizar(texto).split(' ')
      .filter(w => w.length >= 3 && !PALABRAS_VACIAS.has(w))
      // «espejo» y «espejos» son la misma partida.
      .map(w => (w.length >= 5 ? w.replace(/e?s$/, '') : w)),
  )];
}

/**
 * ¿Alguna cartilla lleva el nombre de esta partida?
 *
 * Se comparan PALABRAS COMPLETAS, no trozos de texto. Comparar por contención
 * de cadenas obligaba a descartar los nombres cortos —«RADIER», «VIDRIOS»,
 * «TINA»— para que no emparejaran con cualquier cosa, y con ellos se perdían
 * cartillas que sí existían. Por palabras, «tina» ya no coincide con «cortina».
 */
function coincidePorNombre(designacion, nombresEnApu) {
  const partida = palabrasDePartida(designacion);
  if (!partida.length) return false;

  return nombresEnApu.some(cartilla => {
    if (!cartilla.length) return false;
    // Una contiene a la otra: la hoja abrevia lo que el itemizado escribe
    // entero, o al revés.
    const cabeEnPartida = cartilla.every(w => partida.includes(w));
    const cabeEnCartilla = partida.every(w => cartilla.includes(w));
    if (!cabeEnPartida && !cabeEnCartilla) return false;

    // Si dicen exactamente lo mismo, son la misma partida por corto que sea el
    // nombre: la hoja «TINA» analiza la partida «TINA».
    if (cabeEnPartida && cabeEnCartilla) return true;

    // Si una solo contiene a la otra, hace falta algo más que una palabra corta
    // en común para no emparejar por casualidad.
    return cartilla.filter(w => partida.includes(w)).join('').length >= 5;
  });
}

/**
 * ¿Tiene esta hoja la cabecera de un itemizado? Se exigen dos de las cuatro
 * columnas que lo definen, para no confundirlo con cualquier tabla del libro.
 */
function pareceItemizado(hoja) {
  const COLUMNAS = [/\b[ií]tem\b/i, /descripci[oó]n|designaci[oó]n/i, /\bunidad\b/i, /\bcantidad\b/i];
  return (hoja.rows ?? []).slice(0, 40).some(row => {
    const texto = (row ?? []).map(c => String(c?.value ?? '')).join(' ');
    return COLUMNAS.filter(re => re.test(texto)).length >= 2;
  });
}

/** Una hoja que trae al menos dos secciones de cartilla APU. */
function pareceCartillaApu(hoja) {
  const texto = (hoja.rows ?? [])
    .flat()
    .map(c => String(c?.value ?? ''))
    .join(' ');
  return MARCAS_APU.filter(re => re.test(texto)).length >= 2;
}

// Secciones que toda cartilla APU trae una vez. Sirven para contar cartillas
// sin depender de cómo esté organizado el libro.
const MARCAS_APU = [
  /mano\s+de\s+obra/i,
  /materiales/i,
  /(equipos?|maquinarias?)/i,
  /(an[áa]lisis\s+de\s+precio|a\.?\s*p\.?\s*u\.?\b|precio\s+unitario)/i,
  /rendimiento/i,
];

/**
 * Cuenta las cartillas APU y las cruza contra el itemizado.
 *
 * El libro puede venir de dos formas y ambas son válidas: una hoja por partida,
 * o todas las cartillas dentro de una misma hoja. Contar hojas serviría solo
 * para la primera —con la segunda daría «1 cartilla para 161 partidas»— así que
 * se cuentan las cartillas por sus secciones, que aparecen una vez cada una.
 *
 * Lo que decide la cobertura es el cruce con el itemizado, no el total: veinte
 * cartillas para veinte partidas distintas no es lo mismo que veinte para la
 * misma partida.
 */
export function medirApu(apuData, itemsListado = []) {
  // Acepta códigos sueltos o partidas con designación: lo segundo es lo que
  // permite separar las especialidades en el informe.
  const partidas = itemsListado.map(p =>
    typeof p === 'string' ? { codigo: p, designacion: '', especialidad: false } : p,
  );

  const vacio = {
    apus: 0, porHoja: [], metodo: 'sin-datos',
    itemsConApu: [], itemsSinApu: [...partidas],
    ratio: 0, cruceFiable: false,
  };
  if (!apuData?.sheets?.length) return vacio;

  const porHoja = [];
  const codigosEnApu = new Set();
  const nombresEnApu = [];
  const identidades = [];

  for (const hoja of apuData.sheets) {
    const filas = hoja.rows ?? [];
    const conteos = MARCAS_APU.map(() => 0);
    // La mayoría de los libros nombran cada hoja con el código de su partida
    // («1.1.1.1», «A.1», «1,3,1», «1-2.1.1»). Es la pista más fiable que hay.
    const codigosDeLaHoja = new Set();
    const codigoDelNombre = codigoCanonico(hoja.name);
    if (codigoDelNombre) codigosDeLaHoja.add(codigoDelNombre);

    // Y los que no, ponen el nombre de la partida en la hoja y en su título
    // («APU_01 LETRERO DE OBRA»).
    const nombresDeLaHoja = [normalizar(hoja.name.replace(/^apu[\s._-]*\d*/i, ''))];

    for (const row of filas) {
      const celdas = (row ?? []).map(c => String(c?.value ?? '').trim());
      const texto = celdas.join(' ');
      if (!texto.trim()) continue;

      MARCAS_APU.forEach((re, i) => { if (re.test(texto)) conteos[i]++; });

      // Solo se lee el código junto a su rótulo. Rastrearlo por todas las
      // celdas recogía cantidades —«1.00», «472.78» tienen forma de código— y
      // daba por analizadas partidas que nadie había desarrollado.
      const iRotulo = celdas.findIndex(v =>
        /^(partida|[ií]tem)\b/i.test(v) || /partida\s*[-–]\s*actividad/i.test(v));
      if (iRotulo < 0) continue;

      for (const v of celdas.slice(iRotulo + 1, iRotulo + 4)) {
        const c = codigoCanonico(v);
        if (c) { codigosDeLaHoja.add(c); continue; }

        // La pauta pide el número y el nombre juntos, y así llegan: «6.1 PVC PN
        // 10 63 MM». La celda entera no es un código, pero empieza por uno.
        const [inicio, ...resto] = v.split(/\s+/);
        const cPrefijo = codigoCanonico(inicio);
        if (cPrefijo && resto.length) {
          codigosDeLaHoja.add(cPrefijo);
          nombresDeLaHoja.push(normalizar(resto.join(' ')));
        } else if (v.length > 3 && /[a-záéíóúñ]{3}/i.test(v)) {
          nombresDeLaHoja.push(normalizar(v));
        }
      }
    }

    // Una hoja es de cartillas solo si trae DOS secciones distintas. Con una
    // bastaba, y el itemizado —que suele nombrar «materiales» en algún capítulo
    // o llevar una columna «rendimiento»— pasaba por hoja de cartillas: sus
    // números de partida se daban entonces por analizados y toda la entrega
    // salía con 100% de cobertura.
    const presentes = conteos.filter(n => n > 0);
    if (presentes.length < 2 || ES_HOJA_DE_LISTADO.test(hoja.name)) continue;

    // Cada sección debería aparecer una vez por cartilla, pero las hojas
    // repiten esas palabras («COSTO MATERIALES», «TOTAL MANO DE OBRA»), así que
    // el máximo se dispara: llegó a informar 805 cartillas donde había muchas
    // menos. El mínimo de las secciones presentes no inventa cartillas — y como
    // es una estimación de respaldo, conviene que peque de prudente.
    const bloques = Math.min(...presentes);
    if (bloques === 0) continue;

    porHoja.push({ hoja: hoja.name, apus: bloques });

    // Los números de partida solo cuentan si vienen de una hoja que de verdad
    // trae cartillas. El itemizado suele ir dentro del mismo libro, y tomar sus
    // códigos daría por analizada toda partida listada: cobertura del 100% para
    // quien hizo la mitad.
    for (const c of codigosDeLaHoja) codigosEnApu.add(c);
    const palabras = nombresDeLaHoja.map(palabrasDePartida).filter(p => p.length);
    for (const pal of palabras) nombresEnApu.push(pal);

    // La pauta exige que cada cartilla lleve arriba el número y el nombre de su
    // partida. Se anota cuáles no lo traen, para poder observarlo.
    identidades.push({ hoja: hoja.name, codigos: [...codigosDeLaHoja], palabras });
  }

  const apus = porHoja.reduce((s, h) => s + h.apus, 0);

  // Sin marcas reconocibles no se inventa un cero: se cuenta cada hoja con
  // contenido como una cartilla y se deja dicho que la medición es débil.
  if (!apus) {
    const conContenido = apuData.sheets.filter(s => (s.rows ?? []).some(r => r?.length)).length;
    return {
      ...vacio,
      apus: conContenido,
      metodo: 'hojas-con-contenido',
      ratio: partidas.length ? Math.min(conContenido / partidas.length, 1) : 0,
    };
  }

  // Una partida tiene cartilla si aparece su código o su nombre. Hay libros que
  // numeran las cartillas correlativamente y no repiten el código en ninguna
  // parte: ahí el nombre de la partida es lo único que las une.
  // Una cartilla del código padre cubre a sus subpartidas: el estudiante que
  // analiza «5.7.1» una vez no tiene que repetirla para 5.7.1.1, 5.7.1.2… Es la
  // fusión de actividades que la pauta recomienda.
  const cubiertaPorPadre = codigo => {
    const partes = codigo.split('.');
    for (let i = partes.length - 1; i >= 2; i--) {
      if (codigosEnApu.has(partes.slice(0, i).join('.'))) return true;
    }
    return false;
  };

  const tieneCartilla = p =>
    codigosEnApu.has(p.codigo)
    || cubiertaPorPadre(p.codigo)
    || coincidePorNombre(p.designacion, nombresEnApu);

  const itemsConApu = partidas.filter(tieneCartilla);
  const itemsSinApu = partidas.filter(p => !tieneCartilla(p));

  // Si hay partidas pero ninguna cruzó, la cobertura NO se puede medir. Caer al
  // recuento de cartillas daba un 100% con cero coincidencias, que es peor que
  // no informar nada: da por aprobado lo que no se comprobó.
  const cruceFiable = partidas.length > 0 && itemsConApu.length > 0;

  // Se exige el 100% del itemizado, menos las especialidades: esas no se
  // desarrollan, así que no pueden contar como deuda. El denominador son las
  // partidas exigibles, no todas.
  const codigosDelListado = new Set(partidas.map(p => p.codigo));
  const exigibles = partidas.filter(p => !p.especialidad);
  const exigiblesConApu = exigibles.filter(tieneCartilla);
  const ratio = cruceFiable && exigibles.length
    ? Math.min(exigiblesConApu.length / exigibles.length, 1)
    : 0;

  return {
    apus,
    porHoja,
    metodo: porHoja.length > 1 && porHoja.every(h => h.apus === 1)
      ? 'una-hoja-por-cartilla'
      : 'cartillas-dentro-de-la-hoja',
    itemsConApu,
    itemsSinApu,
    // Cartillas que no dicen a qué partida del itemizado corresponden. La pauta
    // exige el número y el nombre en el detalle superior de cada una.
    cartillasSinIdentificar: identidades
      .filter(id => !id.codigos.some(c => codigosDelListado.has(c))
                 && !id.palabras.some(pal => partidas.some(p => coincidePorNombre(p.designacion, [pal]))))
      .map(id => id.hoja),
    // El desglose del denominador, para poder explicarlo en el informe.
    totalPartidas: partidas.length,
    exigibles: exigibles.length,
    exigiblesConApu: exigiblesConApu.length,
    especialidades: partidas.length - exigibles.length,
    ratio,
    cruceFiable,
  };
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
