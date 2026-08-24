import React, { useEffect, useRef, useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { evaluateWithClaude, verifyImages } from '../lib/claudeEval.js';
import { DELIVERIES } from '../lib/rubric.js';

const PHASES = {
  text: 'text',
  images: 'images',
};

export default function Step4_EvalLoading() {
  const { delivery, studentName, getFilesMap, getImages, setEvaluation, setEvalError, goTo } = useGradingStore();
  const [phase, setPhase] = useState(PHASES.text);
  const [imageBatch, setImageBatch] = useState({ current: 0, total: 0 });
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const filesMap = getFilesMap();
    const images = getImages();

    async function run() {
      // ── Fase 1: Evaluación de texto ─────────────────────────────────────────
      setPhase(PHASES.text);
      const { admissibility } = useGradingStore.getState();
      const evaluation = await evaluateWithClaude({ delivery, studentName, filesMap, admissibility });

      // ── Fase 2: Verificación fotográfica (si hay imágenes) ──────────────────
      if (images?.length > 0) {
        setPhase(PHASES.images);
        setImageBatch({ current: 0, total: Math.ceil(images.length / 15) });

        const imageResult = await verifyImages({
          studentName,
          cubicaciones: filesMap.cubicaciones ?? null,
          images,
          onProgress: (batchIndex, totalBatches) => {
            setImageBatch({ current: batchIndex + 1, total: totalBatches });
          },
        });

        // Fusionar hallazgos fotográficos en criterio cubicaciones/materiales
        if (imageResult?.findings) {
          const cubId = delivery === 'E1' ? 'cubicaciones' : 'materiales';
          const crit = evaluation.criteria?.find(c => c.id === cubId);
          if (crit) {
            crit.justification =
              crit.justification +
              `\n\nRESPALDO FOTOGRÁFICO (${imageResult.totalImages} imágenes revisadas): ` +
              imageResult.findings;
          }
          if (imageResult.totalErrors > 0) {
            evaluation.globalJustification =
              (evaluation.globalJustification ?? '') +
              ` Se detectaron ${imageResult.totalErrors} inconsistencia(s) entre el respaldo fotográfico y las fórmulas de cubicaciones.`;
          }
        }
      }

      // ── Aplicar ajustes de admisibilidad y pasar a resultados ───────────────
      const { setAdjustment, setGlobalScore } = useGradingStore.getState();

      const forced = {};
      for (const r of admissibility?.results ?? []) {
        if (r.forceScore !== undefined) forced[r.id] = r.forceScore;
      }

      for (const c of evaluation.criteria ?? []) {
        const score = forced[c.id] !== undefined ? forced[c.id] : c.score;
        const obs = forced[c.id] !== undefined
          ? 'Formato incorrecto según la pauta. Nota mínima aplicada automáticamente.'
          : '';
        setAdjustment(c.id, 'score', score);
        setAdjustment(c.id, 'observation', obs);
      }

      setGlobalScore(evaluation.globalScore);
      setEvaluation(evaluation);
      goTo('results');
    }

    run().catch(err => {
      setError(err.message);
      setEvalError(err.message);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="py-20 text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <div className="text-lg font-semibold text-red-700">Error al conectar con la IA</div>
        <div className="text-sm text-slate-600 max-w-md mx-auto">{error}</div>
        <div className="text-xs text-slate-400">
          Verifica que el servidor esté corriendo y que la clave ANTHROPIC_API_KEY esté configurada en .env
        </div>
        <button
          onClick={() => goTo('admissibility')}
          className="px-6 py-2 bg-uvm-blue text-white rounded-lg text-sm font-medium hover:bg-blue-800"
        >
          ← Volver
        </button>
      </div>
    );
  }

  const isImagePhase = phase === PHASES.images;

  return (
    <div className="py-16 text-center space-y-6">
      <div className="text-5xl animate-pulse">{isImagePhase ? '🖼️' : '📋'}</div>

      <div>
        <div className="text-lg font-bold text-slate-800 mb-1">
          {isImagePhase ? 'Verificando respaldo fotográfico' : `Evaluando ${DELIVERIES[delivery]?.label}`}
        </div>
        <div className="text-sm text-slate-500">Estudiante: {studentName}</div>
      </div>

      {/* Progress */}
      <div className="max-w-sm mx-auto space-y-3">
        {/* Fase 1 */}
        <div className="flex items-center gap-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
            ${!isImagePhase ? 'bg-uvm-blue text-white animate-pulse' : 'bg-green-500 text-white'}`}>
            {isImagePhase ? '✓' : '1'}
          </div>
          <div className="flex-1 text-left">
            <div className={`text-sm font-medium ${isImagePhase ? 'text-green-600' : 'text-uvm-blue'}`}>
              Evaluación de documentos (texto + Excel)
            </div>
            {!isImagePhase && (
              <div className="text-xs text-slate-400">EETT · Listado · Cubicaciones · Cotizaciones</div>
            )}
          </div>
        </div>

        {/* Fase 2 */}
        <div className="flex items-center gap-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
            ${isImagePhase ? 'bg-uvm-blue text-white animate-pulse' : 'bg-slate-200 text-slate-400'}`}>
            2
          </div>
          <div className="flex-1 text-left">
            <div className={`text-sm font-medium ${isImagePhase ? 'text-uvm-blue' : 'text-slate-400'}`}>
              Verificación de respaldo fotográfico
            </div>
            {isImagePhase && imageBatch.total > 0 && (
              <div className="text-xs text-slate-500">
                Revisando tanda {imageBatch.current} de {imageBatch.total}
                {' '}({imageBatch.total * 15} imágenes aprox.)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bar */}
      <div className="max-w-sm mx-auto">
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-uvm-blue transition-all duration-700"
            style={{ width: isImagePhase
              ? `${50 + (imageBatch.total > 0 ? (imageBatch.current / imageBatch.total) * 50 : 25)}%`
              : '45%' }}
          />
        </div>
      </div>

      <div className="text-xs text-slate-400">
        {isImagePhase
          ? 'Verificando coherencia entre respaldo fotográfico y fórmulas Excel...'
          : 'Analizando documentos — esto puede tardar 30–60 segundos'}
      </div>
    </div>
  );
}
