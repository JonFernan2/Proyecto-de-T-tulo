import React from 'react';

/**
 * Atrapa los errores de render para que la pantalla no quede en blanco.
 *
 * Una corrección terminada vale dinero y trabajo: si algo falla al mostrarla,
 * el docente tiene que poder ver el motivo y, sobre todo, que sus datos siguen
 * ahí. Sin esto, un fallo en cualquier punto del árbol deja la página vacía y
 * sin ninguna pista, ni para él ni para diagnosticarlo.
 */
export default class LimiteDeError extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, pila: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[render]', error, info?.componentStack);
    this.setState({ pila: info?.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, pila } = this.state;
    const detalle = [error?.message ?? String(error), pila].filter(Boolean).join('\n');

    return (
      <div className="max-w-3xl mx-auto my-8 bg-red-50 border-2 border-red-300 rounded-xl p-5 space-y-4">
        <div>
          <div className="text-lg font-bold text-red-800">No se pudo mostrar esta pantalla</div>
          <div className="text-sm text-red-900 mt-1 leading-relaxed">
            La revisión no se ha perdido: sigue guardada en el servidor y se puede volver
            a abrir. Lo que falló es la pantalla, no los datos.
          </div>
        </div>

        <pre className="text-xs bg-white border border-red-200 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap text-red-900">
          {detalle}
        </pre>

        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ error: null, pila: null })}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-uvm-blue hover:bg-blue-800"
          >
            Reintentar
          </button>
          <button
            onClick={() => navigator.clipboard?.writeText(detalle)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
          >
            Copiar el detalle
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }
}
