// Maps the app's /api/state payload onto the binding names the Studio design
// expects, and owns the dashboard's local UI state (which screen is open, whether
// the rail is collapsed, which menus are down).
//
// HAND-WRITTEN — a design re-import never rewrites this file. When
// `npm run design:check` reports unsupplied bindings, this is the file that grows.
//
// Style strings below are reproduced from the design's own computations so a
// re-import stays visually faithful; they are not invented here.
//
// STAGED: the shell (rail, header, activity, account menu) and the Home screen are
// wired. The remaining screens render blank until their bindings land — the runtime
// resolves a missing path to empty output rather than throwing, so partial coverage
// degrades quietly instead of breaking the page.

(function (global) {
  'use strict';

  var UI = {
    screen: 'home',
    lastScreen: 'home',
    railOpen: true,
    menuOpen: false,
    bellOpen: false,
    query: '',
    activityAll: false,
    // Review queue
    filter: 'review',
    libFilter: 'all',
    openProject: null,
    jobUrl: '',
    jobTplId: '',
    // undefined/true = mix a nasheed in; false = this job runs without one.
    jobMusic: true,
    jobTrackId: null,
    countsOpen: false,
    playingTrack: null,
    liveOpen: false,
    perfRange: 'Last 7 days',
    planPeriod: 'month',
    termA: '',
    termB: '',
    blockerDismissed: false,
    tplLayer: 'caption',
    tplDirty: false,
    tplDraft: null,
    tplTimer: null,
    // Real edit history for the Templates screen. Each entry is
    // { undo: {field: previousValue}, redo: {field: newValue} } so a step can be
    // replayed in either direction. Redo used to be a button that only ever
    // explained why it did nothing.
    tplPast: [],
    tplFuture: [],
    tplReplaying: false,
    // What is being dragged in a preview, where it is, and whether it has caught
    // a snap line. Drives the cursor, the outline and the guides.
    dragKind: null,
    dragAt: null,
    dragSnapped: false,
    dragSnapName: '',
    // Sample-caption playback in the preview.
    pvPlaying: false,
    pvTime: 0,
    // True while "Save to all clips" is in flight, so the button can say so.
    edApplying: false,
    sheet: null,
    toast: null,
    playerClip: null,
    connProvider: null,
    job: null,
    generating: false,
    jobError: null,
    edClipId: null,
    edTab: 'captions',
    edCaption: null,
    edBlock: 0,
    edPlayhead: 0,
    edBlockDraft: null,
    edDirty: false,
    edSaving: false,
    edSafe: true,
    deckMode: false,
    deckIdx: 0,
    // Approving is a round trip. Until /api/state comes back the card would snap
    // back to "needs review", so the decision is held here and layered over the
    // server's view until the refresh lands.
    pending: {},
  };

  var refresh = function () {};
  function setUI(patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) UI[k] = patch[k];
    refresh();
  }
  function stop(e) { if (e && e.preventDefault) e.preventDefault(); }

  // ── helpers ───────────────────────────────────────────────────────────────

  function cssUrl(u) {
    // Guard a user-supplied URL before it is interpolated into a CSS url("...").
    if (!u) return '';
    return String(u).replace(/["'\\)]/g, function (c) { return '%' + c.charCodeAt(0).toString(16); });
  }
  function thumb(u) {
    return u ? '#17171A url("' + cssUrl(u) + '") center/cover no-repeat' : '#17171A';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Clip lengths are seconds-scale, so m:ss reads naturally.
  function secsToClock(s) {
    if (!s && s !== 0) return '';
    var m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  // Lecture lengths are hours-scale, where m:ss would render 3720s as "62:00"
  // and read as sixty-two seconds.
  function humanDuration(s) {
    if (!s && s !== 0) return '';
    var mins = Math.round(s / 60);
    if (mins < 60) return mins + 'm';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }
  function since(iso) {
    if (!iso) return '';
    var d = Date.now() - new Date(iso).getTime();
    if (!isFinite(d)) return '';
    var mins = Math.round(d / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }
  function timeOf(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // A clip is "awaiting a decision" when it is rendered but nobody has approved,
  // scheduled or posted it yet. Matches the queue the existing dashboard shows.
  function awaitingReview(clips) {
    return clips.filter(function (c) { return decision(c) === null; });
  }


  // The one place that decides what state a clip is in, so the queue, the deck,
  // Home and the library cannot disagree. Optimistic decisions win until the
  // server catches up.
  //
  // The status vocabulary is the server's (src/agent.js): a rendered clip sits at
  // `waiting` until someone decides on it — approveClip() refuses anything else —
  // and then moves approved -> scheduled -> publishing -> posted. `ready` is a
  // terminal "done, ready to download" state, not a review state.
  var SETTLED = { approved: 1, scheduled: 1, publishing: 1, retrying: 1, posted: 1, ready: 1 };
  function decision(c) {
    if (UI.pending[c.id]) return UI.pending[c.id];
    if (c.status === 'rejected') return 'rejected';
    if (SETTLED[c.status]) return 'approved';
    if (c.status === 'waiting') return null;
    return 'other';   // still processing, or failed — not part of the review queue
  }

  function tabStyle(on) {
    return 'display: flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 20px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; border: 1px solid ' +
      (on ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;' : '#26262A; background: #121214; color: #A2A2AA;');
  }

  function pillStyle(on) {
    return 'padding: 1px 6px; border-radius: 20px; font-size: 10.5px; background: ' +
      (on ? 'rgba(217,180,120,.18)' : '#1D1D21') + '; color: inherit;';
  }

  function toggleBtnStyle(on) {
    return 'display: grid; place-items: center; width: 30px; height: 28px; border-radius: 7px; cursor: pointer; transition: background .14s ease; border: 1px solid ' +
      (on ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.12); color: #F0D6A6;' : '#26262A; background: #121214; color: #8B8B93;');
  }

  // The worker emits a stable phase identifier alongside its readable stage text
  // (clip_worker.py phase_for). Matching words instead meant three of these five
  // never lit in production, because service.py rewrote the prose in transit.
  // The prose is still shown as the step's detail; only the position is keyed off
  // the enum.
  var STAGES = [
    { key: 'import', label: 'Source imported' },
    { key: 'transcribe', label: 'Transcribing audio' },
    { key: 'score', label: 'Moments scored' },
    { key: 'render', label: 'Rendering with your template' },
    { key: 'verify', label: 'FFprobe verification' },
  ];
  function stageIndex(project) {
    var phase = project && project.phase;
    if (phase === 'done') return STAGES.length - 1;
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === phase) return i;
    // A record from before the worker emitted a phase, or a queued job that has
    // not reported yet: show it at the start rather than guessing from words.
    return 0;
  }

  function switchTrack(on) {
    return 'position: relative; margin-left: auto; width: 34px; height: 19px; flex: none; border-radius: 20px; cursor: pointer; transition: background .16s ease, border-color .16s ease; border: 1px solid ' +
      (on ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.22);' : '#33333A; background: #17171A;');
  }
  function switchKnob(on) {
    return 'position: absolute; top: 2px; left: ' + (on ? '17px' : '2px') + '; width: 13px; height: 13px; border-radius: 50%; background: ' +
      (on ? '#F0D6A6' : '#6E6E76') + '; transition: left .16s ease, background .16s ease;';
  }

  function sliderTrack() {
    return 'position: relative; flex: 1; height: 4px; border-radius: 4px; background: #26262A;';
  }
  function sliderKnob(on) {
    return 'position: absolute; top: 50%; translate: 0 -50%; width: 14px; height: 14px; border-radius: 50%; background: ' +
      (on ? '#D9B478' : '#6E6E76') + '; box-shadow: 0 2px 6px rgba(0,0,0,.5);';
  }

  // Clip-length presets, expressed in the clipMin/clipMaxSeconds the account
  // actually stores.
  var DUR_PRESETS = [
    { label: 'Up to 30s', min: 10, max: 30 },
    { label: '30-45s', min: 30, max: 45 },
    { label: '45-60s', min: 45, max: 60 },
    { label: 'Up to 90s', min: 45, max: 90 },
  ];

  function toast(message) { global.StudioAdapter.onToast(message); }

  // Keys match the `interval` each plan reports, so the tabs filter real data
  // rather than being decorative.
  var PERIODS = [
    { key: 'week', label: 'Weekly' },
    { key: 'month', label: 'Monthly' },
    { key: 'year', label: 'Annual' },
  ];

  // There is no read/seen state on the server -- no field, no route -- so the
  // bell remembers per browser. Better than the alternative it replaces: a dot
  // hardcoded into the design that never turned off, on a brand-new account with
  // no activity at all, which teaches people to ignore the bell entirely.
  var SEEN_KEY = 'deenStudioActivitySeen';
  // Falls back to memory when localStorage is unavailable — private browsing
  // throws on access, and without this the bell could never be marked read there.
  var seenMemory = 0;
  function lastSeen() {
    try {
      var stored = Number(global.localStorage.getItem(SEEN_KEY)) || 0;
      return Math.max(stored, seenMemory);
    } catch (err) { return seenMemory; }
  }
  function markSeen() {
    seenMemory = Date.now();
    try { global.localStorage.setItem(SEEN_KEY, String(seenMemory)); } catch (err) { /* private mode */ }
  }

  // Both range handles share one track. Kept out of the bindings so the two
  // inputs cannot drift apart and re-create the stacked-slider look.
  var RANGE_INPUT_STYLE = 'position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);'
    + ' width: 100%; height: 18px; margin: 0; -webkit-appearance: none; appearance: none;'
    + ' background: transparent; pointer-events: none; cursor: pointer;';

  // YouTube serves a 404 page for maxresdefault on uploads that never got one,
  // which paints as an empty box. hqdefault always exists, so it goes underneath
  // as a second layer rather than replacing the sharper image outright.
  function posterLayers(job) {
    var safe = function (u) { return 'url("' + String(u).replace(/["\\)]/g, encodeURIComponent) + '")'; };
    var layers = [safe(job.thumbnail)];
    var id = String(job.url || '').match(/[?&]v=([\w-]{6,})|youtu\.be\/([\w-]{6,})/);
    var videoId = id ? (id[1] || id[2]) : '';
    if (videoId && !/hqdefault/.test(String(job.thumbnail))) {
      layers.push(safe('https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'));
    }
    return layers.join(', ');
  }

  // Names a configured post time by the hour it falls in, so the label cannot
  // contradict the time printed beside it.
  function windowName(hhmm) {
    if (!hhmm) return '—';
    var hour = Number(String(hhmm).split(':')[0]);
    if (hour < 11) return 'Morning';
    if (hour < 15) return 'Midday';
    if (hour < 19) return 'Evening';
    return 'Late';
  }

  // Worker errors carry URLs and stack noise; the feed needs one readable line.
  function shortError(text) {
    var t = String(text || 'Processing failed.').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 150 ? t.slice(0, 147) + '…' : (t || 'Processing failed.');
  }

  // Mirrors ENUMS in src/templates.js. Kept here so the picker can only ever
  // offer a value sanitiseTemplate() will accept.
  var ENUMS = {
    fitMode: ['contain', 'blur', 'crop'],
    smartFramingBias: ['auto', 'left', 'center', 'right'],
    filterPreset: ['natural', 'crisp', 'warm', 'cinematic', 'monochrome'],
    captionMode: ['phrase', 'word', 'dynamic-stack'],
    captionPosition: ['top', 'middle', 'bottom'],
    captionHorizontal: ['left', 'center', 'right'],
    watermarkPosition: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
  };
  function titleCase(v) {
    return String(v || '').replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  // The lines a dragged overlay snaps to, drawn as dashes across the frame.
  // One element carrying five background layers, because the lines are not
  // evenly spaced and a repeating gradient cannot place them.
  //
  // Only visible during a drag: standing guides would be clutter, but dragging
  // something with no indication of where it will land is what made this feel
  // like text sliding around rather than an editor.
  // One overlay carrying every snap line plus the line the cursor is on. The
  // design draws a single 1px rule here, and a style binding replaces the whole
  // style, so this can become a full-frame overlay without touching the markup
  // -- which matters, since the design is regenerated on every import.
  //
  // Layers rather than a repeating gradient because the lines are not evenly
  // spaced: the safe-zone edges, the thirds and the half.
  function guideOverlayStyle(dragging, at, snappedOn, lines) {
    if (!dragging) return 'display: none;';
    var faint = 'repeating-linear-gradient(to right, rgba(240,214,166,.45) 0 6px, transparent 6px 12px)';
    var layers = [], sizes = [], positions = [];
    // The live line first, so it paints over a snap line it is sitting on.
    if (at !== null && at !== undefined) {
      layers.push(snappedOn
        ? 'linear-gradient(to right, #F0D6A6, #F0D6A6)'
        : 'repeating-linear-gradient(to right, rgba(240,214,166,.95) 0 4px, transparent 4px 9px)');
      sizes.push('100% ' + (snappedOn ? 2 : 1) + 'px');
      positions.push('0 ' + (at * 100).toFixed(3) + '%');
    }
    for (var i = 0; i < lines.length; i++) {
      layers.push(faint);
      sizes.push('100% 1px');
      positions.push('0 ' + (lines[i] * 100).toFixed(4) + '%');
    }
    return 'position: absolute; inset: 0; z-index: 7; pointer-events: none;'
      + ' background-image: ' + layers.join(', ') + ';'
      + ' background-size: ' + sizes.join(', ') + ';'
      + ' background-position: ' + positions.join(', ') + ';'
      + ' background-repeat: no-repeat;';
  }

  // Grab, then grabbing. Without it the overlay gives no sign it can be moved.
  function grabStyle(active) {
    return ' cursor: ' + (active ? 'grabbing' : 'grab') + '; user-select: none; -webkit-user-select: none;';
  }

  // The preview's own picture, laid out and graded the way the renderer will.
  //
  // The design bakes a finished vertical reel into the frame's class, so the
  // preview could not answer the two questions it exists to answer: what does
  // this clip layout do, and what does this Look do. A finished 9:16 still also
  // makes Fit, Blur and Fill identical -- the three only differ when the source
  // is wider than the output, which every lecture is.

  // Matches filter_values() in clip_worker.py: (brightness, contrast,
  // saturation). ffmpeg's brightness is an additive offset, CSS's is a
  // multiplier, so it is applied as 1 + b. Gamma has no CSS equivalent and is
  // left out rather than faked.
  var LOOK_FILTERS = {
    natural: [0.0, 1.0, 1.0],
    crisp: [0.015, 1.09, 1.08],
    warm: [0.025, 1.04, 1.12],
    cinematic: [-0.015, 1.13, 0.88],
    monochrome: [0.0, 1.08, 0.0],
  };

  function lookFilter(t) {
    var preset = LOOK_FILTERS[t.filterPreset] || LOOK_FILTERS.natural;
    var b = preset[0], c = preset[1], sat = preset[2];
    // The three graded sliders sit on top of the preset, as they do in the
    // render: warmth pushes saturation and a tint, grain is drawn separately.
    var warm = Math.max(-100, Math.min(100, Number(t.warm) || 0)) / 100;
    return 'filter: brightness(' + (1 + b).toFixed(3) + ') contrast(' + c.toFixed(3) + ')'
      + ' saturate(' + Math.max(0, sat + warm * 0.25).toFixed(3) + ')'
      + (warm ? ' sepia(' + Math.max(0, warm * 0.35).toFixed(3) + ')' : '') + ';';
  }

  // A 16:9 stand-in for the source, so Fit and Blur have letterboxing to show.
  // Deliberately an illustration rather than a photograph: it is a placeholder,
  // and dressing it up as a real frame from the customer's lecture would be a
  // lie about what is being previewed.
  var PREVIEW_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">'
    + '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#26242A"/><stop offset="1" stop-color="#141317"/></linearGradient></defs>'
    + '<rect width="960" height="540" fill="url(#b)"/>'
    + '<circle cx="480" cy="214" r="66" fill="#3A3740"/>'
    + '<path d="M366 540c0-74 51-124 114-124s114 50 114 124z" fill="#3A3740"/>'
    + '<rect x="470" y="300" width="20" height="150" rx="10" fill="#4A4650"/>'
    + '<circle cx="480" cy="300" r="26" fill="#565060"/>'
    + '<text x="480" y="512" fill="#6E6A78" font-family="Inter,sans-serif" font-size="26"'
    + ' text-anchor="middle">Sample 16:9 source</text></svg>');

  // The caption families the worker image actually installs (worker/Dockerfile).
  // Offering one it does not have means fontconfig quietly substitutes another
  // and the clip renders in a font nobody chose -- which is what happened with
  // Inter. `web` is only for the preview: the browser will not have DejaVu or
  // Amiri either, so each falls back to the closest thing it does have.
  var CAPTION_FONTS = [
    { name: 'DejaVu Sans', label: 'DejaVu Sans', web: '"DejaVu Sans", Verdana, sans-serif' },
    { name: 'Liberation Sans', label: 'Liberation', web: '"Liberation Sans", Arial, Helvetica, sans-serif' },
    { name: 'Open Sans', label: 'Open Sans', web: '"Open Sans", "Segoe UI", sans-serif' },
    { name: 'DejaVu Serif', label: 'DejaVu Serif', web: '"DejaVu Serif", Georgia, serif' },
    { name: 'Amiri', label: 'Amiri', web: 'Amiri, "Scheherazade New", Georgia, serif' },
    { name: 'Scheherazade New', label: 'Scheherazade', web: '"Scheherazade New", Amiri, Georgia, serif' },
  ];

  function webFontFor(name) {
    for (var i = 0; i < CAPTION_FONTS.length; i++) {
      if (CAPTION_FONTS[i].name === name) return CAPTION_FONTS[i].web;
    }
    // An older template may name a font that is no longer offered. Say so in the
    // only way the preview can: fall back, rather than pretending it is fine.
    return 'Inter, system-ui, sans-serif';
  }

  // A short sample script so the preview can play, which is the only way to show
  // what a caption mode actually does: "word by word" and "stacked lines" are
  // indistinguishable from a still. Three lines, roughly the length and cadence
  // of a real clip's captions.
  var SAMPLE_LINES = [
    'He has the whole of the dunya given to us',
    'and we still complain about the small things',
    'that happen to us each and every day',
  ];
  var SAMPLE_WORD_SECONDS = 0.42;
  var SAMPLE_LINE_GAP = 0.5;

  // Flattened to words with timings once, at module load.
  var SAMPLE_WORDS = (function () {
    var out = [];
    var at = 0;
    for (var line = 0; line < SAMPLE_LINES.length; line++) {
      var words = SAMPLE_LINES[line].split(' ');
      for (var i = 0; i < words.length; i++) {
        out.push({ text: words[i], line: line, index: i, start: at, end: at + SAMPLE_WORD_SECONDS });
        at += SAMPLE_WORD_SECONDS;
      }
      at += SAMPLE_LINE_GAP;
    }
    return out;
  }());
  var SAMPLE_TOTAL = SAMPLE_WORDS.length
    ? SAMPLE_WORDS[SAMPLE_WORDS.length - 1].end + SAMPLE_LINE_GAP
    : 0;

  // What is on screen at a given moment, for a given caption mode. Mirrors what
  // the renderer does: a phrase holds the line, word-by-word shows one, and
  // dynamic-stack shows the group of words it is currently stacking.
  // As above, but split into the words on screen and which one is live, so the
  // preview can highlight it the way the render does.
  function sampleCaptionParts(seconds, mode, stackMax) {
    if (!SAMPLE_WORDS.length) return { words: [], liveIndex: -1 };
    var now = SAMPLE_WORDS.filter(function (w) { return seconds >= w.start && seconds < w.end; })[0];
    var live = Boolean(now);
    if (!now) {
      var past = SAMPLE_WORDS.filter(function (w) { return w.end <= seconds; });
      now = past.length ? past[past.length - 1] : SAMPLE_WORDS[0];
    }
    var line = SAMPLE_WORDS.filter(function (w) { return w.line === now.line; });
    var shown;
    if (mode === 'word') shown = [now];
    else if (mode === 'phrase') shown = line;
    else {
      var n = Math.max(1, Math.min(6, Number(stackMax) || 4));
      var chunk = Math.floor(now.index / n);
      shown = line.slice(chunk * n, chunk * n + n);
    }
    var at = -1;
    for (var i = 0; i < shown.length; i++) if (shown[i] === now) at = i;
    return {
      words: shown.map(function (w) { return w.text; }),
      // Between lines nothing is being spoken, so nothing is highlighted.
      liveIndex: live ? at : -1,
    };
  }

  function sampleCaptionAt(seconds, mode, stackMax) {
    if (!SAMPLE_WORDS.length) return '';
    var now = SAMPLE_WORDS.filter(function (w) { return seconds >= w.start && seconds < w.end; })[0];
    // In a gap between lines, hold the last thing shown rather than blanking:
    // a caption that disappears between lines reads as a bug.
    if (!now) {
      var past = SAMPLE_WORDS.filter(function (w) { return w.end <= seconds; });
      now = past.length ? past[past.length - 1] : SAMPLE_WORDS[0];
    }
    var line = SAMPLE_WORDS.filter(function (w) { return w.line === now.line; });
    if (mode === 'word') return now.text;
    if (mode === 'phrase') return line.map(function (w) { return w.text; }).join(' ');
    var n = Math.max(1, Math.min(6, Number(stackMax) || 4));
    var chunk = Math.floor(now.index / n);
    return line.slice(chunk * n, chunk * n + n).map(function (w) { return w.text; }).join(' ');
  }

  function clockLabel(seconds) {
    var whole = Math.max(0, Math.round(seconds));
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }

  // The shapes the platforms actually take. Named for where they are posted
  // rather than by ratio, which is what the person choosing is thinking about.
  var RATIO_PRESETS = [
    { label: 'Shorts + Reels · 9:16', width: 1080, height: 1920 },
    { label: 'Square · 1:1', width: 1080, height: 1080 },
    { label: 'Widescreen · 16:9', width: 1920, height: 1080 },
  ];

  function ratioLabel(width, height) {
    for (var i = 0; i < RATIO_PRESETS.length; i++) {
      if (RATIO_PRESETS[i].width === Number(width) && RATIO_PRESETS[i].height === Number(height)) {
        return RATIO_PRESETS[i].label;
      }
    }
    // A size set before the presets existed, or by hand. Report it rather than
    // showing the wrong preset as selected.
    return (Number(width) || 1080) + '×' + (Number(height) || 1920);
  }

  // The renderer fades the whole caption event, not each word, so the preview
  // fades the box. Only while the sample is playing: a fade that replays on
  // every idle repaint would be a flicker, not a preview.
  // Outline, shadow, background box and line height, drawn the way the render
  // will. The outline is a ring of text-shadows because -webkit-text-stroke
  // draws inside the glyph and thins the letter; ASS draws it outside.
  function capInkStyle(t) {
    var out = '';
    var lineHeight = Math.max(0.65, Math.min(1.4, Number(t.captionLineHeight) || 0.88));
    out += ' line-height: ' + lineHeight.toFixed(2) + ';';

    var opacity = Math.max(0, Math.min(100, Number(t.captionBackgroundOpacity) || 0));
    if (opacity) {
      out += ' background: ' + hexToRgba(t.captionBackground || '#000000', opacity / 100) + ';'
        + ' padding: 0.12em 0.3em; border-radius: 4px; box-decoration-break: clone;'
        + ' -webkit-box-decoration-break: clone;';
    }

    var shadows = [];
    var width = Math.max(0, Math.min(14, Number(t.captionOutlineWidth) || 0));
    if (width) {
      // Scaled to the preview, which is a fraction of the real frame.
      var px = Math.max(1, Math.round(width / 3));
      var colour = t.captionOutline || '#09090A';
      var steps = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
      for (var i = 0; i < steps.length; i++) {
        shadows.push((steps[i][0] * px) + 'px ' + (steps[i][1] * px) + 'px 0 ' + colour);
      }
    }
    var drop = Math.max(0, Math.min(8, Number(t.captionShadow) || 0));
    if (drop) shadows.push(Math.round(drop / 2) + 'px ' + Math.round(drop / 2) + 'px ' + drop + 'px rgba(0,0,0,.75)');
    if (shadows.length) out += ' text-shadow: ' + shadows.join(', ') + ';';
    return out;
  }

  function hexToRgba(hex, alpha) {
    var value = String(hex || '#000000').replace('#', '');
    var n = parseInt(value.length === 3
      ? value.split('').map(function (c) { return c + c; }).join('')
      : value, 16);
    if (!isFinite(n)) n = 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha.toFixed(2) + ')';
  }

  function capFadeStyle(t, playing) {
    var ms = Math.max(0, Math.min(600, Number(t.captionFadeMs) || 0));
    if (!ms || !playing) return '';
    return ' animation: dcCapFade ' + ms + 'ms ease-in 1;';
  }

  function handleStyle(on) {
    return on
      ? 'position: absolute; inset: -6px; border: 1px dashed rgba(217,180,120,.7); border-radius: 6px; pointer-events: none;'
      : 'display: none;';
  }
  // Places a preview overlay from the template's own position fields.
  // `fromEdge` is a fraction of the frame height measured from whichever edge
  // the alignment anchors to -- top for a top caption, bottom for a bottom one.
  // That is what ASS MarginV means (see alignment_for in clip_worker.py), so the
  // preview and the export agree. Middle alignments ignore MarginV entirely, so
  // they stay centred. Without this the preview snapped between three fixed
  // spots and dragging looked broken even once the drag worked.
  function overlayStyle(vertical, horizontal, colour, size, fromEdge, font, upper) {
    var v;
    if (fromEdge === null || fromEdge === undefined || vertical === 'middle') {
      v = vertical === 'top' ? 'top: 8%;' : vertical === 'bottom' ? 'bottom: 8%;' : 'top: 50%; translate: 0 -50%;';
    } else {
      var pct = Math.max(2, Math.min(50, fromEdge * 100)).toFixed(2);
      v = (vertical === 'top' ? 'top: ' : 'bottom: ') + pct + '%;';
    }
    var h = horizontal === 'left' ? 'left: 8%; text-align: left;'
      : horizontal === 'right' ? 'right: 8%; text-align: right;'
      : 'left: 50%; transform: translateX(-50%); text-align: center;';
    return 'position: absolute; ' + v + ' ' + h + ' max-width: 84%; color: ' + (colour || '#FFFFFF') +
      '; font-size: ' + Math.max(9, Math.round(Number(size || 40) / 6)) + 'px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 6px rgba(0,0,0,.7);'
      + (font ? ' font-family: ' + font + ';' : '')
      + (upper ? ' text-transform: uppercase;' : '');
  }


  // Platforms spell themselves; naive capitalisation gives "Tiktok".
  var PLATFORM_NAMES = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
  // The names the existing dashboard shows, which say which surface is posted to.
  var PLATFORM_TITLES = { youtube: 'YouTube Shorts', instagram: 'Instagram Reels', tiktok: 'TikTok', facebook: 'Facebook Reels' };
  // Instagram and Facebook are one Meta connection: connecting, testing or
  // disconnecting either affects both.
  var OAUTH_OF = { youtube: 'youtube', instagram: 'meta', facebook: 'meta', tiktok: 'tiktok' };
  var PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook'];

  // The engine finishes a project as `done` (local-engine.js:455, :739), never
  // `ready` -- that is a clip status. Module scope, because lecState() is called
  // from several points inside bindings() and a `var` inside the function is
  // hoisted without its value.
  var FINISHED_PROJECT = { done: 1, completed: 1, ready: 1 };

  // Connection state lives at DATA.social.providers.<key>, and whether a platform
  // is switched on lives at DATA.publishingSettings.<key>.enabled -- a different
  // object. Reading DATA.social.<key> returns undefined, which renders every
  // platform as disconnected no matter what is actually linked.
  function providerInfo(DATA, key) {
    var status = ((DATA.social || {}).providers || {})[key] || {};
    var setting = (DATA.publishingSettings || {})[key] || {};
    var accounts = status.accounts || [];
    var account = null;
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === setting.accountId) account = accounts[i];
    if (!account) account = accounts[0] || null;
    return {
      key: key,
      title: PLATFORM_TITLES[key] || key,
      oauth: OAUTH_OF[key] || key,
      icon: key === 'youtube' ? 'ph ph-youtube-logo' : key === 'instagram' ? 'ph ph-instagram-logo'
        : key === 'tiktok' ? 'ph ph-tiktok-logo' : 'ph ph-facebook-logo',
      status: status,
      accounts: accounts,
      account: account,
      connected: Boolean(status.connected),
      // An absent provider counts as configured, matching the server's shape.
      configured: status.configured !== false,
      enabled: Boolean(setting.enabled),
    };
  }

  // Collage geometry for Home's floating clip previews — reproduced from the
  // design so the drift and overlap match what was drawn.
  var FLOAT_POS = [
    { top: '0px', left: '6px', rot: '-4deg', delay: '0s', dur: '7.5s', w: '124px' },
    { top: '54px', left: '148px', rot: '3deg', delay: '.8s', dur: '8.5s', w: '138px' },
    { top: '186px', left: '18px', rot: '2deg', delay: '.4s', dur: '9s', w: '132px' },
    { top: '248px', left: '166px', rot: '-3deg', delay: '1.2s', dur: '8s', w: '118px' },
  ];

  // ── navigation ────────────────────────────────────────────────────────────

  function navItem(key, label, icon, count) {
    var on = UI.screen === key;
    var open = UI.railOpen;
    return {
      label: label,
      icon: icon,
      count: count || '',
      click: function (e) { stop(e); setUI({ screen: key, menuOpen: false, bellOpen: false }); },
      // Hover is CSS, not state. Driving it from JS meant every mouseover
      // re-rendered the whole dashboard through innerHTML, which replaced the
      // element under the pointer — and a browser only fires `click` when
      // mousedown and mouseup land on the same element, so nothing was
      // clickable. The active item marks its colours !important because an
      // inline !important is the one thing a stylesheet :hover cannot override.
      enter: null,
      leave: null,
      style: 'position: relative; display: flex; align-items: center; gap: 10px; padding: ' + (open ? '8px 10px' : '9px 0') + '; ' + (open ? '' : 'justify-content: center; ') +
        'border-radius: 8px; font-weight: ' + (on ? '500' : '400') + '; cursor: pointer; white-space: nowrap; transition: background .14s ease, color .14s ease; border-left: 2px solid ' +
        (on ? '#D9B478; background: rgba(217,180,120,.09) !important; color: #F0D6A6 !important;' : 'transparent; color: #A2A2AA;'),
      labelStyle: open ? 'overflow: hidden; text-overflow: ellipsis;' : 'display: none;',
      countStyle: (open && count) ? 'margin-left: auto; padding: 1px 6px; border-radius: 20px; background: ' + (on ? 'rgba(217,180,120,.16)' : '#1D1D21') + '; font-size: 10.5px; font-weight: 600; color: ' + (on ? '#F0D6A6' : '#8B8B93') + ';' : 'display: none;',
      tipStyle: open
        ? 'display: none;'
        : 'position: absolute; left: calc(100% + 10px); top: 50%; translate: 0 -50%; z-index: 40; padding: 5px 9px; border: 1px solid #26262A; border-radius: 7px; background: #17171A; color: #F2F2F4; font-size: 11.5px; font-weight: 500; box-shadow: 0 12px 30px rgba(0,0,0,.55); pointer-events: none; opacity: 0; transition: opacity .12s ease;',
    };
  }

  var TITLES = {
    home: 'Home', queue: 'Review queue', library: 'Lecture library', schedule: 'Schedule',
    templates: 'Templates', music: 'Nasheed library', language: 'Arabic & terms',
    performance: 'Performance', editor: 'Clip editor', tokens: 'Tokens & billing',
  };

  function sublineFor(screen, ctx) {
    var empty = ctx.projects.length === 0;
    switch (screen) {
      case 'home':
        return empty ? 'Paste a lecture link to make your first clips'
          : plural(ctx.projects.length, 'lecture') + ' · ' + ctx.needsCount + ' awaiting review';
      case 'queue':
        return empty ? 'Nothing here yet — paste a lecture on Home'
          : ctx.needsCount + ' clips awaiting a decision across ' + plural(ctx.projects.length, 'lecture');
      case 'library':
        return empty ? 'No lectures yet — paste a link on Home to make your first clips'
          : plural(ctx.projects.length, 'lecture') + ' · ' + plural(ctx.clips.length, 'clip') + ' generated';
      case 'templates': return 'Set once — every clip renders with it, still editable per clip';
      case 'schedule': return 'Up to four posts a day · every clip is checked before it goes out';
      case 'music': return plural(ctx.tracks.length, 'nasheed') + ' · shuffled automatically';
      case 'tokens': return ctx.planLabel;
      default: return '';
    }
  }

  // ── the binding table ─────────────────────────────────────────────────────

  function bindings(DATA) {
    DATA = DATA || {};
    var projects = DATA.projects || [];
    var clips = DATA.clips || [];
    var tracks = DATA.tracks || [];
    var log = DATA.log || [];
    var social = DATA.social || {};
    var current = (DATA.billing && DATA.billing.current) || {};

    var pending = awaitingReview(clips);
    var needsCount = pending.length;
    var scheduled = clips.filter(function (c) { return c.scheduledAt && !c.postedAt; })
      .sort(function (a, b) { return new Date(a.scheduledAt) - new Date(b.scheduledAt); });
    var recent4 = clips.slice(-4).reverse();

    var planLabel = current.unlimited ? 'Unlimited'
      : (current.plan ? current.plan.charAt(0).toUpperCase() + current.plan.slice(1) : 'Free');
    var ctx = { projects: projects, clips: clips, tracks: tracks, needsCount: needsCount, planLabel: planLabel };

    var providers = PLATFORMS.map(function (k) { return providerInfo(DATA, k); });
    var byKey = {};
    providers.forEach(function (p) { byKey[p.key] = p; });

    // The quote-review gate is a real automation setting, not a demo prop.
    var gate = !(DATA.automationSettings && DATA.automationSettings.skipQuotes === false);
    // Whether anything can actually go out: the server-wide switch, plus at
    // least one platform both connected and enabled.
    var publishingOn = DATA.directPublishingEnabled !== false;
    var connectedCount = providers.filter(function (p) { return p.connected; }).length;
    // Both, not just enabled: a platform left switched on after its account was
    // disconnected would otherwise light up Post now and then fail at the API.
    var activeCount = providers.filter(function (p) { return p.enabled && p.connected; }).length;

    // A raw link is not a title. Lectures submitted before the title was stored
    // properly still carry a URL in that field, and the worker only replaces it
    // when the job finishes -- so without this they read as
    // "https://www.youtube.com/watch?v=..." for their whole run.
    function looksLikeUrl(value) { return /^https?:\/\//i.test(String(value || '').trim()); }
    function bestTitle(p) {
      var own = String(p.title || '').trim();
      if (own && !looksLikeUrl(own)) return own;
      var source = String(p.sourceTitle || '').trim();
      if (source && !looksLikeUrl(source)) return source;
      return 'Untitled lecture';
    }
    var projectTitle = {};
    projects.forEach(function (p) { projectTitle[p.id] = bestTitle(p); });

    // One card builder for the queue, the deck and a lecture's clip list, so a
    // clip looks and behaves the same wherever it appears.
    function clipCard(c, i) {
      var st = decision(c);
      return {
        caption: c.title || '',
        duration: secsToClock((c.durationMs || 0) / 1000),
        style: c.templateName || '',
        lecTitle: projectTitle[c.projectId] || '',
        score: c.score || '—',
        flagged: gate && Boolean(c.reviewRequired),
        thumbStyle: 'position: relative; aspect-ratio: 9 / 16; overflow: hidden; background: ' + thumb(c.thumbUrl) + ';',
        cardStyle: 'display: flex; flex-direction: column; border: 1px solid ' +
          (st === 'approved' ? 'rgba(127,209,166,.34)' : st === 'rejected' ? '#2A2024' : '#1E1E22') +
          '; border-radius: 11px; overflow: hidden; background: #121214; opacity: ' + (st === 'rejected' ? '.5' : '1') +
          '; animation: dcRise .26s cubic-bezier(.2,.8,.2,1) ' + Math.min(i * 0.03, 0.4) + 's both; box-shadow: 0 8px 22px rgba(0,0,0,.26);',
        stateChip: st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : '',
        stateChipStyle: st
          ? 'position: absolute; top: 8px; right: 8px; padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid ' +
            (st === 'rejected' ? '#3A2A2A; background: rgba(10,10,12,.85); color: #E3928C;' : 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: #7FD1A6;')
          : 'display: none;',
        primaryLabel: st === 'approved' ? 'Approved' : 'Approve',
        primaryIcon: st === 'approved' ? 'ph-fill ph-check-circle' : 'ph ph-check',
        primaryStyle: 'display: flex; align-items: center; justify-content: center; gap: 6px; flex: 1; padding: 7px 10px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid ' +
          (st === 'approved' ? 'rgba(127,209,166,.4); background: rgba(127,209,166,.1); color: #7FD1A6;' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'),
        approve: function (e) { stop(e); approve(c.id); },
        primary: function (e) { stop(e); approve(c.id); },
        reject: function (e) { stop(e); reject(c.id); },
        // Approve / edit / reject is the card's action row; `third` is reject.
        third: function (e) { stop(e); reject(c.id); },
        thirdIcon: 'ph ph-x',
        edit: function (e) { stop(e); setUI({ screen: 'editor', edClipId: c.id }); },
        openLecture: function (e) { stop(e); setUI({ screen: 'detail', openProject: c.projectId }); },
      };
    }

    function approve(id) {
      UI.pending[id] = 'approved';
      refresh();
      global.StudioAdapter.onApprove(id);
    }
    // Rejecting persists now: the clip record has a `rejected` status, so a
    // reviewed batch survives a reload. Nothing is destroyed -- the render stays
    // and the decision can be undone.
    function reject(id) {
      UI.pending[id] = 'rejected';
      refresh();
      global.StudioAdapter.onReject(id);
    }

    var q = (UI.query || '').trim().toLowerCase();
    var queueClips = clips.filter(function (c) {
      if (q && ((c.title || '') + ' ' + (projectTitle[c.projectId] || '')).toLowerCase().indexOf(q) === -1) return false;
      var st = decision(c);
      if (UI.filter === 'review') return st === null;
      if (UI.filter === 'flagged') return gate && c.reviewRequired && st === null;
      if (UI.filter === 'approved') return st === 'approved';
      return true;
    }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).map(clipCard);

    var deckClip = queueClips[Math.min(UI.deckIdx, Math.max(0, queueClips.length - 1))] || null;

    // The lecture currently being processed drives the pipeline rail.
    var active = projects.filter(function (p) { return lecState(p) === 'processing'; })[0] || null;
    var activeStage = active ? stageIndex(active) : 0;

    // A lecture's shelf state, from the record's own status.
    //
    // The engine finishes a project as `done` (local-engine.js:455, :739), never
    // `ready` -- `ready` is a clip status. Recognising only `ready` here meant
    // every finished lecture showed PROCESSING forever, the "Ready" filter was
    // always empty, and the newest finished lecture stayed pinned at 100% in
    // "Processing now".
    function lecState(p) {
      if (FINISHED_PROJECT[p.status]) return 'ready';
      if (p.status === 'cancelled' || p.status === 'failed') return 'archived';
      return 'processing';
    }
    function clipsOf(projectId) {
      return clips.filter(function (c) { return c.projectId === projectId; });
    }

    var libraryItems = projects.filter(function (p) {
      if (q && (projectTitle[p.id] || '').toLowerCase().indexOf(q) === -1) return false;
      return UI.libFilter === 'all' || lecState(p) === UI.libFilter;
    }).map(function (p) {
      var state = lecState(p);
      var mine = clipsOf(p.id);
      var scores = mine.map(function (c) { return Number(c.score || 0); }).filter(Boolean).sort(function (a, b) { return a - b; });
      var median = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
      return {
        title: projectTitle[p.id],
        dur: humanDuration(p.durationSec || p.sourceDurationSec),
        when: since(p.submittedAt),
        clips: plural(mine.length, 'clip'),
        srcIcon: p.url ? 'ph-fill ph-youtube-logo' : 'ph-fill ph-upload-simple',
        srcLabel: p.url ? 'YouTube import' : 'Uploaded MP4',
        // The scrim is not decoration: the clip count and state sit along the
        // bottom edge with no background of their own, and were unreadable over
        // a bright thumbnail. It only mattered once posters started appearing.
        thumbStyle: 'position: relative; aspect-ratio: 16 / 9; background-color: #17171A;' +
          (p.sourceThumbUrl
            ? ' background-image: linear-gradient(to bottom, rgba(8,8,10,0) 40%, rgba(8,8,10,.82) 100%), url("' + cssUrl(p.sourceThumbUrl) + '");'
              + ' background-size: cover, cover; background-position: center, center 30%;'
            : ''),
        stateChip: state === 'processing' ? 'Processing' : state === 'ready' ? 'Ready' : 'Archived',
        chipStyle: 'display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; border: 1px solid ' +
          (state === 'processing' ? 'rgba(217,180,120,.4); background: rgba(10,10,12,.82); color: #F0D6A6;'
            : state === 'ready' ? 'rgba(127,209,166,.32); background: rgba(10,10,12,.82); color: #7FD1A6;'
            : '#33333A; background: rgba(10,10,12,.82); color: #A2A2AA;'),
        chipIcon: state === 'processing' ? 'ph ph-circle-notch' : state === 'ready' ? 'ph-fill ph-check-circle' : 'ph ph-archive',
        chipIconStyle: 'font-size: 11px;' + (state === 'processing' ? ' animation: dcSpin 1.1s linear infinite;' : ''),
        isProcessing: state === 'processing',
        barStyle: 'position: absolute; left: 0; bottom: 0; height: 3px; width: ' + Math.round(p.progress || 0) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6); transition: width .5s ease;',
        // A shortfall is normal -- overlapping windows are dropped, and a short
        // lecture has fewer distinct moments -- but saying nothing reads as
        // clips having gone missing.
        metric: state === 'processing' ? (p.stage || 'working…')
          : (p.clipsRequested && mine.length && mine.length < p.clipsRequested)
            ? mine.length + ' of ' + p.clipsRequested + ' asked for · the rest overlapped'
            : median ? 'median score ' + median : 'no clips yet',
        openClips: function (e) { stop(e); setUI({ screen: 'detail', openProject: p.id }); },
        more: function (e) {
          stop(e);
          global.StudioAdapter.onPickOption('More clips from this lecture',
            ['Cut 4 more clips', 'Cut 8 more clips', 'Cancel'], function (choice) {
              var n = choice === 'Cut 4 more clips' ? 4 : choice === 'Cut 8 more clips' ? 8 : 0;
              if (n) global.StudioAdapter.onMoreClips(p.id, n);
            });
        },
      };
    });

    var detail = projects.filter(function (p) { return p.id === UI.openProject; })[0] || projects[0] || null;
    var detailClips = detail ? clipsOf(detail.id).sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).map(clipCard) : [];

    // Schedule: the next seven days, filled from clips that already hold a slot.
    var DAY_MS = 86400000;
    var startOfDay = function (t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    var today = startOfDay(Date.now());
    function scheduleItem(c) {
            var target = (c.targets && c.targets[0]) || {};
            var platform = target.platform || target.provider || '';
            // The four checks the design requires before anything may go out.
            // Post now stays disabled until all four pass.
            var checks = [
              // A clip rendered deliberately without a nasheed passes this: it
              // is not a failed check, it is a choice the job recorded.
              { label: c.musicEnabled === false ? 'No nasheed (chosen)' : 'Nasheed mixed in',
                ok: c.musicEnabled === false || Boolean(c.musicVerified) },
              { label: 'Captions rendered', ok: Boolean(c.transcript) },
              { label: 'Clip Style applied', ok: Boolean(c.templateId) },
              { label: 'Render verified', ok: Boolean(c.renderVerified) },
            ];
            var failing = checks.filter(function (k) { return !k.ok; });
            var ready = failing.length === 0;
            return {
              time: timeOf(c.scheduledAt),
              dest: PLATFORM_NAMES[platform] || 'No account',
              icon: platform === 'youtube' ? 'ph ph-youtube-logo' : platform === 'instagram' ? 'ph ph-instagram-logo' : platform === 'tiktok' ? 'ph ph-tiktok-logo' : 'ph ph-share-network',
              caption: c.title || '',
              score: c.score || '',
              duration: secsToClock((c.durationMs || 0) / 1000),
              thumbStyle: 'width: 30px; height: 42px; flex: none; border-radius: 6px; border: 1px solid #26262A; background: ' + thumb(c.thumbUrl) + ';',
              checks: checks.map(function (k) {
                return {
                  label: k.label,
                  icon: k.ok ? 'ph-fill ph-check-circle' : 'ph-fill ph-warning-circle',
                  style: 'font-size: 12px; color: ' + (k.ok ? '#7FD1A6' : '#E6B770'),
                };
              }),
              hasFailing: !ready,
              statusLabel: c.postedAt ? 'Posted' : ready ? '4/4 checks' : failing.length + ' failing',
              statusStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; border: 1px solid ' +
                (ready ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: #7FD1A6;' : '#3A2A2A; background: rgba(10,10,12,.85); color: #E6B770;'),
              cardStyle: 'display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid ' +
                (ready ? '#1E1E22' : '#2A2024') + '; border-radius: 10px; background: #121214;',
              // Nothing posts unchecked: the button says why instead of failing.
              postLabel: c.postedAt ? 'Posted'
                : !ready ? 'Fix first'
                : !publishingOn ? 'Publishing off'
                : !activeCount ? 'No channel on'
                : 'Post now',
              postStyle: 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: ' + (ready && !c.postedAt ? 'pointer' : 'not-allowed') + '; border: 1px solid ' +
                (ready && !c.postedAt && publishingOn && activeCount
                  ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'
                  : '#26262A; background: #17171A; color: #6E6E76;'),
              postNow: function (e) {
                stop(e);
                if (c.postedAt) { toast('This clip has already posted.'); return; }
                if (!ready) { toast(failing[0].label + ' has not passed yet.'); return; }
                // Posting with publishing off cycled the clip ready -> scheduled
                // -> ready and put nothing anywhere, with no explanation.
                if (!publishingOn) {
                  toast('Publishing is switched off, so nothing was sent. The clip is ready to download.');
                  return;
                }
                // Connecting an account does not switch it on. Rather than name
                // a "Channels" screen that does not exist in the nav, open the
                // panel that has the switch — the toast alone left people stuck
                // with YouTube connected and no idea what else to do.
                if (!activeCount) {
                  toast(connectedCount
                    ? 'Connected, but not switched on yet — use the toggle to turn a channel on.'
                    : 'Connect a channel first, then switch it on.');
                  global.StudioAdapter.onOpenConnections(providers[0] && providers[0].key);
                  return;
                }
                global.StudioAdapter.onPostNow(c.id);
              },
              sendBack: function (e) { stop(e); global.StudioAdapter.onSendBack(c.id); },
            };
    }

    // A clip scheduled in the past is counted by the rail badge but rendered by
    // no day row, while Home shows its time as though it were going out today.
    // Three screens, three accounts of one clip. It gets its own row.
    var overdue = scheduled.filter(function (c) {
      return startOfDay(c.scheduledAt) < today && !c.postedAt;
    });

    var scheduleDays = [];
    for (var dnum = 0; dnum < 7; dnum++) {
      (function (dayStart) {
        var label = dnum === 0 ? 'Today' : dnum === 1 ? 'Tomorrow'
          : new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long' });
        var items = scheduled.filter(function (c) { return startOfDay(c.scheduledAt) === dayStart; }).map(scheduleItem);
        scheduleDays.push({
          day: label,
          countLabel: items.length + ' of 4 scheduled',
          canAdd: items.length < 4,
          items: items,
          // Only approved clips with no slot yet can be scheduled.
          addClip: function (e) {
            stop(e);
            var free = clips.filter(function (c) { return decision(c) === 'approved' && !c.scheduledAt && !c.postedAt; });
            if (!free.length) { toast('Approve a clip in the review queue first.'); return; }
            var labels = free.slice(0, 6).map(function (c) { return (c.title || 'Clip').slice(0, 46); });
            global.StudioAdapter.onPickOption('Schedule into ' + label, labels.concat(['Cancel']), function (choice) {
              var picked = free.filter(function (c) { return (c.title || 'Clip').slice(0, 46) === choice; })[0];
              if (picked) global.StudioAdapter.onScheduleClip(picked.id);
            });
          },
        });
      })(today + dnum * DAY_MS);
    }

    var templates = DATA.templates || [];
    var activeTemplate = templates.filter(function (t) { return t.id === (UI.jobTplId || (DATA.selectedTemplate && DATA.selectedTemplate.id)); })[0]
      || DATA.selectedTemplate || templates[0] || null;

    var clipCfg = DATA.clipSettings || {};
    var clipsPerVideo = Number(clipCfg.clipsPerVideo || 0);
    var durLabel = '';
    for (var di = 0; di < DUR_PRESETS.length; di++) {
      if (clipCfg.clipMaxSeconds === DUR_PRESETS[di].max) durLabel = DUR_PRESETS[di].label;
    }
    if (!durLabel && clipCfg.clipMaxSeconds) durLabel = 'Up to ' + clipCfg.clipMaxSeconds + 's';

    var musicVolume = Number((DATA.musicSettings || {}).volumePercent || 0);

    // In the clip editor the preview has to show THIS clip's tweaks on top of the
    // shared style. Without it the user drags a caption, the value is saved
    // against the clip, and the preview — still reading the template — does not
    // move, which reads as a broken control.
    var edClipRecord = UI.edClipId
      ? (DATA.clips || []).filter(function (c) { return c.id === UI.edClipId; })[0] || null
      : null;
    var clipStyle = (UI.screen === 'editor' && edClipRecord)
      ? Object.assign({}, edClipRecord.styleOverrides || {}, UI.edStyleDraft || {})
      : null;

    // The template being edited, with the schema's own defaults behind it so a
    // partially-populated record cannot render blanks.
    var tpl = Object.assign({
      fitMode: 'crop', smartFramingBias: 'auto', captionMode: 'dynamic-stack',
      filterPreset: 'natural', captionPosition: 'middle', captionHorizontal: 'right',
      captionPrimary: '#FFFFFF', captionFontSize: 96, captionMarginV: 180,
      captionFont: 'DejaVu Sans', captionUppercase: false,
      watermarkPosition: 'top-center', watermarkColor: '#D9B478', watermarkFontSize: 28,
      watermark: 'DEENCLIPPED', watermarkOpacity: 100,
      vignette: 0, grain: 0, warm: 0, smartFramingZoom: 1, smartFramingEnabled: false,
      voiceEnhance: true,
    }, activeTemplate || {}, clipStyle || UI.tplDraft || {});

    // Slider writes land on every `input` event. Sending each one meant a PUT
    // per pixel of travel, and each PUT used to queue a re-render for every
    // unposted clip. The value is applied locally at once so the control feels
    // live, and the write is trailing-debounced.
    function saveTemplate(patch) {
      // Record the step before applying it, so Undo has something to go back
      // to. Skipped while replaying, or undoing would push its own inverse and
      // the two buttons would fight each other.
      if (!UI.tplReplaying) {
        var before = {};
        var moved = false;
        for (var key in patch) {
          if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
          if (tpl[key] === patch[key]) continue;
          before[key] = tpl[key];
          moved = true;
        }
        if (moved) {
          UI.tplPast = UI.tplPast.concat([{ undo: before, redo: Object.assign({}, patch) }]).slice(-50);
          // A fresh edit invalidates anything that was undone past.
          UI.tplFuture = [];
        }
      }
      UI.tplDirty = true;
      UI.tplDraft = Object.assign({}, UI.tplDraft, patch);
      refresh();
      if (UI.tplTimer) global.clearTimeout(UI.tplTimer);
      UI.tplTimer = global.setTimeout(function () {
        UI.tplTimer = null;
        var pending = UI.tplDraft;
        UI.tplDraft = null;
        global.StudioAdapter.onTemplateField(activeTemplate && activeTemplate.id, pending);
      }, 450);
    }

    // The same write, aimed at one clip instead of the shared style. Debounced
    // identically, but nothing is re-rendered until the user asks: an override
    // only marks the clip's video as out of date.
    function saveClipStyle(patch) {
      UI.edStyleDraft = Object.assign({}, UI.edStyleDraft, patch);
      UI.edDirty = true;
      refresh();
      if (UI.edStyleTimer) global.clearTimeout(UI.edStyleTimer);
      UI.edStyleTimer = global.setTimeout(function () {
        UI.edStyleTimer = null;
        var pending = UI.edStyleDraft;
        UI.edStyleDraft = null;
        global.StudioAdapter.onClipStyle(UI.edClipId, pending);
      }, 450);
    }

    // One decision, made once: the Templates screen edits the style everything
    // shares, the clip editor edits a single clip. Every control below calls
    // this, so no control can be wired to the wrong target by accident.
    function saveStyle(patch) {
      if (UI.screen === 'editor' && UI.edClipId) return saveClipStyle(patch);
      return saveTemplate(patch);
    }

    // Builds a settings row whose options come from the schema's enum, so a
    // picker can only ever offer a value sanitiseTemplate() accepts.
    function tplRow(defs) {
      return defs.map(function (d) {
        var current = tpl[d.field];
        var label = (d.labels && d.labels[current]) || titleCase(current);
        return {
          icon: d.icon, label: d.label, value: label,
          open: function (e) {
            stop(e);
            var options = d.opts.map(function (o) { return (d.labels && d.labels[o]) || titleCase(o); });
            global.StudioAdapter.onPickOption(d.label, options, function (chosen) {
              var idx = options.indexOf(chosen);
              if (idx > -1) saveStyle(defObj(d.field, d.opts[idx]));
            });
          },
        };
      });
    }
    function defObj(k, v) { var o = {}; o[k] = v; return o; }

    // Moves one step from one history stack to the other and applies it. Undo
    // and redo are the same operation with the stacks swapped, so `which` picks
    // the side of the step to replay.
    function replayStyle(from, to, which) {
      var step = from[from.length - 1];
      if (!step) return;
      from.length -= 1;
      to.push(step);
      UI.tplReplaying = true;
      try { saveStyle(Object.assign({}, step[which])); } finally { UI.tplReplaying = false; }
    }

    // Drags an overlay inside the preview frame it lives in. Pointer events are
    // captured so the drag survives leaving the element, and the value is
    // committed through saveTemplate, which is debounced -- so a drag produces
    // one write, not one per pixel.
    // The phone frame the drag is measured against.
    //
    // This used to be closest('[style*="aspect-ratio"]'), which only ever worked
    // by accident: the importer hoists static styles into classes, so the
    // frame's aspect-ratio lives in a class and the selector matched nothing.
    // makeDrag then returned silently and every caption drag did nothing.
    // Computed style is what actually decides the box, so ask for that.
    function dragFrame(node) {
      if (global.getComputedStyle) {
        for (var el = node; el && el.nodeType === 1; el = el.parentElement) {
          var ratio = global.getComputedStyle(el).aspectRatio;
          if (ratio && ratio !== 'auto') return el;
        }
      }
      // Falls back to the inline-style match for anywhere the frame does carry
      // one, and for environments with no computed style at all.
      return node && node.closest ? node.closest('[style*="aspect-ratio"]') : null;
    }

    // `kind` is what is being dragged ('caption' or 'mark'). It drives the drag
    // affordances -- the grabbing cursor, the dashed outline and the snap
    // guides -- which is the difference between this reading as a draggable
    // object and as text that happens to move.
    function makeDrag(kind, apply) {
      return function (e) {
        // dcTarget is the element the binding sits on. currentTarget is the
        // mount, because the runtime delegates -- measuring from it found the
        // whole dashboard rather than the phone frame, so the drag did nothing.
        // `this` is only trusted when it is genuinely an element: a plain call
        // in sloppy mode makes it the window, which is truthy and would win.
        var from = e.dcTarget || (this && this.nodeType === 1 ? this : null) || e.currentTarget;
        var frame = dragFrame(from);
        if (!frame || !frame.getBoundingClientRect) return;
        if (e.preventDefault) e.preventDefault();
        var box = frame.getBoundingClientRect();
        if (!box.height || !box.width) return;

        UI.dragKind = kind;
        function move(ev) {
          var y = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
          var x = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
          // Held so the guides can show where it is and whether it has caught a
          // line. apply() refreshes, so nothing extra is needed here.
          UI.dragAt = kind === 'caption' ? Math.max(SAFE_TOP, Math.min(SAFE_BOTTOM, y)) : y;
          var hit = snapAt(UI.dragAt);
          UI.dragSnapped = Boolean(hit);
          UI.dragSnapName = hit ? hit.name : '';
          apply(x, y);
        }
        function up() {
          UI.dragKind = null;
          UI.dragAt = null;
          UI.dragSnapped = false;
          UI.dragSnapName = '';
          global.removeEventListener('mousemove', move);
          global.removeEventListener('mouseup', up);
          refresh();
        }
        global.addEventListener('mousemove', move);
        global.addEventListener('mouseup', up);
        move(e);
      };
    }

    // The lines the caption snaps to, as fractions from the top: the safe-zone
    // edges, the thirds and the half. The label under the preview promises
    // exactly these, so they are listed once rather than implied by arithmetic.
    // The safe box the design draws (.s8n: top 8%, bottom 14%). Captions live
    // inside it because platform chrome covers the strips outside, so the drag
    // is clamped to it and its edges are snap points rather than arbitrary
    // percentages. These were 10% and 90%, which matched nothing on screen.
    var SAFE_TOP = 0.08;
    var SAFE_BOTTOM = 0.86;
    var SNAP_POINTS = [
      { at: SAFE_TOP, name: 'Safe top' },
      { at: 1 / 3, name: 'Upper third' },
      { at: 0.5, name: 'Middle' },
      { at: 2 / 3, name: 'Lower third' },
      { at: SAFE_BOTTOM, name: 'Safe bottom' },
    ];
    var SNAP_LINES = SNAP_POINTS.map(function (p) { return p.at; });
    var SNAP_WITHIN = 0.035;

    // The snap the given position has caught, if any. Named, so the preview can
    // say which line it landed on instead of only drawing it.
    function snapAt(value) {
      for (var i = 0; i < SNAP_POINTS.length; i++) {
        if (Math.abs(value - SNAP_POINTS[i].at) <= SNAP_WITHIN) return SNAP_POINTS[i];
      }
      return null;
    }
    // Mirrors NUMBER_RANGES.captionMarginV in src/templates.js. Half a 1920-tall
    // frame, so a caption anchored to either edge can still reach the centre.
    var CAPTION_MARGIN_MAX = 960;

    function snapped(value) {
      var hit = snapAt(value);
      return hit ? hit.at : value;
    }

    // Vertical position is a real margin in device pixels from the bottom of a
    // 1920-tall frame; horizontal snaps to the alignments the renderer has.
    var dragCaptionFrom = makeDrag('caption', function (x, y) {
      var height = Number(tpl.height || 1920);
      // Clamped to the safe box: a caption outside it is covered by the
      // platform's own chrome, so letting it go there only produces clips with
      // hidden words.
      var snappedY = snapped(Math.max(SAFE_TOP, Math.min(SAFE_BOTTOM, y)));
      var align = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center';

      // Anchored to the nearer edge, not to thirds.
      //
      // Thirds read sensibly but left the middle third dead: a middle alignment
      // ignores MarginV (rows 4-6 of alignment_for), so everything from 34% to
      // 66% collapsed onto one fixed spot and the caption stopped following the
      // cursor across a third of the frame.
      //
      // Anchoring to the nearer edge means MarginV always carries the position,
      // so every height in the frame is reachable. Middle is kept as an explicit
      // snap for dead centre, which is the one place it is exactly right.
      if (Math.abs(snappedY - 0.5) < 1e-6) {
        saveStyle({ captionHorizontal: align, captionPosition: 'middle' });
        return;
      }
      var top = snappedY < 0.5;
      var fromEdge = top ? snappedY : 1 - snappedY;
      saveStyle({
        captionHorizontal: align,
        captionPosition: top ? 'top' : 'bottom',
        // MarginV measures from the edge the caption is anchored to, so a top
        // caption measures down and a bottom one measures up.
        captionMarginV: Math.round(Math.max(20, Math.min(CAPTION_MARGIN_MAX, fromEdge * height))),
      });
    });

    var dragMarkFrom = makeDrag('mark', function (x, y) {
      var vertical = y < 0.5 ? 'top' : 'bottom';
      var horizontal = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center';
      saveStyle({ watermarkPosition: vertical + '-' + horizontal });
    });

    // publicBilling() returns plans and topups as objects keyed by id.
    function asList(source) {
      if (!source) return [];
      if (Array.isArray(source)) return source;
      return Object.keys(source).map(function (k) {
        var v = source[k];
        return typeof v === 'object' ? Object.assign({ id: k }, v) : { id: k, name: k };
      });
    }
    var planList = asList(DATA.billing && (DATA.billing.plans || DATA.billing.availablePlans));
    var topupList = asList(DATA.billing && DATA.billing.topups);

    // The clip open in the editor, and the caption split into readable blocks.
    var edClip = clips.filter(function (c) { return c.id === UI.edClipId; })[0] || null;
    var edCaptionText = UI.edCaption !== null ? UI.edCaption : (edClip && edClip.transcript) || '';
    // Real caption blocks when the renderer supplied them, so each one can be
    // selected and edited. Falling back to splitting the flat transcript gives
    // one enormous block, which is what the editor showed before the worker
    // persisted timings.
    var rawBlocks = (edClip && Array.isArray(edClip.captionSegments) && edClip.captionSegments.length)
      ? edClip.captionSegments
      : String(edCaptionText).split(/(?<=[.!?\u061F])\s+/).filter(Boolean).map(function (line) {
        return { text: line, start: null, end: null };
      });
    var edCaptionBlocks = rawBlocks.map(function (block, i) {
      var on = UI.edBlock === i;
      return {
        text: block.text,
        // A block with real timings can say when it is; a fallback one cannot.
        time: block.start === null ? '' : secsToClock(block.start) + ' – ' + secsToClock(block.end),
        style: 'padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 12.5px; line-height: 1.45; background: #121214; border: 1px solid ' +
          (on ? 'rgba(217,180,120,.55)' : '#1E1E22') + ';',
        select: function (e) { stop(e); setUI({ edBlock: i, edBlockDraft: null }); },
      };
    });
    var selectedBlock = edCaptionBlocks[UI.edBlock] || null;

    // Other clips cut from the same lecture, for the editor's filmstrip.
    // The design renders this as a line of text, not as a strip of thumbnails --
    // there is no sc-for over it anywhere. Supplying the list of clips put
    // "[object Object],[object Object]" under the preview on every visit to the
    // editor.
    var edSiblingCount = edClip
      ? clips.filter(function (c) { return c.projectId === edClip.projectId && c.id !== edClip.id; }).length
      : 0;

    // Where the caption sits in the preview, as a percentage of frame height.
    var firstName = String((DATA.user && DATA.user.name) || '').trim().split(/\s+/)[0] || '';
    var needsReconnect = providers.filter(function (p) {
      return p.configured && !p.connected;
    }).map(function (p) { return PLATFORM_NAMES[p.key] || p.key; });

    // The newest lecture's own thumbnail is a real 16:9 frame from the
    // customer's footage, which is exactly the shape the layout modes act on.
    var previewSource = (function () {
      for (var i = 0; i < projects.length; i++) {
        if (projects[i].sourceThumbUrl) return projects[i].sourceThumbUrl;
      }
      return PREVIEW_FALLBACK;
    }());

    // Where the sample caption is up to. Parked at 1.2s when idle, which lands
    // mid-first-line so the preview shows a caption rather than an empty frame.
    var previewAt = (UI.pvPlaying || UI.pvTime) ? UI.pvTime : 1.2;

    var capTop = tpl.captionPosition === 'top' ? 22 : tpl.captionPosition === 'bottom' ? 80 : 50;
    // The editor's caption overlay, placed the way the renderer places it:
    // MarginV measured from whichever edge the alignment anchors to, and ignored
    // entirely for a middle alignment. The overlay is centred on its own box, so
    // the translate has to change with the anchor or it drifts by half its
    // height.
    var edCapVertical = (function () {
      var pos = tpl.captionPosition;
      if (pos !== 'top' && pos !== 'bottom') return 'top: ' + capTop + '%; translate: -50% -50%;';
      var pct = Math.max(2, Math.min(50, (Number(tpl.captionMarginV) || 0) / Math.max(1, Number(tpl.height || 1920)) * 100));
      return (pos === 'top' ? 'top: ' : 'bottom: ') + pct.toFixed(2) + '%; translate: -50% 0;';
    }());

    var job = UI.job;
    var tokenRate = Number((DATA.billing && DATA.billing.tokenRatePerMinute) || 1);

    // The connection the modal is showing, if any.
    var conn = UI.connProvider ? byKey[UI.connProvider] : null;

    // Everything actually in flight: lectures, extra-clip runs, re-renders and
    // uploads to a platform. Watching projects alone missed most of it.
    var jobsLive = [];
    projects.forEach(function (pr) {
      if (['queued', 'processing'].indexOf(pr.status) > -1) {
        jobsLive.push({ kind: 'project', title: projectTitle[pr.id], stage: pr.stage || pr.status, progress: Number(pr.progress || 0), etaSec: pr.etaSec, bytesDone: pr.bytesDone, bytesTotal: pr.bytesTotal, at: pr.startedAt || pr.submittedAt, project: pr });
      }
      if (pr.moreJob && ['queued', 'processing'].indexOf(pr.moreJob.status) > -1) {
        jobsLive.push({ kind: 'project', title: 'More clips · ' + projectTitle[pr.id], stage: pr.moreJob.stage || pr.moreJob.status, progress: Number(pr.moreJob.progress || 0), at: pr.moreJob.startedAt || pr.moreJob.createdAt });
      }
    });
    (DATA.rerenderJobs || []).forEach(function (j) {
      if (['queued', 'processing'].indexOf(j.status) > -1) {
        var c = clips.filter(function (x) { return x.id === j.clipId; })[0];
        jobsLive.push({ kind: 'render', title: 'Editing ' + ((c && c.title) || 'clip'), stage: j.stage || j.status, progress: Number(j.progress || 0), at: j.startedAt || j.createdAt });
      }
    });
    clips.forEach(function (c) {
      (c.targets || []).forEach(function (t) {
        if (['retrying', 'publishing', 'processing'].indexOf(t.status) > -1) {
          jobsLive.push({
            kind: 'publish', title: (c.title || 'Clip') + ' → ' + (PLATFORM_NAMES[t.provider] || t.provider),
            stage: t.stage || t.platformStatus || t.status,
            progress: isFinite(Number(t.progressPercent)) ? Number(t.progressPercent) : null,
            at: t.updatedAt,
          });
        }
      });
    });
    jobsLive.sort(function (a, b) { return Number(b.at || 0) - Number(a.at || 0); });

    // Binary units, matching what a download manager and the OS both report, so
    // the number does not disagree with the file on disk.
    function sizeLabel(bytes) {
      var n = Number(bytes);
      if (!isFinite(n) || n <= 0) return '';
      if (n < 1024) return n + ' B';
      if (n < 1048576) return Math.round(n / 1024) + ' KB';
      if (n < 1073741824) return Math.round(n / 1048576) + ' MB';
      return (n / 1073741824).toFixed(1) + ' GB';
    }
    // "142 MB of 380 MB" while the total is known, "142 MB" while it is not --
    // a server that sends no Content-Length is common and must not print "of 0".
    function transferLabel(done, total) {
      var a = sizeLabel(done);
      if (!a) return '';
      var b = sizeLabel(total);
      return b ? a + ' of ' + b : a;
    }

    function etaLabel(seconds) {
      if (seconds === null || seconds === undefined || !isFinite(seconds)) return '';
      var s = Math.max(0, Math.round(seconds));
      if (s < 45) return 'about a minute left';
      if (s < 3600) return Math.round(s / 60) + ' min left';
      var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      return m ? h + 'h ' + m + 'm left' : h + 'h left';
    }

    // The clips behind "Rendering clip 2 of 4", one line each.
    //
    // Nothing here is invented. Clips render strictly in order, so everything
    // before the current one is finished and everything after it has not
    // started; only the current clip's percentage is a measurement, and it comes
    // from ffmpeg. A clip that has not started shows no percentage rather than a
    // plausible-looking zero-to-something.
    //
    // currentClip/totalClips arrive as fields from a current worker, but the
    // deployed one only says so in its stage text — so that is read as a
    // fallback and the breakdown works before the box is rebuilt.
    var STAGE_CLIP = /\bclip\s+(\d+)\s+of\s+(\d+)\b/i;
    function clipBreakdown(pr, stage) {
      if (!pr) return [];
      var current = Number(pr.currentClip) || 0;
      var total = Number(pr.totalClips) || 0;
      if (!total) {
        var m = STAGE_CLIP.exec(String(stage || ''));
        if (m) { current = Number(m[1]); total = Number(m[2]); }
      }
      if (!total || total < 1) return [];
      var plan = Array.isArray(pr.clipPlan) ? pr.clipPlan : [];
      var rows = [];
      for (var i = 1; i <= Math.min(total, 40); i++) {
        var planned = plan[i - 1] || {};
        var done = i < current;
        var running = i === current;
        // Only the running clip has a measured percentage, and only from a
        // worker that sends one.
        var pct = done ? 100 : (running && pr.clipPercent !== null && pr.clipPercent !== undefined)
          ? Math.max(0, Math.min(100, Math.round(Number(pr.clipPercent)))) : null;
        rows.push({
          index: i,
          title: planned.title || ('Clip ' + i),
          state: done ? 'Done' : running ? 'Rendering' : 'Queued',
          percent: pct === null ? '' : pct + '%',
          // A queued clip's bar is empty, not full: width 0 with no percentage
          // reads as "not started", which is what it is.
          barStyle: 'height: 3px; border-radius: 3px; width: ' + (pct === null ? 0 : pct)
            + '%; background: ' + (done ? '#7FD1A6' : 'linear-gradient(90deg, #D9B478, #F0D6A6)') + ';',
          icon: done ? 'ph-fill ph-check-circle' : running ? 'ph ph-circle-notch' : 'ph ph-clock',
          iconStyle: 'font-size: 13px; color: ' + (done ? '#7FD1A6' : running ? '#F0D6A6' : '#4A4A52') + ';',
          done: done,
          running: running,
        });
      }
      return rows;
    }

    function liveRow(j) {
      var pct = (j.progress === null || !isFinite(j.progress)) ? null : Math.max(0, Math.min(100, Math.round(j.progress)));
      var eta = etaLabel(j.etaSec);
      // Only the import moves bytes, so this is absent for the rest of the
      // pipeline rather than showing a frozen figure from an earlier phase.
      var transfer = transferLabel(j.bytesDone, j.bytesTotal);
      // Stage, then size, then time remaining: what it is doing, how far in, how
      // much longer.
      var detail = j.stage + (transfer ? ' · ' + transfer : '') + (eta ? ' · ' + eta : '');
      var clips = clipBreakdown(j.project, j.stage);
      return {
        label: j.title,
        title: j.title,
        stage: j.stage,
        // One line per clip while a lecture renders, so "clip 2 of 4" can be
        // opened rather than only read.
        clips: clips,
        clipCount: clips.length,
        hasClips: clips.length > 0,
        clipsLabel: clips.length ? clips.filter(function (c) { return c.done; }).length + ' of ' + clips.length + ' done' : '',
        // Above this the list scrolls instead of pushing the page around.
        clipsScroll: clips.length > 6,
        percent: pct === null ? '' : pct + '%',
        eta: eta,
        transfer: transfer,
        // The dock binds text/textStyle; supplying only label left every row of
        // the floating bar unstyled and unreadable.
        text: j.title + ' · ' + detail + (pct === null ? '' : ' · ' + pct + '%'),
        textStyle: 'font-size: 11.5px; color: #BCBCC3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
        meta: detail,
        barStyle: 'height: 3px; border-radius: 3px; width: ' + (pct === null ? 100 : pct) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6);',
        icon: j.kind === 'publish' ? 'ph ph-paper-plane-tilt' : j.kind === 'render' ? 'ph ph-film-strip' : 'ph ph-circle-notch',
        iconStyle: 'font-size: 14px; color: #F0D6A6;' + (j.kind === 'project' ? ' animation: dcSpin 1.1s linear infinite;' : ''),
      };
    }

    var liveItems = jobsLive.slice(0, 4).map(liveRow);
    var liveAll = jobsLive.map(liveRow);

    // Anything that failed and needs a person. Nothing in the design surfaces
    // these on their own, so they lead the activity feed — a failed lecture or a
    // rejected upload going unmentioned is worse than any styling problem.
    var failures = [];
    projects.forEach(function (pr) {
      if (pr.status === 'failed' || pr.error) {
        failures.push({ text: projectTitle[pr.id] + ' needs attention', meta: shortError(pr.error || pr.stage), at: pr.completedAt || pr.submittedAt, screen: 'library' });
      }
      if (pr.moreJob && pr.moreJob.status === 'failed') {
        failures.push({ text: 'More clips failed · ' + projectTitle[pr.id], meta: shortError(pr.moreJob.error || pr.moreJob.stage), at: pr.moreJob.completedAt || pr.moreJob.createdAt, screen: 'library' });
      }
    });
    (DATA.rerenderJobs || []).forEach(function (j) {
      if (j.status !== 'failed') return;
      var c = clips.filter(function (x) { return x.id === j.clipId; })[0];
      failures.push({ text: 'Edit failed · ' + ((c && c.title) || 'Clip'), meta: shortError(j.error || j.stage), at: j.completedAt || j.createdAt, screen: 'queue' });
    });
    clips.forEach(function (c) {
      var bad = (c.targets || []).filter(function (t) { return t.status === 'failed'; });
      if (c.status !== 'publish_failed' && !bad.length) return;
      failures.push({ text: 'Publish failed · ' + (c.title || 'Clip'), meta: shortError((bad[0] && (bad[0].error || bad[0].stage)) || c.error), at: (bad[0] && bad[0].updatedAt) || c.postedAt, screen: 'schedule' });
    });
    failures.sort(function (a, b) { return Number(b.at || 0) - Number(a.at || 0); });

    var overdueRow = null;
    if (overdue.length) {
      overdueRow = {
        day: 'Overdue',
        countLabel: plural(overdue.length, 'post') + ' missed its slot',
        canAdd: false,
        items: overdue.map(scheduleItem),
      };
    }

    var seenAt = lastSeen();
    var unreadCount = failures.length + log.filter(function (e) {
      return Number(e.at || e.createdAt || 0) > seenAt;
    }).length;

    var weekAgo = Date.now() - 7 * DAY_MS;
    var postedThisWeek = clips.filter(function (c) { return c.postedAt && new Date(c.postedAt).getTime() >= weekAgo; });
    var allScores = clips.map(function (c) { return Number(c.score || 0); }).filter(Boolean).sort(function (a, b) { return a - b; });
    var medianScore = allScores.length ? allScores[Math.floor(allScores.length / 2)] : 0;
    var postTimes = DATA.postTimes || [];
    var todayCount = scheduled.filter(function (c) { return startOfDay(c.scheduledAt) === today; }).length;

    // Blockers name a real gap and send you to the screen that fixes it.
    var seenAt = lastSeen();
    var unreadCount = failures.length + log.filter(function (e) {
      return Number(e.at || e.createdAt || 0) > seenAt;
    }).length;

    var weekAgo = Date.now() - 7 * DAY_MS;
    var postedThisWeek = clips.filter(function (c) { return c.postedAt && new Date(c.postedAt).getTime() >= weekAgo; });
    var allScores = clips.map(function (c) { return Number(c.score || 0); }).filter(Boolean).sort(function (a, b) { return a - b; });
    var medianScore = allScores.length ? allScores[Math.floor(allScores.length / 2)] : 0;
    var postTimes = DATA.postTimes || [];
    var todayCount = scheduled.filter(function (c) { return startOfDay(c.scheduledAt) === today; }).length;

    // Blockers name a real gap and send you to the screen that fixes it.
    var blocker = '', blockerScreen = 'music';
    if (tracks.length === 0) { blocker = 'No nasheed uploaded — every clip mixes one in, so processing cannot finish without at least one.'; blockerScreen = 'music'; }
    else if (tracks.length < 2) { blocker = 'Only one nasheed uploaded — rotation needs two or more before automatic posting can run.'; blockerScreen = 'music'; }
    else if (connectedCount === 0) { blocker = 'No publishing account connected — approved clips will queue up with nowhere to go.'; blockerScreen = 'templates'; }

    var open = UI.railOpen;

    var vals = {
      // ── shell: rail ──
      railOpen: open,
      railStyle: 'align-self: stretch; height: 100%; min-height: 0; ' + (open ? 'overflow-y: auto; overflow-x: hidden; ' : 'overflow: visible; ') + 'display: flex; flex-direction: column; gap: 18px; width: ' + (open ? '228px' : '68px') + '; padding: 16px 12px; border-right: 1px solid #1E1E22; background: linear-gradient(180deg, #101013, #0B0B0D); transition: width .18s ease;',
      brandRowStyle: 'display: flex; align-items: center; gap: 10px; padding: ' + (open ? '4px 6px' : '4px 0') + '; ' + (open ? '' : 'flex-direction: column;'),
      brandTextStyle: open ? 'display: flex; flex-direction: column; line-height: 1.2; min-width: 0;' : 'display: none;',
      railToggleStyle: 'display: grid; place-items: center; width: 26px; height: 26px; flex: none; ' + (open ? 'margin-left: auto; ' : '') + 'border: 1px solid #26262A; border-radius: 7px; background: #121214; color: #8B8B93; cursor: pointer; transition: border-color .14s ease, color .14s ease;',
      railToggleIcon: open ? 'ph ph-caret-left' : 'ph ph-caret-right',
      railToggleTitle: open ? 'Collapse sidebar' : 'Expand sidebar',
      toggleRail: function (e) { stop(e); setUI({ railOpen: !UI.railOpen }); },

      navHome: [navItem('home', 'Home', 'ph-fill ph-house', '')],
      navProduce: [
        navItem('library', 'Lecture library', 'ph ph-film-script', ''),
        navItem('queue', 'Review queue', 'ph-fill ph-stack', needsCount || ''),
        navItem('schedule', 'Schedule', 'ph ph-calendar-dots', scheduled.length || ''),
      ],
      navSetup: [
        navItem('templates', 'Templates', 'ph ph-text-aa', ''),
        navItem('music', 'Nasheed library', 'ph ph-music-notes', ''),
        navItem('language', 'Arabic & terms', 'ph ph-translate', ''),
        navItem('performance', 'Performance', 'ph ph-chart-line-up', ''),
      ],

      workerCardStyle: 'margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: ' + (open ? '11px' : '9px 6px') + '; border: 1px solid #1E1E22; border-radius: 10px; background: #121214;',
      workerTextStyle: open ? 'white-space: nowrap;' : 'display: none;',
      workerMetaStyle: open ? 'margin-left: auto; color: #6E6E76; white-space: nowrap;' : 'display: none;',

      // ── shell: header ──
      pageTitle: TITLES[UI.screen] || 'Studio',
      subline: sublineFor(UI.screen, ctx),
      query: UI.query,
      setQuery: function (e) { UI.query = e.target.value; refresh(); },
      tokenBalance: current.unlimited ? '∞' : Number(current.remaining || 0).toLocaleString(),
      currentPlan: planLabel,
      goTokens: function (e) {
        stop(e);
        setUI({ screen: 'tokens', lastScreen: UI.screen === 'tokens' ? UI.lastScreen : UI.screen, menuOpen: false });
      },
      goBack: function (e) { stop(e); setUI({ screen: UI.lastScreen || 'home' }); },

      bellOpen: UI.bellOpen,
      toggleBell: function (e) { stop(e); setUI({ bellOpen: !UI.bellOpen, menuOpen: false }); },
      markRead: function (e) { stop(e); markSeen(); setUI({ bellOpen: false }); },
      // Drives the unread dot. Anything that failed always counts as unread.
      activityUnread: unreadCount,
      moreActivity: function (e) { stop(e); setUI({ activityAll: !UI.activityAll }); },
      activity: failures.map(function (f) {
        return {
          text: f.text,
          meta: f.meta + (f.at ? ' · ' + since(f.at) : ''),
          tag: 'Failed',
          icon: 'ph-fill ph-warning-circle',
          rowStyle: 'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-bottom: 1px solid #1A1A1E; cursor: pointer; background: rgba(227,146,140,.07);',
          iconStyle: 'font-size: 15px; flex: none; margin-top: 1px; color: #E3928C',
          tagStyle: 'margin-left: auto; flex: none; padding: 2px 7px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: rgba(227,146,140,.16); color: #E3928C;',
          open: function (e) { stop(e); setUI({ screen: f.screen, bellOpen: false }); },
        };
      }).concat((UI.activityAll ? log : log.slice(0, 6)).map(function (entry) {
        var urgent = entry.level === 'error' || entry.level === 'warn';
        var color = entry.level === 'error' ? '#E3928C' : entry.level === 'warn' ? '#E6B770' : '#7FD1A6';
        return {
          text: entry.message || entry.text || '',
          meta: since(entry.at || entry.createdAt),
          tag: entry.level === 'error' ? 'Issue' : entry.level === 'warn' ? 'Check' : '',
          icon: entry.level === 'error' ? 'ph-fill ph-warning-circle' : entry.level === 'warn' ? 'ph-fill ph-warning' : 'ph-fill ph-check-circle',
          rowStyle: 'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-bottom: 1px solid #1A1A1E; transition: background .14s ease; background: ' + (urgent ? 'rgba(217,180,120,.045)' : 'transparent'),
          iconStyle: 'font-size: 15px; flex: none; margin-top: 1px; color: ' + color,
          tagStyle: 'margin-left: auto; flex: none; padding: 2px 7px; border-radius: 20px; font-size: 9.5px; font-weight: 600; letter-spacing: .02em; background: #1D1D21; color: #8B8B93;',
          open: function () {},
        };
      })),

      menuOpen: UI.menuOpen,
      caretIcon: UI.menuOpen ? 'ph ph-caret-up' : 'ph ph-caret-down',
      toggleMenu: function (e) { stop(e); setUI({ menuOpen: !UI.menuOpen, bellOpen: false }); },
      accountEmail: (DATA.user && DATA.user.email) || '',

      // ── screen flags ──
      isHome: UI.screen === 'home',
      isQueue: UI.screen === 'queue',
      isLibrary: UI.screen === 'library',
      isDetail: UI.screen === 'detail',
      isSchedule: UI.screen === 'schedule',
      isTemplates: UI.screen === 'templates',
      isMusic: UI.screen === 'music',
      isLang: UI.screen === 'language',
      isPerf: UI.screen === 'performance',
      isEditor: UI.screen === 'editor',
      isTokens: UI.screen === 'tokens',
      isEmptyStudio: projects.length === 0,

      // ── Home ──
      needsCount: needsCount,
      goHome: function (e) { stop(e); setUI({ screen: 'home' }); },
      goQueue: function (e) { stop(e); setUI({ screen: 'queue' }); },
      goLibrary: function (e) { stop(e); setUI({ screen: 'library' }); },
      goSchedule: function (e) { stop(e); setUI({ screen: 'schedule' }); },

      librarySummary: plural(projects.length, 'lecture') + ' · ' + plural(clips.length, 'clip'),

      lectures: projects.slice(0, 4).map(function (p) {
        // Through lecState, not a second opinion. Home and the Lecture library
        // read the same records; when this had its own test they disagreed --
        // PROCESSING here, Ready there, on one page load.
        var processing = lecState(p) === 'processing';
        return {
          title: p.title || p.sourceTitle || 'Untitled lecture',
          meta: humanDuration(p.durationSec || p.sourceDurationSec) + ' · ' + since(p.submittedAt),
          clips: plural(p.clipCount || 0, 'clip'),
          chip: processing ? 'Processing' : 'Ready',
          chipStyle: 'padding: 2px 7px; border-radius: 20px; font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid ' +
            (processing ? 'rgba(230,183,112,.4); background: rgba(10,10,12,.8); color: #E6B770;' : 'rgba(127,209,166,.35); background: rgba(10,10,12,.8); color: #7FD1A6;'),
          thumbStyle: 'position: relative; aspect-ratio: 16 / 10; background: ' + thumb(p.sourceThumbUrl) + ';',
          open: function (e) { stop(e); setUI({ screen: 'detail', openProject: p.id, menuOpen: false, bellOpen: false }); },
        };
      }),

      reviewPreview: pending.slice(0, 3).map(function (c) {
        return {
          caption: c.title || '',
          score: c.score || '',
          duration: secsToClock((c.durationMs || 0) / 1000),
          flagText: c.reviewRequired ? ' · quote review' : '',
          thumbStyle: 'width: 26px; height: 38px; flex: none; border-radius: 5px; border: 1px solid #26262A; background: ' + thumb(c.thumbUrl) + ';',
          approve: function (e) { stop(e); global.StudioAdapter.onApprove(c.id); },
        };
      }),

      slots: scheduled.slice(0, 3).map(function (c, i) {
        var target = (c.targets && c.targets[0]) || {};
        var platform = target.platform || '';
        return {
          time: timeOf(c.scheduledAt),
          title: c.title || '',
          dest: PLATFORM_NAMES[platform] || 'Not connected',
          icon: platform === 'youtube' ? 'ph ph-youtube-logo' : platform === 'instagram' ? 'ph ph-instagram-logo' : platform === 'tiktok' ? 'ph ph-tiktok-logo' : 'ph ph-share-network',
          next: i === 0,
          thumbStyle: 'width: 24px; height: 34px; flex: none; border-radius: 5px; border: 1px solid #26262A; background: ' + thumb(c.thumbUrl) + ';',
          timeStyle: 'font-size: 11.5px; font-weight: 600; letter-spacing: .02em; width: 38px; flex: none; color: ' + (i === 0 ? '#F0D6A6' : '#8B8B93'),
        };
      }),

      // The collage on Home. Positions, rotations and drift timings are the
      // design's own; only the clips filling them are real.
      floaters: FLOAT_POS.map(function (p, i) {
        var c = recent4[i];
        var state = !c ? null : c.postedAt || c.approvedBy || c.scheduledAt ? 'approved' : null;
        return {
          empty: !c,
          has: Boolean(c),
          score: c ? c.score || '' : '',
          stateLabel: state === 'approved' ? 'Approved' : 'In review',
          stateStyle: 'position: absolute; bottom: 6px; left: 6px; display: flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 20px; font-size: 8.5px; font-weight: 700; border: 1px solid ' +
            (state === 'approved' ? 'rgba(127,209,166,.4); background: rgba(10,10,12,.82); color: #7FD1A6;' : 'rgba(217,180,120,.36); background: rgba(10,10,12,.82); color: #F0D6A6;'),
          style: 'position: absolute; top: ' + p.top + '; left: ' + p.left + '; width: ' + p.w + '; aspect-ratio: 9 / 16; border-radius: 11px; overflow: hidden; rotate: ' + p.rot + '; animation: dcFloat ' + p.dur + ' ease-in-out ' + p.delay + ' infinite;' +
            (c ? ' border: 1px solid #26262A; background: ' + thumb(c.thumbUrl) + '; box-shadow: 0 18px 40px rgba(0,0,0,.5);'
               : ' border: 1px dashed #2C2C32; background: rgba(18,18,20,.5); display: grid; place-items: center;'),
        };
      }),

      // ── Review queue ──
      qTabs: [
        { key: 'review', label: 'Awaiting decision', n: pending.length },
        { key: 'flagged', label: 'Quote review', n: gate ? clips.filter(function (c) { return c.reviewRequired && decision(c) === null; }).length : 0 },
        { key: 'approved', label: 'Approved', n: clips.filter(function (c) { return decision(c) === 'approved'; }).length },
        { key: 'all', label: 'All clips', n: clips.length },
      ].map(function (t) {
        return {
          label: t.label, count: t.n,
          style: tabStyle(UI.filter === t.key),
          countStyle: pillStyle(UI.filter === t.key),
          select: function (e) { stop(e); setUI({ filter: t.key, deckIdx: 0 }); },
        };
      }),

      queueClips: queueClips,
      queueEmptyStream: queueClips.length === 0,

      deckMode: UI.deckMode,
      gridMode: !UI.deckMode,
      gridBtnStyle: toggleBtnStyle(!UI.deckMode),
      deckBtnStyle: toggleBtnStyle(UI.deckMode),
      setGrid: function (e) { stop(e); setUI({ deckMode: false }); },
      setDeck: function (e) { stop(e); setUI({ deckMode: true, deckIdx: 0 }); },
      deckHas: queueClips.length > 0,
      deckPos: queueClips.length
        ? Math.min(UI.deckIdx + 1, queueClips.length) + ' of ' + queueClips.length
        : '0 of 0',
      deckClip: deckClip || { caption: '', score: '', duration: '', lecTitle: '', thumbStyle: 'display:none;', flagged: false, style: '' },
      deckApprove: function (e) { stop(e); if (deckClip) deckClip.approve(e); },
      deckReject: function (e) { stop(e); if (deckClip) deckClip.reject(e); },
      deckEdit: function (e) { stop(e); if (deckClip) deckClip.edit(e); },
      deckSkip: function (e) { stop(e); setUI({ deckIdx: Math.min(UI.deckIdx + 1, Math.max(0, queueClips.length - 1)) }); },
      deckBack: function (e) { stop(e); setUI({ deckIdx: Math.max(0, UI.deckIdx - 1) }); },

      // Pipeline rail, driven by whichever lecture is actually being worked on.
      progress: Math.round(active ? active.progress || 0 : 0),
      stageLabel: (STAGES[activeStage].label.split(' ')[0] || '').toLowerCase(),
      stages: STAGES.map(function (s, i) {
        var done = active ? i < activeStage : false;
        var running = Boolean(active) && i === activeStage;
        return {
          label: s.label,
          meta: running ? (active.stage || 'running') : done ? 'done' : 'queued',
          icon: done ? 'ph-fill ph-check-circle' : running ? 'ph ph-circle-notch' : 'ph ph-circle-dashed',
          iconStyle: 'font-size: 14px; color: ' + (done ? '#7FD1A6' : running ? '#F0D6A6' : '#4A4A52') + (running ? '; animation: dcSpin 1.1s linear infinite' : ''),
          labelStyle: 'color: ' + (done || running ? '#E9E9ED' : '#6E6E76'),
        };
      }),

      // Readiness checks, each reading something the account actually has.
      checks: [
        { label: 'Nasheeds for rotation', value: tracks.length + ' uploaded', ok: tracks.length >= 2 },
        { label: 'Active Clip Style', value: (DATA.selectedTemplate && DATA.selectedTemplate.name) || 'None selected', ok: Boolean(DATA.selectedTemplate) },
        { label: 'Publishing destinations', value: activeCount + ' of ' + connectedCount + ' connected are on', ok: activeCount > 0 },
        { label: 'Quote review gate', value: gate ? 'On' : 'Off', ok: gate },
      ].map(function (c) {
        return {
          label: c.label, value: c.value,
          icon: c.ok ? 'ph-fill ph-check-circle' : 'ph-fill ph-warning-circle',
          iconStyle: 'font-size: 14px; color: ' + (c.ok ? '#7FD1A6' : '#F0D6A6'),
        };
      }),

      blockersOn: Boolean(blocker) && !UI.blockerDismissed,
      blockerText: blocker || '',
      resolveBlocker: function (e) { stop(e); setUI({ blockerDismissed: true, screen: blockerScreen }); },
      dismissBlocker: function (e) { stop(e); setUI({ blockerDismissed: true }); },

      // ── Lecture library ──
      libTabs: [
        { key: 'all', label: 'All' },
        { key: 'ready', label: 'Ready' },
        { key: 'processing', label: 'Processing' },
        { key: 'archived', label: 'Archived' },
      ].map(function (t) {
        return {
          label: t.label,
          count: t.key === 'all' ? projects.length : projects.filter(function (p) { return lecState(p) === t.key; }).length,
          style: tabStyle(UI.libFilter === t.key),
          countStyle: pillStyle(UI.libFilter === t.key),
          select: function (e) { stop(e); setUI({ libFilter: t.key }); },
        };
      }),
      libraryItems: libraryItems,
      libEmpty: libraryItems.length === 0,

      // ── Lecture detail ──
      detailTitle: detail ? projectTitle[detail.id] : '',
      detailMeta: detail ? humanDuration(detail.durationSec || detail.sourceDurationSec) + ' source · ' + since(detail.submittedAt) : '',
      detailThumbStyle: 'width: 168px; flex: none; aspect-ratio: 16 / 9; border-radius: 10px; border: 1px solid #26262A; background: ' + thumb(detail && detail.sourceThumbUrl) + ';',
      detailCount: plural(detailClips.length, 'clip'),
      detailClips: detailClips,
      detailHint: detail && lecState(detail) === 'processing'
        ? 'Still processing — clips appear here as the worker finishes them.'
        : 'Every clip cut from this lecture. Approving one queues it for the next open slot.',
      detailFromLibrary: true,
      detailBackLabel: 'Lecture library',
      closeDetail: function (e) { stop(e); setUI({ screen: 'library' }); },
      openSource: function (e) {
        stop(e);
        // Only follow a source URL the record actually carries.
        if (detail && detail.url) global.open(detail.url, '_blank', 'noopener');
      },
      bulkLabel: 'Approve all remaining',
      bulkIcon: 'ph ph-check',
      bulkAction: function (e) {
        stop(e);
        detailClips.forEach(function (c) { if (c.stateChip === '') c.approve(e); });
      },

      // ── Schedule ──
      // Overdue first, so a stranded post is the first thing seen rather than
      // something no screen renders at all.
      scheduleDays: (overdueRow ? [overdueRow] : []).concat(scheduleDays),

      // ── Clip editor ──
      // Split by what the server can actually keep. Caption text, title,
      // description, hashtags and trim are per-clip (agent.updateClip accepts
      // exactly those). Everything visual lives on the selected template and
      // propagates to every unposted clip on save, which the screen says out loud
      // rather than pretending the change is local to one clip.
      //
      // Grain, warmth and crop zoom used to be dead here and in the legacy
      // editor: sanitiseTemplate() builds its output from a whitelist and no
      // field held them, so every value was discarded on save. They now have
      // schema fields and worker filters, so the sliders do something.
      isCaptions: UI.edTab === 'captions',
      isFraming: UI.edTab === 'framing',
      isAudio: UI.edTab === 'audio',
      isLook: UI.edTab === 'look',
      isExport: UI.edTab === 'export',
      edTools: [
        { key: 'captions', label: 'Captions', icon: 'ph ph-closed-captioning' },
        { key: 'framing', label: 'Framing', icon: 'ph ph-crop' },
        { key: 'audio', label: 'Audio', icon: 'ph ph-waveform' },
        { key: 'look', label: 'Look', icon: 'ph ph-sun-dim' },
        { key: 'export', label: 'Export', icon: 'ph ph-export' },
      ].map(function (t) {
        var on = UI.edTab === t.key;
        // Icon stacked over label, each tab flexing to a fifth of the panel —
        // five of them do not fit side by side any other way.
        return {
          label: t.label, icon: t.icon,
          style: 'display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; font-family: inherit; font-size: 10px; font-weight: 600; cursor: pointer; flex: 1; transition: background .14s ease, color .14s ease; border: 1px solid ' +
            (on ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;' : 'transparent; background: #17171A; color: #8B8B93;'),
          select: function (e) { stop(e); setUI({ edTab: t.key }); },
        };
      }),

      edTitle: edClip ? edClip.title || 'Untitled clip' : '',
      edLecture: edClip ? projectTitle[edClip.projectId] || '' : '',
      edTimeLabel: edClip ? secsToClock((edClip.durationMs || 0) / 1000) : '',
      // This element IS the preview frame and establishes the containing block
      // for every overlay below it. Making it `position: absolute; inset: 0`
      // instead lets the overlays resolve against <main> and cover the tool rail.
      edThumbStyle: 'position: relative; width: 100%; max-width: 268px; aspect-ratio: 9 / 16; border-radius: 13px; overflow: hidden; border: 1px solid #26262A; background: ' +
        thumb(edClip && edClip.thumbUrl) + '; box-shadow: 0 26px 60px rgba(0,0,0,.5);',
      closeEditor: function (e) { stop(e); setUI({ screen: 'queue', edClipId: null }); },

      // The SELECTED CAPTION box edits the chosen block, not the whole clip.
      // It was bound to the entire transcript and stayed empty because nothing
      // ever selected anything.
      edCapText: selectedBlock
        ? (UI.edBlockDraft !== null && UI.edBlockDraft !== undefined ? UI.edBlockDraft : selectedBlock.text)
        : '',
      setCapText: function (e) { UI.edBlockDraft = e.target.value; UI.edDirty = true; refresh(); },
      edSelText: selectedBlock ? selectedBlock.text : '',
      edSelRange: selectedBlock ? selectedBlock.time : '',
      edCapBlocks: edCaptionBlocks,
      // Overlays sit inside the preview frame, positioned as fractions of it.
      // Positioned from captionMarginV against the anchoring edge, exactly as
      // the Templates preview and the renderer do. It used to sit on capTop
      // alone, so the box only ever showed three positions and a drag or the
      // vertical slider appeared to do nothing between them.
      edCapOverlayStyle: 'position: absolute; z-index: 8; width: 80%; left: 50%; ' + edCapVertical + ' text-align: center; padding: 7px 9px; border-radius: 6px; background: rgba(10,10,12,.5); color: ' +
        (tpl.captionPrimary || '#F0D6A6') + '; font-family: Outfit, Inter, sans-serif; font-weight: 600; line-height: 1.2; font-size: ' +
        Math.max(8, Math.round(Number(tpl.captionFontSize || 96) / 8)) + 'px;'
        + (tpl.captionUppercase ? ' text-transform: uppercase;' : '')
        + ' font-family: ' + webFontFor(tpl.captionFont) + ';',
      edCapHandle: 'position: absolute; inset: -5px; border: 1px dashed rgba(240,214,166,.7); border-radius: 8px; pointer-events: none;',
      dragEdCap: dragCaptionFrom,

      // captionFontSize, range 24-140 in the schema.
      edSize: Number(tpl.captionFontSize) || 96,
      edSizeLabel: (Number(tpl.captionFontSize) || 96) + ' px',
      setSize: function (e) { saveStyle({ captionFontSize: Number(e.target.value) }); },
      // captionMarginV, range 20-800.
      edCapPosY: Number(tpl.captionMarginV) || 180,
      setPosY: function (e) { saveStyle({ captionMarginV: Number(e.target.value) }); },
      edPosLabelLive: (Number(tpl.captionMarginV) || 180) + ' px',
      edUpperTrack: switchTrack(Boolean(tpl.captionUppercase)),
      edUpperKnob: switchKnob(Boolean(tpl.captionUppercase)),
      toggleUpper: function (e) { stop(e); saveStyle({ captionUppercase: !tpl.captionUppercase }); },
      // Every family here is installed in the worker image. Inter was offered
      // and is not, so any clip set to it rendered in whatever fontconfig
      // substituted instead.
      // ── Highlighted word ──
      // The renderer has always drawn the live word in its own colour, face,
      // slant and glow. Nothing in the new dashboard could set any of it, and
      // until the schema was fixed nothing could even store it, so every clip
      // used the worker's built-in default. The design draws no rows for these,
      // so the host adds them.
      hlColour: tpl.captionHighlight || '#D9B478',
      hlColourLabel: String(tpl.captionHighlight || '#D9B478').toUpperCase(),
      setHlColour: function (e) { saveStyle({ captionHighlight: String(e.target.value || '').toUpperCase() }); },
      hlFonts: CAPTION_FONTS.map(function (f) {
        return {
          label: f.label,
          name: f.name,
          on: tpl.captionHighlightFont === f.name,
          web: f.web,
          select: function (e) { stop(e); saveStyle({ captionHighlightFont: f.name }); },
        };
      }),
      hlItalic: Boolean(tpl.captionHighlightItalic),
      toggleHlItalic: function (e) { stop(e); saveStyle({ captionHighlightItalic: !tpl.captionHighlightItalic }); },
      hlGlow: Math.max(0, Math.min(30, Number(tpl.captionHighlightGlow) || 0)),
      hlGlowLabel: (Math.max(0, Math.min(30, Number(tpl.captionHighlightGlow) || 0)) || 'None') + (Number(tpl.captionHighlightGlow) ? '' : ''),
      setHlGlow: function (e) { saveStyle({ captionHighlightGlow: Number(e.target.value) }); },
      // Matching the caption's own font is a legitimate choice, so it is offered
      // rather than being something to achieve by picking the same name twice.
      hlSameAsCaption: tpl.captionHighlightFont === tpl.captionFont,
      matchHlFont: function (e) { stop(e); saveStyle({ captionHighlightFont: tpl.captionFont }); },

      // ── Caption styling the renderer already does ──
      // Outline, shadow, the background box, line height and words per line are
      // all read by clip_worker.py and were all unreachable: seven fields the
      // render honoured with nothing to set them.
      capOutline: tpl.captionOutline || '#09090A',
      capOutlineLabel: String(tpl.captionOutline || '#09090A').toUpperCase(),
      setCapOutline: function (e) { saveStyle({ captionOutline: String(e.target.value || '').toUpperCase() }); },
      capOutlineWidth: Math.max(0, Math.min(14, Number(tpl.captionOutlineWidth) || 0)),
      capOutlineWidthLabel: (Number(tpl.captionOutlineWidth) || 0) ? Number(tpl.captionOutlineWidth) + '' : 'None',
      setCapOutlineWidth: function (e) { saveStyle({ captionOutlineWidth: Number(e.target.value) }); },
      capShadow: Math.max(0, Math.min(8, Number(tpl.captionShadow) || 0)),
      capShadowLabel: (Number(tpl.captionShadow) || 0) ? Number(tpl.captionShadow) + '' : 'None',
      setCapShadow: function (e) { saveStyle({ captionShadow: Number(e.target.value) }); },
      capBg: tpl.captionBackground || '#000000',
      capBgLabel: String(tpl.captionBackground || '#000000').toUpperCase(),
      setCapBg: function (e) { saveStyle({ captionBackground: String(e.target.value || '').toUpperCase() }); },
      capBgOpacity: Math.max(0, Math.min(100, Number(tpl.captionBackgroundOpacity) || 0)),
      capBgOpacityLabel: (Number(tpl.captionBackgroundOpacity) || 0) ? Math.round(Number(tpl.captionBackgroundOpacity)) + '%' : 'Off',
      setCapBgOpacity: function (e) { saveStyle({ captionBackgroundOpacity: Number(e.target.value) }); },
      capLineHeight: Math.round((Number(tpl.captionLineHeight) || 0.88) * 100),
      capLineHeightLabel: Math.round((Number(tpl.captionLineHeight) || 0.88) * 100) + '%',
      setCapLineHeight: function (e) { saveStyle({ captionLineHeight: Number(e.target.value) / 100 }); },
      capMaxWords: Math.max(1, Math.min(12, Number(tpl.captionMaxWords) || 4)),
      capMaxWordsLabel: (Number(tpl.captionMaxWords) || 4) + ' per line',
      setCapMaxWords: function (e) { saveStyle({ captionMaxWords: Number(e.target.value) }); },

      // ── Caption animation ──
      // The renderer has always popped the live word by 8% over 120ms with both
      // numbers baked in, so it could be neither tuned nor switched off. A fade
      // is new, and applies per caption event rather than per word so a stacked
      // line does not flicker as the highlight moves along it.
      animPop: Math.max(60, Math.min(140, Number(tpl.captionPopScale) || 100)),
      // Below 100 the word grows in rather than overshooting, which the
      // renderer already handles -- the scale simply starts on the other side.
      animPopLabel: (function () {
        var v = Math.round(Number(tpl.captionPopScale) || 100);
        if (v === 100) return 'Off';
        return v > 100 ? '+' + (v - 100) + '% pop' : (100 - v) + '% grow-in';
      }()),
      setAnimPop: function (e) { saveStyle({ captionPopScale: Number(e.target.value) }); },
      animPopMs: Math.max(0, Math.min(400, Number(tpl.captionPopMs) || 0)),
      animPopMsLabel: (Number(tpl.captionPopMs) || 0) ? Math.round(Number(tpl.captionPopMs)) + ' ms' : 'Off',
      setAnimPopMs: function (e) { saveStyle({ captionPopMs: Number(e.target.value) }); },
      animFade: Math.max(0, Math.min(600, Number(tpl.captionFadeMs) || 0)),
      animFadeLabel: (Number(tpl.captionFadeMs) || 0) ? Math.round(Number(tpl.captionFadeMs)) + ' ms' : 'None',
      setAnimFade: function (e) { saveStyle({ captionFadeMs: Number(e.target.value) }); },
      // Off when either number is zeroed, matching what the renderer checks.
      animPopOn: (Number(tpl.captionPopScale) || 100) !== 100 && (Number(tpl.captionPopMs) || 0) > 0,

      // The caption's own face and size, so the shared style can be set from the
      // Templates screen instead of only from inside a clip.
      capFonts: CAPTION_FONTS.map(function (f) {
        return { label: f.label, name: f.name, web: f.web, on: tpl.captionFont === f.name,
          select: function (e) { stop(e); saveStyle({ captionFont: f.name }); } };
      }),
      capSize: Math.max(24, Math.min(140, Number(tpl.captionFontSize) || 96)),
      capSizeLabel: (Number(tpl.captionFontSize) || 96) + ' px',
      setCapSize: function (e) { saveStyle({ captionFontSize: Number(e.target.value) }); },
      capUpper: Boolean(tpl.captionUppercase),
      toggleCapUpper: function (e) { stop(e); saveStyle({ captionUppercase: !tpl.captionUppercase }); },

      edFonts: CAPTION_FONTS.map(function (f) {
        return {
          label: f.label,
          style: tabStyle(tpl.captionFont === f.name) + ' font-family: ' + f.web + ';',
          select: function (e) { stop(e); saveStyle({ captionFont: f.name }); },
        };
      }),

      // fitMode, and the one framing toggle the schema keeps.
      edCrops: ENUMS.fitMode.map(function (m) {
        var labels = { contain: 'Fit', blur: 'Blur', crop: 'Fill' };
        return { label: labels[m], style: tabStyle(tpl.fitMode === m), select: function (e) { stop(e); saveStyle({ fitMode: m }); } };
      }),
      edFaceTrack: switchTrack(Boolean(tpl.smartFramingEnabled)),
      edFaceKnob: switchKnob(Boolean(tpl.smartFramingEnabled)),
      toggleFace: function (e) { stop(e); saveStyle({ smartFramingEnabled: !tpl.smartFramingEnabled }); },

      // vignette, range 0-1 in the schema, shown as a percentage.
      edVignette: Math.round((Number(tpl.vignette) || 0) * 100),
      edVignetteLabel: Math.round((Number(tpl.vignette) || 0) * 100) + '%',
      setVignette: function (e) { saveStyle({ vignette: Number(e.target.value) / 100 }); },
      // grain 0-100, warm -100..100, zoom 0.75-2.5 in the schema.
      edGrain: Number(tpl.grain) || 0,
      edGrainLabel: (Number(tpl.grain) || 0) + '%',
      setGrain: function (e) { saveStyle({ grain: Number(e.target.value) }); },
      edWarm: Number(tpl.warm) || 0,
      edWarmLabel: (Number(tpl.warm) > 0 ? '+' : '') + (Number(tpl.warm) || 0),
      setWarm: function (e) { saveStyle({ warm: Number(e.target.value) }); },
      edZoom: Math.round((Number(tpl.smartFramingZoom) || 1) * 100),
      edZoomLabel: Math.round((Number(tpl.smartFramingZoom) || 1) * 100) + '%',
      setZoom: function (e) { saveStyle({ smartFramingZoom: Number(e.target.value) / 100 }); },

      edWmTrack: sliderTrack(),
      edWmKnob: sliderKnob(Number(tpl.watermarkOpacity) > 0),
      edWmNote: tpl.watermark ? tpl.watermark + ' at ' + (Number(tpl.watermarkOpacity) || 0) + '%' : 'No watermark',
      toggleWatermark: function (e) { stop(e); saveStyle({ watermarkOpacity: Number(tpl.watermarkOpacity) > 0 ? 0 : 100 }); },
      notPro: false,

      // Alignment guides only appear while dragging, as in the design.
      edGuideV: 'position: absolute; top: 0; bottom: 0; width: 1px; z-index: 6; pointer-events: none; left: 50%; display: none; background: rgba(240,214,166,.6);',
      edGuideH: 'position: absolute; left: 0; right: 0; height: 1px; z-index: 6; pointer-events: none; top: ' + capTop + '%; display: none; background: rgba(240,214,166,.6);',
      edSafeBtnStyle: toggleBtnStyle(UI.edSafe),
      toggleSafe: function (e) { stop(e); setUI({ edSafe: !UI.edSafe }); },
      edMarkStyle: 'position: absolute; z-index: 8; right: 11px; ' +
        (String(tpl.watermarkPosition).indexOf('top') === 0 ? 'top: 11px;' : 'bottom: 42px;') +
        ' font-family: Outfit, Inter, sans-serif; font-size: 8.5px; font-weight: 700; letter-spacing: .12em; color: ' +
        (tpl.watermarkColor || '#F0D6A6') + '; display: ' + (Number(tpl.watermarkOpacity) > 0 ? 'block' : 'none') + ';',
      edPlayStyle: 'display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; border: 1px solid #26262A; background: #17171A; color: #F0D6A6; cursor: pointer;',
      edPlayHeadStyle: 'position: absolute; top: 0; bottom: 0; left: ' + (UI.edPlayhead * 100).toFixed(2) + '%; width: 2px; background: #F0D6A6;',
      edProgressStyle: 'height: 3px; border-radius: 3px; width: ' + (UI.edPlayhead * 100).toFixed(2) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6);',
      edProgressLabel: edClip ? secsToClock((edClip.durationMs || 0) / 1000 * UI.edPlayhead) : '0:00',
      edSiblings: edSiblingCount
        ? edSiblingCount + ' other clip' + (edSiblingCount === 1 ? '' : 's') + ' from this lecture'
        : 'The only clip from this lecture',
      // How many other clips from the same lecture this clip's look could be
      // applied to. Drives the second save button, which the design does not
      // draw, so the host adds it.
      edLectureOthers: edClip
        ? clips.filter(function (c) {
          return c.projectId === edClip.projectId && c.id !== edClip.id && !c.variantOf && c.status !== 'posted';
        }).length
        : 0,

      edDirtyLabel: UI.edDirty ? 'Unsaved changes' : 'All changes saved',
      edDirtyDot: 'width: 7px; height: 7px; border-radius: 50%; background: ' + (UI.edDirty ? '#E6B770' : '#7FD1A6') + ';',
      edSaving: UI.edSaving,
      edSaveIcon: UI.edSaving ? 'ph ph-circle-notch' : 'ph ph-floppy-disk',
      edSaveIconStyle: 'font-size: 15px;' + (UI.edSaving ? ' animation: dcSpin 1.1s linear infinite;' : ''),
      edSaveLabel: UI.edSaving ? 'Saving…' : 'Save clip',
      saveEdit: function (e) {
        stop(e);
        if (!edClip || UI.edSaving) return;
        setUI({ edSaving: true });
        // Everything changed here belongs to THIS clip. Saving used to write the
        // shared style, which is why editing one clip changed every clip in the
        // lecture. To apply a look everywhere, edit it on the Templates screen.
        // Flush the debounce first so a change made in the last half-second is
        // not dropped by the save that was meant to keep it.
        if (UI.edStyleTimer) { global.clearTimeout(UI.edStyleTimer); UI.edStyleTimer = null; }
        var pendingStyle = UI.edStyleDraft; UI.edStyleDraft = null;
        if (pendingStyle && Object.keys(pendingStyle).length) {
          global.StudioAdapter.onClipStyle(edClip.id, pendingStyle);
        }
        // Rebuild the transcript from the blocks, with the edited one swapped in.
        var text = edCaptionBlocks.map(function (b, i) {
          return (i === UI.edBlock && UI.edBlockDraft !== null && UI.edBlockDraft !== undefined)
            ? UI.edBlockDraft : b.text;
        }).join(' ').trim();
        global.StudioAdapter.onSaveClip(edClip.id, { transcript: text || edClip.transcript });
      },

      // ── Source range panel ──
      // Opens after /api/source-info resolves a pasted link, so the range and the
      // token estimate are based on the real source rather than a guess. The
      // chosen range becomes sourceStartSeconds/sourceEndSeconds on /api/videos.
      jobOpen: Boolean(job),
      jobSourceLabel: job ? job.title : '',
      // The design baked a marketing image into this element's style, so every
      // lecture was previewed with the same picture — and the URL it used was
      // repo-relative, so it 404'd and showed an empty box. sourceInfo already
      // returns the video's own thumbnail; this puts it on screen.
      // Two layers, best first: YouTube only generates maxresdefault for some
      // uploads and returns a 404 page for the rest, which rendered as an empty
      // black box. A failed background layer is simply skipped, so hqdefault --
      // which always exists -- shows through underneath.
      jobPosterStyle: 'position: relative; aspect-ratio: 16 / 9; border-radius: 11px; overflow: hidden; border: 1px solid #26262A; background-color: #17171A;'
        + (job && job.thumbnail ? ' background-image: ' + posterLayers(job) + '; background-size: cover; background-position: center; background-repeat: no-repeat;' : ''),

      // ── The range handles ──
      // The design placed one input at top:2px and the other at bottom:2px, so
      // it read as two separate sliders rather than one range. Both sit on the
      // same track now. The input ignores the pointer so the upper one cannot
      // swallow clicks meant for the lower handle; only the thumbs are grabbable
      // (see the dc-range rules in index.html).
      jobRangeStartStyle: RANGE_INPUT_STYLE + ' accent-color: #D9B478;',
      jobRangeEndStyle: RANGE_INPUT_STYLE + ' accent-color: #F0D6A6;',
      // The design's two inputs are min=0 max=100 -- a percentage of the lecture,
      // not seconds. Feeding them seconds meant the handles could only ever
      // address the first 100 seconds of a source: on an 87-minute talk the
      // whole slider covered under two minutes, which is what "the slider is
      // broken" looked like. Both directions convert.
      jobStart: job && job.durationKnown ? (job.start / job.durationSec) * 100 : 0,
      jobEnd: job && job.durationKnown ? (job.end / job.durationSec) * 100 : 100,
      setJobStart: function (e) {
        if (!UI.job || !UI.job.durationKnown) return;
        var seconds = (Number(e.target.value) / 100) * UI.job.durationSec;
        // Keep at least the 30s the server demands between the two handles.
        UI.job.start = Math.max(0, Math.min(seconds, (UI.job.end || 0) - 30));
        refresh();
      },
      setJobEnd: function (e) {
        if (!UI.job || !UI.job.durationKnown) return;
        var seconds = (Number(e.target.value) / 100) * UI.job.durationSec;
        UI.job.end = Math.min(UI.job.durationSec, Math.max(seconds, (UI.job.start || 0) + 30));
        refresh();
      },
      // In remote processing mode sourceInfo() never probes the video -- it
      // returns durationSec: null -- so the length is not known until the worker
      // downloads it. Showing a 0:00-0:00 range picker there is worse than
      // showing none: it reads as "nothing selected" when the truth is "all of
      // it". The band fills, the labels say so, and no range is sent.
      jobBandStyle: job && job.durationKnown
        ? 'position: absolute; top: 0; bottom: 0; left: ' + (job.start / job.durationSec * 100) + '%; width: ' +
          Math.max(1, (job.end - job.start) / job.durationSec * 100) + '%; border-radius: 4px; background: rgba(217,180,120,.28); border: 1px solid rgba(217,180,120,.5);'
        : 'position: absolute; inset: 0; border-radius: 4px; background: rgba(217,180,120,.18); border: 1px solid rgba(217,180,120,.35);',
      jobRangeLabel: !job ? '' : job.durationKnown ? secsToClock(job.start) + ' – ' + secsToClock(job.end) : 'Whole lecture',
      jobLenLabel: !job ? '' : job.durationKnown
        ? humanDuration(job.end - job.start) + ' selected'
        : 'Length is confirmed once the worker downloads the source.',
      // The design followed that label with the literal "of 42:11 — drag the top
      // handle...", so every lecture claimed to be 42 minutes 11 seconds long no
      // matter its real length. text-overrides.json turns it into this binding.
      // "top handle / bottom handle" described the design's stacked layout. The
      // handles address a percentage of the lecture, so the wording no longer
      // needs to explain which is which.
      jobRangeHint: !job ? '' : job.durationKnown
        ? ' of ' + secsToClock(job.durationSec) + ' — drag either handle to trim'
        : '',
      // Charging is per source minute, so an estimate is only honest once the
      // length is known. The server confirms the real cost before processing.
      jobTokenLabel: !job ? '' : job.durationKnown
        ? '≈ ' + plural(Math.max(1, Math.ceil((job.end - job.start) / 60 * tokenRate)), 'token')
        : 'Cost confirmed before processing',
      // A picker, not a label: the template renders one button per entry, so a
      // string here renders one button per character.
      // Nasheed off for this job. Music is mandatory by default and stays that
      // way; this is a per-job choice, not a setting, so forgetting to upload
      // one still fails loudly instead of quietly shipping silent clips.
      jobMusicOn: UI.jobMusic !== false,
      jobMusicLabel: UI.jobMusic === false ? 'No nasheed' : 'Nasheed on',
      jobMusicTrack: switchTrack(UI.jobMusic !== false),
      jobMusicKnob: switchKnob(UI.jobMusic !== false),
      toggleJobMusic: function (e) { stop(e); setUI({ jobMusic: UI.jobMusic === false }); },
      jobNasheeds: (UI.jobMusic === false ? [] : tracks).map(function (t) {
        var on = UI.jobTrackId === t.id || (!UI.jobTrackId && tracks.length > 0);
        return {
          label: t.name || t.fileName || 'Untitled',
          style: 'display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 20px; font-family: inherit; font-size: 11.5px; cursor: pointer; border: 1px solid ' +
            (on ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;' : '#26262A; background: #121214; color: #A2A2AA;'),
          select: function (e) { stop(e); setUI({ jobTrackId: t.id }); },
        };
      }),
      closeJob: function (e) { stop(e); setUI({ job: null }); },
      runGenerate: function (e) {
        stop(e);
        if (!job || UI.generating) return;
        UI.jobError = null;
        setUI({ generating: true });
        global.StudioAdapter.onGenerate(job.url, job.durationKnown
          ? { startSec: Math.round(job.start), endSec: Math.round(job.end) }
          : null, { musicEnabled: UI.jobMusic !== false });
      },
      genBusy: UI.generating,
      genLabel: UI.generating ? 'Starting…' : 'Generate clips',
      genIcon: UI.generating ? 'ph ph-circle-notch' : 'ph-fill ph-sparkle',
      genIconStyle: 'font-size: 15px;' + (UI.generating ? ' animation: dcSpin 1.1s linear infinite;' : ''),
      genBarStyle: UI.generating
        ? 'position: absolute; left: 0; bottom: 0; height: 2px; width: 40%; background: linear-gradient(90deg, #D9B478, #F0D6A6); animation: dcSweep 1.1s ease-in-out infinite;'
        : 'display: none;',
      genProgressLabel: UI.generating ? 'Queuing the lecture…' : (UI.jobError || ''),

      // ── Values the design hardcoded ──
      // These were literal text in the .dc.html. design/text-overrides.json turns
      // them into bindings at import time so they can carry the account's own
      // data; without that a customer sees the designer's placeholders, including
      // a payment card and a connection status that were never real.
      accountName: (DATA.user && (DATA.user.name || DATA.user.email)) || '',
      greeting: 'Studio' + (firstName ? ' · Salām, ' + firstName : ''),
      connSummary: connectedCount
        ? plural(connectedCount, 'account') + ' connected' + (needsReconnect.length ? ' · ' + needsReconnect.join(', ') + ' needs reconnecting' : '')
        : 'No accounts connected',
      cardLabel: current.stripeCustomerId ? 'Card on file · manage in billing' : 'No card on file',
      spendSummary: (current.used || 0) + ' spent this period · top-up tokens never expire',
      // The product does not measure storage, so these report what it does know.
      storageSummary: plural(projects.length, 'lecture') + ' · ' + plural(clips.length, 'clip'),
      storageSources: String(projects.length),
      storageClips: String(clips.length),
      storageTranscripts: String(projects.filter(function (p) { return lecState(p) === 'ready'; }).length),
      jobTitle: active ? projectTitle[active.id] : 'Nothing processing',
      jobMeta: active
        ? humanDuration(active.durationSec || active.sourceDurationSec) + ' source · ' + plural(active.clipCount || 0, 'clip') + ' requested'
        : 'Paste a lecture to start',
      // Failures need a person more urgently than unreviewed clips do, so the
      // badge counts both rather than quietly ignoring the failures.
      activityNeedsYou: (failures.length + needsCount) + ' need you',
      activityTotal: (failures.length + log.length) + ' in total',
      emptySampleNote: 'Sample of what a lecture produces',
      emptySampleCaption: 'This is what one lecture produces',

      // ── Home "This week" ──
      // Every one of these was a fixed number in the design. Measured against a
      // real account they read 18 clips posted against 1, and a median score of
      // 86 when the highest-scoring clip was 72.
      weekPosted: String(postedThisWeek.length),
      weekMedian: medianScore ? String(medianScore) : '—',
      weekHeld: String(needsCount),
      // Nothing records worker time, so it is not invented.
      weekWorker: '—',

      // ── Posting windows ──
      // The design hardcoded three windows that matched nothing. These are the
      // account's own configured post times.
      //
      // The design draws exactly three rows and the default schedule has four
      // (07:00, 12:00, 17:00, 20:30), so the last one used to vanish from this
      // panel while clips were visibly scheduled into it. Anything past the
      // second row is folded into the third rather than dropped -- a panel that
      // silently omits a posting time is worse than a slightly crowded one.
      postWindowName1: windowName(postTimes[0]),
      postWindowName2: windowName(postTimes[1]),
      postWindowName3: postTimes.slice(2).map(windowName).join(' · ') || '—',
      postWindow1: postTimes[0] || '—',
      postWindow2: postTimes[1] || '—',
      postWindow3: postTimes.slice(2).join(' · ') || '—',
      dailyLimitNote: todayCount >= 4
        ? 'Today is full — 4 of 4. Nothing posts unless its four checks pass.'
        : todayCount + ' of 4 scheduled today. Nothing posts unless its four checks pass.',

      // ── Editor readouts ──
      // The timeline named a nasheed the account has never uploaded. It names
      // the clip's actual track, or says none is mixed in.
      edTrackName: edClip && edClip.musicName ? 'Nasheed · ' + edClip.musicName : 'No nasheed mixed in',
      edTrackNote: edClip && edClip.musicName
        ? (edClip.musicVerified ? 'Mixed and verified' : 'Not yet verified')
        // "Upload one" is wrong advice for a clip that was asked to have none.
        : (edClip && edClip.musicEnabled === false
          ? 'This clip was rendered without one'
          : 'Upload one under Nasheed library'),
      edSourceLabel: edClip ? secsToClock((edClip.durationMs || 0) / 1000) + ' · clip' : '',
      edTimeReadout: edClip ? '0:00 / ' + secsToClock((edClip.durationMs || 0) / 1000) : '',

      // ── Chrome: option sheet, toast, player, tour, boot ──
      // The sheet is how every picker on the Templates screen asks its question,
      // so it is load-bearing rather than decoration.
      sheetOpen: Boolean(UI.sheet),
      sheetTitle: UI.sheet ? UI.sheet.title : '',
      sheetSubtitle: UI.sheet ? UI.sheet.subtitle : '',
      sheetOptions: UI.sheet ? UI.sheet.options.map(function (label) {
        return {
          label: label,
          rowStyle: 'display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-bottom: 1px solid #1A1A1E; cursor: pointer; color: #E9E9ED;',
          // The template binds `pick`. Supplying `select` here left every option
          // row listener-less: the sheet opened and clicking did nothing, which
          // silently gated seven template fields, six with no other UI path.
          pick: function (e) {
            stop(e);
            var cb = UI.sheet && UI.sheet.cb;
            UI.sheet = null;
            if (cb) cb(label);
            refresh();
          },
        };
      }) : [],
      closeSheet: function (e) { stop(e); setUI({ sheet: null }); },

      toastOn: Boolean(UI.toast),
      toastMsg: UI.toast || '',

      playerOpen: Boolean(UI.playerClip),
      playerTitle: UI.playerClip ? UI.playerClip.title : '',
      playerThumb: 'width: 100%; aspect-ratio: 9 / 16; border-radius: 10px; background: ' + thumb(UI.playerClip && UI.playerClip.thumbUrl) + ';',
      closePlayer: function (e) { stop(e); setUI({ playerClip: null }); },
      // Moves the playhead by where the bar was clicked. There is no <video>
      // wired into the preview yet, so this positions the head and the readout
      // rather than scrubbing playback.
      seek: function (e) {
        var bar = e && e.currentTarget;
        if (!bar || !bar.getBoundingClientRect) return;
        var box = bar.getBoundingClientRect();
        if (!box.width) return;
        var ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
        setUI({ edPlayhead: ratio });
      },

      // No boot animation: the host page has already run its own splash by the
      // time the dashboard mounts, and a second one just delays the first paint.
      booting: false,
      navLoading: false,
      // The tour belongs to the legacy dashboard, which owns onboarding.
      tourOn: false,
      tourNotFirst: false,
      tourTitle: '', tourBody: '', tourCount: '', tourNextLabel: '', tourDots: [],
      tourCardStyle: 'display: none;', tourVeilStyle: 'display: none;', tourSpotStyle: 'display: none;',
      tourNext: function () {}, tourBack: function () {}, tourSkip: function () {},

      // The design's own dock is off on every screen. Live work is rendered by
      // the host instead: a stable docked section on Home (#studioLiveHome) and
      // a compact expandable bar everywhere else (#studioLiveBar). Leaving this
      // true rendered a second, unstyled bar underneath the real one.
      liveDock: false,
      liveItems: liveItems,
      // Everything in flight, for the Home section and the expandable queue.
      liveAll: liveAll,
      liveCount: jobsLive.length,
      liveMore: jobsLive.length > 1,
      liveMoreLabel: jobsLive.length > 1 ? '+' + (jobsLive.length - 1) + ' more' : '',
      liveOpen: UI.liveOpen,
      toggleLive: function (e) { stop(e); setUI({ liveOpen: !UI.liveOpen }); },
      liveHeadline: jobsLive.length === 0 ? 'Nothing is processing right now'
        : jobsLive.length === 1 ? jobsLive[0].title
        : jobsLive.length + ' jobs running',
      showAllActivity: function (e) { stop(e); setUI({ activityAll: true, bellOpen: true }); },

      // ── Account menu ──
      accountSettings: function (e) { stop(e); setUI({ screen: 'tokens', menuOpen: false }); },
      helpGuides: function (e) { stop(e); global.open('https://deenclipped.online/features', '_blank', 'noopener'); },
      signOut: function (e) { stop(e); global.StudioAdapter.onSignOut(); },

      // ── Connections modal ──
      connOpen: Boolean(conn),
      connName: conn ? conn.title : '',
      connHandle: conn ? (conn.account ? conn.account.name : conn.configured ? 'No account linked' : 'Not configured') : '',
      connIcon: conn ? conn.icon : '',
      connStatus: !conn ? ''
        : !conn.configured ? 'Setup needed'
        : conn.enabled ? 'Active'
        : conn.connected ? 'Connected'
        : 'Not connected',
      connStatusStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; border: 1px solid ' +
        (!conn ? '#26262A;'
          : !conn.configured ? '#3A2A2A; background: rgba(10,10,12,.85); color: #E3928C;'
          : conn.enabled ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: #7FD1A6;'
          : conn.connected ? 'rgba(217,180,120,.4); background: rgba(10,10,12,.85); color: #F0D6A6;'
          : '#33333A; background: rgba(10,10,12,.85); color: #A2A2AA;'),
      connDotStyle: 'width: 8px; height: 8px; border-radius: 50%; background: ' +
        (!conn ? '#6E6E76' : !conn.configured ? '#E3928C' : conn.enabled ? '#7FD1A6' : conn.connected ? '#E6B770' : '#6E6E76') + ';',
      // A failed test sets lastTestAt as well as lastTestError, so reporting the
      // timestamp first hides the error behind "Checked 2m ago" -- which is what
      // the existing dashboard does. The error wins here.
      connNote: !conn ? ''
        : !conn.configured ? 'This platform has no API keys set on the server yet.'
        : conn.status.lastTestError ? 'Last check failed: ' + String(conn.status.lastTestError).slice(0, 160)
        : conn.status.lastTestAt ? 'Checked ' + since(conn.status.lastTestAt)
        : conn.connected ? 'Reconnecting refreshes the publishing token — scheduled posts keep their slots.'
        : 'Connect to publish approved clips automatically.',
      connBtnLabel: conn && conn.connected ? 'Reconnect' : 'Connect',
      connBtnIcon: conn && conn.connected ? 'ph ph-arrows-clockwise' : 'ph ph-plugs-connected',
      connBtnIconStyle: 'font-size: 15px;' + (conn && !conn.configured ? ' opacity: .45;' : ''),
      // Instagram and Facebook share one Meta connection, so say so before
      // someone disconnects both by accident.
      connShared: Boolean(conn) && conn.oauth === 'meta',
      connEnabled: Boolean(conn) && conn.enabled,
      connToggleTrack: switchTrack(Boolean(conn) && conn.enabled),
      connToggleKnob: switchKnob(Boolean(conn) && conn.enabled),
      toggleConnEnabled: function (e) {
        stop(e);
        if (!conn || !conn.connected) return;
        global.StudioAdapter.onPublishingToggle(conn.key, !conn.enabled);
      },
      reconnect: function (e) { stop(e); if (conn && conn.configured) global.StudioAdapter.onConnect(conn.oauth); },
      disconnect: function (e) { stop(e); if (conn) global.StudioAdapter.onDisconnect(conn.oauth, conn.oauth === 'meta'); },
      testPost: function (e) { stop(e); if (conn && conn.connected) global.StudioAdapter.onTestConnection(conn.oauth); },
      closeConn: function (e) { stop(e); setUI({ connProvider: null }); },

      // ── Templates ──
      // Rows are built from the template schema in src/templates.js, and only
      // fields that actually reach an export appear.
      //
      // Deliberately absent, because CLAUDE.md forbids showing a control that
      // cannot reach an export: the design's "Auto headline" and "Intro / outro"
      // rows both drive hookEnabled, which sanitiseTemplate() hard-disables, and
      // its AI rows (filler words, long pauses, keyword highlighter, caption
      // emojis, stock B-roll) have no field at all -- the render pipeline has no
      // concat/trim/atrim/select, so none of them can be produced.
      // The design renders <option value="{{ opt }}"> over a list of strings, so
      // selection is keyed by name and two templates sharing a name would be
      // indistinguishable. Disambiguated here until the design can emit ids.
      tplList: templates.map(function (t, i) {
        var clash = templates.filter(function (o) { return o.name === t.name; }).length > 1;
        return clash ? t.name + ' (' + (i + 1) + ')' : t.name;
      }),
      activeTpl: (function () {
        if (!activeTemplate) return '';
        var i = templates.findIndex ? templates.findIndex(function (t) { return t.id === activeTemplate.id; }) : -1;
        var clash = templates.filter(function (o) { return o.name === activeTemplate.name; }).length > 1;
        return clash && i > -1 ? activeTemplate.name + ' (' + (i + 1) + ')' : activeTemplate.name;
      })(),
      setActiveTpl: function (e) {
        var label = e.target.value;
        var picked = templates.filter(function (t, i) {
          var clash = templates.filter(function (o) { return o.name === t.name; }).length > 1;
          return (clash ? t.name + ' (' + (i + 1) + ')' : t.name) === label;
        })[0];
        if (picked) global.StudioAdapter.onSelectTemplate(picked.id);
      },
      tplStyleRows: tplRow([
        { icon: 'ph ph-layout', label: 'Clip layout', field: 'fitMode', opts: ENUMS.fitMode, labels: { contain: 'Fit with blurred bars', blur: 'Blurred background', crop: 'Fill, face-tracked' } },
        { icon: 'ph ph-crosshair', label: 'Framing bias', field: 'smartFramingBias', opts: ENUMS.smartFramingBias },
        { icon: 'ph ph-closed-captioning', label: 'Caption', field: 'captionMode', opts: ENUMS.captionMode, labels: { phrase: 'One phrase', word: 'Word by word', 'dynamic-stack': 'Stacked lines' } },
        { icon: 'ph ph-palette', label: 'Look', field: 'filterPreset', opts: ENUMS.filterPreset },
      ]),
      tplBrandRows: tplRow([
        { icon: 'ph ph-image-square', label: 'Watermark position', field: 'watermarkPosition', opts: ENUMS.watermarkPosition },
        { icon: 'ph ph-text-aa', label: 'Caption position', field: 'captionPosition', opts: ENUMS.captionPosition },
        { icon: 'ph ph-align-center-horizontal', label: 'Caption alignment', field: 'captionHorizontal', opts: ENUMS.captionHorizontal },
      ]),
      // Voice enhancement is the one processing toggle the worker really applies.
      tplAIRows: [{ key: 'voiceEnhance', icon: 'ph ph-waveform', label: 'Voice enhancement', note: 'levels and clarity on speech' }].map(function (r) {
        var on = Boolean(tpl[r.key]);
        return {
          icon: r.icon, label: r.label, note: r.note,
          trackStyle: 'position: relative; margin-left: auto; width: 34px; height: 19px; flex: none; border-radius: 20px; cursor: pointer; transition: background .16s ease, border-color .16s ease; border: 1px solid ' +
            (on ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.22);' : '#33333A; background: #17171A;'),
          knobStyle: 'position: absolute; top: 2px; left: ' + (on ? '17px' : '2px') + '; width: 13px; height: 13px; border-radius: 50%; background: ' + (on ? '#F0D6A6' : '#6E6E76') + '; transition: left .16s ease, background .16s ease;',
          toggle: function (e) { stop(e); saveStyle({ voiceEnhance: !on }); },
        };
      }),
      tplDirtyLabel: UI.tplDirty ? 'Unsaved changes' : 'All changes saved',
      tplDirtyDotStyle: 'width: 7px; height: 7px; border-radius: 50%; background: ' + (UI.tplDirty ? '#E6B770' : '#7FD1A6') + ';',
      saveTpl: function (e) {
        stop(e);
        // Flush anything still debounced, then ask for propagation explicitly.
        if (UI.tplTimer) { global.clearTimeout(UI.tplTimer); UI.tplTimer = null; }
        var pending = UI.tplDraft; UI.tplDraft = null;
        global.StudioAdapter.onSaveTemplate(activeTemplate && activeTemplate.id, pending);
      },
      resetTpl: function (e) {
        stop(e);
        if (UI.tplTimer) { global.clearTimeout(UI.tplTimer); UI.tplTimer = null; }
        UI.tplDraft = null;
        setUI({ tplDirty: false });
        global.StudioAdapter.onResetTemplate();
      },
      duplicateTpl: function (e) { stop(e); global.StudioAdapter.onDuplicateTemplate(activeTemplate && activeTemplate.id); },
      // Opens the newest clip actually built on this template, rather than only
      // explaining that a preview would come from one. It stayed a message even
      // when the account had clips built on the very template being edited.
      previewClip: function (e) {
        stop(e);
        var id = activeTemplate && activeTemplate.id;
        var built = clips.filter(function (c) { return c.templateId === id && c.thumbUrl; })
          .sort(function (a, b) { return Number(b.readyAt || b.createdAt || 0) - Number(a.readyAt || a.createdAt || 0); });
        if (!built.length) {
          toast('No clip has been rendered with this template yet — the next one will use it.');
          return;
        }
        setUI({ playerClip: built[0] });
      },
      layerBtns: [
        { key: 'caption', label: 'Caption', icon: 'ph ph-closed-captioning' },
        { key: 'mark', label: 'Logo', icon: 'ph ph-copyright' },
      ].map(function (l) {
        var on = UI.tplLayer === l.key;
        return {
          label: l.label, icon: l.icon,
          style: 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 8px; font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; border: 1px solid ' +
            (on ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.13); color: #F0D6A6;' : '#26262A; background: #121214; color: #A2A2AA;'),
          select: function (e) { stop(e); setUI({ tplLayer: l.key }); },
        };
      }),
      // Live preview overlays, positioned from the template's own margins.
      // captionMarginV is pixels from the bottom of a `height`-tall frame, which
      // is exactly what the renderer uses, so the preview and the export agree.
      // The sample caption, drawn the way the chosen caption mode will draw it.
      // The design bakes one phrase in, so picking "Word by word" changed the
      // row's label and nothing else -- the one control whose whole meaning is
      // what the caption looks like.
      capPreviewText: sampleCaptionAt(previewAt, tpl.captionMode, tpl.captionStackMaxWords),

      // The words on screen, with the live one marked, so the preview can show
      // the highlight in its own face, slant, colour and glow -- the thing that
      // makes the stacked style read, and which the renderer has always done
      // even though nothing could configure it.
      capWords: (function () {
        var parts = sampleCaptionParts(previewAt, tpl.captionMode, tpl.captionStackMaxWords);
        var glow = Math.max(0, Math.min(30, Number(tpl.captionHighlightGlow) || 0));
        // The pop, drawn the way the renderer draws it: start at the configured
        // scale and settle to 1 over the configured time. Without this the two
        // animation sliders moved numbers that the preview never showed, which
        // is indistinguishable from their not working.
        var popScale = Math.max(60, Math.min(140, Number(tpl.captionPopScale) || 100));
        var popMs = Math.max(0, Math.min(400, Number(tpl.captionPopMs) || 0));
        var popping = popScale !== 100 && popMs > 0;
        return parts.words.map(function (text, i) {
          var on = i === parts.liveIndex;
          return {
            text: text,
            style: on
              ? 'color: ' + (tpl.captionHighlight || '#D9B478') + ';'
                + ' font-family: ' + webFontFor(tpl.captionHighlightFont) + ';'
                + (tpl.captionHighlightItalic ? ' font-style: italic;' : '')
                + (glow ? ' text-shadow: 0 0 ' + Math.round(glow / 2) + 'px ' + (tpl.captionHighlight || '#D9B478') + ';' : '')
                // display:inline-block, or transform does nothing on an inline box.
                + (popping ? ' display: inline-block; --dc-pop: ' + (popScale / 100).toFixed(3)
                  + '; animation: dcCapPop ' + popMs + 'ms ease-out 1;' : '')
              : '',
          };
        });
      }()),

      // ── Sample playback ──
      // The design draws a play control with no handler at all: an icon, a bar
      // and a hardcoded 0:14. Playing the sample is the only way to show what a
      // caption mode does, since word-by-word and stacked lines look identical
      // in a still.
      pvPlaying: UI.pvPlaying,
      pvPlayIcon: UI.pvPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play',
      pvTimeLabel: clockLabel(UI.pvTime) + ' / ' + clockLabel(SAMPLE_TOTAL),
      pvProgress: SAMPLE_TOTAL ? Math.max(0, Math.min(1, UI.pvTime / SAMPLE_TOTAL)) : 0,
      pvTotalSeconds: SAMPLE_TOTAL,
      togglePreviewPlay: function (e) {
        stop(e);
        // Restart rather than resume from the end, so a second press always
        // plays something.
        var restart = UI.pvTime >= SAMPLE_TOTAL - 0.05;
        setUI({ pvPlaying: !UI.pvPlaying, pvTime: restart ? 0 : UI.pvTime });
      },
      setPreviewTime: function (seconds) {
        UI.pvTime = Math.max(0, Math.min(SAMPLE_TOTAL, Number(seconds) || 0));
        if (UI.pvTime >= SAMPLE_TOTAL) UI.pvPlaying = false;
        refresh();
      },

      // A small name for the line the caption has caught, so the snap is
      // readable rather than only a highlighted rule.
      pvSnapName: UI.dragSnapName || '',
      pvSnapStyle: (UI.dragKind === 'caption' && UI.dragSnapName)
        // Pinned to the right edge rather than centred on the line: centred, it
        // sat directly under the caption box it was describing.
        ? 'position: absolute; z-index: 10; right: 6px; translate: 0 -50%; pointer-events: none;'
          + ' top: ' + ((UI.dragAt || 0) * 100).toFixed(3) + '%;'
          + ' padding: 2px 8px; border-radius: 999px; background: #F0D6A6; color: #17140E;'
          + ' font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 700;'
          + ' letter-spacing: .02em; white-space: nowrap; box-shadow: 0 2px 10px rgba(0,0,0,.45);'
        : 'display: none;',

      // ── Preview picture ──
      // A real lecture's own 16:9 thumbnail when the account has one, so what is
      // previewed is the customer's own footage; the illustration otherwise.
      pvSrc: previewSource,
      // Fill crops to the frame. Fit letterboxes onto the template's frame
      // colour. Blur letterboxes the same way over a blown-up blurred copy,
      // which is what the renderer's overlay does.
      pvBackStyle: tpl.fitMode === 'blur'
        ? 'position: absolute; inset: 0; z-index: 0; background-image: url("' + cssUrl(previewSource) + '");'
          + ' background-size: cover; background-position: center; filter: blur(18px) saturate(1.2); transform: scale(1.15);'
        : 'display: none;',
      pvImgStyle: 'position: absolute; inset: 0; z-index: 1; background-repeat: no-repeat; background-position: center;'
        + ' background-image: url("' + cssUrl(previewSource) + '");'
        + ' background-size: ' + (tpl.fitMode === 'crop' ? 'cover' : 'contain') + ';'
        + (tpl.fitMode === 'contain' ? ' background-color: ' + (tpl.frameBackground || '#000000') + ';' : '')
        + ' ' + lookFilter(tpl),
      // Vignette and grain sit above the picture, as separate passes do in the
      // render, so they darken and texture the letterboxing too.
      pvFxStyle: (function () {
        var vignette = Math.max(0, Math.min(1, Number(tpl.vignette) || 0));
        var grain = Math.max(0, Math.min(100, Number(tpl.grain) || 0)) / 100;
        if (!vignette && !grain) return 'display: none;';
        var layers = [];
        if (vignette) layers.push('radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,' + (vignette * 0.85).toFixed(3) + ') 100%)');
        if (grain) {
          // A fine two-tone check reads as grain at this scale without needing
          // an image, and scales with the slider.
          layers.push('repeating-conic-gradient(rgba(255,255,255,' + (grain * 0.16).toFixed(3) + ') 0% 25%, rgba(0,0,0,' + (grain * 0.16).toFixed(3) + ') 0% 50%)');
        }
        return 'position: absolute; inset: 0; z-index: 2; pointer-events: none;'
          + ' background-image: ' + layers.join(', ') + ';'
          + (grain ? ' background-size: auto, 3px 3px;' : '');
      }()),

      capStyle: overlayStyle(tpl.captionPosition, tpl.captionHorizontal, tpl.captionPrimary, tpl.captionFontSize,
        Number(tpl.captionMarginV || 0) / Math.max(1, Number(tpl.height || 1920)),
        webFontFor(tpl.captionFont), tpl.captionUppercase)
        + capInkStyle(tpl)
        + capFadeStyle(tpl, UI.pvPlaying)
        + grabStyle(UI.dragKind === 'caption')
        + (UI.dragKind === 'caption' ? ' outline: 1px dashed rgba(240,214,166,.85); outline-offset: 4px;' : ''),
      capHandle: handleStyle(UI.tplLayer === 'caption'),
      headStyle: 'display: none;',
      headHandle: 'display: none;',
      markStyle: overlayStyle(tpl.watermarkPosition.indexOf('top') === 0 ? 'top' : 'bottom',
        tpl.watermarkPosition.indexOf('left') > -1 ? 'left' : tpl.watermarkPosition.indexOf('right') > -1 ? 'right' : 'center',
        tpl.watermarkColor, tpl.watermarkFontSize)
        + grabStyle(UI.dragKind === 'mark')
        + (UI.dragKind === 'mark' ? ' outline: 1px dashed rgba(240,214,166,.85); outline-offset: 4px;' : ''),
      markHandle: handleStyle(UI.tplLayer === 'mark'),
      // The vertical centre line stays faint and constant; the horizontal one
      // becomes the live drag line, so the two together read as a grid.
      guideVStyle: 'position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; pointer-events: none; background: '
        + (UI.dragKind ? 'repeating-linear-gradient(to bottom, rgba(240,214,166,.5) 0 6px, transparent 6px 12px)' : 'rgba(217,180,120,.18)') + ';',
      guideHStyle: guideOverlayStyle(Boolean(UI.dragKind), UI.dragAt, UI.dragSnapped, SNAP_LINES),
      edSafe: true,
      // Output shape. The render pipeline has always been generic here -- every
      // fit mode scales to {width}:{height} and the subtitle canvas follows --
      // but the UI pinned it to 9:16 and this button only explained that the
      // presets were fixed. Template-level only: width and height are excluded
      // from CLIP_STYLE_FIELDS on purpose, since resizing one clip would desync
      // it from every sibling in the lecture.
      safePresetLabel: ratioLabel(tpl.width, tpl.height),
      cyclePreset: function (e) {
        stop(e);
        var labels = RATIO_PRESETS.map(function (r) { return r.label; });
        global.StudioAdapter.onPickOption('Output shape', labels, function (chosen) {
          var picked = RATIO_PRESETS.filter(function (r) { return r.label === chosen; })[0];
          if (picked) saveStyle({ width: picked.width, height: picked.height });
        });
      },
      // The preview frame follows the chosen shape, or Fit and Blur would be
      // letterboxing against the wrong box.
      pvAspect: Math.max(1, Number(tpl.width) || 1080) + ' / ' + Math.max(1, Number(tpl.height) || 1920),
      // Real dragging, onto fields that reach the render. Vertical is continuous
      // (captionMarginV, 20-800 in the schema); horizontal snaps to the three
      // alignments the renderer supports, because there is no free-form X.
      dragCaption: dragCaptionFrom,
      dragMark: dragMarkFrom,
      // The design has a headline layer; hookEnabled is hard-disabled in
      // sanitiseTemplate, so there is nothing for a drag to move.
      dragHeadline: function () {},
      // Steps back through the edits made on this screen. With nothing recorded
      // it falls back to discarding unsaved changes, which is what it used to do
      // in every case.
      undoEdit: function (e) {
        stop(e);
        if (UI.tplPast.length) return replayStyle(UI.tplPast, UI.tplFuture, 'undo');
        if (UI.tplTimer) { global.clearTimeout(UI.tplTimer); UI.tplTimer = null; }
        UI.tplDraft = null;
        setUI({ tplDirty: false });
        global.StudioAdapter.onResetTemplate();
      },
      // Was a button that existed only to explain why it did nothing.
      redoEdit: function (e) {
        stop(e);
        if (!UI.tplFuture.length) { toast('Nothing to redo.'); return; }
        replayStyle(UI.tplFuture, UI.tplPast, 'redo');
      },

      // ── Start-a-job form (shared by Home and the library) ──
      jobUrlVal: UI.jobUrl,
      setJobUrl: function (e) { UI.jobUrl = e.target.value; refresh(); },
      startJob: function (e) {
        stop(e);
        var url = (UI.jobUrl || '').trim();
        if (!url) return;
        global.StudioAdapter.onProbeSource(url);
      },
      // The same `onFile` binding serves the lecture uploader and the nasheed
      // uploader, so it has to route by screen. Sending an audio file to
      // /api/videos made a new account unusable: the upload was rejected with
      // "upload at least one nasheed first", which is what the user was trying
      // to do. Every selected file is taken, not just the first.
      onFile: function (e) {
        var files = (e.target && e.target.files) ? Array.prototype.slice.call(e.target.files) : [];
        if (!files.length) return;
        if (UI.screen === 'music') global.StudioAdapter.onUploadNasheeds(files);
        else global.StudioAdapter.onUploadFile(files[0]);
      },

      selectWrapStyle: 'position: relative; display: flex; align-items: center;',
      selectStyle: 'appearance: none; padding: 7px 26px 7px 10px; border: 1px solid #26262A; border-radius: 8px; background: #121214; color: #F2F2F4; font-family: inherit; font-size: 12.5px; cursor: pointer;',

      tplNames: templates.map(function (t) { return t.name; }),
      jobTpl: activeTemplate ? activeTemplate.name : '',
      setTpl: function (e) {
        var picked = templates.filter(function (t) { return t.name === e.target.value; })[0];
        UI.jobTplId = picked ? picked.id : '';
        refresh();
      },

      durNames: DUR_PRESETS.map(function (d) { return d.label; }),
      jobDur: durLabel,
      setDur: function (e) {
        var picked = DUR_PRESETS.filter(function (d) { return d.label === e.target.value; })[0];
        if (picked) global.StudioAdapter.onClipSettings({ clipMinSeconds: picked.min, clipMaxSeconds: picked.max });
      },

      countsOpen: UI.countsOpen,
      toggleCounts: function (e) { stop(e); setUI({ countsOpen: !UI.countsOpen }); },
      countLabel: plural(clipsPerVideo, 'clip') + ' per lecture',
      countOpts: [3, 6, 9, 12].map(function (n) {
        var on = clipsPerVideo === n;
        return {
          label: plural(n, 'clip'),
          rowStyle: 'display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; cursor: pointer; color: ' + (on ? '#F0D6A6' : '#BCBCC3') + ';',
          boxStyle: 'display: grid; place-items: center; width: 15px; height: 15px; flex: none; border-radius: 4px; border: 1px solid ' +
            (on ? '#D9B478; background: rgba(217,180,120,.18);' : '#33333A; background: #0E0E11;'),
          toggle: function (e) {
            stop(e);
            UI.countsOpen = false;
            global.StudioAdapter.onClipSettings({ clipsPerVideo: n });
          },
        };
      }),

      archiveSources: function (e) { stop(e); toast('Archiving sources is not available yet.'); },
      // /more-clips does exactly this; it was reporting itself unavailable.
      recutClips: function (e) {
        stop(e);
        if (!detail) return;
        global.StudioAdapter.onPickOption('More clips from this lecture',
          ['Cut 4 more clips', 'Cut 8 more clips', 'Cancel'], function (choice) {
            var n = choice === 'Cut 4 more clips' ? 4 : choice === 'Cut 8 more clips' ? 8 : 0;
            if (n) global.StudioAdapter.onMoreClips(detail.id, n);
          });
      },
      editWindows: function (e) { stop(e); setUI({ screen: 'templates' }); },

      // ── Nasheed library ──
      nasheedList: tracks.map(function (t, i) {
        return {
          name: t.name || t.fileName || 'Untitled',
          dur: t.durationSec ? secsToClock(t.durationSec) : '',
          mood: t.shared ? 'Shared' : 'Yours',
          rowStyle: 'display: flex; align-items: center; gap: 11px; padding: 10px 12px; border: 1px solid #1E1E22; border-radius: 10px; background: #121214; animation: dcRise .24s cubic-bezier(.2,.8,.2,1) ' + Math.min(i * 0.03, 0.3) + 's both;',
          playStyle: 'display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 50%; border: 1px solid #26262A; background: #17171A; color: #F0D6A6; cursor: pointer;',
          playIcon: UI.playingTrack === t.id ? 'ph-fill ph-pause' : 'ph-fill ph-play',
          play: function (e) { stop(e); setUI({ playingTrack: UI.playingTrack === t.id ? null : t.id }); global.StudioAdapter.onPlayTrack(t.id); },
          waveStyle: 'flex: 1; height: 22px; border-radius: 4px; background: repeating-linear-gradient(90deg, #26262A 0 2px, transparent 2px 5px);',
          rotStyle: 'display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; cursor: pointer; border: 1px solid rgba(127,209,166,.32); background: rgba(10,10,12,.82); color: #7FD1A6;',
          rotIcon: 'ph-fill ph-check-circle',
          rotLabel: 'In rotation',
          toggleRot: function (e) { stop(e); toast('Every uploaded nasheed is in rotation.'); },
          remove: function (e) { stop(e); global.StudioAdapter.onRemoveTrack(t.id); },
        };
      }),
      // The template already writes " nasheeds in rotation." after this, so it
      // takes the bare count.
      rotCount: String(tracks.length),
      nasheedVol: musicVolume,
      nasheedVolLabel: musicVolume + '%',
      nasheedDb: (musicVolume ? Math.round(20 * Math.log10(musicVolume / 100)) : -60) + ' dB under speech',
      setVol: function (e) { global.StudioAdapter.onMusicSettings({ volumePercent: Number(e.target.value) }); },
      duckTrackStyle: sliderTrack(true),
      duckKnobStyle: sliderKnob(true),
      toggleDuck: function (e) { stop(e); toast('Ducking is always on — the nasheed drops under speech.'); },

      // ── Performance ──
      // The product does not collect view, save or watch-time data: a published
      // clip's record carries delivery status only. Rather than invent numbers,
      // the tiles report what is genuinely known and the leaderboard ranks by the
      // score the worker assigned.
      perfRanges: ['Last 7 days', 'Last 30 days', 'All time'].map(function (label) {
        return {
          label: label,
          style: tabStyle(UI.perfRange === label),
          select: function (e) { stop(e); setUI({ perfRange: label }); },
        };
      }),
      perfTiles: [
        { icon: 'ph-fill ph-stack', label: 'Clips generated', value: String(clips.length) },
        { icon: 'ph-fill ph-check-circle', label: 'Approved', value: String(clips.filter(function (c) { return decision(c) === 'approved'; }).length) },
        { icon: 'ph-fill ph-paper-plane-tilt', label: 'Posted', value: String(clips.filter(function (c) { return c.postedAt; }).length) },
        { icon: 'ph-fill ph-film-script', label: 'Lectures', value: String(projects.length) },
      ].map(function (t) {
        return { icon: t.icon, label: t.label, value: t.value, delta: '', deltaIcon: '', deltaStyle: 'display: none;' };
      }),
      perfBoard: clips.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 5).map(function (c, i) {
        return {
          rank: String(i + 1),
          caption: c.title || '',
          lecTitle: projectTitle[c.projectId] || '',
          duration: secsToClock((c.durationMs || 0) / 1000),
          thumbStyle: 'width: 30px; height: 42px; flex: none; border-radius: 6px; border: 1px solid #26262A; background: ' + thumb(c.thumbUrl) + ';',
          barStyle: 'height: 4px; border-radius: 4px; width: ' + Math.max(4, Math.min(100, Number(c.score || 0))) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6);',
          views: '—', saves: '—', watch: '—',
          more: function (e) { stop(e); global.StudioAdapter.onMoreClips(c.projectId, 4); },
        };
      }),
      perfPatterns: [],

      // ── Tokens & billing ──
      // The period tabs filter the real plan list by its own `interval`, so the
      // prices and token counts change with the period instead of the tabs
      // merely highlighting.
      planPeriods: PERIODS.map(function (p) {
        return {
          label: p.label,
          style: tabStyle(UI.planPeriod === p.key),
          select: function (e) { stop(e); setUI({ planPeriod: p.key }); },
        };
      }),
      planCards: planList.filter(function (p) {
        return p.interval === UI.planPeriod || p.id === 'free';
      }).map(function (p) {
        var isCurrent = String(p.id || '').toLowerCase() === String(current.plan || '').toLowerCase();
        var unavailable = p.enabled === false;
        return {
          name: p.name || p.id || '',
          price: p.priceLabel || (p.id === 'free' ? 'Free' : 'Price not set'),
          per: p.interval && p.interval !== 'one-time' ? 'per ' + p.interval : '',
          tokens: p.tokens != null ? plural(p.tokens, 'token') : '',
          lines: [{ text: p.description || '' }].filter(function (l) { return l.text; }),
          hasTag: Boolean(isCurrent || p.badge),
          tag: isCurrent ? 'Current plan' : (p.badge || ''),
          tagStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: ' +
            (isCurrent ? 'rgba(217,180,120,.16); color: #F0D6A6;' : 'rgba(127,209,166,.14); color: #7FD1A6;'),
          cardStyle: 'display: flex; flex-direction: column; gap: 9px; padding: 14px; border-radius: 12px; border: 1px solid ' +
            (isCurrent ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.05);' : '#1E1E22; background: #121214;'),
          cta: isCurrent ? 'Current' : unavailable ? 'Not available' : 'Choose',
          btnStyle: 'padding: 8px 12px; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: ' +
            (isCurrent || unavailable ? 'default' : 'pointer') + '; border: 1px solid ' +
            (isCurrent || unavailable ? '#26262A; background: #17171A; color: #6E6E76;' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'),
          choose: function (e) {
            stop(e);
            if (isCurrent) return;
            if (unavailable) { toast(p.name + ' is not configured for checkout yet.'); return; }
            global.StudioAdapter.onChoosePlan(p.id);
          },
        };
      }),
      // Buying tokens on their own. The endpoint has always existed; the screen
      // simply rendered an empty list.
      packs: topupList.map(function (pk) {
        var unavailable = pk.enabled === false;
        return {
          name: pk.name || pk.id,
          tokens: plural(pk.tokens || 0, 'token'),
          price: pk.priceLabel || 'Price not set',
          per: 'one-off',
          rate: pk.tokens ? 'about ' + Math.round(pk.tokens / Math.max(1, tokenRate)) + ' source minutes' : '',
          equiv: pk.description || '',
          popular: pk.badge === 'Most popular',
          cardStyle: 'display: flex; flex-direction: column; gap: 8px; padding: 13px; border-radius: 12px; border: 1px solid ' +
            (pk.badge === 'Most popular' ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.05);' : '#1E1E22; background: #121214;'),
          cta: unavailable ? 'Not available' : 'Buy tokens',
          btnStyle: 'padding: 8px 12px; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: ' +
            (unavailable ? 'default' : 'pointer') + '; border: 1px solid ' +
            (unavailable ? '#26262A; background: #17171A; color: #6E6E76;' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'),
          buy: function (e) {
            stop(e);
            if (unavailable) { toast(pk.name + ' is not configured for checkout yet.'); return; }
            global.StudioAdapter.onBuyTokens(pk.id);
          },
        };
      }),
      spendRows: [
        { icon: 'ph-fill ph-coins', label: 'Used this period', cost: String(current.used || 0) },
        { icon: 'ph-fill ph-hourglass', label: 'Reserved for running jobs', cost: String(current.reserved || 0) },
        { icon: 'ph-fill ph-gift', label: 'Top-up tokens', cost: String(current.bonusTokens || 0) },
      ],
      planNote: current.periodEndsInDays != null
        ? 'Renews in ' + plural(current.periodEndsInDays, 'day')
        : 'No renewal date on this plan.',
      changeCard: function (e) { stop(e); global.StudioAdapter.onBillingPortal(); },
      openInvoices: function (e) { stop(e); global.StudioAdapter.onBillingPortal(); },

      // ── Arabic & terms ──
      // There is no glossary in the data model — settingDefaults() has only clip,
      // music, automation, publishing and template settings — so this screen has
      // nothing to read. Left empty rather than filled with invented corrections.
      arabicFlags: [],
      termRows: [],
      termAVal: UI.termA,
      termBVal: UI.termB,
      addTermA: function (e) { UI.termA = e.target.value; refresh(); },
      addTermB: function (e) { UI.termB = e.target.value; refresh(); },
      addTerm: function (e) { stop(e); toast('Saving a term needs a glossary field on the account first.'); },

      connections: providers.map(function (p) {
        var dot = 'position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid #0C0C0E; background: ' +
          (!p.configured ? '#E3928C' : p.enabled ? '#7FD1A6' : p.connected ? '#E6B770' : '#6E6E76') + ';';
        return {
          name: PLATFORM_NAMES[p.key],
          handle: p.account ? p.account.name : (p.configured ? 'No account linked' : 'Needs API keys'),
          note: !p.configured ? 'Not configured on the server'
            : !p.connected ? 'Connect to publish'
            : !p.enabled ? 'Connected — not switched on'
            : 'Active',
          icon: p.icon,
          key: p.key,
          // Opens the combined dialog rather than a per-platform one: seeing all
          // four at once is what makes the publishing picture legible.
          open: function (e) { stop(e); global.StudioAdapter.onOpenConnections(p.key); },
          // Green only when it will actually post: connected AND enabled.
          // Both names are supplied because the Home row binds heroDotStyle and
          // the modal binds dotStyle; supplying only one left the Home dot with
          // no style at all, so it never appeared even when connected.
          dotStyle: dot,
          heroDotStyle: dot,
        };
      }),
    };

    return vals;
  }

  global.StudioAdapter = {
    bindings: bindings,
    ui: UI,
    setRefresh: function (fn) { refresh = fn || function () {}; },
    // Overridden by the host page so the adapter never talks to the API directly.
    onApprove: function () {},
    onReject: function () {},
    onUploadFile: function () {},
    onUploadNasheeds: function () {},
    onClipSettings: function () {},
    onMusicSettings: function () {},
    onPlayTrack: function () {},
    onRemoveTrack: function () {},
    onChoosePlan: function () {},
    onBuyTokens: function () {},
    onSelectTemplate: function () {},
    onSaveTemplate: function () {},
    onResetTemplate: function () {},
    onDuplicateTemplate: function () {},
    onTemplateField: function () {},
    // Per-clip style write, and the explicit promotion of one clip's tweaks onto
    // the style every clip shares. index.html overrides both at mount.
    onClipStyle: function () {},
    onPromoteClipStyle: function () {},
    // Overridden by the host: saves this clip, then gives every other clip from
    // the same lecture the same look.
    onApplyToLecture: function () {},
    onPickOption: function (title, options, cb) {
      UI.sheet = { title: title, subtitle: 'Applies to every clip on this template', options: options, cb: cb };
      refresh();
    },
    onSignOut: function () {},
    onProbeSource: function () {},
    onGenerate: function () {},
    onSaveClip: function () {},
    clipSaved: function () { UI.edSaving = false; UI.edDirty = false; UI.edCaption = null; UI.edBlockDraft = null; refresh(); },
    // Called by the host once /api/source-info resolves, so the range picker can
    // open against the real duration.
    openJob: function (source) {
      var dur = Number(source && source.durationSec) || 0;
      UI.job = {
        url: source.url,
        title: source.title || source.url,
        // sourceInfo returns the video's own thumbnail and this dropped it, so
        // the poster had nothing to show and painted an empty box no matter
        // what the panel was wired to.
        thumbnail: source.thumbnail || '',
        durationSec: dur,
        durationKnown: dur > 0,
        start: 0,
        end: dur,
      };
      UI.generating = false;
      UI.jobUrl = '';
      refresh();
    },
    jobDone: function () { UI.job = null; UI.generating = false; refresh(); },
    // Called when the server refused the source. The panel stays open so the
    // reason sits next to the button that caused it.
    jobFailed: function (message) {
      UI.generating = false;
      UI.jobError = String(message || 'That source was refused.');
      refresh();
    },
    onConnect: function () {},
    onDisconnect: function () {},
    onTestConnection: function () {},
    onOpenConnections: function () {},
    onPublishingToggle: function () {},
    onPostNow: function () {},
    onSendBack: function () {},
    onScheduleClip: function () {},
    onMoreClips: function () {},
    // Sends any pending clip-style edit immediately instead of waiting out the
    // debounce. "Save to all clips" reads the overrides back off the server to
    // copy them, so without this the siblings would be given the look from
    // before the last half-second of edits -- and the clip being edited would
    // end up the odd one out.
    flushClipStyle: function () {
      if (UI.edStyleTimer) { global.clearTimeout(UI.edStyleTimer); UI.edStyleTimer = null; }
      var pending = UI.edStyleDraft;
      UI.edStyleDraft = null;
      if (!pending || !Object.keys(pending).length) return Promise.resolve();
      return Promise.resolve(global.StudioAdapter.onClipStyle(UI.edClipId, pending));
    },

    // Holds an edit that was not persisted, so it survives the debounce.
    //
    // saveTemplate() hands the draft to the host and clears it, on the
    // assumption the host writes it to the server. A built-in cannot be written
    // to, so the host hands it back here instead — without this the control
    // snapped back to its old value 450ms after every change.
    keepDraft: function (patch) {
      UI.tplDraft = Object.assign({}, UI.tplDraft, patch || {});
      UI.tplDirty = true;
      refresh();
    },

    // Shows the design's own toast rather than the legacy one when the Studio
    // dashboard is the visible surface.
    showToast: function (message) {
      UI.toast = message;
      refresh();
      global.setTimeout(function () { UI.toast = null; refresh(); }, 2600);
    },
    onBillingPortal: function () {},
    onToast: function () {},
    // The host clears optimistic decisions once fresh state has landed.
    // Both decisions are persisted now, so the refreshed state is the truth and
    // nothing needs to be held over it.
    settled: function () { UI.pending = {}; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
