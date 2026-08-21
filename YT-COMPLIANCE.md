# YouTube API compliance — fix today

Google's YouTube API Services team sent a ToS Violations Report (Project
881648803263). Deadline is today. Three items need code or content changes.
Nothing here is about downloading videos — the import path was not flagged.

## 1. Privacy policy (their policy III.A.2d) — VIOLATION

Their finding: "The privacy policy does not explain to users what user
information, including API Data relating to users, the API Client accesses,
collects, stores and otherwise uses."

Rewrite the privacy policy to state explicitly:
- Google account email and profile name, used for sign-in.
- YouTube channel ID, title and thumbnail retrieved via channels.list, used
  to confirm the connected channel's identity to the creator.
- Video title, description and duration retrieved via videos.list, for
  videos the creator submits.
- OAuth access and refresh tokens, stored encrypted.
- How long each item is retained, and that all YouTube data is deleted when
  a creator disconnects their channel.
- A link to https://policies.google.com/privacy and a statement that users
  can revoke our access at https://myaccount.google.com/permissions.

Only state what is actually true of our code. Read the code first and tell
me if anything above does not match what we really do.

## 2. YouTube icon branding (their policy III.F.2a,b) — VIOLATION

Their finding: our YouTube logos and icons do not follow YouTube branding
guidelines. Specifically: do not modify the colour or shape of the YouTube
icon; minimum height 20 px; colour combination must be Red and White or
Black and White.

We currently place the red YouTube mark inside custom rounded-square tiles,
which modifies its shape. Replace every YouTube logo and icon with the
official unmodified asset:
- unmodified shape and colour
- Red and White, or Black and White
- minimum 20 px height everywhere
- no custom corner radius or container that alters the mark

Locations shown in their screenshots: the "Posting to" row on Home, the
Publishing channels panel, the YouTube Shorts card on the Channels screen,
and the connect dialog. Audit the codebase for any others.

## 3. Thirty-day data rule (their policy III.E.4.a-g) — CONFIRM + LIKELY FIX

Their finding: API Clients must not display or store statistics retrieved as
Authorized or Non-Authorized Data for more than 30 days. They noted "Data
Showing > 30 days".

Find every place we persist YouTube-derived statistics (the Performance
screen, any analytics cache, any stored video stats) and make them expire at
30 days or refresh on read.

Then tell me plainly, in one paragraph: what does the code do TODAY about
refreshing, updating and deleting YouTube data? I have to state this
accurately to Google today, so do not guess — read the code and report what
is actually there.

## Verification

Screenshot the YouTube icons at 20px+ before and after. Show me the privacy
policy page rendered. This is a compliance deadline, not a polish task.
