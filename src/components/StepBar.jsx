import React from 'react';

export default function StepBar({ steps, current }) {
  return (
    <nav className="bg-[#0d1c30] border-b border-blue-900 shadow-sm">
      <div className="w-full px-6 flex items-stretch">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <React.Fragment key={label}>
              {i > 0 && (
                <span className="self-center text-blue-700 select-none px-0.5">|</span>
              )}
              <div
                className={`relative flex items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-colors
                  ${active ? 'text-white border-b-2 border-uvm-gold' : ''}
                  ${done ? 'text-blue-300' : ''}
                  ${!done && !active ? 'text-blue-500' : ''}
                `}
              >
                {done && (
                  <span className="text-uvm-gold text-[11px] font-bold">✓</span>
                )}
                {!done && (
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold
                      ${active ? 'bg-uvm-gold text-[#0d1c30]' : 'bg-blue-800 text-blue-400'}
                    `}
                  >
                    {i + 1}
                  </span>
                )}
                {label}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
