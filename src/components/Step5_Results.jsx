import React, { useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES, GRADE_COLORS } from '../lib/rubric.js';
import CriterionCard from './CriterionCard.jsx';
import { generateFeedbackPDF } from '../lib/pdfExport.js';
import { PASOS_NOTA, ponderar, desglose, formatoNota } from '../lib/notas.js';

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
    globalScore, setGlobalScore, globalScoreManual, volverAlPonderado,
    globalObservation, setGlobalObservation,
    globalJustificationEdit, setGlobalJustification,
    reset,
  } = useGradingStore();

  // Antes del retorno temprano: los hooks no pueden quedar tras una condición.
  const [exportError, setExportError] = useState(null);

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

  // El promedio ponderado de las notas que están puestas ahora mismo. Es la
  // nota final salvo que el docente la haya fijado a mano.
  const detalle = desglose(criteria.map(c => ({
    label: c.label, weight: c.weight, score: c.professorScore,
  })));
  const ponderado = detalle.nota ?? aiGlobal;

  // Regla terminante de la Entrega 2: bajo el 80% de partidas con APU no se
  // aprueba el ramo, por buenas que sean las notas de los criterios.
  const tope = admissibility?.results?.find(r => r.notaMaxima !== undefined) ?? null;

  const elegida = globalScoreManual ? (globalScore ?? ponderado) : ponderado;
  const finalGlobal = tope ? Math.min(elegida, tope.notaMaxima) : elegida;
  const justificacion = globalJustificationEdit ?? evaluation.globalJustification ?? '';
  const notasAjustadas = Math.abs(finalGlobal - aiGlobal) > 0.049;
  const difiereDelPonderado = Math.abs(finalGlobal - ponderado) > 0.049;
  const globalIdx = PASOS_NOTA.indexOf(finalGlobal);

  // Al cambiar la nota de un criterio, la final sigue al promedio ponderado —
  // salvo que ya se haya fijado a mano, porque entonces recalcularla por debajo
  // borraría esa decisión sin avisar.
  function handleScoreChange(id, score) {
    setAdjustment(id, 'score', score);

    const recalculada = ponderar(rubricCriteria.map(rc => {
      const adj = useGradingStore.getState().adjustments[rc.id] ?? {};
      const aiCrit = evaluation.criteria?.find(c => c.id === rc.id) ?? {};
      return { weight: rc.weight, score: rc.id === id ? score : (adj.score ?? aiCrit.score ?? 1.0) };
    }));

    if (!globalScoreManual && recalculada !== null) volverAlPonderado(recalculada);
  }

  function handleExport() {
    setExportError(null);
    try {
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
    } catch (err) {
      // Sin esto el botón no hacía nada visible y el motivo se quedaba en la
      // consola del navegador.
      console.error('[export]', err);
      setExportError(err.message ?? String(err));
    }
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
              {globalScoreManual
                ? 'Fijada a mano — ya no sigue a los criterios'
                : 'Se recalcula al cambiar la nota de cualquier criterio'}
            </div>
          </div>
          <div className={`text-4xl font-bold ${finalGlobal >= 4 ? 'text-green-300' : 'text-red-300'}`}>
            {formatoNota(finalGlobal)}
          </div>
        </div>

        {/* De dónde sale la nota. Es la aritmética que el estudiante puede
            reclamar, así que se muestra en vez de pedir que se confíe. */}
        {detalle.partes.length > 0 && (
          <div className="mb-4 text-xs bg-blue-900/40 rounded-lg px-3 py-2 space-y-1">
            {detalle.partes.map(p => (
              <div key={p.label} className="flex justify-between text-blue-100">
                <span className="truncate pr-2">
                  {p.label} · {Math.round(p.weight * 100)}%
                </span>
                <span className="font-mono shrink-0">
                  {formatoNota(p.score)} × {Math.round(p.weight * 100)}% = {p.aporte.toFixed(2).replace('.', ',')}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-blue-700 pt-1 font-semibold text-white">
              <span>Promedio ponderado</span>
              <span className="font-mono">{formatoNota(ponderado)}</span>
            </div>
          </div>
        )}

        <input
          type="range"
          min={0}
          max={PASOS_NOTA.length - 1}
          step={1}
          value={globalIdx < 0 ? PASOS_NOTA.indexOf(4.0) : globalIdx}
          onChange={e => setGlobalScore(PASOS_NOTA[parseInt(e.target.value)])}
          className="w-full h-2 rounded-lg appearance-none bg-blue-700 cursor-pointer mb-1"
        />
        <div className="flex justify-between text-[10px] text-blue-300 px-0.5">
          {[1, 2, 3, 4, 5, 6, 7].map(n => <span key={n}>{n}</span>)}
        </div>

        {tope && (
          <div className="mt-3 text-sm bg-red-500/25 border border-red-300/50 rounded-lg px-3 py-2.5">
            <div className="font-semibold text-red-100">
              Nota topada en {formatoNota(tope.notaMaxima)} — no aprueba el ramo
            </div>
            <div className="text-xs text-red-100/90 mt-1 leading-relaxed">
              {tope.detail} El promedio de los criterios da {formatoNota(elegida)}, pero la pauta
              exige al menos el 80% de las partidas con APU para aprobar.
            </div>
          </div>
        )}

        {!tope && difiereDelPonderado && (
          <div className="mt-3 flex items-center justify-between gap-3 text-xs bg-amber-400/20 border border-amber-300/40 rounded-lg px-3 py-2">
            <span className="text-amber-100">
              La nota final ({formatoNota(finalGlobal)}) no coincide con el promedio de los
              criterios ({formatoNota(ponderado)}).
            </span>
            <button
              onClick={() => volverAlPonderado(ponderado)}
              className="shrink-0 px-2.5 py-1 rounded-md font-semibold text-uvm-blue bg-white hover:bg-blue-50"
            >
              Volver a {formatoNota(ponderado)}
            </button>
          </div>
        )}

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

      {exportError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="font-semibold">No se pudo generar el PDF</div>
          <div className="text-xs mt-1 font-mono break-words">{exportError}</div>
        </div>
      )}

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
