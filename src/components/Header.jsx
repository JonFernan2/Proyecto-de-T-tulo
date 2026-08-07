import React from 'react';
import { useGradingStore } from '../store/useGradingStore.js';

export default function Header() {
  const reset = useGradingStore(s => s.reset);
  const step = useGradingStore(s => s.step);

  return (
    <header className="bg-uvm-blue text-white shadow-md">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-blue-200 uppercase tracking-widest">
            Universidad Viña del Mar · Ingeniería en Construcción
          </div>
          <div className="text-base font-bold leading-tight">
            Corrector IA — Formulación de Proyecto de Título
          </div>
        </div>
        {step !== 'setup' && (
          <button
            onClick={reset}
            className="text-xs text-blue-200 hover:text-white border border-blue-400 hover:border-white rounded px-3 py-1 transition-colors"
          >
            Nueva corrección
          </button>
        )}
      </div>
    </header>
  );
}
