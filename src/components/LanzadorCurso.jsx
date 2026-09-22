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

  const alumnos = [...carpetas.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Las imágenes incrustadas en las hojas sí viajan con la revisión; las que se
  // entregan como archivo aparte solo se cotejan en la revisión individual.
  const conImagenesSueltas = alumnos.filter(([, archivos]) => archivos.some(f => ES_IMAGEN.test(f.name)));

  async function lanzarTodo() {
    setEstado('lanzando');
    const resultados = [];

    for (const [carpeta, archivos] of alumnos) {
      const studentName = detectStudentName(carpeta) || carpeta;
      setActual(studentName);

      try {
        // Parsear los archivos de este estudiante
        const entradas = [];
        for (const file of archivos) {
          if (ES_IMAGEN.test(file.name)) continue;
          entradas.push({ file, role: guessRole(file, delivery), parsed: await parsear(file) });
        }

        const filesMap = construirFilesMap(entradas);
        const admissibility = runAdmissibility(delivery, filesMap);

        const { batchId, totalTandas, plan } = await lanzarRevision({
          delivery, studentName, filesMap, admissibility,
        });

        resultados.push({ studentName, batchId, totalTandas, plan, ok: true });
        setProgreso(p => [...p, { studentName, ok: true, totalTandas }]);
      } catch (err) {
        console.error(`[curso] ${studentName}:`, err);
        resultados.push({ studentName, ok: false, error: err.message });
        setProgreso(p => [...p, { studentName, ok: false, error: err.message }]);
      }
    }

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
            <span className={`text-xs shrink-0 ${p.ok ? 'text-green-600' : 'text-red-600'}`}>
              {p.ok ? `${p.totalTandas} tandas` : p.error?.slice(0, 60)}
            </span>
          </div>
        ))}
      </div>

      {estado === 'listo' && (
        <div className="text-xs text-slate-600 leading-relaxed">
          Los lotes se procesan en paralelo, así que el curso completo tarda más o menos
          lo mismo que una sola revisión. Vuelve más tarde y recógelas desde la pantalla
          inicial — sobreviven a cerrar la aplicación.
          {conError > 0 && (
            <span className="block mt-1 text-red-600">
              {conError} estudiante(s) no se pudieron lanzar. Revísalos de a uno.
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

async function parsear(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'docx' || ext === 'doc') return await parseWord(file);
    if (ext === 'xlsx' || ext === 'xls') return await parseExcel(file);
    if (ext === 'pdf') return await parsePdf(file);
  } catch (err) {
    console.warn(`[curso] No se pudo leer ${file.name}: ${err.message}`);
  }
  return null;
}
