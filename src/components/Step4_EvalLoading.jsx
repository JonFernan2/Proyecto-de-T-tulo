import React, { useEffect, useRef, useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { deepReview, resumeDeepReview, verifyImages } from '../lib/claudeEval.js';
import { DELIVERIES } from '../lib/rubric.js';

const ETIQUETAS = {
  cub: 'Cubicaciones',
  cot: 'Cotizaciones',
  apu: 'Cartillas APU',
  pdf: 'Respaldo PDF de cotizaciones',
};

export default function Step4_EvalLoading() {
  const { delivery, studentName, getFilesMap, getImages, setEvaluation, setEvalError, goTo } = useGradingStore();
  const [progress, setProgress] = useState({ fase: 'enviando' });
  const [imageBatch, setImageBatch] = useState(null);
  const [error, setError] = useState(null);
  const started = useRef(false);
  const cancelado = useRef(false);

  // Reloj propio: el Batch API puede pasar minutos sin mover el contador de
  // tandas, y sin nada que cambie en pantalla la revisión parece colgada.
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSegundos(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const filesMap = getFilesMap();
    const images = getImages();

    async function run() {
      const { admissibility, revisionPendiente } = useGradingStore.getState();

      // ── Revisión profunda hoja por hoja ─────────────────────────────────────
      // Si se está retomando una ya lanzada, no se vuelve a enviar: el lote
      // sigue procesándose del lado de la API y ya está pagado.
      const { evaluation, cobertura } = revisionPendiente
        ? await resumeDeepReview({
            batchId: revisionPendiente.batchId,
            plan: revisionPendiente.plan,
            totalTandas: revisionPendiente.totalTandas,
            onProgress: setProgress,
            shouldCancel: () => cancelado.current,
          })
        : await deepReview({
            delivery, studentName, filesMap, admissibility,
            onProgress: setProgress,
            shouldCancel: () => cancelado.current,
          });

      evaluation.cobertura = cobertura;

      // ── Respaldo fotográfico ────────────────────────────────────────────────
      if (images?.length > 0) {
        setProgress({ fase: 'imagenes' });
        setImageBatch({ current: 0, total: Math.ceil(images.length / 15) });

        const imageResult = await verifyImages({
          studentName,
          cubicaciones: filesMap.cubicaciones ?? null,
          images,
          onProgress: (i, total) => setImageBatch({ current: i + 1, total }),
        });

        if (imageResult?.findings) {
          const cubId = delivery === 'E1' ? 'cubicaciones' : 'materiales';
          const crit = evaluation.criteria?.find(c => c.id === cubId);
          if (crit) {
            crit.justification += `\n\nRESPALDO FOTOGRÁFICO (${imageResult.totalImages} imágenes revisadas): ${imageResult.findings}`;
          }
          if (imageResult.totalErrors > 0) {
            evaluation.globalJustification =
              (evaluation.globalJustification ?? '') +
              ` Se detectan ${imageResult.totalErrors} inconsistencia(s) entre el respaldo fotográfico y las fórmulas de cubicaciones.`;
          }
        }
      }

      // ── Ajustes de admisibilidad ────────────────────────────────────────────
      const { setAdjustment, setGlobalScore } = useGradingStore.getState();
      const forced = {};
      for (const r of admissibility?.results ?? []) {
        if (r.forceScore !== undefined) forced[r.id] = r.forceScore;
      }
      for (const c of evaluation.criteria ?? []) {
        const score = forced[c.id] !== undefined ? forced[c.id] : c.score;
        setAdjustment(c.id, 'score', score);
        setAdjustment(c.id, 'observation',
          forced[c.id] !== undefined
            ? 'Formato incorrecto según la pauta. Nota mínima aplicada automáticamente.'
            : '');
      }

      setGlobalScore(evaluation.globalScore);
      setEvaluation(evaluation);
      goTo('results');
    }

    run().catch(err => {
      if (err.message === 'CANCELADO') return;   // salida voluntaria, no es falla
      setError(err.message);
      setEvalError(err.message);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="py-20 text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <div className="text-lg font-semibold text-red-700">No se pudo completar la revisión</div>
        <div className="text-sm text-slate-600 max-w-md mx-auto">{error}</div>
        <button
          onClick={() => goTo('admissibility')}
          className="px-6 py-2 bg-uvm-blue text-white rounded-lg text-sm font-medium hover:bg-blue-800"
        >
          ← Volver
        </button>
      </div>
    );
  }

  const { fase, plan, counts, totalTandas } = progress;
  const listas = counts?.listas ?? 0;
  const pctTandas = totalTandas ? (listas / totalTandas) * 100 : 0;

  return (
    <div className="py-12 space-y-6 max-w-lg mx-auto">
      <div className="text-center">
        <div className="text-5xl animate-pulse mb-3">
          {fase === 'imagenes' ? '🖼️' : fase === 'consolidando' ? '📝' : '🔍'}
        </div>
        <div className="text-lg font-bold text-slate-800">
          Revisión detallada · {DELIVERIES[delivery]?.label}
        </div>
        <div className="text-sm text-slate-500">{studentName}</div>
      </div>

      {/* Plan de revisión */}
      {plan?.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Alcance de esta revisión
          </div>
          <div className="space-y-1">
            {plan.filter(p => p.kind !== 'pdf-escaneado').map(p => (
              <div key={p.kind} className="flex justify-between text-sm">
                <span className="text-slate-700">{ETIQUETAS[p.kind] ?? p.kind}</span>
                <span className="text-slate-500">
                  {p.sheets} {p.kind === 'pdf' ? 'páginas' : 'hojas'} · {p.batches} tandas
                  {p.conImagenes > 0 && (
                    <span className="text-uvm-blue"> · {p.conImagenes} con respaldo</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {plan.filter(p => p.kind === 'pdf-escaneado').map(p => (
            <div key="esc" className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {p.sheets} página(s) de respaldo vienen escaneadas, sin texto legible
              ({p.archivos?.join(', ')}). No se pueden leer automáticamente y quedan
              pendientes de revisión visual — no se contarán como cotizaciones faltantes.
            </div>
          ))}
          {!plan.some(p => p.kind === 'cub') && (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No se detectaron hojas de cubicaciones. Revisa que el Excel correcto esté
              asignado al rol «Listado + Cubicaciones» en el paso de archivos.
            </div>
          )}
        </div>
      )}

      {/* Fases */}
      <div className="space-y-3">
        <Fase n="1" activa={fase === 'enviando'} lista={fase !== 'enviando'}
              titulo="Preparando las tandas"
              detalle="Partiendo los libros y enviándolos a revisión" />

        <Fase n="2" activa={fase === 'revisando'} lista={['consolidando', 'imagenes'].includes(fase)}
              titulo="Revisando hoja por hoja"
              detalle={counts
                ? `${listas} de ${totalTandas} tandas listas${counts.conError ? ` · ${counts.conError} con error` : ''}`
                : 'Verificando aritmética y referencias cruzadas'} />

        {fase === 'revisando' && (
          <div className="ml-9">
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div className="h-2 rounded-full bg-uvm-blue transition-all duration-700"
                   style={{ width: `${pctTandas}%` }} />
            </div>
          </div>
        )}

        <Fase n="3" activa={fase === 'imagenes'} lista={fase === 'consolidando'}
              titulo="Respaldo fotográfico"
              detalle={imageBatch
                ? `Tanda ${imageBatch.current} de ${imageBatch.total}`
                : 'Comparando cálculos manuales con el Excel'} />

        <Fase n="4" activa={fase === 'consolidando'} lista={false}
              titulo="Redactando la retroalimentación"
              detalle="Notas por criterio y cuadro resumen" />
      </div>

      <div className="text-xs text-slate-400 text-center leading-relaxed space-y-1">
        <div>
          Tiempo transcurrido: <span className="font-mono text-slate-600">{formatoReloj(segundos)}</span>
          {progress.ultimaConsulta && (
            <> · consultado hace {Math.max(0, Math.round((Date.now() - progress.ultimaConsulta) / 1000))}s</>
          )}
        </div>
        <div>
          La revisión completa tarda varios minutos porque se lee cada hoja del libro,
          no una muestra. Puedes dejar esta pestaña abierta y volver después.
        </div>
        {progress.batchId && (
          <div className="font-mono text-[10px] text-slate-300">
            lote {progress.batchId}
          </div>
        )}
      </div>

      <div className="text-center">
        <button
          onClick={() => { cancelado.current = true; goTo('admissibility'); }}
          className="text-xs text-slate-500 hover:text-red-600 underline underline-offset-2"
        >
          Cancelar revisión y volver
        </button>
      </div>
    </div>
  );
}

function formatoReloj(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function Fase({ n, activa, lista, titulo, detalle }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
        ${lista ? 'bg-green-500 text-white'
          : activa ? 'bg-uvm-blue text-white animate-pulse'
          : 'bg-slate-200 text-slate-400'}`}>
        {lista ? '✓' : n}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-medium ${
          lista ? 'text-green-600' : activa ? 'text-uvm-blue' : 'text-slate-400'
        }`}>
          {titulo}
        </div>
        {activa && <div className="text-xs text-slate-500 mt-0.5">{detalle}</div>}
      </div>
    </div>
  );
}
