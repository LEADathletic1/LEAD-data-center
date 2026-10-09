# SETUP: what Blair does, in order

Everything in the repo is built and tested. These steps connect it to your Google Sheet and publish it. **Do them in this order.** GitHub Pages comes after `config.js` has real values (step 6), because the site is public from the moment Pages is on.

Time: about 45 minutes, plus waiting for the HTTPS certificate.

You will collect these along the way. Keep a scratch note (do not paste the password anywhere except Script Properties):

| Value | From step |
|---|---|
| Archive folder ID | 2 |
| Backup folder ID | 2 |
| The password you choose | 3 |
| Web app URL | 5 |

---

## 1. Create the Google Sheet

1. In Google Drive (signed in as `info@trainatlead.com` or the account that should own the data), create a new Google Sheet named exactly **LEAD Data Center**.
2. Leave it empty. The script creates the tabs.

## 2. Create two Drive folders

1. Create **LEAD Data Center – Raw Uploads** and **LEAD Data Center – Backups**.
2. Open each folder. The ID is the last part of the address: `drive.google.com/drive/folders/`**`THIS_PART`**. Copy both IDs.
3. Do not share these folders. They hold athlete data.

## 3. Choose the password

Pick a long passphrase, at least 12 characters (4 or 5 random words is ideal). The site is public and the data is about minors, so a short or guessable password is the weak point. Failed logins are slowed down, but a strong password is your main protection. You will paste it into Script Properties in the next step, and the setup function deletes it from there straight away. It is never written into the repo or the website, and only a salted hash is kept.

## 4. Install the script on the Sheet

1. Open the Sheet → **Extensions → Apps Script**.
2. Delete the placeholder code, then paste the whole of `apps-script/Code.gs` from this repo. Save.
3. Left sidebar → **Project Settings** (gear) → tick **Show "appsscript.json" manifest file in editor**. Back in the editor open `appsscript.json` and replace its contents with `apps-script/appsscript.json` from this repo. Save.
4. **Project Settings → Script Properties → Add script property**, three times:

   | Property | Value |
   |---|---|
   | `INITIAL_PASSWORD` | the password from step 3 (temporary, deleted in step 5) |
   | `ARCHIVE_FOLDER_ID` | the Raw Uploads folder ID from step 2 |
   | `BACKUP_FOLDER_ID` | the Backups folder ID from step 2 |

5. In the editor, pick the function **`initSetup`** and click **Run**. It stores the password as a salted hash, generates the session secret, and **deletes `INITIAL_PASSWORD`**. Refresh Script Properties to confirm it is gone and that `PASSWORD_HASH`, `PASSWORD_SALT`, `PASSWORD_VERSION` and `SESSION_SECRET` now exist. Then pick **`setup`** and click **Run** to create the tabs. Google asks for permission: **Review permissions → choose your account → Advanced → Go to LEAD Data Center (unsafe) → Allow**. (The "unsafe" warning appears because you wrote the script yourself and have not submitted it to Google for review. That is expected.) Afterwards the Sheet has tabs: Athletes, 10 Yard, 30 Yard, Import Log, Corrections, Tag Log, Name Decisions.

## 5. Deploy the web app and copy its URL

1. **Deploy → New deployment → gear icon → Web app.**
   - Description: `v1`
   - **Execute as: Me**
   - **Who has access: Anyone**
2. Click **Deploy**, authorize if asked, and copy the **Web app URL** (it ends in `/exec`).
3. Check it: paste the URL into a browser tab. You should see `LEAD Data Center API. Use POST.` and no data.

"Anyone" is correct. The real access control is the password and session check the server makes on every request.

## 6. Put the web app URL into `config.js` and push

Tell Claude Code: *"Set SCRIPT_URL to `<web app URL>` in config.js, run the tests, and push to main."* (Never send the password.)

Or edit `config.js` yourself:

```js
export const SCRIPT_URL = 'https://script.google.com/macros/s/xxxxxxxx/exec';
```

Do not continue until this is pushed. **Do not turn on GitHub Pages before this.**

## 7. Turn on GitHub Pages and the custom domain

1. GitHub → `LEADathletic1/LEAD-data-center` → **Settings → Pages**.
2. **Source: Deploy from a branch → Branch `main` → Folder `/ (root)` → Save.**
3. **Custom domain:** enter `data.trainatlead.com` → Save. (The repo already contains the `CNAME` file.)
4. In **Wix** (DNS for trainatlead.com): add a **CNAME** record, Host/Name `data`, Value `leadathletic1.github.io`. Save.
5. Back on the Pages settings, wait for "DNS check successful" (minutes to a few hours). GitHub then issues the certificate.
6. When the **Enforce HTTPS** box becomes clickable, tick it.

A public repo is fine: it holds code only, no data and no secrets. GitHub Pages on a private repo needs a paid plan. If you make the repo private, confirm your plan supports Pages.

## 8. Smoke test on the live site

Open `https://data.trainatlead.com`.

1. Enter your name and the password, then Enter. You should land on Upload with your name in the top bar.
2. Sign out, then try a wrong password. You should see "Incorrect password" and no data. (Each failure makes the next attempt wait longer, up to 10 seconds.)
3. Sign in again with the right password.
4. Make a small **synthetic** test file (invented names only, never real athletes), import it with a tag, and confirm. Check the Sheet: rows appear in the tabs, a row in Import Log, and the raw file in the Raw Uploads folder.
5. Import the exact same file again. The review screen should show 0 new data points, and the Sheet row counts should not change.
6. Delete your test rows from the Sheet afterwards (select the rows, right-click, Delete rows) and remove the test file from the archive folder.

## 9. Turn on weekly backups

In the Apps Script editor pick **`installWeeklyBackupTrigger`** and **Run** once. It schedules `backupSheet` for Sundays around 3 AM. Each run copies the whole Sheet into the Backups folder and keeps the newest 12. Pick `backupSheet` and Run once now to check that a copy appears.

---

## Day to day

**Before each Lumin purge:** export the CSV from Lumin, open the Data Center, drop the file, add at least one tag, review, decide any name matches, confirm. Check the "authoritative counts" panel afterwards.

**Change the password:** in the app, Settings → Change Password (current password, then a new one of 12+ characters). This signs everyone out on every device, including you, and they sign in with the new one. Do it whenever someone who knew the password leaves.

**Forgot the password:** in Apps Script add a Script Property `INITIAL_PASSWORD` with a new password and run `initSetup` again. Existing sessions end, and the property is deleted again.

**Sessions:** a sign-in lasts 7 days on that browser, or until Sign out or a password change.

**Who did what:** the name typed at sign-in is recorded in the `user_name` column of Import Log, Tag Log and Corrections. It is not verified, so treat it as a convenience, not proof.

**Updating the script:** after any change to the shared logic run `node scripts/build-gas.js`, paste the new `Code.gs`, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**. The URL stays the same.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Not configured yet" on the live site | `config.js` still has the placeholder, or the push has not been published yet |
| "The password has not been set up on the server yet" | `initSetup` has not been run, or `INITIAL_PASSWORD` was missing or under 12 characters when it ran |
| Sign-in feels slow after a mistake | Deliberate: each failed attempt adds a wait (2s up to 10s). It resets after a good login or 15 quiet minutes |
| Correct password rejected | Typo, or the password was changed in Settings. To recover, use the "Forgot the password" steps above |
| "The server sent a response the page could not read" | `SCRIPT_URL` is wrong, or the deployment is not set to Execute as **Me** / Access **Anyone** |
| Import refused: archive error | `ARCHIVE_FOLDER_ID` missing or wrong, or the deploying account cannot write to that folder |
| "Another import or tag change is in progress" | Two writes at once. Wait a few seconds and retry |
| Unknown test or metric blocks an import | Lumin exported a test the tool does not know. Add it to `TEST_MAP` in `src/parsers/lumin.js` and `TEST_TABS` in `src/tests.js` and rebuild (needs Claude Code) |
