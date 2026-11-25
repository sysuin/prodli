# ProdLi on Microsoft Edge Add-ons

The same package as the Chrome Web Store runs in Microsoft Edge. Edge has every extension API ProdLi uses except Chrome's own Google sign-in (`identity.getAuthToken`), so in Edge:

- **Signing in** opens app.prodli.com in a tab, where you sign in and press Connect ProdLi (`src/lib/webSignIn.ts`).
- **Google Calendar and Google Drive backup** aren't offered: both need Chrome's sign-in. Everything else works, including sync, AI, the meeting recorder and focus blocking.

Microsoft's guides: [publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) and [the update REST API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api).

## 1. First listing (by hand, once)

Microsoft's API can only update a listing, so the first one is created in Partner Center.

1. **Register** for the Microsoft Edge program in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview). It's free.
2. **Get the package:** GitHub → Actions → **Store** → Run workflow → **build** → download `prodli-extension-store-1.5.0` from the run and unzip it once to get `prodli-extension-store.zip`.
3. **Create the extension:** Partner Center → Microsoft Edge → Create new extension → upload the zip.
4. **Tell Claude the extension ID** Edge gives it (Extension overview → "Extension identity"; 32 letters). It goes into `EXTRA_EXTENSION_IDS` in `artifacts/prodli-api/wrangler.jsonc`, and then production needs a deploy. **Until that's deployed, the Edge copy can't sign in or reach ProdLi's server**, so do this before submitting.
5. **Availability:** all markets, Public.
6. **Properties:** category **Productivity**. Privacy policy: `https://prodli.com/privacy`. Website: `https://prodli.com`. Support: `contact@prodli.com`. Mature content: no.
7. **Store listing (English):**
   - **Description:** the one in STORE_SUBMISSION.md section 3, with two changes:
     - "Markdown, CSV, JSON and text files opened in Chrome show in ProdLi's viewer" → "… opened in your browser show in ProdLi's viewer";
     - in PRIVACY, drop "Google Calendar is optional: … if you turn that on." (Calendar isn't offered in Edge).
   - **Short description:** the summary in STORE_SUBMISSION.md section 3.
   - **Store logo (300×300):** `artifacts/prodli/public/icon-512.png`, scaled down.
   - **Screenshots (1280×800):** the five in STORE_SUBMISSION.md section 2, same order. **Small promotional tile (440×280):** `promo-440x280.png`.
8. **Submit.** In "Notes for certification", paste the reviewer notes from STORE_SUBMISSION.md section 4, then add: "Sign-in opens app.prodli.com in a tab (Edge has no identity.getAuthToken)."

Microsoft's review usually takes up to 7 business days.

## 2. Updates from GitHub (once the listing exists)

1. **Partner Center → Microsoft Edge → Publish API → Create API credentials** (if it offers "enable the new experience", click Enable first). Write down the **Client ID** and **API key**. API keys expire: the page shows the date, and you renew them there.
2. **Product ID:** Extension overview → Extension identity (a GUID like `d34f98f5-…`).
3. **GitHub** → Settings → Secrets and variables → Actions:
   - Secrets: `EDGE_CLIENT_ID`, `EDGE_API_KEY`.
   - Variable: `EDGE_PRODUCT_ID`.
4. **Release:** Actions → **Store** → Run workflow:
   - **edge-upload** puts the zip in the listing's draft; review it in Partner Center and press Publish.
   - **edge-submit** uploads and submits it for certification in one go, with "ProdLi <version> (commit …)" as the notes.

   Raise the version in `artifacts/prodli/extension/manifest.json` first (the same number as the Chrome Web Store). As with Chrome, the API only sends the package: the description and screenshots are changed in Partner Center.

If a run says Edge refused the API key, it has probably expired: create a new one (step 1) and replace `EDGE_API_KEY`. `node artifacts/prodli/scripts/edge-store.mjs` prints its usage; it's what the workflow runs.
