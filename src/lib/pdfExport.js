import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const BLUE = [30, 58, 95];     // UVM blue
const GOLD = [200, 169, 81];   // UVM gold
const WHITE = [255, 255, 255];
const LIGHT_GRAY = [245, 245, 245];
const DARK_GRAY = [60, 60, 60];

const ESTADO_COLORS = {
  'Cumple': [22, 163, 74],
  'Parcial': [202, 138, 4],
  'No cumple': [220, 38, 38],
  'No verificable': [100, 116, 139],
};

function gradeColor(score) {
  if (score < 4.0) return [220, 38, 38];    // red
  if (score < 4.5) return [245, 158, 11];   // amber
  if (score < 6.0) return [202, 138, 4];    // yellow-600
  return [22, 163, 74];                      // green
}

export function generateFeedbackPDF({ delivery, studentName, admissibility, criteria, globalScore, globalJustification, globalObservation, resumen = [], fortalezas = [], mejoras = [] }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 0;

  // ── Header ───────────────────────────────────────────────────────────────────
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, W, 28, 'F');

  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.text('UNIVERSIDAD VIÑA DEL MAR', 14, 10);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Ingeniería en Construcción  ·  Formulación de Proyecto de Título', 14, 16);
  doc.text('Jonathan Fernando Muñoz Alvarez  ·  Docente', 14, 21);

  y = 34;

  // ── Student info ─────────────────────────────────────────────────────────────
  doc.setFillColor(...LIGHT_GRAY);
  doc.rect(14, y, W - 28, 18, 'F');
  doc.setTextColor(...DARK_GRAY);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Estudiante: ${studentName}`, 18, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const delivLabel = delivery === 'E1' ? 'Entrega 1' : 'Entrega 2';
  doc.text(`${delivLabel}`, 18, y + 12);
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, W - 50, y + 6);

  // Admisibilidad: una revisión reabierta o retomada puede no traerla, y en ese
  // caso no se inventa un veredicto — se omite el sello y se dice por qué.
  const admResults = admissibility?.results ?? [];
  if (typeof admissibility?.passed === 'boolean') {
    const admBadgeColor = admissibility.passed ? [22, 163, 74] : [220, 38, 38];
    const admLabel = admissibility.passed ? 'ADMISIBLE' : 'INADMISIBLE';
    doc.setFillColor(...admBadgeColor);
    doc.roundedRect(W - 65, y + 9, 30, 6, 2, 2, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(admLabel, W - 50, y + 13.5, { align: 'center' });
  }

  y += 24;

  // ── Admissibility detail ─────────────────────────────────────────────────────
  doc.setTextColor(...DARK_GRAY);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Verificación de Admisibilidad', 14, y);
  y += 4;

  if (!admResults.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text(
      'No se registró la verificación de admisibilidad de esta entrega.',
      14, y + 4,
    );
    y += 12;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Criterio', 'Resultado', 'Detalle']],
      body: admResults.map(r => [
        r.label,
        // Sin veredicto guardado se deja en blanco: marcar FALLA por defecto
        // imprimiría en el informe del estudiante algo que no se verificó.
        typeof r.passed === 'boolean' ? (r.passed ? '✓ OK' : '✗ FALLA') : '—',
        r.detail,
      ]),
      theme: 'grid',
      headStyles: { fillColor: BLUE, textColor: WHITE, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 20, halign: 'center' },
        2: { cellWidth: 'auto' },
      },
      didParseCell(data) {
        if (data.column.index === 1 && data.section === 'body') {
          const texto = data.cell.text[0] ?? '';
          if (texto === '—') { data.cell.styles.textColor = [150, 150, 150]; return; }
          data.cell.styles.textColor = texto.startsWith('✓') ? [22, 163, 74] : [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Cuadro resumen de la revisión ────────────────────────────────────────────
  if (resumen.length) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK_GRAY);
    doc.text('Cuadro Resumen de la Revisión', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Aspecto revisado', 'Hallazgo', 'Estado']],
      body: resumen.map(r => [r.aspecto, r.hallazgo, r.estado]),
      theme: 'grid',
      headStyles: { fillColor: BLUE, textColor: WHITE, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5, valign: 'top' },
      columnStyles: {
        0: { cellWidth: 45, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 24, halign: 'center' },
      },
      didParseCell(data) {
        if (data.column.index === 2 && data.section === 'body') {
          const estado = data.cell.text[0];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = ESTADO_COLORS[estado] ?? DARK_GRAY;
        }
      },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Fortalezas y mejoras ─────────────────────────────────────────────────────
  if (fortalezas.length || mejoras.length) {
    if (y > 240) { doc.addPage(); y = 20; }

    if (fortalezas.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(22, 163, 74);
      doc.text('Aspectos bien logrados', 14, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...DARK_GRAY);
      for (const f of fortalezas) {
        if (y > 268) { doc.addPage(); y = 20; }
        const lines = doc.splitTextToSize(`•  ${f}`, W - 34);
        doc.text(lines, 18, y);
        y += lines.length * 3.8 + 1.5;
      }
      y += 3;
    }

    if (mejoras.length) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(180, 83, 9);
      doc.text('Acciones de mejora para la próxima entrega', 14, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...DARK_GRAY);
      for (const m of mejoras) {
        if (y > 268) { doc.addPage(); y = 20; }
        const lines = doc.splitTextToSize(`•  ${m}`, W - 34);
        doc.text(lines, 18, y);
        y += lines.length * 3.8 + 1.5;
      }
      y += 3;
    }
  }

  // ── Evaluation table ─────────────────────────────────────────────────────────
  if (y > 235) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK_GRAY);
  doc.text('Evaluación por Criterio', 14, y);
  y += 4;

  const criteriaRows = criteria.map(c => [
    c.label,
    `${Math.round(c.weight * 100)}%`,
    String(c.professorScore.toFixed(1)).replace('.', ','),
    c.professorObservation?.trim() || c.aiJustification,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Criterio', 'Peso', 'Nota', 'Justificación']],
    body: criteriaRows,
    theme: 'striped',
    headStyles: { fillColor: BLUE, textColor: WHITE, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, valign: 'top' },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 'auto' },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 2) {
        const score = parseFloat(String(data.cell.text[0]).replace(',', '.'));
        if (!isNaN(score)) {
          data.cell.styles.textColor = gradeColor(score);
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 6;

  // ── Global score box ─────────────────────────────────────────────────────────
  const boxH = 18;
  doc.setFillColor(...BLUE);
  doc.rect(14, y, W - 28, boxH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text('Nota Final del Docente:', 18, y + 7);

  doc.setFontSize(20);
  doc.setTextColor(globalScore >= 4.0 ? 144 : 252, globalScore >= 4.0 ? 238 : 165, globalScore >= 4.0 ? 144 : 165);
  doc.text(globalScore.toFixed(1).replace('.', ','), 18, y + 15);

  // Global justification on the right
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'normal');
  const justLines = doc.splitTextToSize(globalJustification ?? '', W - 28 - 55);
  doc.text(justLines, 60, y + 6);

  y += boxH + 6;

  // ── Professor observations ───────────────────────────────────────────────────
  if (globalObservation?.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK_GRAY);
    doc.text('Observaciones del Docente', 14, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const obsLines = doc.splitTextToSize(globalObservation, W - 28);
    doc.text(obsLines, 14, y);
    y += obsLines.length * 4 + 4;
  }

  // ── Per-criterion observations ───────────────────────────────────────────────
  const withObs = criteria.filter(c => c.professorObservation?.trim());
  if (withObs.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...DARK_GRAY);
    doc.text('Observaciones por criterio', 14, y);
    y += 4;

    for (const c of withObs) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(`${c.label}:`, 14, y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(c.professorObservation, W - 40);
      doc.text(lines, 20, y + 4);
      y += lines.length * 4 + 6;
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...BLUE);
    doc.rect(0, 283, W, 14, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Formulación de Proyecto de Título  ·  Universidad Viña del Mar  ·  ${new Date().getFullYear()}`, W / 2, 289, { align: 'center' });
    doc.text(`Pág. ${i} / ${pageCount}`, W - 16, 289, { align: 'right' });
  }

  const filename = `Retroalimentacion_${delivery}_${studentName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
