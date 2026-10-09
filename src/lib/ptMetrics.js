/**
 * Verificaciones medidas de Proyecto de Título (pauta, sección 1.2).
 *
 * Igual que excelMetrics, son funciones puras sobre los archivos ya leídos: lo
 * que se puede comprobar con aritmética se comprueba aquí, y viaja a la
 * revisión como hecho verificado. Lo que exige criterio —si un rendimiento es
 * razonable, si la ruta crítica está bien trazada— queda para el evaluador.
 */
import { codigoCanonico, normalizar, pareceCartillaApu } from './excelMetrics.js';

// ─── Utilidades de celda ─────────────────────────────────────────────────────
const texto = c => String(c?.value ?? '').trim();

/** El número de una celda: el valor sin formato si lo hay, si no el texto. */
function numero(c) {
  if (!c) return NaN;
  if (typeof c.raw === 'number') return c.raw;
  const crudo = texto(c);
  if (!crudo || /[a-záéíóúñ#=/]/i.test(crudo)) return NaN;
  const s = crudo.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return NaN;
  const ultimo = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // El último separador es decimal salvo que le sigan exactamente tres dígitos.
  let n = ultimo < 0 || s.length - ultimo - 1 === 3
    ? parseFloat(s.replace(/[.,]/g, ''))
    : parseFloat(`${s.slice(0, ultimo).replace(/[.,]/g, '')}.${s.slice(ultimo + 1)}`);
  if (/%/.test(crudo)) n /= 100;
  return n;
}

const cerca = (a, b, tol) => Math.abs(a - b) <= tol;
const entero = n => Math.abs(n - Math.round(n)) < 0.001;
const clp = n => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('es-CL')}` : '—');
const dec = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString('es-CL', { maximumFractionDigits: d }) : '—');

/** Busca la fila de encabezado de una tabla y devuelve la columna de cada campo. */
function columnasDe(celdas, campos, col = {}) {
  celdas.forEach((t, j) => {
    if (!t || Object.values(col).includes(j)) return;
    for (const [campo, re] of Object.entries(campos)) {
      if (col[campo] === undefined && re.test(t)) { col[campo] = j; break; }
    }
  });
  return col;
}

function encontrarTabla(hojas, campos, minimo) {
  for (const hoja of hojas) {
    const filas = hoja.rows ?? [];
    for (let i = 0; i < Math.min(filas.length, 80); i++) {
      const a = (filas[i] ?? []).map(texto);
      const col = columnasDe(a, campos);
      if (Object.keys(col).length < minimo) continue;

      // El encabezado puede seguir en el renglón de abajo («Tiempo» arriba,
      // «Exacto (días)» abajo): se completan las columnas que faltaron. Se lee
      // fila por fila y no las dos juntas, porque un título sobre la tabla
      // («PLANILLA DE RENDIMIENTOS») se pegaba a la primera columna y la
      // hacía pasar por otra.
      const b = (filas[i + 1] ?? []).map(texto);
      const bEsEncabezado = !b.some(t => codigoCanonico(t)) && b.some(t => t && Object.values(campos).some(re => re.test(t)));
      if (bEsEncabezado) columnasDe(b, campos, col);
      return { hoja, col, desde: i + (bEsEncabezado ? 2 : 1) };
    }
  }
  return null;
}

/** ¿Cubre el código `de` a la partida `p`? Un rendimiento del padre cubre a sus hijas. */
const cubre = (codigos, p) => codigos.has(p) || [...codigos].some(c => p.startsWith(`${c}.`));

// ─── PT1 · Rendimientos ──────────────────────────────────────────────────────
const CAMPOS_RENDIMIENTOS = {
  item: /^[ií]tem|^n[°º]|^c[oó]d/i,
  actividad: /actividad|descripci[oó]n|designaci[oó]n|partida/i,
  unidad: /^unidad|^ud\.?$|^un\.?$/i,
  cantidad: /cantidad|cubicaci[oó]n/i,
  rendimiento: /rendimiento/i,
  exacto: /exacto/i,
  aproximado: /aproximado/i,
  cuadrilla: /cuadrilla/i,
};

const esGlobal = u => /^g(l|lb|lobal)\.?$/i.test(String(u ?? '').trim());

/** El tiempo aproximado de la pauta: al cuarto de jornada siguiente (Ejemplo 10). */
export const aCuartoDeJornada = dias => Math.ceil(dias * 4 - 1e-9) / 4;

/**
 * La planilla de rendimientos del Ejemplo 11.
 *
 * Comprueba lo que es aritmética de la pauta: duración exacta = cantidad /
 * rendimiento, tiempo aproximado al cuarto de jornada superior, que las
 * actividades no globales traigan rendimiento, y cuántas son GLOBAL (la pauta
 * pide que sean las mínimas). Si llega el itemizado, dice qué partidas faltan.
 */
export function medirRendimientos(libro, itemizado = []) {
  const tabla = encontrarTabla(libro?.sheets ?? [], CAMPOS_RENDIMIENTOS, 4);
  if (!tabla || tabla.col.rendimiento === undefined) {
    return { encontrada: false, hojas: (libro?.sheets ?? []).map(s => s.name) };
  }
  const { hoja, col, desde } = tabla;
  const filas = [];

  for (const row of (hoja.rows ?? []).slice(desde)) {
    const celda = campo => (col[campo] !== undefined ? row[col[campo]] : null);
    const codigo = codigoCanonico(texto(celda('item')));
    const unidad = texto(celda('unidad'));
    if (!codigo || !unidad || /^-+$/.test(unidad)) continue;   // títulos de capítulo
    filas.push({
      codigo,
      actividad: texto(celda('actividad')),
      unidad,
      global: esGlobal(unidad),
      cantidad: numero(celda('cantidad')),
      rendimiento: numero(celda('rendimiento')),
      exacto: numero(celda('exacto')),
      aproximado: numero(celda('aproximado')),
      cuadrilla: texto(celda('cuadrilla')),
      formulaExacto: celda('exacto')?.formula ?? null,
    });
  }

  const sinRendimiento = [];
  const errExacto = [];
  const errAprox = [];
  const sinAprox = [];
  const sinCuadrilla = [];
  let exactoSinFormula = 0;

  for (const f of filas) {
    if (!f.cuadrilla || /^-+$/.test(f.cuadrilla)) sinCuadrilla.push(f.codigo);

    let exacto = f.exacto;
    if (!f.global) {
      if (!(f.rendimiento > 0)) { sinRendimiento.push(f.codigo); }
      else if (f.cantidad > 0) {
        const esperado = f.cantidad / f.rendimiento;
        if (Number.isFinite(f.exacto) && !cerca(f.exacto, esperado, Math.max(0.01, esperado * 0.005))) {
          errExacto.push({ codigo: f.codigo, cantidad: f.cantidad, rendimiento: f.rendimiento, informado: f.exacto, esperado });
        }
        if (!Number.isFinite(exacto)) exacto = esperado;
        if (Number.isFinite(f.exacto) && !f.formulaExacto) exactoSinFormula++;
      }
    }

    if (!Number.isFinite(f.aproximado)) { sinAprox.push(f.codigo); continue; }
    // En las GLOBAL el tiempo se estima: solo se pide que venga en cuartos.
    const esperado = Number.isFinite(exacto) && !f.global ? aCuartoDeJornada(exacto) : null;
    const enCuartos = cerca(f.aproximado * 4, Math.round(f.aproximado * 4), 1e-6);
    if ((esperado !== null && !cerca(f.aproximado, esperado, 1e-6)) || !enCuartos) {
      errAprox.push({ codigo: f.codigo, exacto, informado: f.aproximado, esperado });
    }
  }

  const exigibles = itemizado.filter(p => !p.especialidad).map(p => p.codigo);
  const codigos = new Set(filas.map(f => f.codigo));
  const faltantes = exigibles.filter(c => !cubre(codigos, c));

  return {
    encontrada: true,
    hoja: hoja.name,
    columnas: Object.keys(col),
    n: filas.length,
    globales: filas.filter(f => f.global).map(f => f.codigo),
    sinRendimiento,
    errExacto,
    errAprox,
    sinAprox,
    sinCuadrilla,
    exactoSinFormula,
    diasAproximados: filas.reduce((s, f) => s + (Number.isFinite(f.aproximado) ? f.aproximado : 0), 0),
    exigibles: exigibles.length,
    faltantes,
  };
}

// ─── PT1 · Carta Gantt ───────────────────────────────────────────────────────
// Tamaños ISO en mm (lado menor × lado mayor).
const FORMATOS = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], Carta: [216, 279] };

function formatoDePagina({ anchoMm, altoMm }) {
  const [menor, mayor] = [Math.min(anchoMm, altoMm), Math.max(anchoMm, altoMm)];
  for (const [nombre, [a, b]] of Object.entries(FORMATOS)) {
    if (cerca(menor, a, 15) && cerca(mayor, b, 15)) return nombre;
  }
  return `${menor}×${mayor} mm`;
}

/** El primer día hábil de un año: el 1 de enero es feriado, y se saltan sábado y domingo. */
export function primerDiaHabil(anio) {
  const d = new Date(Date.UTC(anio, 0, 2));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const MESES_ES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };

/** Las fechas que aparecen en el texto de la Gantt: «04-01-27», «4/1/2027», «4 ene '27». */
function fechasDelTexto(t) {
  const fechas = [];
  const agregar = (d, m, a) => {
    let anio = Number(a);
    if (anio < 100) anio += 2000;
    const f = new Date(Date.UTC(anio, Number(m) - 1, Number(d)));
    if (anio >= 2015 && anio <= 2045 && f.getUTCDate() === Number(d)) fechas.push(f);
  };
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)) agregar(m[1], m[2], m[3]);
  for (const m of t.matchAll(/\b(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)[a-z]*\.?\s+'?(\d{2}|\d{4})\b/gi)) {
    agregar(m[1], MESES_ES[m[2].toLowerCase()], m[3]);
  }
  return fechas;
}

const iso = d => d.toISOString().slice(0, 10);

/**
 * La Carta Gantt en PDF.
 *
 * Del texto se sacan los vínculos (FC, CC, FF, CF con su desfase) y las
 * fechas: la pauta fija el inicio en el primer día hábil del año siguiente al
 * que se cursa la asignatura. Del tamaño de página, si viene en A0 o A1. Lo
 * dibujado —ruta crítica en rojo, feriados en gris, títulos en negro— lo mira
 * el evaluador en las imágenes.
 */
export function medirGantt(gantt = [], projectNames = [], { anioCurso = new Date().getFullYear() } = {}) {
  if (!gantt.length) return { entregada: false, project: projectNames };

  const textoTotal = gantt.flatMap(g => g.pages ?? []).join('\n');
  const vinculos = { FC: 0, CC: 0, FF: 0, CF: 0 };
  let conDesfase = 0;
  for (const m of textoTotal.matchAll(/\b\d{1,4}\s?(FC|CC|FF|CF)\s?([+-]\s?\d+[,.]?\d*\s?(d[ií]as?|d|ed|sem|h))?/gi)) {
    vinculos[m[1].toUpperCase()]++;
    if (m[2]) conDesfase++;
  }

  const fechas = fechasDelTexto(textoTotal).sort((a, b) => a - b);
  const inicio = fechas[0] ?? null;
  const fin = fechas.at(-1) ?? null;
  const esperado = primerDiaHabil(anioCurso + 1);

  return {
    entregada: true,
    project: projectNames,
    archivos: gantt.map(g => ({
      nombre: g.name,
      paginas: g.numPages,
      formatos: [...new Set((g.tamanos ?? []).map(formatoDePagina))],
      escaneado: g.escaneado,
      imagenes: g.imagenes?.length ?? 0,
    })),
    vinculos,
    conDesfase,
    inicio: inicio ? iso(inicio) : null,
    fin: fin ? iso(fin) : null,
    plazoDias: inicio && fin ? Math.round((fin - inicio) / 86400000) + 1 : null,
    inicioEsperado: iso(esperado),
    inicioCorrecto: inicio ? iso(inicio) === iso(esperado) : null,
  };
}

// ─── PT2 · Clasificación de las hojas ────────────────────────────────────────
const textoDeHoja = hoja => (hoja.rows ?? []).flat().map(texto).filter(Boolean).join(' ');

/**
 * Reparte las hojas de los libros de la Entrega 2 según lo que contienen.
 *
 * Muchos estudiantes entregan gastos generales, presupuesto, organigramas y
 * cartillas en un solo libro, o los reparten de cualquier forma: el rol del
 * archivo es una pista, pero lo que manda es el contenido de cada hoja.
 */
export function clasificarHojasPT2(libros = []) {
  const grupos = { gastosGenerales: [], presupuesto: [], organigramas: [], apu: [], otras: [] };
  const vistas = new Set();

  for (const { libro, rol } of libros) {
    for (const hoja of libro?.sheets ?? []) {
      if (vistas.has(hoja)) continue;
      vistas.add(hoja);
      const nombre = hoja.name ?? '';
      const t = textoDeHoja(hoja);

      let grupo;
      if (pareceCartillaApu(hoja) && /cartilla|precio\s+neto|rendimiento/i.test(t)) grupo = 'apu';
      else if (/organi/i.test(nombre) || (/organigrama/i.test(t) && !/precio\s+unitario/i.test(t))) grupo = 'organigramas';
      else if (/gasto|g\.?\s?g\.?\b|general/i.test(nombre)
        || (/gastos?\s+generales?/i.test(t) && /meses|\$\s*\/\s*mes|oficina\s+central|en\s+obra/i.test(t) && !/precio\s+unitario/i.test(t))) grupo = 'gastosGenerales';
      else if (/presup/i.test(nombre) || (/precio\s+unitario|p\.\s?u\./i.test(t) && /costo\s+directo|iva/i.test(t))) grupo = 'presupuesto';
      // Una hoja sin pistas propias va con el rol de su archivo.
      else if (grupos[rol]) grupo = rol;
      else grupo = 'otras';

      grupos[grupo].push(hoja);
    }
  }
  return grupos;
}

/** Busca en una hoja la fila que trae el rótulo y devuelve sus números a la derecha. */
function valoresDeRotulo(hojas, re, { excluir = null } = {}) {
  for (const hoja of hojas) {
    for (const row of hoja.rows ?? []) {
      const i = row.findIndex(c => re.test(texto(c)) && !(excluir && excluir.test(texto(c))));
      if (i < 0) continue;
      const celdas = row.slice(i + 1).filter(c => Number.isFinite(numero(c)));
      if (!celdas.length) continue;
      return { rotulo: texto(row[i]), celdas, hoja: hoja.name };
    }
  }
  return null;
}

// ─── PT2 · Gastos Generales ──────────────────────────────────────────────────
// Lo que la pauta tipifica en cada tabla (págs. 17 a 19). El estudiante agrega
// o quita según su proyecto: se informa qué hay, no se exige cada ítem.
const SECCIONES_GG = {
  'personal técnico y administrativo': /administrador\s+de\s+obra|jefe\s+de\s+obra|bodeguero|personal\s+t[eé]cnico/i,
  'seguridad de faenas': /seguridad|mascarilla|guante|botiqu[ií]n|epp/i,
  transporte: /transporte|camioneta|combustible|bencina|petr[oó]leo/i,
  'herramientas y materiales': /herramienta|carretilla|taladro|esmeril/i,
  'permisos municipales': /permiso|derecho|municipal|ocupaci[oó]n\s+de\s+(calzada|vereda)/i,
  'boletas de garantía': /boleta|garant[ií]a|cauci[oó]n/i,
  'pólizas y seguros': /p[oó]liza|seguro/i,
  'ensayos de laboratorio': /ensayo|laboratorio/i,
  insumos: /electricidad|agua\s+potable|tel[eé]fono|insumo/i,
  'oficina central': /oficina\s+central|indirecto|gerente|contador/i,
};

/**
 * La planilla de gastos generales y el %GG.
 *
 * %GG = [(0,32 · GG oficina central + GG obra) / Costo Directo] · 100, con dos
 * decimales (pauta, pág. 20): la obra en estudio absorbe sus gastos directos y
 * el 32% de los de la oficina central.
 */
export function medirGastosGenerales(hojas = []) {
  if (!hojas.length) return { encontrada: false };
  const t = hojas.map(textoDeHoja).join(' ');

  const directos = valoresDeRotulo(hojas, /total.*(directos?|en\s+obra|obra)|gastos?\s+generales?\s+(directos?|en\s+obra)/i, { excluir: /indirect|costo\s+directo/i });
  const indirectos = valoresDeRotulo(hojas, /total.*(indirectos?|oficina)|gastos?\s+generales?\s+(indirectos?|oficina)/i);
  const costoDirecto = valoresDeRotulo(hojas, /costo\s+directo/i);
  const pct = valoresDeRotulo(hojas, /%\s*(de\s+)?(g\.?\s?g\.?|gastos?\s+generales?)|gastos?\s+generales?\s*%/i);

  const montoDe = v => (v ? Math.max(...v.celdas.map(numero).filter(n => n > 1)) : NaN);
  const dir = montoDe(directos);
  const ind = montoDe(indirectos);
  const cd = montoDe(costoDirecto);
  let pctInformado = NaN;
  let pctTexto = null;
  if (pct) {
    const c = pct.celdas.find(x => numero(x) > 0 && numero(x) < 100);
    if (c) {
      pctInformado = numero(c) <= 1 ? numero(c) * 100 : numero(c);
      pctTexto = texto(c);
    }
  }

  const pctEsperado = dir > 0 && ind > 0 && cd > 0 ? ((0.32 * ind + dir) / cd) * 100 : NaN;
  const formulas = hojas.flatMap(h => (h.rows ?? []).flat()).map(c => c?.formula ?? '').filter(Boolean);
  const usa32 = formulas.some(f => /0[.,]32\b|\b32\s*%/.test(f)) || /\b0[.,]32\b|\b32\s*%/.test(t);
  const decimales = pctTexto ? (pctTexto.match(/[.,](\d+)/)?.[1]?.length ?? 0) : null;

  // Meses de cada ítem: no pueden exceder el plazo de la Carta Gantt.
  // Solo dentro de cada tabla con columna «MESES»: la tabla siguiente puede
  // usar esa misma columna para cantidades (cien mascarillas no son cien meses).
  let mesesMax = 0;
  for (const hoja of hojas) {
    const filas = hoja.rows ?? [];
    filas.forEach((row, k) => {
      const i = row.findIndex(c => /^meses?$/i.test(texto(c)));
      if (i < 0) return;
      for (const r of filas.slice(k + 1)) {
        if (r.some(c => /^(cantidad|meses?|\$\s*\/\s*(unidad|mes)|valor\s+por)/i.test(texto(c)))) break;
        if (r.length && !r.some(c => Number.isFinite(numero(c))) && r.filter(c => texto(c)).length === 1) break;   // título de la tabla siguiente
        const n = numero(r[i]);
        if (n > mesesMax && n < 120) mesesMax = n;
      }
    });
  }

  return {
    encontrada: true,
    hojas: hojas.map(h => h.name),
    directos: dir,
    indirectos: ind,
    costoDirecto: cd,
    pctInformado,
    pctTexto,
    pctEsperado,
    cuadra: Number.isFinite(pctInformado) && Number.isFinite(pctEsperado) ? cerca(pctInformado, pctEsperado, 0.01) : null,
    usa32,
    decimales,
    mesesMax: mesesMax || null,
    secciones: Object.fromEntries(Object.entries(SECCIONES_GG).map(([k, re]) => [k, re.test(t)])),
  };
}

// ─── PT2 · Presupuesto detallado ─────────────────────────────────────────────
const CAMPOS_PRESUPUESTO = {
  item: /^[ií]tem|^n[°º]|^c[oó]d/i,
  actividad: /actividad|descripci[oó]n|designaci[oó]n|partida/i,
  unidad: /^unidad|^ud\.?$|^un\.?$/i,
  cantidad: /cantidad|cubicaci[oó]n/i,
  precio: /precio\s*unit|p\.\s?u\.?|unitario/i,
  total: /^total|precio\s+total|valor\s+total/i,
};

const RECUADRO = [
  ['costoDirecto', /^costo\s+directo/i],
  ['gastosGenerales', /^gastos?\s+generales?/i],
  ['utilidades', /^utilidad(es)?/i],
  ['imprevistos', /^imprevistos?/i],
  ['costoNeto', /^(costo|precio|valor)\s+neto|^neto/i],
  ['iva', /^i\.?v\.?a\.?/i],
  ['total', /^total(\s+(general|presupuesto|obra|proyecto))?\s*$/i],
  ['valorUF', /^valor\s+(de\s+la\s+)?u\.?f\.?(?!.*m)/i],
  ['totalUF', /total\s+(en\s+)?u\.?f/i],
  ['superficie', /superficie/i],
  ['ufM2', /u\.?f\.?\s*\/\s*m/i],
];

function leerRecuadro(hojas) {
  const r = {};
  for (const hoja of hojas) {
    for (const row of hoja.rows ?? []) {
      const i = row.findIndex(c => texto(c));
      if (i < 0) continue;
      const rotulo = texto(row[i]);
      const par = RECUADRO.find(([clave, re]) => !r[clave] && re.test(rotulo));
      if (!par) continue;
      const nums = row.slice(i + 1).map(c => ({ c, n: numero(c) })).filter(x => Number.isFinite(x.n));
      if (!nums.length) continue;
      // Gastos generales, utilidades e imprevistos traen el porcentaje y el monto.
      const pct = nums.find(x => /%/.test(texto(x.c)) || (x.n > 0 && x.n < 1));
      const monto = nums.filter(x => x !== pct).map(x => x.n).sort((a, b) => b - a)[0];
      r[par[0]] = {
        rotulo,
        pct: pct ? (pct.n < 1 ? pct.n * 100 : pct.n) : null,
        monto: monto ?? (pct ? null : nums[0].n),
        texto: nums.map(x => texto(x.c)).join(' · '),
        conDecimales: nums.some(x => !/%/.test(texto(x.c)) && x.n >= 1000 && !entero(x.n)),
      };
    }
  }
  return r;
}

/**
 * El presupuesto detallado y su recuadro final (Ejemplos 18 a 20).
 *
 * Comprueba el Total de cada partida (cantidad × precio, con la fórmula a la
 * vista), los montos sin decimales y con signo $ (Nota 11), y la cadena del
 * recuadro: CD = suma de totales; GG, utilidades e imprevistos sobre el CD;
 * costo neto = CD + GG + U + I; IVA 19% del neto; total = neto + IVA; total
 * en UF con dos decimales y UF/m².
 */
export function medirPresupuesto(hojas = [], itemizado = [], { pctGG = null } = {}) {
  if (!hojas.length) return { encontrada: false };
  const tabla = encontrarTabla(hojas, CAMPOS_PRESUPUESTO, 4);

  const partidas = [];
  if (tabla) {
    const { hoja, col, desde } = tabla;
    for (const row of (hoja.rows ?? []).slice(desde)) {
      const celda = campo => (col[campo] !== undefined ? row[col[campo]] : null);
      const codigo = codigoCanonico(texto(celda('item')));
      const unidad = texto(celda('unidad'));
      if (!codigo || !unidad || /^-+$/.test(unidad)) continue;
      partidas.push({
        codigo,
        cantidad: numero(celda('cantidad')),
        precio: numero(celda('precio')),
        total: numero(celda('total')),
        formula: celda('total')?.formula ?? null,
        textoTotal: texto(celda('total')),
        textoPrecio: texto(celda('precio')),
      });
    }
  }

  const conTotal = partidas.filter(p => Number.isFinite(p.total));
  const totalSinFormula = conTotal.filter(p => !p.formula).map(p => p.codigo);
  const totalNoCuadra = conTotal
    .filter(p => Number.isFinite(p.cantidad) && Number.isFinite(p.precio))
    .filter(p => !cerca(p.total, p.cantidad * p.precio, Math.max(2, Math.abs(p.total) * 0.0005)))
    .map(p => ({ codigo: p.codigo, cantidad: p.cantidad, precio: p.precio, informado: p.total, esperado: p.cantidad * p.precio }));
  const sinPrecio = partidas.filter(p => !(p.precio > 0)).map(p => p.codigo);
  const montosConDecimales = partidas
    .filter(p => [p.precio, p.total].some(n => Number.isFinite(n) && n >= 1 && !entero(n)))
    .map(p => p.codigo);
  const sinSigno = partidas.filter(p => p.textoPrecio && !/\$/.test(p.textoPrecio + p.textoTotal)).length;
  const sumaTotales = conTotal.reduce((s, p) => s + p.total, 0);

  // ── El recuadro final ──────────────────────────────────────────────────────
  const r = leerRecuadro(hojas);
  const m = k => r[k]?.monto ?? NaN;
  const checks = [];
  const comprobar = (concepto, informado, esperado, tol) => {
    if (!Number.isFinite(informado) || !Number.isFinite(esperado)) return;
    checks.push({ concepto, informado, esperado, ok: cerca(informado, esperado, tol) });
  };
  const tolPesos = v => Math.max(2, Math.abs(v) * 0.0005);

  comprobar('Costo directo = suma de los totales', m('costoDirecto'), sumaTotales, tolPesos(sumaTotales));
  for (const [clave, nombre] of [['gastosGenerales', 'Gastos generales'], ['utilidades', 'Utilidades'], ['imprevistos', 'Imprevistos']]) {
    if (r[clave]?.pct != null) comprobar(`${nombre} = ${dec(r[clave].pct)}% del costo directo`, m(clave), (r[clave].pct / 100) * m('costoDirecto'), tolPesos(m(clave)));
  }
  comprobar('Costo neto = CD + GG + utilidades + imprevistos', m('costoNeto'),
    m('costoDirecto') + m('gastosGenerales') + m('utilidades') + m('imprevistos'), tolPesos(m('costoNeto')));
  comprobar('IVA = 19% del costo neto', m('iva'), 0.19 * m('costoNeto'), tolPesos(m('iva')));
  comprobar('Total = costo neto + IVA', m('total'), m('costoNeto') + m('iva'), tolPesos(m('total')));
  comprobar('Total en UF = total / valor UF', m('totalUF'), m('total') / m('valorUF'), 0.01);
  comprobar('UF/m² = total en UF / superficie', m('ufM2'), m('totalUF') / m('superficie'), 0.01);

  const faltanRecuadro = ['costoDirecto', 'gastosGenerales', 'utilidades', 'imprevistos', 'costoNeto', 'iva', 'total', 'valorUF', 'totalUF', 'superficie', 'ufM2']
    .filter(k => !r[k]);

  // ── Instalaciones estimadas (pág. 21) ─────────────────────────────────────
  const t = hojas.map(textoDeHoja).join(' ');
  const instalaciones = {
    'eléctricas': /el[eé]ctric/i.test(t),
    'climatización': /climatiz/i.test(t),
    gases: /\bgases?\b/i.test(t),
  };

  const exigibles = itemizado.filter(p => !p.especialidad).map(p => p.codigo);
  const codigos = new Set(partidas.map(p => p.codigo));

  return {
    encontrada: true,
    hojas: hojas.map(h => h.name),
    tablaEncontrada: Boolean(tabla),
    hojaTabla: tabla?.hoja.name ?? null,
    n: partidas.length,
    sumaTotales,
    totalSinFormula,
    totalNoCuadra,
    sinPrecio,
    montosConDecimales,
    sinSigno,
    recuadro: r,
    checks,
    faltanRecuadro,
    pctGGPresupuesto: r.gastosGenerales?.pct ?? null,
    pctGGPlanilla: pctGG,
    instalaciones,
    exigibles: exigibles.length,
    faltantes: exigibles.filter(c => !cubre(codigos, c)),
  };
}

// ─── PT2 · Cartillas completadas ─────────────────────────────────────────────
/**
 * Las cartillas de Formulación debían dejar en blanco imprevistos, gastos
 * generales, utilidad y precio neto. En esta entrega se completan (pág. 20).
 */
export function medirCartillasCompletadas(apuData, pctGG = null) {
  const hojas = (apuData?.sheets ?? []).filter(pareceCartillaApu);
  if (!hojas.length) return { entregadas: false };

  const campos = { imprevistos: /^imprevistos?/i, gastosGenerales: /^gastos?\s+generales?/i, utilidad: /^utilidad/i, precioNeto: /^precio\s+neto/i };
  let completas = 0;
  let parciales = 0;
  let vacias = 0;
  const pctsGG = new Set();

  for (const hoja of hojas) {
    const llenos = {};
    for (const row of hoja.rows ?? []) {
      const celdas = row.slice(0, 10);
      const i = celdas.findIndex(c => Object.values(campos).some(re => re.test(texto(c))));
      if (i < 0) continue;
      const clave = Object.keys(campos).find(k => campos[k].test(texto(celdas[i])));
      const nums = celdas.slice(i + 1).map(numero).filter(n => Number.isFinite(n) && n > 0);
      llenos[clave] = nums.length > 0;
      if (clave === 'gastosGenerales') {
        const p = nums.find(n => n < 1 || (n > 1 && n < 100));
        if (p !== undefined) pctsGG.add(Math.round((p < 1 ? p * 100 : p) * 100) / 100);
      }
    }
    const n = Object.values(llenos).filter(Boolean).length;
    if (n === 4) completas++;
    else if (n > 0) parciales++;
    else vacias++;
  }

  return {
    entregadas: true,
    cartillas: hojas.length,
    completas,
    parciales,
    vacias,
    pctsGG: [...pctsGG],
    coincideConPlanilla: pctGG != null && pctsGG.size ? [...pctsGG].every(p => cerca(p, pctGG, 0.01)) : null,
  };
}

// ─── PT2 · Organigramas ──────────────────────────────────────────────────────
const CARGO_RE = /administrador|jefe|residente|capataz|bodeguer|secretari|administrativ|junior|trazador|prevenci|top[oó]graf|gerente|contador|nochero|guardia|porter|aseo|autocontrol|calidad|laboratori|mec[aá]nic|chofer|operador|encargad|profesional|ingenier|t[eé]cnic|asistente|presidente|directorio|abogad|asesor|jornal|maestro|ayudante|ito\b/i;
const DEPARTAMENTO_RE = /^(departamento|depto\.?|[áa]rea|unidad|divisi[oó]n|secci[oó]n)\b/i;

/** Los textos de una hoja que pueden ser nodos de un organigrama. */
function nodosDeHoja(hoja) {
  const nodos = [];
  for (const row of hoja.rows ?? []) {
    for (const c of row ?? []) {
      let t = texto(c);
      if (!t || !/[a-záéíóúñ]{3}/i.test(t)) continue;
      t = t.replace(/^\[(CUADRO DE TEXTO|SMARTART)\]\s*/, '');
      for (const parte of t.split(/\n| · /)) {
        const p = parte.trim();
        if (p && p.length <= 80) nodos.push(p);
      }
    }
  }
  return nodos;
}

/** Los cargos de la planilla de gastos generales: filas con un sueldo al lado. */
function cargosDeGastosGenerales(hojasGG) {
  const cargos = new Set();
  for (const hoja of hojasGG) {
    for (const row of hoja.rows ?? []) {
      const i = row.findIndex(c => CARGO_RE.test(texto(c)) && texto(c).length <= 60);
      if (i < 0) continue;
      if (!row.slice(i + 1).some(c => numero(c) >= 100000)) continue;
      cargos.add(texto(row[i]));
    }
  }
  return [...cargos];
}

/**
 * Los organigramas de terreno y de oficina central (pág. 22).
 *
 * Se pide representar cargos, no departamentos, y que sean coherentes con la
 * planilla de gastos generales: cada cargo pagado en ella debería aparecer en
 * el organigrama, y al revés.
 */
export function medirOrganigramas(hojas = [], hojasGG = []) {
  if (!hojas.length) return { encontrados: false };
  const nodos = [...new Set(hojas.flatMap(nodosDeHoja))];
  const cargos = nodos.filter(n => CARGO_RE.test(n));
  const departamentos = nodos.filter(n => DEPARTAMENTO_RE.test(n));
  const t = nodos.join(' ');

  const palabras = s => normalizar(s).split(' ').filter(w => w.length >= 4);
  const enOrganigrama = cargo => {
    const pc = palabras(cargo);
    return nodos.some(n => { const pn = palabras(n); return pc.length && pc.every(w => pn.some(x => x.startsWith(w.slice(0, 5)))); });
  };
  const cargosGG = cargosDeGastosGenerales(hojasGG);

  return {
    encontrados: true,
    hojas: hojas.map(h => h.name),
    nodos: nodos.length,
    cargos: cargos.length,
    departamentos,
    terreno: /obra|terreno|residente|capataz|jefe\s+de\s+obra|bodeguer/i.test(t),
    oficinaCentral: /gerente|directorio|oficina\s+central|contador|presidente/i.test(t),
    cargosGG: cargosGG.length,
    cargosGGSinOrganigrama: cargosGG.filter(c => !enOrganigrama(c)),
  };
}

export { clp, dec };
