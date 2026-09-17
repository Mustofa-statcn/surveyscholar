# Architecture

> Developer reference. For the day-to-day guide see [user-guide.md](user-guide.md);
> for deployment see [deployment.md](deployment.md).

Offline-first survey collection for a single interviewer. **IndexedDB on the phone is the source of truth; Google Sheets is a mirror.** Every design decision below follows from that one sentence.

---

## 1. Files

| File | What it is |
|---|---|
| `index.html` | The entire app — styles, data layer, sync, import, UI. No build step, no bundler. |
| `sw.js` | Service worker: caches the app shell and the CDN libraries so it launches offline. |
| `manifest.json` | PWA manifest (installable, standalone, portrait). |
| `icon-192.png`, `icon-512.png` | App icons. |
| `apps-script.gs` | Paste into your Google Sheet's Apps Script editor. Generated from the copy embedded in `index.html`, so the two can't drift. |
| `test-data-layer.mjs` | 60 Node tests: IDs, edits, soft delete, sync, visibility logic, import parsing. |
| `test-ui.mjs` | 37 tests that mount the real app in jsdom and click through it. |

```
npm i fake-indexeddb jsdom react react-dom htm xlsx
node test-data-layer.mjs && node test-ui.mjs
```

Both suites read `index.html` directly and evaluate the real code — there is no second copy of the logic to keep in sync.

## 2. Deploy

> Full instructions, including Actions-based publishing and custom domains, are in
> [deployment.md](deployment.md).

1. Put every file in the root of a repo (or `/docs`).
2. Settings → Pages → Source `main`, folder `/`.
3. Open `https://<user>.github.io/<repo>/` on the phone → menu → **Add to Home screen**.

HTTPS is required for the service worker. Open it once online so the shell and libraries cache; after that it runs in airplane mode.

### Connect the sheet

Sheet → Extensions → Apps Script → paste `apps-script.gs` → Deploy → New deployment → **Web app**, Execute as **Me**, Access **Anyone** → copy the `/exec` URL into Functions → Web app URL → Test connection.

---

## 3. Stack, and why

| Choice | Instead of | Reason |
|---|---|---|
| React 18 + `htm` from CDN | React + Vite | No build step, so the repo *is* the deployable. `htm` gives JSX-like templates parsed at runtime; the phone loads ~40 KB instead of running Babel. |
| Plain IndexedDB | Dexie / `idb` | Entry-ID generation needs one transaction spanning two stores. Writing it directly makes the atomicity inspectable (~90 lines). |
| Hand-written CSS with tokens | Tailwind | The Tailwind play CDN recompiles CSS on every launch — wrong trade on a field phone. |
| Apps Script web app | Google OAuth | No consent screen, no client secret in a public static file. |
| SheetJS | own xlsx writer | Export must open in real Excel. Not worth reinventing. |

Loaded from CDN and cached by the service worker: React, ReactDOM, htm, SheetJS. Loaded **lazily**, only if you use document import: mammoth (docx), pdf.js (PDF).

---

## 4. Data model

Six IndexedDB stores in database `surveyscholar`, version 1.

| Store | Key | Holds |
|---|---|---|
| `questionnaires` | `id` | The live form, including its current `version`. |
| `versions` | `"<qid>:<version>"` | A frozen copy of `questions` for each version ever saved. |
| `responses` | `entryId` | Every entry, including soft-deleted ones. |
| `counters` | `year` | Last-used sequence number per year. |
| `settings` | `key` | Interviewer name, sheet URL, active questionnaire. |
| `drafts` | `id` | In-progress entries (`new:<qid>` or `entry:<entryId>`). |

```
Questionnaire { id, title, description, version, targetCount, questions[], createdAt, updatedAt }

Question {
  id, order, type, label,
  required, help, imageUrl?,          // answer questions
  options[]?,                         // choice types
  min?, max?, minLabel?, maxLabel?,   // linear_scale / number
  description?,                       // section headings
  showIf? { q, op, values[] }         // conditional display
}

Response {
  entryId,                  // "YY" + 5 digits
  questionnaireId, questionnaireVersion,
  answers { questionId: value },
  createdAt, updatedAt, interviewer,
  syncStatus: local|synced|failed, syncedAt?, syncError?,
  isDeleted?, deletedAt?    // soft delete
}
```

### Invariants

These are the rules the tests defend. Break one and the app is no longer trustworthy.

1. **Entry IDs are unique, sequential per year, and never reused.** Generated inside one read-write transaction over `counters` + `responses`, using `.add()` — a duplicate key aborts the transaction and rolls the counter back. Verified with 20 concurrent writes.
2. **An edit never creates a row.** Same `entryId`, `createdAt` preserved, `updatedAt` refreshed.
3. **Deleting is soft.** The record stays; the ID is never handed out again.
4. **A response is readable forever.** It stores the version it was collected under, and `versions` holds that exact question list.
5. **Nothing is marked synced without a confirmed response** from the script.
6. **Answers to questions the interviewer never saw are never stored.**
7. **A condition may only point at an earlier question.** This makes cycles structurally impossible.

---

## 5. How each piece works

### 5.1 Entry IDs

`createResponse()` opens one transaction, reads the counter for the current year, increments it, writes the counter and the response together. Concurrent saves serialise because IndexedDB queues read-write transactions on the same stores. `repairCounters()` runs at launch and pushes the counter above the highest ID found in `responses` — this is what makes restoring a backup safe.

### 5.2 Versioning

`saveQuestionnaire(q, {bumpVersion})` writes the questionnaire *and* a snapshot into `versions` in one transaction. The builder compares `questionsSignature()` before and after; if the structure changed and responses exist, it asks before bumping. Editing an old entry loads its snapshot, so the form it shows is the form that was asked. Exports append columns for questions that existed in older versions but not now, labelled `(removed)`.

### 5.3 Sections and skip logic

A **section** is a question with `type: 'section'`. It carries no answer: no column in the export, no field in the sync payload, never validated. It groups every element after it until the next section.

A **condition** is `showIf: { q: <earlier question id>, op, values[] }`.

| `op` | Shows when |
|---|---|
| `any` | the parent's answer is one of `values` |
| `none` | the parent is answered and is *not* one of `values` |
| `answered` | the parent has any answer at all |

An unanswered parent hides the child under every operator, including `none`.

`visibleElements(questions, answers)` walks the list **in order**, keeping a working copy of the answers. When an element is hidden, its answer is deleted from that working copy, so anything below that depended on it is hidden too — one pass resolves the whole chain, because a parent always precedes its child. A hidden **section** sets a flag that suppresses everything until the next section.

Three consumers:

- The entry form renders `visibleElements(...)` and shows a count of what's still hidden.
- `validate()` only checks required questions that are currently visible.
- `pruneHiddenAnswers()` runs at save time and drops everything not visible. Answer a branch, change your mind on the parent, save — the branch's answers are gone, not merely hidden.

`sanitizeConditions()` runs after every reorder, delete and import. It drops any condition whose parent was deleted, moved after the child, or turned into a section, and reports what it cleared so the user is told. Without it a question could silently never appear again.

### 5.4 Drafts

Every field change schedules a write 500 ms later to `drafts`. Reopening the form restores it with a banner and a Discard button. Saving deletes the draft. Drafts are keyed per questionnaire, so switching forms mid-entry keeps both.

> **Bug found here by the UI tests:** the entry form's React key contained `Date.now()`, so *any* app re-render (a toast, a sync-status change, going offline) remounted the form and rebuilt it from the last autosave — losing up to 500 ms of typing and clearing validation errors mid-interview. The key is now fixed when the sheet opens.

### 5.5 Sync

`syncPending()` takes every response whose `syncStatus !== 'synced'` — including deletions — oldest first, and POSTs them one at a time.

- `Content-Type: text/plain` keeps it a "simple request", avoiding a CORS preflight Apps Script cannot answer.
- The script upserts **by Entry ID**: an edit updates its row, a deletion marks the `Deleted` column, a retry is harmless. If the network fails after the write landed, retrying is still correct.
- A failure sets `failed` plus the error text, shown on the entry. Nothing is ever dropped quietly.
- Sync runs in the background after a save, and on demand from Overview or Functions.
- Photos stay on the device; the sheet and the export record `[photo]`.

### 5.6 Import

**Template path** (`validateImportRows`, pure and heavily tested). Two passes:

1. Per row: type is in the enum, label non-empty, choice types have options, `linear_scale` has `min;max` with max > min and ≤ 21 points, Required is Y/N. Errors carry the spreadsheet row number.
2. Across rows: resolve `Show If Question` (an Order number) to a real question, check it comes earlier, isn't a section, and that the listed values are genuinely among that question's options.

Any error at all and the review screen never opens — a bad file changes nothing. A clean file opens a review that renders the form as the interviewer will see it, with editable questions, and saves only on Confirm import.

**Document path** (`parseDocumentText`, heuristic). Numbered lines become questions, lettered/bulleted lines become options, ALL-CAPS or `Section A:` lines become sections, and `If yes, ...` attaches a condition to the nearest earlier choice question with a matching option, stripping the prefix from the label. Type is guessed from keywords. Anything guessed is flagged on the same review screen. Output always passes through `sanitizeConditions()` first.

Import **never overwrites**: a name clash is saved as "Title (2)" after telling you.

### 5.7 Theme

Three states: follow device, light, dark. Stored in `localStorage` (not IndexedDB) so an inline script can apply it before the first paint — no flash of the wrong palette. Colours are CSS custom properties defined three times: light on `:root`, dark under `prefers-color-scheme` for anyone who hasn't chosen, and dark again under `:root[data-theme="dark"]` for anyone who has. No component knows which theme is active; `--accent-fg` and `--accent-soft-fg` carry the contrast pairs.

---

## 6. Excel template

| Column | Meaning |
|---|---|
| Order | Whole number from 1. Also what conditions refer to. |
| Question Type | `section`, `short_text`, `long_text`, `multiple_choice`, `checkbox`, `dropdown`, `linear_scale`, `date`, `number`, `image_upload` |
| Label | Question text or section heading |
| Options | `A;B;C` for choice types · `1;5` for linear_scale · blank otherwise |
| Required | Y / N, blank for sections |
| Image Filename | Name of an image you'll attach during import |
| Show If Question | Order number of an **earlier** row that controls this one |
| Show If Condition | `is one of` · `is not one of` · `answered` (blank = is one of) |
| Show If Values | `Yes` or `1;2` — must be real options of that earlier question |

Put a condition on a **section** row to hide a whole group at once. The shipped template demonstrates all of this, and a test runs the template through the app's own validator so it can never ship broken.

The **Guide** (Functions → Guide) holds a copy-ready prompt for converting a Word/PDF draft with an AI assistant, including the skip-logic rules. That produces far better results than the built-in document reader.

---

## 7. Code map (`index.html`)

| Section | Contains |
|---|---|
| `<style>` | Design tokens, three theme blocks, components |
| utils | ids, dates, theme helpers, type table |
| IndexedDB | `openDB`, `tx`, `createResponse`, `updateResponse`, `repairCounters`, soft delete, purge, versioning |
| visibility | `conditionMet`, `visibleElements`, `pruneHiddenAnswers`, `sanitizeConditions`, `condSummary` |
| sync | `postToScript`, `buildSyncPayload`, `syncOne`, `syncPending` |
| export | `columnsFor`, `buildRows`, `exportXlsx`, `exportCsv`, backup/restore |
| import | `validateImportRows`, `templateAoa`, `parseDocumentText`, extractors |
| UI kit | `Icon`, `Badge`, `Sheet`, `Confirm` |
| `Field` | One renderer per answer type, plus the section heading |
| pages | `InputPage`, `OverviewPage`, `QuestionnairePage`, `FunctionsPage` |
| sheets | `EntryForm`, `AllEntries`, `QuestionnaireEditor`, `QuestionEditor`, `ImportSheet`, `ImportReview`, `GuideSheet`, `HelpSheet` |
| `App` | Routing, data loading, toasts, confirms, sync, theme |

**Layering rule:** no panel ever expands inline. Every expansion is a `.sheet` — `position: fixed; inset: 0` — stacked above the tab bar, with `.scrim` dialogs above that. The UI tests enforce this by only ever clicking inside the topmost layer.

State lives in `App` and flows down as props; `refresh()` re-reads the three collections and re-renders. There is no global store and no context — at this size it would be ceremony.

---

## 8. Extending it

| Task | Where |
|---|---|
| New answer type | Add to `TYPES`, add a branch in `Field`, handle it in `validateImportRows`, add it to the Guide table and the AI prompt. |
| New condition operator | Add to `COND_OPS`, handle in `conditionMet`, add a word to `COND_WORDS` for the importer. |
| Change the sheet layout | `buildSyncPayload` and `apps-script.gs` together. Keep the upsert on Entry ID. |
| Extra metadata column in exports | The header array in `buildRows` plus the row mapper below it. |
| Schema change | Bump `DB_VER` and add an `onupgradeneeded` migration. Never repurpose an existing field. |
| Multi-user | Out of scope by design. Entry IDs are unique per device only; you'd need a device prefix. |

Adding a test is usually the fastest way to find out whether a change broke something: `test-data-layer.mjs` for logic, `test-ui.mjs` for anything a person clicks.

---

## 9. QA checklist

| Check | Status |
|---|---|
| No two panels overlap at 360px | Every expansion is a full-screen sheet; dialogs sit above |
| 3 (and 20) rapid entries → unique sequential IDs | Tested |
| Editing updates in place, never duplicates | Tested |
| Switching form mid-draft warns | Tested |
| Deleting a form with responses needs a typed `DELETE` | Tested |
| Works fully offline | Data entry never touches the network |
| Excel export opens correctly | SheetJS, metadata + one column per answerable question |
| Refresh mid-entry loses nothing | 500 ms autosave, recovery banner — tested |
| Required validation blocks and flags | Tested, hidden questions excluded |
| Sync failures visible and retryable | Tested against a mocked endpoint |
| Deleted entries excluded everywhere | History, full list, overview total, target %, today, exports, form counts — tested |
| Deletion syncs idempotently | Same ID, upserted, `Deleted` column |
| Hidden answers never stored | Tested end to end through the UI |
| Conditions can't point forward or dangle | Structurally prevented; `sanitizeConditions` tested |
| Bad import file changes nothing | Tested: 6 broken conditions → 6 messages, no save |
| Template validates against its own validator | Tested |
| Theme persists and applies before paint | Tested |

## 10. Known limits

- Storage is per-browser, per-device. Clearing site data wipes it — **take the JSON backup after each field day** (Functions → Download backup).
- Photos are local only. Exports and the sheet record `[photo]`; the image itself is in the JSON backup.
- Document import needs one online session to fetch the docx/PDF reader. Everything else works offline.
- Reordering questions: drag on desktop, ↑/↓ buttons on touch. Touch drag inside a scrolling list is unreliable and this data can't afford a misfire.
- Conditions compare answers as strings, so `2` and `"2"` match. Deliberate — spreadsheet imports produce strings.
- No bulk delete, deliberately, so the confirm step stays meaningful.
