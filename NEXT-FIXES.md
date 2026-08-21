# Next fixes

## 1. Mobile header still overflows (was skipped twice)

At 390x844 on /app, measured in a real browser just now:

  search icon  right edge 301  ON screen
  tokens pill  right edge 449  OFF screen (59px past the edge)
  bell         right edge 493  OFF screen
  account      right edge 735  OFF screen (345px past the edge)

A phone user cannot reach notifications or their account menu at all —
there is no way to sign out or open settings on a phone. This is a launch
blocker for a product whose users are on phones.

Compact the header below roughly 600px:
- tokens pill becomes the coin icon plus the number only, no "tokens · Free"
- search stays collapsed to its icon (it already does)
- bell and account avatar must both stay fully on screen and tappable
- nothing may extend past the viewport width

Verify at 390px in a real browser and screenshot it. The last two attempts
were reported done while this was still broken, so measure the right edge of
each control against window.innerWidth before you say it is fixed.

## 2. Quran recitation render quality

From a real published clip: Quran flow, scenery background, 59 seconds,
ayah Al-Imran 3:169.

a) THE TRANSLATION CAPTION IS UNREADABLE. It renders as thin, small, plain
   white text directly over bright sunlit snow, with no outline, shadow or
   scrim. On a phone it disappears into the background. Whatever caption
   treatment the lecture template uses is either not applied on the Quran
   path, or is applied at a size that cannot survive a bright background.
   Any caption over photographic footage needs an outline or scrim as a
   floor, not as an option.

b) NO ARABIC MUSHAF SCRIPT IN THE VIDEO. Quran mode is specified as "the
   ayah in mushaf script with its translation". The Arabic appears only in
   the app's clip title; the burned frame carries the English translation
   alone. Check whether the mushaf line is being rendered at all, is
   rendering offscreen, or is failing font selection silently. A missing
   font is a silent fallback — exactly like the missing JS runtime was.

c) STRAY WHITE DOT artifact at roughly 44% across, 58% down the frame. A
   small filled circle with no purpose. It is in the render, not the player
   chrome — possibly a leftover overlay node or a glyph from a font
   fallback.

d) The caption sits mid-frame with nothing anchoring it, neither safe-zone
   aware nor visually deliberate.

This is the flagship case for the Quran flow and the one clip type where
legibility is the whole product. Compare a lecture-mode and a Quran-mode
render of the same length over the same bright background, and diff the
caption styling ffmpeg actually burns — not the editor preview.

Scripture still forces human review. QUOTE_RISK must not be touched.
