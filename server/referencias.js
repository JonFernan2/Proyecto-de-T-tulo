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

let cache = null;

export function cargarReferencias() {
  if (cache) return cache;

  let archivos = [];
  try {
    archivos = fs.readdirSync(DIR)
      .filter(n => /\.(md|txt)$/i.test(n) && !n.startsWith('_'))
      .sort();
  } catch {
    cache = { texto: '', archivos: [] };
    return cache;
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

  cache = { texto, archivos: cargados };
  return cache;
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
    console.log(`  · ${a.nombre} (~${a.tokensAprox.toLocaleString('es-CL')} tokens)${aviso}`);
  }
}
