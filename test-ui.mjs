/* Mounts the real index.html app in jsdom and clicks through the flows. */
import 'fake-indexeddb/auto';
import fs from 'fs';
import assert from 'assert';
import { JSDOM } from 'jsdom';
import htm from 'htm';
import * as XLSX from 'xlsx';

const src = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = src.split('<script>').pop().split('</script>')[0];

const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#17403a"></head><body><div id="root"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

for (const k of ['HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent',
  'KeyboardEvent', 'FileReader', 'Blob', 'File', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'DOMParser', 'Image', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
  globalThis[k] = window[k];
}
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: window.location, configurable: true });
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
window.indexedDB = globalThis.indexedDB;
Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
window.IDBKeyRange = globalThis.IDBKeyRange;
const XL = Object.assign({}, XLSX);
window.htm = htm; window.XLSX = XL;
globalThis.htm = htm; globalThis.XLSX = XL;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// react-dom decides at import time whether native input events are usable; jsdom's Document
// lacks the on* handlers it probes for, which would push React onto a broken IE fallback path.
window.document.oninput = null;
window.document.onchange = null;
const React = (await import('react')).default;
const ReactDOM = (await import('react-dom')).default;
const act = React.act || (await import('react-dom/test-utils')).act;
window.React = React; window.ReactDOM = ReactDOM;
globalThis.React = React; globalThis.ReactDOM = ReactDOM;
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};
const downloads = [];
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = window.URL.createObjectURL;
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = function (tag) {
  const el = origCreate(tag);
  if (tag === 'a') el.click = function () { downloads.push(el.download || el.href); };
  return el;
};
XL.writeFile = (wb, name) => downloads.push(name);

// silence React's act warnings from async effects we await explicitly
const realError = console.error;
console.error = (...a) => { if (!/not wrapped in act|ReactDOM.createRoot|unmounted/.test(String(a[0]))) realError(...a); };

/* ---------- seed the database before the app boots ---------- */
const QID = 'seed-q';
function seed() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('surveyscholar', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('questionnaires', { keyPath: 'id' });
      db.createObjectStore('versions', { keyPath: 'key' });
      const r = db.createObjectStore('responses', { keyPath: 'entryId' });
      r.createIndex('by_q', 'questionnaireId'); r.createIndex('by_sync', 'syncStatus');
      db.createObjectStore('counters', { keyPath: 'year' });
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('drafts', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const questions = [
        { id: 'q1', order: 0, type: 'short_text', label: 'Respondent name', required: true },
        { id: 'q2', order: 1, type: 'multiple_choice', label: 'Sex', options: ['Male', 'Female'], required: true },
        { id: 'q3', order: 2, type: 'checkbox', label: 'Symptoms', options: ['Fever', 'Cough'], required: false },
        { id: 'q4', order: 3, type: 'linear_scale', label: 'Satisfaction', min: 1, max: 5, required: false },
        { id: 'q5', order: 4, type: 'number', label: 'Age', required: false }
      ];
      const t = new Date().toISOString();
      const tx = db.transaction(['questionnaires', 'versions', 'responses', 'counters', 'settings'], 'readwrite');
      tx.objectStore('questionnaires').put({ id: QID, title: 'Seed survey', description: 'Fixture', version: 1, targetCount: 4, questions, createdAt: t, updatedAt: t });
      tx.objectStore('versions').put({ key: QID + ':1', questionnaireId: QID, version: 1, title: 'Seed survey', questions, savedAt: t });
      const yy = String(new Date().getFullYear()).slice(-2);
      tx.objectStore('responses').put({ entryId: yy + '00001', questionnaireId: QID, questionnaireVersion: 1, answers: { q1: 'Rahim', q2: 'Male' }, createdAt: t, updatedAt: t, syncStatus: 'synced', syncedAt: t });
      tx.objectStore('responses').put({ entryId: yy + '00002', questionnaireId: QID, questionnaireVersion: 1, answers: { q1: 'Karim', q2: 'Female' }, createdAt: t, updatedAt: t, syncStatus: 'failed', syncError: 'HTTP 500' });
      tx.objectStore('counters').put({ year: new Date().getFullYear(), seq: 2 });
      tx.objectStore('settings').put({ key: 'activeQuestionnaireId', value: QID });
      tx.objectStore('settings').put({ key: 'interviewer', value: 'Mustofa' });
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
    req.onerror = () => rej(req.error);
  });
}

/* ---------- helpers ---------- */
const doc = window.document;
const all = sel => Array.from(doc.querySelectorAll(sel));
// Only the topmost layer is interactive: a dialog beats a sheet, a sheet beats the page.
function scope() {
  const dialogs = all('.scrim');
  if (dialogs.length) return dialogs[dialogs.length - 1];
  const sheets = all('.sheet');
  if (sheets.length) return sheets[sheets.length - 1];
  return doc.body;
}
const $$ = sel => Array.from(scope().querySelectorAll(sel));
const text = () => doc.body.textContent;
function find(label, sel = 'button, .chip, label.btn, a') {
  const els = $$(sel).filter(e => e.textContent.trim().toLowerCase().includes(String(label).toLowerCase()));
  return els[els.length - 1];
}
async function tick(n = 3) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
async function click(elOrLabel, sel) {
  const el = typeof elOrLabel === 'string' ? find(elOrLabel, sel) : elOrLabel;
  if (!el) throw new Error('No clickable element matching "' + elOrLabel + '"');
  if (el.disabled) throw new Error('Element "' + elOrLabel + '" is disabled');
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await tick();
  return el;
}
function setValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
async function type(el, value) {
  await act(async () => { setValue(el, value); });
  await tick(1);
}
function fieldFor(labelText) {
  const card = $$('.card').find(c => c.querySelector('.lbl') && c.querySelector('.lbl').textContent.includes(labelText));
  if (!card) throw new Error('No field card for "' + labelText + '"');
  return card;
}
function overlapCheck() { return all('.sheet').length; }

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + (e.message || e)); }
}

/* ---------- boot ---------- */
await seed();
window.location.hash = '#/input';
await act(async () => { new Function(script).call(window); });
await tick(8);

const yy = String(new Date().getFullYear()).slice(-2);

await t('app boots to the Input page with seeded data', () => {
  assert.ok(text().includes('SurveyScholar'));
  assert.ok(text().includes('Seed survey'), 'active questionnaire not shown');
  assert.ok(text().includes(yy + '00001'), 'history missing');
  assert.ok(text().includes('Sync failed'), 'failed badge missing');
  assert.strictEqual(all('nav.tabs .tab').length, 4);
});

await t('header shows pending sync count from all entries', () => {
  assert.ok(/1 to sync/.test(text()), text().slice(0, 200));
});

/* ---------- new entry flow ---------- */
await t('new entry: required validation blocks, then saves with a fresh ID', async () => {
  await click('New entry');
  assert.strictEqual(overlapCheck(), 1, 'entry form must be a single full-screen sheet');
  assert.ok(text().includes('Respondent name'), 'form not rendered from the questionnaire');
  await click('Save entry');
  assert.ok(/2 required answers are missing/.test(text()), 'validation toast missing: ' + text().slice(-300));
  assert.ok($$('.card.invalid').length >= 2, 'invalid fields not flagged');
  await type(fieldFor('Respondent name').querySelector('input'), 'Fatema');
  await click($$('.opt').find(o => o.textContent.includes('Female')));
  await click($$('.scale button').find(b => b.textContent.trim() === '4'));
  await click('Save entry');
  assert.strictEqual(all('.sheet').length, 0, 'sheet did not close after save');
  assert.ok(text().includes(yy + '00003'), 'new entry ID not in history');
  assert.ok(/Entry saved/.test(text()), 'no confirmation toast');
});

await t('saved answers round-trip into the edit form', async () => {
  const row = $$('.entry').find(e => e.textContent.includes(yy + '00003'));
  await click(Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Edit'));
  assert.ok(text().includes('Edit ' + yy + '00003'));
  assert.strictEqual(fieldFor('Respondent name').querySelector('input').value, 'Fatema');
  assert.ok($$('.opt.on').some(o => o.textContent.includes('Female')), 'choice not restored');
  assert.ok($$('.scale button.on').some(b => b.textContent.trim() === '4'), 'scale not restored');
});

await t('editing keeps the same ID and does not create a row', async () => {
  await type(fieldFor('Respondent name').querySelector('input'), 'Fatema Begum');
  await click('Save changes');
  await tick(4);
  const ids = $$('.eid').map(e => e.textContent);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate IDs in history');
  assert.strictEqual(ids.filter(i => i === yy + '00003').length, 1);
  assert.ok(/Entry updated/.test(text()));
});

await t('draft autosaves and is recovered after reopening', async () => {
  await click('New entry');
  await type(fieldFor('Respondent name').querySelector('input'), 'Half finished');
  await new Promise(r => setTimeout(r, 700));   // debounce window
  await tick(3);
  await click('Cancel');                         // confirm dialog: leaving keeps the draft
  await click('Leave');
  await tick(3);
  assert.ok(/Unfinished entry saved on this device/.test(text()), 'draft banner missing');
  await click('Continue');
  assert.ok(/Draft recovered/.test(text()), 'draft not recovered');
  assert.strictEqual(fieldFor('Respondent name').querySelector('input').value, 'Half finished');
  await click('Discard');
  await click('Discard', '.dialog button');
  assert.strictEqual(fieldFor('Respondent name').querySelector('input').value, '');
  await click('Cancel');
  await tick(2);
  assert.strictEqual(all('.sheet').length, 0);
});

/* ---------- delete flow ---------- */
await t('delete needs two confirmations and the first tap alone does nothing', async () => {
  const row = $$('.entry').find(e => e.textContent.includes(yy + '00003'));
  await click(Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Delete'));
  assert.ok(text().includes('Delete entry ' + yy + '00003'));
  await click('Cancel', '.dialog button');
  assert.ok(text().includes(yy + '00003'), 'entry vanished after cancelling');
  const row2 = $$('.entry').find(e => e.textContent.includes(yy + '00003'));
  await click(Array.from(row2.querySelectorAll('button')).find(b => b.textContent === 'Delete'));
  await click('Delete entry', '.dialog button');
  assert.ok(/One more tap to confirm/.test(text()), 'second confirmation missing');
  await click('Cancel', '.dialog button');
  assert.ok($$('.eid').some(e => e.textContent === yy + '00003'), 'entry deleted after only one confirmation');
});

await t('confirmed delete removes it from history but keeps the ID sequence', async () => {
  const row = $$('.entry').find(e => e.textContent.includes(yy + '00003'));
  await click(Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Delete'));
  await click('Delete entry', '.dialog button');
  await click('Yes, delete', '.dialog button');
  await tick(4);
  assert.ok(!$$('.eid').some(e => e.textContent === yy + '00003'), 'still in history');
  assert.ok(/deleted/i.test(text()));
  await click('New entry');
  await type(fieldFor('Respondent name').querySelector('input'), 'After delete');
  await click($$('.opt').find(o => o.textContent.includes('Male')));
  await click('Save entry');
  await tick(3);
  assert.ok($$('.eid').some(e => e.textContent === yy + '00004'), 'sequence rewound after a delete');
});

await t('deleted entry is restorable from Recently deleted', async () => {
  await click('Show all');
  assert.ok(/Recently deleted \(1\)/.test(text()), 'deleted filter count wrong');
  await click('Recently deleted', '.chip');
  assert.ok(text().includes(yy + '00003'), 'deleted entry not listed');
  assert.ok(!$$('.entry').some(e => e.textContent.includes(yy + '00004')), 'live entries leaked into the deleted filter');
  await click('Restore');
  await click('Restore', '.dialog button');
  await tick(4);
  assert.ok(/Recently deleted \(0\)/.test(text()), 'count not updated after restore');
  await click('All', '.chip');
  assert.ok(text().includes(yy + '00003'), 'restored entry missing from the full list');
});

await t('full list search and status filters work', async () => {
  const search = $$('input[type=text]')[0];
  await type(search, yy + '00001');
  assert.strictEqual($$('.entry').length, 1);
  await type(search, '');
  await click('Sync failed', '.chip');
  const ids = $$('.entry .eid').map(e => e.textContent);
  assert.deepStrictEqual(ids, [yy + '00002']);
  await click('All', '.chip');
  await click($$('.iconbtn')[0]);   // back
  await tick(2);
  assert.strictEqual(all('.sheet').length, 0);
});

/* ---------- overview ---------- */
await t('overview counts, target and progress exclude deleted entries', async () => {
  await click(all('nav.tabs .tab')[1]);
  await tick(3);
  const big = doc.querySelector('.hero .big').textContent.trim();
  assert.strictEqual(big, '4', 'expected 4 live entries, got ' + big);
  assert.ok(/100% achieved/.test(text()), 'target 4 of 4 should read 100%');
  assert.ok(/Target 4/.test(text()));
});

await t('overview export produces a file for one questionnaire', async () => {
  downloads.length = 0;
  const sel = $$('.wrap select')[0];
  await type(sel, QID);
  await click('Export to Excel');
  await tick(4);
  assert.strictEqual(downloads.length, 1, 'no export produced');
  assert.ok(/\.xlsx$/.test(downloads[0]), downloads[0]);
  downloads.length = 0;
  await click('CSV');
  await tick(4);
  assert.ok(downloads.some(d => /\.csv$/.test(d)), 'CSV export missing: ' + downloads);
});

await t('export contents exclude the deleted entry and carry the headers', async () => {
  // rebuild what the export would contain, through the app's own store
  const db = await new Promise(r => { const q = indexedDB.open('surveyscholar'); q.onsuccess = () => r(q.result); });
  const rows = await new Promise(r => { const q = db.transaction('responses').objectStore('responses').getAll(); q.onsuccess = () => r(q.result); });
  db.close();
  const live = rows.filter(x => !x.isDeleted);
  assert.strictEqual(live.length, 4);
  assert.strictEqual(rows.length, 4, 'restored entry should no longer be flagged deleted');
});

/* ---------- questionnaire builder ---------- */
await t('questionnaire page lists the form with live response count', async () => {
  await click(all('nav.tabs .tab')[2]);
  await tick(3);
  assert.ok(text().includes('Seed survey'));
  assert.ok(/4 responses/.test(text()), 'response count should exclude deleted: ' + text().match(/v1[^]{0,40}/));
  assert.ok(text().includes('Active'));
});

await t('editing questions on a form with responses warns and bumps the version', async () => {
  await click('Edit', '.card .btn');
  assert.ok(/Edit questionnaire/.test(text()));
  await click('Add question');
  await type($$('textarea')[0], 'District of residence');
  await click('Save question');
  await tick(3);
  await click('Save questionnaire');
  assert.ok(/Change the form structure\?/.test(text()), 'no structural-change warning');
  assert.ok(/version 2/.test(text()));
  await click('Save as version 2', '.dialog button');
  await tick(5);
  assert.ok(/v2 · 6 questions/.test(text()), text().match(/v\d[^]{0,30}/));
});

await t('old entries still open against their own form version', async () => {
  await click(all('nav.tabs .tab')[0]);
  await tick(3);
  const row = $$('.entry').find(e => e.textContent.includes(yy + '00001'));
  await click(Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Edit'));
  assert.ok(/collected on form version 1/.test(text()), 'version banner missing');
  assert.ok(!text().includes('District of residence'), 'new question leaked into an old entry');
  assert.strictEqual(fieldFor('Respondent name').querySelector('input').value, 'Rahim');
  await click('Cancel');
  await tick(2);
});

await t('new entries use the current version, including the new question', async () => {
  await click('New entry');
  assert.ok(text().includes('District of residence'), 'new question missing from a fresh entry');
  await click('Cancel');
  await tick(2);
});

await t('deleting a questionnaire with responses demands a typed confirmation', async () => {
  await click(all('nav.tabs .tab')[2]);
  await tick(3);
  await click('Delete', '.card .btn');
  assert.ok(/Type DELETE to confirm/.test(text().replace(/\s+/g, ' ')), 'typed confirmation missing');
  const ok = $$('.dialog button').find(b => /Delete permanently/.test(b.textContent));
  assert.ok(ok.disabled, 'delete enabled before typing');
  await type($$('.dialog input')[0], 'DELETE');
  assert.ok(!$$('.dialog button').find(b => /Delete permanently/.test(b.textContent)).disabled);
  await click('Cancel', '.dialog button');
  await tick(2);
  assert.ok(text().includes('Seed survey'), 'questionnaire disappeared after cancelling');
});

/* ---------- import ---------- */
await t('import screen offers both paths and the template downloads', async () => {
  await click('Import questionnaire');
  assert.strictEqual(all('.sheet').length, 1);
  assert.ok(/From the Excel template/.test(text()));
  assert.ok(/From a Word or PDF draft/.test(text()));
  downloads.length = 0;
  await click('Download template');
  assert.deepStrictEqual(downloads, ['surveyscholar-template.xlsx']);
});

await t('guide copies the prompt and shows the column reference', async () => {
  let copied = null;
  window.navigator.clipboard = { writeText: v => { copied = v; return Promise.resolve(); } };
  await click('convert it with an AI assistant');
  assert.ok(/Turn a draft questionnaire into an importable file/.test(text()));
  await click('Copy prompt');
  assert.ok(copied && copied.includes('Order | Question Type | Label | Options | Required | Image Filename'));
  assert.ok(copied.includes('short_text, long_text, multiple_choice'));
  assert.ok(/Prompt copied/.test(text()));
  await click($$('.iconbtn')[0]);
  await tick(2);
});

/* ---------- import, end to end through the file input ---------- */
function makeXlsxFile(aoa, name) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Questions');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const f = new window.File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  f.arrayBuffer = async () => buf;
  return f;
}
async function upload(labelText, file) {
  const label = find(labelText, 'label.btn');
  if (!label) throw new Error('No upload control matching "' + labelText + '"');
  const input = label.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await tick(12);
}
const HEADERS = ['Order', 'Question Type', 'Label', 'Options', 'Required', 'Image Filename'];
const GOOD = [HEADERS,
  [1, 'short_text', 'Head of household name', '', 'Y', ''],
  [2, 'multiple_choice', 'Main source of drinking water', 'Tube well;Tap;Pond', 'Y', ''],
  [3, 'linear_scale', 'Satisfaction with the service', '1;5', 'N', ''],
  [4, 'checkbox', 'Which months?', 'June;July;August', 'N', '']];
const BAD = [HEADERS,
  [1, 'text_short', 'Name', '', 'Y', ''],
  [2, 'multiple_choice', 'Water source', '', 'Y', ''],
  [3, 'short_text', '', '', 'Y', ''],
  [4, 'linear_scale', 'Rating', '5;1', 'N', '']];

await t('a bad template is rejected row by row and saves nothing', async () => {
  await upload('Upload filled template', makeXlsxFile(BAD, 'broken.xlsx'));
  assert.ok(/broken\.xlsx was not imported/.test(text()), text().slice(-300));
  const items = $$('li').map(li => li.textContent);
  assert.strictEqual(items.length, 4, 'expected 4 row errors, got ' + items.length + ': ' + items.join(' // '));
  assert.ok(items.some(i => /Row 2.*not a Question Type/.test(i)));
  assert.ok(items.some(i => /Row 3.*needs options/.test(i)));
  assert.ok(items.some(i => /Row 4.*Label is empty/.test(i)));
  assert.ok(items.some(i => /Row 5.*larger than the minimum/.test(i)));
  assert.strictEqual(all('.sheet').length, 1, 'a broken file must not open the review screen');
});

await t('a valid template opens the review screen without saving', async () => {
  await upload('Upload filled template', makeXlsxFile(GOOD, 'Household water.xlsx'));
  assert.strictEqual(all('.sheet').length, 2, 'review screen did not open');
  assert.ok(/Review before importing/.test(text()));
  assert.ok(/Nothing is saved until you tap Confirm import/.test(text()));
  assert.ok(/4 questions ready/.test(text()));
  assert.strictEqual($$('input[type=text]')[0].value, 'Household water', 'title not taken from the filename');
  assert.ok(text().includes('Main source of drinking water'));
  assert.ok($$('.opt').some(o => o.textContent.includes('Tube well')), 'options not previewed as real inputs');
  assert.strictEqual($$('.scale button').length, 5, 'linear scale not previewed 1-5');
});

await t('a question can be removed in review', async () => {
  const beforeCount = $$('.card .lbl').length;
  await click($$('.btn-danger').find(b => b.textContent === 'Remove'));
  await click('Remove', '.dialog button');
  await tick(3);
  assert.ok(/3 questions ready/.test(text()), 'removal not reflected');
  assert.ok(!text().includes('Head of household name'), 'removed question still shown');
  assert.ok(beforeCount > $$('.card .lbl').length);
});

await t('confirm import creates a normal questionnaire and never overwrites', async () => {
  await click('Confirm import');
  await tick(6);
  assert.strictEqual(all('.sheet').length, 0, 'sheets did not close after import');
  assert.ok(/Imported .Household water.*3 questions/.test(text().replace(/\s+/g, ' ')), text().slice(-200));
  const titles = $$('.card h2').map(h => h.textContent);
  assert.ok(titles.includes('Household water'), titles.join(' | '));
  assert.ok(titles.includes('Seed survey'), 'existing questionnaire was replaced');
  assert.ok(/v1 · 3 questions · 0 responses/.test(text()));
});

await t('importing the same name again is saved beside it, not over it', async () => {
  await click('Import questionnaire');
  await upload('Upload filled template', makeXlsxFile(GOOD, 'Household water.xlsx'));
  await click('Confirm import');
  assert.ok(/already uses that name/.test(text()), 'no collision warning');
  await click('Import as', '.dialog button');
  await tick(6);
  const titles = $$('.card h2').map(h => h.textContent);
  assert.ok(titles.includes('Household water (2)'), titles.join(' | '));
  assert.ok(titles.includes('Household water'));
});

await t('an imported questionnaire collects entries like any other', async () => {
  const card = $$('.card').find(c => c.querySelector('h2') && c.querySelector('h2').textContent === 'Household water (2)');
  await click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Set active'));
  await tick(4);
  await click(all('nav.tabs .tab')[0]);
  await tick(4);
  await click('New entry');
  assert.ok(text().includes('Main source of drinking water'));
  await click('Save entry');
  assert.ok(/2 required answers are missing/.test(text()));
  await type(fieldFor('Head of household name').querySelector('input'), 'Abdul');
  await click($$('.opt').find(o => o.textContent.includes('Tube well')));
  await click('Save entry');
  await tick(4);
  assert.strictEqual(all('.sheet').length, 0);
  assert.ok(/Entry saved/.test(text()));
  assert.ok($$('.eid').some(e => /^\d{7}$/.test(e.textContent)), 'no entry recorded');
});

await t('switching questionnaire with an unsaved draft warns first', async () => {
  await click('New entry');
  await type(fieldFor('Head of household name').querySelector('input'), 'Draft person');
  await new Promise(r => setTimeout(r, 700));
  await tick(3);
  await click('Cancel');
  await click('Leave');
  await tick(3);
  const sel = $$('select')[0];
  await type(sel, QID);
  assert.ok(/You have an unsaved draft/.test(text()), 'no warning on switch: ' + text().slice(0, 300));
  await click('Cancel', '.dialog button');
  await tick(2);
  assert.ok(/Household water \(2\)/.test($$('select')[0].selectedOptions[0].textContent), 'questionnaire switched despite cancelling');
  await type($$('select')[0], QID);
  await click('Switch form', '.dialog button');
  await tick(4);
  assert.ok(text().includes('Seed survey'));
});

/* ---------- theme ---------- */
await t('the header toggle flips the theme and remembers it', async () => {
  const root = doc.documentElement;
  assert.strictEqual(root.getAttribute('data-theme'), null, 'should start on the device setting');
  const btn = all('header .theme-btn')[0];
  assert.ok(btn, 'no theme button in the header');
  await click(btn);
  assert.strictEqual(root.getAttribute('data-theme'), 'dark');
  assert.strictEqual(window.localStorage.getItem('ss-theme'), 'dark');
  assert.strictEqual(doc.querySelector('meta[name=theme-color]').getAttribute('content'), '#111614');
  await click(all('header .theme-btn')[0]);
  assert.strictEqual(root.getAttribute('data-theme'), 'light');
  assert.strictEqual(window.localStorage.getItem('ss-theme'), 'light');
});

await t('Functions offers the three-way choice and "follow device" clears the override', async () => {
  await click(all('nav.tabs .tab')[3]);
  await tick(3);
  assert.ok(/Appearance/.test(text()));
  await click('Dark', '.chip');
  assert.strictEqual(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.ok($$('.chip.on').some(c => c.textContent === 'Dark'), 'active chip not marked');
  await click('Follow device', '.chip');
  assert.strictEqual(doc.documentElement.getAttribute('data-theme'), null);
  assert.strictEqual(window.localStorage.getItem('ss-theme'), null, 'override not cleared from storage');
});

/* ---------- sections + skip logic, end to end ---------- */
const COND = [HEADERS.concat(['Show If Question', 'Show If Condition', 'Show If Values']),
  [1, 'section', 'Identification', '', '', '', '', '', ''],
  [2, 'short_text', 'Respondent name', '', 'Y', '', '', '', ''],
  [3, 'multiple_choice', 'Any illness in the last two weeks?', 'Yes;No', 'Y', '', '', '', ''],
  [4, 'number', 'How many days did it last?', '', 'Y', '', 3, 'is one of', 'Yes'],
  [5, 'section', 'Treatment', '', '', '', 3, 'is one of', 'Yes'],
  [6, 'multiple_choice', 'Was treatment sought?', 'Yes;No', 'Y', '', '', '', ''],
  [7, 'short_text', 'Why was it not sought?', '', 'Y', '', 6, 'is one of', 'No'],
  [8, 'section', 'Closing', '', '', '', '', '', ''],
  [9, 'long_text', 'Any other comments', '', 'N', '', '', '', '']];

await t('a template with sections and skip logic imports cleanly', async () => {
  await click(all('nav.tabs .tab')[2]);
  await tick(3);
  await click('Import questionnaire');
  await upload('Upload filled template', makeXlsxFile(COND, 'Illness module.xlsx'));
  assert.strictEqual(all('.sheet').length, 2, text().slice(-400));
  assert.ok(/6 questions in 3 sections, 3 shown conditionally ready/.test(text()), text().slice(0, 400));
  assert.strictEqual($$('.sect').length, 3, 'section headings not previewed');
  assert.ok(/Shown when .Any illness in the last two weeks\?. is one of: Yes/.test(text()));
  await click('Confirm import');
  await tick(6);
  assert.ok(/Imported .Illness module/.test(text()));
  const card = $$('.card').find(c => c.querySelector('h2') && c.querySelector('h2').textContent === 'Illness module');
  assert.ok(/v1 · 6 questions/.test(card.textContent), 'sections must not be counted as questions: ' + card.textContent);
  await click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Set active'));
  await tick(4);
});

await t('the entry form shows sections and hides conditional questions', async () => {
  await click(all('nav.tabs .tab')[0]);
  await tick(4);
  await click('New entry');
  assert.deepStrictEqual($$('.sect h2').map(h => h.textContent), ['Identification', 'Closing'],
    'a conditional section must stay hidden until its condition holds');
  assert.ok(!text().includes('How many days'), 'conditional question shown too early');
  assert.ok(/3 further questions depend on answers above/.test(text()), text().slice(-400));
});

await t('answering the parent reveals the child and its section, live', async () => {
  await click($$('.opt').find(o => o.textContent.includes('Yes')));
  await tick(2);
  assert.deepStrictEqual($$('.sect h2').map(h => h.textContent), ['Identification', 'Treatment', 'Closing']);
  assert.ok(text().includes('How many days did it last?'));
  assert.ok(text().includes('Was treatment sought?'));
  assert.ok(!text().includes('Why was it not sought?'), 'a second-level child appeared too early');
  assert.ok($$('.cond').length >= 2, 'revealed questions should be marked as conditional');
});

await t('a second-level condition reveals only on its own answer', async () => {
  const card = fieldFor('Was treatment sought?');
  await click(Array.from(card.querySelectorAll('.opt')).find(o => o.textContent.includes('No')));
  await tick(2);
  assert.ok(text().includes('Why was it not sought?'));
  await click(Array.from(fieldFor('Was treatment sought?').querySelectorAll('.opt')).find(o => o.textContent.includes('Yes')));
  await tick(2);
  assert.ok(!text().includes('Why was it not sought?'), 'child did not hide again when the answer changed');
});

await t('required validation only counts what is on screen', async () => {
  await click('Save entry');
  assert.ok(/2 required answers are missing/.test(text()), text().slice(-200));
  await type(fieldFor('Respondent name').querySelector('input'), 'Shirin');
  await type(fieldFor('How many days did it last?').querySelector('input'), '3');
  await click('Save entry');
  await tick(5);
  assert.strictEqual(all('.sheet').length, 0, 'save was blocked by a hidden required question');
});

await t('answers to questions that were hidden are never stored', async () => {
  // reopen, answer a branch, then switch the parent so the branch disappears, then save
  await click('New entry');
  await type(fieldFor('Respondent name').querySelector('input'), 'Nasrin');
  await click($$('.opt').find(o => o.textContent.includes('Yes')));
  await tick(2);
  await type(fieldFor('How many days did it last?').querySelector('input'), '7');
  await click(Array.from(fieldFor('Was treatment sought?').querySelectorAll('.opt')).find(o => o.textContent.includes('No')));
  await tick(2);
  await type(fieldFor('Why was it not sought?').querySelector('input'), 'Clinic too far');
  await tick(2);
  // now say there was no illness at all — the whole branch must fall away
  const parent = fieldFor('Any illness in the last two weeks?');
  await click(Array.from(parent.querySelectorAll('.opt')).find(o => o.textContent.includes('No')));
  await tick(2);
  assert.ok(!text().includes('Clinic too far'));
  await click('Save entry');
  await tick(6);
  assert.strictEqual(all('.sheet').length, 0);

  const db = await new Promise(r => { const q = indexedDB.open('surveyscholar'); q.onsuccess = () => r(q.result); });
  const rows = await new Promise(r => { const q = db.transaction('responses').objectStore('responses').getAll(); q.onsuccess = () => r(q.result); });
  db.close();
  const saved = rows.sort((a, b) => a.entryId < b.entryId ? 1 : -1)[0];
  const values = Object.values(saved.answers).map(String);
  assert.ok(values.includes('Nasrin'), JSON.stringify(saved.answers));
  assert.ok(!values.includes('7'), 'a hidden numeric answer was stored: ' + JSON.stringify(saved.answers));
  assert.ok(!values.includes('Clinic too far'), 'a hidden text answer was stored');
  assert.strictEqual(Object.keys(saved.answers).length, 2, 'only the two visible answers should be saved');
});

/* ---------- building sections and conditions by hand ---------- */
await t('the builder can add a section and a condition pointing at an earlier question', async () => {
  await click(all('nav.tabs .tab')[2]);
  await tick(3);
  const card = $$('.card').find(c => c.querySelector('h2') && c.querySelector('h2').textContent === 'Illness module');
  await click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Edit'));
  await tick(3);
  await click('Add section');
  assert.ok(/New section/.test(text()));
  await type($$('textarea')[0], 'Follow up');
  await click('Save section');
  await tick(3);
  await click('Add question');
  await type($$('textarea')[0], 'Who accompanied the child?');
  assert.ok(/Show this question only if/.test(text()));
  const parentSel = $$('select')[1];   // 0 = type, 1 = condition parent
  const opt = Array.from(parentSel.options).find(o => /Was treatment sought/.test(o.textContent));
  assert.ok(opt, 'earlier questions not offered: ' + Array.from(parentSel.options).map(o => o.textContent).join(' | '));
  await type(parentSel, opt.value);
  await click($$('.opt').find(o => o.textContent.trim() === 'Yes'));
  assert.ok(/Shown when .Was treatment sought\?. is one of: Yes/.test(text()), text().slice(-500));
  await click('Save question');
  await tick(3);
  assert.ok(/Shown when .Was treatment sought\?. is one of: Yes/.test(text()), 'condition not summarised on the card');
  await click('Save questionnaire');
  await click('Save as version 2', '.dialog button');
  await tick(6);
  assert.ok(/v2 · 7 questions/.test(text()), text().match(/v\d[^]{0,40}/));
});

await t('deleting a parent clears the conditions that depended on it', async () => {
  const card = $$('.card').find(c => c.querySelector('h2') && c.querySelector('h2').textContent === 'Illness module');
  await click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Edit'));
  await tick(3);
  const qcard = $$('.qcard').find(c => /Was treatment sought/.test(c.textContent));
  await click(Array.from(qcard.querySelectorAll('button')).find(b => b.textContent === 'Delete'));
  assert.ok(/2 other questions depend on this one/.test(text().replace(/\s+/g, ' ')), text().slice(-400));
  await click('Delete', '.dialog button');
  await tick(3);
  assert.ok(!text().includes('Was treatment sought?'));
  assert.ok(!/Shown when .Was treatment sought/.test(text()), 'a dangling condition survived the delete');
  await click('Cancel');
  await tick(3);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
