/**
 * Normaliza la evaluación que devuelve la revisión.
 *
 * El esquema de la herramienta pide listas de texto y números, pero lo que
 * llega no siempre lo cumple: una entrega real devolvió las fortalezas como un
 * párrafo en vez de una lista, y la pantalla de resultados se cayó entera
 * —«fortalezas.map is not a function»— dejando sin nota ni informe una
 * corrección ya pagada.
 *
 * Por eso se normaliza UNA vez, al entrar, y no en cada sitio que la pinta: así
 * la pantalla, el PDF y el cuadro resumen reciben siempre la misma forma.
 */

/** Cualquier cosa, convertida a texto legible. */
export function comoTexto(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(comoTexto).filter(Boolean).join(' · ');
  const preferidos = ['texto', 'descripcion', 'detalle', 'hallazgo', 'aspecto', 'nombre', 'label'];
  for (const k of preferidos) if (typeof v[k] === 'string') return v[k].trim();
  return Object.values(v).map(comoTexto).filter(Boolean).join(' · ');
}

/**
 * Cualquier cosa, convertida a lista de textos. Un párrafo con viñetas o saltos
 * de línea se reparte en sus puntos: es lo que se quiso escribir.
 */
export function comoLista(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(comoTexto).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(/\n+|(?:^|\s)[-•*—]\s+/)
      // El corte por saltos de línea deja la viñeta pegada al punto siguiente,
      // así que se quita después y no solo al partir.
      .map(s => s.replace(/^[-•*—\s]+/, '').trim())
      .filter(Boolean);
  }
  if (typeof v === 'object') return Object.values(v).map(comoTexto).filter(Boolean);
  return [comoTexto(v)].filter(Boolean);
}

/** Una nota siempre es número: «4,5» se convierte, y lo ilegible cae a 1,0. */
export function comoNota(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 1.0;
}

const ESTADOS = ['Cumple', 'Parcial', 'No cumple', 'No verificable'];

export function normalizarEvaluacion(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null;

  const criteria = (Array.isArray(evaluation.criteria) ? evaluation.criteria : [])
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      ...c,
      id: comoTexto(c.id),
      score: comoNota(c.score),
      justification: comoTexto(c.justification),
    }));

  const resumen = (Array.isArray(evaluation.resumen) ? evaluation.resumen : [])
    .filter(Boolean)
    .map(r => {
      // Una fila del cuadro puede llegar como texto suelto en vez de objeto.
      if (typeof r !== 'object') return { aspecto: '', hallazgo: comoTexto(r), estado: '' };
      const estado = comoTexto(r.estado);
      return {
        aspecto: comoTexto(r.aspecto),
        hallazgo: comoTexto(r.hallazgo),
        // Un estado que no es de la pauta se deja en blanco antes que pintar
        // una etiqueta inventada.
        estado: ESTADOS.includes(estado) ? estado : '',
      };
    });

  return {
    ...evaluation,
    criteria,
    resumen,
    fortalezas: comoLista(evaluation.fortalezas),
    mejoras: comoLista(evaluation.mejoras),
    globalScore: comoNota(evaluation.globalScore),
    globalJustification: comoTexto(evaluation.globalJustification),
  };
}
