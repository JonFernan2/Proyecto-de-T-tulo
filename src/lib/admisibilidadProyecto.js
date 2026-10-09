/**
 * Verificaciones de las entregas de Proyecto de Título.
 *
 * No filtran: igual que en la Entrega 2 de Formulación, todas las entregas
 * pasan a evaluación. Lo que se mide aquí sirve al docente en pantalla y viaja
 * al evaluador como hecho verificado, para que no tenga que adivinar lo que es
 * aritmética.
 */
import {
  medirRendimientos, medirGantt, clasificarHojasPT2, medirGastosGenerales,
  medirPresupuesto, medirCartillasCompletadas, medirOrganigramas, clp, dec,
} from './ptMetrics.js';

const lista = (arr, n = 10) => (arr.length > n ? `${arr.slice(0, n).join(', ')} y ${arr.length - n} más` : arr.join(', '));
const fecha = iso => (iso ? iso.split('-').reverse().join('-') : '—');

export function admisibilidadProyecto(delivery, filesMap, itemizado) {
  const results = delivery === 'PT1'
    ? [checkRendimientos(filesMap, itemizado), checkGantt(filesMap)]
    : checksPT2(filesMap, itemizado);
  return { passed: true, aplicaAdmisibilidad: false, results };
}

// ─── PT1 ─────────────────────────────────────────────────────────────────────
function checkRendimientos(filesMap, itemizado) {
  const base = { id: 'rendimientos', label: 'Planilla de rendimientos' };
  if (!filesMap.rendimientos?.sheets?.length) {
    return { ...base, passed: false, detail: 'No se encontró la planilla de rendimientos en Excel.' };
  }
  const m = medirRendimientos(filesMap.rendimientos, itemizado);
  if (!m.encontrada) {
    return {
      ...base, passed: true,
      detail: `Se entregó el libro (${lista(m.hojas, 5)}), pero no se reconoce una tabla con las columnas `
            + 'del Ejemplo 11 (ítem, actividad, unidad, cantidad, rendimiento, tiempo exacto, tiempo '
            + 'aproximado, cuadrilla). Revisar a la vista.',
    };
  }

  const partes = [`Hoja «${m.hoja}»: ${m.n} actividades con unidad.`];
  partes.push(m.globales.length
    ? `${m.globales.length} en unidad GLOBAL (${lista(m.globales, 8)}); la pauta pide que sean las mínimas.`
    : 'Ninguna en unidad GLOBAL.');
  if (m.sinRendimiento.length) partes.push(`${m.sinRendimiento.length} actividad(es) no globales sin rendimiento: ${lista(m.sinRendimiento)}.`);
  if (m.errExacto.length) {
    const ej = m.errExacto.slice(0, 4).map(e => `${e.codigo} (${dec(e.cantidad)} / ${dec(e.rendimiento)} = ${dec(e.esperado, 3)} días; se informa ${dec(e.informado, 3)})`);
    partes.push(`${m.errExacto.length} tiempo(s) exacto(s) no corresponden a cantidad / rendimiento: ${ej.join('; ')}${m.errExacto.length > 4 ? '…' : ''}.`);
  } else {
    partes.push('Los tiempos exactos corresponden a cantidad / rendimiento.');
  }
  if (m.errAprox.length) {
    const ej = m.errAprox.slice(0, 4).map(e => `${e.codigo} (${e.esperado != null ? `${dec(e.exacto, 3)} → ${dec(e.esperado)}` : 'no va en cuartos de jornada'}; se informa ${dec(e.informado)})`);
    partes.push(`${m.errAprox.length} tiempo(s) aproximado(s) no siguen el cuarto de jornada superior del Ejemplo 10: ${ej.join('; ')}${m.errAprox.length > 4 ? '…' : ''}.`);
  } else {
    partes.push('Los tiempos aproximados siguen el cuarto de jornada superior.');
  }
  if (m.sinAprox.length) partes.push(`${m.sinAprox.length} sin tiempo aproximado: ${lista(m.sinAprox)}.`);
  if (m.sinCuadrilla.length) partes.push(`${m.sinCuadrilla.length} sin cuadrilla considerada: ${lista(m.sinCuadrilla)}.`);
  if (m.exactoSinFormula) partes.push(`${m.exactoSinFormula} tiempo(s) exacto(s) sin fórmula visible.`);
  if (m.exigibles) {
    partes.push(m.faltantes.length
      ? `Del itemizado (${m.exigibles} partidas exigibles) faltan ${m.faltantes.length}: ${lista(m.faltantes)}.`
      : `Están las ${m.exigibles} partidas exigibles del itemizado.`);
  }

  return {
    ...base, passed: true, detail: partes.join(' '),
    ...(m.exigibles ? { ratio: (m.exigibles - m.faltantes.length) / m.exigibles, threshold: 1 } : {}),
  };
}

function checkGantt(filesMap) {
  const base = { id: 'gantt', label: 'Carta Gantt (MS Project + PDF A0/A1)' };
  const m = medirGantt(filesMap.gantt, filesMap.projectNames);
  const partes = [];

  partes.push(m.project?.length
    ? `Archivo de MS Project entregado (${lista(m.project, 3)}); su contenido se revisa a través del PDF.`
    : 'No se adjuntó el archivo de MS Project (.mpp) que exige la pauta.');

  if (!m.entregada) {
    partes.push('No se encontró la Carta Gantt en PDF.');
    return { ...base, passed: false, detail: partes.join(' ') };
  }

  for (const a of m.archivos) {
    partes.push(`PDF «${a.nombre}»: ${a.paginas} página(s), formato ${a.formatos.join(' / ')}`
      + `${a.formatos.some(f => f === 'A0' || f === 'A1') ? '' : ' — la pauta exige A0 o A1 en una sola plana'}`
      + `${a.escaneado ? '; sin capa de texto, solo se puede revisar como imagen' : ''}.`);
  }

  const totalVinculos = Object.values(m.vinculos).reduce((s, n) => s + n, 0);
  partes.push(totalVinculos
    ? `En el texto se leen vínculos con tipo explícito: ${Object.entries(m.vinculos).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}`
      + `${m.conDesfase ? `, ${m.conDesfase} con adelanto o retraso` : ''}. Los vínculos fin-comienzo sin desfase suelen aparecer solo con el número de la predecesora.`
    : 'En el texto no se leen vínculos con tipo explícito (FC, CC, FF, CF); los fin-comienzo simples aparecen solo con el número de la predecesora.');

  if (m.inicio) {
    partes.push(`Fechas leídas: del ${fecha(m.inicio)} al ${fecha(m.fin)} (${m.plazoDias} días corridos). `
      + (m.inicioCorrecto
        ? 'El inicio coincide con el primer día hábil del año siguiente.'
        : `La pauta fija el inicio en el primer día hábil del año siguiente (${fecha(m.inicioEsperado)}).`));
  } else {
    partes.push('No se pudieron leer fechas en el texto del PDF.');
  }

  return { ...base, passed: true, detail: partes.join(' '), plazoDias: m.plazoDias };
}

// ─── PT2 ─────────────────────────────────────────────────────────────────────
function checksPT2(filesMap, itemizado) {
  const grupos = clasificarHojasPT2([
    { libro: filesMap.gastosGenerales, rol: 'gastosGenerales' },
    { libro: filesMap.presupuesto, rol: 'presupuesto' },
    { libro: filesMap.organigramas, rol: 'organigramas' },
    { libro: filesMap.apu, rol: 'apu' },
  ]);

  const gg = medirGastosGenerales(grupos.gastosGenerales);
  const plazo = medirGantt(filesMap.gantt ?? []).plazoDias;
  const pre = medirPresupuesto(grupos.presupuesto, itemizado, { pctGG: Number.isFinite(gg.pctInformado) ? gg.pctInformado : null });
  const cart = medirCartillasCompletadas({ sheets: grupos.apu }, Number.isFinite(gg.pctInformado) ? gg.pctInformado : null);
  const org = medirOrganigramas(grupos.organigramas, grupos.gastosGenerales);

  return [checkGG(gg, plazo), checkPresupuesto(pre, cart), checkOrganigramas(org)];
}

function checkGG(m, plazoDias) {
  const base = { id: 'gastosGenerales', label: 'Gastos generales y %GG' };
  if (!m.encontrada) return { ...base, passed: false, detail: 'No se reconocen hojas de gastos generales en los libros entregados.' };

  const partes = [`Hojas: ${lista(m.hojas, 5)}.`];
  partes.push(`Gastos directos (obra): ${clp(m.directos)} · indirectos (oficina central): ${clp(m.indirectos)} · costo directo: ${clp(m.costoDirecto)}.`);
  if (Number.isFinite(m.pctInformado)) {
    partes.push(`%GG informado: ${m.pctTexto}.`);
    if (Number.isFinite(m.pctEsperado)) {
      partes.push(m.cuadra
        ? `Coincide con (0,32 · indirectos + directos) / CD · 100 = ${dec(m.pctEsperado)}%.`
        : `Con la fórmula de la pauta, (0,32 · ${clp(m.indirectos)} + ${clp(m.directos)}) / ${clp(m.costoDirecto)} · 100, da ${dec(m.pctEsperado)}%.`);
    }
    if (m.decimales !== null && m.decimales !== 2) partes.push(`El %GG se expresa con ${m.decimales} decimal(es); la pauta pide dos.`);
  } else {
    partes.push('No se encontró el %GG.');
  }
  if (!m.usa32) partes.push('No se ve aplicada la incidencia del 32% del gasto de oficina central.');
  const faltan = Object.entries(m.secciones).filter(([, v]) => !v).map(([k]) => k);
  if (faltan.length) partes.push(`No se reconocen gastos de: ${faltan.join(', ')}.`);
  if (m.mesesMax && plazoDias) {
    const meses = plazoDias / 30.4;
    partes.push(m.mesesMax > Math.ceil(meses)
      ? `Hay ítems pagados ${dec(m.mesesMax)} meses, más que el plazo de la Carta Gantt (${dec(meses, 1)} meses).`
      : `El ítem más largo dura ${dec(m.mesesMax)} meses, dentro del plazo de la Carta Gantt (${dec(meses, 1)} meses).`);
  }
  return { ...base, passed: true, detail: partes.join(' ') };
}

function checkPresupuesto(m, cart) {
  const base = { id: 'presupuesto', label: 'Presupuesto detallado y cartillas completadas' };
  if (!m.encontrada) return { ...base, passed: false, detail: 'No se reconoce una hoja de presupuesto en los libros entregados.' };

  const partes = [];
  if (m.tablaEncontrada) {
    partes.push(`Hoja «${m.hojaTabla}»: ${m.n} partidas; suma de totales ${clp(m.sumaTotales)}.`);
    if (m.totalSinFormula.length) partes.push(`${m.totalSinFormula.length} total(es) sin fórmula visible (Nota 9): ${lista(m.totalSinFormula)}.`);
    if (m.totalNoCuadra.length) {
      const ej = m.totalNoCuadra.slice(0, 3).map(e => `${e.codigo}: ${dec(e.cantidad)} × ${clp(e.precio)} = ${clp(e.esperado)}, se informa ${clp(e.informado)}`);
      partes.push(`${m.totalNoCuadra.length} total(es) no corresponden a cantidad × precio unitario (${ej.join('; ')}).`);
    }
    if (m.sinPrecio.length) partes.push(`${m.sinPrecio.length} partida(s) sin precio unitario: ${lista(m.sinPrecio)}.`);
    if (m.montosConDecimales.length) partes.push(`${m.montosConDecimales.length} partida(s) con montos en pesos con decimales (Nota 11): ${lista(m.montosConDecimales)}.`);
    if (m.sinSigno) partes.push(`${m.sinSigno} partida(s) sin símbolo $ en los montos.`);
    if (m.exigibles) {
      partes.push(m.faltantes.length
        ? `Del itemizado (${m.exigibles} partidas exigibles) faltan ${m.faltantes.length}: ${lista(m.faltantes)}.`
        : `Están las ${m.exigibles} partidas exigibles del itemizado.`);
    }
  } else {
    partes.push('No se reconoce la tabla del Ejemplo 18 (ítem, actividad, unidad, cantidad, precio unitario, total).');
  }

  if (m.checks.length) {
    const malos = m.checks.filter(c => !c.ok);
    partes.push(malos.length
      ? `Recuadro final: ${malos.map(c => `${c.concepto} no cuadra (se informa ${c.concepto.includes('UF') ? dec(c.informado) : clp(c.informado)}, corresponde ${c.concepto.includes('UF') ? dec(c.esperado) : clp(c.esperado)})`).join('; ')}.`
      : `Recuadro final: ${m.checks.length} relaciones verificadas, todas cuadran.`);
  }
  if (m.faltanRecuadro.length) partes.push(`Faltan en el recuadro: ${m.faltanRecuadro.join(', ')}.`);
  if (m.pctGGPresupuesto != null && m.pctGGPlanilla != null && Math.abs(m.pctGGPresupuesto - m.pctGGPlanilla) > 0.01) {
    partes.push(`El %GG del presupuesto (${dec(m.pctGGPresupuesto)}%) no es el de la planilla de gastos generales (${dec(m.pctGGPlanilla)}%).`);
  }
  const inst = Object.entries(m.instalaciones).filter(([, v]) => v).map(([k]) => k);
  partes.push(inst.length ? `Se mencionan instalaciones: ${inst.join(', ')}.` : 'No se mencionan las instalaciones estimadas (eléctricas, climatización, gases) de la pág. 21.');

  if (cart.entregadas) {
    partes.push(`Cartillas APU: ${cart.cartillas}; con imprevistos, GG, utilidad y precio neto completos: ${cart.completas}`
      + `${cart.parciales ? `, parciales: ${cart.parciales}` : ''}${cart.vacias ? `, sin completar: ${cart.vacias}` : ''}.`);
    if (cart.coincideConPlanilla === false) partes.push(`El %GG usado en las cartillas (${cart.pctsGG.map(p => `${dec(p)}%`).join(', ')}) no es el de la planilla.`);
  } else {
    partes.push('No se reconocen las cartillas APU completadas con imprevistos, gastos generales, utilidad y precio neto.');
  }

  return {
    ...base, passed: true, detail: partes.join(' '),
    ...(m.exigibles ? { ratio: (m.exigibles - m.faltantes.length) / m.exigibles, threshold: 1 } : {}),
  };
}

function checkOrganigramas(m) {
  const base = { id: 'organigramas', label: 'Organigramas (terreno y oficina central)' };
  if (!m.encontrados) return { ...base, passed: false, detail: 'No se reconocen hojas de organigramas en los libros entregados.' };

  const partes = [`Hojas: ${lista(m.hojas, 5)}; ${m.nodos} recuadros leídos, ${m.cargos} con nombre de cargo.`];
  partes.push(`Organigrama de terreno: ${m.terreno ? 'se reconoce' : 'no se reconoce'}. De oficina central: ${m.oficinaCentral ? 'se reconoce' : 'no se reconoce'}.`);
  if (m.departamentos.length) partes.push(`Recuadros con departamentos o áreas en vez de cargos: ${lista(m.departamentos, 6)}.`);
  if (m.cargosGG) {
    partes.push(m.cargosGGSinOrganigrama.length
      ? `De ${m.cargosGG} cargos pagados en gastos generales, no aparecen en el organigrama: ${lista(m.cargosGGSinOrganigrama, 8)}.`
      : `Los ${m.cargosGG} cargos pagados en gastos generales aparecen en el organigrama.`);
  }
  if (!m.nodos) partes.push('No se pudo leer texto en los organigramas: si están dibujados como imagen, revisar a la vista.');
  return { ...base, passed: true, detail: partes.join(' ') };
}
