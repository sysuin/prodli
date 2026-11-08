# Turning on "Sign in with Google" (free)

ProdLi's Google sign-in uses Chrome's built-in identity API and backs up to the user's **own** Google Drive app-data folder. There's no ProdLi server, and everything below is free.

The code is done; it needs a Google OAuth **client ID** that belongs to you. Until one is set, the 👤 button explains that sign-in isn't set up and everything else works normally.

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

1. Chrome Web Store Developer Dashboard → ProdLi → **Package** → **View public key**. Copy the key (the long text between the BEGIN/END lines, as one line).
2. Build with both values:

```bash
PRODLI_GOOGLE_CLIENT_ID="1234-abc.apps.googleusercontent.com" PRODLI_EXTENSION_KEY="MIIBIjANBgkq…" pnpm run build:extension
```

> Tip: keep them in your shell profile or a local `.env` you `source` — never commit them. (`.env*` is git-ignored.)

Load `artifacts/prodli/dist-extension` unpacked; its ID now matches the store, and 👤 → **Sign in with Google** works. Disable the store copy while testing (same ID).

## 3. CI and releases

Add repository secrets in GitHub (**Settings → Secrets and variables → Actions**):

- `PRODLI_GOOGLE_CLIENT_ID`
- (optional) `PRODLI_EXTENSION_KEY` — not needed for store uploads (the store assigns the ID), only for testing CI-built zips unpacked.

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
