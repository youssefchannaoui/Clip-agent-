/**
 * The in-app help centre: what DeenClipped does, said plainly.
 *
 * Pure data with NO imports, deliberately — the server serves it, the tests
 * read it, and a circular import between this and anything that describes the
 * product would be the same trap `seo-pages.js` avoids for the same reason.
 *
 * Two rules the content obeys, because a help centre that breaks either is
 * worse than none:
 *
 *  1. **It describes what the app ACTUALLY does today.** Where something is not
 *     built — the clip editor is behind its coming-soon gate, no platform sends
 *     audience numbers back — the article says so. Someone who finds that out
 *     after paying is a refund and a bad review; someone who reads it here is
 *     just informed.
 *  2. **Every screenshot is a real capture of this app**, taken from the running
 *     product rather than drawn. `test/help-content.test.mjs` fails if an
 *     article names an image that is not on disk, so a renamed file cannot
 *     leave a broken picture in front of a customer.
 */

/** Where the screenshots live, served by the /help-assets/ route. */
export const IMAGE_BASE = '/help-assets/';

/**
 * A category is a chapter; an article is one question answered.
 *
 * `steps` are numbered actions. `notes` are the things that surprise people —
 * they exist because every one of them has actually confused somebody.
 */
export const CATEGORIES = Object.freeze([
  {
    id: 'start',
    title: 'Getting started',
    icon: 'ph ph-compass',
    blurb: 'What DeenClipped does, and your first lecture from link to posted clip.',
    articles: [
      {
        id: 'what-it-does',
        title: 'What DeenClipped actually does',
        summary: 'It takes a long lecture you already have and cuts it into short vertical clips, captioned, ready to post.',
        image: 'home.webp',
        imageAlt: 'The DeenClipped home screen',
        steps: [
          'You give it a lecture — a YouTube link, or an MP4 you upload.',
          'It transcribes the speech, finds the moments worth clipping, and renders each one as a 9:16 vertical video with burned-in captions.',
          'You review every clip and approve the ones you want. Nothing is published without you.',
          'Approved clips are scheduled into your posting times and sent to your connected accounts.',
        ],
        notes: [
          'It does NOT create a video from scratch or build recitation videos from audio. It cuts up a lecture that already exists.',
          'Scripture always goes to human review, whatever your automation settings say. That is deliberate and cannot be switched off.',
        ],
      },
      {
        id: 'first-clip',
        title: 'Your first clip, end to end',
        summary: 'The shortest path from a link to something posted.',
        image: 'library.webp',
        imageAlt: 'The lecture library, where imports start',
        steps: [
          'Open **Library** and paste a YouTube link, or upload an MP4.',
          'Pick how much of the lecture to use. Only the part you select is downloaded and charged for.',
          'Wait for it to render. You will see the stage it is at — transcribing, scoring, rendering.',
          'Open **Review** and watch each clip. Press A to approve, X to reject.',
          'Approved clips appear in **Schedule**. If you have connected an account, they post at your next free slot.',
        ],
        notes: [
          'You can approve clips before connecting any account. They wait in the schedule until a destination exists.',
        ],
      },
    ],
  },
  {
    id: 'importing',
    title: 'Importing lectures',
    icon: 'ph ph-download-simple',
    blurb: 'Links, uploads, choosing a section, and what it costs.',
    articles: [
      {
        id: 'paste-a-link',
        title: 'Import from a YouTube link',
        summary: 'Paste the URL, choose the stretch you want, and only that stretch is fetched.',
        image: 'library.webp',
        imageAlt: 'Pasting a lecture link into the library',
        steps: [
          'Open **Library**.',
          'Paste the full YouTube URL into the import box.',
          'The length and title are read back to you so you can check it is the right lecture.',
          'Set the start and end of the part you want. Leave it alone to use the whole thing.',
          'Press import. The stage and an estimate appear while it works.',
        ],
        notes: [
          'Choosing three minutes of a ninety-minute lecture downloads three minutes, not the whole file.',
          'You are charged by SOURCE minutes — the length of what you selected, not the number of clips it produces.',
        ],
      },
      {
        id: 'upload-mp4',
        title: 'Upload your own file',
        summary: 'For lectures that are not on YouTube, or a link that will not download.',
        image: 'library.webp',
        imageAlt: 'The upload control in the library',
        steps: [
          'Open **Library** and choose Upload instead of pasting a link.',
          'Pick an MP4 or MOV from your device.',
          'It is processed exactly like a link import from that point on.',
        ],
        notes: [
          'This is the reliable fallback whenever a site refuses to hand over a video.',
        ],
      },
      {
        id: 'import-failed',
        title: 'An import failed — what the message means',
        summary: 'The failure notice names the cause and what to do, rather than a code.',
        image: 'library.webp',
        imageAlt: 'The lecture library showing job state',
        steps: [
          'Open the failed lecture in **Library** and read the reason shown.',
          'If it mentions a bot check or a refusal from the source, download the video yourself and use Upload instead.',
          'If it mentions tokens, top up or wait for your plan to renew.',
        ],
        notes: [
          'A failure while IMPORTING is a different thing from a failure while POSTING. The message tells you which one you are looking at.',
        ],
      },
    ],
  },
  {
    id: 'review',
    title: 'Reviewing clips',
    icon: 'ph ph-check-square-offset',
    blurb: 'The review deck, the keyboard, and what approving actually does.',
    articles: [
      {
        id: 'review-deck',
        title: 'Using the review deck',
        summary: 'It plays the real rendered clip — the same file that would post — so you judge what viewers see.',
        image: 'queue.webp',
        imageAlt: 'The review deck playing a rendered clip',
        steps: [
          'Open **Review**.',
          'The clip plays muted. Press M or click the sound chip to hear it.',
          'Press A to approve, X to reject, S or the right arrow to skip, the left arrow to go back.',
          'Space pauses and resumes. The chip in the hints row changes speed: 1x, 1.5x, 2x.',
          'The filmstrip underneath jumps to any waiting clip out of order.',
        ],
        notes: [
          'It plays the rendered file, captions burned in, exactly as it will post. What you see is what goes out.',
          'The score and the reasons for it sit under the title, where the decision is made.',
        ],
      },
      {
        id: 'approve-means',
        title: 'What approving does',
        summary: 'It schedules the clip. It does not re-render it.',
        image: 'schedule.webp',
        imageAlt: 'The schedule after clips are approved',
        steps: [
          'Approve a clip in **Review**.',
          'It moves to **Schedule** and takes the next free posting slot.',
          'If publishing is on and an account is connected, it posts at that time.',
        ],
        notes: [
          'Approving does not start a new render. Clips are rendered at full quality from the start.',
          'Saving a template change re-renders only clips still waiting. Anything already approved keeps the render you signed off on.',
        ],
      },
    ],
  },
  {
    id: 'styles',
    title: 'Styles and captions',
    icon: 'ph ph-palette',
    blurb: 'Caption look, the watermark, and the Quran template.',
    articles: [
      {
        id: 'pick-style',
        title: 'Choosing a caption style',
        summary: 'A style sets the face, size, colour and position of the captions on every clip.',
        image: 'templates.webp',
        imageAlt: 'The styles screen with the caption preview',
        steps: [
          'Open **Styles**.',
          'Pick a style from the list. The preview shows a real frame with your settings applied.',
          'Drag the caption in the preview to move it. Save when it looks right.',
        ],
        notes: [
          'Changing a style re-renders clips that are still waiting for review. Approved and posted clips are left alone.',
        ],
      },
      {
        id: 'look-and-atmosphere',
        title: 'The look, and weather over the video',
        summary: 'Twelve graded looks — including three kinds of black and white — plus rain, snow, dust or bokeh drifting over the picture.',
        steps: [
          'Open **Styles**.',
          'In the Style group, **Look** grades the picture. Natural leaves it alone; Cinematic and Teal & orange are the film looks; Black & white, Noir and Silver are flat, hard and soft versions of the same idea.',
          '**Atmosphere** puts particles over the video — rain, snow, dust motes or bokeh lights. Pick one and a **strength** row appears under it.',
          '**Darken video** dims the picture behind everything. It works on its own, and it is what makes captions read on bright footage.',
          'Save. New renders carry it; clips you have already approved keep the render you signed off on.',
        ],
        notes: [
          'Dark plus rain is the combination most people are after — they are two separate rows because either one is useful without the other.',
          'The weather is drawn by the renderer, so the preview on this screen shows its colour and density as a still. The falling is in the exported clip.',
          'It costs render time: a clip with weather takes roughly two to three times as long to render as one without. Everything else about the job is unchanged.',
        ],
      },
      {
        id: 'watermark',
        title: 'Removing the watermark',
        summary: 'A paid plan turns the DeenClipped mark off.',
        image: 'templates.webp',
        imageAlt: 'The watermark control on the styles screen',
        steps: [
          'Open **Styles**.',
          'The watermark row sits at the top of the left column.',
          'Switch it off and save. New renders carry no mark.',
        ],
      },
      {
        id: 'quran-template',
        title: 'The Quran template',
        summary: 'Recitation is captioned as the verse with its translation, and nothing else is captioned.',
        image: 'templates.webp',
        imageAlt: 'Choosing the Quran template',
        steps: [
          'Open **Styles** and choose the Quran template.',
          'Clips of recitation are captioned with the matched ayah and an English line under it.',
        ],
        notes: [
          'On this template ONLY the scripture is captioned. An aside or a half-heard word in the lecture face under a verse is what made these clips look wrong, so it is left off deliberately.',
          'Any clip containing scripture always goes to human review, whatever your automation settings say.',
        ],
      },
    ],
  },
  {
    id: 'connections',
    title: 'Connecting your accounts',
    icon: 'ph ph-plugs-connected',
    blurb: 'YouTube, TikTok, Facebook and Instagram — and posting to several at once.',
    articles: [
      {
        id: 'connect-first',
        title: 'Connect an account',
        summary: 'One sign-in per platform, from the Connections dialog.',
        image: 'connections.webp',
        imageAlt: 'The publishing connections dialog',
        steps: [
          'Open **Connections** from the home screen or the account menu.',
          'Press Connect beside the platform and sign in.',
          'The switch beside it turns green once the platform is connected AND switched on.',
        ],
        notes: [
          'Facebook and Instagram share one Meta sign-in. Connecting or disconnecting either affects both.',
          'TikTok cannot switch itself on when you connect it: their guidelines require you to choose an audience first, with nothing preselected.',
        ],
      },
      {
        id: 'tiktok-audience',
        title: 'Choosing your TikTok audience',
        summary: 'TikTok requires you to pick this yourself, per account, with nothing preselected.',
        image: 'connections.webp',
        imageAlt: 'TikTok posting options',
        steps: [
          'Open **Connections** and run Test connection on TikTok, so their latest options are loaded.',
          'In the Posting options panel, choose who can see your posts.',
        ],
        notes: [
          'Each TikTok account is a separate post, so each one has its own audience. There is no shared setting.',
          'Until TikTok approves the app, it will only deliver posts to a TikTok account that is itself set to private.',
        ],
      },
    ],
  },
  {
    id: 'scheduling',
    title: 'Scheduling and posting',
    icon: 'ph ph-calendar-check',
    blurb: 'When clips go out, how many a day, and what to do when one fails.',
    articles: [
      {
        id: 'when-posts',
        title: 'When your clips go out',
        summary: 'Approved clips fill your posting times, one clip per slot.',
        image: 'schedule.webp',
        imageAlt: 'The schedule with upcoming posts',
        steps: [
          'Approve clips in **Review**.',
          'Open **Schedule** to see when each one goes out and where.',
          'Every destination is listed with its own state, so a clip going to three places shows three lines.',
        ],
        notes: [
          'Basic and Pro get 4 posting times a day. Studio gets 8, inserted between them rather than spread across the night.',
          'There is nothing to switch on for the extra slots — approve more clips and they fill.',
        ],
      },
      {
        id: 'post-failed',
        title: 'A post failed to go out',
        summary: 'The failure belongs to the destination, not the clip.',
        image: 'schedule.webp',
        imageAlt: 'A schedule row showing a failed destination',
        steps: [
          'Open **Schedule** and find the clip.',
          'Read the line for the destination that failed — it names the platform, the account and the reason.',
          'Press Retry on that destination. Only that one is retried.',
        ],
        notes: [
          'A clip that posted anywhere counts as posted. One platform refusing does not undo the others.',
          'Retrying one account does not disturb the others or clear their errors.',
        ],
      },
    ],
  },
  {
    id: 'plans',
    title: 'Plans and tokens',
    icon: 'ph ph-coins',
    blurb: 'What each plan includes, and how tokens are actually spent.',
    articles: [
      {
        id: 'how-tokens-work',
        title: 'How tokens are spent',
        summary: 'By the source minutes you import, not by the clips you get.',
        image: 'tokens.webp',
        imageAlt: 'The tokens and billing screen',
        steps: [
          'Open **Tokens & billing** to see your balance and what your plan includes.',
          'Importing charges for the length of the stretch you selected.',
          'Rendering more clips from that same lecture costs nothing extra.',
        ],
        notes: [
          'Top-up tokens never expire. Plan tokens reset each billing period.',
        ],
      },
      {
        id: 'which-plan',
        title: 'Which plan you are on',
        summary: 'Shown in the header, beside your token balance.',
        image: 'tokens.webp',
        imageAlt: 'The plan shown in the studio header',
        steps: [
          'Look at the top of any screen: it reads your balance, then your plan — for example "Studio · monthly".',
          'Open **Tokens & billing** to compare plans or change yours.',
        ],
        notes: [
          'Where a feature is not part of your plan, the app says which plan includes it rather than hiding it.',
        ],
      },
    ],
  },
  {
    id: 'trouble',
    title: 'When something is wrong',
    icon: 'ph ph-lifebuoy',
    blurb: 'The handful of things that actually go wrong, and what each one means.',
    articles: [
      {
        id: 'uploads-private',
        title: 'My YouTube uploads arrive private',
        summary: 'DeenClipped asks for public every time. Google can still override that.',
        image: 'connections.webp',
        imageAlt: 'The connections dialog note about YouTube privacy',
        steps: [
          'Nothing to change here — the app names public on every upload and there is no setting that says otherwise.',
        ],
        notes: [
          'Google can still file an upload as private whatever the request asks for. If that happens, flip the video to public in YouTube Studio — it is Google\'s decision, not a setting in this app. The compliance review that used to force it closed in August 2026.',
        ],
      },
      {
        id: 'connection-expired',
        title: 'A connection expired',
        summary: 'Platforms drop access periodically. Reconnecting takes a few seconds.',
        image: 'connections.webp',
        imageAlt: 'A connection needing to be reconnected',
        steps: [
          'Open **Connections**.',
          'Press Reconnect beside the platform and sign in again.',
          'Anything that missed its slot can be retried from **Schedule**.',
        ],
      },
      {
        id: 'no-view-counts',
        title: 'Why there are no view counts',
        summary: 'No connected platform sends audience numbers back to this app.',
        image: 'performance.webp',
        imageAlt: 'The performance screen',
        steps: [
          'Open **Performance** to see what IS known: what you made, kept, scheduled and posted, and where it went.',
        ],
        notes: [
          'Views, likes and watch time would have to come from each platform. None of them send that here, so the app shows what it can count from your own records rather than inventing it.',
        ],
      },
      {
        id: 'editor-soon',
        title: 'The clip editor says coming soon',
        summary: 'It is deliberately switched off while it is finished.',
        image: 'queue.webp',
        imageAlt: 'The review queue',
        steps: [
          'Everything else works without it: styles set how captions look, and the review deck decides what goes out.',
        ],
        notes: [
          'It is gated rather than hidden so you can see it is coming. Nothing you do in the app depends on it.',
        ],
      },
    ],
  },
]);

/** Every article, flattened, with its category — what a search would walk. */
export function articles() {
  return CATEGORIES.flatMap(category => (category.articles || []).map(article => ({
    ...article,
    categoryId: category.id,
    categoryTitle: category.title,
  })));
}

/** Every image the content references, for the test that checks they exist. */
export function referencedImages() {
  return [...new Set(articles().map(article => article.image).filter(Boolean))];
}

/**
 * The payload the browser gets.
 *
 * The support address travels with it so the contact card does not need a
 * second request, and so a deployment without one renders no dead mailto.
 */
export function helpPayload({ supportEmail = '' } = {}) {
  return {
    imageBase: IMAGE_BASE,
    supportEmail: String(supportEmail || ''),
    categories: CATEGORIES,
  };
}
