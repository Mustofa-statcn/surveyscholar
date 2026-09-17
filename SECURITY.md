# Security policy

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting:

**Security → Report a vulnerability**, or
`https://github.com/Mustofa-statcn/surveyscholar/security/advisories/new`

Include what an attacker can do, how to reproduce it, and which files are involved.
A first response should come within a week; if the issue is real, a fix and a public
advisory follow.

## Scope

SurveyScholar is a static client-side app with no backend of its own, so the
interesting surface is small. In scope:

- Anything that lets a third party read collected responses, drafts or photos
- XSS through a questionnaire label, option, help text, imported file or restored backup
- A way to corrupt or silently drop stored data (entry ID collisions, bad migrations,
  a sync path that marks something synced without confirmation)
- Service worker cache poisoning
- A backup or export leaking more than the user expects

## Out of scope

These are known and documented trade-offs, not vulnerabilities:

- **The Apps Script deployment uses `Access: Anyone`.** Anyone holding the `/exec` URL
  can append rows to that sheet. This is the deliberate alternative to shipping an
  OAuth client secret inside a public static file. Treat the URL as a secret; rotate
  it by archiving the deployment and creating a new one. See
  [docs/google-sheets.md](docs/google-sheets.md).
- **There is no app-level password or at-rest encryption.** Anyone who can unlock the
  device can read every response. Use device passcodes and full-device encryption.
- **JSON backups are unencrypted** and contain everything, photos included.
- **Libraries load from public CDNs** on first visit. Self-host them if that matters —
  [docs/privacy.md](docs/privacy.md) explains how.
- Anything requiring physical access to an unlocked device.
- Vulnerabilities in Google Sheets, Apps Script, or the browser itself — report those
  to the respective vendor.

## For operators

If you deploy this for a team: HTTPS is mandatory, keep the `/exec` URL out of the
repo and out of screenshots, and read
[docs/privacy.md](docs/privacy.md) before collecting anything about identifiable people.
