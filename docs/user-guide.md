# User guide

Everything the app does, screen by screen, plus the fieldwork routine that keeps your
data safe. If you only read one thing, read [the field day routine](#the-field-day-routine).

---

## 1. First run

1. Open the app URL **while you have signal**. This is the only time you need it.
   The service worker caches the app and its libraries during this visit.
2. Browser menu → **Add to Home screen**. On Android this is in the ⋮ menu; on iOS
   it's the share sheet → *Add to Home Screen*. The app then launches full-screen
   without browser chrome, and is much less likely to have its storage evicted.
3. **Functions → Interviewer name** — type yours. It's stamped onto every entry and
   every export, and you can't un-stamp it later without editing the sheet.
4. Optional: connect a Google Sheet (see [google-sheets.md](google-sheets.md)).
5. Create or import a questionnaire (§4).

Verify offline mode before you trust it: put the phone in airplane mode, kill the app,
reopen it, and save a test entry. Then delete the test entry.

## 2. The four tabs

| Tab | What it's for |
|---|---|
| **Input** | Collecting. The entry form for the active questionnaire. |
| **Overview** | Counts, progress against target, recent entries, export. |
| **Questionnaire** | Build, import, edit, duplicate, delete and activate forms. |
| **Functions** | Your name, sheet link, sync, theme, guide, backup, about. |

Nothing ever expands inline. Every expansion is a full-screen sheet over the tab bar,
so on a 360 px phone you're never fighting two half-open panels.

## 3. Collecting entries — the Input tab

The Input tab shows the **active** questionnaire. If it's blank, you haven't set one
active yet: Questionnaire tab → **Set active**.

**Answering.** Questions appear in order. Section headings group them and carry no
answer. Questions with skip logic appear and disappear as you answer their parent; a
counter tells you how many are currently hidden, so you know the form isn't broken.

**Drafts.** Every change is autosaved 500 ms later. If the app is closed, refreshed, or
crashes mid-interview, reopening the form restores exactly what you'd typed, with a
banner and a **Discard** button. Drafts are per questionnaire — switching forms
mid-entry keeps both.

**Saving.** Required questions that are *currently visible* must be answered; hidden
ones are skipped. On save:

- an Entry ID is generated (`YY` + 5 digits, e.g. `2600001`),
- answers to questions that were hidden at save time are **discarded**, not merely
  hidden — answer a branch, change your mind on the parent, save, and the branch's
  answers are gone,
- a background sync attempt runs if a sheet is connected. It failing is fine; the
  entry is already safe on the device.

**Editing.** From Overview → an entry → Edit. An edit never creates a second row: same
Entry ID, original timestamp kept, "last updated" refreshed. The form you see is the
form that was actually asked — if the questionnaire has changed version since, the old
version is loaded from the snapshot.

**Deleting.** Deletes are soft. The record stays on the device, is excluded from every
count, list, percentage and export, and its ID is never handed out again. If the entry
had synced, the deletion syncs too and marks the `Deleted` column in the sheet.

## 4. Building a questionnaire — the Questionnaire tab

### By hand

**New** → give it a title, an optional description, and a target count (used for the
progress bar on Overview). Then add questions.

Question types:

| Type | Notes |
|---|---|
| `section` | A heading. No answer, no column, never validated. Groups everything until the next section. |
| `short_text` | Single line. |
| `long_text` | Multi-line. |
| `multiple_choice` | Pick one. |
| `checkbox` | Pick many. |
| `dropdown` | Pick one, from a list. Better than multiple_choice past ~8 options. |
| `linear_scale` | Numeric scale, 2–21 points, optional end labels. |
| `date` | Date picker. |
| `number` | Numeric, with optional min/max. |
| `image_upload` | Photo. Stays on the device; exports and the sheet record `[photo]`. |

Each question can have help text, a required flag, and a condition.

**Reordering** is drag on desktop, ↑/↓ buttons on touch. Touch-dragging inside a
scrolling list is unreliable and this data can't afford a misfire.

### Skip logic

A condition is *"show this question if question N was answered a certain way"*, and
**N must come earlier in the form**. That restriction is the whole safety story: a
condition can't point forward, so a cycle is impossible and a question can never be
permanently unreachable.

| Condition | Shows when |
|---|---|
| is one of | the parent's answer is one of the listed values |
| is not one of | the parent is answered, and isn't one of the listed values |
| answered | the parent has any answer at all |

An **unanswered parent hides the child under every operator**, including *is not one
of*. Put a condition on a **section** to hide a whole group at once.

If you reorder, delete or convert a question so that some condition no longer makes
sense, the app clears that condition automatically and tells you which ones it cleared.
Check the message — a silently dangling condition would mean a question that never
appears again.

### By import

**Import questionnaire** offers two paths.

**Template import (recommended).** Download the blank Excel template, fill it in on a
computer, import it. The file is validated twice — once per row, once across rows for
the conditions — and **if there is a single error, nothing is saved**. Errors carry the
spreadsheet row number. A clean file opens a review screen that renders the form the
way the interviewer will see it, still editable, and only writes on **Confirm import**.
Column reference: [questionnaire-format.md](questionnaire-format.md).

**Document import.** Point it at a Word or PDF draft and it guesses: numbered lines
become questions, lettered or bulleted lines become options, ALL-CAPS or `Section A:`
lines become sections, and `If yes, ...` attaches a condition to the nearest earlier
choice question with a matching option. Everything it guessed is flagged on the review
screen. It needs one online session to fetch the docx/PDF reader.

> For a Word or PDF draft, **Functions → Guide** is usually better than document
> import. It contains a copy-ready prompt that turns your draft into a correctly
> structured template file using an AI assistant, including the skip-logic rules.

Import **never overwrites**. A name clash is saved as "Title (2)" after telling you.

### Managing forms

- **Set active** — which questionnaire the Input tab collects into.
- **Duplicate** — copy the structure without the responses. Use this instead of heavily
  editing a form you're already collecting with.
- **Edit** — if you change the structure while responses exist, you're asked whether to
  bump the version. Say yes. Old responses stay readable under the old version, and
  exports add columns for questions that existed then but don't now, labelled
  `(removed)`.
- **Delete** — removes the form *and its responses from this device*. Requires typing
  `DELETE`. Export or sync first.

## 5. Overview

- **Total**, **today**, and **progress against target**. Deleted entries are excluded
  from all three.
- **Recent entries**, each with its sync badge: synced, waiting, or failed. A failed
  entry shows the error text.
- **Export** — pick a questionnaire, then **Export to Excel** (`.xlsx`) or **CSV**.
  Columns: Entry ID, timestamp, last updated, interviewer, form version, then one
  column per answerable question. Sections aren't columns. Deleted entries aren't rows.

## 6. Functions

| Setting | Notes |
|---|---|
| **Interviewer name** | Stamped on every entry and export. |
| **Web app URL** | The Apps Script `/exec` link, with **Test connection**. |
| **Sync now** | Pushes everything not yet confirmed synced, oldest first, including deletions. Safe to run any time. |
| **Appearance** | Follow device / light / dark. Dark for indoors and night, light stays readable in direct sun. |
| **Guide** | The AI prompt for converting a Word/PDF draft, plus the blank template. |
| **Download backup** | Everything on this device — forms, entries, settings, photos — as one JSON file. |
| **Restore** | Merges a backup in. Entries in the file overwrite anything with the same Entry ID; everything else on the device stays. The ID counter is then pushed above the highest ID found, so you can't get duplicates afterwards. |

## 7. How sync behaves

Sync is one entry at a time, oldest first, and it is **idempotent**: rows are matched
on Entry ID, so re-sending updates the row rather than duplicating it. If the network
dies after the write landed but before the confirmation arrived, retrying is still
correct.

- Nothing is marked synced without a confirmed reply from the script.
- A failure sets `failed` plus the error text on that entry, visible in Overview.
  Nothing is ever dropped quietly.
- Sync runs in the background after each save, and on demand from Overview or Functions.
- Deletions sync too, as a `Deleted` marker on the existing row.
- Photos stay local. The sheet records `[photo]`.

Failure causes and fixes: [troubleshooting.md](troubleshooting.md).

## 8. The field day routine

<table>
<tr><td><b>Before you leave</b></td><td>

- Open the app online once, so any app update has been fetched.
- Confirm the right questionnaire is **active**.
- Airplane-mode test: save a dummy entry, then delete it.
- Battery. The app is cheap to run, but the screen isn't.

</td></tr>
<tr><td><b>During</b></td><td>

- Collect. Ignore the sync badges; "waiting" is the normal state in the field.
- Don't clear browsing data. Don't run a storage cleaner.
- If you must switch questionnaires mid-day, the draft of the one you leave is kept.

</td></tr>
<tr><td><b>Back on wifi</b></td><td>

1. **Functions → Sync now.** Wait for the waiting count to reach zero.
2. Check Overview for any **failed** entries and read the error.
3. **Functions → Download backup.** Move the JSON off the phone — email it to
   yourself, drop it in cloud storage, anything that isn't this one device.
4. Optionally export to Excel as a second copy.

</td></tr>
</table>

Do step 3 even on days when sync worked. The sheet doesn't contain your photos, and
the sheet is not a restore path — the backup is.

## 9. Moving to a new phone

1. Old phone: **Functions → Download backup**.
2. Transfer the JSON file to the new phone.
3. New phone: open the app URL, add to home screen, **Functions → Restore**, pick the file.
4. Set your interviewer name and re-paste the web app URL (settings come across in the
   backup, but verify with **Test connection**).
5. Check that entry IDs continue from where they left off — save one test entry and
   confirm it isn't a number you've already used. Then delete it.

**Do not collect on both phones.** Entry IDs are unique per device, not globally, so
two devices will hand out the same IDs and the sheet will silently overwrite one with
the other.
