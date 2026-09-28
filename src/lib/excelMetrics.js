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

const CODIGO_ITEM_RE = /^\d{1,3}(\.\d{1,3}){0,3}$/;

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

/** ¿La designación de la partida corresponde a una especialidad? */
export function esEspecialidad(designacion) {
  return ESPECIALIDAD_RE.test(String(designacion ?? ''));
}

/**
 * Las partidas del listado con su designación, para poder distinguirlas.
 * Devuelve [{ codigo, designacion, especialidad }].
 */
export function extraerPartidasListado(excelData) {
  return extraerFilasListado(excelData).map(p => ({
    ...p,
    especialidad: esEspecialidad(p.designacion),
  }));
}

export function extraerItemsListado(excelData) {
  return extraerFilasListado(excelData).map(p => p.codigo);
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
  const hojas = porNombre.length ? porNombre : excelData.sheets.filter(s => !pareceCartillaApu(s));

  // Dos pasadas: primero exigiendo unidad de medida, que es lo propio de un
  // itemizado; si así no sale nada, basta con que la fila describa algo. Las
  // unidades se escriben de mil maneras («UD», «C/U», «M.L.») y no reconocer
  // una dejaba el itemizado entero en cero.
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
      const candidatos = row.slice(0, 4)
        .map(c => String(c?.value ?? '').trim())
        .filter(v => v && !CABECERA_RE.test(v) && CODIGO_ITEM_RE.test(v));

      // Ante un correlativo (1, 2, 3…) y un ítem (1.1, 1.2…) en la misma fila,
      // el ítem es el que lleva punto: quedarse con el primero devolvía la
      // numeración de filas en vez de las partidas.
      const codigo = candidatos.find(v => v.includes('.')) ?? candidatos[0] ?? null;
      if (!codigo || vistos.has(codigo)) continue;

      const texto = row.map(c => String(c?.value ?? '')).join(' ');
      if (exigirUnidad && !UNIDAD_RE.test(texto)) continue;
      // Una partida tiene designación: sin texto es una fila de números sueltos.
      if (!/[a-záéíóúñ]{4}/i.test(texto)) continue;

      // La designación es lo que queda de la fila sin el código ni los números:
      // es lo que permite reconocer una especialidad.
      const designacion = row
        .map(c => String(c?.value ?? '').trim())
        .filter(v => v && v !== codigo && !/^[\d.,$%\s-]+$/.test(v))
        .join(' ');

      vistos.add(codigo);
      partidas.push({ codigo, designacion });
    }
  }

  return partidas.length ? partidas : null;
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

  for (const hoja of apuData.sheets) {
    const filas = hoja.rows ?? [];
    const conteos = MARCAS_APU.map(() => 0);
    const codigosDeLaHoja = new Set();

    for (const row of filas) {
      const texto = (row ?? []).map(c => String(c?.value ?? '')).join(' ');
      if (!texto.trim()) continue;

      MARCAS_APU.forEach((re, i) => { if (re.test(texto)) conteos[i]++; });

      for (const celda of row ?? []) {
        const v = String(celda?.value ?? '').trim();
        if (CODIGO_ITEM_RE.test(v)) codigosDeLaHoja.add(v);
      }
    }

    // Cada sección debería aparecer una vez por cartilla, pero las hojas
    // repiten esas palabras («COSTO MATERIALES», «TOTAL MANO DE OBRA»), así que
    // el máximo se dispara: llegó a informar 805 cartillas donde había muchas
    // menos. El mínimo de las secciones que sí aparecen es el recuento que no
    // inventa cartillas — y como es una estimación de respaldo, conviene que
    // peque de prudente.
    const presentes = conteos.filter(n => n > 0);
    const bloques = presentes.length ? Math.min(...presentes) : 0;
    if (bloques === 0) continue;

    porHoja.push({ hoja: hoja.name, apus: bloques });

    // Los números de partida solo cuentan si vienen de una hoja que de verdad
    // trae cartillas. El itemizado suele ir dentro del mismo libro, y tomar sus
    // códigos daría por analizada toda partida listada: cobertura del 100% para
    // quien hizo la mitad.
    for (const c of codigosDeLaHoja) codigosEnApu.add(c);
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

  const itemsConApu = partidas.filter(p => codigosEnApu.has(p.codigo));
  const itemsSinApu = partidas.filter(p => !codigosEnApu.has(p.codigo));

  // El cruce solo vale si de verdad se encontraron números de partida dentro de
  // las cartillas; si no, se cae al recuento de cartillas.
  const cruceFiable = partidas.length > 0 && itemsConApu.length > 0;
  const ratio = partidas.length === 0
    ? 0
    : Math.min((cruceFiable ? itemsConApu.length : apus) / partidas.length, 1);

  return {
    apus,
    porHoja,
    metodo: porHoja.length > 1 && porHoja.every(h => h.apus === 1)
      ? 'una-hoja-por-cartilla'
      : 'cartillas-dentro-de-la-hoja',
    itemsConApu,
    itemsSinApu,
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
