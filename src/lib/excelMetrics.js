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
export function extraerItemsListado(excelData) {
  if (!excelData?.sheets?.length) return [];

  const UNIT_RE = /\b(m2|m²|ml|m3|m³|kg|un\.?|und\.?|unid\.?|gl\.?|glb\.?|pm|hr|h|lts?|ton|jgo|pza|pzas|vj|set|m\b)/i;
  const HEADER_RE = /^(item|ítem|n[°º]|nro|partida|descripci[oó]n|unidad|cantidad|total)/i;

  const hojaListado = excelData.sheets.find(s =>
    /listado|itemizado|actividades?|partidas?/i.test(s.name),
  );
  const hojas = hojaListado ? [hojaListado] : excelData.sheets;

  const codigos = [];
  const vistos = new Set();
  for (const hoja of hojas) {
    for (const row of hoja.rows ?? []) {
      const primera = String(row?.[0]?.value ?? '').trim();
      if (!primera || HEADER_RE.test(primera) || !CODIGO_ITEM_RE.test(primera)) continue;

      const texto = row.map(c => String(c?.value ?? '')).join(' ');
      if (!UNIT_RE.test(texto)) continue;
      if (vistos.has(primera)) continue;

      vistos.add(primera);
      codigos.push(primera);
    }
  }
  return codigos;
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
  const vacio = {
    apus: 0, porHoja: [], metodo: 'sin-datos',
    itemsConApu: [], itemsSinApu: [...itemsListado],
    ratio: 0, cruceFiable: false,
  };
  if (!apuData?.sheets?.length) return vacio;

  const porHoja = [];
  const codigosEnApu = new Set();

  for (const hoja of apuData.sheets) {
    const filas = hoja.rows ?? [];
    const conteos = MARCAS_APU.map(() => 0);

    for (const row of filas) {
      const texto = (row ?? []).map(c => String(c?.value ?? '')).join(' ');
      if (!texto.trim()) continue;

      MARCAS_APU.forEach((re, i) => { if (re.test(texto)) conteos[i]++; });

      for (const celda of row ?? []) {
        const v = String(celda?.value ?? '').trim();
        if (CODIGO_ITEM_RE.test(v)) codigosEnApu.add(v);
      }
    }

    // Cada sección aparece una vez por cartilla, pero no todas las cartillas
    // traen todas: el máximo es la mejor estimación del número de bloques.
    const bloques = Math.max(...conteos);
    if (bloques > 0) porHoja.push({ hoja: hoja.name, apus: bloques });
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
      ratio: itemsListado.length ? Math.min(conContenido / itemsListado.length, 1) : 0,
    };
  }

  const itemsConApu = itemsListado.filter(c => codigosEnApu.has(c));
  const itemsSinApu = itemsListado.filter(c => !codigosEnApu.has(c));

  // El cruce solo vale si de verdad se encontraron números de partida dentro de
  // las cartillas; si no, se cae al recuento de cartillas.
  const cruceFiable = itemsListado.length > 0 && itemsConApu.length > 0;
  const ratio = itemsListado.length === 0
    ? 0
    : Math.min((cruceFiable ? itemsConApu.length : apus) / itemsListado.length, 1);

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
