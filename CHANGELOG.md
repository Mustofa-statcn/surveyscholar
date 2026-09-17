# Changelog

Notable changes to SurveyScholar. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/), where a MAJOR bump means stored data or the sync payload
changed shape.

## [Unreleased]

## [1.0.0] — 2026-09-17

First public release.

### Added
- Offline-first entry with IndexedDB as the source of truth
- PWA install, service worker caching of the app shell and libraries
- Sequential per-year entry IDs, generated in a single transaction
- Questionnaire builder: ten question types, sections, help text, required flags
- Skip logic restricted to backward references, with automatic sanitising after
  reorder, delete and import
- Questionnaire versioning with frozen snapshots, so old responses stay readable
- Draft autosave with recovery banner
- Soft deletes, excluded from every count, list and export
- Idempotent Google Sheets sync via a user-deployed Apps Script web app
- Excel (`.xlsx`) and CSV export, with `(removed)` columns for retired questions
- Import from a validated Excel template, or heuristically from Word/PDF
- Full JSON backup and restore, with counter repair on restore
- Light / dark / follow-device theme, applied before first paint
- 60 data-layer tests and 37 UI tests, both run against the real `index.html`

### Fixed
- Entry form remounting on any app re-render (a toast, a sync badge, going offline),
  which rebuilt the form from the last autosave and could lose up to 500 ms of typing
  mid-interview. Found by the UI tests.

[Unreleased]: https://github.com/Mustofa-statcn/surveyscholar/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Mustofa-statcn/surveyscholar/releases/tag/v1.0.0
