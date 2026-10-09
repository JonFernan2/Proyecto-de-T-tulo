import React, { useState } from 'react';
import { parseExcel, parseWord, parsePdf, detectStudentName } from '../lib/fileParser.js';
import { runAdmissibility } from '../lib/admissibility.js';
import { lanzarRevision } from '../lib/claudeEval.js';
import { guessRole, construirFilesMap } from '../lib/roles.js';

/**
 * Lanza la revisión de varios estudiantes de una vez.
 *
 * Se procesa uno a uno —parsear, enviar, soltar de memoria— en vez de cargarlos
 * todos juntos: un solo libro de cubicaciones puede pesar decenas de MB y con
 * veinte estudiantes a la vez el navegador no daría abasto.
 *
 * Los lotes se procesan en paralelo del lado de la API, así que veinte
 * revisiones tardan más o menos lo mismo que una: la espera es de cola, no de
 * cómputo acumulable.
 */
export default function LanzadorCurso({ carpetas, delivery, onListo, onCancelar }) {
  const [estado, setEstado] = useState('confirmar');   // confirmar | lanzando | listo
  const [progreso, setProgreso] = useState([]);
  const [actual, setActual] = useState(null);
  // Estudiantes a los que no se les lanzó la revisión porque no había itemizado
  // contra el cual cruzar sus cartillas. Se guardan por carpeta, no sus archivos
  // ya leídos: un libro de APU pesa decenas de MB y retenerlos los dejaría a
  // todos en memoria a la vez.
  const [sinItemizado, setSinItemizado] = useState([]);

  const alumnos = [...carpetas.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Las imágenes incrustadas en las hojas sí viajan con la revisión; las que se
  // entregan como archivo aparte solo se cotejan en la revisión individual.
  const conImagenesSueltas = alumnos.filter(([, archivos]) => archivos.some(f => ES_IMAGEN.test(f.name)));

  /**
   * Lee los archivos de un estudiante y lanza su revisión.
   *
   * En la Entrega 2 se comprueba antes de enviar que las cartillas puedan
   * cruzarse contra el itemizado, y si no se puede NO se lanza: la revisión se
   * cobra igual y vuelve sin lo único que decide si aprueba el ramo —cuántas
   * partidas tienen APU—. Casi siempre falta porque el itemizado es un archivo
   * de la Entrega 1 y no está en la carpeta, así que se avisa a tiempo para
   * agregarlo. Con `forzar` se lanza de todos modos.
   */
  async function procesar(carpeta, archivos, { forzar = false } = {}) {
    const studentName = detectStudentName(carpeta) || carpeta;
    setActual(studentName);

    const entradas = [];
    for (const file of archivos) {
      if (ES_IMAGEN.test(file.name)) continue;
      const role = guessRole(file, delivery);
      entradas.push({ file, role, parsed: await parsear(file, role) });
    }

    const filesMap = construirFilesMap(entradas);
    const admissibility = runAdmissibility(delivery, filesMap);

    if (!forzar && delivery === 'E2' && !seCruzaConElItemizado(admissibility)) {
      return { studentName, carpeta, ok: false, faltaItemizado: true };
    }

    const { batchId, totalTandas, plan } = await lanzarRevision({
      delivery, studentName, filesMap, admissibility,
    });
    return { studentName, batchId, totalTandas, plan, ok: true };
  }

  async function lanzar(lista, opciones) {
    const resultados = [];
    const faltantes = [];

    for (const [carpeta, archivos] of lista) {
      const studentName = detectStudentName(carpeta) || carpeta;
      try {
        const r = await procesar(carpeta, archivos, opciones);
        if (r.faltaItemizado) {
          faltantes.push([carpeta, archivos]);
          setProgreso(p => [...p, { studentName, ok: false, faltaItemizado: true }]);
          continue;
        }
        resultados.push(r);
        setProgreso(p => [...p, { studentName, ok: true, totalTandas: r.totalTandas }]);
      } catch (err) {
        console.error(`[curso] ${studentName}:`, err);
        resultados.push({ studentName, ok: false, error: err.message });
        setProgreso(p => [...p, { studentName, ok: false, error: err.message }]);
      }
    }
    return { resultados, faltantes };
  }

  async function lanzarTodo() {
    setEstado('lanzando');
    const { resultados, faltantes } = await lanzar(alumnos);
    setSinItemizado(faltantes);
    setActual(null);
    setEstado('listo');
    onListo?.(resultados);
  }

  /** Lanza igual a los que quedaron sin itemizado, si el docente lo decide. */
  async function lanzarSinCruce() {
    const pendientes = sinItemizado;
    setSinItemizado([]);
    setEstado('lanzando');
    const { resultados } = await lanzar(pendientes, { forzar: true });
    setActual(null);
    setEstado('listo');
    onListo?.(resultados);
  }

  // ── Confirmación ──────────────────────────────────────────────────────────
  if (estado === 'confirmar') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-slate-800">
            Revisar el curso completo · {alumnos.length} estudiantes
          </div>
          <div className="text-xs text-slate-600 mt-0.5">
            Se lanzará una revisión por estudiante. Podrás repasarlas y ajustar notas
            cuando terminen.
          </div>
        </div>

        <div className="max-h-56 overflow-y-auto space-y-1 text-sm">
          {alumnos.map(([carpeta, archivos]) => (
            <div key={carpeta} className="flex justify-between bg-white border border-blue-100 rounded-lg px-3 py-1.5">
              <span className="text-slate-800 truncate">{detectStudentName(carpeta) || carpeta}</span>
              <span className="text-xs text-slate-400 shrink-0">{archivos.length} archivos</span>
            </div>
          ))}
        </div>

        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
          <div>
            Cada revisión se cobra por separado. Conviene probar primero con un estudiante
            y revisar el resultado antes de lanzar el curso entero.
          </div>
          {conImagenesSueltas.length > 0 && (
            <div>
              {conImagenesSueltas.length} estudiante(s) entregan imágenes como archivo
              aparte. Las imágenes incrustadas en las hojas sí se revisan; las sueltas
              quedan fuera y hay que verlas en la revisión individual
              ({conImagenesSueltas.map(([c]) => detectStudentName(c) || c).join(', ')}).
            </div>
          )}
          {delivery === 'E2' && (
            <div>
              A quien no tenga itemizado —dentro de su libro de APU o adjunto como
              archivo— no se le lanzará la revisión: volvería sin el porcentaje de
              partidas con APU, que es lo que decide si aprueba. Si falta, suele estar
              en su carpeta de la Entrega 1; cópialo junto al APU y vuelve a cargar.
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={lanzarTodo}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white bg-uvm-blue hover:bg-blue-800 text-sm"
          >
            Lanzar las {alumnos.length} revisiones
          </button>
          <button
            onClick={onCancelar}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ── Lanzando / listo ──────────────────────────────────────────────────────
  const conError = progreso.filter(p => !p.ok).length;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <div className="text-sm font-bold text-slate-800">
          {estado === 'listo'
            ? `${progreso.length - conError} de ${alumnos.length} revisiones lanzadas`
            : `Lanzando revisiones · ${progreso.length} de ${alumnos.length}`}
        </div>
        {actual && (
          <div className="text-xs text-slate-500 mt-0.5">
            Leyendo los archivos de {actual}…
          </div>
        )}
      </div>

      <div className="w-full bg-slate-200 rounded-full h-2">
        <div
          className="h-2 rounded-full bg-uvm-blue transition-all duration-500"
          style={{ width: `${(progreso.length / alumnos.length) * 100}%` }}
        />
      </div>

      <div className="max-h-56 overflow-y-auto space-y-1 text-sm">
        {progreso.map((p, i) => (
          <div key={i} className="flex items-start justify-between gap-3 bg-white border border-slate-100 rounded-lg px-3 py-1.5">
            <span className="text-slate-800 truncate">{p.studentName}</span>
            <span className={`text-xs shrink-0 ${
              p.ok ? 'text-green-600' : p.faltaItemizado ? 'text-amber-700' : 'text-red-600'
            }`}>
              {p.ok ? `${p.totalTandas} tandas`
                : p.faltaItemizado ? 'sin itemizado · no lanzada'
                : p.error?.slice(0, 60)}
            </span>
          </div>
        ))}
      </div>

      {estado === 'listo' && sinItemizado.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
          <div>
            <span className="font-semibold">
              {sinItemizado.length} estudiante(s) quedaron sin lanzar porque no se encontró
              su itemizado
            </span>{' '}
            ({sinItemizado.map(([c]) => detectStudentName(c) || c).join(', ')}). Sin él no
            se puede medir qué partidas tienen APU, que es lo que decide si aprueban el
            ramo. Copia su itemizado —el de la Entrega 1 sirve, en Excel o en PDF— junto
            al libro de APU y vuelve a cargar la carpeta.
          </div>
          <button
            onClick={lanzarSinCruce}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100"
          >
            Lanzarlas igual, sin medir la cobertura
          </button>
        </div>
      )}

      {estado === 'listo' && (
        <div className="text-xs text-slate-600 leading-relaxed">
          Los lotes se procesan en paralelo, así que el curso completo tarda más o menos
          lo mismo que una sola revisión. Vuelve más tarde y recógelas desde la pantalla
          inicial — sobreviven a cerrar la aplicación.
          {conError - sinItemizado.length > 0 && (
            <span className="block mt-1 text-red-600">
              {conError - sinItemizado.length} estudiante(s) no se pudieron lanzar.
              Revísalos de a uno.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Las imágenes sueltas no se leen aquí: la revisión por tandas no las recibe y
// cargarlas solo gastaría memoria. Ver el aviso de arriba.
const ES_IMAGEN = /\.(jpe?g|png|webp)$/i;

/**
 * ¿Se pudieron cruzar las cartillas contra el itemizado?
 *
 * El porcentaje solo se calcula cuando el cruce salió: si falta el itemizado, o
 * ninguna cartilla se pudo emparejar con él, la comprobación informa el hecho y
 * no deja porcentaje.
 */
function seCruzaConElItemizado(admissibility) {
  return (admissibility?.results ?? []).find(r => r.id === 'apu')?.ratio !== undefined;
}

async function parsear(file, role) {
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'docx' || ext === 'doc') return await parseWord(file);
    if (ext === 'xlsx' || ext === 'xls') return await parseExcel(file);
    if (ext === 'pdf') return await parsePdf(file, { imagenes: role === 'gantt' });
  } catch (err) {
    console.warn(`[curso] No se pudo leer ${file.name}: ${err.message}`);
  }
  return null;
}
