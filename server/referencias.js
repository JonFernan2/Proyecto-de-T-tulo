/**
 * Documentos de referencia técnica (NCh 353, Manual de Cubicaciones MOP, apuntes
 * de criterio propio del docente, etc.).
 *
 * Todo archivo .md o .txt que se deje en server/referencias/ se carga UNA VEZ al
 * arrancar y viaja dentro del prefijo cacheado de cada tanda. Como el prefijo es
 * idéntico byte a byte entre tandas, estos documentos se cobran una sola vez y
 * las tandas siguientes los leen del caché.
 *
 * Se carga al arranque y no por petición justamente para que el prefijo no varíe
 * a mitad de una revisión, que invalidaría el caché.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'referencias');

// Sobre este tamaño conviene resumir el documento: entra igual, pero encarece
// la escritura de caché y diluye la atención del modelo.
const AVISO_CHARS = 120_000;

// Un caché por entrega: el prefijo debe ser constante dentro de una revisión,
// pero no tiene por qué ser el mismo entre E1 y E2.
const cache = new Map();

/**
 * Un archivo que empieza por "E1-" o "E2-" pertenece solo a esa entrega. El
 * resto rigen siempre. Sin esto, las reglas del APU viajarían en cada tanda de
 * una revisión de Entrega 1, encareciéndola y dándole criterios que no aplican.
 */
function aplicaA(nombre, delivery) {
  const m = /^(E\d)[-_]/i.exec(nombre);
  return !m || !delivery || m[1].toUpperCase() === delivery.toUpperCase();
}

export function cargarReferencias(delivery = null) {
  const clave = delivery ?? 'todas';
  if (cache.has(clave)) return cache.get(clave);

  let archivos = [];
  try {
    archivos = fs.readdirSync(DIR)
      .filter(n => /\.(md|txt)$/i.test(n) && !n.startsWith('_'))
      .filter(n => aplicaA(n, delivery))
      .sort();
  } catch {
    const vacio = { texto: '', archivos: [] };
    cache.set(clave, vacio);
    return vacio;
  }

  const cargados = [];
  let texto = '';

  for (const nombre of archivos) {
    let contenido;
    try {
      contenido = fs.readFileSync(path.join(DIR, nombre), 'utf8').trim();
    } catch (err) {
      console.warn(`[referencias] No se pudo leer ${nombre}: ${err.message}`);
      continue;
    }
    if (!contenido) continue;

    const titulo = nombre.replace(/\.(md|txt)$/i, '').replace(/[_-]+/g, ' ');
    texto += `\n<referencia documento="${titulo}">\n${contenido}\n</referencia>\n`;
    cargados.push({ nombre, chars: contenido.length, tokensAprox: Math.round(contenido.length / 4) });
  }

  if (texto) {
    texto =
      '\n═══════════════════════════════════════════════════════════\n' +
      'REFERENCIA TÉCNICA APLICABLE\n' +
      '═══════════════════════════════════════════════════════════\n' +
      'Normas y criterios de medición que rigen esta corrección. Cuando una\n' +
      'observación se apoye en alguna de ellas, cita la regla concreta que\n' +
      'aplica. Si la referencia no cubre el caso, no la invoques ni inventes\n' +
      'un número de norma.\n' +
      texto +
      '═══════════════════════════════════════════════════════════\n';
  }

  const resultado = { texto, archivos: cargados };
  cache.set(clave, resultado);
  return resultado;
}

export function reportarReferencias() {
  const { archivos } = cargarReferencias();
  if (!archivos.length) {
    console.log('[referencias] Ninguna cargada (server/referencias/ vacío).');
    return;
  }
  const total = archivos.reduce((s, a) => s + a.tokensAprox, 0);
  console.log(`[referencias] ${archivos.length} documento(s) · ~${total.toLocaleString('es-CL')} tokens (cacheados):`);
  for (const a of archivos) {
    const aviso = a.chars > AVISO_CHARS ? '  ← conviene resumirlo' : '';
    const soloPara = /^(E\d)[-_]/i.exec(a.nombre);
    const alcance = soloPara ? `  · solo ${soloPara[1].toUpperCase()}` : '';
    console.log(`  · ${a.nombre} (~${a.tokensAprox.toLocaleString('es-CL')} tokens)${alcance}${aviso}`);
  }
}
