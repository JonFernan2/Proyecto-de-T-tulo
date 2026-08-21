import React, { useEffect, useRef, useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { evaluateWithClaude } from '../lib/claudeEval.js';
import { DELIVERIES } from '../lib/rubric.js';

const MESSAGES_E1 = [
  'Leyendo Especificaciones Técnicas...',
  'Analizando Listado de Actividades...',
  'Verificando fórmulas de Cubicaciones...',
  'Revisando Cotizaciones...',
  'Evaluando coherencia técnica...',
  'Generando evaluación con IA...',
];

const MESSAGES_E2 = [
  'Leyendo Métodos Constructivos...',
  'Analizando cuadrillas y rendimientos...',
  'Verificando APU — Mano de Obra...',
  'Revisando APU — Materiales y Fletes...',
  'Analizando Equipos y Maquinarias...',
  'Generando evaluación con IA...',
];

export default function Step4_EvalLoading() {
  const { delivery, studentName, getFilesMap, getImages, setEvaluation, setEvalError, goTo, admissibility } = useGradingStore();
  const [msgIndex, setMsgIndex] = useState(0);
  const [error, setError] = useState(null);
  const started = useRef(false);
  const messages = delivery === 'E2' ? MESSAGES_E2 : MESSAGES_E1;

  // Rotate messages every 3s
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % messages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [messages.length]);

  // Call Claude
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const filesMap = getFilesMap();
    const images = getImages();

    evaluateWithClaude({ delivery, studentName, filesMap, images })
      .then(evaluation => {
        const { setAdjustment, setGlobalScore, admissibility } = useGradingStore.getState();

        // Build forceScore map from admissibility results
        const forced = {};
        for (const r of admissibility?.results ?? []) {
          if (r.forceScore !== undefined) forced[r.id] = r.forceScore;
        }

        // Initialize adjustments — apply forceScore overrides where needed
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
      })
      .catch(err => {
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

  return (
    <div className="py-20 text-center space-y-6">
      <div className="text-5xl animate-pulse">🤖</div>
      <div>
        <div className="text-lg font-bold text-slate-800 mb-1">
          Evaluando {DELIVERIES[delivery]?.label}
        </div>
        <div className="text-sm text-slate-500">Estudiante: {studentName}</div>
      </div>

      {/* Animated progress bar */}
      <div className="max-w-sm mx-auto">
        <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
          <div
            className="h-2 rounded-full bg-uvm-blue transition-all duration-1000"
            style={{ width: `${((msgIndex + 1) / messages.length) * 100}%` }}
          />
        </div>
        <div className="text-sm text-uvm-blue font-medium min-h-[1.5rem]">
          {messages[msgIndex]}
        </div>
      </div>

      <div className="text-xs text-slate-400">
        Esto puede tardar 20–60 segundos dependiendo del tamaño de los archivos.
      </div>
    </div>
  );
}
