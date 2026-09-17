# Troubleshooting

Symptom → cause → fix. If your data is missing, go straight to
[Data recovery](#data-recovery) and **stop using the device** until you've read it.

---

## Install and offline

**The app won't work offline.**
The service worker never registered. Causes, in order of likelihood:

1. The site isn't on HTTPS. Service workers only run over `https://` or `localhost`.
2. The first visit was made offline, so nothing was cached. Open it once with signal.
3. `sw.js` isn't in the same directory as `index.html` (or above it). A service worker
   can only control pages at or below its own path.
4. Private / incognito browsing. Storage and service workers are restricted there.

Check: DevTools → Application → Service Workers should list one, activated.

**No "Add to Home screen" option.**
Needs HTTPS, a reachable `manifest.json`, an installed service worker and a 192 px
icon. On iOS the option lives in the Safari **share sheet**, not the ⋮ menu, and only
in Safari — Chrome on iOS can't install PWAs.

**It opens in a browser tab instead of full-screen.**
You bookmarked it rather than installing it. Remove the bookmark, install properly.

**The app is stuck on an old version.**
Cache-first shell. Close every tab and reopen, twice. If you maintain the deployment,
bump the cache name in `sw.js` (`surveyscholar-v1` → `-v2`); the activate handler drops
the old cache. That does **not** delete any data.

## Data entry

**The Input tab is empty.**
No active questionnaire. Questionnaire tab → **Set active**.

**A question never appears.**
It has a condition that isn't satisfied, or its section does. The form shows a count of
currently hidden questions — if that count is higher than you expect, open the
questionnaire editor and read the conditions. Remember that an unanswered parent hides
the child under *every* operator.

**Save is blocked but I can't see what's wrong.**
A required question is unanswered. Only *visible* required questions are validated, so
scroll the whole form — the flagged field may be above your current position.

**My typing came back when I reopened the form.**
Working as intended: drafts autosave 500 ms after each change. Use **Discard** on the
banner if you wanted a blank form.

**Editing created a second entry.**
It shouldn't — an edit reuses the Entry ID and preserves the original timestamp. If you
genuinely see two, you probably tapped *new entry* rather than *edit* on the existing
one. Soft-delete the extra; its ID stays retired.

## Sync

See [google-sheets.md § Sync failure modes](google-sheets.md#sync-failure-modes) for the
full table. The common three:

**Everything says "waiting".** No network, or no web app URL saved. Functions → check
the URL is there → **Test connection** on wifi.

**"Failed" with an error.** Read the error on the entry itself. It's usually the sheet
being renamed or deleted, or a deployment that was replaced. Fix the cause and **Sync
now** — nothing is lost, failed entries retry forever.

**Duplicate rows in the sheet.** Someone edited or deleted a row's Entry ID, so the
upsert couldn't find it. Delete the duplicate in the sheet. Don't edit column A while
collecting.

## Export

**The Excel file won't open.** Export while the app has a moment to work — a very large
export on a low-memory phone can be killed mid-write. Try CSV, or export a single
questionnaire rather than all of them.

**Columns I don't recognise, labelled `(removed)`.** Questions that existed in an
earlier version of the form and don't now. The responses collected under that version
still have those answers, so the export keeps them. This is correct behaviour.

**Photos are missing.** By design — images never leave the device. Exports and the
sheet record `[photo]`; the image itself is inside the JSON backup.

## Data recovery

**Stop. Don't clear anything, don't reinstall, don't "reset the app".** Work through
this in order.

1. **Is it actually gone?** Check you're on the same URL and the same browser. Data is
   scoped to the origin, so `user.github.io/repo/` and a custom domain are two separate
   stores, and Chrome and Safari are two separate stores.
2. **Do you have a backup?** Functions → Restore. This is why the field routine says to
   take one every day. Restore is safe: the ID counter is pushed above the highest ID
   found, so you can't produce duplicates afterwards.
3. **Did it sync?** The sheet has everything except photos. You can rebuild a dataset
   from it manually — it isn't a restore path into the app, but it's your data.
4. **Nothing above applies?** Then the browser evicted the storage, which happens when
   site data is cleared, a cleaner app runs, or iOS reclaims space from a site that was
   never installed to the home screen. There is no recovery from that. This is the
   whole reason for the daily backup.

Prevention, in order of effectiveness: install to the home screen; sync often; download
the JSON backup every field day and move it off the device.

## Development

**Tests fail on a clean checkout.** `npm install` first — the suites need
`fake-indexeddb`, `jsdom`, `react`, `react-dom`, `htm` and `xlsx`. They require Node 18
or newer.

**Tests pass but the app is broken in a browser.** The suites evaluate the real code out
of `index.html`, but jsdom isn't a browser: layout, service workers and real IndexedDB
quirks aren't covered. Test on an actual phone before a field day.

**I edited `index.html` and the tests can't find my function.** Both suites extract code
from the file by locating it in the document. If you moved a block outside the script
tag the suites read, they'll miss it. Keep the structure described in
[architecture.md § 7](architecture.md).
