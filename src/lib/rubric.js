// Las dos asignaturas de la modalidad Licitación. Cada entrega dice a cuál
// pertenece: el informe, la pantalla y el evaluador nombran la asignatura.
export const CURSOS = {
  formulacion: 'Formulación de Proyecto de Título',
  proyecto: 'Proyecto de Título',
};

export const nombreCurso = delivery => CURSOS[DELIVERIES[delivery]?.curso] ?? CURSOS.formulacion;

export const DELIVERIES = {
  E1: {
    curso: 'formulacion',
    label: 'Entrega 1',
    subtitle: 'EETT · Listado · Cubicaciones · Cotizaciones',
    dueDate: '16 agosto 2026',
    criteria: [
      {
        id: 'eett',
        label: 'Especificaciones Técnicas (EETT)',
        weight: 0.25,
        fileRole: 'eett',
        description:
          'Word con modificaciones en amarillo y eliminaciones tachadas. Materiales especificados con todos los atributos. Métodos constructivos como sugerencias.',
      },
      {
        id: 'listado',
        label: 'Listado de Actividades',
        weight: 0.15,
        fileRole: 'cubicaciones',
        description:
          'Excel con numeración ítem coincidente con EETT, descripción con características técnicas y unidades correctas.',
      },
      {
        id: 'cubicaciones',
        label: 'Cubicaciones',
        weight: 0.35,
        fileRole: 'cubicaciones',
        description:
          'Excel con fórmulas explícitas, mínimo 2 decimales, sin redondeo al entero superior. Según NCh 353.',
      },
      {
        id: 'cotizaciones',
        label: 'Cotizaciones',
        weight: 0.25,
        fileRole: 'cotizaciones',
        description:
          '3 proveedores por material, 1 por HME. Año 2026. Formato correcto con PDFs de respaldo.',
      },
    ],
    expectedFiles: [
      { role: 'eett', label: 'EETT modificadas', formats: [], required: true, multiple: false },
      { role: 'cubicaciones', label: 'Listado + Cubicaciones', formats: [], required: true, multiple: false },
      { role: 'cotizaciones', label: 'Cotizaciones', formats: [], required: false, multiple: true },
      { role: 'respaldo', label: 'Respaldo cotizaciones (PDFs)', formats: [], required: false, multiple: true },
      { role: 'imagen', label: 'Respaldo cubicaciones (imágenes)', formats: [], required: false, multiple: true },
    ],
    admissibility: {
      eett: { required: true, threshold: 1.0, label: 'EETT (100% obligatorio)' },
      cubicaciones: { required: true, threshold: 0.5, label: 'Cubicaciones (mín. 50% de partidas)' },
      cotizaciones: { required: true, threshold: 0.8, label: 'Cotizaciones (mín. 80% de materiales)' },
    },
    roles: [
      { value: 'eett', label: 'EETT (Word / PDF)' },
      { value: 'listado', label: 'Listado / Itemizado' },
      { value: 'cubicaciones', label: 'Cubicaciones' },
      { value: 'cotizaciones', label: 'Cotizaciones' },
      { value: 'respaldo', label: 'Respaldo PDF (cotizaciones)' },
      { value: 'imagen', label: 'Imagen (respaldo cubicaciones)' },
    ],
  },

  E2: {
    curso: 'formulacion',
    label: 'Entrega 2',
    subtitle: 'Métodos Constructivos · APU completo',
    dueDate: '20 septiembre 2026',
    criteria: [
      {
        id: 'metodos',
        label: 'Métodos Constructivos',
        weight: 0.30,
        fileRole: 'apu',
        description:
          'Paso a paso por actividad, cuadrilla básica completa con especialidades, HME declarados, prelaciones.',
      },
      {
        id: 'mo',
        label: 'APU — Mano de Obra',
        weight: 0.25,
        fileRole: 'apu',
        description:
          'Maestro/Ayudante/Jornal con especialidad, sueldos mercado 2026, leyes sociales, rendimiento UNIDAD/Día.',
      },
      {
        id: 'materiales',
        label: 'APU — Materiales + Fletes',
        weight: 0.30,
        fileRole: 'apu',
        description:
          'Designación completa, %P justificado, precios desde E1, flete con vehículo adecuado, fórmulas visibles.',
      },
      {
        id: 'equipos',
        label: 'APU — Equipos y Maquinarias',
        weight: 0.15,
        fileRole: 'apu',
        description:
          'Arriendo vs propiedad. Desgaste 0,02% para propios. Valor/rendimiento para arrendados.',
      },
    ],
    // La entrega es UN SOLO Excel: la cartilla del Anexo 01, con el método
    // constructivo y el análisis de precios de cada partida. Nada más se pide.
    // El itemizado aparece como opcional únicamente porque es contra lo que se
    // cruzan las cartillas; si viene dentro del mismo libro, no hace falta.
    expectedFiles: [
      { role: 'apu', label: 'Cartilla APU — Anexo 01 (métodos + precios unitarios)', formats: ['xlsx'], required: true, multiple: true },
      { role: 'listado', label: 'Itemizado E1 — solo si no viene dentro del libro', formats: ['xlsx'], required: false, multiple: false },
    ],
    admissibility: {
      eett: { required: true, threshold: 1.0, label: 'EETT (100% obligatorio)' },
      cubicaciones: { required: true, threshold: 0.5, label: 'Cubicaciones E1 (mín. 50% de partidas)' },
      cotizaciones: { required: true, threshold: 0.8, label: 'Cotizaciones E1 (mín. 80% de materiales)' },
      apu: { required: true, threshold: 1.0, label: 'APU (100% de actividades con método + MO + materiales)' },
    },
    roles: [
      { value: 'eett', label: 'EETT (Word / PDF)' },
      { value: 'listado', label: 'Listado / Itemizado E1 (Excel o PDF)' },
      { value: 'cubicaciones', label: 'Cubicaciones E1' },
      { value: 'cotizaciones', label: 'Cotizaciones E1' },
      { value: 'apu', label: 'APU — Cartillas (Anexo 01)' },
    ],
  },

  // ─── Proyecto de Título (pauta, sección 1.2, págs. 14 a 23) ──────────────────
  PT1: {
    curso: 'proyecto',
    label: 'Entrega 1',
    subtitle: 'Rendimientos · Carta Gantt',
    dueDate: null,
    criteria: [
      {
        id: 'rendimientos',
        label: 'Rendimientos',
        weight: 0.40,
        fileRole: 'rendimientos',
        description:
          'Planilla Excel por actividad: rendimiento ajustado a la cuadrilla en UNIDAD/día, duración exacta = cantidad / rendimiento, tiempo aproximado al cuarto de jornada, mínimo de actividades GLOBAL.',
      },
      {
        id: 'gantt',
        label: 'Carta Gantt',
        weight: 0.60,
        fileRole: 'gantt',
        description:
          'MS Project + PDF A0/A1: todas las actividades vinculadas (FC, CC, FF, CF), títulos con barra negra, inicio el primer día hábil del año siguiente, calendario lun–vie 9 h con feriados en gris, ruta crítica en rojo, sin forzar plazos.',
      },
    ],
    expectedFiles: [
      { role: 'rendimientos', label: 'Planilla de rendimientos', formats: ['xlsx'], required: true, multiple: false },
      { role: 'gantt', label: 'Carta Gantt en PDF (A0 o A1)', formats: ['pdf'], required: true, multiple: false },
      { role: 'project', label: 'Carta Gantt en MS Project (.mpp)', formats: ['mpp'], required: false, multiple: false },
      { role: 'apu', label: 'APU de Formulación — solo para cruzar', formats: ['xlsx'], required: false, multiple: true },
      { role: 'listado', label: 'Itemizado — solo para cruzar', formats: ['xlsx', 'pdf'], required: false, multiple: false },
    ],
    roles: [
      { value: 'rendimientos', label: 'Planilla de rendimientos (Excel)' },
      { value: 'gantt', label: 'Carta Gantt — PDF' },
      { value: 'project', label: 'Carta Gantt — MS Project' },
      { value: 'apu', label: 'APU de Formulación (para cruzar)' },
      { value: 'listado', label: 'Itemizado (para cruzar)' },
    ],
  },

  PT2: {
    curso: 'proyecto',
    label: 'Entrega 2',
    subtitle: 'Gastos Generales · Presupuesto · Organigramas',
    dueDate: null,
    criteria: [
      {
        id: 'gastosGenerales',
        label: 'Gastos Generales',
        weight: 0.40,
        fileRole: 'gastosGenerales',
        description:
          'Gastos en obra (directos) y en oficina central (indirectos) en Excel, ajustados al plazo de la Carta Gantt; boletas de garantía, permisos y seguros según el proyecto; %GG = (0,32·GG oficina + GG obra) / CD · 100, con dos decimales.',
      },
      {
        id: 'presupuesto',
        label: 'Presupuesto Detallado',
        weight: 0.40,
        fileRole: 'presupuesto',
        description:
          'Excel vinculado a cantidades y precios unitarios de las cartillas APU, Total = cantidad × precio con fórmula, $ sin decimales, recuadro CD · GG · utilidad · imprevistos · costo neto · IVA · total · UF · UF/m², instalaciones estimadas, cartillas completadas.',
      },
      {
        id: 'organigramas',
        label: 'Organigramas',
        weight: 0.20,
        fileRole: 'organigramas',
        description:
          'Organigrama de la empresa en terreno y en oficina central, en Excel, por cargos y no por departamentos, coherente con la planilla de gastos generales.',
      },
    ],
    expectedFiles: [
      // Muchos entregan todo en un solo libro: las hojas se reconocen por su
      // contenido, así que basta con que llegue uno de los tres.
      { role: 'presupuesto', label: 'Presupuesto detallado', formats: ['xlsx'], required: true, multiple: true },
      { role: 'gastosGenerales', label: 'Gastos generales — o dentro del libro del presupuesto', formats: ['xlsx'], required: false, multiple: true },
      { role: 'organigramas', label: 'Organigramas — o dentro del libro del presupuesto', formats: ['xlsx'], required: false, multiple: true },
      { role: 'apu', label: 'Cartillas APU completadas (imprevistos, GG, utilidad, precio neto)', formats: ['xlsx'], required: false, multiple: true },
      { role: 'gantt', label: 'Carta Gantt de la Entrega 1 — solo para cruzar el plazo', formats: ['pdf'], required: false, multiple: false },
      { role: 'listado', label: 'Itemizado — solo para cruzar', formats: ['xlsx', 'pdf'], required: false, multiple: false },
    ],
    roles: [
      { value: 'gastosGenerales', label: 'Gastos generales (Excel)' },
      { value: 'presupuesto', label: 'Presupuesto detallado (Excel)' },
      { value: 'organigramas', label: 'Organigramas (Excel)' },
      { value: 'apu', label: 'Cartillas APU completadas' },
      { value: 'gantt', label: 'Carta Gantt E1 (para cruzar)' },
      { value: 'listado', label: 'Itemizado (para cruzar)' },
    ],
  },
};

/** ¿Es una entrega de Proyecto de Título? */
export const esProyecto = delivery => DELIVERIES[delivery]?.curso === 'proyecto';

export const GRADE_COLORS = {
  // 1.0–3.5 → red, 4.0 → amber, 4.5–5.5 → yellow, 6.0–7.0 → green
  getColor(score) {
    if (score < 4.0) return 'text-red-600';
    if (score < 4.5) return 'text-amber-500';
    if (score < 6.0) return 'text-yellow-600';
    return 'text-green-600';
  },
  getBg(score) {
    if (score < 4.0) return 'bg-red-50 border-red-200';
    if (score < 4.5) return 'bg-amber-50 border-amber-200';
    if (score < 6.0) return 'bg-yellow-50 border-yellow-200';
    return 'bg-green-50 border-green-200';
  },
};
