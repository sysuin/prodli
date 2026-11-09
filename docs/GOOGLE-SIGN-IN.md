# Turning on "Sign in with Google" + Drive sync (free)

ProdLi's Google sign-in uses Chrome's built-in identity API and syncs (merges item by item, deletions included) through the user's **own** Google Drive app-data folder. There's no ProdLi server, and everything below is free.

The code is done; it needs a Google OAuth **client ID** that belongs to you. Until one is set, the 👤 button explains that sign-in isn't set up and everything else works normally.

## Status (2026-11-09)

Steps 1 and 2 are done for ProdLi:

- Google Cloud project **`prodli`**: Drive API on, Google Auth Platform set up (External, **Testing**), branding + the four non-sensitive scopes saved, test user `sunnysinghnitb@gmail.com`.
- OAuth client "ProdLi Chrome extension" — client ID `1063523043715-buer16fjveuaod8kefjspm2vlq4idpdh.apps.googleusercontent.com` (client IDs are public; they're in every shipped manifest).
- Both build values are in the git-ignored `.env.local` at the repo root: `source .env.local && pnpm run build:extension`.

Still to do: the `PRODLI_GOOGLE_CLIENT_ID` GitHub secret (step 3) and **Publish app** before the store release (step 4).

## 1. Google Cloud project (one time, ~10 minutes)

1. Go to https://console.cloud.google.com/ → create a project, e.g. **ProdLi** (no billing account needed).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External**.
   - App name **ProdLi**, support email, logo (optional).
   - App domain: homepage `https://prodli.com`, privacy policy `https://prodli.com/privacy`.
   - Authorized domain: `prodli.com`.
   - **Scopes**: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.appdata`. All are **non-sensitive**, so no security assessment is required.
   - While in **Testing**, add yourself (and up to 100 testers) under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Chrome extension**.
   - Item ID: **`gjgknflakhglanjaeenkmciohimnbkdp`** (ProdLi's Chrome Web Store ID).
   - Copy the client ID (`…apps.googleusercontent.com`).

## 2. Make local builds use the store ID

OAuth client IDs are tied to an extension ID. Unpacked builds normally get a random ID, so give them the store's ID:

1. Chrome Web Store Developer Dashboard → ProdLi → **Package** → **View public key**. Copy the key (the long text between the BEGIN/END lines, as one line). Or, if the store version is installed, copy the `"key"` value from its `manifest.json` in your Chrome profile (`…/Chrome/<Profile>/Extensions/gjgknflakhglanjaeenkmciohimnbkdp/<version>/manifest.json`).
2. Build with both values:

```bash
PRODLI_GOOGLE_CLIENT_ID="1234-abc.apps.googleusercontent.com" PRODLI_EXTENSION_KEY="MIIBIjANBgkq…" pnpm run build:extension
```

> Tip: keep them in your shell profile or a local `.env` you `source` — never commit them. (`.env*` is git-ignored.)

Load `artifacts/prodli/dist-extension` unpacked; its ID now matches the store, and 👤 → **Sign in with Google** works (it syncs right away, then about every hour). Disable the store copy while testing (same ID).

## 3. CI and releases

Add repository secrets in GitHub (**Settings → Secrets and variables → Actions**):

- `PRODLI_GOOGLE_CLIENT_ID`
- (optional) `PRODLI_EXTENSION_KEY` — not needed for store uploads (the store assigns the ID). The build keeps `key` only in the unpacked `dist-extension` folder and leaves it out of `prodli-extension.zip`, because the Web Store rejects uploads that contain it.

The CI workflow passes them to the build, so the zip attached to each run has sign-in enabled.

## 4. Going public

- In **Testing** mode only listed test users can sign in. Click **Publish app** on the consent screen to allow everyone.
- With only non-sensitive scopes, Google's review is the light "brand verification" (name, logo, domain, privacy policy). The privacy policy at prodli.com/privacy already includes the required Google API **Limited Use** statement.
- Chrome Web Store: the new `identity` and `unlimitedStorage` permissions show no install warning, so existing users update silently.

## Limits & notes

- Works in Google Chrome (the identity API isn't available in Brave/Arc/Edge in the same way). Other browsers simply don't show sign-in as working; nothing else is affected.
- The user must be signed in to Chrome with a Google account (Chrome prompts if not).
- Drive storage used counts toward the user's Drive quota (typically a few hundred KB).
- Users can delete the backup any time: Google Drive → Settings → Manage apps → ProdLi → **Delete hidden app data**.
