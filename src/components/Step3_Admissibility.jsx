import React, { useEffect, useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { runAdmissibility } from '../lib/admissibility.js';
import { generateFeedbackPDF } from '../lib/pdfExport.js';
import { adoptarRevision } from '../lib/claudeEval.js';

export default function Step3_Admissibility() {
  const {
    delivery, studentName, admissibility, setAdmissibility, goTo,
    getFilesMap, uploadedFiles,
  } = useGradingStore();

  const [recuperar, setRecuperar] = useState(false);
  const [loteId, setLoteId] = useState('');
  const [adoptando, setAdoptando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [descuadre, setDescuadre] = useState(null);

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
  const bajoUmbral = results.filter(r => r.cumpleUmbral === false);

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

  // Readoptar un lote ya lanzado: se reconstruye el contexto con estos archivos
  // y se consolida sin reenviar las tandas.
  //
  // Si los conteos no cuadran se avisa pero no se bloquea: el número de tandas
  // depende de cómo se partieron las hojas, y un lote lanzado con una versión
  // anterior puede dar otro número con los mismos archivos. Quien sabe si son
  // los del estudiante es el docente.
  async function adoptar({ aunqueNoCuadre = false } = {}) {
    setAdoptando(true);
    setAviso(null);
    try {
      const r = await adoptarRevision({
        batchId: loteId, delivery, studentName,
        filesMap: getFilesMap(), admissibility,
      });

      if (!r.coincide && !r.yaConsolidada && !aunqueNoCuadre) {
        setDescuadre(
          `El lote tiene ${r.tandasEnElLote} tanda(s) y estos archivos dan ${r.tandasSegunArchivos}. ` +
          'Puede ser que no sean los archivos con los que se lanzó —y entonces la evaluación ' +
          'describiría otra entrega— o que el lote se haya lanzado con una versión anterior, ' +
          'que partía las hojas de otra manera. Confirma que son los de este estudiante.',
        );
        setAdoptando(false);
        return;
      }

      useGradingStore.setState({
        revisionPendiente: {
          batchId: r.batchId, plan: r.plan, totalTandas: r.totalTandas, admissibility,
        },
      });
      goTo('evaluating');
    } catch (err) {
      setAviso(err.message);
      setAdoptando(false);
    }
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
              {!passed
                ? 'Falta uno o más archivos obligatorios.'
                : bajoUmbral.length > 0
                  ? `Archivos completos, pero ${bajoUmbral.map(r => r.label.split(' (')[0]).join(' y ')} está bajo la exigencia del 50%.`
                  : 'Todos los criterios cumplen la exigencia mínima del 50%.'}
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
              <span className={`text-sm font-bold ${
                !r.passed ? 'text-red-600' : r.cumpleUmbral === false ? 'text-amber-600' : 'text-green-600'
              }`}>
                {!r.passed ? '✗ FALTA' : r.cumpleUmbral === false ? '⚠ BAJO 50%' : '✓ OK'}
              </span>
            </div>
            <div className="text-sm text-slate-600">{r.detail}</div>

            {/* Progress bar if ratio available */}
            {r.ratio !== undefined && (
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span className={r.cumpleUmbral === false ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                    {Math.round(r.ratio * 100)}% alcanzado
                  </span>
                  <span className="text-slate-500">mínimo {Math.round(r.threshold * 100)}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${r.cumpleUmbral === false ? 'bg-red-400' : 'bg-green-500'}`}
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
            className="px-4 py-2.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 text-sm"
          >
            📄 Exportar rechazo
          </button>
        )}

        <button
          onClick={() => goTo('evaluating')}
          className="flex-1 py-2.5 rounded-lg font-semibold text-white bg-uvm-blue hover:bg-blue-800"
        >
          Evaluar entrega →
        </button>
      </div>

      {/* Recuperar un lote ya lanzado. Los resultados de una revisión viven 29
          días del lado de la API: si el registro se perdió, se readopta con
          estos archivos y se consolida sin reenviar ni volver a pagar. */}
      {!recuperar ? (
        <div className="text-center">
          <button
            onClick={() => setRecuperar(true)}
            className="text-xs text-slate-500 hover:text-uvm-blue underline underline-offset-2"
          >
            Esta revisión ya se lanzó antes — recuperarla con su ID de lote
          </button>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Recuperar una revisión ya lanzada</div>
            <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              Pega el identificador del lote (empieza con <span className="font-mono">msgbatch_</span>).
              Se consolida con los archivos cargados aquí, sin reenviar las tandas ni volver a
              pagarlas. El lote debe ser de los últimos 29 días.
            </div>
          </div>

          <input
            type="text"
            value={loteId}
            onChange={e => setLoteId(e.target.value)}
            placeholder="msgbatch_..."
            spellCheck={false}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-white
              focus:outline-none focus:ring-2 focus:ring-uvm-blue focus:border-transparent"
          />

          {aviso && (
            <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {aviso}
            </div>
          )}

          {descuadre && (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
              <div className="leading-relaxed">{descuadre}</div>
              <button
                onClick={() => { setDescuadre(null); adoptar({ aunqueNoCuadre: true }); }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700"
              >
                Son los de este estudiante — continuar
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => adoptar()}
              disabled={adoptando || loteId.trim().length < 10}
              className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-uvm-blue
                hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {adoptando ? 'Buscando el lote…' : 'Recuperar y consolidar'}
            </button>
            <button
              onClick={() => { setRecuperar(false); setAviso(null); setDescuadre(null); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
