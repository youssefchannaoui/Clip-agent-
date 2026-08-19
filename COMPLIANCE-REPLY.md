# Reply to the YouTube API Services ToS Violations Report

Report dated 13 August 2026 · Project Number 881648803263 · API Client: Youssef Channaoui

**Before sending:** one answer below is marked `[YOU MUST CONFIRM]`. Only the
account holder can answer it. Everything else is factual and has been verified
against the deployed code.

Send as a reply to the YouTube API Services thread in Gmail.

---

## Suggested reply

Hello,

Thank you for the compliance review. All four items have been addressed. Details
below, in the order of your report.

### D — Accessing YouTube API Services · Policy III.D.1c

> Please confirm if you use multiple project numbers for the given API Client.

`[YOU MUST CONFIRM]` — one of the following:

- *If you only have one project:*
  "We use a single Google Cloud project for this API Client: project number
  881648803263. No other project numbers access YouTube API Services on our
  behalf."

- *If you have more than one:*
  "We use the following project numbers for this API Client: 881648803263,
  <other numbers>. <Say what each is for, e.g. one for production and one for
  development.>"

To check: open <https://console.cloud.google.com>, click the project selector,
and look for any other project with the YouTube Data API enabled.

### A — API Client Terms of Use and Privacy Policies · Policy III.A.2d

> The privacy policy does not explain to users what user information, including
> API Data relating to users, the API Client accesses, collects, stores and
> otherwise uses.

Our privacy policy at <https://deenclipped.online/privacy> has been updated. It
now contains a section titled "YouTube API Data we access, store and use" which
lists every item obtained through YouTube API Services:

- the channel identifier, channel name and channel profile image, read once when
  a user connects a channel;
- the granted permission list and the encrypted OAuth access and refresh tokens;
- the video title, duration and thumbnail image URL of a YouTube link a user
  submits for clipping;
- the video identifier of a clip our application uploaded on the user's behalf.

The policy also names the two scopes we request — `youtube.upload` and
`youtube.readonly` — states the retention period for each category, and links to
<https://myaccount.google.com/permissions> so users can revoke access through
Google directly as well as through our application.

### E — Handling YouTube Data and Content · Policy III.E.4.a-g

> How often do you refresh/update or delete YouTube data? API Clients must not
> display or store statistics retrieved as Authorized or Non-Authorized Data for
> more than 30 days.

**We do not retrieve, store or display YouTube statistics of any kind.** Our only
metadata request to the YouTube Data API is:

```
GET /youtube/v3/videos?part=snippet,contentDetails&id=<videoId>
```

We do not request the `statistics` part, so no view counts, like counts, comment
counts or subscriber counts exist anywhere in our systems, and nothing of that
kind is displayed to users.

For the YouTube API Data we do store, our refresh and deletion practice is:

| Data | Practice |
|---|---|
| Video title, duration, thumbnail URL of an imported link | Deleted 30 days after it is retrieved |
| Connected channel name and profile image | Deleted 30 days after it is retrieved |
| Channel identifier | Retained while the user's connection is active; deleted immediately on disconnection |
| OAuth access and refresh tokens | Stored encrypted; deleted immediately on disconnection, and revocation is requested from Google |
| Identifier of a video we uploaded for the user | Retained as the user's own record of what was published |

Deletion is performed by an automated process that runs every 24 hours and
removes any cached YouTube API Data older than 30 days. Where that data is
needed again, it is re-requested from the API at that time rather than held
speculatively. This behaviour is covered by automated tests in our codebase so
that it cannot regress.

### F — User Experience · Policy III.F.2a,b

> YouTube logos and icons do not follow our Branding guidelines. Do not modify
> YouTube colour and shape. Minimum height 20 dp. Colour combination "Red and
> White" or "Black and White".

Corrected on every screen shown in your report.

1. **The YouTube icon is no longer modified.** Our application previously drew
   the YouTube icon using a third-party icon set that redraws the shape and
   inherits the surrounding text colour, which caused it to render in our
   product's gold. We now render the official YouTube icon artwork, unmodified,
   in the Red-and-White combination, with no changes to its shape or corners.

2. **Minimum size enforced.** The icon is now rendered at no less than 20 px in
   height and width everywhere it appears, enforced in one place so that it
   applies to every screen.

3. **Our own product logo no longer resembles the YouTube icon.** Our brand mark
   was a play triangle inside a rounded square. We recognise this closely
   resembled the YouTube icon and could confuse users about the relationship
   between our product and YouTube. It has been replaced with an arch mark that
   shares no shape with YouTube's icon, in both the site header and the footer
   highlighted in your report, and one further product icon carrying the same
   shape was changed for the same reason.

All changes described above are deployed to <https://deenclipped.online>.

Please let us know if any item requires further detail or evidence.

Thanks,
Youssef Channaoui
DeenClipped

---

## What changed in the code, for your own records

| Item | Where |
|---|---|
| Official YouTube icon, Red-and-White, ≥20px | `src/public/index.html` (`#studio i.ph-youtube-logo`) |
| Brand mark replaced with the arch | `src/marketing.js` (`logoMark`) |
| "clips" icon no longer a play triangle in a rounded rect | `src/marketing.js` (`icon`) |
| 30-day deletion of cached YouTube API Data | `src/youtube-retention.js`, started in `src/server.js` |
| Cache stamped when written | `src/local-engine.js`, `src/social.js` |
| Privacy policy disclosure | `src/marketing.js` (`privacy`) |
| Tests | `test/youtube-branding.test.mjs`, `test/youtube-compliance.test.mjs` |

One test asserts the metadata request never asks for `statistics`, because doing
so would make the privacy policy untrue.
