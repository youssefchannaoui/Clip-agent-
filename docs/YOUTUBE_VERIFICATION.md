# DeenClipped Google OAuth and YouTube approval submission

This checklist separates two reviews that solve different problems:

1. **Google OAuth verification** approves the DeenClipped brand and the `youtube.readonly` and `youtube.upload` permissions for public users.
2. **YouTube prior written approval** is a separate request covering any future import, temporary storage or clipping of YouTube audiovisual content. OAuth verification alone does not grant source-video download access, and the public YouTube Data API does not expose an original-file download endpoint.

Do not enable cookie collection, CAPTCHA avoidance, residential proxies, an undocumented YouTube endpoint or a downloader represented as an official YouTube API feature while either review is pending.

## Production values

Use these exact values in Google Auth Platform:

- App name: `DeenClipped`
- Homepage: `https://deenclipped.online/`
- Privacy policy: `https://deenclipped.online/privacy`
- Terms of service: `https://deenclipped.online/terms`
- Support email: `support@deenclipped.online`
- Authorized domain: `deenclipped.online`
- YouTube OAuth redirect URI: `https://deenclipped.online/auth/youtube/callback`
- Account sign-in redirect URI: `https://deenclipped.online/auth/google/callback`

The YouTube connection uses a separate OAuth client from ordinary Google account sign-in. Store client secrets only in Render environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://deenclipped.online/auth/youtube/callback`

Never put a client secret in GitHub, a screenshot, the verification video or the browser application.

## Requested Google scopes

Register exactly these YouTube scopes on the production OAuth consent screen:

- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.upload`

Do not add broader scopes unless a finished, visible feature requires them.

### Copy-ready scope justification: `youtube.readonly`

> DeenClipped uses `youtube.readonly` only after a signed-in creator chooses Connect YouTube and provides affirmative consent. The app calls `channels.list` with `mine=true` to identify the creator's connected channel, display its channel name and profile image, and let the creator test that the intended publishing destination remains connected. A narrower identity-only scope does not provide the authenticated YouTube channel identity required to prevent publishing to an unintended channel. DeenClipped does not request or use watch history, subscriptions, comments or browsing activity.

### Copy-ready scope justification: `youtube.upload`

> DeenClipped uses `youtube.upload` to upload a rendered short-form clip to the creator's own connected YouTube channel only after the creator has approved or scheduled that clip in the visible publishing workflow. The creator chooses the destination and privacy setting, can disable automatic publishing, and can disconnect YouTube at any time. No broader YouTube write scope is requested. The upload-specific scope is the narrowest scope that supports this user-facing publishing feature.

## OAuth verification submission checklist

- [ ] Verify ownership of `deenclipped.online` in Google Search Console using the same Google account that owns or edits the Cloud project.
- [ ] Set the OAuth app audience to External and publishing status to In production.
- [ ] Add the homepage, privacy policy, terms, support email and authorized domain above.
- [ ] Register both scopes above and paste their separate justifications.
- [ ] Confirm every production OAuth client belongs to this same DeenClipped project and remove unused clients.
- [ ] Confirm the production Render service contains the exact YouTube redirect URI above.
- [ ] Record the verification demonstration described below.
- [ ] Submit from Google Auth Platform → Verification Center.

## Verification demonstration recording

Record one uncut or clearly narrated video in English. Do not show secrets.

1. Open `https://deenclipped.online/` and show that the homepage describes the product and links to Privacy and Terms.
2. Open the Privacy Policy and briefly show the Google/YouTube data, security, retention, revocation and deletion sections.
3. Sign in to a normal creator account and open Platforms.
4. Click Connect on YouTube and show the DeenClipped pre-consent notice.
5. Continue to Google. Keep the Google consent-screen language set to English and show the complete requested permissions.
6. Approve access and return to DeenClipped. Show the connected channel identity.
7. Run Test connection.
8. Show a rendered clip, its title/description/privacy controls, and the explicit approve or schedule action that causes an upload.
9. Return to Platforms, disconnect YouTube, and explain that DeenClipped removes the encrypted credential, disables future uploads and sends Google a revocation request.
10. Show the Google Account connections page or refresh DeenClipped to demonstrate that the channel is no longer connected.

Upload the demonstration as an unlisted video or to a reviewer-accessible Drive link and paste that URL into the verification submission.

## YouTube API compliance and prior-written-approval request

Use the official form:

`https://support.google.com/youtube/contact/yt_api_form`

Complete it with the production Google Cloud project number, project ID, DeenClipped website and your real legal/business contact details. Request an API compliance audit and clearly ask for a written decision on audiovisual source access; do not describe ordinary OAuth verification as permission to download.

### Copy-ready product explanation

> DeenClipped is a creator-facing application that turns long-form videos into reviewable short-form clips with captions and publishing controls. Each end user signs in to a private DeenClipped workspace. Users may upload source files they own or are authorised to use. They review generated clips and explicitly approve or schedule publishing to their own connected platform accounts. The YouTube Data API integration currently identifies the user's own connected channel and uploads user-approved rendered clips. OAuth credentials are encrypted, account-scoped and removed when the user disconnects.

### Copy-ready compliance statement

> DeenClipped does not ask users for browser cookies, does not use a proxy or CAPTCHA bypass, does not access undocumented YouTube APIs and does not represent the YouTube Data API as providing a video-download endpoint. The public service keeps original-file upload available. Google/YouTube data is used only for visible user-facing channel connection and publishing features, is not sold or used for advertising, and is not used to train a general-purpose AI model. Users can disconnect at any time and verified data-deletion requests are completed within 30 days.

### Copy-ready request for prior written approval

> DeenClipped requests YouTube's prior written approval and technical guidance for a future feature limited to videos owned by the end user's OAuth-connected YouTube channel. If approved, the intended feature would let that user select one of their own videos, temporarily retrieve and store the audiovisual source solely to generate user-requested short-form derivative clips, and delete the temporary source according to the approved retention period. Please confirm whether this use case can be approved under Section III.E.1 of the YouTube API Services Developer Policies and, if so, specify the documented or otherwise authorised technical mechanism, required ownership checks, retention limits, user disclosures and additional agreement terms. DeenClipped will not enable this feature unless and until written approval and a permitted retrieval mechanism are provided.

### Expected reviewer questions

Be ready to provide:

- The production Cloud project number and project ID.
- A test creator account that can reach every reviewed feature.
- Screenshots or a recording of the end-to-end OAuth and upload flow.
- An explanation of token encryption, account isolation, revocation and deletion.
- Confirmation that imported/source data is not used to train a general-purpose AI model.
- A precise retention schedule if YouTube offers written approval.
- Proof that users control or are authorised to use the selected source content.

## What approval does and does not mean

- OAuth verification can remove the unverified-app limitation for approved scopes.
- A quota/compliance audit can approve normal documented API use and additional quota.
- Neither process silently creates a source-file download API.
- Source import and derivative clipping need explicit written approval plus a technical method YouTube authorises.
- Until both are received, original MP4/MOV upload remains the compliant production source path.

Official references:

- YouTube Developer Policies: <https://developers.google.com/youtube/terms/developer-policies>
- YouTube API compliance audits: <https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits>
- Google OAuth verification: <https://support.google.com/cloud/answer/13463073>
- Google verification requirements: <https://support.google.com/cloud/answer/13464321>
