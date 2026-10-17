import type { ScheduledSession } from './types';
import { breaksAfter, buildGrid, matchesView, viewTitle, type ViewKey } from './utils';

/**
 * Timetable exports. Both formats are built in the browser from the same table
 * model, so the PDF and the Excel file always match what is on screen.
 * The PDF library is loaded only when someone exports.
 */

export interface ExportInput {
  institutionName: string;
  subtitle: string;
  days: string[];
  slots: string[];
  sessions: ScheduledSession[];
  names: Record<string, string>;
  views: ViewKey[];
  /** Name of the break after slot index i (e.g. "Lunch"); defaults to "Break". */
  breakLabels?: Record<number, string>;
}

interface TableRow {
  label: string;
  isBreak: boolean;
  cells: { text: string; lab: boolean }[];
}

interface Table {
  title: string;
  rows: TableRow[];
}

const cellText = (session: ScheduledSession, view: ViewKey, names: Record<string, string>) => {
  const name = (id: string) => names[id] ?? '?';
  const group = `${name(session.division_id)}${session.batch ? ` ${session.batch}` : ''}`;
  const details = [
    view.startsWith('division') || view.startsWith('batch') ? null : group,
    view.startsWith('teacher') ? null : name(session.teacher_id),
    view.startsWith('room') ? null : name(session.room_id),
  ].filter(Boolean);
  const heading = `${name(session.subject_id)}${session.batch && (view.startsWith('division') || view.startsWith('batch')) ? ` (${session.batch})` : ''}`;
  return `${heading}\n${details.join(' · ')}`;
};

export const buildTables = ({ days, slots, sessions, names, views, breakLabels = {} }: ExportInput): Table[] => {
  const breaks = breaksAfter(slots);
  return views.map((view) => {
    const grid = buildGrid(days, slots, sessions.filter((session) => matchesView(session, view)));
    const rows: TableRow[] = [];
    slots.forEach((slot, index) => {
      rows.push({
        label: slot.replace('-', ' – '),
        isBreak: false,
        cells: days.map((day) => {
          const here = grid[day]?.[slot] ?? [];
          return {
            text: here.map((session) => cellText(session, view, names)).join('\n\n'),
            lab: here.some((session) => session.kind === 'lab'),
          };
        }),
      });
      if (breaks.has(index)) {
        const gap = `${slot.split('-')[1]} – ${slots[index + 1].split('-')[0]}`;
        const text = breakLabels[index] || 'Break';
        rows.push({ label: gap, isBreak: true, cells: days.map(() => ({ text, lab: false })) });
      }
    });
    return { title: viewTitle(view, names), rows };
  });
};

const fileStem = (name: string) =>
  `${name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'timetable'}_${new Date().toISOString().slice(0, 10)}`;

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------------------------------------------------------------- Excel (.xlsx)

const xml = (value: string) =>
  value
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const column = (index: number) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

const STYLE = { title: 1, header: 2, body: 3, slot: 4, break: 5, lab: 6, meta: 7 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const sheetXml = (table: Table, days: string[], subtitle: string) => {
  const rows: string[] = [];
  const cell = (ref: string, text: string, style: number) =>
    `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  const lastColumn = column(days.length);

  rows.push(`<row r="1" ht="22" customHeight="1">${cell('A1', table.title, STYLE.title)}</row>`);
  rows.push(`<row r="2">${cell('A2', subtitle, STYLE.meta)}</row>`);
  rows.push(
    `<row r="3">${cell('A3', 'Time', STYLE.header)}${days.map((day, i) => cell(`${column(i + 1)}3`, day, STYLE.header)).join('')}</row>`,
  );
  table.rows.forEach((row, index) => {
    const r = index + 4;
    if (row.isBreak) {
      rows.push(
        `<row r="${r}">${cell(`A${r}`, row.label, STYLE.slot)}${days.map((_, i) => cell(`${column(i + 1)}${r}`, row.cells[i].text, STYLE.break)).join('')}</row>`,
      );
      return;
    }
    const lines = Math.max(1, ...row.cells.map((item) => item.text.split('\n').length));
    rows.push(
      `<row r="${r}" ht="${Math.max(30, lines * 13 + 4)}" customHeight="1">${cell(`A${r}`, row.label, STYLE.slot)}${row.cells
        .map((item, i) => cell(`${column(i + 1)}${r}`, item.text, item.lab ? STYLE.lab : STYLE.body))
        .join('')}</row>`,
    );
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="${days.length + 1}" width="28" customWidth="1"/></cols>
<sheetData>${rows.join('')}</sheetData>
<mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
};

const sheetNames = (titles: string[]) => {
  const used = new Set<string>();
  return titles.map((title) => {
    const base = title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - `${n}`.length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
};

/** Build an .xlsx workbook (one sheet per view) as raw bytes. */
export const buildWorkbook = async (input: ExportInput): Promise<Uint8Array> => {
  const { strToU8, zipSync } = await import('fflate');
  const tables = buildTables(input);
  const names = sheetNames(tables.map((table) => table.title));
  const subtitle = `${input.institutionName} · ${input.subtitle}`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  tables.forEach((table, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(table, input.days, subtitle));
  });
  return zipSync(files, { level: 6 });
};

export const exportExcel = async (input: ExportInput, filename: string) => {
  const bytes = await buildWorkbook(input);
  download(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${fileStem(filename)}.xlsx`,
  );
};

// ---------------------------------------------------------------------- PDF

/** Build a landscape A4 PDF (one page per view, more if a view overflows). */
export const buildPdf = async (input: ExportInput) => {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const tables = buildTables(input);
  // The built-in PDF fonts only cover Latin-1; swap the few typographic characters we emit.
  const latin = (value: string) => value.replace(/–/g, '-');

  tables.forEach((table, index) => {
    if (index > 0) doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(latin(table.title), 12, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(latin(`${input.institutionName} · ${input.subtitle}`), 12, 20);
    doc.setTextColor(15, 23, 42);

    autoTable(doc, {
      startY: 24,
      margin: { left: 12, right: 12 },
      head: [['Time', ...input.days]],
      body: table.rows.map((row) =>
        row.isBreak
          ? [
              { content: latin(row.label), styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
              {
                content: latin(row.cells[0]?.text ?? 'Break'),
                colSpan: input.days.length,
                styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139], fillColor: [241, 245, 249] },
              },
            ]
          : [
              { content: latin(row.label), styles: { fontStyle: 'bold' } },
              ...row.cells.map((item) => ({
                content: latin(item.text),
                styles: item.lab ? { fillColor: [254, 243, 199] as [number, number, number] } : {},
              })),
            ],
      ),
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.6, valign: 'top', lineColor: [203, 213, 225], lineWidth: 0.2 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, halign: 'center' },
      columnStyles: { 0: { cellWidth: 24 } },
    });
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`TimeFlex · page ${page} of ${pages}`, doc.internal.pageSize.getWidth() - 12, doc.internal.pageSize.getHeight() - 6, {
      align: 'right',
    });
  }
  return doc;
};

export const exportPdf = async (input: ExportInput, filename: string) => {
  const doc = await buildPdf(input);
  download(doc.output('blob'), `${fileStem(filename)}.pdf`);
};
