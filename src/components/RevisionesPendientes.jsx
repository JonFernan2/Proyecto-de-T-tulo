import React, { useEffect, useState } from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { listarPendientes, descartarPendiente, cargarResultado } from '../lib/claudeEval.js';

const ESTADOS = {
  in_progress: { texto: 'en proceso', clase: 'text-blue-600' },
  ended: { texto: 'terminada — lista para consolidar', clase: 'text-green-600 font-semibold' },
  canceling: { texto: 'cancelándose', clase: 'text-slate-500' },
  'no encontrado': { texto: 'el lote ya no existe en la API', clase: 'text-red-600' },
};

/**
 * Las revisiones que viven en el servidor: las lanzadas y aún sin recoger, y
 * las ya consolidadas.
 *
 * Un lote sigue procesándose del lado de la API aunque se cierre el navegador,
 * y ya está pagado: relanzarlo sería cobrarlo dos veces. Las consolidadas se
 * conservan con su evaluación, así que el curso completo puede repasarse,
 * ajustarse y exportarse después sin volver a correr nada.
 */
export default function RevisionesPendientes() {
  const { setDelivery, setStudentName, goTo, abrirResultado } = useGradingStore();
  const [revisiones, setRevisiones] = useState([]);
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    listarPendientes()
      .then(p => { if (vivo) setRevisiones(p); })
      .catch(() => { /* sin servidor no hay nada que mostrar */ });
    return () => { vivo = false; };
  }, []);

  if (!revisiones.length) return null;

  const completadas = revisiones.filter(r => r.estado === 'completada');
  const pendientes = revisiones.filter(r => r.estado !== 'completada');

  function retomar(p) {
    setDelivery(p.delivery);
    setStudentName(p.studentName);
    useGradingStore.setState({ revisionPendiente: p });
    goTo('evaluating');
  }

  async function abrir(batchId) {
    setAbriendo(batchId);
    setError(null);
    try {
      const r = await cargarResultado(batchId);
      abrirResultado(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setAbriendo(null);
    }
  }

  async function descartar(batchId) {
    await descartarPendiente(batchId);
    setRevisiones(rs => rs.filter(r => r.batchId !== batchId));
  }

  return (
    <div className="space-y-4">
      {/* ── Ya revisadas ────────────────────────────────────────────────────── */}
      {completadas.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Revisiones terminadas
            </div>
            <div className="text-xs text-slate-400">
              {completadas.length} estudiante(s) · promedio {promedio(completadas)}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {completadas.map(r => (
              <div
                key={r.batchId}
                className="flex items-center gap-3 border border-slate-100 rounded-lg px-3 py-2"
              >
                <NotaChip nota={r.nota} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {r.studentName}
                  </div>
                  <div className="text-xs text-slate-400">
                    {r.delivery} · {cuando(r.completado ?? r.creado)}
                    {r.cobertura?.hojas != null && (
                      <> · {r.cobertura.hojas} hojas revisadas</>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => abrir(r.batchId)}
                  disabled={abriendo === r.batchId}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-uvm-blue
                    border border-uvm-blue hover:bg-blue-50 disabled:opacity-50 shrink-0"
                >
                  {abriendo === r.batchId ? 'Abriendo…' : 'Abrir'}
                </button>
                <button
                  onClick={() => descartar(r.batchId)}
                  className="text-xs text-slate-300 hover:text-red-600 shrink-0"
                  title="Eliminar esta revisión"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="text-xs text-slate-500 leading-relaxed">
            Abrir una revisión terminada no vuelve a correrla ni cuesta nada: se recupera
            tal cual quedó, para ajustar notas y exportar el informe.
          </div>
        </div>
      )}

      {/* ── Lanzadas, aún sin recoger ───────────────────────────────────────── */}
      {pendientes.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Revisiones sin recoger
          </div>

          {pendientes.map(p => {
            const estado = ESTADOS[p.estado] ?? { texto: p.estado, clase: 'text-slate-500' };

            return (
              <div key={p.batchId} className="bg-white border border-blue-100 rounded-lg px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">
                      {p.studentName} · {p.delivery}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Lanzada {cuando(p.creado)} · <span className={estado.clase}>{estado.texto}</span>
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
      )}
    </div>
  );
}

function NotaChip({ nota }) {
  if (nota == null) return <span className="w-9 shrink-0 text-center text-xs text-slate-300">—</span>;
  const aprueba = nota >= 4;
  return (
    <span
      className={`w-9 shrink-0 text-center text-sm font-bold rounded px-1 py-0.5 ${
        aprueba ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
      }`}
    >
      {nota.toFixed(1).replace('.', ',')}
    </span>
  );
}

function promedio(revs) {
  const notas = revs.map(r => r.nota).filter(n => typeof n === 'number');
  if (!notas.length) return '—';
  const p = notas.reduce((a, b) => a + b, 0) / notas.length;
  return p.toFixed(1).replace('.', ',');
}

function cuando(ts) {
  const horas = (Date.now() - (ts ?? Date.now())) / 3_600_000;
  if (horas < 1) return `hace ${Math.max(0, Math.round(horas * 60))} min`;
  if (horas < 24) return `hace ${horas.toFixed(1)} h`;
  return `hace ${Math.round(horas / 24)} día(s)`;
}
