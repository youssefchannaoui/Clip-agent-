# DeenClipped growth and quality roadmap

These are the strongest next features for improving views and producing better clips. They are separated from features already implemented in version 2.1.

## Highest priority

### 1. Approval-learning ranking
Record which clips are approved, rejected, posted and later reported as strong performers. Train a personal ranking layer from those decisions so DeenClipped learns Youssef's preferred topics, clip length, speaking style and hook patterns instead of using one generic score.

### 2. Retention Lab and A/B hook variants
Generate two or three alternative first-two-second hook cards and titles for the same clip. Export variants without re-transcribing or re-cutting the lecture. Compare platform retention to learn which hook format performs best.

### 3. Quran and hadith Quote Guard
Detect likely quotations, preserve the original-language timestamp, display transcript confidence and require a source/reference check before automatic posting. This would be especially valuable for Islamic content and is more specialised than general clipping products.

### 4. Face tracking and intelligent reframing
Track the active speaker and move the vertical crop smoothly rather than keeping a fixed centre crop. Fall back to blurred background when tracking confidence is low.

### 5. Duplicate-topic protection
Create semantic fingerprints for clips and warn when a new reminder is too similar to something posted recently. This keeps the channel varied and reduces audience fatigue.

## Strong quality improvements

- Remove awkward breaths and long silence at clip boundaries.
- Detect applause, intros, sponsor segments and outros automatically.
- Platform-specific safe-zone templates for TikTok, Reels and Shorts.
- Automatic audio-noise removal before voice compression.
- Source-resolution and compression warnings before rendering.
- Batch low-resolution draft renders before expensive final 1080×1920 renders.
- Automatic thumbnail/frame selection based on facial expression and sharpness.
- Caption line-break optimisation based on meaning rather than character count.
- Topic labels and searchable transcript library.
- Storage cleanup policies that preserve posted masters while removing temporary files.

## Publishing and analytics

After official account connections are added:

- direct scheduled uploads,
- upload retry and idempotency protection,
- platform-specific titles and hashtag limits,
- post status confirmation,
- retention, completion rate and share-rate imports,
- performance feedback into the personal ranking model.

Direct publishing should only be added after the clipping quality and manual workflow are proven reliable.
