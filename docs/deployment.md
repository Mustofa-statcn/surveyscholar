# Deployment

SurveyScholar is static. There is no server to run, no environment variables, no build
step. Anything that can serve files over HTTPS can host it.

> [!IMPORTANT]
> **HTTPS is mandatory.** Service workers only register over `https://` or
> `http://localhost`. Without one, the app still works in a browser tab but will not
> install, will not launch from the home screen, and will not work offline — which
> removes the entire point of the app.

---

## Option A — GitHub Pages via Actions (recommended)

The repo ships with [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml),
which publishes the repository root on every push to `main`.

1. Fork or push this repo to GitHub.
2. **Settings → Pages → Source: `GitHub Actions`**.
3. Push anything to `main`, or run the workflow manually from the Actions tab.
4. Your app is at `https://<user>.github.io/<repo>/`.

The workflow also runs the test suites first and won't publish if they fail. That's
deliberate — the tests defend the data invariants, and a broken build on a field phone
is expensive.

## Option B — GitHub Pages from a branch

No Actions involved.

1. **Settings → Pages → Source: `Deploy from a branch`**, branch `main`, folder `/ (root)`.
2. Done.

To keep the repo root tidy you can instead move `index.html`, `sw.js`, `manifest.json`
and the icons into a `/docs` folder and select `/docs` as the folder. If you do, move
`apps-script.gs` too so the in-app setup guide's file reference stays correct, and
update the test scripts' path to `index.html`.

The repo includes a `.nojekyll` file so GitHub doesn't run Jekyll over it. Without it,
files and folders starting with an underscore would be dropped. Leave it there.

## Option C — anywhere else

Netlify, Cloudflare Pages, Vercel, S3 + CloudFront, or a plain nginx box. Upload these
files, preserving the layout:

```
index.html
sw.js
manifest.json
icon-192.png
icon-512.png
```

Requirements:

- HTTPS, with a certificate the phone trusts.
- `sw.js` served from the **same directory as `index.html` or above it**. A service
  worker can only control pages at or below its own path.
- `sw.js` served with a short or zero cache lifetime (see [Updating](#updating) below).
  Most hosts do this correctly by default; nginx may need
  `add_header Cache-Control "no-cache";` for that one file.
- Correct MIME types — `text/html`, `application/javascript`, `application/manifest+json`.

Everything is relative, so it works from a subdirectory without configuration.

## Custom domain

1. **Settings → Pages → Custom domain**, enter it, save. This writes a `CNAME` file.
2. At your DNS provider, point the record at GitHub Pages — `CNAME` to
   `<user>.github.io` for a subdomain, or the four `A` records for an apex domain.
3. Wait for the certificate, then tick **Enforce HTTPS**.

If you change the domain after people have installed the app, they are effectively
running a different site: **their data does not follow**, because IndexedDB is scoped
per origin. Have everyone take a JSON backup before the move and restore it on the new
domain.

## Updating

The service worker uses cache-first for the app shell, so a returning visitor may see
the old version once before the new one is fetched in the background. On the next
launch they're on the new version.

To force an immediate update for everyone, bump the cache name in `sw.js`:

```js
const CACHE = 'surveyscholar-v2';   // was v1
```

The `activate` handler deletes every cache whose name isn't the current one, so the
old shell is dropped. **This does not touch IndexedDB** — no data is lost when you do
this. Bump it whenever you change `index.html` in a way that field users need promptly.

If you also change the database schema, that is a different and more serious operation:
bump `DB_VER` and write an `onupgradeneeded` migration. Never repurpose an existing
field. See [architecture.md](architecture.md) §8.

## Verifying a deployment

On a real phone, not a desktop emulator:

1. Open the URL. DevTools → Application → Service Workers should show one activated.
2. Add to home screen. It should launch without browser chrome.
3. Airplane mode → force-close → reopen. The app must load.
4. Save a test entry offline, then go online and sync it. Then delete it.
5. Check the sheet got exactly one row.

If step 3 fails, the service worker didn't register — nearly always HTTPS, a path
problem with `sw.js`, or a first visit that never completed while online.

---

## Appendix: pushing this repo the first time

If you're starting from the folder rather than a fork.

Create the empty repo on GitHub first: **New repository** → name `surveyscholar` →
Public → **do not** add a README, .gitignore or licence, this folder already has them.

```bash
cd surveyscholar

git init -b main
git add .
git status                      # check: no backups, no exports, no /exec URL
git commit -m "SurveyScholar 1.0.0"

git remote add origin https://github.com/Mustofa-statcn/surveyscholar.git
git push -u origin main
```

Then **Settings → Pages → Source: GitHub Actions**, and watch the Actions tab.

### Placeholders

Already filled in for `Mustofa-statcn` across `README.md`, `package.json`, `LICENSE`,
`CHANGELOG.md`, `CONTRIBUTING.md` and the issue-template config. The links assume the
repository is named **`surveyscholar`** — if you name it something else, run:

```bash
grep -rl 'surveyscholar' README.md package.json CHANGELOG.md CONTRIBUTING.md \
  .github/ISSUE_TEMPLATE/config.yml | xargs sed -i 's|Mustofa-statcn/surveyscholar|Mustofa-statcn/<new-name>|g'
```

The `LICENSE` copyright line says `Mustofa-statcn`. Change it to your legal name if
you want the licence to be enforceable as written.

### Things to do while you're in the settings

- **About** (the gear on the repo home page): add the description, the Pages URL, and
  topics — `survey`, `fieldwork`, `offline-first`, `pwa`, `indexeddb`, `data-collection`,
  `research`, `no-build`.
- **Discussions**: enable it, so setup questions don't arrive as issues.
- **Settings → Actions → General → Workflow permissions**: the deploy workflow declares
  what it needs, so the default read-only setting is fine.
- Take a few screenshots on a real phone and drop them in `docs/screenshots/` — a
  fieldwork tool with no screenshots is a hard sell. See that folder's README.

### What must never be committed

- Your Apps Script `/exec` URL (it's an unauthenticated write endpoint)
- JSON backups, exports, or anything containing real respondent data

`.gitignore` already blocks the usual filenames, but it can't read your mind. Check
`git status` before your first push.
