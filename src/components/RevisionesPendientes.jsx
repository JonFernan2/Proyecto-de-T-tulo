import React, { useEffect, useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { listarPendientes, descartarPendiente } from '../lib/claudeEval.js';

const ESTADOS = {
  in_progress: { texto: 'en proceso', clase: 'text-blue-600' },
  ended: { texto: 'terminada — lista para consolidar', clase: 'text-green-600 font-semibold' },
  canceling: { texto: 'cancelándose', clase: 'text-slate-500' },
  'no encontrado': { texto: 'el lote ya no existe en la API', clase: 'text-red-600' },
};

/**
 * Revisiones lanzadas que quedaron sin recoger.
 *
 * El lote sigue procesándose del lado de la API aunque se cierre el navegador,
 * y ya está pagado: relanzarlas sería cobrarlas dos veces.
 */
export default function RevisionesPendientes() {
  const { setDelivery, setStudentName, goTo } = useGradingStore();
  const [pendientes, setPendientes] = useState([]);

  useEffect(() => {
    let vivo = true;
    listarPendientes()
      .then(p => { if (vivo) setPendientes(p); })
      .catch(() => { /* sin servidor no hay nada que mostrar */ });
    return () => { vivo = false; };
  }, []);

  if (!pendientes.length) return null;

  function retomar(p) {
    setDelivery(p.delivery);
    setStudentName(p.studentName);
    useGradingStore.setState({ revisionPendiente: p });
    goTo('evaluating');
  }

  async function descartar(batchId) {
    await descartarPendiente(batchId);
    setPendientes(ps => ps.filter(p => p.batchId !== batchId));
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
        Revisiones sin recoger
      </div>

      {pendientes.map(p => {
        const estado = ESTADOS[p.estado] ?? { texto: p.estado, clase: 'text-slate-500' };
        const horas = (Date.now() - p.creado) / 3_600_000;
        const cuando = horas < 1
          ? `hace ${Math.round(horas * 60)} min`
          : `hace ${horas.toFixed(1)} h`;

        return (
          <div key={p.batchId} className="bg-white border border-blue-100 rounded-lg px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">
                  {p.studentName} · {p.delivery}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Lanzada {cuando} · <span className={estado.clase}>{estado.texto}</span>
                  {p.counts && (
                    <> · {p.counts.listas} de {p.totalTandas} tandas listas
                      {p.counts.conError > 0 && ` · ${p.counts.conError} con error`}</>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {p.estado !== 'no encontrado' && (
                  <button
                    onClick={() => retomar(p)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-uvm-blue hover:bg-blue-800"
                  >
                    Retomar
                  </button>
                )}
                <button
                  onClick={() => descartar(p.batchId)}
                  className="text-xs text-slate-400 hover:text-red-600"
                  title="Descartar sin recoger"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="text-xs text-blue-700 leading-relaxed">
        Estas revisiones ya están pagadas y siguen procesándose aunque cierres la aplicación.
        Retómalas en vez de lanzarlas otra vez.
      </div>
    </div>
  );
}
