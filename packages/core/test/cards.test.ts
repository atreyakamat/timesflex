import assert from 'node:assert/strict';
import test from 'node:test';
import { cardSheetHtml, escapeHtml, firstScans, notScanned, type StudentCard } from '../src/cards.ts';

const card = (over: Partial<StudentCard> = {}): StudentCard => ({ studentId: 's1', name: 'Aarav', rollNo: 'A01', divisionId: 'd', divisionName: 'SY A', code: 'TF1.s1.sig', ...over });

test('escaping covers everything that could break out of a page', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(5), '5');
});

test('a card sheet has one card each, drawn from its own code', () => {
  const html = cardSheetHtml('Goa College', [card(), card({ studentId: 's2', name: 'Diya', code: 'TF1.s2.sig' })], (code) => `<svg data-code="${code}"></svg>`);
  assert.equal(html.match(/class="card"/g)?.length, 2);
  assert.match(html, /data-code="TF1\.s2\.sig"/);
  assert.match(html, /Diya/);
  assert.match(html, /Goa College/);
});

test('a name pasted into a class list can’t put a script in the printed page', () => {
  const html = cardSheetHtml('<b>College</b>', [card({ name: '<script>steal()</script>', rollNo: '"><img src=x>', divisionName: '<i>' })], () => '<svg></svg>');
  assert.doesNotMatch(html, /<script>|<img|<b>|<i>/);
  assert.match(html, /&lt;script&gt;/);
});

test('no cards still makes a valid, empty page', () => {
  assert.doesNotMatch(cardSheetHtml('X', [], () => ''), /class="card"/);
});

const scan = (studentId: string, time: string) => ({ studentId, time, at: `2026-11-09T${time}:00.000Z` });

test('someone’s first scan of the day is the one that counts, in any order', () => {
  assert.equal(firstScans([scan('a', '10:05'), scan('a', '08:50')]).get('a'), '08:50');
  assert.equal(firstScans([]).size, 0);
});

test('who hasn’t scanned', () => {
  const students = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(notScanned(students, [scan('b', '09:00')]).map((s) => s.id), ['a', 'c']);
  assert.equal(notScanned(students, []).length, 3);
  assert.deepEqual(notScanned([], [scan('b', '09:00')]), []);
});
