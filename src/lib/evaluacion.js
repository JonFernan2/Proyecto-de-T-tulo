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
    return trozosDeListaMalCerrada(v) ?? v
      .split(/\n+|(?:^|\s)[-•*—]\s+/)
      // El corte por saltos de línea deja la viñeta pegada al punto siguiente,
      // así que se quita después y no solo al partir.
      .map(s => s.replace(/^[-•*—\s]+/, '').trim())
      .filter(Boolean);
  }
  if (typeof v === 'object') return Object.values(v).map(comoTexto).filter(Boolean);
  return [comoTexto(v)].filter(Boolean);
}

/**
 * Una lista que llegó como un solo texto porque el JSON vino mal cerrado.
 *
 * Pasó en una revisión real: las fortalezas llegaron como una sola cadena que
 * contenía dentro, literalmente, `","mejoras":"` y todas las acciones de mejora
 * detrás. Se recuperan partiendo por el separador que quedó a la vista, en vez
 * de dar por perdido lo que sí se escribió.
 */
function trozosDeListaMalCerrada(s) {
  if (!/"\s*,\s*"/.test(s)) return null;
  const trozos = s
    .split(/"\s*,\s*"/)
    .map(t => t.replace(/^["\s]+|["\s]+$/g, '').trim())
    .filter(Boolean);
  return trozos.length > 1 ? trozos : null;
}

/**
 * Separa de una lista los puntos que en realidad pertenecen a otra clave, y que
 * quedaron dentro por el mismo JSON mal cerrado: el trozo empieza por
 * `mejoras":` y todo lo que sigue es de esa otra sección.
 */
function repartirPorClaveIncrustada(items, clave) {
  const marca = new RegExp(`^"?${clave}"?\\s*:\\s*"?`, 'i');
  const i = items.findIndex(t => marca.test(t));
  if (i < 0) return { propios: items, ajenos: [] };

  const primero = items[i].replace(marca, '').trim();
  return {
    propios: items.slice(0, i),
    ajenos: [primero, ...items.slice(i + 1)].filter(Boolean),
  };
}

/** Una nota siempre es número: «4,5» se convierte, y lo ilegible cae a 1,0. */
export function comoNota(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 1.0;
}

const ESTADOS = ['Cumple', 'Parcial', 'No cumple', 'No verificable'];

/**
 * Un campo que llegó como el trozo de JSON crudo que le correspondía, con lo
 * que venía detrás pegado.
 *
 * Pasó en una revisión real: `fortalezas` contenía la cadena
 * `["a","b"],"mejoras":["c","d"]`, de modo que las fortalezas salían como un
 * único punto ilegible y la sección de mejoras desaparecía del informe. Con
 * llaves alrededor vuelve a ser JSON válido, y se recupera todo lo escrito.
 */
function repararFragmento(valor) {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  if (!t.startsWith('[') && !t.startsWith('{')) return null;
  try {
    const recuperado = JSON.parse(`{"__":${t}}`);
    return recuperado && typeof recuperado === 'object' ? recuperado : null;
  } catch {
    return null;
  }
}

const vacio = v => v === null || v === undefined || v === ''
  || (Array.isArray(v) && !v.length);

export function normalizarEvaluacion(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null;

  // Primero se reparan los campos que traen su JSON sin cerrar, arrastrando
  // dentro lo que venía detrás. Lo arrastrado se devuelve a su sitio, pero solo
  // si allí no había nada: lo que la revisión sí entregó bien manda.
  evaluation = { ...evaluation };
  for (const clave of ['fortalezas', 'mejoras', 'resumen', 'criteria']) {
    const recuperado = repararFragmento(evaluation[clave]);
    if (!recuperado) continue;

    evaluation[clave] = recuperado.__;
    for (const [k, v] of Object.entries(recuperado)) {
      if (k !== '__' && vacio(evaluation[k])) evaluation[k] = v;
    }
  }

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

  // Si aun así las mejoras quedaron dentro de las fortalezas —el mismo JSON mal
  // cerrado, pero sin corchetes que reparar— se separan por la clave que quedó
  // a la vista.
  let fortalezas = comoLista(evaluation.fortalezas);
  let mejoras = comoLista(evaluation.mejoras);
  if (!mejoras.length) {
    const { propios, ajenos } = repartirPorClaveIncrustada(fortalezas, 'mejoras');
    fortalezas = propios;
    mejoras = ajenos;
  }

  return {
    ...evaluation,
    criteria,
    resumen,
    fortalezas,
    mejoras,
    globalScore: comoNota(evaluation.globalScore),
    globalJustification: comoTexto(evaluation.globalJustification),
  };
}
