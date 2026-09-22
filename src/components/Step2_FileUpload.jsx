import React, { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES } from '../lib/rubric.js';
import { parseExcel, parseWord, parsePdf, parseImage, detectStudentName } from '../lib/fileParser.js';
import { guessRole, agruparPorEstudiante, detectarMezcla } from '../lib/roles.js';
import LanzadorCurso from './LanzadorCurso.jsx';

const ROLE_OPTIONS_E1 = [
  { value: 'eett', label: 'EETT (Word / PDF)' },
  { value: 'listado', label: 'Listado / Itemizado' },
  { value: 'cubicaciones', label: 'Cubicaciones' },
  { value: 'cotizaciones', label: 'Cotizaciones' },
  { value: 'respaldo', label: 'Respaldo PDF (cotizaciones)' },
  { value: 'imagen', label: 'Imagen (respaldo cubicaciones)' },
];

const ROLE_OPTIONS_E2 = [
  { value: 'eett', label: 'EETT (Word / PDF)' },
  { value: 'listado', label: 'Listado / Itemizado E1' },
  { value: 'cubicaciones', label: 'Cubicaciones E1' },
  { value: 'cotizaciones', label: 'Cotizaciones E1' },
  { value: 'apu', label: 'APU — Cartillas (Anexo 01)' },
];

// Los apellidos se detectan en minúsculas; en pantalla se leen mejor así.
function conMayusculas(texto) {
  return texto.replace(/\b\p{Ll}/gu, c => c.toUpperCase());
}

function fileTypeIcon(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'docx' || ext === 'doc') return '📄';
  if (ext === 'xlsx' || ext === 'xls') return '📊';
  if (ext === 'pdf') return '📕';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return '🖼️';
  return '📎';
}

export default function Step2_FileUpload() {
  const { delivery, studentName, setStudentName, uploadedFiles, addFiles, removeFile, updateFileRole, setParsed, goTo } = useGradingStore();
  const [parsing, setParsing] = useState({});  // { fileId: true }
  const carpetaRef = useRef(null);
  const [carpetas, setCarpetas] = useState(null);  // curso completo detectado
  const [modoCurso, setModoCurso] = useState(false);
  const [mezclaAceptada, setMezclaAceptada] = useState(false);
  const expectedFiles = DELIVERIES[delivery]?.expectedFiles ?? [];
  const roleOptions = delivery === 'E2' ? ROLE_OPTIONS_E2 : ROLE_OPTIONS_E1;

  const parseFile = useCallback(async (id, file, role) => {
    setParsing(p => ({ ...p, [id]: true }));
    try {
      let parsed = null;
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'docx' || ext === 'doc') {
        parsed = await parseWord(file);
      } else if (ext === 'xlsx' || ext === 'xls') {
        parsed = await parseExcel(file);
      } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        parsed = await parseImage(file);
      } else if (ext === 'pdf') {
        // Todos los PDF se leen, no solo las EETT: los de respaldo de
        // cotizaciones traen proveedor, precio y año, que hay que cotejar
        // contra la planilla.
        parsed = await parsePdf(file);
      }
      setParsed(id, parsed);
    } catch (err) {
      console.error(`Error parsing ${file.name}:`, err);
    } finally {
      setParsing(p => { const n = { ...p }; delete n[id]; return n; });
    }
  }, [setParsed]);

  // `carpetaAlumno` llega cuando se eligió a uno del listado del curso: ahí el
  // nombre lo da esa carpeta, no la ruta.
  const cargar = useCallback((archivos, carpetaAlumno = null) => {
    setCarpetas(null);
    setModoCurso(false);

    const newEntries = archivos.map(f => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file: f,
      role: guessRole(f, delivery),
      parsed: null,
    }));

    addFiles(newEntries);

    // Al elegir una carpeta, su nombre identifica al estudiante mejor que el
    // del primer archivo, que suele traer el nombre del proyecto. Se toma la
    // carpeta RAÍZ, no la que contiene al archivo: un alumno puede ordenar lo
    // suyo en subcarpetas, y «COTIZACIONES» no es el nombre de nadie.
    if (!studentName.trim() && newEntries.length > 0) {
      const ruta = (newEntries[0].file.webkitRelativePath || newEntries[0].file.path || '')
        .split('/').filter(Boolean);
      const carpeta = carpetaAlumno ?? (ruta.length >= 2 ? ruta[0] : '');
      const detected = carpeta
        ? detectStudentName(carpeta)
        : detectStudentName(newEntries[0].file.name);
      if (detected) setStudentName(detected);
    }

    for (const entry of newEntries) {
      parseFile(entry.id, entry.file, entry.role);
    }
  }, [addFiles, delivery, parseFile, studentName, setStudentName]);

  const onDrop = useCallback(async (acceptedFiles) => {
    // Si se eligió la carpeta del curso en vez de la de un estudiante, los
    // archivos vienen como CURSO/ALUMNO/archivo. Cargarlos todos juntos
    // mezclaría a los estudiantes en una sola revisión sin avisar.
    const porCarpeta = agruparPorEstudiante(acceptedFiles);
    if (porCarpeta) {
      setCarpetas(porCarpeta);
      setModoCurso(false);
      return;
    }

    cargar(acceptedFiles);
  }, [cargar]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true });

  const requiredRoles = expectedFiles.filter(f => f.required).map(f => f.role);
  const coveredRoles = new Set(uploadedFiles.map(f => f.role));
  const missingRequired = requiredRoles.filter(r => !coveredRoles.has(r));
  // Mezclar estudiantes no falla: produce una corrección que evalúa a varios
  // como si fueran uno, y cuesta lo mismo que una buena.
  const mezcla = detectarMezcla(uploadedFiles);
  const bloqueadoPorMezcla = Boolean(mezcla) && !mezclaAceptada;

  const allParsed = Object.keys(parsing).length === 0;
  // El nombre ya no se exige en el paso anterior —el curso completo no tiene
  // uno— así que se comprueba aquí, que es donde empieza a hacer falta.
  const sinNombre = studentName.trim().length < 3;
  const canContinue = missingRequired.length === 0 && allParsed
    && uploadedFiles.length > 0 && !sinNombre && !bloqueadoPorMezcla;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Subir archivos del estudiante</h2>
        <p className="text-sm text-slate-500">
          Entrega: <span className="font-semibold text-uvm-blue">{DELIVERIES[delivery]?.label}</span>
          {studentName && <> · Estudiante: <span className="font-semibold">{studentName}</span></>}
        </p>
      </div>

      {/* El nombre se detecta de la carpeta, pero no siempre: sin él el informe
          sale sin destinatario. */}
      {uploadedFiles.length > 0 && sinNombre && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-800">
            No se pudo detectar el nombre del estudiante
          </div>
          <input
            type="text"
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="Apellido Nombre"
            className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white
              focus:outline-none focus:ring-2 focus:ring-uvm-blue focus:border-transparent"
          />
        </div>
      )}

      {/* Expected files checklist */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
        <div className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">Archivos esperados</div>
        <div className="space-y-1">
          {expectedFiles.map(ef => {
            const present = uploadedFiles.some(u => u.role === ef.role);
            return (
              <div key={ef.role} className="flex items-center gap-2 text-sm">
                <span className={present ? 'text-green-600' : ef.required ? 'text-red-500' : 'text-slate-400'}>
                  {present ? '✓' : ef.required ? '✗' : '○'}
                </span>
                <span className={present ? 'text-slate-700' : ef.required ? 'text-slate-700 font-medium' : 'text-slate-400'}>
                  {ef.label}
                  {!ef.required && <span className="text-slate-400 text-xs ml-1">(opcional)</span>}
                </span>
                <span className="text-slate-300 text-xs">{ef.formats.join(', ')}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Se eligió la carpeta del curso: o se revisa a uno, o se lanzan todos.
          Cargarlos todos juntos en una corrección mezclaría a los estudiantes. */}
      {carpetas && modoCurso && (
        <LanzadorCurso
          carpetas={carpetas}
          delivery={delivery}
          onCancelar={() => setModoCurso(false)}
          onListo={() => { setCarpetas(null); setModoCurso(false); goTo('setup'); }}
        />
      )}

      {carpetas && !modoCurso && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div>
            <div className="text-sm font-bold text-slate-800">
              Se detectaron {carpetas.size} carpetas de estudiantes
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              Elige a quién revisar ahora, o lanza el curso completo de una vez.
            </div>
          </div>

          <button
            onClick={() => setModoCurso(true)}
            className="w-full py-2.5 rounded-lg font-semibold text-white bg-uvm-blue hover:bg-blue-800 text-sm"
          >
            Revisar el curso completo · {carpetas.size} estudiantes
          </button>

          <div className="text-xs text-slate-500 text-center">o revisa a uno solo:</div>

          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {[...carpetas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([alumno, archivos]) => (
              <button
                key={alumno}
                onClick={() => cargar(archivos, alumno)}
                className="w-full text-left bg-white border border-blue-100 rounded-lg px-3 py-2
                  hover:border-uvm-blue hover:shadow-sm transition-all flex items-center justify-between gap-3"
              >
                <span className="text-sm font-medium text-slate-800 truncate">{alumno}</span>
                <span className="text-xs text-slate-400 shrink-0">{archivos.length} archivos</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setCarpetas(null)}
            className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-uvm-blue bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
      >
        <input {...getInputProps()} />
        <div className="text-4xl mb-2">📂</div>
        <div className="text-sm font-medium text-slate-600">
          {isDragActive
            ? 'Suelta aquí...'
            : 'Arrastra la carpeta del estudiante, o archivos sueltos'}
        </div>
        <div className="text-xs text-slate-400 mt-1">
          Word, Excel, PDF, imágenes — al arrastrar una carpeta se carga todo su contenido
        </div>
      </div>

      {/* Selector de carpeta: el arrastre no siempre es evidente */}
      <div className="text-center -mt-2">
        <input
          ref={carpetaRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={e => {
            const archivos = Array.from(e.target.files ?? []);
            if (archivos.length) onDrop(archivos);
            e.target.value = '';   // permite volver a elegir la misma carpeta
          }}
        />
        <button
          onClick={() => carpetaRef.current?.click()}
          className="text-sm text-uvm-blue hover:underline underline-offset-2 font-medium"
        >
          📁 Seleccionar carpeta del estudiante
        </button>
      </div>

      {/* File list */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-700">
            Archivos subidos ({uploadedFiles.length})
          </div>
          {uploadedFiles.map(entry => (
            <div key={entry.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className="text-xl">{fileTypeIcon(entry.file)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{entry.file.name}</div>
                <div className="text-xs text-slate-400">{(entry.file.size / 1024).toFixed(0)} KB</div>
              </div>

              {parsing[entry.id] && (
                <span className="text-xs text-blue-500 animate-pulse">Leyendo...</span>
              )}
              {!parsing[entry.id] && entry.parsed && (
                <span className="text-xs text-green-500">✓ Leído</span>
              )}

              {/* Role selector — all files */}
              <select
                value={entry.role}
                onChange={e => {
                  const newRole = e.target.value;
                  updateFileRole(entry.id, newRole);
                  const ext = entry.file.name.split('.').pop().toLowerCase();
                  if (ext === 'pdf' && !entry.parsed) parseFile(entry.id, entry.file, newRole);
                }}
                className="text-xs border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-uvm-blue"
              >
                {roleOptions.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>

              <button
                onClick={() => removeFile(entry.id)}
                className="text-slate-400 hover:text-red-500 transition-colors text-sm"
                title="Quitar archivo"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Varios estudiantes en una sola corrección: el fallo más caro que puede
          cometerse aquí, porque no falla — evalúa. */}
      {mezcla && !mezclaAceptada && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 space-y-3">
          <div className="text-sm font-bold text-red-800">
            Parece que hay más de un estudiante en estos archivos
          </div>

          <div className="text-xs text-red-900 leading-relaxed space-y-1.5">
            {mezcla.nombres.length >= 2 && (
              <div>
                Los nombres de archivo apuntan a varias personas:{' '}
                <span className="font-semibold">{mezcla.nombres.map(conMayusculas).join(' · ')}</span>.
              </div>
            )}
            {mezcla.duplicados.map(d => (
              <div key={d.rol}>
                Hay <span className="font-semibold">{d.n} archivos</span> con el rol «{d.rol}»,
                y una entrega trae uno.
              </div>
            ))}
            <div className="pt-1">
              Corregirlos juntos no da error: produce una evaluación que trata a todos
              como un solo estudiante, y cuesta lo mismo que una revisión correcta.
              Quita los que no correspondan, o vuelve atrás y carga la carpeta del curso
              para revisarlos por separado.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { useGradingStore.getState().reset(); }}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700"
            >
              Empezar de nuevo
            </button>
            <button
              onClick={() => setMezclaAceptada(true)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-red-700 bg-white border border-red-300 hover:bg-red-50"
            >
              Son de un solo estudiante — continuar
            </button>
          </div>
        </div>
      )}

      {missingRequired.length > 0 && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Falta subir: {missingRequired.map(r => expectedFiles.find(f => f.role === r)?.label ?? r).join(', ')}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => goTo('setup')}
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50"
        >
          ← Volver
        </button>
        <button
          disabled={!canContinue}
          onClick={() => goTo('admissibility')}
          className="flex-1 py-2.5 rounded-lg font-semibold text-white transition-colors
            bg-uvm-blue hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Verificar admisibilidad →
        </button>
      </div>
    </div>
  );
}
