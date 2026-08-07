import React from 'react';

export default function StepBar({ steps, current }) {
  return (
    <div className="bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-0">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <React.Fragment key={label}>
              {i > 0 && (
                <div className={`flex-1 h-0.5 ${done ? 'bg-uvm-blue' : 'bg-slate-200'}`} />
              )}
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${done ? 'bg-uvm-blue text-white' : ''}
                    ${active ? 'bg-uvm-blue text-white ring-2 ring-blue-300' : ''}
                    ${!done && !active ? 'bg-slate-200 text-slate-500' : ''}
                  `}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-[10px] mt-0.5 font-medium whitespace-nowrap ${active ? 'text-uvm-blue' : 'text-slate-400'}`}>
                  {label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
