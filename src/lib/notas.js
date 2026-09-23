/**
 * Cálculo de la nota final a partir de las notas por criterio.
 *
 * Vive aparte porque es la aritmética que el estudiante puede reclamar: tiene
 * que poder comprobarse sola, y el desglose que se muestra en pantalla debe
 * salir del mismo cálculo que la nota, no de un texto escrito al lado.
 */

export const NOTA_MIN = 1.0;
export const NOTA_MAX = 7.0;

/**
 * Las notas chilenas se expresan con un decimal. Redondear a medios puntos
 * —como se hacía— borraba los ajustes pequeños: subir un criterio de 15% en
 * medio punto mueve el promedio 0,075 y la nota final no se inmutaba, así que
 * parecía que no reaccionaba.
 */
export const PASOS_NOTA = Array.from(
  { length: Math.round((NOTA_MAX - NOTA_MIN) * 10) + 1 },
  (_, i) => Math.round((NOTA_MIN + i * 0.1) * 10) / 10,
);

/** Acerca una nota al paso válido más próximo. */
export function redondearNota(n) {
  const acotada = Math.min(NOTA_MAX, Math.max(NOTA_MIN, n));
  return Math.round(acotada * 10) / 10;
}

/**
 * Promedio ponderado de los criterios.
 * `criterios` es [{ weight, score }]. Los pesos se normalizan: si la rúbrica
 * no suma exactamente 1, la nota sigue estando en escala 1–7.
 */
export function ponderar(criterios) {
  const validos = (criterios ?? []).filter(c => typeof c.score === 'number' && c.weight > 0);
  if (!validos.length) return null;

  const pesoTotal = validos.reduce((s, c) => s + c.weight, 0);
  const suma = validos.reduce((s, c) => s + c.score * c.weight, 0);
  return redondearNota(suma / pesoTotal);
}

/**
 * El mismo cálculo, en piezas, para poder mostrarlo:
 * { partes: [{ label, weight, score, aporte }], nota }
 */
export function desglose(criterios) {
  const validos = (criterios ?? []).filter(c => typeof c.score === 'number' && c.weight > 0);
  if (!validos.length) return { partes: [], nota: null };

  const pesoTotal = validos.reduce((s, c) => s + c.weight, 0);
  return {
    partes: validos.map(c => ({
      label: c.label,
      weight: c.weight,
      score: c.score,
      aporte: Math.round((c.score * c.weight / pesoTotal) * 100) / 100,
    })),
    nota: ponderar(validos),
  };
}

/** Formato chileno: un decimal con coma. */
export function formatoNota(n) {
  return typeof n === 'number' ? n.toFixed(1).replace('.', ',') : '—';
}
