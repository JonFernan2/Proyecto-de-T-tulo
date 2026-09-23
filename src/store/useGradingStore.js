import { create } from 'zustand';
import { construirFilesMap, extraerImagenes } from '../lib/roles.js';

const STEPS = ['setup', 'upload', 'admissibility', 'evaluating', 'results'];

export const useGradingStore = create((set, get) => ({
  // ── Navigation ───────────────────────────────────────────────────────────────
  step: 'setup',
  goTo: step => set({ step }),

  // ── Delivery + student ───────────────────────────────────────────────────────
  delivery: null,           // 'E1' | 'E2'
  studentName: '',
  setDelivery: delivery => set({ delivery }),
  setStudentName: name => set({ studentName: name }),

  // ── Files ────────────────────────────────────────────────────────────────────
  // uploadedFiles: [{ id, file, role, parsed }]
  uploadedFiles: [],

  addFiles(files) {
    set(state => {
      const existing = state.uploadedFiles;
      const next = [...existing];
      for (const f of files) {
        if (!next.find(u => u.file.name === f.file.name)) next.push(f);
      }
      return { uploadedFiles: next };
    });
  },

  removeFile(id) {
    set(state => ({ uploadedFiles: state.uploadedFiles.filter(f => f.id !== id) }));
  },

  updateFileRole(id, role) {
    set(state => ({
      uploadedFiles: state.uploadedFiles.map(f => f.id === id ? { ...f, role } : f),
    }));
  },

  setParsed(id, parsed) {
    set(state => ({
      uploadedFiles: state.uploadedFiles.map(f => f.id === id ? { ...f, parsed } : f),
    }));
  },

  // El armado del mapa vive en roles.js: la carga de a un estudiante y la del
  // curso completo deben usar exactamente la misma lógica.
  getFilesMap() {
    return construirFilesMap(
      get().uploadedFiles.map(f => ({ file: f.file, role: f.role, parsed: f.parsed })),
    );
  },

  getImages() {
    return extraerImagenes(
      get().uploadedFiles.map(f => ({ file: f.file, role: f.role, parsed: f.parsed })),
    );
  },

  // ── Admissibility ────────────────────────────────────────────────────────────
  // Revisión ya lanzada que se está retomando, en vez de empezar una nueva.
  revisionPendiente: null,

  admissibility: null,   // { passed, results }
  setAdmissibility: adm => set({ admissibility: adm }),

  // ── Evaluation ───────────────────────────────────────────────────────────────
  evaluation: null,      // raw from Claude
  evalError: null,
  setEvaluation: ev => set({ evaluation: ev, evalError: null }),
  setEvalError: e => set({ evalError: e }),

  // ── Professor adjustments ────────────────────────────────────────────────────
  // { [criterionId]: { score, observation } }
  adjustments: {},
  setAdjustment(id, field, value) {
    set(state => ({
      adjustments: {
        ...state.adjustments,
        [id]: { ...(state.adjustments[id] ?? {}), [field]: value },
      },
    }));
  },

  /**
   * Abre una evaluación ya consolidada, sin archivos cargados.
   *
   * Es lo que permite repasar el curso completo después: las revisiones quedan
   * guardadas en el servidor y se recuperan por su lote, así que ajustar notas
   * y exportar no obliga a volver a subir nada ni a pagar la revisión de nuevo.
   */
  abrirResultado({ studentName, delivery, evaluation, cobertura, admissibility }) {
    const ajustes = {};
    for (const c of evaluation.criteria ?? []) {
      ajustes[c.id] = { score: c.score, observation: '' };
    }
    set({
      step: 'results',
      delivery,
      studentName,
      uploadedFiles: [],
      admissibility: admissibility ?? null,
      revisionPendiente: null,
      evaluation: { ...evaluation, cobertura },
      evalError: null,
      adjustments: ajustes,
      globalScore: evaluation.globalScore ?? null,
      globalScoreManual: false,
      globalObservation: '',
      globalJustificationEdit: null,
    });
  },

  globalScore: null,           // professor's final global grade
  // Si el docente fija la nota final a mano, deja de seguir a los criterios:
  // recalcularla por debajo le borraría la decisión sin avisar.
  globalScoreManual: false,
  globalObservation: '',
  // La justificación global viene redactada para la nota propuesta. Si el
  // docente ajusta las notas, deja de corresponder y hay que poder corregirla:
  // sin esto el PDF puede afirmar que la entrega reprueba mientras imprime una
  // nota aprobatoria.
  globalJustificationEdit: null,
  // manual = el docente movió la nota final él mismo; automático = viene del
  // promedio ponderado de los criterios.
  setGlobalScore: (s, manual = true) => set({ globalScore: s, globalScoreManual: manual }),
  /** Devuelve la nota final al promedio de los criterios. */
  volverAlPonderado: s => set({ globalScore: s, globalScoreManual: false }),
  setGlobalObservation: o => set({ globalObservation: o }),
  setGlobalJustification: j => set({ globalJustificationEdit: j }),

  // ── Reset ────────────────────────────────────────────────────────────────────
  reset() {
    set({
      step: 'setup',
      delivery: null,
      studentName: '',
      uploadedFiles: [],
      admissibility: null,
      revisionPendiente: null,
      evaluation: null,
      evalError: null,
      adjustments: {},
      globalScore: null,
      globalScoreManual: false,
      globalObservation: '',
      globalJustificationEdit: null,
    });
  },
}));
