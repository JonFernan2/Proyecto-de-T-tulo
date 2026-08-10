import React from 'react';
import { useGradingStore } from '../store/useGradingStore.js';

export default function Header() {
  const reset = useGradingStore(s => s.reset);
  const step = useGradingStore(s => s.step);

  return (
    <header className="bg-uvm-blue text-white shadow-md">
      <div className="w-full px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <div className="text-[10px] font-semibold text-blue-200 uppercase tracking-widest">
              Universidad Viña del Mar · Ingeniería en Construcción
            </div>
            <div className="text-base font-bold leading-tight">
              Corrector IA — Formulación de Proyecto de Título
            </div>
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
