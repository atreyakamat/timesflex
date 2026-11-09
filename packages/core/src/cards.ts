/** Student cards and scans: the parts with no screen or server in them. */

export interface StudentCard {
  studentId: string;
  name: string;
  rollNo: string;
  divisionId: string;
  divisionName: string;
  code: string;
}

export interface ScanRecord {
  id: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  divisionId: string;
  divisionName: string;
  at: string;
  date: string;
  time: string;
  source: string;
}

export const escapeHtml = (text: unknown) =>
  String(text ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/**
 * A printable page of cards, A4, cut along the lines. Student names come from whatever was
 * pasted into a class list, so everything is escaped before it goes into the page.
 * `qrSvg` draws the code, kept out of here so this has no dependencies.
 */
export const cardSheetHtml = (college: string, cards: StudentCard[], qrSvg: (code: string) => string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(college)} student cards</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .card { border: 1px dashed #888; border-radius: 3mm; padding: 3mm; text-align: center; break-inside: avoid; }
  .card svg { width: 34mm; height: 34mm; display: block; margin: 0 auto 2mm; }
  .college { font-size: 8pt; color: #444; }
  .name { font-size: 11pt; font-weight: bold; overflow-wrap: anywhere; }
  .meta { font-size: 9pt; }
</style></head>
<body><div class="sheet">
${cards
  .map(
    (card) => `<div class="card">${qrSvg(card.code)}<div class="name">${escapeHtml(card.name)}</div><div class="meta">${escapeHtml(card.rollNo)} · ${escapeHtml(card.divisionName)}</div><div class="college">${escapeHtml(college)}</div></div>`,
  )
  .join('\n')}
</div></body></html>`;

/** Each student's earliest scan that day. */
export const firstScans = (scans: Pick<ScanRecord, 'studentId' | 'time' | 'at'>[]) => {
  const first = new Map<string, string>();
  for (const scan of [...scans].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!first.has(scan.studentId)) first.set(scan.studentId, scan.time);
  }
  return first;
};

/**
 * Who hasn't scanned. It can only suggest: someone may have forgotten their card, or come in
 * another way, so a person always looks at this before it becomes attendance.
 */
export const notScanned = <S extends { id: string }>(students: S[], scans: Pick<ScanRecord, 'studentId' | 'time' | 'at'>[]) => {
  const seen = firstScans(scans);
  return students.filter((student) => !seen.has(student.id));
};
