## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The fieldwork problem it solves. -->

## Checklist

- [ ] `npm test` passes (60 data-layer + 37 UI tests)
- [ ] I added a test for the new behaviour, or explained below why one isn't possible
- [ ] No build step was introduced
- [ ] Works offline, or degrades cleanly offline
- [ ] Existing entry IDs, stored responses and backups remain readable

### Invariants

Tick each one this PR leaves intact, or explain below.

- [ ] Entry IDs stay unique, sequential per year, and are never reused
- [ ] An edit never creates a second row
- [ ] Deleting stays soft; IDs are never handed back out
- [ ] Every response stays readable under the version it was collected with
- [ ] Nothing is marked synced without a confirmed reply
- [ ] Answers to questions the interviewer never saw are never stored
- [ ] A condition can only point at an earlier question

### Notes

<!-- Anything a reviewer should know: schema changes (did you bump DB_VER and write a
     migration?), sw.js cache name bumps, changes to the sync payload that also need
     apps-script.gs updated. -->
