# Google Sheets sync

Sync is **optional**. The app is fully usable with Excel export alone, and the phone is
the source of truth either way. Connect a sheet when you want someone else — a
supervisor, a co-author, a dashboard — to see entries arriving without you sending files.

---

## How it works

The app POSTs one entry at a time to a Google Apps Script web app that you deploy on
your own Google account. The script writes into the spreadsheet it's attached to.

```
phone (IndexedDB)  ──POST──▶  Apps Script /exec  ──▶  your Google Sheet
```

Two details matter:

- The request uses `Content-Type: text/plain`. That keeps it a "simple request" and
  avoids a CORS preflight, which Apps Script cannot answer.
- The script **upserts on Entry ID**: it scans column A for the ID, and updates that
  row if it finds one, otherwise appends. So an edit updates in place, a deletion marks
  the `Deleted` column, and a retry after a network failure is harmless.

## Setup

1. Create (or open) the Google Sheet you want filled.
2. **Extensions → Apps Script.** A new editor tab opens with a stub `Code.gs`.
3. Delete everything in it and paste the full contents of [`apps-script.gs`](../apps-script.gs).
4. Save (💾).
5. **Deploy → New deployment.**
6. Click the gear next to *Select type* → **Web app**.
7. Set:
   - **Description**: anything, e.g. `SurveyScholar endpoint`
   - **Execute as**: **Me** (your account)
   - **Who has access**: **Anyone**
8. **Deploy.** Google will ask you to authorise the script — *Review permissions* →
   pick your account → *Advanced* → *Go to (project name) (unsafe)* → *Allow*. That
   warning appears because the script is unverified; it is your own script, running
   only on your own sheet.
9. Copy the **Web app URL**. It ends in `/exec`.
10. In SurveyScholar: **Functions → Web app URL** → paste → **Save link** →
    **Test connection**. You should see a success message.

> [!WARNING]
> **"Anyone" means anyone who has the URL can append rows to that sheet.** There is no
> authentication — that's the deliberate trade for having no OAuth consent screen and
> no client secret sitting inside a public static HTML file.
>
> Treat the `/exec` URL like a password: don't commit it, don't screenshot it, don't
> paste it into a group chat or an issue. If it leaks, **Deploy → Manage deployments →
> Archive**, then create a new deployment and update the URL in the app.
>
> What a leaked URL does *not* give away: read access to your other sheets, your Drive,
> your email, or your Google account. The script only writes to its own spreadsheet.

## What ends up in the sheet

One tab per questionnaire, named after its title (truncated to 90 characters).

| Column | Contents |
|---|---|
| Entry ID | `YY` + 5 digits. The upsert key. Don't edit it. |
| Timestamp | When the entry was first created on the device |
| Last updated | When it was last edited |
| Interviewer | The name from Functions |
| Form version | Which version of the questionnaire it was collected under |
| Deleted | Blank, or `DELETED <timestamp>` |
| *(then one column per answerable question, by label)* | |

Header handling: on first write the header row is created. On later writes, any new
question labels are **appended** as new columns — existing columns are never moved or
renamed. So if you rename a question, you get a new column rather than a rewrite, and
the old answers stay under the old label.

Sections are never columns. Photos appear as `[photo]`.

> [!CAUTION]
> Don't sort, delete or reorder rows in the sheet while you're still collecting, and
> don't edit the Entry ID column. The script finds a row by scanning column A; if an ID
> is changed or a row deleted, the next sync for that entry appends a duplicate instead
> of updating. Sorting is safe *after* you've stopped collecting, or do it in a copy.

## Testing it without the phone

Open the `/exec` URL in a browser. `doGet` replies with a small JSON object confirming
the endpoint is live. If you instead get a Google sign-in page or an error page, the
deployment's access setting isn't `Anyone`.

## Sync failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Test connection fails, browser shows a sign-in page at `/exec` | Access is set to *Only myself* or *Anyone with Google account* | Manage deployments → edit → Access: **Anyone** |
| Test connection fails with a network/CORS error | The URL is the `/dev` link, not `/exec` | Use the URL from **Deploy → New deployment**, not the editor's test link |
| Entries stay "waiting" forever | No network, or the URL was never saved | Check Functions shows the URL; tap **Sync now** on wifi |
| Entry marked **failed** with a script error | Usually an exception inside the script — most often the sheet was renamed or deleted | Read the error on the entry; fix the sheet; **Sync now** again |
| Duplicate rows for one Entry ID | The original row's ID was edited or the row deleted | Delete the duplicate in the sheet; the next sync will maintain one row |
| Nothing arrives, no error | A second deployment is live and you're pointed at the old one | Manage deployments; archive the ones you don't use |

Failed entries are never dropped. They keep their error text and retry on the next
sync, indefinitely.

## Changing the script

If you modify `apps-script.gs`, you must **Deploy → Manage deployments → edit (✏️) →
Version: New version → Deploy**. Saving the editor alone does not update the live web
app. Editing an existing deployment keeps the same `/exec` URL; creating a *new*
deployment gives you a different one that you'd have to re-paste into the app.

If you change the payload shape on the app side, `buildSyncPayload` in `index.html` and
`apps-script.gs` must change together. Keep the upsert on Entry ID.
