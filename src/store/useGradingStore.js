import { create } from 'zustand';

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

  // Build filesMap: { eett, cubicaciones, cotizaciones, cotizacionesFiles, apu, respaldoPdfNames }
  getFilesMap() {
    const files = get().uploadedFiles;
    const byRole = role => files.find(f => f.role === role)?.parsed ?? null;
    const allByRole = role => files.filter(f => f.role === role).map(f => ({ parsed: f.parsed, name: f.file.name }));
    const pdfNames = files.filter(f => f.role === 'respaldo').map(f => f.file.name);
    return {
      eett: byRole('eett'),
      cubicaciones: byRole('cubicaciones'),
      cotizaciones: byRole('cotizaciones'),
      cotizacionesFiles: allByRole('cotizaciones'),
      apu: byRole('apu'),
      respaldoPdfNames: pdfNames,
    };
  },

  getImages() {
    return get().uploadedFiles
      .filter(f => f.role === 'imagen')
      .map(f => f.parsed)
      .filter(Boolean);
  },

  // ── Admissibility ────────────────────────────────────────────────────────────
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

  globalScore: null,           // professor's final global grade
  globalObservation: '',
  setGlobalScore: s => set({ globalScore: s }),
  setGlobalObservation: o => set({ globalObservation: o }),

  // ── Reset ────────────────────────────────────────────────────────────────────
  reset() {
    set({
      step: 'setup',
      delivery: null,
      studentName: '',
      uploadedFiles: [],
      admissibility: null,
      evaluation: null,
      evalError: null,
      adjustments: {},
      globalScore: null,
      globalObservation: '',
    });
  },
}));
