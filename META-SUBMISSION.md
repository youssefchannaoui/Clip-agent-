# Meta app — configuration and submission notes

Created 24 Aug 2026. Everything Meta's forms already hold is recorded here so
nothing has to be re-derived from the dashboard, and so a re-submission does
not start from a blank page the way the TikTok production app did.

## The app

| Field | Value |
|---|---|
| App name | DeenClipped |
| **App ID** | **1855569988735396** |
| App secret | Not recorded here, deliberately. See "The secret" below. |
| Contact email | youssefchannaoui05@gmail.com |
| Publish status | **Unpublished** (development mode) |
| Business portfolio | Yccosmeticcustoms (`1142434914404032`) — attached 24 Aug |

### Use cases selected at creation

- **Manage messaging & content on Instagram**
- **Manage everything on your Page**

They were chosen because between them they carry the five scopes `src/social.js`
actually sends. Nothing else was added; a use case you do not use is a
permission you have to justify at review.

### Products

**Facebook Login for Business** — this is what the new app-creation flow gives
you. There is no "classic" Facebook Login product to pick any more, and that
matters (see "config_id" below).

## Settings as configured

| Setting | Value |
|---|---|
| App domains | `deenclipped.online` |
| Website platform → Site URL | `https://deenclipped.online/` |
| Privacy policy URL | `https://deenclipped.online/privacy` |
| Terms of Service URL | `https://deenclipped.online/terms` |
| User data deletion | Data deletion **instructions** URL → `https://deenclipped.online/privacy` |
| Category | Business and pages |
| App icon | 1024×1024 PNG rendered from `src/public/favicon.svg` |
| Valid OAuth Redirect URI | `https://deenclipped.online/auth/meta/callback` |

Two of these fought back and are worth knowing about:

- **App domains would not save on the first attempt.** Entering it before the
  Website platform existed silently dropped the value — it looked saved, and
  came back empty after a reload. Add the Website platform first, then the
  domain. Always reload and re-read the field rather than trusting the
  "Changes saved" toast.
- **The icon crop dialog clips a square image.** Its image pane is wider than
  it is tall, so a 1024×1024 upload cannot be fully selected — the default crop
  box takes roughly the middle 70% and cuts the arch off top and bottom. The
  icon that was uploaded is therefore drawn *inset*: the artwork is scaled to
  ~70% and centred on the `#0E0E11` background, so the default crop captures all
  of it. Regenerate it the same way if it is ever replaced.

## `config_id`, and the error that lied about App Domains

**Settled 24 Aug 2026 by trying it.** Facebook Login for Business does not take
a scope list. It takes a **`config_id`** naming a saved configuration.

| | |
|---|---|
| Configuration name | DeenClipped publishing |
| **Configuration ID** | **1086882974287802** |
| Access token type | **User access token** (cannot be changed later) |
| Permissions | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` |

`META_LOGIN_CONFIG_ID` on Render carries it. With it set, `oauthStartUrl` sends
`config_id`; with it unset it falls back to `scope`, which is what a classic
Login app needs.

### The app-level redirect URI field does not save. At all.

**Facebook Login for Business → Settings → Valid OAuth Redirect URIs** accepts
`https://deenclipped.online/auth/meta/callback`, answers **"Changes saved"**, and
is empty again on reload. Three attempts, spread across adding the app domain,
the Website platform, all five permissions, and finally the configuration
itself. It never persisted once.

That is what produced:

> Can't load URL — The domain of this URL isn't included in the app's domains.

The message points at App Domains, which was correct the whole time. The
missing half was the redirect URI, and on this app type it cannot be supplied
through that field — only through a configuration. Do not spend time on App
Domains when you see this error on a Login-for-Business app.

### Two permission traps found the same way

- **The Instagram permissions are not in the Instagram use case.** The
  `INSTAGRAM_BUSINESS` use case offers `instagram_business_basic`,
  `instagram_business_content_publish` and friends -- the *Instagram Login* API,
  which is a different API from the one this app uses. Ours are behind
  **Instagram API → API setup with Facebook login**, which has an "Add required
  content permissions" button. Until that is pressed, `instagram_basic` and
  `instagram_content_publish` do not appear anywhere and the configuration
  cannot include them.
- **That setup page misspells one of them.** It lists
  `instagram_content_publishing`. The real permission, on the Permissions and
  features page and in the configuration picker, is **`instagram_content_publish`**
  -- which is what the code already sent. Do not "fix" the code to match that page.

## The secret

`META_APP_SECRET` is **not** in this file and must not be pasted into a chat
transcript — that is exactly how the TikTok secret ended up needing rotation.
Revealing it requires re-entering the Facebook password, so it is a step only
the account owner can take.

    App settings → Basic → App secret → Show

Copy it straight into Render's environment variable editor. `META_APP_ID` is
already set on Render (`srv-d9lnb57lk1mc7392pbog`); the secret is the only
missing half, and `providerConfigured('meta')` stays false until both are set.

## What development mode already allows

The app does **not** need review to work for its own admins. In development
mode the connect flow, Page listing, Instagram linking and publishing all work
for accounts with a role on the app. The prerequisites are both already met:

- Facebook Page **DeenClipped** exists and is managed by this account.
- An Instagram profile is linked to it in the same business portfolio.

`connectMeta` throws outright when `/me/accounts` returns no Page, so those two
are hard requirements, not nice-to-haves.

## Going public

Publishing needs **App Review** for the five permissions *and* **Business
Verification** of Yccosmeticcustoms — the legal entity, with documents. Neither
has been started. Screencasts showing each permission in use are required, the
same shape as the TikTok demo video.

## Privacy policy

Updated 24 Aug 2026 (commit `53f34b3`) to describe Meta and TikTok data, not
only Google's. Reviewers check that the policy names their platform and the
data taken; before that commit it described YouTube and stopped, which was both
a review failure and simply out of date.
