import React from 'react';
import { GRADE_COLORS } from '../lib/rubric.js';
import { PASOS_NOTA, redondearNota, formatoNota } from '../lib/notas.js';

export default function CriterionCard({ criterion, aiScore, aiJustification, professorScore, professorObservation, onScoreChange, onObsChange }) {
  const displayScore = professorScore ?? aiScore;
  // Las notas van de a 0,1: con medios puntos, ajustar un criterio de poco peso
  // no movía la nota final y parecía que no reaccionaba.
  const sliderIndex = PASOS_NOTA.indexOf(redondearNota(displayScore));

  return (
    <div className={`rounded-xl border p-5 ${GRADE_COLORS.getBg(displayScore)}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-uvm-blue bg-blue-100 px-2 py-0.5 rounded">
              {Math.round(criterion.weight * 100)}%
            </span>
            <span className="font-bold text-slate-800">{criterion.label}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{criterion.description}</div>
        </div>

        {/* AI score badge */}
        <div className="text-center shrink-0">
          <div className="text-xs text-slate-500 mb-0.5">Nota IA</div>
          <div className={`text-2xl font-bold ${GRADE_COLORS.getColor(aiScore)}`}>
            {aiScore.toFixed(1).replace('.', ',')}
          </div>
        </div>
      </div>

      {/* AI justification */}
      <div className="bg-white bg-opacity-60 rounded-lg p-3 text-sm text-slate-700 mb-4 leading-relaxed">
        {aiJustification}
      </div>

      {/* Professor grade adjustment */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Nota del docente</span>
          <span className={`text-xl font-bold ${GRADE_COLORS.getColor(displayScore)}`}>
            {formatoNota(displayScore)}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={PASOS_NOTA.length - 1}
          step={1}
          value={sliderIndex < 0 ? PASOS_NOTA.indexOf(4.0) : sliderIndex}
          onChange={e => onScoreChange(PASOS_NOTA[parseInt(e.target.value)])}
          className="w-full h-2 rounded-lg appearance-none bg-slate-200 cursor-pointer"
        />

        {/* Tick marks */}
        <div className="flex justify-between text-[9px] text-slate-400 px-0.5">
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <span key={n}>{n}</span>
          ))}
        </div>

        {/* Passing threshold indicator */}
        {(professorScore ?? aiScore) < 4.0 && (
          <div className="text-xs text-red-600 font-medium text-center">
            ⚠ Nota bajo 4,0 — reprobado (debe recursar la asignatura)
          </div>
        )}
      </div>

      {/* Professor observation */}
      <div className="mt-3">
        <label className="text-xs font-medium text-slate-600 mb-1 block">
          Observación del docente (opcional)
        </label>
        <textarea
          value={professorObservation ?? ''}
          onChange={e => onObsChange(e.target.value)}
          placeholder="Agrega observaciones específicas sobre este criterio..."
          rows={2}
          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-uvm-blue bg-white"
        />
      </div>
    </div>
  );
}
