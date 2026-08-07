import React, { useEffect } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { runAdmissibility } from '../lib/admissibility.js';
import { generateFeedbackPDF } from '../lib/pdfExport.js';

export default function Step3_Admissibility() {
  const {
    delivery, studentName, admissibility, setAdmissibility, goTo,
    getFilesMap, uploadedFiles,
  } = useGradingStore();

  useEffect(() => {
    if (admissibility) return;
    const filesMap = getFilesMap();
    const result = runAdmissibility(delivery, filesMap);
    setAdmissibility(result);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!admissibility) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-spin">⚙️</div>
          <div>Verificando admisibilidad...</div>
        </div>
      </div>
    );
  }

  const { passed, results } = admissibility;

  function exportRejectionPDF() {
    const { getFilesMap } = useGradingStore.getState();
    generateFeedbackPDF({
      delivery,
      studentName,
      admissibility,
      criteria: [],
      globalScore: 1.0,
      globalJustification: `Entrega rechazada por no cumplir los criterios de admisibilidad. Motivos: ${results.filter(r => !r.passed).map(r => r.label).join('; ')}.`,
      globalObservation: 'Nota mínima 1,0 por incumplimiento de admisibilidad.',
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Verificación de Admisibilidad</h2>
        <p className="text-sm text-slate-500">
          Estudiante: <span className="font-semibold">{studentName}</span> · {delivery}
        </p>
      </div>

      {/* Overall badge */}
      <div className={`rounded-xl p-4 border-2 ${passed ? 'bg-green-50 border-green-400' : 'bg-red-50 border-red-400'}`}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{passed ? '✅' : '❌'}</span>
          <div>
            <div className={`text-lg font-bold ${passed ? 'text-green-700' : 'text-red-700'}`}>
              {passed ? 'Entrega ADMISIBLE' : 'Entrega RECHAZADA'}
            </div>
            <div className="text-sm text-slate-600">
              {passed
                ? 'Todos los criterios de admisibilidad cumplen los umbrales mínimos.'
                : 'Uno o más criterios no alcanzan el umbral mínimo. Nota: 1,0'}
            </div>
          </div>
        </div>
      </div>

      {/* Per-criterion results */}
      <div className="space-y-3">
        {results.map(r => (
          <div
            key={r.id}
            className={`rounded-lg border p-4 ${r.passed ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-slate-800 text-sm">{r.label}</div>
              <span className={`text-sm font-bold ${r.passed ? 'text-green-600' : 'text-red-600'}`}>
                {r.passed ? '✓ OK' : '✗ FALLA'}
              </span>
            </div>
            <div className="text-sm text-slate-600">{r.detail}</div>

            {/* Progress bar if ratio available */}
            {r.ratio !== undefined && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{Math.round(r.ratio * 100)}% alcanzado</span>
                  <span>mínimo {Math.round(r.threshold * 100)}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${r.passed ? 'bg-green-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(100, r.ratio * 100)}%` }}
                  />
                </div>
                {/* Threshold marker */}
                <div className="relative">
                  <div
                    className="absolute top-0 w-0.5 h-2 bg-slate-500"
                    style={{ left: `${r.threshold * 100}%` }}
                    title={`Umbral: ${Math.round(r.threshold * 100)}%`}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => goTo('upload')}
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50"
        >
          ← Modificar archivos
        </button>

        {!passed && (
          <button
            onClick={exportRejectionPDF}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
          >
            📄 Exportar rechazo (Nota 1,0)
          </button>
        )}

        {passed && (
          <button
            onClick={() => goTo('evaluating')}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white bg-uvm-blue hover:bg-blue-800"
          >
            Evaluar con IA →
          </button>
        )}
      </div>
    </div>
  );
}
