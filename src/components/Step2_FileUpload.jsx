import React, { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES } from '../lib/rubric.js';
import { parseExcel, parseWord, parsePdf, parseImage, detectStudentName } from '../lib/fileParser.js';

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

function guessRole(file, delivery) {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop();

  if (ext === 'docx' || ext === 'doc') {
    if (/cotiz|cot_|proveedor|presupuesto/.test(name)) return 'cotizaciones';
    return 'eett';
  }
  if (ext === 'pdf') {
    if (/eett|especificaci|et_|_et_|tecnica/.test(name)) return 'eett';
    return 'respaldo';
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'imagen';
  if (ext === 'xlsx' || ext === 'xls') {
    if (/apu|analisis|análisis|precios|unitarios|cartilla/.test(name)) return 'apu';
    // "cubica" gana sobre "itemizado": un libro llamado "LISTADO Y CUBICACIONES"
    // trae ambas cosas y debe revisarse como cubicaciones.
    if (/cubica/.test(name)) return 'cubicaciones';
    if (/itemizado|listado|partidas/.test(name)) return 'listado';
    if (/cotiz|cot_|proveedor/.test(name)) return 'cotizaciones';
    return 'cubicaciones';
  }
  return 'respaldo';
}

/**
 * Agrupa los archivos por carpeta de estudiante cuando se eligió la carpeta del
 * curso completo: las rutas llegan como CURSO/ALUMNO/archivo.
 * Devuelve null si los archivos vienen de una sola carpeta o sueltos.
 */
function agruparPorEstudiante(archivos) {
  const grupos = new Map();
  for (const f of archivos) {
    const partes = (f.webkitRelativePath ?? '').split('/');
    if (partes.length < 3) return null;        // no es una carpeta de carpetas
    const alumno = partes[partes.length - 2];
    if (!grupos.has(alumno)) grupos.set(alumno, []);
    grupos.get(alumno).push(f);
  }
  return grupos;
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

  const cargar = useCallback((archivos) => {
    setCarpetas(null);

    const newEntries = archivos.map(f => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file: f,
      role: guessRole(f, delivery),
      parsed: null,
    }));

    addFiles(newEntries);

    // Al elegir una carpeta, su nombre identifica al estudiante mejor que el
    // del primer archivo, que suele traer el nombre del proyecto.
    if (!studentName.trim() && newEntries.length > 0) {
      const partes = (newEntries[0].file.webkitRelativePath ?? '').split('/');
      const carpeta = partes.length >= 2 ? partes[partes.length - 2] : '';
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
    if (porCarpeta && porCarpeta.size > 1) {
      setCarpetas(porCarpeta);
      return;
    }

    cargar(acceptedFiles);
  }, [cargar]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true });

  const requiredRoles = expectedFiles.filter(f => f.required).map(f => f.role);
  const coveredRoles = new Set(uploadedFiles.map(f => f.role));
  const missingRequired = requiredRoles.filter(r => !coveredRoles.has(r));
  const allParsed = Object.keys(parsing).length === 0;
  const canContinue = missingRequired.length === 0 && allParsed && uploadedFiles.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Subir archivos del estudiante</h2>
        <p className="text-sm text-slate-500">
          Entrega: <span className="font-semibold text-uvm-blue">{DELIVERIES[delivery]?.label}</span> ·
          Estudiante: <span className="font-semibold">{studentName}</span>
        </p>
      </div>

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

      {/* Se eligió la carpeta del curso: hay que elegir a quién revisar, porque
          cargarlos todos mezclaría a los estudiantes en una sola corrección. */}
      {carpetas && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div>
            <div className="text-sm font-bold text-slate-800">
              Se detectaron {carpetas.size} carpetas de estudiantes
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              Las correcciones son de a un estudiante por vez. Elige a quién revisar ahora.
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {[...carpetas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([alumno, archivos]) => (
              <button
                key={alumno}
                onClick={() => cargar(archivos)}
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
