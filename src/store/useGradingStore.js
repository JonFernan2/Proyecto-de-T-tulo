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

  // Build filesMap: { eett, cubicaciones, cotizaciones, cotizacionesFiles, apu, ... }
  //
  // Files of the same role are picked by CONTENT, not by upload order: a role
  // holding a PDF plus an Excel must still surface the Excel as the sheet
  // source, otherwise admissibility wrongly reports the file as missing.
  getFilesMap() {
    const files = get().uploadedFiles;
    const ext = f => f.file.name.split('.').pop().toLowerCase();

    const ofRole = role => files.filter(f => f.role === role);
    const excelOf = role => ofRole(role).find(f => f.parsed?.sheets?.length)?.parsed ?? null;
    const textOf = role => ofRole(role).find(f => f.parsed?.text !== undefined)?.parsed ?? null;
    const namesOf = (role, exts) =>
      ofRole(role).filter(f => exts.includes(ext(f))).map(f => f.file.name);

    // Cotizaciones may arrive as Excel, Word, or a pile of PDFs — keep all three.
    const cotEntries = ofRole('cotizaciones').map(f => ({
      name: f.file.name,
      ext: ext(f),
      parsed: f.parsed,
    }));

    return {
      eett: excelOf('eett') ?? textOf('eett'),
      eettName: ofRole('eett')[0]?.file.name ?? null,

      cubicaciones: excelOf('cubicaciones'),
      cubicacionesName: ofRole('cubicaciones')[0]?.file.name ?? null,

      cotizaciones: excelOf('cotizaciones'),
      cotizacionesFiles: cotEntries,
      cotizacionesPdfNames: namesOf('cotizaciones', ['pdf']),

      apu: excelOf('apu'),

      respaldoPdfNames: [
        ...namesOf('respaldo', ['pdf']),
        ...namesOf('cotizaciones', ['pdf']),
      ],
      imageCount: ofRole('imagen').length,
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
