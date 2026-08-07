import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const BLUE = [30, 58, 95];     // UVM blue
const GOLD = [200, 169, 81];   // UVM gold
const WHITE = [255, 255, 255];
const LIGHT_GRAY = [245, 245, 245];
const DARK_GRAY = [60, 60, 60];

function gradeColor(score) {
  if (score < 4.0) return [220, 38, 38];    // red
  if (score < 4.5) return [245, 158, 11];   // amber
  if (score < 6.0) return [202, 138, 4];    // yellow-600
  return [22, 163, 74];                      // green
}

export function generateFeedbackPDF({ delivery, studentName, admissibility, criteria, globalScore, globalJustification, globalObservation }) {
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

  // Admissibility badge
  const admBadgeColor = admissibility.passed ? [22, 163, 74] : [220, 38, 38];
  const admLabel = admissibility.passed ? 'ADMISIBLE' : 'INADMISIBLE';
  doc.setFillColor(...admBadgeColor);
  doc.roundedRect(W - 65, y + 9, 30, 6, 2, 2, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(admLabel, W - 50, y + 13.5, { align: 'center' });

  y += 24;

  // ── Admissibility detail ─────────────────────────────────────────────────────
  doc.setTextColor(...DARK_GRAY);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Verificación de Admisibilidad', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Criterio', 'Resultado', 'Detalle']],
    body: admissibility.results.map(r => [
      r.label,
      r.passed ? '✓ OK' : '✗ FALLA',
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
        const passed = data.cell.text[0]?.startsWith('✓');
        data.cell.styles.textColor = passed ? [22, 163, 74] : [220, 38, 38];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 6;

  // ── Evaluation table ─────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Evaluación por Criterio', 14, y);
  y += 4;

  const criteriaRows = criteria.map(c => [
    c.label,
    `${Math.round(c.weight * 100)}%`,
    String(c.aiScore.toFixed(1)).replace('.', ','),
    String(c.professorScore.toFixed(1)).replace('.', ','),
    c.aiJustification,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Criterio', 'Peso', 'Nota IA', 'Nota Final', 'Justificación (IA)']],
    body: criteriaRows,
    theme: 'striped',
    headStyles: { fillColor: BLUE, textColor: WHITE, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, valign: 'top' },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 'auto' },
    },
    didParseCell(data) {
      if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
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
  const boxH = 22;
  doc.setFillColor(...LIGHT_GRAY);
  doc.rect(14, y, W - 28, boxH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK_GRAY);
  doc.text('Nota Propuesta IA:', 18, y + 6);

  doc.setFontSize(16);
  doc.setTextColor(...gradeColor(globalScore));
  doc.text(globalScore.toFixed(1).replace('.', ','), 60, y + 8);

  doc.setFontSize(9);
  doc.setTextColor(...DARK_GRAY);
  doc.text('Nota Final del Docente:', 18, y + 14);

  doc.setFontSize(16);
  const finalScore = criteria.length > 0
    ? criteria.reduce((acc, c) => acc + c.professorScore, 0) / criteria.length
    : globalScore;
  const displayFinal = criteria.find(c => c.professorScore !== c.aiScore) ? criteria[0]?.finalOverride ?? globalScore : globalScore;

  // Use the globalScore as the professor's final (it's set by the store)
  const professorFinal = criteria.professorFinal ?? globalScore;
  doc.setTextColor(...gradeColor(globalScore));
  doc.text(globalScore.toFixed(1).replace('.', ','), 75, y + 16);

  // Global justification
  doc.setFontSize(8);
  doc.setTextColor(...DARK_GRAY);
  doc.setFont('helvetica', 'normal');
  const justLines = doc.splitTextToSize(globalJustification ?? '', W - 28 - 95);
  doc.text(justLines, 100, y + 5);

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
