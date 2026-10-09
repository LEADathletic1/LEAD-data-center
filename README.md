# LEAD Data Center

A permanent, deduplicated library of athlete test results for LEAD Athletic Performance.

Lumin Sports deletes an athlete's data when the athlete is deleted, and LEAD purges old athletes about every two months. Before each purge, export a CSV from Lumin, drop it into this tool, review the summary, and confirm. The tool adds only what is new, keeps full history for every data point, and supports tags and name matching.

**Phase 1 (this build):** Lumin importer, library, tags, name matching, shared-password sign-in with server-side checks.
**Phase 2 (next):** Merge Athletes (combine two athlete records, reversible from the log).
**Phase 3 (later):** Swift (2025) and old Google Sheet importers. Every stored row already carries `source`.

## How it works

- **Front end:** static site, vanilla ES modules, no framework and no bundler. GitHub Pages serves the repo root as-is.
- **Back end:** one Google Apps Script web app bound to a Google Sheet called "LEAD Data Center". The Sheet is the library.
- **Auth:** one shared password, set by you as the `APP_PASSWORD` Script Property. The page trades it for a random session token (6 hours, bound to the current password, kept in `sessionStorage`) and sends the token with every request; Apps Script checks it on every call. Five wrong passwords in a row pause sign-in for 15 minutes. The login screen alone protects nothing, because the site is public. The server is the gate. Changing `APP_PASSWORD` signs everyone out.
- **Config:** `config.js` holds only the public `SCRIPT_URL`. It is a placeholder until you finish [SETUP.md](SETUP.md).

## Layout

```
index.html  styles.css  config.js  CNAME  .nojekyll
src/
  app.js api.js auth.js csv.js state.js stats.js selection.js mockgate.js tests.js mock.js
  parsers/lumin.js            Lumin adapter (add other sources as sibling adapters)
  import/normalize.js match.js plan.js commit.js apply.js tags.js
  ui/shell.js upload.js review.js library.js history.js dom.js
apps-script/
  Code.gs                     GENERATED. Do not edit by hand.
  server.part.gs              hand-written server half (auth, Sheet I/O, backups)
  appsscript.json
scripts/build-gas.js          builds Code.gs from src/ + server.part.gs
scripts/make-sample.js        writes synthetic Lumin-shaped CSVs to ./data/ (git-ignored)
test/                         node --test, synthetic fixtures only
```

### Why Code.gs is generated

The write logic (name matching, dedupe, corrections, tags) must behave identically in the mock backend and in Apps Script. Rather than keep two copies in sync by hand, `src/import/{normalize,tags,match,commit}.js` and `src/tests.js` are the single source, and `node scripts/build-gas.js` concatenates them with `apps-script/server.part.gs` into `Code.gs`. A test fails if `Code.gs` is stale. After changing anything in those files:

```bash
node scripts/build-gas.js
```

then paste the new `Code.gs` into the Apps Script editor and redeploy (SETUP.md, "Updating the script").

## Run locally in mock mode

Mock mode is an in-memory backend seeded with synthetic data. It works only from `localhost`, `127.0.0.1` or `[::1]` with `?mock=1`; on any other host the code path is never loaded (a test enforces this).

```bash
python3 -m http.server 8741        # or any static server, from the repo root
# open http://localhost:8741/?mock=1
```

On the Upload screen, "Load synthetic sample export" loads an invented later export that overlaps the seeded library, with a corrected time, near-match names, an email-style profile, outliers, and an athlete with no times. To try a file by hand, run `node scripts/make-sample.js` and drop the files from `./data/`.

## Tests

```bash
node --test test/*.test.js
```

Covers the CSV reader, the Lumin parser, name normalization and matching, dedupe and corrections, tags and bulk tagging, and the Apps Script itself (the generated `Code.gs` runs in a Node `vm` against in-memory fakes of the Sheet, Drive, Cache, Lock and UrlFetch services): missing, expired, wrong and password-changed sessions return no data; wrong passwords lock out after five tries; formula-looking names are stored as text; the same file twice writes zero rows. Fixtures contain invented names only.

## Data rules

- Never commit real athlete data. `*.csv`, `data/` and `.env` are git-ignored.
- Every individual data point is kept forever. Lumin's Min, Max and Average columns are never stored or shown; best and latest are computed live.
- Nothing is written until the user confirms on the Review screen. The server recomputes all counts itself.
- Names and tags are rendered as text, never HTML (a test scans `src/` for HTML-injection APIs). Text cells written to Sheets are prefixed with `'` when they begin with `=`, `+`, `-` or `@`, and the text columns are formatted as plain text.

## Where this build differs from the brief

Each of these was a conflict between the brief and how the tools behave, or a gap the brief left open. The closest working option was chosen.

1. **Near-match edit distance is tighter than written.** The brief allows 2 edits when both first names have 4+ letters, but `Brody` vs `Roxy` is 2 edits, and acceptance test 7 requires that pair not to be flagged. Now: 1 edit needs 4+ letters on both sides, 2 edits need 6+ (first names). Last names: 1 edit at 5+, 2 edits at 7+. Nickname, prefix and swapped-name rules are as written.
2. **Blank athlete names cannot be included.** They are skipped and counted under Needs attention with no checkbox, because an unnamed athlete record would be unusable. Email-style names get the include checkbox as specified.
3. **The server does not re-parse the CSV.** It archives the raw file to Drive and independently validates and re-deduplicates the long records the page sends (test names, ISO dates, numeric times, names, tags, match decisions), then recomputes every count. Duplicating the Lumin parser in Apps Script would add a second place for the format to drift.
4. **Archive first.** If the raw file cannot be saved to Drive, the import is refused and nothing is written, so every stored row traces back to a file.
5. **Dim text is lighter than the mockups.** The mockups use `#5a5a5a` and `#6a6a6a` for small labels, which are about 3:1 on the dark page. They are lifted to `#7e7e7e` to meet the 4.5:1 requirement.
6. **Tag changes apply immediately in the page and refresh in the background.** The brief says to refresh after any write; a full reload after every chip click would be slow on Apps Script, so the page applies the server's response, then re-fetches quietly and drops that refresh if another write has started.
7. **Auth changed from Google sign-in to a shared password** at Blair's request. Consequences: no per-person identity, so the logs record `shared-password` in `user_email`; and password-only protection is weaker than Google accounts, so the lockout and the 10-character minimum are there to compensate. Use a long passphrase.
8. **A Content-Security-Policy meta tag** limits scripts to this site. If you add another external resource it must be added to the policy in `index.html`.
9. **Extra files** not in the brief's layout: `src/ui/dom.js`, `src/tests.js`, `src/stats.js`, `src/selection.js`, `src/mockgate.js`, `src/mock.js`, `src/import/{apply,commit,tags}.js`, `apps-script/server.part.gs`, `scripts/`, `package.json`.
10. **"Write N Rows"** on the confirm button is the number of new data points. Time corrections update existing rows and are listed separately.
