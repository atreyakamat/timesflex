// Reads the attendance files fingerprint and card machines export, whatever the brand.
// No dependencies. An identical copy lives in plugins/biometric-bridge/punchfile.mjs, and a test
// keeps the two the same.
//
// Machines and their software differ in delimiter, column order, header names and date format.
// This looks for one column that names the person and one (or a date plus a time column) that
// says when, and reads Indian day-first dates as well as year-first ones.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ID_HEADER = /^(user ?id|userid|emp(loyee)?[ ._]?(code|id|no|number)|enrol+(ment)?[ ._]?(no|id|number)|ac[ .-]?no|pin|badge([ ._]?(no|id))?|card[ ._]?(no|id|number)|roll[ ._]?(no|number)|person[ ._]?id|staff[ ._]?id|id|no\.?|code)$/i;
const WHEN_HEADER = /^(date[ ._/]?time|datetime|time ?stamp|punch[ ._]?(time|date)|check[ ._]?(time|in)|log[ ._]?(time|date)|att(endance)?[ ._]?time|verify ?time|event ?time)$/i;
const DATE_HEADER = /^(date|punch ?date|log ?date|att(endance)? ?date)$/i;
const TIME_HEADER = /^(time|punch ?time|log ?time|in ?time)$/i;

const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d, h, mi, s) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;

/** A time of day: "9:25", "09:25:03", "9:25 PM". Returns [h, m, s] or null. */
export const parseTime = (text) => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[4]?.toLowerCase().replace(/\./g, '');
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
  }
  return [hours, Number(match[2]), Number(match[3] ?? 0)];
};

/** A date: "2026-11-09", "09/11/2026", "9-Nov-2026", "11/09/2026" (read as day-first unless that's impossible). */
export const parseDate = (text) => {
  const value = String(text ?? '').trim();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  match = /^(\d{1,2})[-/. ]([a-z]{3})[a-z]*[-/. ,]+(\d{2,4})$/i.exec(value);
  if (match) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
    return month ? [year, month, Number(match[1])] : null;
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value);
  if (!match) return null;
  let [first, second] = [Number(match[1]), Number(match[2])];
  const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
  // India writes the day first. Only when that can't be right is it read the American way.
  if (second > 12 && first <= 12) [first, second] = [second, first];
  return [year, second, first];
};

/** "2026-11-09 09:25:03", "09/11/2026 9:25 AM", "2026-11-09T09:25:03"... as local "YYYY-MM-DD HH:MM:SS". */
export const parseDateTime = (text) => {
  const value = String(text ?? '').trim().replace('T', ' ');
  const split = /^(\S+(?:[ -][a-z]{3}[a-z]*[ -,]+\d{2,4})?)\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*[ap]\.?m\.?)?)$/i.exec(value);
  if (!split) return null;
  const date = parseDate(split[1]);
  const time = parseTime(split[2]);
  if (!date || !time) return null;
  const [y, m, d] = date;
  const [h, mi, s] = time;
  return valid(y, m, d, h, mi, s) ? `${y}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}` : null;
};

const combine = (date, time) => {
  const d = parseDate(date);
  const t = parseTime(time);
  if (!d || !t || !valid(...d, ...t)) return null;
  return `${d[0]}-${pad(d[1])}-${pad(d[2])} ${pad(t[0])}:${pad(t[1])}:${pad(t[2])}`;
};

const splitRow = (line, delimiter) => {
  if (delimiter === 'space') {
    // "1023  2026-11-09 09:25:03  1  0": rejoin date and time, which a space also separates.
    const cells = line.trim().split(/\s+/);
    const joined = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (parseDate(cells[i]) && parseTime(cells[i + 1] ?? '')) {
        const meridiem = /^[ap]\.?m\.?$/i.test(cells[i + 2] ?? '') ? ` ${cells[i + 2]}` : '';
        joined.push(`${cells[i]} ${cells[i + 1]}${meridiem}`);
        i += meridiem ? 2 : 1;
      } else joined.push(cells[i]);
    }
    return joined;
  }
  // Quoted cells may hold the delimiter, as in "Diya, K", and "" stands for one quote.
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quoted) {
      if (character === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && !cell.trim()) quoted = true;
    else if (character === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
};

const pickDelimiter = (lines) => {
  const sample = lines.slice(0, 20).join('\n');
  if (sample.includes('\t')) return '\t';
  const commas = (sample.match(/,/g) ?? []).length;
  const semicolons = (sample.match(/;/g) ?? []).length;
  if (commas || semicolons) return semicolons > commas ? ';' : ',';
  return 'space';
};

/** The columns, from a header row if there is one. */
const readHeader = (cells) => {
  const find = (pattern) => cells.findIndex((cell) => pattern.test(cell.trim()));
  const id = find(ID_HEADER);
  const when = find(WHEN_HEADER);
  const date = find(DATE_HEADER);
  const time = find(TIME_HEADER);
  if (id === -1 || (when === -1 && (date === -1 || time === -1))) return null;
  return { id, when, date, time };
};

const looksLikeTimeCell = (cell) => Boolean(parseDateTime(cell) || parseDate(cell) || parseTime(cell));

/** Without a header: the first cell that isn't a date or time names the person. */
const readRow = (cells) => {
  const id = cells.find((cell) => cell && !looksLikeTimeCell(cell));
  for (let i = 0; i < cells.length; i += 1) {
    const whole = parseDateTime(cells[i]);
    if (whole) return id ? { id, time: whole } : null;
    if (parseDate(cells[i]) && parseTime(cells[i + 1] ?? '')) {
      const joined = combine(cells[i], cells[i + 1]);
      return id && joined ? { id, time: joined } : null;
    }
  }
  return null;
};

/**
 * Every punch in a file. Lines it can't read are counted and a few kept, so a person can see
 * whether that's a title line or a format we don't understand yet.
 */
export const parsePunches = (text) => {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  const delimiter = pickDelimiter(lines);
  const punches = [];
  const unreadable = [];
  let columns = null;
  for (const [index, line] of lines.entries()) {
    const cells = splitRow(line, delimiter);
    if (index < 5 && !columns) {
      const header = readHeader(cells);
      if (header) {
        columns = header;
        continue;
      }
    }
    let punch = null;
    if (columns) {
      const id = cells[columns.id];
      const time = columns.when !== -1 ? parseDateTime(cells[columns.when]) : combine(cells[columns.date], cells[columns.time]);
      punch = id && time ? { id, time } : null;
    } else punch = readRow(cells);
    if (punch && punch.id.length <= 100) punches.push(punch);
    else if (unreadable.length < 5) unreadable.push(line.slice(0, 120));
  }
  const skipped = lines.length - punches.length - (columns ? 1 : 0);
  return { punches, skipped, unreadable, header: Boolean(columns) };
};
