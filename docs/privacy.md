# Privacy & data handling

SurveyScholar collects nothing about you. It is a static file you host yourself, with
no analytics, no trackers, no telemetry, no crash reporting and no phone-home. The
people who wrote it cannot see your data and have no mechanism to.

That also means **nobody is looking after your data except you.**

---

## What is stored, and where

| Data | Where it lives | Leaves the device? |
|---|---|---|
| Questionnaires and versions | IndexedDB (`surveyscholar`), on the device | Only if you export or sync |
| Responses, including deleted ones | IndexedDB | To your sheet, if you connect one |
| Drafts (in-progress entries) | IndexedDB | Never |
| Photos | IndexedDB | **Never** — the sheet and exports record `[photo]` |
| Interviewer name, sheet URL, active form | IndexedDB (`settings`) | Name appears in the sheet and exports |
| Theme choice | `localStorage` | Never |
| App shell + four CDN libraries | Cache Storage | n/a |

Nothing is stored on any server the project controls, because there isn't one.

## What leaves the device, and to whom

**If you connect a Google Sheet**, each entry is POSTed to *your own* Apps Script web
app, running under *your* Google account, writing to *your* spreadsheet. The data goes
to Google, under whatever terms apply to your Google account. It does not pass through
anyone else.

**The four CDN libraries** (React, ReactDOM, htm, SheetJS) are fetched from
cdnjs/jsDelivr on first load, which means those CDNs see a request from the device's IP
address on first visit — the same as any website using a CDN. They're cached afterwards
and not requested again. If you'd rather avoid that entirely, download the four files,
put them next to `index.html`, and point the script tags and the `SHELL` array in
`sw.js` at the local copies. The app then makes no third-party requests at all.

**Nothing else.** No request goes anywhere for any other reason.

## If you're collecting data about people

This is a research tool, so most users will be. The software gives you some useful
properties — local-first storage, no third-party processors, an explicit sync step —
but the obligations are yours:

- **Consent and ethics approval.** Get them before you collect, not after. If your
  institution requires an IRB/ethics committee review, this tool doesn't change that.
- **Minimise.** Don't add a question because it might be interesting later. Every
  identifier you collect is one you then have to protect.
- **Identifiers and photos.** A photo of a person, a house, or a document is personal
  data. Consider whether you need it at all. If you do, note that photos are the one
  thing that exists *only* on the device and *only* in your JSON backups — protect
  those files accordingly.
- **Device security.** There is no app-level password or encryption. Anyone who can
  unlock the phone can read every response. Use a device passcode and full-device
  encryption (on by default on modern Android and iOS). Don't collect sensitive data
  on a shared or unlocked device.
- **Backups are unencrypted JSON.** They contain everything, photos included. Don't
  email them to yourself in the clear if the contents are sensitive; put them in
  encrypted storage.
- **The sheet URL is an unauthenticated write endpoint.** See
  [google-sheets.md](google-sheets.md). It can't leak your existing data, but treat it
  as a secret anyway.
- **Retention and deletion.** Deletes in the app are *soft* — the record stays on the
  device and the row stays in the sheet, marked `Deleted`. That is right for data
  integrity during a study and wrong for a subject-access deletion request. To
  genuinely erase a participant's data you must delete the row in the sheet, delete or
  edit the affected backup files, and delete the questionnaire from the device (which
  does hard-delete its responses).
- **Cross-border transfer.** If you sync to Google Sheets, your data is on Google's
  infrastructure. Check whether that's acceptable under your funder's or country's
  rules before you connect a sheet. Excel export keeps everything local.

None of this is legal advice. If your work falls under GDPR, HIPAA, or a national data
protection act, talk to whoever handles that at your institution.

## Reporting a privacy or security problem

Please don't open a public issue. See [SECURITY.md](../SECURITY.md).
