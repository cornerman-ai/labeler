# Apps Script backend — deployed from GitHub

`Code.js` is the Google Apps Script bound to the **Box Labeled Data** Sheet,
deployed as the Web App every labeler page posts to. It deploys from this
repo: any push to `master` touching `apps_script/**` runs
`.github/workflows/deploy-apps-script.yml`, which pushes the code with
[clasp](https://github.com/google/clasp) and updates the existing Web App
deployment in place — same `/exec` URL, so nothing in the pages changes.

**GitHub is the only door.** Never EDIT code in the Apps Script editor — the
next CI run overwrites it (`clasp push -f`). The editor is still where you
RUN one-off maintenance functions, just not where code changes.

## One-time setup (owner account only)

Done once, by the Google account that owns the Sheet and its Web App
deployment. Until then the workflow fails with "CLASPRC_JSON secret not set".

1. Enable the Apps Script API for that account:
   https://script.google.com/home/usersettings
2. Install clasp (same major version as the workflow pins) and log in:
   ```
   npm install -g @google/clasp@3
   clasp login          # browser auth; writes credentials to ~/.clasprc.json
   ```
3. Put the script ID in `.clasp.json`: open the Sheet → Extensions →
   Apps Script → Project Settings (gear) → copy **Script ID** → replace
   `REPLACE_WITH_SCRIPT_ID`.
4. Pull the live project once to sync state:
   ```
   cd apps_script && clasp pull
   ```
   - `appsscript.json` (the manifest: timezone, runtime, web-app access
     config) appears — commit it.
   - If the pull created a code file with a DIFFERENT name than `Code.js`
     (clasp uses the editor's file name), keep the pulled name and
     `git rm Code.js` — otherwise both files get pushed back and every
     function is defined twice.
   - `git diff Code.js` now shows repo-vs-deployed drift. Keep the repo
     version (`git restore Code.js`) unless the editor had changes the repo
     lacks — reconcile by hand in that case.
5. Store the credentials as the secret CI deploys with:
   ```
   gh secret set CLASPRC_JSON --repo cornerman-ai/labeler < ~/.clasprc.json
   ```
6. Commit + push the manifest, then trigger the first deploy and watch it:
   ```
   gh workflow run deploy-apps-script.yml --repo cornerman-ai/labeler
   gh run watch --repo cornerman-ai/labeler
   ```
7. Verify: the Apps Script editor shows the pushed code, and a labeler page
   still saves a row to the Sheet.

## How the URL stays stable

`clasp push -f` uploads the files; `clasp deploy -i <deploymentId>` points
the EXISTING deployment — the `AKfycb…` id inside the `/exec` URL hardcoded
in `shared/player.js` — at a new version. Because the deployment is reused
rather than recreated, the URL and the execute-as identity never change.

## Cautions

- `CLASPRC_JSON` is an OAuth token for the owner's Google account (Apps
  Script scopes). Repo **admins** could read it via a workflow edit — keep
  admin access tight. Fork PRs never see secrets, and the deploy only
  triggers on pushes to `master` (collaborators) or manual dispatch.
- A Google password change / security event revokes the token → deploys fail
  until `clasp login` + step 5 are repeated.
- Each deploy creates a new script version and Apps Script caps a project at
  ~200 versions — years away at this pace, but prune old versions if ever hit.
