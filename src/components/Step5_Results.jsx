import React from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES, GRADE_COLORS } from '../lib/rubric.js';
import CriterionCard from './CriterionCard.jsx';
import { generateFeedbackPDF } from '../lib/pdfExport.js';

const GRADE_STEPS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0];

const ESTADO_STYLES = {
  'Cumple': 'bg-green-100 text-green-700',
  'Parcial': 'bg-amber-100 text-amber-700',
  'No cumple': 'bg-red-100 text-red-700',
  'No verificable': 'bg-slate-100 text-slate-600',
};

export default function Step5_Results() {
  const {
    delivery, studentName, evaluation, admissibility,
    adjustments, setAdjustment,
    globalScore, setGlobalScore,
    globalObservation, setGlobalObservation,
    globalJustificationEdit, setGlobalJustification,
    reset,
  } = useGradingStore();

  if (!evaluation) return null;

  const rubricCriteria = DELIVERIES[delivery]?.criteria ?? [];

  // Build enriched criteria list
  const criteria = rubricCriteria.map(rc => {
    const aiCrit = evaluation.criteria?.find(c => c.id === rc.id) ?? {};
    const adj = adjustments[rc.id] ?? {};
    return {
      ...rc,
      aiScore: aiCrit.score ?? 1.0,
      aiJustification: aiCrit.justification ?? '',
      professorScore: adj.score ?? aiCrit.score ?? 1.0,
      professorObservation: adj.observation ?? '',
    };
  });

  const aiGlobal = evaluation.globalScore ?? 1.0;
  const finalGlobal = globalScore ?? aiGlobal;
  const justificacion = globalJustificationEdit ?? evaluation.globalJustification ?? '';
  const notasAjustadas = Math.abs(finalGlobal - aiGlobal) > 0.01;
  const globalIdx = GRADE_STEPS.indexOf(finalGlobal);

  // Recalculate weighted global score when a criterion score changes
  function handleScoreChange(id, score) {
    setAdjustment(id, 'score', score);
    const updated = rubricCriteria.map(rc => {
      const adj = useGradingStore.getState().adjustments[rc.id] ?? {};
      const aiCrit = evaluation.criteria?.find(c => c.id === rc.id) ?? {};
      const s = rc.id === id ? score : (adj.score ?? aiCrit.score ?? 1.0);
      return { weight: rc.weight, s };
    });
    const totalWeight = updated.reduce((sum, c) => sum + c.weight, 0);
    const weighted = updated.reduce((sum, c) => sum + c.s * c.weight, 0) / (totalWeight || 1);
    const snapped = Math.max(1.0, Math.min(7.0, Math.round(weighted * 2) / 2));
    setGlobalScore(snapped);
  }

  function handleExport() {
    generateFeedbackPDF({
      delivery,
      studentName,
      admissibility,
      criteria,
      globalScore: finalGlobal,
      globalJustification: justificacion,
      globalObservation,
      resumen: evaluation.resumen ?? [],
      fortalezas: evaluation.fortalezas ?? [],
      mejoras: evaluation.mejoras ?? [],
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Resultados de evaluación</h2>
          <p className="text-sm text-slate-500">
            {studentName} · {DELIVERIES[delivery]?.label}
          </p>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-500 mb-0.5">Nota propuesta</div>
          <div className={`text-3xl font-bold ${GRADE_COLORS.getColor(aiGlobal)}`}>
            {aiGlobal.toFixed(1).replace('.', ',')}
          </div>
        </div>
      </div>

      {/* Global justification — editable: si se ajustan las notas deja de
          corresponder, y el PDF no puede contradecir la nota que imprime. */}
      {evaluation.globalJustification && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Justificación global
          </div>

          {notasAjustadas && (
            <div className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Ajustaste la nota de {aiGlobal.toFixed(1).replace('.', ',')} a{' '}
              {finalGlobal.toFixed(1).replace('.', ',')}. Este texto sigue redactado para la
              nota anterior y puede contradecir la final — revísalo antes de exportar.
            </div>
          )}

          <textarea
            value={justificacion}
            onChange={e => setGlobalJustification(e.target.value)}
            rows={6}
            className={`w-full text-sm text-slate-700 leading-relaxed bg-white border rounded-lg px-3 py-2
              resize-y focus:outline-none focus:ring-2 focus:ring-uvm-blue
              ${notasAjustadas ? 'border-amber-300' : 'border-slate-200'}`}
          />
        </div>
      )}

      {/* Cuadro resumen de la revisión */}
      {evaluation.resumen?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="text-sm font-bold text-slate-800">Cuadro resumen de la revisión</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Puntos verificados en los archivos de {studentName}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="px-4 py-2 font-semibold">Aspecto</th>
                  <th className="px-4 py-2 font-semibold">Hallazgo</th>
                  <th className="px-4 py-2 font-semibold text-center whitespace-nowrap">Estado</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.resumen.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{r.aspecto}</td>
                    <td className="px-4 py-2.5 text-slate-600 leading-relaxed">{r.hallazgo}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${ESTADO_STYLES[r.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                        {r.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fortalezas y mejoras */}
      {(evaluation.fortalezas?.length > 0 || evaluation.mejoras?.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {evaluation.fortalezas?.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                Aspectos bien logrados
              </div>
              <ul className="space-y-1.5">
                {evaluation.fortalezas.map((f, i) => (
                  <li key={i} className="text-sm text-slate-700 flex gap-2">
                    <span className="text-green-600 shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evaluation.mejoras?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                Acciones de mejora
              </div>
              <ul className="space-y-1.5">
                {evaluation.mejoras.map((m, i) => (
                  <li key={i} className="text-sm text-slate-700 flex gap-2">
                    <span className="text-amber-600 shrink-0">→</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Per-criterion cards */}
      <div className="space-y-4">
        {criteria.map(c => (
          <CriterionCard
            key={c.id}
            criterion={c}
            aiScore={c.aiScore}
            aiJustification={c.aiJustification}
            professorScore={c.professorScore}
            professorObservation={c.professorObservation}
            onScoreChange={score => handleScoreChange(c.id, score)}
            onObsChange={obs => setAdjustment(c.id, 'observation', obs)}
          />
        ))}
      </div>

      {/* Final grade box */}
      <div className="bg-uvm-blue rounded-xl p-5 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-medium text-blue-200">Nota final del docente</div>
            <div className="text-xs text-blue-300 mt-0.5">
              Ajusta si lo consideras necesario
            </div>
          </div>
          <div className={`text-4xl font-bold ${finalGlobal >= 4 ? 'text-green-300' : 'text-red-300'}`}>
            {finalGlobal.toFixed(1).replace('.', ',')}
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={GRADE_STEPS.length - 1}
          step={1}
          value={globalIdx < 0 ? Math.round((aiGlobal - 1) / 0.5) : globalIdx}
          onChange={e => setGlobalScore(GRADE_STEPS[parseInt(e.target.value)])}
          className="w-full h-2 rounded-lg appearance-none bg-blue-700 cursor-pointer mb-1"
        />
        <div className="flex justify-between text-[10px] text-blue-300 px-0.5">
          {[1, 2, 3, 4, 5, 6, 7].map(n => <span key={n}>{n}</span>)}
        </div>

        {finalGlobal < 4.0 && (
          <div className="mt-3 text-sm text-red-300 font-medium text-center">
            ⚠ Nota bajo 4,0 — el estudiante deberá recursar la asignatura
          </div>
        )}
      </div>

      {/* Global observation */}
      <div>
        <label className="text-sm font-semibold text-slate-700 block mb-2">
          Observaciones generales del docente
        </label>
        <textarea
          value={globalObservation}
          onChange={e => setGlobalObservation(e.target.value)}
          placeholder="Escribe aquí las observaciones generales para el estudiante..."
          rows={4}
          className="w-full text-sm border border-slate-300 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-uvm-blue"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50"
        >
          Nueva corrección
        </button>
        <button
          onClick={handleExport}
          className="flex-1 py-3 rounded-xl font-bold text-white bg-uvm-blue hover:bg-blue-800 text-sm"
        >
          📄 Exportar PDF de retroalimentación
        </button>
      </div>
    </div>
  );
}
