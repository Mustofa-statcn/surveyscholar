# Questionnaire format

The import template is a single spreadsheet, one row per question or section heading.
Get a filled-in copy from **Questionnaire → Import questionnaire → Download template**;
it demonstrates every feature below, and a test runs it through the app's own validator
so it can never ship broken.

---

## Columns

| Column | Meaning |
|---|---|
| **Order** | Whole number starting at 1. This is also what conditions refer to. |
| **Question Type** | One of the types below. |
| **Label** | The question text, or the section heading. Required, non-empty. |
| **Options** | `A;B;C` for choice types · `1;5` for `linear_scale` · blank otherwise. |
| **Required** | `Y` or `N`. Blank for sections. |
| **Image Filename** | Name of an image you'll attach during import (optional). |
| **Show If Question** | The **Order number of an earlier row** that controls this one. |
| **Show If Condition** | `is one of` · `is not one of` · `answered`. Blank means *is one of*. |
| **Show If Values** | `Yes` or `1;2` — must be genuine options of that earlier question. |

Semicolons separate list values. Spaces around them are trimmed.

## Question types

| Type | Options column | Notes |
|---|---|---|
| `section` | — | A heading. No answer, no export column, never validated. Groups every element after it until the next section. |
| `short_text` | — | One line. |
| `long_text` | — | Multi-line. |
| `multiple_choice` | required | Pick one. |
| `checkbox` | required | Pick many. |
| `dropdown` | required | Pick one from a list. Better than `multiple_choice` past ~8 options. |
| `linear_scale` | `min;max` | `max` must exceed `min`, and the scale must be ≤ 21 points. |
| `date` | — | Date picker. |
| `number` | — | Numeric. |
| `image_upload` | — | Photo. Stays on the device; exports and the sheet record `[photo]`. |

## Skip logic

A condition means *"show this row only if the row at `Show If Question` was answered a
certain way."*

**The referenced row must come earlier.** This is enforced, and it is the entire safety
argument: a condition cannot point forward, so cycles are structurally impossible and a
question can never become permanently unreachable.

| `Show If Condition` | Shows when |
|---|---|
| `is one of` | the parent's answer is one of `Show If Values` |
| `is not one of` | the parent **is answered** and is not one of `Show If Values` |
| `answered` | the parent has any answer at all (`Show If Values` ignored) |

An **unanswered parent hides the child under every operator**, including `is not one
of`. Chains work: if A hides B, and C depends on B, C is hidden too — one pass resolves
the whole chain, because a parent always precedes its child.

Put a condition on a **section** row to hide an entire group at once.

### Example

| Order | Question Type | Label | Options | Required | Show If Question | Show If Condition | Show If Values |
|---|---|---|---|---|---|---|---|
| 1 | section | HOUSEHOLD | | | | | |
| 2 | number | Household size | | Y | | | |
| 3 | multiple_choice | Do you own livestock? | Yes;No | Y | | | |
| 4 | section | LIVESTOCK | | | 3 | is one of | Yes |
| 5 | checkbox | Which animals? | Cattle;Goats;Poultry | Y | 3 | is one of | Yes |
| 6 | number | How many head of cattle? | | N | 5 | is one of | Cattle |
| 7 | long_text | Why not? | | N | 3 | is not one of | Yes |

Row 4 hides rows 5 and 6 together. Row 6 depends on row 5, which itself depends on row
3 — answering "No" at row 3 hides all three. Row 7 appears only when row 3 is answered
and isn't "Yes".

## Validation

Import validates in two passes, and **any single error means nothing is saved**:

**Per row** — type is in the enum; label non-empty; choice types have options;
`linear_scale` has `min;max` with `max > min` and ≤ 21 points; Required is `Y`/`N`.
Every error carries its spreadsheet row number.

**Across rows** — each `Show If Question` resolves to a real row, that row comes
earlier, it isn't a section, and every listed value is genuinely one of its options.

A clean file opens a **review screen** that renders the form as the interviewer will
see it, with questions still editable, and writes nothing until you tap **Confirm
import**. Import never overwrites: a title clash is saved as "Title (2)" after telling
you.

## Converting an existing Word or PDF questionnaire

Two ways, in order of how well they work.

**1. The AI prompt (better).** **Functions → Guide** contains a copy-ready prompt and
the blank template. Paste your draft into an AI assistant along with the prompt, get
back a correctly structured file, import it. The prompt includes the skip-logic rules
above, which is why it beats the built-in reader.

**2. Document import (fast, approximate).** Point the app at the file. Numbered lines
become questions, lettered or bulleted lines become options, ALL-CAPS or `Section A:`
lines become sections, and `If yes, ...` attaches a condition to the nearest earlier
choice question with a matching option, stripping the prefix from the label. Types are
guessed from keywords. Everything guessed is flagged on the review screen, and the
result is run through condition sanitising before you ever see it. It needs one online
session to fetch the docx/PDF reader.

Either way: **read the review screen properly before confirming.** It is much cheaper
to fix a question now than after 200 interviews.

## After importing

The app re-checks conditions after every reorder, delete and import. If it finds a
condition whose parent was deleted, moved after the child, or turned into a section, it
**clears that condition and tells you**. Read the message — the alternative would be a
question that silently never appears again.
