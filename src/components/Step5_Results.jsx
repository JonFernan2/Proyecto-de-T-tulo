import React from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES, GRADE_COLORS } from '../lib/rubric.js';
import CriterionCard from './CriterionCard.jsx';
import { generateFeedbackPDF } from '../lib/pdfExport.js';

const GRADE_STEPS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0];

export default function Step5_Results() {
  const {
    delivery, studentName, evaluation, admissibility,
    adjustments, setAdjustment,
    globalScore, setGlobalScore,
    globalObservation, setGlobalObservation,
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
  const globalIdx = GRADE_STEPS.indexOf(finalGlobal);

  function handleExport() {
    generateFeedbackPDF({
      delivery,
      studentName,
      admissibility,
      criteria,
      globalScore: finalGlobal,
      globalJustification: evaluation.globalJustification ?? '',
      globalObservation,
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
          <div className="text-xs text-slate-500 mb-0.5">Nota IA global</div>
          <div className={`text-3xl font-bold ${GRADE_COLORS.getColor(aiGlobal)}`}>
            {aiGlobal.toFixed(1).replace('.', ',')}
          </div>
        </div>
      </div>

      {/* Global justification from AI */}
      {evaluation.globalJustification && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Justificación global (IA)
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{evaluation.globalJustification}</p>
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
            onScoreChange={score => setAdjustment(c.id, 'score', score)}
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
              Propuesta IA: {aiGlobal.toFixed(1).replace('.', ',')} · Ajusta si lo consideras necesario
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
