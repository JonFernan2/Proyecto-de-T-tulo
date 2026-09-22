import React from 'react';
import { useGradingStore } from '../store/useGradingStore.js';
import { DELIVERIES } from '../lib/rubric.js';
import RevisionesPendientes from './RevisionesPendientes.jsx';

export default function Step1_DeliverySetup() {
  const { delivery, setDelivery, studentName, setStudentName, goTo } = useGradingStore();
  // Basta con elegir la entrega: el nombre se detecta de la carpeta al subir los
  // archivos, y para revisar el curso completo no hay un solo estudiante que
  // nombrar.
  const canContinue = Boolean(delivery);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Nueva corrección</h2>
        <p className="text-sm text-slate-500">Selecciona la entrega y el nombre del estudiante para comenzar.</p>
      </div>

      <RevisionesPendientes />

      {/* Delivery selector */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">Seleccionar entrega</label>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(DELIVERIES).map(([key, def]) => (
            <button
              key={key}
              onClick={() => setDelivery(key)}
              className={`p-4 rounded-xl border-2 text-left transition-all
                ${delivery === key
                  ? 'border-uvm-blue bg-blue-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
            >
              <div className="font-bold text-uvm-blue text-lg">{key}</div>
              <div className="font-semibold text-slate-800 text-sm">{def.label}</div>
              <div className="text-xs text-slate-500 mt-1">{def.subtitle}</div>
              <div className="text-xs text-slate-400 mt-2">Fecha límite: {def.dueDate}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Student name */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Nombre del estudiante <span className="font-normal text-slate-400">(opcional)</span>
        </label>
        <input
          type="text"
          value={studentName}
          onChange={e => setStudentName(e.target.value)}
          placeholder="Apellido Nombre (se detecta automáticamente del primer archivo)"
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-uvm-blue focus:border-transparent"
        />
        <p className="text-xs text-slate-400 mt-1">
          Se detecta solo del nombre de la carpeta al subir los archivos. Déjalo en blanco
          si vas a seleccionar la carpeta del curso completo.
        </p>
      </div>

      {/* Rubric preview */}
      {delivery && (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">
            Rúbrica de evaluación — {DELIVERIES[delivery].label}
          </div>
          <div className="space-y-2">
            {DELIVERIES[delivery].criteria.map(c => (
              <div key={c.id} className="flex items-start gap-3">
                <div className="w-10 text-right">
                  <span className="text-xs font-bold text-uvm-blue bg-blue-100 px-1.5 py-0.5 rounded">
                    {Math.round(c.weight * 100)}%
                  </span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-800">{c.label}</div>
                  <div className="text-xs text-slate-500">{c.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        disabled={!canContinue}
        onClick={() => goTo('upload')}
        className="w-full py-3 rounded-xl font-semibold text-white transition-colors
          bg-uvm-blue hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
      >
        Continuar → Subir archivos
      </button>
    </div>
  );
}
