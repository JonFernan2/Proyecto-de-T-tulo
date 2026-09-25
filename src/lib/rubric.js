export const DELIVERIES = {
  E1: {
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
  },

  E2: {
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
    // La entrega es UN SOLO Excel con los métodos constructivos y las cartillas
    // APU juntos. Lo de la Entrega 1 puede volver a adjuntarse para el cruce,
    // pero exigirlo dejaría al docente sin poder continuar teniendo la entrega
    // completa delante.
    expectedFiles: [
      { role: 'apu', label: 'Excel de Métodos Constructivos + APU', formats: ['xlsx'], required: true, multiple: true },
      { role: 'cubicaciones', label: 'Listado + Cubicaciones E1 (para el cruce)', formats: [], required: false, multiple: true },
      { role: 'eett', label: 'EETT E1 (re-verificación)', formats: [], required: false, multiple: false },
      { role: 'cotizaciones', label: 'Cotizaciones E1 (precios de referencia)', formats: [], required: false, multiple: true },
    ],
    admissibility: {
      eett: { required: true, threshold: 1.0, label: 'EETT (100% obligatorio)' },
      cubicaciones: { required: true, threshold: 0.5, label: 'Cubicaciones E1 (mín. 50% de partidas)' },
      cotizaciones: { required: true, threshold: 0.8, label: 'Cotizaciones E1 (mín. 80% de materiales)' },
      apu: { required: true, threshold: 1.0, label: 'APU (100% de actividades con método + MO + materiales)' },
    },
  },
};

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
