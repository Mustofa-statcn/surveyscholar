import 'fake-indexeddb/auto';
import fs from 'fs';
import assert from 'assert';

const src = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = src.split('<script>').pop().split('</script>')[0];

// take utils + IndexedDB layer only (no React/DOM)
const start = script.indexOf('function uid(');
const end = script.indexOf('/* ============================ Entry form');
const code = script.slice(start, end);

const sandboxSrc = code + `
;return {openDB, tx, dbGet, dbAll, dbPut, dbDel, responsesFor, getSettings, setSetting,
 createResponse, updateResponse, repairCounters, saveQuestionnaire, getSnapshot,
 questionsSignature, uid, nowISO, columnsFor, buildRows, cellValue, restoreAll, slug,
 isLive, liveOnly, softDelete, restoreEntry, purgeOldDeleted, daysSince, PURGE_DAYS,
 buildSyncPayload, validateImportRows, templateAoa, parseDocumentText, uniqueTitle,
 stripDraftFlags, applyImages, mapColumns, IMPORT_HEADERS, syncPending, postToScript,
 isSection, answerable, conditionMet, visibleElements, visibleQuestions, pruneHiddenAnswers,
 sanitizeConditions, condSummary, validate, COND_OPS};`;

globalThis.window = { crypto: globalThis.crypto };
globalThis.document = { createElement: () => ({ click(){}, remove(){}, style:{} }), body:{appendChild(){}} };
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Blob = class { constructor(p){ this.parts=p; } };
globalThis.XLSX = {};

const M = new Function(sandboxSrc)();

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + (e.message || e)); }
}

const yy = String(new Date().getFullYear()).slice(-2);

await t('first entry of the year gets ' + yy + '00001', async () => {
  const id = await M.createResponse({ questionnaireId: 'q1', questionnaireVersion: 1, answers: {}, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' });
  assert.strictEqual(id, yy + '00001');
});

await t('3 rapid entries produce 3 unique sequential IDs', async () => {
  const ids = await Promise.all([1, 2, 3].map(() =>
    M.createResponse({ questionnaireId: 'q1', questionnaireVersion: 1, answers: {}, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' })));
  assert.strictEqual(new Set(ids).size, 3, 'duplicate IDs: ' + ids);
  assert.deepStrictEqual(ids.slice().sort(), [yy + '00002', yy + '00003', yy + '00004']);
});

await t('20 concurrent entries: no collisions, no gaps', async () => {
  const ids = await Promise.all(Array.from({ length: 20 }, () =>
    M.createResponse({ questionnaireId: 'q2', questionnaireVersion: 1, answers: {}, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' })));
  const nums = ids.map(i => parseInt(i.slice(2), 10)).sort((a, b) => a - b);
  assert.strictEqual(new Set(ids).size, 20);
  assert.strictEqual(nums[nums.length - 1] - nums[0], 19, 'sequence has gaps');
  const all = await M.dbAll('responses');
  assert.strictEqual(all.length, 24);
});

await t('edit updates in place, same ID, createdAt preserved, updatedAt changes', async () => {
  const before = await M.dbGet('responses', yy + '00001');
  const saved = await M.updateResponse(yy + '00001', { answers: { a: 'edited' }, updatedAt: '2030-01-01T00:00:00.000Z', syncStatus: 'local' });
  const after = await M.dbGet('responses', yy + '00001');
  const all = await M.dbAll('responses');
  assert.strictEqual(all.length, 24, 'edit created a duplicate row');
  assert.strictEqual(after.entryId, yy + '00001');
  assert.strictEqual(after.createdAt, before.createdAt);
  assert.strictEqual(after.answers.a, 'edited');
  assert.strictEqual(after.updatedAt, '2030-01-01T00:00:00.000Z');
});

await t('updating a missing entry rejects and writes nothing', async () => {
  const n = (await M.dbAll('responses')).length;
  await assert.rejects(() => M.updateResponse('9999999', { answers: {} }));
  assert.strictEqual((await M.dbAll('responses')).length, n);
});

await t('counter repairs itself after a restore', async () => {
  await M.tx(['counters'], 'readwrite', a => { a.counters.put({ year: new Date().getFullYear(), seq: 3 }); });
  await M.repairCounters();
  const id = await M.createResponse({ questionnaireId: 'q1', questionnaireVersion: 1, answers: {}, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' });
  assert.strictEqual(id, yy + '00025', 'got ' + id);
});

await t('responsesFor filters by questionnaire', async () => {
  const r = await M.responsesFor('q2');
  assert.strictEqual(r.length, 20);
});

await t('saving a questionnaire writes a version snapshot', async () => {
  const q = { id: 'qa', title: 'Test form', version: 1, targetCount: 10, questions: [{ id: 'x1', order: 0, type: 'short_text', label: 'Name', required: true }] };
  await M.saveQuestionnaire(q);
  const snap = await M.getSnapshot('qa', 1);
  assert.strictEqual(snap.questions[0].label, 'Name');
  const q2 = { ...q, questions: [{ id: 'x2', order: 0, type: 'number', label: 'Age', required: false }] };
  const saved = await M.saveQuestionnaire(q2, { bumpVersion: true });
  assert.strictEqual(saved.version, 2);
  const s1 = await M.getSnapshot('qa', 1), s2 = await M.getSnapshot('qa', 2);
  assert.strictEqual(s1.questions[0].label, 'Name', 'old snapshot was corrupted');
  assert.strictEqual(s2.questions[0].label, 'Age');
});

await t('signature detects structural change only', () => {
  const a = [{ id: '1', type: 'short_text', label: 'A', required: true, order: 0 }];
  const b = [{ id: '1', type: 'short_text', label: 'A', required: true, order: 0 }];
  const c = [{ id: '1', type: 'short_text', label: 'A!', required: true, order: 0 }];
  assert.strictEqual(M.questionsSignature(a), M.questionsSignature(b));
  assert.notStrictEqual(M.questionsSignature(a), M.questionsSignature(c));
});

await t('export columns include removed questions from old versions', async () => {
  const qn = { id: 'qa', title: 'Test form', version: 2, questions: [{ id: 'x2', label: 'Age' }] };
  const resp = [
    { entryId: '2600001', questionnaireId: 'qa', questionnaireVersion: 1, answers: { x1: 'Mustofa' }, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', syncStatus: 'synced' },
    { entryId: '2600002', questionnaireId: 'qa', questionnaireVersion: 2, answers: { x2: 24 }, createdAt: '2026-01-02T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z', syncStatus: 'local' }
  ];
  const cols = await M.columnsFor(qn, resp);
  assert.deepStrictEqual(cols.map(c => c.label), ['Age', 'Name (removed)']);
  const rows = M.buildRows(qn, resp, cols, 'Mustofa');
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0][1], 'Entry ID');
  assert.strictEqual(rows[1][1], '2600001');
  assert.strictEqual(rows[1][rows[0].indexOf('Name (removed)')], 'Mustofa');
  assert.strictEqual(rows[2][rows[0].indexOf('Age')], 24);
  assert.strictEqual(rows[1][rows[0].indexOf('Age')], '', 'missing answers must be blank, not shifted');
});

await t('photo answers export as a marker, arrays join', () => {
  assert.strictEqual(M.cellValue('data:image/jpeg;base64,AAAA'), '[photo]');
  assert.strictEqual(M.cellValue(['a', 'b']), 'a, b');
  assert.strictEqual(M.cellValue(undefined), '');
  assert.strictEqual(M.cellValue(0), 0);
});

await t('settings round-trip', async () => {
  await M.setSetting('interviewer', 'Mustofa');
  await M.setSetting('activeQuestionnaireId', 'qa');
  const s = await M.getSettings();
  assert.strictEqual(s.interviewer, 'Mustofa');
  assert.strictEqual(s.activeQuestionnaireId, 'qa');
  assert.strictEqual(s.sheetUrl, '');
});

await t('backup restore merges without losing existing rows', async () => {
  const before = (await M.dbAll('responses')).length;
  await M.restoreAll({
    app: 'surveyscholar', stores: {
      responses: [{ entryId: '9900001', questionnaireId: 'qa', questionnaireVersion: 1, answers: {}, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' }]
    }
  }, 'merge');
  const after = await M.dbAll('responses');
  assert.strictEqual(after.length, before + 1);
});

await t('rejects a foreign backup file', async () => {
  await assert.rejects(async () => M.restoreAll({ app: 'other' }, 'merge'));
});


/* ===================== soft delete ===================== */

const mk = (over = {}) => ({ questionnaireId: 'qd', questionnaireVersion: 1, answers: { a: 'x' },
  createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local', ...over });

await t('soft delete flags the record and keeps it in the store', async () => {
  const id = await M.createResponse(mk());
  await M.softDelete(id);
  const r = await M.dbGet('responses', id);
  assert.strictEqual(r.isDeleted, true);
  assert.ok(r.deletedAt);
  assert.strictEqual(r.answers.a, 'x', 'answers must survive a soft delete');
  assert.strictEqual(r.syncStatus, 'local', 'deletion must be queued for sync');
  assert.strictEqual(M.isLive(r), false);
});

await t('deleted entry disappears from live lists but the ID is never reused', async () => {
  const before = await M.dbAll('responses');
  const liveBefore = M.liveOnly(before).length;
  const id = await M.createResponse(mk());
  await M.softDelete(id);
  const after = await M.dbAll('responses');
  assert.strictEqual(M.liveOnly(after).length, liveBefore, 'live count changed after create+delete');
  assert.strictEqual(after.length, before.length + 1, 'record was physically removed');
  const next = await M.createResponse(mk());
  assert.notStrictEqual(next, id);
  assert.strictEqual(parseInt(next.slice(2), 10), parseInt(id.slice(2), 10) + 1, 'sequence rewound');
});

await t('restore brings it back and re-queues the sync', async () => {
  const id = await M.createResponse(mk());
  await M.softDelete(id);
  await M.updateResponse(id, { syncStatus: 'synced' });
  await M.restoreEntry(id);
  const r = await M.dbGet('responses', id);
  assert.strictEqual(r.isDeleted, false);
  assert.strictEqual(r.deletedAt, null);
  assert.strictEqual(r.syncStatus, 'local');
  assert.strictEqual(M.isLive(r), true);
});

await t('purge removes only synced deletions older than 30 days', async () => {
  const old = M.PURGE_DAYS + 1, day = 86400000;
  const [a, b, c, d] = await Promise.all([mk(), mk(), mk(), mk()].map(M.createResponse));
  await M.updateResponse(a, { isDeleted: true, deletedAt: new Date(Date.now() - old * day).toISOString(), syncStatus: 'synced' });
  await M.updateResponse(b, { isDeleted: true, deletedAt: new Date(Date.now() - old * day).toISOString(), syncStatus: 'local' });
  await M.updateResponse(c, { isDeleted: true, deletedAt: M.nowISO(), syncStatus: 'synced' });
  const n = await M.purgeOldDeleted(true);
  assert.strictEqual(n, 1, 'purged ' + n + ', expected 1');
  assert.strictEqual(await M.dbGet('responses', a), undefined);
  assert.ok(await M.dbGet('responses', b), 'unsynced deletion must not be purged while a sheet is configured');
  assert.ok(await M.dbGet('responses', c), 'recent deletion must not be purged');
  assert.ok(await M.dbGet('responses', d), 'live entry must never be purged');
  const n2 = await M.purgeOldDeleted(false);
  assert.strictEqual(n2, 1, 'with no sheet configured the old unsynced deletion should purge');
  assert.ok(await M.dbGet('responses', d), 'live entry still untouched');
});

await t('sync payload carries the deletion flag', async () => {
  const qn = { id: 'qd', title: 'D', version: 1 };
  const qs = [{ id: 'a', label: 'A', order: 0, type: 'short_text' }];
  const live = M.buildSyncPayload({ entryId: '2600009', createdAt: 'c', updatedAt: 'u', answers: { a: 'yes' } }, qn, qs, 'M');
  assert.strictEqual(live.entry.deleted, false);
  assert.strictEqual(live.entry.answers.a, 'yes');
  const del = M.buildSyncPayload({ entryId: '2600009', createdAt: 'c', updatedAt: 'u', isDeleted: true, deletedAt: 'z', answers: { a: 'yes' } }, qn, qs, 'M');
  assert.strictEqual(del.entry.deleted, true);
  assert.strictEqual(del.entry.deletedAt, 'z');
  assert.strictEqual(del.entry.entryId, live.entry.entryId, 'same ID must be reused so the sheet upserts');
});

await t('exports and counts built from liveOnly exclude deletions', async () => {
  const qn = { id: 'qe', title: 'E', version: 1, questions: [{ id: 'a', label: 'A' }] };
  const all = [
    { entryId: '2600101', questionnaireId: 'qe', questionnaireVersion: 1, answers: { a: '1' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', syncStatus: 'synced' },
    { entryId: '2600102', questionnaireId: 'qe', questionnaireVersion: 1, answers: { a: '2' }, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', syncStatus: 'synced', isDeleted: true, deletedAt: '2026-01-03T00:00:00Z' }
  ];
  const live = M.liveOnly(all);
  assert.strictEqual(live.length, 1);
  const cols = await M.columnsFor(qn, live);
  const rows = M.buildRows(qn, live, cols, 'M');
  assert.strictEqual(rows.length, 2, 'header + 1 live row');
  assert.strictEqual(rows[1][1], '2600101');
  const target = 4;
  assert.strictEqual(Math.round(live.length / target * 100), 25, 'achieved % must use live count');
});

/* ===================== template import ===================== */

const HDR = M.IMPORT_HEADERS;
const sheet = rows => [HDR, ...rows];

await t('the shipped template validates cleanly', () => {
  const r = M.validateImportRows(M.templateAoa());
  assert.deepStrictEqual(r.errors, [], JSON.stringify(r.errors));
  assert.strictEqual(r.questions.length, 17);
  assert.deepStrictEqual(r.questions.map(q => q.order), [...Array(17).keys()]);
  assert.strictEqual(r.questions.filter(q => M.isSection(q.type)).length, 4);
  assert.strictEqual(M.answerable(r.questions).length, 13);
  const scale = r.questions.find(q => q.type === 'linear_scale');
  assert.strictEqual(scale.min, 1); assert.strictEqual(scale.max, 5);
  assert.deepStrictEqual(r.questions.find(q => q.type === 'multiple_choice').options, ['Male','Female','Other']);
  assert.ok(r.questions.some(q => q.imageFilename === 'q17_cards.png'));
  // every section row is inert
  r.questions.filter(q => M.isSection(q.type)).forEach(q => {
    assert.strictEqual(q.required, false);
    assert.strictEqual(q.options, undefined);
    assert.ok(q.label);
  });
  // the conditional rows resolved to real earlier ids
  const cond = r.questions.filter(q => q.showIf);
  assert.strictEqual(cond.length, 5, 'expected 5 conditional rows, got ' + cond.length);
  cond.forEach(q => {
    const parent = r.questions.find(x => x.id === q.showIf.q);
    assert.ok(parent, 'condition points nowhere');
    assert.ok(r.questions.indexOf(parent) < r.questions.indexOf(q), 'parent must come first');
    assert.ok(!M.isSection(parent.type));
  });
});

await t('headers are matched case/spacing insensitively', () => {
  const map = M.mapColumns(['order', 'QUESTION TYPE', ' Label ', 'Options', 'required', 'Image_Filename']);
  assert.deepStrictEqual(map, { order: 0, type: 1, label: 2, options: 3, required: 4, image: 5 });
});

await t('missing header row is rejected outright', () => {
  const r = M.validateImportRows([['A','B','C'], [1,'short_text','Name']]);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.questions.length, 0);
});

await t('empty sheet is rejected', () => {
  assert.strictEqual(M.validateImportRows([]).errors.length, 1);
  assert.strictEqual(M.validateImportRows(sheet([])).errors.length, 1);
});

await t('unknown type, empty label, bad Required each flag their own row', () => {
  const r = M.validateImportRows(sheet([
    [1, 'text', 'Name', '', 'Y', ''],
    [2, 'short_text', '', '', 'Y', ''],
    [3, 'short_text', 'Village', '', 'maybe', ''],
    [4, 'short_text', 'Fine row', '', 'N', '']
  ]));
  assert.strictEqual(r.errors.length, 3);
  assert.deepStrictEqual(r.errors.map(e => e.row), [2, 3, 4]);
  assert.ok(/not a Question Type/.test(r.errors[0].message));
  assert.strictEqual(r.questions.length, 1, 'only the clean row survives — and the UI blocks import anyway');
});

await t('choice types without options are errors, not silent fixes', () => {
  const r = M.validateImportRows(sheet([
    [1, 'multiple_choice', 'Sex', '', 'Y', ''],
    [2, 'checkbox', 'Symptoms', '   ', 'N', ''],
    [3, 'dropdown', 'Division', 'Rajshahi', 'Y', '']
  ]));
  assert.strictEqual(r.errors.length, 2);
  assert.strictEqual(r.warnings.filter(w => /Only one option/.test(w.message)).length, 1);
});

await t('linear_scale range rules', () => {
  const bad = M.validateImportRows(sheet([
    [1, 'linear_scale', 'A', '1', 'N', ''],
    [2, 'linear_scale', 'B', '5;5', 'N', ''],
    [3, 'linear_scale', 'C', '1;100', 'N', ''],
    [4, 'linear_scale', 'D', 'low;high', 'N', '']
  ]));
  assert.strictEqual(bad.errors.length, 4);
  const ok = M.validateImportRows(sheet([[1, 'linear_scale', 'E', ' 0 ; 10 ', 'N', '']]));
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.questions[0].min, 0);
  assert.strictEqual(ok.questions[0].max, 10);
});

await t('blank rows are skipped, not treated as errors', () => {
  const r = M.validateImportRows(sheet([
    [1, 'short_text', 'Name', '', 'Y', ''],
    ['', '', '', '', '', ''],
    [],
    [2, 'number', 'Age', '', 'Y', '']
  ]));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.questions.length, 2);
});

await t('rows are ordered by the Order column, duplicates warned', () => {
  const r = M.validateImportRows(sheet([
    [3, 'short_text', 'Third', '', 'N', ''],
    [1, 'short_text', 'First', '', 'N', ''],
    [1, 'short_text', 'Also first', '', 'N', '']
  ]));
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.questions.map(q => q.label), ['First', 'Also first', 'Third']);
  assert.strictEqual(r.warnings.filter(w => /used twice/.test(w.message)).length, 1);
  assert.strictEqual(M.validateImportRows(sheet([[1.5, 'short_text', 'x', '', 'N', '']])).errors.length, 1);
});

await t('options on a non-choice type warn but import', () => {
  const r = M.validateImportRows(sheet([[1, 'short_text', 'Name', 'a;b', 'N', '']]));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.questions[0].options, undefined);
});

await t('every question gets a unique id and a clean schema', () => {
  const r = M.validateImportRows(M.templateAoa());
  const ids = r.questions.map(q => q.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  r.questions.forEach(q => {
    assert.ok(q.label && q.type !== undefined && typeof q.required === 'boolean' && typeof q.order === 'number');
  });
});

/* ===================== document import ===================== */

const DOC = [
  '1. What is the name of the respondent? ______',
  '2. Sex of respondent (select one)',
  '   a) Male',
  '   b) Female',
  '3. Which symptoms occurred in the last two weeks? (select all that apply)',
  '   a. Fever',
  '   b. Diarrhoea',
  '   c. Cough',
  '4. How many children under five live in this household?',
  '5. Please rate the service on a scale of 1 to 5',
  '6. Please describe any difficulty you faced (optional)',
  '7. Ward name'
].join('\n');

await t('document parser finds every numbered question', () => {
  const r = M.parseDocumentText(DOC);
  assert.strictEqual(r.questions.length, 7, 'got ' + r.questions.length);
  assert.deepStrictEqual(r.questions.map(q => q.order), [0,1,2,3,4,5,6]);
});

await t('document parser assigns types from keywords and structure', () => {
  const q = M.parseDocumentText(DOC).questions;
  assert.strictEqual(q[1].type, 'multiple_choice');
  assert.deepStrictEqual(q[1].options, ['Male', 'Female']);
  assert.strictEqual(q[2].type, 'checkbox');
  assert.strictEqual(q[2].options.length, 3);
  assert.strictEqual(q[3].type, 'number');
  assert.strictEqual(q[4].type, 'linear_scale');
  assert.strictEqual(q[4].min, 1);
  assert.strictEqual(q[4].max, 5);
  assert.strictEqual(q[5].type, 'long_text');
  assert.strictEqual(q[5].required, false, '"optional" must clear required');
  assert.strictEqual(q[0].required, true);
});

await t('uncertain guesses are flagged for review', () => {
  const r = M.parseDocumentText(DOC);
  const flagged = r.questions.filter(q => q._uncertain).map(q => q.label);
  assert.ok(r.uncertain >= 1, 'nothing was flagged');
  assert.ok(flagged.some(l => /Ward name/.test(l)), 'a bare line should be flagged: ' + flagged.join(' | '));
  assert.strictEqual(r.questions[1]._uncertain, false, 'an explicit "select one" is not a guess');
});

await t('parser cleans numbering, instructions and blank lines', () => {
  const q = M.parseDocumentText(DOC).questions;
  assert.ok(!/^\d/.test(q[0].label));
  assert.ok(!/select all that apply/i.test(q[2].label), q[2].label);
  assert.ok(!/_{3,}/.test(q[0].label));
  assert.strictEqual(M.parseDocumentText('').questions.length, 0);
  assert.strictEqual(M.parseDocumentText(null).questions.length, 0);
  assert.strictEqual(M.parseDocumentText('Just a paragraph of prose with no questions.').questions.length, 0);
});

await t('a choice type never survives without options', () => {
  const q = M.parseDocumentText('1. Pick one (select one)\n\n2. Next question?').questions;
  assert.ok(!['multiple_choice','checkbox','dropdown'].includes(q[0].type) || (q[0].options || []).length > 0);
  assert.strictEqual(q[0]._uncertain, true);
});

/* ===================== import commit ===================== */

await t('images are matched by filename, case-insensitively', () => {
  const qs = [{ id: '1', label: 'A', imageFilename: 'Q10_Cards.PNG' }, { id: '2', label: 'B' }];
  const out = M.applyImages(qs, { 'q10_cards.png': 'data:image/jpeg;base64,zz' });
  assert.strictEqual(out[0].imageUrl, 'data:image/jpeg;base64,zz');
  assert.strictEqual(out[1].imageUrl, undefined);
  assert.strictEqual(qs[0].imageUrl, undefined, 'applyImages must not mutate its input');
});

await t('draft flags never reach the saved schema', () => {
  const clean = M.stripDraftFlags([{ id: '1', label: 'A', type: 'short_text', _uncertain: true, imageFilename: 'x.png', imageUrl: 'data:…' }]);
  assert.strictEqual(clean[0]._uncertain, undefined);
  assert.strictEqual(clean[0].imageFilename, undefined);
  assert.strictEqual(clean[0].imageUrl, 'data:…', 'a matched image must be kept');
});

await t('import never overwrites an existing questionnaire name', () => {
  const existing = [{ title: 'Household survey' }, { title: 'Household survey (2)' }];
  assert.strictEqual(M.uniqueTitle('Household survey', existing), 'Household survey (3)');
  assert.strictEqual(M.uniqueTitle('  household SURVEY  ', existing), 'household SURVEY (3)');
  assert.strictEqual(M.uniqueTitle('New form', existing), 'New form');
  assert.strictEqual(M.uniqueTitle('', []), 'Imported questionnaire');
});

await t('an imported questionnaire is a normal v1 questionnaire with a snapshot', async () => {
  const r = M.validateImportRows(M.templateAoa());
  const saved = await M.saveQuestionnaire({ id: 'qimp', title: 'Imported form', description: '', version: 1,
    targetCount: 0, questions: M.stripDraftFlags(r.questions), createdAt: M.nowISO(), updatedAt: M.nowISO() });
  assert.strictEqual(saved.version, 1);
  const snap = await M.getSnapshot('qimp', 1);
  assert.strictEqual(snap.questions.length, 17);
  assert.ok(snap.questions.some(q => q.showIf), 'conditions must survive the snapshot');
  const bumped = await M.saveQuestionnaire({ ...saved, questions: saved.questions.slice(0, 5) }, { bumpVersion: true });
  assert.strictEqual(bumped.version, 2);
  assert.strictEqual((await M.getSnapshot('qimp', 1)).questions.length, 17, 'v1 snapshot must survive editing an import');
});

/* ===================== sync ===================== */

await t('sync marks entries synced, and a failure is flagged and retryable', async () => {
  // clean slate for a predictable sync run
  const existing = await M.dbAll('responses');
  await M.tx(['responses', 'questionnaires'], 'readwrite', a => {
    existing.forEach(r => a.responses.delete(r.entryId));
    a.questionnaires.put({ id: 'qs', title: 'Sync form', version: 1, questions: [{ id: 'a', label: 'A', order: 0, type: 'short_text' }] });
  });
  await M.saveQuestionnaire({ id: 'qs', title: 'Sync form', version: 1, questions: [{ id: 'a', label: 'A', order: 0, type: 'short_text' }] });
  await M.setSetting('sheetUrl', 'https://script.google.com/macros/s/abc/exec');

  const good = await M.createResponse({ questionnaireId: 'qs', questionnaireVersion: 1, answers: { a: 'ok' }, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' });
  const bad = await M.createResponse({ questionnaireId: 'qs', questionnaireVersion: 1, answers: { a: 'boom' }, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' });
  const posted = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    posted.push({ url, contentType: opts.headers['Content-Type'], body });
    if (body.entry && body.entry.entryId === bad) return { ok: false, status: 500, text: async () => 'server exploded' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  };

  const r = await M.syncPending();
  assert.deepStrictEqual([r.total, r.ok, r.fail], [2, 1, 1], JSON.stringify(r));
  assert.strictEqual((await M.dbGet('responses', good)).syncStatus, 'synced');
  const failed = await M.dbGet('responses', bad);
  assert.strictEqual(failed.syncStatus, 'failed');
  assert.ok(failed.syncError, 'failure must record why');
  assert.ok(/text\/plain/.test(posted[0].contentType), 'must avoid a CORS preflight Apps Script cannot answer');
  assert.strictEqual(posted[0].body.questions[0].label, 'A');

  // retry: the previously failed one is picked up again, nothing is dropped
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) });
  const r2 = await M.syncPending();
  assert.deepStrictEqual([r2.total, r2.ok, r2.fail], [1, 1, 0]);
  assert.strictEqual((await M.dbGet('responses', bad)).syncStatus, 'synced');
  assert.strictEqual((await M.syncPending()).total, 0, 'a synced entry must not be re-sent');
});

await t('a deletion syncs as the same entry ID with the deleted flag', async () => {
  const all0 = M.liveOnly(await M.dbAll('responses'));
  const id = all0[0].entryId;
  await M.softDelete(id);
  const sent = [];
  globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
  const r = await M.syncPending();
  assert.strictEqual(r.total, 1, 'a pending deletion must be queued for sync');
  assert.strictEqual(sent[0].entry.entryId, id, 'deletion must reuse the ID so the sheet upserts, not append');
  assert.strictEqual(sent[0].entry.deleted, true);
  assert.strictEqual((await M.dbGet('responses', id)).syncStatus, 'synced');
});

await t('sync refuses to run without a sheet link, leaving data untouched', async () => {
  await M.setSetting('sheetUrl', '');
  const before = await M.dbAll('responses');
  await M.createResponse({ questionnaireId: 'qs', questionnaireVersion: 1, answers: { a: 'z' }, createdAt: M.nowISO(), updatedAt: M.nowISO(), syncStatus: 'local' });
  await assert.rejects(() => M.syncPending(), /Sheet link/);
  const after = await M.dbAll('responses');
  assert.strictEqual(after.length, before.length + 1);
  assert.ok(after.every(r => r.syncStatus !== 'failed'), 'a missing link must not mark entries failed');
});

/* ===================== sections and conditional logic ===================== */

const FORM = [
  { id: 's1', order: 0, type: 'section', label: 'Identification' },
  { id: 'a', order: 1, type: 'short_text', label: 'Name', required: true },
  { id: 'b', order: 2, type: 'multiple_choice', label: 'Any illness?', options: ['Yes', 'No'], required: true },
  { id: 'c', order: 3, type: 'number', label: 'How many days?', required: true, showIf: { q: 'b', op: 'any', values: ['Yes'] } },
  { id: 'd', order: 4, type: 'multiple_choice', label: 'Treatment sought?', options: ['Yes', 'No'], required: true, showIf: { q: 'b', op: 'any', values: ['Yes'] } },
  { id: 'e', order: 5, type: 'short_text', label: 'Why not?', required: true, showIf: { q: 'd', op: 'any', values: ['No'] } },
  { id: 's2', order: 6, type: 'section', label: 'Satisfaction', showIf: { q: 'b', op: 'any', values: ['Yes'] } },
  { id: 'f', order: 7, type: 'linear_scale', label: 'Rating', min: 1, max: 5, required: true },
  { id: 'g', order: 8, type: 'long_text', label: 'What to improve?', showIf: { q: 'f', op: 'any', values: ['1', '2'] } },
  { id: 's3', order: 9, type: 'section', label: 'Closing' },
  { id: 'h', order: 10, type: 'checkbox', label: 'Symptoms', options: ['Fever', 'Cough'] },
  { id: 'i', order: 11, type: 'short_text', label: 'Which fever medicine?', showIf: { q: 'h', op: 'any', values: ['Fever'] } }
];
const vis = a => M.visibleElements(FORM, a).map(q => q.id);

await t('with nothing answered, only unconditional rows show', () => {
  assert.deepStrictEqual(vis({}), ['s1', 'a', 'b', 's3', 'h']);
});

await t('answering the parent reveals its children and the conditional section', () => {
  assert.deepStrictEqual(vis({ b: 'Yes' }), ['s1', 'a', 'b', 'c', 'd', 's2', 'f', 's3', 'h']);
  assert.deepStrictEqual(vis({ b: 'No' }), ['s1', 'a', 'b', 's3', 'h']);
});

await t('a hidden section hides every row under it, up to the next section', () => {
  const shown = vis({ b: 'No', f: 1 });
  assert.ok(!shown.includes('s2') && !shown.includes('f') && !shown.includes('g'), shown.join(','));
  assert.ok(shown.includes('s3') && shown.includes('h'), 'the next section must still appear');
});

await t('conditions cascade — a child of a hidden parent stays hidden', () => {
  // d says "No" but b says "No", so d is hidden; e must not surface on d's stale answer
  assert.ok(!vis({ b: 'No', d: 'No' }).includes('e'), 'stale answer of a hidden parent leaked through');
  assert.ok(vis({ b: 'Yes', d: 'No' }).includes('e'));
});

await t('checkbox and scale parents match on any selected value', () => {
  assert.ok(vis({ h: ['Cough'] }).indexOf('i') < 0);
  assert.ok(vis({ h: ['Cough', 'Fever'] }).includes('i'));
  assert.ok(vis({ b: 'Yes', f: 2 }).includes('g'), 'numbers must compare as strings');
  assert.ok(!vis({ b: 'Yes', f: 5 }).includes('g'));
});

await t('the "is not one of" and "answered" operators behave', () => {
  const ans = { b: 'No' };
  assert.strictEqual(M.conditionMet({ q: 'b', op: 'none', values: ['Yes'] }, ans), true);
  assert.strictEqual(M.conditionMet({ q: 'b', op: 'none', values: ['No'] }, ans), false);
  assert.strictEqual(M.conditionMet({ q: 'b', op: 'none', values: ['Yes'] }, {}), false, 'unanswered parent shows nothing');
  assert.strictEqual(M.conditionMet({ q: 'b', op: 'answered', values: [] }, ans), true);
  assert.strictEqual(M.conditionMet({ q: 'b', op: 'answered', values: [] }, { b: '' }), false);
  assert.strictEqual(M.conditionMet(undefined, {}), true, 'no condition always shows');
});

await t('required validation ignores questions that are hidden', () => {
  assert.deepStrictEqual(Object.keys(M.validate(FORM, {})), ['a', 'b']);
  assert.deepStrictEqual(Object.keys(M.validate(FORM, { a: 'x', b: 'No' })), []);
  assert.deepStrictEqual(Object.keys(M.validate(FORM, { a: 'x', b: 'Yes' })).sort(), ['c', 'd', 'f']);
  assert.deepStrictEqual(Object.keys(M.validate(FORM, { a: 'x', b: 'Yes', c: 2, d: 'No', f: 3 })), ['e']);
});

await t('answers to hidden questions are pruned before saving', () => {
  const messy = { a: 'Rahim', b: 'No', c: 9, d: 'No', e: 'stale reason', f: 4, g: 'stale text', h: ['Cough'], i: 'stale med' };
  const kept = M.pruneHiddenAnswers(FORM, messy);
  assert.deepStrictEqual(Object.keys(kept).sort(), ['a', 'b', 'h']);
  assert.strictEqual(kept.a, 'Rahim');
  // and nothing is lost when everything is legitimately visible
  const good = { a: 'Rahim', b: 'Yes', c: 3, d: 'No', e: 'too far', f: 1, g: 'more staff', h: ['Fever'], i: 'Paracetamol' };
  assert.deepStrictEqual(Object.keys(M.pruneHiddenAnswers(FORM, good)).sort(), Object.keys(good).sort());
});

await t('sections never become export columns or sync fields', async () => {
  const qn = { id: 'qsec', title: 'Sec', version: 1, questions: FORM };
  const resp = [{ entryId: '2600500', questionnaireId: 'qsec', questionnaireVersion: 1, answers: { a: 'Rahim', b: 'No' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', syncStatus: 'local' }];
  const cols = await M.columnsFor(qn, resp);
  assert.strictEqual(cols.length, M.answerable(FORM).length);
  assert.ok(!cols.some(c => /Identification|Satisfaction|Closing/.test(c.label)), cols.map(c => c.label).join(','));
  const rows = M.buildRows(qn, resp, cols, 'M');
  assert.strictEqual(rows[0].length, 6 + cols.length);
  const payload = M.buildSyncPayload(resp[0], qn, FORM, 'M');
  assert.strictEqual(payload.questions.length, M.answerable(FORM).length);
  assert.ok(!payload.questions.some(q => q.type === 'section'));
  assert.strictEqual(payload.entry.answers.c, '', 'a hidden question still gets an empty cell, keeping columns aligned');
});

await t('sanitizeConditions drops references that can no longer hold', () => {
  const withoutParent = FORM.filter(q => q.id !== 'b');
  const r = M.sanitizeConditions(withoutParent);
  assert.ok(r.cleared.length >= 3, 'dependents of a deleted parent must be cleared: ' + r.cleared.join(','));
  assert.ok(!r.questions.some(q => q.showIf && q.showIf.q === 'b'));
  // a child moved above its parent loses the condition rather than never showing
  const swapped = FORM.map(q => q.id === 'c' ? { ...q, order: 0 } : q);
  const r2 = M.sanitizeConditions(swapped);
  assert.ok(r2.cleared.includes('How many days?'), r2.cleared.join(','));
  // a parent turned into a section is no longer answerable
  const sectioned = FORM.map(q => q.id === 'b' ? { ...q, type: 'section' } : q);
  assert.ok(M.sanitizeConditions(sectioned).cleared.length >= 3);
  // an untouched form is left exactly as it is
  assert.deepStrictEqual(M.sanitizeConditions(FORM).cleared, []);
  assert.strictEqual(M.sanitizeConditions(FORM).questions.filter(q => q.showIf).length, 6);
});

await t('condition summaries read in plain words', () => {
  assert.strictEqual(M.condSummary(FORM[3], FORM), 'Shown when “Any illness?” is one of: Yes');
  assert.strictEqual(M.condSummary(FORM[1], FORM), '');
  assert.ok(/removed question/.test(M.condSummary(FORM[3], [])));
});

/* ---- importing sections and skip logic ---- */
const H2 = M.IMPORT_HEADERS;
const sh2 = rows => [H2, ...rows];

await t('import resolves Show If by Order number', () => {
  const r = M.validateImportRows(sh2([
    [1, 'section', 'Part A', '', '', '', '', '', ''],
    [2, 'multiple_choice', 'Any illness?', 'Yes;No', 'Y', '', '', '', ''],
    [3, 'number', 'How many days?', '', 'Y', '', 2, 'is one of', 'Yes'],
    [4, 'short_text', 'Why not?', '', 'N', '', 2, 'is not one of', 'Yes'],
    [5, 'short_text', 'Anything else', '', 'N', '', 2, 'answered', '']
  ]));
  assert.deepStrictEqual(r.errors, [], JSON.stringify(r.errors));
  const [sec, parent, days, why, more] = r.questions;
  assert.strictEqual(sec.type, 'section');
  assert.deepStrictEqual(days.showIf, { q: parent.id, op: 'any', values: ['Yes'] });
  assert.strictEqual(why.showIf.op, 'none');
  assert.deepStrictEqual(more.showIf, { q: parent.id, op: 'answered', values: [] });
  assert.deepStrictEqual(M.visibleElements(r.questions, {}).map(q => q.label), ['Part A', 'Any illness?']);
  assert.deepStrictEqual(M.visibleElements(r.questions, { [parent.id]: 'Yes' }).map(q => q.label),
    ['Part A', 'Any illness?', 'How many days?', 'Anything else']);
});

await t('import rejects broken skip logic instead of guessing', () => {
  const r = M.validateImportRows(sh2([
    [1, 'multiple_choice', 'Illness?', 'Yes;No', 'Y', '', '', '', ''],
    [2, 'short_text', 'Points forward', '', 'N', '', 4, 'is one of', 'Yes'],
    [3, 'short_text', 'Missing row', '', 'N', '', 9, 'is one of', 'Yes'],
    [4, 'short_text', 'Bad value', '', 'N', '', 1, 'is one of', 'Maybe'],
    [5, 'short_text', 'No values', '', 'N', '', 1, 'is one of', ''],
    [6, 'short_text', 'Bad operator', '', 'N', '', 1, 'sort of', 'Yes'],
    [7, 'short_text', 'Not a number', '', 'N', '', 'the first one', 'is one of', 'Yes']
  ]));
  const msgs = r.errors.map(e => 'R' + e.row + ':' + e.message);
  assert.strictEqual(r.errors.length, 6, msgs.join(' | '));
  assert.ok(msgs.some(m => /^R3.*comes after this row/.test(m)), msgs.join(' | '));
  assert.ok(msgs.some(m => /^R4.*does not match any row/.test(m)));
  assert.ok(msgs.some(m => /^R5.*not options of question 1/.test(m)));
  assert.ok(msgs.some(m => /^R6.*Show If Values is empty/.test(m)));
  assert.ok(msgs.some(m => /^R7.*not understood/.test(m)));
  assert.ok(msgs.some(m => /^R8.*Order number of an earlier question/.test(m)));
});

await t('a condition cannot point at a section heading', () => {
  const r = M.validateImportRows(sh2([
    [1, 'section', 'Part A', '', '', '', '', '', ''],
    [2, 'short_text', 'Child', '', 'N', '', 1, 'is one of', 'Yes']
  ]));
  assert.strictEqual(r.errors.length, 1);
  assert.ok(/section heading/.test(r.errors[0].message));
});

await t('scale parents accept only in-range numeric values', () => {
  const ok = M.validateImportRows(sh2([
    [1, 'linear_scale', 'Rating', '1;5', 'N', '', '', '', ''],
    [2, 'long_text', 'Why low?', '', 'N', '', 1, 'is one of', '1;2']
  ]));
  assert.deepStrictEqual(ok.errors, []);
  const bad = M.validateImportRows(sh2([
    [1, 'linear_scale', 'Rating', '1;5', 'N', '', '', '', ''],
    [2, 'long_text', 'Why low?', '', 'N', '', 1, 'is one of', '9']
  ]));
  assert.strictEqual(bad.errors.length, 1);
  assert.ok(/between 1 and 5/.test(bad.errors[0].message));
});

await t('document parser finds headings and "If yes" sub-questions', () => {
  const doc = [
    'SECTION A: HOUSEHOLD',
    '1. Name of respondent ______',
    '2. Did any child have fever? (select one)',
    '   a) Yes',
    '   b) No',
    '3. If yes, how many days did it last?',
    'Part B: Treatment',
    '4. Was treatment sought? (select one)',
    '   a) Yes',
    '   b) No',
    '5. If no, why not?'
  ].join('\n');
  const r = M.parseDocumentText(doc);
  assert.strictEqual(r.sections, 2, 'headings: ' + r.questions.filter(q => M.isSection(q.type)).map(q => q.label).join(','));
  const labels = r.questions.map(q => q.label);
  assert.ok(labels.includes('HOUSEHOLD') || labels.includes('SECTION A: HOUSEHOLD'), labels.join(' | '));
  assert.ok(labels.includes('Treatment'), labels.join(' | '));
  assert.strictEqual(r.conditional, 2, 'expected 2 inferred conditions');
  const days = r.questions.find(q => /how many days/i.test(q.label));
  assert.ok(!/^if yes/i.test(days.label), 'the "If yes," prefix must move into the condition: ' + days.label);
  const fever = r.questions.find(q => /fever/i.test(q.label));
  assert.deepStrictEqual(days.showIf, { q: fever.id, op: 'any', values: ['Yes'] });
  const why = r.questions.find(q => /why not/i.test(q.label));
  const sought = r.questions.find(q => /treatment sought/i.test(q.label));
  assert.deepStrictEqual(why.showIf, { q: sought.id, op: 'any', values: ['No'] });
  // and the parsed form actually behaves
  assert.ok(!M.visibleElements(r.questions, {}).some(q => q.id === days.id));
  assert.ok(M.visibleElements(r.questions, { [fever.id]: 'Yes' }).some(q => q.id === days.id));
});

await t('parsed conditions never point forward or at a missing row', () => {
  const r = M.parseDocumentText('1. If yes, explain\n2. Did it happen? (select one)\n   a) Yes\n   b) No');
  r.questions.forEach((q, i) => {
    if (!q.showIf) return;
    const pi = r.questions.findIndex(x => x.id === q.showIf.q);
    assert.ok(pi >= 0 && pi < i, 'dangling or forward condition survived parsing');
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
