import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES } from '../lib/rubric.js';
import { parseExcel, parseWord, parseImage, detectStudentName } from '../lib/fileParser.js';

const ROLE_OPTIONS_E1 = [
  { value: 'eett', label: 'EETT (Word)' },
  { value: 'cubicaciones', label: 'Listado + Cubicaciones' },
  { value: 'cotizaciones', label: 'Cotizaciones' },
  { value: 'respaldo', label: 'Respaldo PDF (cotizaciones)' },
  { value: 'imagen', label: 'Imagen (respaldo cubicaciones)' },
];

const ROLE_OPTIONS_E2 = [
  { value: 'eett', label: 'EETT (Word)' },
  { value: 'cubicaciones', label: 'Listado + Cubicaciones E1' },
  { value: 'cotizaciones', label: 'Cotizaciones E1' },
  { value: 'apu', label: 'APU — Cartillas (Anexo 01)' },
];

function guessRole(file, delivery) {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop();

  if (ext === 'docx' || ext === 'doc') return 'eett';
  if (ext === 'pdf') return 'respaldo';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'imagen';
  if (ext === 'xlsx' || ext === 'xls') {
    if (/cotiz|cot_|proveedor/.test(name)) return 'cotizaciones';
    if (/apu|analisis|precios|unitarios|cartilla/.test(name)) return 'apu';
    if (/listado|cubic|itemizado|partidas/.test(name)) return 'cubicaciones';
    // Default: first Excel → cubicaciones, second → cotizaciones
    return 'cubicaciones';
  }
  return 'respaldo';
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
      }
      // PDFs: just store name, no parsing
      setParsed(id, parsed);
    } catch (err) {
      console.error(`Error parsing ${file.name}:`, err);
    } finally {
      setParsing(p => { const n = { ...p }; delete n[id]; return n; });
    }
  }, [setParsed]);

  const onDrop = useCallback(async (acceptedFiles) => {
    const newEntries = acceptedFiles.map(f => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file: f,
      role: guessRole(f, delivery),
      parsed: null,
    }));

    addFiles(newEntries);

    // Auto-detect student name from first file if not set
    if (!studentName.trim() && newEntries.length > 0) {
      const detected = detectStudentName(newEntries[0].file.name);
      if (detected) setStudentName(detected);
    }

    // Parse in background
    for (const entry of newEntries) {
      parseFile(entry.id, entry.file, entry.role);
    }
  }, [addFiles, delivery, parseFile, studentName, setStudentName]);

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

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-uvm-blue bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
      >
        <input {...getInputProps()} />
        <div className="text-4xl mb-2">📂</div>
        <div className="text-sm font-medium text-slate-600">
          {isDragActive ? 'Suelta los archivos aquí...' : 'Arrastra los archivos aquí o haz clic para seleccionar'}
        </div>
        <div className="text-xs text-slate-400 mt-1">Word, Excel, PDF, imágenes — múltiples archivos a la vez</div>
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

              {/* Role selector (only for Excel) */}
              {(entry.file.name.endsWith('.xlsx') || entry.file.name.endsWith('.xls')) && (
                <select
                  value={entry.role}
                  onChange={e => {
                    updateFileRole(entry.id, e.target.value);
                  }}
                  className="text-xs border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-uvm-blue"
                >
                  {roleOptions.filter(r => !['respaldo', 'imagen', 'eett'].includes(r.value)).map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              )}

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
