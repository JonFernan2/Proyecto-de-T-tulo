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

  // Build filesMap: { eett, listado, cubicaciones, cotizaciones, ... }
  //
  // Dos reglas que importan:
  //  - Los archivos de un rol se eligen por CONTENIDO, no por orden de subida:
  //    un rol con un PDF y un Excel debe exponer el Excel como fuente de hojas.
  //  - Varios Excel en el mismo rol se FUSIONAN. Un estudiante puede partir sus
  //    cubicaciones en dos libros, y quedarse con el primero perdería el resto.
  getFilesMap() {
    const files = get().uploadedFiles;
    const ext = f => f.file.name.split('.').pop().toLowerCase();
    const ofRole = role => files.filter(f => f.role === role);

    const mergeExcel = role => {
      const libros = ofRole(role).filter(f => f.parsed?.sheets?.length);
      if (!libros.length) return null;
      if (libros.length === 1) return libros[0].parsed;

      // Al fusionar se antepone el nombre del libro a cada hoja, para que en la
      // revisión se sepa de cuál viene cada una.
      return {
        sheets: libros.flatMap(f => {
          const libro = f.file.name.replace(/\.[^.]+$/, '');
          return f.parsed.sheets.map(s => ({ ...s, name: `${libro} › ${s.name}` }));
        }),
        totalRows: libros.reduce((sum, f) => sum + (f.parsed.totalRows ?? 0), 0),
        fuentes: libros.map(f => f.file.name),
      };
    };

    const textOf = role => ofRole(role).find(f => f.parsed?.text !== undefined)?.parsed ?? null;
    const namesOf = (role, exts) =>
      ofRole(role).filter(f => exts.includes(ext(f))).map(f => f.file.name);

    const cotEntries = ofRole('cotizaciones').map(f => ({
      name: f.file.name,
      ext: ext(f),
      parsed: f.parsed,
    }));

    return {
      eett: mergeExcel('eett') ?? textOf('eett'),
      eettName: ofRole('eett')[0]?.file.name ?? null,

      // El listado puede venir como archivo aparte o dentro del libro de
      // cubicaciones; si no hay archivo propio, queda null y se busca adentro.
      listado: mergeExcel('listado'),
      listadoName: ofRole('listado')[0]?.file.name ?? null,

      cubicaciones: mergeExcel('cubicaciones'),
      cubicacionesName: ofRole('cubicaciones').map(f => f.file.name).join(' + ') || null,

      cotizaciones: mergeExcel('cotizaciones'),
      cotizacionesFiles: cotEntries,
      cotizacionesPdfNames: namesOf('cotizaciones', ['pdf']),

      // Los PDF de respaldo traen proveedor, precio y año: se cotejan contra la
      // planilla. Se concatenan las páginas de todos, anotando de qué archivo
      // viene cada una para poder citarlo.
      respaldoPdfs: [...ofRole('respaldo'), ...ofRole('cotizaciones')]
        .filter(f => ext(f) === 'pdf' && f.parsed?.pages)
        .map(f => ({
          name: f.file.name,
          pages: f.parsed.pages,
          numPages: f.parsed.numPages,
          escaneado: f.parsed.escaneado,
          paginasConTexto: f.parsed.paginasConTexto,
        })),

      apu: mergeExcel('apu'),

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
  // La justificación global viene redactada para la nota propuesta. Si el
  // docente ajusta las notas, deja de corresponder y hay que poder corregirla:
  // sin esto el PDF puede afirmar que la entrega reprueba mientras imprime una
  // nota aprobatoria.
  globalJustificationEdit: null,
  setGlobalScore: s => set({ globalScore: s }),
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
      evaluation: null,
      evalError: null,
      adjustments: {},
      globalScore: null,
      globalObservation: '',
      globalJustificationEdit: null,
    });
  },
}));
