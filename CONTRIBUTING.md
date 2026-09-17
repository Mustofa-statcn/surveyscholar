# Contributing

Thanks for looking. This is a small project with strong opinions, so a few minutes of
reading here will save you a rewrite later.

## The constraints

These aren't preferences, they're the product:

1. **One file, no build step.** `index.html` contains the styles, the data layer, the
   sync, the import and the UI. The repo *is* the deployable. No bundler, no
   transpiler, no `npm run build`. If a change requires a build step, it's a different
   project.
2. **Offline is the default state, not a mode.** Data entry, editing, validation and
   export must never touch the network. Anything that needs the network must degrade
   cleanly and say so.
3. **The device is the source of truth.** Google Sheets is a mirror. Nothing is ever
   deleted locally to accommodate a sync.
4. **Single interviewer, single device.** Multi-user is out of scope by design — entry
   IDs are unique per device only.
5. **Don't add a dependency.** Four CDN libraries (React, ReactDOM, htm, SheetJS) plus
   two lazy ones for document import. That's the budget.

## The invariants

These are what the tests defend. A PR that breaks one of these will be rejected even if
everything passes, so if you need to change one, open an issue first.

1. Entry IDs are unique, sequential per year, and never reused.
2. An edit never creates a row.
3. Deleting is soft; the ID is never handed out again.
4. A response is readable forever, under the version it was collected with.
5. Nothing is marked synced without a confirmed response from the script.
6. Answers to questions the interviewer never saw are never stored.
7. A condition may only point at an earlier question.

The reasoning behind each is in [docs/architecture.md](docs/architecture.md) §4.

## Getting set up

```bash
git clone https://github.com/Mustofa-statcn/surveyscholar.git
cd surveyscholar
npm install
npm test          # 60 data-layer tests + 37 UI tests
python3 -m http.server 8000   # → http://localhost:8000
```

Use `localhost`, not `file://` — service workers and the PWA install path need an
origin.

Both test suites read `index.html` directly and evaluate the real code. There is no
second copy of the logic to keep in sync. That's the main reason the app is one file,
and it's why adding a test is usually the fastest way to find out whether your change
broke something:

- `test-data-layer.mjs` — IDs, edits, soft delete, sync, visibility logic, import parsing
- `test-ui.mjs` — mounts the app in jsdom and clicks through it

Tests pass ≠ ships. jsdom isn't a browser. **Test on a real phone** before you claim a
UI change works, especially anything touching sheets, scrolling or touch reordering.

## Where things go

| Task | Where |
|---|---|
| New answer type | `TYPES`, a branch in `Field`, `validateImportRows`, the Guide table, the AI prompt |
| New condition operator | `COND_OPS`, `conditionMet`, a word in `COND_WORDS` |
| Change the sheet layout | `buildSyncPayload` **and** `apps-script.gs` together — keep the upsert on Entry ID |
| Extra export column | The header array in `buildRows` plus the row mapper below it |
| Schema change | Bump `DB_VER`, write an `onupgradeneeded` migration. **Never repurpose an existing field.** |

The full code map is in [docs/architecture.md](docs/architecture.md) §7.

## Style

Match what's there. Some specifics that aren't obvious:

- **No panel expands inline.** Every expansion is a `.sheet` (`position: fixed; inset: 0`)
  above the tab bar, with `.scrim` dialogs above that. The UI tests enforce this by
  only ever clicking inside the topmost layer.
- **No global store, no context.** State lives in `App` and flows down as props;
  `refresh()` re-reads the collections. At this size anything else is ceremony.
- **Colours come from CSS custom properties**, defined three times (light, device-dark,
  chosen-dark). No component should know which theme is active. Use `--accent-fg` and
  `--accent-soft-fg` for contrast pairs; never hardcode a hex in a component.
- ES5-flavoured function syntax in the app code, to keep it running without transpiling
  on older field devices.

## Pull requests

- One change per PR.
- Include a test, or say why one isn't possible.
- If you changed the service worker's shell list or anything field users need
  immediately, bump `CACHE` in `sw.js`.
- If you changed the sync payload, update `apps-script.gs` in the same PR.
- Fill in the PR template's invariant checklist honestly. "I'm not sure" is a fine
  answer and gets you a review rather than a rejection.

## Reporting bugs

Use the issue template. Two things matter more than anything else:

- **If data was lost or corrupted, put that in the title.** Those get looked at first.
- **Never paste real respondent data or your Apps Script `/exec` URL** into an issue.
  The URL is an unauthenticated write endpoint.

## Security

Don't open a public issue. See [SECURITY.md](SECURITY.md).
