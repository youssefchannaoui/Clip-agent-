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
    // Which activity row is open in the detail view, by its stable id.
    activityDetail: null,
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
    tplHistCtx: '',
    tourStep: undefined,
    selClips: {},
    selLecs: {},
    tplFuture: [],
    tplReplaying: false,
    // What is being dragged in a preview, where it is, and whether it has caught
    // a snap line. Drives the cursor, the outline and the guides.
    dragKind: null,
    dragAt: null,
    dragSnapped: false,
    dragSnapName: '',
    // Where a caption is being dragged to right now, before anything is saved.
    dragPreview: null,
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
    edTplId: null,
    edCaption: null,
    edBlock: 0,
    // The editor's real playhead, in seconds, and whether the clip is playing.
    // edPlayhead stays as the 0..1 fraction the design's styles are built from,
    // but it is now derived from edTime rather than being the source of truth:
    // a fraction cannot seek a <video>, and everything downstream (captions,
    // ruler, readout) needs the seconds.
    edPlayhead: 0,
    edTime: 0,
    edPlaying: false,
    // True once the clean source has failed to load and the editor has fallen
    // back to the captioned export. The overlay caption hides in that state,
    // because the export already has captions burned into the picture and two
    // sets on screen is worse than none of your own.
    // The editor shows the RENDER. This latch is set only when that file
    // genuinely cannot be played, and it puts the uncaptioned source on
    // screen with a label saying so. It used to be the other way round: the
    // source was the default and the render the fallback, which is why the
    // editor and the review queue never looked the same.
    edSourceFallback: false,
    edBlockDraft: null,
    capTextStepAt: 0,
    // null means no upload in flight; 0-100 while bytes are moving.
    uploadPct: null,
    uploadSent: 0,
    uploadTotal: 0,
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
  /**
   * Deep link a screen from the fragment: /app#library opens the library.
   *
   * Added because the owner dashboard is its own page, so its copy of the rail
   * has to link back into the studio. Without this every one of those links
   * would drop you on Home, which is worse than no rail at all.
   *
   * Read once at boot rather than on hashchange: the studio owns its screen
   * state after that, and a hash left in the URL must not fight a click.
   */
  (function screenFromHash() {
    var wanted = String((global.location && global.location.hash) || '').replace(/^#/, '');
    // Listed literally rather than read from TITLES, which is a var assigned
    // further down the file and is still undefined at this point.
    if (['home', 'library', 'queue', 'schedule', 'templates', 'music', 'performance'].indexOf(wanted) !== -1) {
      UI.screen = wanted;
      UI.lastScreen = wanted;
    }
  })();

  function setUI(patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) UI[k] = patch[k];
    refresh();
  }
  function stop(e) { if (e && e.preventDefault) e.preventDefault(); }

  // ── the editor's <video> ──────────────────────────────────────────────────
  // The design exports a still frame for the editor preview, so the real video
  // is a host-owned element the host layer docks inside that frame (the same
  // pattern as every other host node). The adapter owns the *state* -- time,
  // playing, which caption is live -- and reaches the element through these,
  // because a compiled template cannot hold a ref and re-rendering must never
  // tear down a playing video.
  var edVideoEl = null;
  function edVideo(node) { if (node !== undefined) edVideoEl = node; return edVideoEl; }
  function seekHost(seconds) {
    var v = edVideoEl;
    if (!v) return;
    // Clip-local seconds in, media seconds out. A clean plate is the whole
    // lecture, so the clip's start is added; the export is already cut and its
    // offset is zero. Mixing the two timebases makes the editor look dead
    // rather than slightly off, so the offset lives on the element that knows
    // which source it is showing.
    var base = Number(v.dataset && v.dataset.offset) || 0;
    try { v.currentTime = base + Math.max(0, Number(seconds) || 0); } catch (err) { /* not seekable yet */ }
  }

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
  // Bytes for humans. Below a megabyte the honest answer is "almost nothing".
  function fmtBytes(bytes) {
    if (!bytes) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    return Math.max(1, Math.round(bytes / (1024 * 1024))) + ' MB';
  }

  // Clip lengths are seconds-scale, so m:ss reads naturally.
  function secsToClock(s) {
    if (!s && s !== 0) return '';
    // Round the total first: rounding the remainder alone turned 59.6s into
    // "0:60" on clip cards.
    var total = Math.round(s);
    var m = Math.floor(total / 60), r = total % 60;
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

  // Every word-sized choice in the job wizard wears this: the word itself,
  // over a rule that is gold when chosen and invisible when not. A bordered
  // pill with a tinted fill and a little icon announces that it is a control
  // before it says which one is picked -- five of them in a row read as
  // decoration, and the wizard had four such rows.
  function wordOption(on, size) {
    return 'min-width: 46px; padding: 9px 15px; border: 0; border-radius: 8px; cursor: pointer;'
      + ' background: ' + (on ? '#26262E' : 'transparent') + ';'
      + ' font-family: inherit; font-size: ' + (size || 14) + 'px;'
      + ' font-weight: ' + (on ? '600' : '400') + '; letter-spacing: -.01em;'
      + ' color: ' + (on ? '#F6F6F8' : '#9A9AA2') + ';'
      + ' transition: background .16s ease, color .16s ease;';
  }
  // The track the segments sit in.
  var SEG_RAIL = 'display: inline-flex; padding: 3px; border-radius: 11px;'
    + ' background: #121215; border: 1px solid #212127;';

  var volumeSaveTimer = null;
  function saveVolumeSoon(n) {
    if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(function () {
      volumeSaveTimer = null;
      global.StudioAdapter.onMusicSettings({ volumePercent: n });
    }, 320);
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
    // The widest honest range: the planner cuts each clip at its natural
    // length inside the window, which is what "a mix of lengths" really is.
    { label: 'Mixed \u00b7 10-90s', min: 10, max: 90 },
  ];

  // "45\u201370 min" from a selected length: measured whisper throughput plus
  // render time, floored so a five-minute clip does not promise three.
  /**
   * Whether this account may pick a Pro template.
   *
   * The server decides, and refuses both the selection and the render either
   * way. An answer the client does not have yet is treated as "allowed", so a
   * slow or missing billing payload never locks somebody out of their own
   * paid styles.
   */
  function planAllowsProTemplates(DATA) {
    var current = DATA && DATA.billing && DATA.billing.current;
    if (!current) return true;
    if (current.features && typeof current.features.templates === 'boolean') {
      return current.features.templates;
    }
    return String(current.plan || 'free') !== 'free';
  }

  /**
   * The cost line, with what it leaves behind.
   *
   * "≈ 45 tokens" answers half the question. The half people actually act on
   * is whether they can afford it, and finding out by pressing Start and
   * being refused is the wrong moment to learn it.
   */
  function tokenCostLine(DATA, cost) {
    var current = DATA && DATA.billing && DATA.billing.current;
    var label = '\u2248 ' + plural(cost, 'token');
    if (!current || current.unlimited) return label;
    var left = Number(current.totalAvailable);
    if (!isFinite(left)) return label;
    if (left >= cost) return label + ' \u00b7 ' + (left - cost) + ' left after';
    return label + ' \u00b7 short by ' + (cost - left);
  }

  /**
   * The four lines beside the cost: what it leaves you, what you get, in
   * which style, and where the captions come from.
   *
   * Every one of these was previously only discoverable by starting the job
   * and looking at the result.
   */
  function jobSummaryRows(DATA, job, tokenRate) {
    // Each row knows which step produced it, so the review is a way back in
    // rather than a wall of text you have to unpick with Back.
    var value = function (text, tone, step) {
      return {
        value: text,
        valueStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 12.5px; font-weight: 500; text-align: right; color: '
          + (tone === 'warn' ? '#FF5566' : tone === 'gold' ? '#F0D6A6' : '#F2F2F4') + ';',
        rowStyle: 'display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-radius: 7px; margin: 0 -8px; padding: 5px 8px; text-decoration: none; color: inherit;'
          + (step ? ' cursor: pointer;' : ' cursor: default;'),
        editStyle: 'font-size: 11px; color: #6E6E76; display: ' + (step ? 'inline' : 'none') + ';',
        go: step
          ? function (e) { stop(e); setUI({ jobStep: step }); }
          : function (e) { stop(e); },
      };
    };
    var rows = [];
    var current = DATA && DATA.billing && DATA.billing.current;
    var cost = Math.max(1, Math.ceil((job.end - job.start) / 60 * tokenRate));
    if (job.durationKnown) {
      rows.push(Object.assign({ label: 'From the lecture' },
        value(humanDuration(job.end - job.start) + ' of ' + humanDuration(job.durationSec), '', 2)));
    }
    var settings = (DATA && DATA.clipSettings) || {};
    var chosen = Array.isArray(settings.clipLengthBands) ? settings.clipLengthBands.length : 0;
    rows.push(Object.assign({ label: 'Clip lengths' },
      chosen ? value(chosen + ' of 4 chosen', '', 3) : value('Pick at least one', 'warn', 3)));
    if (current && !current.unlimited && isFinite(Number(current.totalAvailable))) {
      var left = Number(current.totalAvailable);
      rows.push(Object.assign({ label: 'Balance afterwards' }, left >= cost
        ? value(plural(left - cost, 'token'))
        : value('short by ' + (cost - left), 'warn')));
    }
    var tpl = activeJobTemplate(DATA);
    if (tpl) {
      var locked = Boolean(tpl.pro) && !planAllowsProTemplates(DATA);
      rows.push(Object.assign({ label: 'Style' },
        value(tpl.name + (locked ? ' \u00b7 Pro' : ''), locked ? 'gold' : '', 4)));
      // The one behavioural difference between the kinds, said where the
      // choice is actually being made.
      rows.push(Object.assign({ label: 'Captions from' },
        value(tpl.captionMode === 'quran' ? 'The Quran corpus' : 'What was said', '', 4)));
      // Said here because a wrong guess is invisible until the clips arrive
      // captioned in the wrong script.
      var jobLangNames = { en: 'English', ar: 'Arabic', ur: 'Urdu', auto: 'Auto-detect' };
      var jobLangPick = UI.jobLang || (tpl.captionMode === 'quran' ? 'ar' : 'en');
      rows.push(Object.assign({ label: 'Spoken language' },
        value(jobLangNames[jobLangPick] || 'Auto-detect', '', 1)));
      rows.push(Object.assign({ label: 'Underneath' },
        value(tpl.captionMode === 'quran' ? 'Nothing \u2014 recitation' : 'Nasheed, ducked', '', 6)));
    }
    // Where this job would land, from the queue as it stands right now.
    var waiting = ((DATA && DATA.projects) || []).filter(function (project) {
      return project.status === 'queued' || project.status === 'processing';
    }).length;
    rows.push(Object.assign({ label: 'Queue' },
      value(waiting ? plural(waiting, 'job') + ' ahead of yours' : 'Next in line')));
    return rows;
  }

  /** The template this job will render with, by the same rule the panel uses. */
  function activeJobTemplate(DATA) {
    var list = (DATA && DATA.templates) || [];
    var wanted = UI.jobTplId;
    for (var i = 0; i < list.length; i += 1) {
      if (wanted && list[i].id === wanted) return list[i];
    }
    return DATA && DATA.selectedTemplate ? DATA.selectedTemplate : (list[0] || null);
  }

  /**
   * The job panel is a sequence, not a form.
   *
   * Everything it asks for was on one scrolling page, which meant reading the
   * whole thing to answer any of it -- and the first question, what kind of
   * thing you brought, is the one that decides what the rest should even
   * offer. One question at a time, in the order the answers depend on each
   * other, and the cost last because it is the sum of them.
   */
  var JOB_STEPS = [
    { id: 'kind', title: 'What are you clipping?', hint: 'This decides which styles fit and whether a nasheed belongs underneath.' },
    { id: 'trim', title: 'How much of the lecture?', hint: 'This is the part you pay for. Drag either handle.' },
    { id: 'lengths', title: 'How long should the clips be?', hint: 'Pick any. Moments are cut to fit the lengths you allow.' },
    { id: 'style', title: 'How should the captions look?', hint: 'Every preview is the style the renderer actually produces.' },
    { id: 'picture', title: 'What plays on screen?', hint: 'The lecture itself, or scenery with the voice over it.' },
    { id: 'sound', title: 'What plays underneath?', hint: 'A nasheed sits under the voice, ducked so it never competes with it.' },
    { id: 'review', title: 'Ready to go', hint: 'Check it over. Anything here can be changed before you start.' },
  ];

  function jobStepIndex() {
    var n = Number(UI.jobStep || 1);
    return Math.max(1, Math.min(JOB_STEPS.length, n));
  }

  function jobStepId() {
    return JOB_STEPS[jobStepIndex() - 1].id;
  }

  /**
   * Why a step cannot be left, or '' when it can.
   *
   * Returned as the reason rather than a boolean so the button can say it.
   * Nothing here blocks going BACK.
   */
  function jobStepBlocker(DATA, job) {
    var id = jobStepId();
    if (id === 'trim' && job && job.durationKnown && job.end - job.start < 20) {
      return 'Select at least 20 seconds';
    }
    if (id === 'lengths') {
      var settings = (DATA && DATA.clipSettings) || {};
      var bands = settings.clipLengthBands;
      if (Array.isArray(bands) && !bands.length) return 'Pick at least one length';
    }
    if (id === 'style') {
      var tpl = activeJobTemplate(DATA);
      if (tpl && tpl.pro && !planAllowsProTemplates(DATA)) return tpl.name + ' is a Pro style';
    }
    return '';
  }

  function jobEtaRange(seconds) {
    var mins = Math.max(1, seconds / 60);
    var lo = Math.max(4, Math.round(mins * 0.6));
    var hi = Math.max(8, Math.round(mins * 1.0));
    return lo + '\u2013' + hi + ' min';
  }

  // The tour, anchored on the elements the design already marks with
  // data-tour. Three steps, because that is how many anchors exist and
  // because the app's whole loop is paste, start, review.
  // A short tour per screen, not one tour on Home. Each step names an anchor:
  // a data-tour key, or any CSS selector when the screen already has a stable
  // one. A step whose anchor is not on screen is SKIPPED rather than shown --
  // a spotlight over nothing is the failure this design invites, and it is
  // invisible to tests.
  var TOURS = {
    // The tours teach the pipeline, not the buttons. One lecture goes in, the
    // worker cuts it into clips, you decide which survive, and the ones you
    // approve go out at times you choose. Each screen says where it sits in
    // that line and what it is for.
    home: [
      { anchor: 'paste', title: 'One lecture goes in here',
        body: 'Paste a link to a lecture you own or are allowed to use, or upload an MP4. This is the only thing DeenClipped needs from you — everything after it is automatic until you are asked to decide.' },
      { anchor: 'start', title: 'It finds the moments for you',
        body: 'Start asks seven short questions — how much of the lecture to use, how long the clips should be, how the captions look. Then the worker transcribes the whole thing, scores every moment, and renders the best ones as vertical clips with captions and a nasheed underneath.' },
      { anchor: '#studioLiveHome', title: 'Happening now shows the work',
        body: 'While a lecture is processing, this tells you exactly what stage it is at and how long is left. You can leave the page — the worker keeps going without the browser open.' },
      { anchor: 'rail', title: 'Nothing goes out on its own',
        body: 'Finished clips do not post. They wait in the review queue for you, and only the ones you approve and give a time to are ever published.' },
    ],
    library: [
      { anchor: 'lib-tabs', title: 'Every lecture you have added',
        body: 'One card per lecture. Processing means the worker is still on it; Ready means the clips are cut and waiting for you.' },
      { anchor: 'lib-add', title: 'Open a lecture to see its clips',
        body: 'Each lecture holds the clips cut from it. Open one to review them, re-render them, or cut more from the same source without paying for it twice.' },
    ],
    queue: [
      { anchor: 'queue-tabs', title: 'This is where you decide',
        body: 'Every clip the worker cuts arrives here and waits. Nothing leaves this screen without your say-so, which is the whole point of it.' },
      { anchor: 'queue-decide', title: 'Approve, edit or reject',
        body: 'Approve keeps the clip and starts its full-quality render. Reject sets it aside — it is kept, and you can restore it. The middle button opens the editor if the wording needs a fix first.' },
    ],
    schedule: [
      { anchor: 'sched-views', title: 'The last step: when it goes out',
        body: 'An approved clip still needs a time. Your account has four posting windows a day; the month shows them all at a glance, and the week draws them as slots you can fill.' },
      { anchor: 'sched-ready', title: 'Clips waiting for a time',
        body: 'Everything you approved that has no slot yet. Slot it drops one into the next free window, or press an empty slot in the week to choose exactly when.' },
      { anchor: 'sched-outlets', title: 'Where it posts to',
        body: 'Clips go to the accounts you connect here. Until at least one is connected and switched on, approved clips will sit in their slots and never leave.' },
    ],
    music: [
      { anchor: 'music-upload', title: 'Every clip needs a nasheed',
        body: 'One is mixed underneath every clip, so a lecture cannot finish processing while this library is empty. Upload one to unblock your first job; two or more lets it rotate so consecutive clips do not sound identical.' },
      { anchor: 'music-level', title: 'How loud it sits',
        body: 'This is its level under the voice. It is ducked automatically wherever the speaker is loudest, so it never competes with them.' },
    ],
    templates: [
      { anchor: '#studio select', title: 'How your captions look',
        body: 'One style applies to every new clip. Clean Line is included on the free plan; the others are Pro, and the ones marked Pro will be refused until you upgrade.' },
      { anchor: '#studioPreviewPic', title: 'What you see is the render',
        body: 'The frame draws a real caption and watermark at this template\u2019s own sizes and margins. Drag either to move it — the export puts them exactly where you leave them.' },
      { anchor: 'tpl-save', title: 'Save applies it everywhere',
        body: 'Changes stay in the browser until you save, and leaving the screen drops them. Saving also re-renders every clip that has not posted yet, so they all match. Re-renders are free.' },
    ],
    editor: [
      { anchor: 'ed-preview', title: 'You are watching the real clip',
        body: 'This is the rendered file with its captions burned in — the same bytes that would be posted. Your edits appear after the next render, not before.' },
      { anchor: 'ed-save', title: 'Fix the wording, re-render free',
        body: 'Save stores your caption edits and re-renders this one clip; the others cut from the same lecture keep what they have. Re-rendering never costs a token.' },
    ],
    tokens: [
      { anchor: 'tokens-balance', title: 'You pay by lecture length',
        body: 'Tokens are charged per minute of source you actually use — the range you pick, not the whole video. Clips you reject and renders that fail are never charged.' },
      { anchor: 'tokens-plans', title: 'What a paid plan changes',
        body: 'Publishing, scheduling, automation, the editor and unlimited clips per lecture are all on the free plan. Paying adds the full caption-style catalogue and lets you remove the watermark.' },
    ],
    performance: [
      { anchor: 'perf-tiles', title: 'What you have produced',
        body: 'Counts for the range you pick above: clips cut, clips you approved, clips that posted, and lectures added.' },
      { anchor: 'perf-board', title: 'Scored, not measured',
        body: 'Clips are ranked by the score the worker gave each one when it cut them. DeenClipped does not collect views or watch time from any platform, so nothing here is audience data.' },
    ],
  };

  // Remembered per browser: a tour that reappears on every visit is an
  // interruption, and one that can never be reopened is a dead end -- the
  // account menu can start it again.
  function tourSeen(screen) {
    try {
      // Anyone who finished the old Home-only tour has already been round the
      // product; they are not shown a tour on every screen now.
      if (global.localStorage.getItem('dcTourSeen') === '1') return true;
      return global.localStorage.getItem('dcTour:' + screen) === '1';
    } catch (err) { return true; }
  }
  function markTourSeen(screen) {
    try { global.localStorage.setItem('dcTour:' + screen, '1'); } catch (err) { /* private mode */ }
  }
  function forgetTours() {
    try {
      global.localStorage.removeItem('dcTourSeen');
      for (var key in TOURS) if (Object.prototype.hasOwnProperty.call(TOURS, key)) {
        global.localStorage.removeItem('dcTour:' + key);
      }
    } catch (err) { /* private mode */ }
  }
  function tourAnchorEl(anchor) {
    if (!global.document) return null;
    var sel = /^[#.[]/.test(anchor) ? anchor : '[data-tour="' + anchor + '"]';
    try { return global.document.querySelector(sel); } catch (err) { return null; }
  }

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

  // Dismissed rows, remembered the same way and for the same reason: there is
  // no read/dismissed field on the server. Dismissing hides a row from the
  // bell; it never deletes the project, clip or log entry behind it, because
  // the failure itself is still a real thing that happened and still shows on
  // the screen that owns it.
  var DISMISS_KEY = 'deenStudioActivityDismissed';
  // Capped so a long-lived account cannot grow this without bound. Oldest go
  // first: a row dismissed months ago is not coming back to the top of a feed
  // sorted by time.
  var DISMISS_CAP = 400;
  var dismissMemory = [];
  function dismissedIds() {
    try {
      var raw = global.localStorage.getItem(DISMISS_KEY);
      var stored = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(stored)) stored = [];
      return stored.concat(dismissMemory);
    } catch (err) { return dismissMemory.slice(); }
  }
  function writeDismissed(list) {
    var trimmed = list.slice(-DISMISS_CAP);
    dismissMemory = trimmed;
    try { global.localStorage.setItem(DISMISS_KEY, JSON.stringify(trimmed)); } catch (err) { /* private mode */ }
  }
  function dismissIds(ids) {
    var seen = {};
    var next = dismissedIds().concat(ids).filter(function (id) {
      if (!id || seen[id]) return false;
      seen[id] = 1;
      return true;
    });
    writeDismissed(next);
  }
  function restoreDismissed() { writeDismissed([]); }

  // A row's identity has to survive a repaint, because the feed is rebuilt from
  // account data on every paint -- an index would renumber the moment anything
  // above it changed, and dismissing one row would silently hide a different
  // one later. Built from what the row is ABOUT plus when it happened.
  function activityId(kind, key, at) {
    return kind + ':' + String(key || '').slice(0, 80) + ':' + String(Number(at) || 0);
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

  // Which screen a row sends you to, named the way the rail names it.
  var SCREEN_LABEL = {
    library: 'Open lecture library',
    queue: 'Open review queue',
    schedule: 'Open schedule',
    music: 'Open nasheed library',
    templates: 'Open templates',
    home: 'Open home',
  };

  // What a failure actually MEANS, and what to do about it.
  //
  // The feed could only ever say what broke. That is fine for whoever wrote the
  // code and useless to everyone else: "403" sends people to check a plan that
  // is fine, and the sentence naming the fix was the part shortError() cut off.
  //
  // Matched on the message rather than only on errorCode, because one code
  // covers several different failures -- youtube_import_blocked is both the
  // bot-wall and a private video, and those have opposite answers. First match
  // wins, so the specific patterns are listed before the broad ones.
  var EXPLAIN = [
    {
      // The import service accepting a job and then never delivering it is a
      // different failure from YouTube refusing one, and it needs a different
      // answer: nothing about the video or the link is wrong, retrying the same
      // way will not help while the outage lasts, and uploading bypasses the
      // service entirely.
      match: /never started delivering|import service looks unavailable|import service: (queued|processing)/i,
      title: 'Our import service is not responding',
      cause: 'The service that fetches videos from YouTube accepted this job and then stopped responding. This is an outage on their side — the video, the link and your account are all fine.',
      fixes: [
        'Use Upload MP4 or MOV instead. That path does not touch the import service and is working normally.',
        'Retry the link later — outages usually clear within a few hours.',
        'Do not re-paste the link repeatedly; each attempt waits on the same service.',
      ],
    },
    {
      match: /sign in to confirm|not a bot|cookies-from-browser/i,
      title: 'YouTube blocked our server, not you',
      cause: 'YouTube demanded proof that a person rather than a machine was asking for the download, and a server cannot answer that. The same video plays normally in your own browser.',
      fixes: [
        'Download the video in your browser, then use Upload MP4 or MOV.',
        'Press Retry once — these blocks come and go through the day.',
        'Never paste browser cookies anywhere. This product will never ask for them.',
      ],
    },
    {
      match: /private video|members-only|age-restricted|has been removed|video is unavailable|account associated/i,
      title: 'This video is not available to download',
      cause: 'The video is private, members-only, age-restricted or deleted. Nobody could have fetched it — the wording says "refused", which sounds like our fault, but no route would have worked.',
      fixes: [
        'Open the link in a private window while signed out to confirm it is restricted.',
        'Ask the channel owner for the original file.',
        'Play your own copy, save it, and use Upload MP4.',
        'Do not keep retrying — the answer will not change.',
      ],
    },
    {
      match: /403|refused to hand this video over|forbidden/i,
      title: 'YouTube refused this particular video',
      cause: 'YouTube would not release this video\'s file to us at all. Your account, plan and tokens are all fine — other lectures normally still import.',
      fixes: [
        'Download the video yourself and use Upload MP4 or MOV.',
        'Try a different lecture to confirm your account is fine.',
        'Check whether the video is public, and not age-restricted or region-locked.',
        'Press Retry once, then stop.',
      ],
    },
    {
      match: /playlist/i,
      title: 'That link is a playlist, not one video',
      cause: 'Copying from the address bar while watching inside a playlist quietly attaches the whole playlist to the link.',
      fixes: [
        'Use the video\'s own Share button instead of the address bar.',
        'Or delete everything from "&list=" onwards in the link.',
        'Submit each video separately.',
      ],
    },
    {
      match: /ended early|did not complete|empty file|connection reset|download timed out/i,
      title: 'The download broke off partway',
      cause: 'The transfer started and then stopped before the whole file arrived. This is a network hiccup between servers — nothing is wrong with your video.',
      fixes: [
        'Press Retry. This one genuinely does often work the second time.',
        'If it breaks twice, download it yourself and use Upload MP4.',
      ],
    },
    {
      match: /not enough (?:free )?(?:temporary )?disk|no space left|ENOSPC/i,
      title: 'The server ran out of room',
      cause: 'The machine that processes lectures had no space left to work in. This is ours to fix, not yours.',
      fixes: [
        'Wait a few minutes and press Retry — space is freed as jobs finish.',
        'Tell the site owner if it keeps happening.',
      ],
      ownerOnly: true,
    },
    {
      match: /worker (?:is )?unavailable|stopped responding|exceeded the job timeout|unreachable/i,
      title: 'The processing server did not answer',
      cause: 'The machine that transcribes and renders was unreachable or stopped mid-job. Your lecture and your tokens are untouched.',
      fixes: [
        'Press Retry — the job restarts safely from the beginning.',
        'Tell the site owner if several lectures fail this way at once.',
      ],
      ownerOnly: true,
    },
    {
      match: /not enough tokens|token balance|allowance/i,
      title: 'Not enough tokens for this lecture',
      cause: 'Tokens are charged by the length of the source video. This one needs more than the account currently has.',
      fixes: [
        'Buy a top-up from the Token shop.',
        'Clip a shorter section of the lecture instead.',
        'Wait for your plan to renew.',
      ],
    },
    {
      match: /did not find any speech|no speech/i,
      title: 'No speech was found in the audio',
      cause: 'The transcriber listened to the whole file and heard nothing it could turn into words — usually a video with no audio track, music only, or a silent recording.',
      fixes: [
        'Play the file and check you can hear talking.',
        'Upload a version with the speech track included.',
      ],
    },
    {
      match: /nasheed|music track|musicEnabled/i,
      title: 'A nasheed is needed first',
      cause: 'Every clip mixes one in, so a lecture cannot finish rendering without at least one uploaded.',
      fixes: [
        'Upload a nasheed in the Nasheed library.',
        'Upload two or more before turning on automatic posting, so they can rotate.',
      ],
    },
    {
      match: /reconnect|no access token|not connected|revoked|refresh token/i,
      title: 'The connected account needs reconnecting',
      cause: 'The permission this account gave us has expired or been withdrawn, so we can no longer post on its behalf. Nothing was published.',
      fixes: [
        'Open Platforms and reconnect the account.',
        'Approve every permission on the consent screen — a skipped one causes exactly this.',
        'Then press Retry on the clip.',
      ],
    },
    {
      match: /quran captions need the ayah corpus/i,
      title: 'Quran captions fell back to ordinary ones',
      cause: 'The verse-matching data was not available, so recited scripture was captioned as plain speech instead of as the ayah with its translation. The clip is fine — it just does not carry the medallion.',
      fixes: [
        'Re-render the clip once the site owner has restored the corpus.',
        'Tell the site owner this happened.',
      ],
      ownerOnly: true,
    },
    {
      match: /AI clip scoring is not configured|built-in scoring|returned nothing usable/i,
      title: 'Clips were chosen without the AI',
      cause: 'The local ranking model was unavailable, so clips were picked by the built-in scoring and titled from the transcript rather than written. The clips are real and usable — the titles are just plainer.',
      fixes: [
        'Edit the titles by hand in the review queue.',
        'Re-run More clips later to get AI titles.',
        'Tell the site owner if every job says this.',
      ],
      ownerOnly: true,
    },
    {
      match: /usable answers for \d+ of/i,
      title: 'Only some clips were AI-scored',
      cause: 'The ranking model answered for part of the batch. The rest kept their built-in scores, so the ordering mixes two measures and may not be the strongest first.',
      fixes: [
        'Review the whole queue rather than trusting the order.',
        'Re-run More clips for a cleaner ranking.',
      ],
    },
  ];

  // Falls back on the error code when no message pattern matches, then on a
  // generic answer that is still more use than the raw text alone.
  var EXPLAIN_BY_CODE = {
    youtube_import_blocked: {
      title: 'YouTube would not release this video',
      cause: 'The download was refused. This is about the video, not your account.',
      fixes: ['Download it yourself and use Upload MP4 or MOV.', 'Try another lecture to confirm your account is fine.'],
    },
    vizard_import_failed: {
      title: 'The clipping service could not take this video',
      cause: 'The outside service that produced the clips refused this source.',
      fixes: ['Press Retry once.', 'Upload the MP4 directly instead.'],
    },
    worker_unavailable_exhausted: {
      title: 'The processing server stayed unreachable',
      cause: 'We retried for several minutes and it never came back. Your tokens were not spent.',
      fixes: ['Press Retry once it is back.', 'Tell the site owner.'],
      ownerOnly: true,
    },
  };

  var EXPLAIN_FALLBACK = {
    title: 'This job could not finish',
    cause: 'Something in the pipeline stopped before the clips were ready. The original message is below — it is written for diagnosis rather than for reading.',
    fixes: [
      'Press Retry once; a good share of these are temporary.',
      'Upload the MP4 directly, which skips the import entirely.',
      'Copy the message below if you report it.',
    ],
  };

  function explainFailure(row) {
    var text = String((row && (row.full || row.meta || row.text)) || '');
    for (var i = 0; i < EXPLAIN.length; i += 1) {
      if (EXPLAIN[i].match.test(text)) return EXPLAIN[i];
    }
    if (row && row.code && EXPLAIN_BY_CODE[row.code]) return EXPLAIN_BY_CODE[row.code];
    return EXPLAIN_FALLBACK;
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
    captionMode: ['phrase', 'word', 'dynamic-stack', 'stack-build', 'cards'],
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
    // The Madinah mushaf's own digital face; U+06DD is the verse medallion.
    { name: 'KFGQPC HAFS Uthmanic Script', label: 'Uthmani HAFS', web: '"KFGQPC HAFS Uthmanic Script", Amiri, serif' },
    // The product's own sans, bundled in the worker for the translation line.
    { name: 'Outfit', label: 'Outfit', web: 'Outfit, "Segoe UI", sans-serif' },
    // Bundled at weight 700 for the default template's caption line, and at
    // 800 as its own family for the stacked-build one.
    { name: 'Montserrat', label: 'Montserrat', web: 'Montserrat, "Segoe UI", sans-serif' },
    { name: 'Montserrat ExtraBold', label: 'Montserrat Heavy', web: '"Montserrat ExtraBold", Montserrat, "Segoe UI", sans-serif' },
  ];

  // How much smaller libass draws each face than CSS does at the same nominal
  // size. libass sizes a font by its Win cell (usWinAscent + usWinDescent);
  // CSS sizes by the em square. Measured from the exact font files the worker
  // installs: factor = unitsPerEm / (usWinAscent + usWinDescent). Multiplying
  // the preview's font size by this shows the size the export truly draws --
  // without it the preview ran ~16% large in DejaVu and nearly 3x large in
  // Amiri, which is why the editor and the rendered clip looked like two
  // different products.
  var ASS_SIZE_FACTOR = {
    'DejaVu Sans': 0.859,
    'DejaVu Serif': 0.851,
    'Liberation Sans': 0.895,
    'Open Sans': 0.694,
    'Amiri': 0.362,
    'Scheherazade New': 0.411,
    'KFGQPC HAFS Uthmanic Script': 0.569,
    'Outfit': 0.794,
    'Montserrat ExtraBold': 0.640,
    'Montserrat': 0.640,
  };
  function assFactor(name) {
    return ASS_SIZE_FACTOR[name] || 0.86;
  }

  // Mirrors worker/clip_worker.py: the render computes each face's nominal
  // ayah size from its measured Win cell so every face lands on the same
  // VISUAL size -- AYAH_VISUAL em of the caption font size. In the preview the
  // cell terms cancel, so this single multiplier is the whole story.
  var AYAH_VISUAL = 3.0 / 2.76;
  // ayah_mark_scale in the worker: the HAFS medallion is already mushaf-sized.
  function ayahMarkScale(arabicFont) {
    return arabicFont === 'KFGQPC HAFS Uthmanic Script' ? 1.4 : 1.45;
  }

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
  // The sample for the Quran caption mode: a short, whole ayah (Ar-Ra'd 28)
  // with its verse mark and translation, shown the way ayah_events draws one.
  var SAMPLE_AYAH = {
    arabic: '\u0623\u064E\u0644\u064E\u0627 \u0628\u0650\u0630\u0650\u0643\u0652\u0631\u0650 \u0627\u0644\u0644\u064E\u0651\u0647\u0650 \u062A\u064E\u0637\u0652\u0645\u064E\u0626\u0650\u0646\u064E\u0651 \u0627\u0644\u0652\u0642\u064F\u0644\u064F\u0648\u0628\u064F',
    mark: '\u06DD\u0662\u0668',
    gloss: 'Verily, in the remembrance of Allah do hearts find rest',
  };

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

    // Outline and shadow in em, so they keep the render's ratio to the glyphs
    // at any preview size. ASS measures both in frame pixels; dividing by the
    // font size gives the same ratio in a unit the preview scales for free.
    // Fixed px looked right in one preview box and wrong in the other, which
    // is exactly the editor-vs-templates mismatch.
    var fontPx = Math.max(1, Number(t.captionFontSize) || 96);
    var shadows = [];
    var width = Math.max(0, Math.min(14, Number(t.captionOutlineWidth) || 0));
    if (width) {
      var em = (width / fontPx).toFixed(3) + 'em';
      var colour = t.captionOutline || '#09090A';
      var steps = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
      for (var i = 0; i < steps.length; i++) {
        shadows.push('calc(' + steps[i][0] + ' * ' + em + ') calc(' + steps[i][1] + ' * ' + em + ') 0 ' + colour);
      }
    }
    var drop = Math.max(0, Math.min(8, Number(t.captionShadow) || 0));
    if (drop) {
      var dropEm = (drop / fontPx).toFixed(3) + 'em';
      shadows.push(dropEm + ' ' + dropEm + ' ' + (2 * drop / fontPx).toFixed(3) + 'em rgba(0,0,0,.75)');
    }
    if (shadows.length) out += ' text-shadow: ' + shadows.join(', ') + ';';
    return out;
  }

  // ── The one caption look ──
  // The Templates preview and the clip editor both draw the caption with the
  // three helpers below, so the caption a clip shows inside the editor is the
  // caption its template shows outside it. Each follows write_ass: the block
  // spans the frame minus captionMarginH each side (ASS wraps inside its
  // margins) and text-align carries captionHorizontal; captionMarginV is
  // measured from the anchoring edge and ignored by a middle alignment; the
  // font size is the template's, as a fraction of the frame width (cqw), with
  // a px value first for anything that lacks container units.
  function captionPlacementStyle(t, dragY) {
    var width = Math.max(1, Number(t.width) || 1080);
    var height = Math.max(1, Number(t.height) || 1920);
    var inset = Math.max(1, Math.min(35, (Math.max(0, Number(t.captionMarginH) || 0) / width) * 100)).toFixed(2) + '%';
    var align = t.captionHorizontal === 'left' ? 'left' : t.captionHorizontal === 'right' ? 'right' : 'center';
    var h = 'left: ' + inset + '; right: ' + inset + '; text-align: ' + align + ';';
    var v;
    if (dragY !== null && dragY !== undefined) {
      v = 'top: ' + (dragY * 100).toFixed(2) + '%; translate: 0 -50%;';
    } else if (t.captionPosition === 'top' || t.captionPosition === 'bottom') {
      var pct = Math.max(1, Math.min(50, (Number(t.captionMarginV) || 0) / height * 100)).toFixed(2);
      v = (t.captionPosition === 'top' ? 'top: ' : 'bottom: ') + pct + '%; translate: 0 0;';
    } else {
      v = 'top: 50%; translate: 0 -50%;';
    }
    return 'position: absolute; ' + h + ' ' + v;
  }

  function captionFaceStyle(t) {
    var size = (Number(t.captionFontSize) || 96) * assFactor(t.captionFont);
    var width = Math.max(1, Number(t.width) || 1080);
    var tracking = Math.max(-4, Math.min(40, Number(t.captionLetterSpacing) || 0));
    return ' color: ' + (t.captionPrimary || '#FFFFFF') + ';'
      + ' font-family: ' + webFontFor(t.captionFont) + '; font-weight: 700;'
      + ' font-size: ' + Math.max(9, Math.round((size / width) * 268)) + 'px;'
      + ' font-size: ' + ((size / width) * 100).toFixed(2) + 'cqw;'
      + (tracking ? ' letter-spacing: ' + (tracking / Math.max(1, Number(t.captionFontSize) || 96)).toFixed(3) + 'em;' : '')
      + (t.captionUppercase ? ' text-transform: uppercase;' : '');
  }

  // An ayah is set in the Quranic face at the render's own scale, never
  // uppercased and not bold -- the Ayah style in write_ass is Bold 0.
  function ayahFaceStyle(t) {
    var arabic = t.captionArabicFont || 'Amiri';
    var size = (Number(t.captionFontSize) || 96) * AYAH_VISUAL;
    var width = Math.max(1, Number(t.width) || 1080);
    return ' color: ' + (t.captionPrimary || '#FFFFFF') + ';'
      + ' font-family: ' + webFontFor(arabic) + '; font-weight: 400;'
      + ' font-size: ' + Math.max(9, Math.round((size / width) * 268)) + 'px;'
      + ' font-size: ' + ((size / width) * 100).toFixed(2) + 'cqw;';
  }

  // The translation under an ayah: the Latin caption face at
  // captionTranslationSize, exactly as the render's \fn+\fs override sets it,
  // expressed relative to the ayah span it sits inside.
  function ayahGlossStyle(t) {
    var ayahPx = (Number(t.captionFontSize) || 96) * AYAH_VISUAL;
    var glossPx = (Number(t.captionTranslationSize) || 46) * assFactor(t.captionFont);
    var em = Math.max(0.15, Math.min(1.2, glossPx / Math.max(1, ayahPx)));
    return 'display: block; font-size: ' + em.toFixed(3) + 'em; line-height: 1.25; opacity: .92; margin-top: .35em;'
      + ' font-family: ' + webFontFor(t.captionFont) + '; font-weight: 400; text-transform: none;';
  }

  // The live word's own colour, face, slant, glow and pop -- the render has
  // always drawn these; the two previews used to disagree on which of them
  // they simulated.
  function captionHighlightStyle(t) {
    var glow = Math.max(0, Math.min(30, Number(t.captionHighlightGlow) || 0));
    var fontPx = Math.max(1, Number(t.captionFontSize) || 96);
    var popScale = Math.max(60, Math.min(140, Number(t.captionPopScale) || 100));
    var popMs = Math.max(0, Math.min(400, Number(t.captionPopMs) || 0));
    var popping = popScale !== 100 && popMs > 0;
    return 'color: ' + (t.captionHighlight || '#D9B478') + ';'
      + ' font-family: ' + webFontFor(t.captionHighlightFont) + ';'
      + (t.captionHighlightItalic ? ' font-style: italic;' : '')
      + (glow ? ' text-shadow: 0 0 ' + ((glow / 2) / fontPx).toFixed(3) + 'em ' + (t.captionHighlight || '#D9B478') + ';' : '')
      // display:inline-block, or transform does nothing on an inline box.
      + (popping ? ' display: inline-block; --dc-pop: ' + (popScale / 100).toFixed(3)
        + '; animation: dcCapPop ' + popMs + 'ms ease-out 1;' : '');
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
    var open = UI.railOpen && (global.innerWidth || 1280) > 820;
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

  /**
   * The operator's own entry in the rail.
   *
   * Two things worth being clear about:
   *
   * It is presentation, not access control. Hiding a link hides a link -- the
   * gate is server side, where every /owner route answers 404 to a signed-in
   * non-operator. If this check were ever the only thing standing between a
   * creator and the books, it would be worth nothing.
   *
   * It lives here rather than in the design file on purpose. The template is
   * regenerated wholesale from design/studio-dashboard.dc.html, so a nav item
   * added there survives exactly until someone edits the design; the adapter is
   * the half the import deliberately never touches.
   *
   * It leaves the studio rather than switching screens, because /owner is its
   * own page with its own shell.
   */
  function isOperator(DATA) {
    var role = String((DATA && DATA.user && DATA.user.role) || '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  function ownerNavItem() {
    // Built through navItem so it inherits the rail's exact metrics, collapsed
    // tooltip and hover behaviour. The key is one no screen uses, so it never
    // draws itself as the active item.
    var item = navItem('__owner', 'Owner', 'ph ph-coins', '');
    item.click = function (e) { stop(e); global.location.href = '/owner'; };
    return item;
  }

  var TITLES = {
    home: 'Home', queue: 'Review queue', library: 'Lecture library', schedule: 'Schedule',
    templates: 'Templates', music: 'Nasheed library', language: 'Arabic & terms',
    performance: 'Performance', editor: 'Clip editor \u00b7 BETA', tokens: 'Tokens & billing',
  };

  function sublineFor(screen, ctx) {
    // Honest label while the editor is rough: preview and edit feedback can
    // be slow, and saying so beats looking broken. Remove when it earns it.
    if (screen === 'editor') return 'Beta \u2014 sliders preview instantly; Save renders your changes onto the video';
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

  // The last state bindings painted with, for adapter entry points that run
  // outside a paint (openJob needs the template list to pick a default).
  var LAST_DATA = null;

  function bindings(DATA) {
    DATA = DATA || {};
    LAST_DATA = DATA;
    var projects = DATA.projects || [];
    var clips = DATA.clips || [];
    var tracks = DATA.tracks || [];
    var storage = DATA.storage || { sourceBytes: 0, clipBytes: 0 };
    var storageTotal = (storage.sourceBytes || 0) + (storage.clipBytes || 0);
    var signInSeen = false;
    // Sign-ins are auth bookkeeping, not studio activity: five "Signed in"
    // rows in a six-row feed buried everything the feed exists to surface.
    // The newest one stays (it answers "when was I last here?"); the rest go.
    var log = (DATA.log || []).filter(function (entry) {
      var isSignIn = /^Signed in /.test(String(entry.message || entry.text || ''));
      if (!isSignIn) return true;
      if (signInSeen) return false;
      signInSeen = true;
      return true;
    });
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

    // ── the five setup steps, worked out ONCE ──
    // These used to be spelled out four separate times -- for the label, for
    // whether to show the list, for the celebration, and for the rows -- so
    // they could disagree, and the last step disagreed with all of it.
    //
    // "Give a clip a time" asked whether a slot was still in the FUTURE, off a
    // list that already drops anything posted. Both halves expire: the slot
    // arrives, or the clip goes out. So the step un-ticked itself hours later
    // and the whole checklist came back to tell a working account it was not
    // set up yet -- and it came back again after every single post. Scheduling
    // is something you did, not a state you are in. Publishing is more than
    // scheduling, never less, so a posted clip counts too.
    var setupSteps = [
      { title: 'Upload a nasheed', note: 'Every clip mixes one in, so nothing finishes without it.',
        done: tracks.length > 0, go: 'music' },
      { title: 'Add your first lecture', note: 'Paste a link you may use, or upload an MP4.',
        done: projects.length > 0, go: 'home' },
      { title: 'Approve a clip', note: 'Nothing is published until you say so.',
        done: clips.some(function (c) { return decision(c) === 'approved'; }), go: 'queue' },
      { title: 'Connect somewhere to post', note: 'Without this, approved clips sit in their slots.',
        done: connectedCount > 0, go: 'connections' },
      { title: 'Give a clip a time', note: 'Press a free slot in the week, or Slot it.',
        done: clips.some(function (c) { return Boolean(c.scheduledAt || c.postedAt); }), go: 'schedule' },
    ];
    var setupDoneCount = setupSteps.filter(function (s) { return s.done; }).length;
    var setupAllDone = setupDoneCount === setupSteps.length;

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
        style: (c.templateName || '') + (c.renderQuality === 'draft' ? ((c.templateName ? ' \u00b7 ' : '') + 'draft') : ''),
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
          ? 'position: absolute; top: 8px; right: 38px; padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid ' +
            (st === 'rejected' ? '#3A2A2A; background: rgba(10,10,12,.85); color: #E3928C;' : 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: #7FD1A6;')
          : 'display: none;',
        selStyle: 'position: absolute; top: 8px; right: 8px; z-index: 3; display: grid; place-items: center; '
          + 'width: 22px; height: 22px; border-radius: 7px; cursor: pointer; transition: background .12s ease; border: 1px solid '
          + (UI.selClips[c.id]
            ? '#D9B478; background: rgba(217,180,120,.92); color: #0E0E11;'
            : 'rgba(255,255,255,.35); background: rgba(10,10,12,.6); color: transparent;'),
        toggleSel: function (e) {
          stop(e);
          if (e && e.stopPropagation) e.stopPropagation();
          var map = Object.assign({}, UI.selClips);
          if (map[c.id]) delete map[c.id]; else map[c.id] = true;
          setUI({ selClips: map });
        },
        primaryLabel: st === 'rejected' ? 'Restore' : st === 'approved' ? 'Approved' : 'Approve',
        primaryIcon: st === 'rejected' ? 'ph ph-arrow-u-up-left' : st === 'approved' ? 'ph-fill ph-check-circle' : 'ph ph-check',
        primaryStyle: 'display: flex; align-items: center; justify-content: center; gap: 6px; flex: 1; padding: 7px 10px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid ' +
          (st === 'approved' ? 'rgba(127,209,166,.4); background: rgba(127,209,166,.1); color: #7FD1A6;' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'),
        approve: function (e) { stop(e); approve(c.id); },
        primary: st === 'rejected'
          ? function (e) { stop(e); global.StudioAdapter.onRestore(c.id); }
          : function (e) { stop(e); approve(c.id); },
        reject: function (e) { stop(e); reject(c.id); },
        // Approve / edit / reject is the card's action row; `third` is reject.
        third: function (e) { stop(e); reject(c.id); },
        thirdIcon: 'ph ph-x',
        edit: function (e) { stop(e); setUI({ screen: 'editor', edClipId: c.id, edStyleDraft: null, edBlockDraft: null, edBlock: 0, edTime: 0, edPlayhead: 0 }); },
        openLecture: function (e) { stop(e); setUI({ screen: 'detail', openProject: c.projectId }); },
      };
    }

    function approve(id) {
      UI.pending[id] = 'approved';
      refresh();
      global.StudioAdapter.onApprove(id);
    }
    // Rejecting persists AND is reversible: the clip takes a `rejected` status
    // through agent.rejectClip, so a reviewed batch survives a reload and can
    // be restored. Nothing is destroyed -- the render stays
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
      if (q && ((p.title || '') + ' ' + (p.url || '')).toLowerCase().indexOf(q) === -1) return false;
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
        selStyle: 'position: absolute; top: 9px; right: 9px; z-index: 3; display: grid; place-items: center; '
          + 'width: 22px; height: 22px; border-radius: 7px; cursor: pointer; transition: background .12s ease; border: 1px solid '
          + (UI.selLecs[p.id]
            ? '#D9B478; background: rgba(217,180,120,.92); color: #0E0E11;'
            : 'rgba(255,255,255,.35); background: rgba(10,10,12,.6); color: transparent;'),
        toggleSel: function (e) {
          stop(e);
          // The card itself opens the lecture on click; a selection tap must
          // not also navigate.
          if (e && e.stopPropagation) e.stopPropagation();
          var map = Object.assign({}, UI.selLecs);
          if (map[p.id]) delete map[p.id]; else map[p.id] = true;
          setUI({ selLecs: map });
        },
        more: function (e) {
          stop(e);
          // Retry is offered on exactly the lectures it can help. The route has
          // always existed; its only button lived in a shell nothing links to,
          // while the failure messages went on telling people to "press Retry".
          var failed = String(p.status || '') === 'failed';
          var options = failed ? ['Retry this lecture'] : [];
          options = options.concat(['Cut 4 more clips', 'Cut 8 more clips', 'Delete this lecture', 'Cancel']);
          global.StudioAdapter.onPickOption('This lecture', options, function (choice) {
            var n = choice === 'Cut 4 more clips' ? 4 : choice === 'Cut 8 more clips' ? 8 : 0;
            if (choice === 'Retry this lecture') global.StudioAdapter.onRetryProject(p.id, p.title || 'this lecture');
            else if (n) global.StudioAdapter.onMoreClips(p.id, n);
            else if (choice === 'Delete this lecture') global.StudioAdapter.onDeleteProject(p.id, p.title || 'this lecture');
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
            // Why the last attempt failed, said ON the row. The reason lived
            // only in the activity feed, so the schedule showed "missed its
            // slot" with 4/4 checks green and no way to learn that the file
            // was too large for the publishing relay.
            var failedTarget = (c.targets || []).filter(function (t) { return t.status === 'failed' && t.error; })[0];
            return {
              failReason: failedTarget ? String(failedTarget.error) : '',
              time: timeOf(c.scheduledAt),
              dest: PLATFORM_NAMES[platform] || 'No account',
              icon: platform === 'youtube' ? 'ph ph-youtube-logo' : platform === 'instagram' ? 'ph ph-instagram-logo' : platform === 'tiktok' ? 'ph ph-tiktok-logo' : 'ph ph-share-network',
              caption: c.title || '',
              score: c.score || '',
              duration: secsToClock((c.durationMs || 0) / 1000),
              thumbStyle: 'width: 42px; height: 58px; flex: none; border-radius: 7px; border: 1px solid #26262A;'
                + ' box-shadow: inset 0 0 0 1px rgba(0,0,0,.4); background: ' + thumb(c.thumbUrl) + ';',
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

    // ── the schedule, as a calendar ───────────────────────────────────
    // Seven day sections stacked down the page made a week a scroll and put a
    // month out of reach entirely. The same clips at three densities: a month
    // seen at once, a week beside itself, and one day in full.
    var SCHED_VIEWS = ['day', 'week', 'month'];
    var schedView = SCHED_VIEWS.indexOf(UI.schedView) === -1 ? 'month' : UI.schedView;
    var schedAnchor = startOfDay(Number(UI.schedAnchor) || today);
    var MONDAY_INDEX = function (ms) { return (new Date(ms).getDay() + 6) % 7; };
    var weekStart = schedAnchor - MONDAY_INDEX(schedAnchor) * DAY_MS;

    function dayItemsAt(dayStart) {
      return scheduled.filter(function (c) { return startOfDay(c.scheduledAt) === dayStart; });
    }
    function dayNameOf(dayStart) {
      return dayStart === today ? 'Today'
        : dayStart === today + DAY_MS ? 'Tomorrow'
        : dayStart === today - DAY_MS ? 'Yesterday'
        : new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long' });
    }
    function dateOf(dayStart, opts) {
      return new Date(dayStart).toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short' });
    }
    // The picked day travels with the clip now; the allocator puts it in the
    // first free posting time on that day. Every day's button used to call the
    // same allocator with no day at all, so it landed wherever was next free --
    // a button that named a day it could not honour.
    function addClipTo(dayStart) {
      return function (e) {
        stop(e);
        if (dayStart < today) { toast('That day has already passed.'); return; }
        var free = clips.filter(function (c) { return decision(c) === 'approved' && !c.scheduledAt && !c.postedAt; });
        if (!free.length) { toast('Approve a clip in the review queue first.'); return; }
        var labels = free.slice(0, 6).map(function (c) { return (c.title || 'Clip').slice(0, 46); });
        global.StudioAdapter.onPickOption('Schedule into ' + dayNameOf(dayStart) + ', ' + dateOf(dayStart), labels.concat(['Cancel']), function (choice) {
          var picked = free.filter(function (c) { return (c.title || 'Clip').slice(0, 46) === choice; })[0];
          if (picked) global.StudioAdapter.onScheduleClip(picked.id, { day: dayStart });
        });
      };
    }

    // ── month ──
    var anchorDate = new Date(schedAnchor);
    var monthFirst = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1).getTime();
    var gridStart = monthFirst - MONDAY_INDEX(monthFirst) * DAY_MS;
    var daysInMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
    var weeksNeeded = Math.ceil((MONDAY_INDEX(monthFirst) + daysInMonth) / 7);
    var schedMonthWeeks = [];
    for (var wk = 0; wk < weeksNeeded; wk += 1) {
      (function (rowStart) {
        var cells = [];
        for (var cd = 0; cd < 7; cd += 1) {
          (function (ds) {
            var items = dayItemsAt(ds);
            var inMonth = new Date(ds).getMonth() === anchorDate.getMonth();
            var isToday = ds === today;
            var past = ds < today;
            cells.push({
              date: String(new Date(ds).getDate()),
              style: 'position: relative; display: flex; flex-direction: column; gap: 3px; height: 100%; min-height: 62px; padding: 5px 7px 6px;'
                + ' border: 1px solid ' + (isToday ? 'rgba(240,214,166,.45)' : '#1C1C21') + '; border-radius: 10px;'
                + ' background: ' + (isToday ? 'rgba(217,180,120,.05)' : inMonth ? '#141418' : '#0F0F12') + ';'
                + ' text-align: left; font-family: inherit; cursor: pointer;'
                + ' opacity: ' + (!inMonth ? '.4' : past ? '.6' : '1') + '; transition: border-color .14s ease, background .14s ease;',
              dateStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 11.5px; font-weight: ' + (isToday ? '700' : '500') + ';'
                + ' color: ' + (isToday ? '#F0D6A6' : past ? '#5E5E66' : '#9A9AA2') + '; font-variant-numeric: tabular-nums;',
              // One pip per post the day can hold, filled for each one taken:
              // the day's load without a number to read.
              pips: (items.length || (!past && inMonth)) ? [0, 1, 2, 3].map(function (n) {
                return { style: 'display: block; width: 5px; height: 5px; border-radius: 50%;'
                  + ' background: ' + (n < items.length ? '#D9B478' : '#212127') + ';' };
              }) : [],
              chips: items.slice(0, 3).map(function (c) {
                return {
                  label: timeOf(c.scheduledAt) + '  ' + String(c.title || 'Clip'),
                  rowStyle: 'display: flex; align-items: center; gap: 5px; min-width: 0;',
                  thumbStyle: 'width: 12px; height: 21px; flex: none; border-radius: 3px; border: 1px solid #26262A;'
                    + ' background: ' + thumb(c.thumbUrl) + ';',
                  style: 'display: block; font-size: 10.5px; line-height: 1.35; color: #BCBCC3;'
                    + ' white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
                };
              }),
              moreLabel: items.length > 3 ? '+' + (items.length - 3) + ' more' : '',
              hasMore: items.length > 3,
              open: function (e) { stop(e); setUI({ schedView: 'day', schedAnchor: ds }); },
            });
          })(rowStart + cd * DAY_MS);
        }
        schedMonthWeeks.push({ cells: cells });
      })(gridStart + wk * 7 * DAY_MS);
    }

    // ── week ──
    // Drawn as the posting windows themselves: four rows, seven columns, one
    // cell per slot the account actually has. As bare columns an empty Tuesday
    // and a Tuesday with no windows left looked identical -- blank space --
    // and there was nothing to press to fill one.
    var slotTimes = (DATA.postTimes || []).slice();
    // A posting time is a wall clock in the ACCOUNT's zone -- src/slots.js
    // builds every real slot with wallToInstant against config.timezone. Built
    // with the browser's setHours instead, the cells only lined up for someone
    // sitting in that same zone; for anyone else no clip ever matched its slot,
    // every cell rendered empty, the clips fell into the appended Other row,
    // and pressing a cell sent an instant that was not a posting time at all.
    // This mirrors slots.js rather than assuming an offset.
    var SCHED_TZ = DATA.timezone || 'Australia/Perth';
    function zoneOffset(ms) {
      var p = new Intl.DateTimeFormat('en-US', {
        timeZone: SCHED_TZ, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(ms)).reduce(function (acc, part) {
        if (part.type !== 'literal') acc[part.type] = Number(part.value);
        return acc;
      }, {});
      return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ms;
    }
    function wallToInstant(y, m, d, hh, mm) {
      var guess = Date.UTC(y, m - 1, d, hh, mm, 0);
      var ms = guess - zoneOffset(guess);
      // Run once more so a daylight-saving boundary lands correctly.
      return guess - zoneOffset(ms);
    }
    function zonedYMD(ms) {
      var p = new Intl.DateTimeFormat('en-CA', {
        timeZone: SCHED_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(ms)).split('-');
      return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
    }
    function instantOn(dayStart, hhmm) {
      var parts = String(hhmm).split(':');
      var ymd = zonedYMD(dayStart);
      return wallToInstant(ymd.y, ymd.m, ymd.d, Number(parts[0]) || 0, Number(parts[1]) || 0);
    }
    function addClipAt(at) {
      return function (e) {
        stop(e);
        if (at < Date.now()) { toast('That slot has already passed.'); return; }
        var free = clips.filter(function (c) { return decision(c) === 'approved' && !c.scheduledAt && !c.postedAt; });
        if (!free.length) { toast('Approve a clip in the review queue first.'); return; }
        var labels = free.slice(0, 6).map(function (c) { return (c.title || 'Clip').slice(0, 46); });
        global.StudioAdapter.onPickOption('Schedule for ' + timeOf(at) + ' on ' + dayNameOf(startOfDay(at)), labels.concat(['Cancel']), function (choice) {
          var picked = free.filter(function (c) { return (c.title || 'Clip').slice(0, 46) === choice; })[0];
          if (picked) global.StudioAdapter.onScheduleClip(picked.id, { at: at });
        });
      };
    }
    var weekDayStarts = [];
    for (var wds = 0; wds < 7; wds += 1) weekDayStarts.push(weekStart + wds * DAY_MS);
    var slotInstants = {};
    var schedWeekRows = slotTimes.map(function (t) {
      return {
        label: t,
        cells: weekDayStarts.map(function (ds) {
          var at = instantOn(ds, t);
          slotInstants[at] = true;
          var held = scheduled.filter(function (c) { return Number(c.scheduledAt) === at; })[0];
          var past = at < Date.now();
          return {
            filled: Boolean(held),
            free: !held && !past,
            title: held ? String(held.title || 'Clip') : '',
            style: 'position: relative; display: flex; flex-direction: column; justify-content: flex-end; flex: 1 1 0; min-width: 0;'
              + ' height: 100%; min-height: 56px; padding: 6px 7px; border-radius: 9px; overflow: hidden; text-align: left; font-family: inherit; cursor: '
              + (held || !past ? 'pointer' : 'default') + ';'
              + ' border: 1px ' + (held ? 'solid #26262E' : past ? 'solid #161619' : 'dashed #232329') + ';'
              + (held && held.thumbUrl
                ? ' background-image: linear-gradient(to bottom, rgba(8,8,10,.15) 30%, rgba(8,8,10,.88) 100%), url("' + cssUrl(held.thumbUrl) + '");'
                  + ' background-size: cover, cover; background-position: center, center 28%; background-color: #17171A;'
                : ' background: ' + (held ? '#1B1B21' : 'transparent') + ';')
              + ' opacity: ' + (past && !held ? '.45' : '1') + '; transition: border-color .14s ease, background .14s ease;',
            titleStyle: 'font-size: 11px; line-height: 1.25; color: #F2F2F4; text-shadow: 0 1px 3px rgba(0,0,0,.8);'
              + ' display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;',
            act: held
              ? (function (d) { return function (e) { stop(e); setUI({ schedView: 'day', schedAnchor: d }); }; })(ds)
              : past ? function (e) { stop(e); } : addClipAt(at),
          };
        }),
      };
    });
    // Anything in this week that is not on one of the account's posting times --
    // an older slot, or a time since changed. It has to be somewhere.
    var strays = scheduled.filter(function (c) {
      var at = Number(c.scheduledAt);
      return at >= weekStart && at < weekStart + 7 * DAY_MS && !slotInstants[at];
    });
    if (strays.length) {
      schedWeekRows.push({
        label: 'Other',
        cells: weekDayStarts.map(function (ds) {
          var held = strays.filter(function (c) { return startOfDay(c.scheduledAt) === ds; })[0];
          return {
            filled: Boolean(held),
            free: false,
            title: held ? timeOf(held.scheduledAt) + '  ' + String(held.title || 'Clip') : '',
            style: 'display: flex; flex-direction: column; justify-content: center; gap: 2px; flex: 1 1 0; min-width: 0;'
              + ' height: 46px; padding: 6px 8px; border-radius: 9px; text-align: left; font-family: inherit;'
              + ' border: 1px solid ' + (held ? '#26262E' : 'transparent') + '; background: ' + (held ? '#1B1B21' : 'transparent') + ';'
              + ' cursor: ' + (held ? 'pointer' : 'default') + ';',
            titleStyle: 'font-size: 11px; line-height: 1.3; color: #E9E9ED; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
            act: held
              ? (function (d) { return function (e) { stop(e); setUI({ schedView: 'day', schedAnchor: d }); }; })(ds)
              : function (e) { stop(e); },
          };
        }),
      });
    }

    // ── day ──
    var schedDayItems = dayItemsAt(schedAnchor).map(scheduleItem);

    // ── what the rail reports ──
    var schedTodayCount = dayItemsAt(today).length;
    var nextOut = scheduled.filter(function (c) { return Number(c.scheduledAt) > Date.now(); })
      .sort(function (a, b) { return Number(a.scheduledAt) - Number(b.scheduledAt); })[0] || null;
    var waitingForSlot = clips.filter(function (c) {
      return decision(c) === 'approved' && !c.scheduledAt && !c.postedAt;
    });
    function untilLabel(at) {
      var ms = Math.max(0, Number(at) - Date.now());
      var mins = Math.round(ms / 60000);
      if (mins < 60) return mins <= 1 ? 'in about a minute' : 'in ' + mins + ' min';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return 'in ' + hrs + 'h ' + (mins % 60) + 'm';
      var days = Math.round(hrs / 24);
      return 'in ' + plural(days, 'day');
    }

    var schedRangeLabel = schedView === 'month'
      ? new Date(schedAnchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : schedView === 'week'
        ? dateOf(weekStart) + ' \u2013 ' + dateOf(weekStart + 6 * DAY_MS)
        : dayNameOf(schedAnchor) + ', ' + dateOf(schedAnchor);

    function shiftAnchor(dir) {
      return function (e) {
        stop(e);
        if (schedView === 'day') { setUI({ schedAnchor: schedAnchor + dir * DAY_MS }); return; }
        if (schedView === 'week') { setUI({ schedAnchor: schedAnchor + dir * 7 * DAY_MS }); return; }
        var d = new Date(schedAnchor);
        setUI({ schedAnchor: new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime() });
      };
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

    var musicVolume = UI.volumeDraft != null
      ? UI.volumeDraft
      : Number((DATA.musicSettings || {}).volumePercent || 0);
    // The server refuses anything outside 1-50, and the sliders offered 0-60:
    // dragging to either end returned a 400 and the level silently stayed put.
    var VOL_MIN = 1, VOL_MAX = 50;
    function setVolumeFrom(e) {
      var n = Math.max(VOL_MIN, Math.min(VOL_MAX, Math.round(Number(e && e.target && e.target.value) || 0)));
      setUI({ volumeDraft: n });
      saveVolumeSoon(n);
    }

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
    // In the editor the base is THIS clip's template. The render always uses
    // the clip's template; previewing on the selected one showed a different
    // style than the export whenever the two differed.
    if (UI.screen === 'editor' && edClipRecord) {
      // The freshly picked template wins over the clip's stored one until the
      // re-render lands, so the preview answers the pick immediately.
      var pinnedId = UI.edTplId || edClipRecord.templateId;
      if (pinnedId) activeTemplate = templates.filter(function (t) { return t.id === pinnedId; })[0] || activeTemplate;
    }

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
      // Local paint, not refresh(): the server fetch skips repainting when
      // nothing changed remotely, which is exactly the case mid-slider -- the
      // approximate echo must move the instant the control does.
      paintNow();
      if (UI.edStyleTimer) global.clearTimeout(UI.edStyleTimer);
      UI.edStyleTimer = global.setTimeout(function () {
        UI.edStyleTimer = null;
        // The draft is NOT cleared on send. Clearing it here opened a gap --
        // between this PATCH and /api/state returning, tpl fell back to the
        // clip's old overrides, so a dragged caption visibly snapped back to
        // its old place and then jumped forward again a second later. The
        // draft stays as the local truth; the server's copy merges underneath
        // it, and it is discarded when the editor closes or changes clip.
        global.StudioAdapter.onClipStyle(UI.edClipId, Object.assign({}, UI.edStyleDraft));
      }, 450);
    }

    // One decision, made once: the Templates screen edits the style everything
    // shares, the clip editor edits a single clip. Every control below calls
    // this, so no control can be wired to the wrong target by accident.
    //
    // History is recorded HERE, not in saveTemplate: recording only there left
    // the editor with an always-empty stack, so its Undo button silently did
    // nothing -- the exact dead control the button was meant to replace. One
    // stack serves both screens, so it is cleared whenever the target changes
    // (template screen <-> a clip, or one clip to another): replaying a
    // template step onto a clip would write the wrong record.
    // Paint locally, immediately. refresh() asks the SERVER for news and
    // repaints only when the rev moved -- correct for data changes, silently
    // wrong for pure-UI ones: typing a caption or dragging the ghost only
    // repainted when unrelated server churn happened to bump the rev, which
    // is why the drag tracked during render storms and froze on quiet days.
    function paintNow() {
      if (global.StudioAdapter && typeof global.StudioAdapter.paintLocal === 'function') global.StudioAdapter.paintLocal();
      else refresh();
    }

    function saveStyle(patch) {
      var ctx = (UI.screen === 'editor' && UI.edClipId)
        ? 'clip:' + UI.edClipId
        : 'tpl:' + (activeTemplate && activeTemplate.id);
      if (UI.tplHistCtx !== ctx) { UI.tplHistCtx = ctx; UI.tplPast = []; UI.tplFuture = []; }
      // Skipped while replaying, or undoing would push its own inverse and the
      // two buttons would fight each other.
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
      // A caption edit is not a style patch, so it cannot go through saveStyle.
      // It used to not go anywhere at all: undo covered sliders and colours and
      // silently ignored the words, which is the half of the editor people
      // actually retype.
      if (step.kind === 'text') {
        UI.edBlockDraft = step[which].draft;
        UI.edDirty = true;
        UI.capTextStepAt = 0;
        paintNow();
        return;
      }
      UI.tplReplaying = true;
      try { saveStyle(Object.assign({}, step[which])); } finally { UI.tplReplaying = false; }
    }

    // Typing produces one undo step per burst, not one per keystroke. Fifty
    // steps to walk back a single word is the same as having no undo.
    var TEXT_STEP_GAP_MS = 1200;
    function recordTextStep(block, before, after) {
      if (!block || before === after) return;
      var ctx = 'clip:' + UI.edClipId;
      if (UI.tplHistCtx !== ctx) { UI.tplHistCtx = ctx; UI.tplPast = []; UI.tplFuture = []; }
      var last = UI.tplPast[UI.tplPast.length - 1];
      var continues = last && last.kind === 'text' && last.blockId === block.id
        && (Date.now() - (UI.capTextStepAt || 0)) < TEXT_STEP_GAP_MS;
      if (continues) { last.redo.draft = after; }
      else {
        UI.tplPast = UI.tplPast.concat([{
          kind: 'text', blockId: block.id,
          undo: { draft: before }, redo: { draft: after },
        }]).slice(-50);
        UI.tplFuture = [];
      }
      UI.capTextStepAt = Date.now();
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
        // The overlay is CENTRED on the cursor while dragging, but the style
        // it commits anchors the caption's EDGE, because MarginV measures
        // edge-to-edge the way libass does. Committing the centre as if it
        // were the edge moved the box by half its own height the moment it
        // was released -- a 17px hop on a real drag. The box's half-height,
        // as a fraction of the frame, converts one anchor into the other.
        var halfFrac = 0;
        if (from && from.getBoundingClientRect) {
          var self = from.getBoundingClientRect();
          if (self.height) halfFrac = (self.height / 2) / box.height;
        }

        UI.dragKind = kind;
        var lastX = null; var lastY = null;
        function move(ev) {
          var y = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
          var x = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
          lastX = x; lastY = y;
          // Held so the guides can show where it is and whether it has caught a
          // line.
          UI.dragAt = kind === 'caption' ? Math.max(SAFE_TOP, Math.min(SAFE_BOTTOM, y)) : y;
          var hit = snapAt(UI.dragAt);
          UI.dragSnapped = Boolean(hit);
          UI.dragSnapName = hit ? hit.name : '';
          // Preview only. Writing the style on every move meant a debounced
          // PATCH landing mid-drag, and the /api/state that came back replaced
          // the position under the cursor -- the caption visibly snapping back
          // to where the server last knew it. The style is written once, on
          // release, and until then the overlay follows this.
          // The ghost shows the SNAPPED position: what you see during the
          // drag is exactly what release commits, so letting go never moves
          // the caption. The raw position still drives the guides.
          UI.dragPreview = { kind: kind, x: x, y: (kind === 'caption' && hit) ? hit.at : UI.dragAt };
          paintNow();
        }
        function up() {
          var x = lastX; var y = lastY;
          UI.dragKind = null;
          UI.dragAt = null;
          UI.dragSnapped = false;
          UI.dragSnapName = '';
          UI.dragPreview = null;
          global.removeEventListener('mousemove', move);
          global.removeEventListener('mouseup', up);
          // One write, with the position the pointer actually finished on.
          if (x !== null && y !== null) apply(x, y, halfFrac); else refresh();
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
    // 2% of the frame: a magnet you feel only when genuinely close to a
    // line. At 3.5% a release could relocate the caption ~67px on the render
    // -- read as "it jumped somewhere random".
    var SNAP_WITHIN = 0.02;

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
    var dragCaptionFrom = makeDrag('caption', function (x, y, halfFrac) {
      var height = Number(tpl.height || 1920);
      // Clamped to the safe box: a caption outside it is covered by the
      // platform's own chrome, so letting it go there only produces clips with
      // hidden words.
      var snappedY = snapped(Math.max(SAFE_TOP, Math.min(SAFE_BOTTOM, y)));
      // An ayah is a long line that needs the frame's whole width. Snapping it
      // to an edge leaves a narrow column, and the render wraps scripture into
      // three cramped lines against the side of the picture -- which is what a
      // single stray drag did to a finished Quran clip. Vertical position is
      // still free; the horizontal answer for scripture is always centre.
      var align = tpl.captionMode === 'quran'
        ? 'center'
        : (x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center');

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
      // snappedY is the box's CENTRE (the point the ghost held under the
      // cursor); MarginV wants the near EDGE. Half the box converts them.
      var fromEdge = (top ? snappedY : 1 - snappedY) - (halfFrac || 0);
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
    // Clip length in seconds. Everything on the timeline is a fraction of this,
    // so a zero would divide the whole editor by zero; 1 is the floor.
    var edDuration = Math.max(1, edClip ? (edClip.durationMs || 0) / 1000 : 1);
    var edTime = Math.max(0, Math.min(edDuration, Number(UI.edTime) || 0));
    // Which block is being spoken *now*. This is what the preview overlay shows,
    // so the caption on screen follows the video instead of showing whichever
    // block was last clicked. Blocks without timings (the flat-transcript
    // fallback) can never match, so selection stays the answer for those.
    var edLiveIndex = -1;
    for (var bi = 0; bi < rawBlocks.length; bi++) {
      var rb = rawBlocks[bi];
      if (rb.start !== null && rb.start !== undefined && edTime >= rb.start && edTime < rb.end) { edLiveIndex = bi; break; }
    }
    // The ayahs the renderer matched, if this clip has recitation in it. A block
    // that overlaps one is shown as the ayah rather than as Whisper's
    // transcription of it -- the editor showed "40." while the export showed the
    // verse, which made the editor look wrong about its own clip.
    var edAyahs = (edClip && Array.isArray(edClip.ayahs)) ? edClip.ayahs : [];
    function ayahAt(block) {
      if (!edAyahs.length || block.start === null || block.start === undefined) return null;
      var mid = (block.start + block.end) / 2;
      for (var a = 0; a < edAyahs.length; a++) {
        if (edAyahs[a].start <= mid && mid < edAyahs[a].end) return edAyahs[a];
      }
      return null;
    }

    var edCaptionBlocks = rawBlocks.map(function (block, i) {
      var on = UI.edBlock === i;
      var live = edLiveIndex === i;
      var timed = block.start !== null && block.start !== undefined;
      var verse = ayahAt(block);
      return {
        // The Quran's own words when this moment is an ayah, and a flag so the
        // panel can say the text is scripture rather than an editable line.
        text: verse ? verse.arabic : block.text,
        // What Whisper heard, kept alongside the display text. Saving used to
        // join the display text, so opening a recitation clip and pressing
        // Save replaced the transcript with the matched ayahs -- each verse
        // repeated once per block -- and marked the clip edited. Every later
        // re-render then had no real timings to caption against.
        sourceText: block.text,
        // The lane sizes a block by its seconds, so most show two or three
        // letters -- unreadable as labels. The full words ride the native
        // tooltip instead of widening the block and breaking the timeline.
        hover: (timed ? secsToClock(block.start) + ' \u2013 ' + secsToClock(block.end) + '  ' : '')
          + String((verse ? verse.arabic : block.text) || ''),
        ayah: verse || null,
        translation: verse ? verse.translation : '',
        // A block with real timings can say when it is; a fallback one cannot.
        time: timed ? secsToClock(block.start) + ' – ' + secsToClock(block.end) : '',
        // Placed by its own start and duration, so the lane reads as a timeline
        // rather than as a stack of paragraphs. They were laid out in flow, so
        // seventeen blocks wrapped into rows that spilled past the timeline and
        // out the bottom of the editor. Untimed blocks (the flat-transcript
        // fallback) get equal slices, which is the best a list of untimed
        // sentences can honestly claim.
        style: 'position: absolute; top: 0; bottom: 0; box-sizing: border-box; '
          + 'left: ' + (timed ? (block.start / edDuration) * 100 : (i / rawBlocks.length) * 100).toFixed(3) + '%; '
          + 'width: ' + (timed
            ? Math.max(0.6, ((block.end - block.start) / edDuration) * 100)
            : 100 / rawBlocks.length).toFixed(3) + '%; '
          + 'display: flex; align-items: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; '
          + 'padding: 0 8px; border-radius: 7px; cursor: pointer; font-size: 12px; '
          + 'background: ' + (live ? 'rgba(217,180,120,.22)' : '#121214') + '; border: 1px solid '
          + (live ? 'rgba(240,214,166,.9)' : on ? 'rgba(217,180,120,.55)' : '#1E1E22') + ';',
        // Selecting a block also moves the playhead to it: on a timeline,
        // clicking a caption means "take me there", and editing the text of a
        // moment you cannot see is the thing that made this editor feel dead.
        select: function (e) {
          stop(e);
          var next = { edBlock: i, edBlockDraft: null };
          if (timed) { next.edTime = block.start; next.edPlayhead = block.start / edDuration; }
          setUI(next);
          if (timed) seekHost(block.start);
        },
      };
    });
    // The block whose text the side panel edits: the live one while playing, the
    // clicked one otherwise. Without this the panel edits block 0 forever while
    // the video runs past it.
    var selectedBlock = edCaptionBlocks[UI.edBlock] || null;
    // While the person is TYPING, the ghost shows the caption being edited --
    // not whichever block the paused playhead happens to sit in. The draft
    // only ever displayed when those two were the same block, so edits to any
    // other caption were invisible in the preview and the box looked dead.
    var overlayBlock = (UI.edBlockDraft !== null && UI.edBlockDraft !== undefined && selectedBlock)
      ? selectedBlock
      : edLiveIndex >= 0 ? edCaptionBlocks[edLiveIndex] : selectedBlock;

    // The phrase of the ayah under the playhead, split exactly the way the
    // export splits it: at most five words, spans shared in proportion to
    // phrase length, the translation sliced in the same proportions. Computed
    // once here because both the Arabic line and the gloss line need the SAME
    // slice -- the overlay previously showed the whole ayah and the whole
    // translation, a wall of text the render never draws.
    var edAyahPhrase = (function () {
      if (!overlayBlock || !overlayBlock.ayah) return null;
      var verse = overlayBlock.ayah;
      var aWords = String(verse.arabic || '').split(/\s+/).filter(Boolean);
      var gWords = String(verse.translation || '').split(/\s+/).filter(Boolean);
      // The end-of-ayah mark and its verse number, joined to the final word the
      // way the export joins them (quran.ornament_for). The renderer shows the
      // mark once, on the ayah's last phrase; the preview does the same, and
      // the painter sets it at the export's own larger size.
      var digits = '٠١٢٣٤٥٦٧٨٩';
      // The HAFS face medallions a bare digit run by itself; U+06DD beside it
      // draws a second, empty ring. Amiri wants the mark then the digits.
      var hafs = (tpl.captionArabicFont || 'Amiri') === 'KFGQPC HAFS Uthmanic Script';
      var mark = verse.ayah
        ? '\u00A0' + (hafs ? '' : '\u06DD') + String(verse.ayah).split('').map(function (d) { return digits[Number(d)] || d; }).join('')
        : '';
      var MAXW = 5;
      var count = Math.max(1, Math.ceil(aWords.length / MAXW));
      if (count === 1) return { text: verse.arabic + mark, gloss: verse.translation || '' };
      var span = Math.max(0.4, (verse.end - verse.start) || 1);
      var through = Math.max(0, Math.min(0.999, (edTime - verse.start) / span));
      var sizeBase = Math.floor(aWords.length / count);
      var extra = aWords.length % count;
      var acc = 0; var taken = 0; var gTaken = 0;
      for (var ci = 0; ci < count; ci++) {
        var size = sizeBase + (ci < extra ? 1 : 0);
        var gSize = ci < count - 1 ? Math.round(gWords.length * size / aWords.length) : gWords.length - gTaken;
        var share = size / aWords.length;
        if (through < acc + share || ci === count - 1) {
          return {
            text: aWords.slice(taken, taken + size).join(' ') + (ci === count - 1 ? mark : ''),
            gloss: gWords.slice(gTaken, gTaken + Math.max(0, gSize)).join(' '),
          };
        }
        acc += share; taken += size; gTaken += Math.max(0, gSize);
      }
      return { text: verse.arabic + mark, gloss: verse.translation || '' };
    }());

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
    // Mid-drag the caption follows the pointer, not the saved style: the style
    // is only written on release, so without this the overlay would sit still
    // while being dragged.
    var edCapDragY = UI.dragPreview && UI.dragPreview.kind === 'caption' ? UI.dragPreview.y : null;

    // Only the steps whose anchor is actually on screen. A tour that points at
    // an element this account has not got -- an empty library has no cards --
    // would spotlight nothing at all, and no test would notice.
    var tourSteps = (TOURS[UI.screen] || []).filter(function (step) {
      // Off a browser there is nothing to measure, so the model is the answer:
      // filtering here would make every tour vanish under test and hide the
      // very thing these steps are checked for.
      if (!global.document) return true;
      var el = tourAnchorEl(step.anchor);
      if (!el || !el.getBoundingClientRect) return false;
      var box = el.getBoundingClientRect();
      return Boolean(box.width && box.height);
    });

    // Each screen carries its own tour and its own memory of having shown it.
    //
    // Bindings are computed BEFORE the new screen's markup reaches the
    // document, so on the paint that changes screen every anchor still belongs
    // to the screen being left. Deciding then would file the tour away as
    // "nothing to show" and never look again -- so the decision waits until the
    // anchors are visible, and one repaint is scheduled to make them so.
    // Nothing starts a tour while another layer already owns the screen. A
    // brand-new browser used to get the old dashboard's six-step modal AND a
    // screen tour veiling it from above -- two overlays at once, and no way
    // through either.
    var otherLayerOpen = Boolean(UI.job || UI.playerClip || UI.sheet || UI.connProvider);
    var hasTour = !otherLayerOpen && (TOURS[UI.screen] || []).length > 0;
    var anchorsReady = !global.document || tourSteps.length > 0;
    if (global.document && hasTour && !anchorsReady && UI.tourSettled !== UI.screen) {
      UI.tourSettled = UI.screen;
      global.setTimeout(function () { refresh(); }, 0);
    }
    // An explicit start (startTour, tourHere) sets the pair together, so the
    // screen already matches and nothing is re-decided under it.
    if (UI.tourScreen !== UI.screen && (anchorsReady || !hasTour)) {
      UI.tourScreen = UI.screen;
      UI.tourStep = (tourSteps.length && !tourSeen(UI.screen)) ? 0 : -1;
    }
    if (UI.tourStep === undefined) UI.tourStep = -1;
    var tourIndex = Math.max(0, Math.min(Math.max(0, tourSteps.length - 1), Number(UI.tourStep)));
    var tourOn = Number(UI.tourStep) >= 0 && tourSteps.length > 0 && !otherLayerOpen;
    var tourStep = tourOn ? tourSteps[tourIndex] : null;
    var tourRect = null;
    if (tourOn) {
      var anchorEl = tourAnchorEl(tourStep.anchor);
      if (anchorEl && anchorEl.getBoundingClientRect) {
        var r = anchorEl.getBoundingClientRect();
        if (r.width && r.height) tourRect = r;
      }
    }
    function endTour() { markTourSeen(UI.screen); setUI({ tourStep: -1 }); }
    // Set by the host only when the rendered file fails to play.
    var edSourceFallback = Boolean(UI.edSourceFallback);

    var job = UI.job;
    // A nasheed under Quran recitation is not a style choice, so the Quran
    // template starts with it off. Still a toggle -- once the operator touches
    // it their answer stands -- but the default follows the template rather
    // than mixing music under scripture because that is the global default.
    var jobTemplateMode = activeTemplate ? activeTemplate.captionMode : '';
    var jobMusicOn = UI.jobMusicTouched
      ? UI.jobMusic !== false
      : (jobTemplateMode === 'quran' ? false : UI.jobMusic !== false);
    // What kind of content this job is. Two kinds, one template each: the
    // picker on the token page chooses the kind, and the kind chooses the
    // template -- when more templates exist they will be added per kind, so
    // the kind is the primary axis and the template follows it.
    var jobTypeQuran = jobTemplateMode === 'quran';
    var tokenRate = Number((DATA.billing && DATA.billing.tokenRatePerMinute) || 1);

    // The connection the modal is showing, if any.
    var conn = UI.connProvider ? byKey[UI.connProvider] : null;

    // Everything actually in flight: lectures, extra-clip runs, re-renders and
    // uploads to a platform. Watching projects alone missed most of it.
    //
    // An ETA for every bar: when the server has none, it is computed from how
    // fast the percentage is actually moving (rate over the last few minutes
    // of samples). Honest by construction -- a stalled job shows no ETA
    // rather than a fantasy one.
    // A stage model, not a trend line. The old estimator extrapolated the
    // whole job from how fast the global percentage moved -- and the import
    // holds 3% for minutes, so "5 min left" grew into "2h left" while the job
    // was perfectly healthy. Nothing here extrapolates: each stage's cost
    // comes from the source length and clip count at rates measured on the
    // production box (26 Aug 2026: import ~3% of source realtime through the
    // proxy pool, transcribe ~16% (faster-whisper small/int8), scoring ~75s,
    // rendering ~110s per clip), and what remains is the unfinished part of
    // the current stage plus every stage still ahead. The number can only
    // fall between stage changes.
    var STAGE_BANDS = { import: [3, 8], transcribe: [8, 65], score: [65, 75], render: [75, 98] };
    function phaseOf(pr) {
      var phase = String(pr.phase || '').toLowerCase();
      if (phase.indexOf('import') === 0) return 'import';
      if (phase === 'transcribe' || phase === 'score' || phase === 'render') return phase;
      var stage = String(pr.stage || '');
      if (/import/i.test(stage)) return 'import';
      if (/transcrib/i.test(stage)) return 'transcribe';
      if (/scor|finding/i.test(stage)) return 'score';
      if (/render/i.test(stage)) return 'render';
      return '';
    }
    function bandFraction(pr, name) {
      var band = STAGE_BANDS[name];
      var p = Number(pr.progress || 0);
      return Math.max(0, Math.min(1, (p - band[0]) / (band[1] - band[0])));
    }
    function pipelineEta(pr) {
      var srcSec = pr.sourceEndSec
        ? Math.max(0, Number(pr.sourceEndSec) - Number(pr.sourceStartSec || 0))
        : Number(pr.durationSec || pr.sourceDurationSec || 0);
      if (!srcSec) return { etaSec: null, stagePct: null };
      var clipsPlanned = Number(pr.clipsRequested || pr.totalClips || 0) || Math.max(3, Math.min(10, Math.round(srcSec / 480)));
      var cost = {
        import: Math.max(30, srcSec * 0.03),
        transcribe: Math.max(20, srcSec * 0.16),
        score: 75,
        render: clipsPlanned * 110,
      };
      var order = ['import', 'transcribe', 'score', 'render'];
      var name = phaseOf(pr);
      if (!name) return { etaSec: null, stagePct: null };
      var frac;
      if (name === 'import' && pr.bytesTotal && pr.bytesDone) {
        frac = Math.max(0, Math.min(1, Number(pr.bytesDone) / Number(pr.bytesTotal)));
      } else if (name === 'render' && Number(pr.totalClips) > 0) {
        // Clips render in order; only the running one has a measured percent.
        var done = Math.max(0, Number(pr.currentClip || 1) - 1) + Math.max(0, Math.min(100, Number(pr.clipPercent || 0))) / 100;
        frac = Math.max(0, Math.min(1, done / Number(pr.totalClips)));
      } else {
        frac = bandFraction(pr, name);
      }
      var remaining = cost[name] * (1 - frac);
      // The worker measures the import's own remaining time from bytes; when it
      // says so, believe it over the model -- for that stage only.
      if (name === 'import' && pr.etaSec !== null && pr.etaSec !== undefined && isFinite(pr.etaSec)) {
        remaining = Number(pr.etaSec);
      }
      for (var i = order.indexOf(name) + 1; i < order.length; i++) remaining += cost[order[i]];
      remaining += 20; // upload + finalise tail
      return { etaSec: Math.max(10, remaining), stagePct: Math.round(frac * 100) };
    }
    // For jobs with no known source length (edits, more-clips), a flat model of
    // their own remaining stages -- still never a trend line.
    function flatEta(totalSec, progress) {
      var p = Math.max(0, Math.min(100, Number(progress) || 0));
      return Math.max(10, totalSec * (1 - p / 100));
    }
    var jobsLive = [];
    projects.forEach(function (pr) {
      if (['queued', 'processing'].indexOf(pr.status) > -1) {
        // A queued job says where it stands, not just "queued": one worker
        // means the wait is real, and a visible position reads as a line
        // moving rather than a job stuck.
        var queuedStage = pr.status === 'queued' && pr.queueAhead > 0
          ? plural(pr.queueAhead, 'job') + ' ahead of yours'
          : pr.status === 'queued' && pr.queueAhead === 0
            ? 'Next in line'
            : null;
        jobsLive.push({ kind: 'project', id: pr.id, queued: pr.status === 'queued', boosted: pr.priority === 0, title: projectTitle[pr.id], stage: queuedStage || pr.stage || pr.status, progress: Number(pr.progress || 0), eta: pipelineEta(pr), bytesDone: pr.bytesDone, bytesTotal: pr.bytesTotal, at: pr.startedAt || pr.submittedAt, project: pr });
      }
      if (pr.moreJob && ['queued', 'processing'].indexOf(pr.moreJob.status) > -1) {
        jobsLive.push({ kind: 'more', id: pr.id, queued: pr.moreJob.status === 'queued', boosted: pr.moreJob.priority === 0, title: 'More clips · ' + projectTitle[pr.id], stage: pr.moreJob.stage || pr.moreJob.status, progress: Number(pr.moreJob.progress || 0), etaSec: flatEta(480, pr.moreJob.progress), at: pr.moreJob.startedAt || pr.moreJob.createdAt });
      }
    });
    (DATA.rerenderJobs || []).forEach(function (j) {
      if (['queued', 'processing'].indexOf(j.status) > -1) {
        var c = clips.filter(function (x) { return x.id === j.clipId; })[0];
        jobsLive.push({ kind: 'render', id: j.id, queued: j.status === 'queued', boosted: j.priority === 0, title: 'Editing ' + ((c && c.title) || 'clip'), stage: j.stage || j.status, progress: Number(j.progress || 0), etaSec: flatEta(150, j.progress), at: j.startedAt || j.createdAt });
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
      var model = j.eta || { etaSec: j.etaSec, stagePct: null };
      var eta = etaLabel(model.etaSec);
      // How far through THIS step, so a stage that holds the global bar still
      // for minutes -- the import, a long transcription -- still visibly moves.
      var stepPct = (model.stagePct === null || model.stagePct === undefined) ? '' : model.stagePct + '% of this step';
      // Only the import moves bytes, so this is absent for the rest of the
      // pipeline rather than showing a frozen figure from an earlier phase.
      var transfer = transferLabel(j.bytesDone, j.bytesTotal);
      // Stage, then size, then time remaining: what it is doing, how far in, how
      // much longer.
      var detail = j.stage + (stepPct ? ' · ' + stepPct : '') + (transfer ? ' · ' + transfer : '') + (eta ? ' · ' + eta : '');
      var clips = clipBreakdown(j.project, j.stage);
      return {
        label: j.title,
        title: j.title,
        stage: j.stage,
        // The row's own controls: remove it, or send a queued one to the front.
        kind: j.kind || '',
        id: j.id || '',
        canCancel: Boolean(j.id),
        canBoost: Boolean(j.id && j.queued && !j.boosted),
        boosted: Boolean(j.boosted && j.queued),
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
    // Each row carries its own error CODE and the FULL untruncated message.
    // The list line stays short because a feed of paragraphs is unreadable, but
    // the detail view needs the whole thing -- truncating at 150 characters was
    // cutting the sentence that named the fix, which is the only part that was
    // any use to whoever read it.
    var failures = [];
    projects.forEach(function (pr) {
      // status failed ONLY. `|| pr.error` also surfaced every lecture that
      // failed once and later succeeded -- the error field survives the
      // recovery -- so lectures happily full of clips sat in the bell as
      // 'needs attention' forever. A done lecture is not a call to action.
      if (pr.status === 'failed') {
        failures.push({
          id: activityId('project', pr.id, pr.completedAt || pr.submittedAt),
          text: projectTitle[pr.id] + ' needs attention',
          meta: shortError(pr.error || pr.stage),
          full: pr.error || pr.stage || '', code: pr.errorCode || '',
          at: pr.completedAt || pr.submittedAt, screen: 'library',
        });
      }
      if (pr.moreJob && pr.moreJob.status === 'failed') {
        failures.push({
          id: activityId('more', pr.id, pr.moreJob.completedAt || pr.moreJob.createdAt),
          text: 'More clips failed · ' + projectTitle[pr.id],
          meta: shortError(pr.moreJob.error || pr.moreJob.stage),
          full: pr.moreJob.error || pr.moreJob.stage || '', code: pr.moreJob.errorCode || '',
          at: pr.moreJob.completedAt || pr.moreJob.createdAt, screen: 'library',
        });
      }
    });
    (DATA.rerenderJobs || []).forEach(function (j) {
      if (j.status !== 'failed') return;
      var c = clips.filter(function (x) { return x.id === j.clipId; })[0];
      // Only the clip's current job: once a newer render succeeded, the old
      // failure is history, not a task -- it sat in the bell regardless.
      if (c && c.rerender && c.rerender.id && c.rerender.id !== j.id) return;
      failures.push({
        id: activityId('rerender', j.id || j.clipId, j.completedAt || j.createdAt),
        text: 'Edit failed · ' + ((c && c.title) || 'Clip'),
        meta: shortError(j.error || j.stage),
        full: j.error || j.stage || '', code: j.errorCode || '',
        at: j.completedAt || j.createdAt, screen: 'queue',
      });
    });
    clips.forEach(function (c) {
      var bad = (c.targets || []).filter(function (t) { return t.status === 'failed'; });
      if (c.status !== 'publish_failed' && !bad.length) return;
      var target = bad[0] || {};
      failures.push({
        id: activityId('publish', c.id, target.updatedAt || c.postedAt),
        text: 'Publish failed · ' + (c.title || 'Clip'),
        meta: shortError(target.error || target.stage || c.error),
        full: target.error || c.error || '', code: '',
        provider: target.provider || '',
        at: target.updatedAt || c.postedAt, screen: 'schedule',
      });
    });
    failures.sort(function (a, b) { return Number(b.at || 0) - Number(a.at || 0); });
    // Red is a call to action, not a history book: 45 stale rows greeted
    // every open of the bell as if the product were on fire TODAY, when
    // nearly all of them were import failures from an era already fixed.
    // The feed keeps a week; the owner Health page keeps the full history.
    var feedFloor = Date.now() - 7 * DAY_MS;
    failures = failures.filter(function (f) { return Number(f.at || 0) >= feedFloor; });

    var overdueRow = null;
    if (overdue.length) {
      overdueRow = {
        day: 'Overdue',
        countLabel: plural(overdue.length, 'post') + (overdue.length === 1 ? ' missed its slot' : ' missed their slots'),
        canAdd: false,
        items: overdue.map(scheduleItem),
      };
    }

    var seenAt = lastSeen();

    var weekAgo = Date.now() - 7 * DAY_MS;
    var postedThisWeek = clips.filter(function (c) { return c.postedAt && new Date(c.postedAt).getTime() >= weekAgo; });
    var allScores = clips.map(function (c) { return Number(c.score || 0); }).filter(Boolean).sort(function (a, b) { return a - b; });
    var medianScore = allScores.length ? allScores[Math.floor(allScores.length / 2)] : 0;
    var postTimes = DATA.postTimes || [];
    var todayCount = scheduled.filter(function (c) { return startOfDay(c.scheduledAt) === today; }).length;

    // Blockers name a real gap and send you to the screen that fixes it.
    var blocker = '', blockerScreen = 'music', blockerCta = 'Upload nasheed', blockerOpensConnections = false;
    // The server has been computing these on every request and shipping them to
    // the browser, where nothing read them: trial days left, the free window
    // closing, a declined card, a nearly-empty wallet. A customer whose payment
    // failed saw no sign of it anywhere, and with the trial capped at 40 tokens
    // someone on a 6000-token yearly plan would see 40 with no explanation.
    // Billing comes first because it is the only gap that stops the account
    // rather than the workflow.
    var notices = (DATA.billing && DATA.billing.notices) || [];
    var moneyNotice = notices.filter(function (n) { return n && n.blocking; })[0] || notices[0] || null;
    if (moneyNotice) {
      blocker = moneyNotice.title + ' — ' + moneyNotice.message;
      blockerCta = moneyNotice.action || 'See plans';
      blockerScreen = 'tokens';
    }
    else if (tracks.length === 0) { blocker = 'No nasheed uploaded — every clip mixes one in, so processing cannot finish without at least one.'; blockerScreen = 'music'; }
    else if (tracks.length < 2) { blocker = 'Only one nasheed uploaded — rotation needs two or more before automatic posting can run.'; blockerScreen = 'music'; }
    else if (connectedCount === 0) {
      blocker = 'No publishing account connected — approved clips will queue up with nowhere to go.';
      blockerCta = 'Connect an account';
      blockerOpensConnections = true;
    }

    var open = UI.railOpen && (global.innerWidth || 1280) > 820;

    // The Performance range tabs stored a label nothing read, so all three
    // showed identical numbers -- three tabs over one answer. This is the
    // window they name, and every figure on the screen is taken through it.
    var PERF_DAYS = { 'Last 7 days': 7, 'Last 30 days': 30 };
    var PERF_WINDOW = PERF_DAYS[UI.perfRange] ? Date.now() - PERF_DAYS[UI.perfRange] * DAY_MS : 0;
    var perfAt = function (c) {
      return Number(c.createdAt || c.readyAt || c.approvedAt || c.postedAt || c.submittedAt || 0);
    };
    var perfClips = PERF_WINDOW ? clips.filter(function (c) { return perfAt(c) >= PERF_WINDOW; }) : clips;
    var perfProjects = PERF_WINDOW ? projects.filter(function (p) { return perfAt(p) >= PERF_WINDOW; }) : projects;

    // ── the activity feed, built once ──
    // Rows were previously mapped inline inside the bindings, which meant the
    // dismiss handler and the open handler could not both refer to the same
    // object, and nothing had an identity that survived a repaint.
    var dismissed = {};
    dismissedIds().forEach(function (id) { dismissed[id] = 1; });

    // Counted after dismissals, not before. A badge that kept counting rows the
    // person had already cleared is the notification that will not go away --
    // the exact thing dismissing exists to end. Counted off the full log rather
    // than the collapsed six, so the number does not change with the list.
    // Shared with the header's "N need you", which counted raw failures and so
    // kept accusing the customer of unfinished business they had just cleared.
    var liveFailures = failures.filter(function (f) { return !dismissed[f.id]; });
    var unreadCount = liveFailures.length
      + log.filter(function (e) {
          // The surviving sign-in row is context, not news.
          var message = String(e.message || e.text || '');
          if (/^Signed in /.test(message)) return false;
          var at = e.at || e.createdAt;
          if (dismissed[activityId('log', message, at)]) return false;
          return Number(at || 0) > seenAt;
        }).length;

    var failureRows = failures.map(function (f) {
      return {
        id: f.id,
        text: f.text,
        meta: f.meta + (f.at ? ' · ' + since(f.at) : ''),
        full: f.full, code: f.code, at: f.at, screen: f.screen, provider: f.provider || '',
        tag: 'Failed',
        icon: 'ph-fill ph-warning-circle',
        rowStyle: 'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-bottom: 1px solid #1A1A1E; cursor: pointer; background: rgba(227,146,140,.07);',
        iconStyle: 'font-size: 15px; flex: none; margin-top: 1px; color: #E3928C',
        tagStyle: 'flex: none; padding: 2px 7px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: rgba(227,146,140,.16); color: #E3928C;',
      };
    });

    var logRows = (UI.activityAll ? log : log.slice(0, 6)).map(function (entry) {
      var urgent = entry.level === 'error' || entry.level === 'warn';
      var color = entry.level === 'error' ? '#E3928C' : entry.level === 'warn' ? '#E6B770' : '#7FD1A6';
      var message = entry.message || entry.text || '';
      var at = entry.at || entry.createdAt;
      return {
        id: activityId('log', message, at),
        text: message,
        meta: since(at),
        full: message, code: '', at: at, screen: '', provider: '',
        tag: entry.level === 'error' ? 'Issue' : entry.level === 'warn' ? 'Check' : '',
        icon: entry.level === 'error' ? 'ph-fill ph-warning-circle' : entry.level === 'warn' ? 'ph-fill ph-warning' : 'ph-fill ph-check-circle',
        rowStyle: 'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-bottom: 1px solid #1A1A1E; cursor: pointer; transition: background .14s ease; background: ' + (urgent ? 'rgba(217,180,120,.045)' : 'transparent'),
        iconStyle: 'font-size: 15px; flex: none; margin-top: 1px; color: ' + color,
        tagStyle: 'flex: none; padding: 2px 7px; border-radius: 20px; font-size: 9.5px; font-weight: 600; letter-spacing: .02em; background: #1D1D21; color: #8B8B93;',
      };
    });

    var activityRows = failureRows.concat(logRows)
      .filter(function (row) { return !dismissed[row.id]; })
      .map(function (row) {
        return Object.assign({}, row, {
          open: function (e) { stop(e); setUI({ activityDetail: row.id }); },
          dismiss: function (e) {
            // Without this the click also reaches the row and opens the detail
            // for the thing that was just dismissed.
            stop(e);
            dismissIds([row.id]);
            refresh();
          },
          dismissStyle: 'flex: none; display: grid; place-items: center; width: 20px; height: 20px; margin-left: auto;'
            + ' border: 0; border-radius: 6px; background: transparent; color: #6E6E76; font-family: inherit;'
            + ' font-size: 12px; cursor: pointer; transition: background .14s ease, color .14s ease;',
        });
      });

    // NOT named `detail`: that name is already the open project in this scope,
    // and shadowing it silently turned "More clips" into a no-op.
    var activityRow = activityRows.filter(function (row) { return row.id === UI.activityDetail; })[0] || null;
    var activityWhy = activityRow ? explainFailure(activityRow) : { title: '', cause: '', fixes: [] };

    var vals = {
      // ── shell: rail ──
      railOpen: open,
      railStyle: 'align-self: stretch; height: 100%; min-height: 0; ' + (open ? 'overflow-y: auto; overflow-x: hidden; ' : 'overflow: visible; ') + 'display: flex; flex-direction: column; gap: 18px; width: ' + (open ? '228px' : '68px') + '; padding: 16px 12px; border-right: 1px solid #1E1E22; background: linear-gradient(180deg, #101013, #0B0B0D); transition: width .18s ease;',
      brandRowStyle: 'display: flex; align-items: center; gap: 10px; padding: ' + (open ? '4px 6px' : '4px 0') + '; ' + (open ? '' : 'flex-direction: column;'),
      brandTextStyle: open ? 'display: flex; flex-direction: column; line-height: 1.2; min-width: 0;' : 'display: none;',
      railToggleStyle: ((global.innerWidth || 1280) <= 820 ? 'display: none; ' : 'display: grid; ') + 'place-items: center; width: 26px; height: 26px; flex: none; ' + (open ? 'margin-left: auto; ' : '') + 'border: 1px solid #26262A; border-radius: 7px; background: #121214; color: #8B8B93; cursor: pointer; transition: border-color .14s ease, color .14s ease;',
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
        navItem('performance', 'Performance', 'ph ph-chart-line-up', ''),
      ].concat(isOperator(DATA) ? [ownerNavItem()] : []),

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
      // Every row is built once, with its identity, so dismissing and opening
      // both act on the same thing the person clicked.
      activity: activityRows,
      activityHasRows: activityRows.length > 0,
      // Dismissing every row at once. Only ever the rows currently on screen:
      // "clear all" that also swallowed something that arrives a second later
      // would be a lie.
      clearAllActivity: function (e) {
        stop(e);
        dismissIds(activityRows.map(function (row) { return row.id; }));
        markSeen();
        setUI({ activityDetail: null });
      },
      // Dismissing is reversible, because it is one click next to a row someone
      // is reading for the first time and the underlying failure has not gone
      // anywhere.
      restoreActivity: function (e) { stop(e); restoreDismissed(); refresh(); },
      hasDismissed: dismissedIds().length > 0,
      // Browser pop-ups while the tab is open somewhere. The permission ask
      // must ride a click, so the actual request lives in the page handler;
      // this only reports state and forwards the click.
      desktopNotifsStyle: (function () {
        var on = false;
        try { on = localStorage.getItem('deenDesktopNotifs') === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch (e) {}
        return 'position: relative; width: 34px; height: 19px; flex: none; border-radius: 20px; cursor: pointer; border: 1px solid '
          + (on ? 'rgba(127,209,166,.5); background: rgba(127,209,166,.16);' : '#26262A; background: #17171A;');
      })(),
      desktopNotifsKnobStyle: (function () {
        var on = false;
        try { on = localStorage.getItem('deenDesktopNotifs') === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch (e) {}
        return 'position: absolute; top: 2px; left: ' + (on ? '17px' : '2px') + '; width: 13px; height: 13px; border-radius: 50%; background: ' + (on ? '#7FD1A6' : '#6E6E76') + ';';
      })(),
      toggleDesktopNotifs: function (e) { stop(e); global.StudioAdapter.onToggleDesktopNotifs(); },

      // ── the detail view ──
      // A row in a dropdown can only ever say what happened. This says why it
      // happened and what to do about it, which is the part someone who did not
      // write the code actually needs.
      activityDetailOpen: Boolean(activityRow),
      activityDetailTitle: activityRow ? activityRow.text : '',
      activityDetailWhen: activityRow && activityRow.at ? since(activityRow.at) : '',
      activityDetailHeading: activityRow ? activityWhy.title : '',
      activityDetailCause: activityRow ? activityWhy.cause : '',
      activityDetailFixes: activityRow ? activityWhy.fixes.map(function (fix, index) {
        return { n: String(index + 1), text: fix };
      }) : [],
      // The untruncated original. Kept visible but secondary: it is what to
      // quote in a support message, not what to read first.
      activityDetailRaw: activityRow ? (activityRow.full || activityRow.meta || '') : '',
      activityDetailHasRaw: Boolean(activityRow && (activityRow.full || activityRow.meta)),
      activityDetailCode: activityRow && activityRow.code ? activityRow.code : '',
      activityDetailGoLabel: activityRow ? (SCREEN_LABEL[activityRow.screen] || 'Open') : '',
      activityDetailGo: function (e) {
        stop(e);
        if (activityRow) setUI({ screen: activityRow.screen, bellOpen: false, activityDetail: null });
      },
      activityDetailDismiss: function (e) {
        stop(e);
        if (activityRow) dismissIds([activityRow.id]);
        setUI({ activityDetail: null });
      },
      closeActivityDetail: function (e) { stop(e); setUI({ activityDetail: null }); },

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

      // Two rows, not one: 8 cards against the grid's auto-fill columns.
      lectures: projects.slice(0, 8).map(function (p) {
        // Through lecState, not a second opinion. Home and the Lecture library
        // read the same records; when this had its own test they disagreed --
        // PROCESSING here, Ready there, on one page load.
        // All three of lecState's answers, not a boolean. Collapsing them to
        // processing-or-not meant a failed or cancelled lecture -- the two a
        // customer most needs to notice -- was labelled READY, in green, with
        // the "0 clips" that was the only hint anything had gone wrong.
        var state = lecState(p);
        var processing = state === 'processing';
        return {
          title: p.title || p.sourceTitle || 'Untitled lecture',
          meta: humanDuration(p.durationSec || p.sourceDurationSec) + ' · ' + since(p.submittedAt),
          clips: plural(p.clipCount || 0, 'clip'),
          chip: processing ? 'Processing' : state === 'ready' ? 'Ready' : p.status === 'cancelled' ? 'Cancelled' : 'Failed',
          chipStyle: 'padding: 2px 7px; border-radius: 20px; font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid ' +
            (processing ? 'rgba(230,183,112,.4); background: rgba(10,10,12,.8); color: #E6B770;'
              : state === 'ready' ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.8); color: #7FD1A6;'
              : 'rgba(226,124,124,.4); background: rgba(10,10,12,.8); color: #E27C7C;'),
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
        // provider, not platform: targets store the destination under
        // `provider`, and reading the wrong key made this panel say
        // "Not connected" for every scheduled post while four accounts sat
        // connected -- three screens, three different answers.
        var platform = target.platform || target.provider || '';
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
      // Bulk review. Selection lives on ids, counted against the clips that
      // still exist so a deleted record cannot inflate the label.
      anySel: clips.some(function (c) { return UI.selClips[c.id]; }),
      selCount: plural(clips.filter(function (c) { return UI.selClips[c.id]; }).length, 'clip') + ' selected',
      selApprove: function (e) {
        stop(e);
        var ids = clips.filter(function (c) { return UI.selClips[c.id]; }).map(function (c) { return c.id; });
        setUI({ selClips: {} });
        global.StudioAdapter.onBulkClips(ids, 'approve');
      },
      selReject: function (e) {
        stop(e);
        var ids = clips.filter(function (c) { return UI.selClips[c.id]; }).map(function (c) { return c.id; });
        setUI({ selClips: {} });
        global.StudioAdapter.onBulkClips(ids, 'delete');
      },
      // Downloading keeps the selection. Approving and rejecting are decisions
      // that empty the tray; taking a copy of the files is not one, and having
      // to re-tick eight clips to then approve them would be its own small
      // punishment for saving your own work.
      selDownload: function (e) {
        stop(e);
        var ids = clips.filter(function (c) { return UI.selClips[c.id]; }).map(function (c) { return c.id; });
        global.StudioAdapter.onDownloadClips(ids);
      },
      selClear: function (e) { stop(e); setUI({ selClips: {} }); },
      // The library's bulk delete, same shape.
      libAnySel: projects.some(function (p) { return UI.selLecs[p.id]; }),
      libSelCount: plural(projects.filter(function (p) { return UI.selLecs[p.id]; }).length, 'lecture') + ' selected',
      libSelDelete: function (e) {
        stop(e);
        var ids = projects.filter(function (p) { return UI.selLecs[p.id]; }).map(function (p) { return p.id; });
        setUI({ selLecs: {} });
        global.StudioAdapter.onBulkProjects(ids);
      },
      libSelClear: function (e) { stop(e); setUI({ selLecs: {} }); },
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

      // A blocking money notice cannot be dismissed away. The nasheed nag is
      // advice; "your free trial has ended" is the reason nothing works, and
      // hiding it would leave the account silently unable to do anything.
      blockersOn: Boolean(blocker) && (moneyNotice && moneyNotice.blocking ? true : !UI.blockerDismissed && (function () {
        // Dismissal outlives the tab, keyed by the message: the nasheed nag
        // came back on every page load however many times it was dismissed.
        // A DIFFERENT blocker (new gap, new wording) still shows.
        try { return global.localStorage.getItem('deenBlockerDismissed') !== blocker; } catch (e) { return true; }
      }())),
      blockerText: blocker || '',
      blockerCta: blockerCta,
      resolveBlocker: function (e) {
        stop(e);
        setUI({ blockerDismissed: true });
        if (blockerOpensConnections) { global.StudioAdapter.onOpenConnections(); return; }
        setUI({ screen: blockerScreen });
      },
      dismissBlocker: function (e) {
        stop(e);
        try { global.localStorage.setItem('deenBlockerDismissed', blocker); } catch (err) { /* memory-only fallback */ }
        setUI({ blockerDismissed: true });
      },

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
      schedIsDay: schedView === 'day',
      schedIsWeek: schedView === 'week',
      schedIsMonth: schedView === 'month',
      schedRangeLabel: schedRangeLabel,
      schedWeekdays: weekDayStarts.map(function (ds) {
        return { name: new Date(ds).toLocaleDateString(undefined, { weekday: 'short' }) };
      }),
      schedMonthWeeks: schedMonthWeeks,
      schedWeekRows: schedWeekRows,
      schedWeekDays: weekDayStarts.map(function (ds) {
        var isToday = ds === today;
        return {
          name: new Date(ds).toLocaleDateString(undefined, { weekday: 'short' }),
          date: dateOf(ds),
          style: 'flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 0 8px 2px;'
            + ' color: ' + (isToday ? '#F0D6A6' : '#8B8B93') + ';',
        };
      }),
      schedDayItems: schedDayItems,
      schedDayCount: schedDayItems.length + ' of 4 scheduled',
      schedDayCanAdd: schedDayItems.length < 4 && schedAnchor >= today,
      schedDayAdd: addClipTo(schedAnchor),
      schedDayEmpty: !schedDayItems.length,
      schedPrev: shiftAnchor(-1),
      schedNext: shiftAnchor(1),
      schedToday: function (e) { stop(e); setUI({ schedAnchor: today, schedView: UI.schedView || 'month' }); },
      schedOffToday: schedAnchor !== today,
      schedViewOpts: [
        { id: 'day', label: 'Day' },
        { id: 'week', label: 'Week' },
        { id: 'month', label: 'Month' },
      ].map(function (v) {
        return {
          label: v.label,
          style: wordOption(schedView === v.id, 13),
          select: function (e) { stop(e); setUI({ schedView: v.id }); },
        };
      }),
      // The same progress, carried on every screen. Seen only on Home, a new
      // user walking through the product has no idea anything is still
      // outstanding until they navigate back.
      setupChipStyle: 'display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 20px;'
        + ' border: 1px solid rgba(217,180,120,.34); background: rgba(217,180,120,.08); color: #F0D6A6;'
        + ' font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;'
        + ' transition: border-color .14s ease, background .14s ease;',
      openSetup: function (e) { stop(e); setUI({ screen: 'home' }); },

      startDoneLabel: setupDoneCount + ' of ' + setupSteps.length + ' done',
      // It disappears when it is finished, rather than becoming furniture.
      startListOn: !setupAllDone,

      // The moment the fifth step lands. Derived from the same account data as
      // the list itself, so it cannot congratulate anyone for work they have
      // not done -- and it goes back to false if a step is undone, which is why
      // the page, not this value, remembers that it has already been said.
      setupComplete: setupAllDone,

      // ── the starter list ──
      // Proved from the account's own data, never a stored "dismissed" flag: a
      // checklist that ticks itself because you visited a screen teaches the
      // wrong thing. Each item names the one action that finishes it.
      startSteps: (function () {
        return setupSteps.map(function (item, i) {
          return {
            title: item.title,
            note: item.note,
            done: item.done,
            numStyle: 'display: grid; place-items: center; width: 22px; height: 22px; flex: none; border-radius: 50%;'
              + ' font: 600 11px Outfit, Inter, sans-serif; border: 1px solid '
              + (item.done ? 'rgba(127,209,166,.5); background: rgba(127,209,166,.14); color: #7FD1A6;'
                           : '#2C2C33; background: #17171A; color: #8B8B93;'),
            num: item.done ? '\u2713' : String(i + 1),
            titleStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 13px; font-weight: 500; color: '
              + (item.done ? '#6E6E76' : '#F2F2F4') + ';' + (item.done ? ' text-decoration: line-through;' : ''),
            rowStyle: 'display: flex; align-items: flex-start; gap: 11px; padding: 9px 10px; border-radius: 9px;'
              + ' border: 0; background: none; width: 100%; text-align: left; font-family: inherit; cursor: pointer;'
              + ' transition: background .14s ease;',
            open: function (e) {
              stop(e);
              if (item.go === 'connections') { global.StudioAdapter.onOpenConnections(); return; }
              setUI({ screen: item.go });
            },
          };
        });
      }()),

      // ── the rail ──
      // The meter was four gold bars in the markup, full whatever the day held.
      // It sat directly above the sentence "2 of 4 scheduled today" and
      // contradicted it.
      schedMeter: [0, 1, 2, 3].map(function (n) {
        return { style: 'flex: 1; height: 5px; border-radius: 20px; transition: background .2s ease; background: '
          + (n < schedTodayCount ? 'linear-gradient(90deg, #D9B478, #F0D6A6)' : '#26262C') + ';' };
      }),

      // What is going out next, in words rather than a timestamp to subtract
      // from. Nothing was on this screen to answer it.
      schedHasNext: Boolean(nextOut),
      schedNextIn: nextOut ? untilLabel(nextOut.scheduledAt) : '',
      schedNextTitle: nextOut ? String(nextOut.title || 'Clip') : '',
      schedNextAt: nextOut ? timeOf(nextOut.scheduledAt) + ' \u00b7 ' + dateOf(startOfDay(nextOut.scheduledAt)) : '',

      // The supply. An empty calendar has two very different causes -- nothing
      // approved, or plenty approved and none of it placed -- and the screen
      // could not tell them apart.
      schedWaitingCount: waitingForSlot.length,
      schedHasWaiting: waitingForSlot.length > 0,
      schedWaitingLabel: plural(waitingForSlot.length, 'clip') + ' approved, no slot yet',
      schedWaiting: waitingForSlot.slice(0, 3).map(function (c) {
        return {
          title: String(c.title || 'Clip'),
          // Into the next open slot: from the rail no day has been named, so
          // none is claimed.
          schedule: function (e) { stop(e); global.StudioAdapter.onScheduleClip(c.id); },
        };
      }),
      schedWaitingMore: waitingForSlot.length > 3 ? '+' + (waitingForSlot.length - 3) + ' more' : '',
      schedHasWaitingMore: waitingForSlot.length > 3,
      schedNoWaiting: !waitingForSlot.length,

      // Every card on this screen said "No channel on" and the rail never
      // explained why. A schedule with nowhere to post is a list of intentions.
      schedOutlets: providers.map(function (p) {
        var live = p.connected && p.enabled;
        return {
          name: PLATFORM_NAMES[p.key],
          note: !p.configured ? 'Not set up' : !p.connected ? 'Not connected' : !p.enabled ? 'Switched off' : 'Posting',
          dotStyle: 'display: block; width: 7px; height: 7px; flex: none; border-radius: 50%; background: '
            + (live ? '#7FD1A6' : p.connected ? '#E6B770' : '#4A4A54') + ';',
          noteStyle: 'margin-left: auto; font-size: 11px; color: ' + (live ? '#8B8B93' : '#E0A188') + ';',
          open: function (e) { stop(e); global.StudioAdapter.onOpenConnections(p.key); },
        };
      }),
      schedNothingPosts: !providers.some(function (p) { return p.connected && p.enabled; }),

      // Overdue stays first: a stranded post used to be counted by the rail
      // badge and rendered by no day at all.
      schedHasOverdue: Boolean(overdueRow),
      schedOverdueLabel: overdueRow ? overdueRow.countLabel : '',
      schedOverdueItems: overdueRow ? overdueRow.items : [],

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
      // Elapsed / total, so the little pill under the preview is a readout
      // rather than a label. It showed only the total, which never moved.
      edTimeLabel: edClip ? secsToClock(edTime) + ' / ' + secsToClock(edDuration) : '',
      // Which caption block is being spoken. The host repaints immediately when
      // this changes, so captions land on the word rather than on the next tick.
      edLiveIndex: edLiveIndex,

      // The live block drawn the way the renderer will draw it: the template's
      // caption mode, its line length, and the highlighted word in its own
      // colour and font. The overlay was one flat run of text in a generic
      // font, so nothing about the Clip Style was visible in the editor -- the
      // one screen where you are choosing it.
      //
      // Word timings are distributed evenly across the block: the worker
      // persists sentence timings only. The export uses Whisper's real
      // per-word timings, so the highlight here is a fair approximation rather
      // than frame-exact.
      // Scripture is drawn whole and unanimated: the export sets an ayah on
      // screen for as long as it is recited, with no word-by-word highlight and
      // no pop, so the preview must not invent one.
      edCapIsAyah: Boolean(edAyahPhrase),
      edCapTranslation: edAyahPhrase ? edAyahPhrase.gloss : '',
      edCapWords: (function () {
        // The APPROXIMATE layer (item 5 of Goal to Start, set by Youssef:
        // "previews should just show"). While an edit is UNSAVED the box
        // echoes the current block's words -- the typed draft while typing,
        // the block's own words while a slider moves -- so size, spacing,
        // line-height, case and alignment changes show the instant they are
        // made. The echo keeps the ghost's face and colour (geometry only,
        // labelled approximate by the painter); Save renders the truth and
        // the box returns to empty. Scripture is never echoed: an
        // approximation of an ayah on screen is not acceptable (invariant 7),
        // so ayah moments stay the render's alone.
        if (UI.edBlockDraft !== null && UI.edBlockDraft !== undefined && selectedBlock) {
          return String(UI.edBlockDraft).split(/\s+/).filter(Boolean).map(function (word) {
            return { text: word, style: '' };
          });
        }
        var echoBlock = overlayBlock || selectedBlock;
        if (UI.edDirty && echoBlock && !echoBlock.ayah) {
          return String(echoBlock.sourceText || echoBlock.text || '').split(/\s+/).filter(Boolean).map(function (word) {
            return { text: word, style: '' };
          });
        }
        return [];
      }()),
      // The echo's geometry: the draft's size, tracking, line-height and
      // case, sized against the frame exactly as captionFaceStyle sizes the
      // render's text -- but in the ghost's own face and colour, claiming
      // nothing the renderer could disagree with.
      edCapEchoStyle: (function () {
        var width = Math.max(1, Number(tpl.width) || 1080);
        var size = (Number(tpl.captionFontSize) || 96) * assFactor(tpl.captionFont);
        var tracking = Math.max(-4, Math.min(40, Number(tpl.captionLetterSpacing) || 0));
        var lineHeight = Math.max(0.6, Math.min(2, Number(tpl.captionLineHeight) || 0.88));
        return 'display: block; width: 100%; pointer-events: none;'
          + ' font-size: ' + ((size / width) * 100).toFixed(2) + 'cqw;'
          + ' line-height: ' + lineHeight + ';'
          + (tracking ? ' letter-spacing: ' + (tracking / Math.max(1, Number(tpl.captionFontSize) || 96)).toFixed(3) + 'em;' : '')
          + (tpl.captionUppercase ? ' text-transform: uppercase;' : '');
      }()),
      edProgress: edTime / edDuration,
      // This element IS the preview frame and establishes the containing block
      // for every overlay below it. Making it `position: absolute; inset: 0`
      // instead lets the overlays resolve against <main> and cover the tool rail.
      edThumbStyle: 'position: relative; container-type: inline-size; width: 100%; max-width: 268px; aspect-ratio: 9 / 16; border-radius: 13px; overflow: hidden; border: 1px solid #26262A; background: ' +
        thumb(edClip && edClip.thumbUrl) + '; box-shadow: 0 26px 60px rgba(0,0,0,.5);',
      closeEditor: function (e) { stop(e); setUI({ screen: 'queue', edClipId: null, edStyleDraft: null, edBlockDraft: null }); },

      // The SELECTED CAPTION box edits the chosen block, not the whole clip.
      // It was bound to the entire transcript and stayed empty because nothing
      // ever selected anything.
      // What the preview overlay draws: the block being spoken at the playhead,
      // falling back to the selected one when the clip is paused at a gap or
      // the blocks carry no timings. Bound to the selected block alone, the
      // caption sat frozen on one line while the video played past it.
      edCapText: overlayBlock
        ? (overlayBlock === selectedBlock && UI.edBlockDraft !== null && UI.edBlockDraft !== undefined
          ? UI.edBlockDraft
          : overlayBlock.text)
        : '',
      setCapText: function (e) {
        var before = (UI.edBlockDraft !== null && UI.edBlockDraft !== undefined)
          ? UI.edBlockDraft
          : (selectedBlock ? selectedBlock.text : '');
        recordTextStep(selectedBlock, before, e.target.value);
        UI.edBlockDraft = e.target.value;
        UI.edDirty = true;
        paintNow();
      },
      // The draft, not the stored text. Bound to selectedBlock.text this box
      // visibly snapped back to the old words the moment it lost focus -- the
      // edit was saved, but the user watched it disappear and reasonably
      // concluded the product had eaten it. The runtime skips the focused
      // element, so the revert only ever showed up on blur, which is precisely
      // when nobody is looking for a bug.
      edSelText: selectedBlock
        ? (UI.edBlockDraft !== null && UI.edBlockDraft !== undefined ? UI.edBlockDraft : selectedBlock.text)
        : '',
      edSelRange: selectedBlock ? selectedBlock.time : '',
      edCapBlocks: edCaptionBlocks,
      // The same helpers the Templates preview uses, so the caption a clip
      // shows inside the editor is the caption its template shows outside it.
      // The editor used to centre unconditionally (ignoring captionHorizontal
      // and captionMarginH), size by a different divisor, and skip the pop --
      // so the two previews could not agree even on a freshly opened clip.
      // A positioning ghost, never a preview. Idle it is a faint dashed
      // rectangle marking the draggable caption area over the real render;
      // during a drag it fills and brightens to say "this is where it will
      // land". It carries no text, no font and no colour from the template --
      // those questions are answered by the render underneath it.
      edCapOverlayStyle: 'z-index: 8; ' + captionPlacementStyle(tpl, edCapDragY)
        + ' box-sizing: border-box; border-radius: 10px; pointer-events: auto; cursor: grab;'
        + (UI.dragKind === 'caption'
          ? ' border: 1.5px solid rgba(240,214,166,.95); background: rgba(217,180,120,.16); box-shadow: 0 0 0 3px rgba(240,214,166,.12); min-height: 46px;'
          : ' border: 1px dashed rgba(240,214,166,.34); background: transparent; min-height: 40px;'),
      // The translation line under an ayah, styled the way the render's own
      // \fn+\fs override styles it. The painter used to hardcode .46em in a
      // face the template never chose.
      edCapGlossStyle: ayahGlossStyle(tpl),
      edCapMarkScale: ayahMarkScale(tpl.captionArabicFont || 'Amiri'),
      // The editor previews the NEXT render. When the rendered file predates
      // the style (edits pending, or the template moved on since it was
      // burned), say so -- otherwise the difference between this preview and
      // the video reads as the editor being broken.
      edRenderNotice: (function () {
        if (!edClipRecord) return '';
        var job = edClipRecord.rerender;
        // The preview IS the render now, so this reports the only thing that
        // matters while it is behind: how long until what you see is what you
        // changed.
        if (job && (job.status === 'queued' || job.status === 'processing')) {
          var pct = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
          return job.status === 'queued' ? 'Updating preview — queued…'
            : 'Updating preview — ' + pct + '%';
        }
        if (job && job.status === 'failed') {
          return 'The preview could not be updated: ' + (job.error || 'unknown error') + ' — Save retries it.';
        }
        if (edClipRecord.stylePending || edClipRecord.templateOutdated) {
          return 'Changes saved — press Save clip to render them onto the video.';
        }
        return '';
      }()),
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
      // The editor's few per-clip fitting controls.
      capAlign: tpl.captionHorizontal || 'center',
      setCapAlign: function (value) { saveStyle({ captionHorizontal: String(value) }); },
      capLetterSpacing: Math.max(-4, Math.min(40, Number(tpl.captionLetterSpacing) || 0)),
      capLetterSpacingLabel: (Number(tpl.captionLetterSpacing) || 0) ? (Math.round(Number(tpl.captionLetterSpacing))) + ' px' : 'Normal',
      setCapLetterSpacing: function (e) { saveStyle({ captionLetterSpacing: Number(e.target.value) }); },

      edFonts: CAPTION_FONTS.map(function (f) {
        return {
          label: f.label,
          style: tabStyle(tpl.captionFont === f.name) + ' font-family: ' + f.web + ';',
          select: function (e) { stop(e); saveStyle({ captionFont: f.name }); },
        };
      }),

      // fitMode, and the one framing toggle the schema keeps.
      edCrops: ENUMS.fitMode.map(function (m) {
        var labels = { contain: 'Full', blur: 'Blur', crop: 'Fill' };
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
      // Lights the design's "Pro" chip on the watermark row: removal is a
      // paid feature, and the server refuses it for free plans.
      notPro: String((current && current.plan) || 'free') === 'free',

      // Alignment guides only appear while dragging, as in the design.
      // The same live drag guides the Templates preview draws -- the editor
      // used to keep these permanently display:none, so dragging a caption
      // here had no snap lines, no feedback, and read as a rougher tool for
      // the very same operation.
      edGuideV: 'position: absolute; top: 0; bottom: 0; width: 1px; z-index: 6; pointer-events: none; left: 50%; background: '
        + (UI.dragKind ? 'repeating-linear-gradient(to bottom, rgba(240,214,166,.5) 0 6px, transparent 6px 12px)' : 'transparent') + ';',
      edGuideH: 'z-index: 6; ' + guideOverlayStyle(Boolean(UI.dragKind), UI.dragAt, UI.dragSnapped, SNAP_LINES),
      // Not toggleBtnStyle: that is a 30px icon square, and this button holds
      // "Social safe zones" as text -- squeezed into the square, the label
      // wrapped straight over its neighbouring caption. A pill that grows with
      // its own words.
      edSafeBtnStyle: 'display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; height: 28px; '
        + 'border-radius: 7px; cursor: pointer; white-space: nowrap; font: 500 11px Outfit, Inter, sans-serif; '
        + 'transition: background .14s ease; border: 1px solid '
        + (UI.edSafe ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.12); color: #F0D6A6;'
                     : '#26262A; background: #121214; color: #8B8B93;'),
      toggleSafe: function (e) { stop(e); setUI({ edSafe: !UI.edSafe }); },
      edMarkStyle: 'position: absolute; z-index: 8; right: 11px; ' +
        (String(tpl.watermarkPosition).indexOf('top') === 0 ? 'top: 11px;' : 'bottom: 42px;') +
        ' font-family: Outfit, Inter, sans-serif; font-size: 8.5px; font-weight: 700; letter-spacing: .12em; color: ' +
        (tpl.watermarkColor || '#F0D6A6') + '; display: ' + (Number(tpl.watermarkOpacity) > 0 ? 'block' : 'none') + ';',
      // The playhead's wrapper. The design draws it as a 34px round button, which
      // in the timeline is an empty circle taking a lane's worth of height while
      // the actual playhead -- the absolutely positioned line inside it -- spans
      // the track anyway. Made into a transparent overlay so only the line shows.
      edPlayStyle: 'position: absolute; inset: 0; pointer-events: none;',
      edPlayHeadStyle: 'position: absolute; top: 0; bottom: 0; left: ' + ((edTime / edDuration) * 100).toFixed(2) + '%; width: 2px; background: #F0D6A6;',
      edProgressStyle: 'height: 3px; border-radius: 3px; width: ' + ((edTime / edDuration) * 100).toFixed(2) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6);',
      edProgressLabel: secsToClock(edTime),
      // The video itself. Empty when no clip is open, which is how the host
      // knows to tear the element down rather than leave the last clip playing.
      //
      // The rendered export has captions burned into the picture, so previewing
      // it under the editor's own caption overlay shows the same words twice.
      // ONE video, ONE origin, ONE set of captions (CLAUDE.md's "one timeline
      // origin" rule). The editor plays the rendered clip -- the same file the
      // review queue plays, captions burned by libass at full size -- so what
      // is on screen is what ships. Drawing the lecture's clean source and
      // painting CSS captions over it made two engines disagree about line
      // breaking, spacing, outline and word timing, which is what "the preview
      // looks nothing like the export" always was.
      //
      // Served through the app's own path rather than the storage URL so the
      // render version can bust the cache: a fresh draft must replace what is
      // on screen, and a signed bucket URL cannot carry an extra query.
      // A fresh style preview outranks the stored render: it is the same
      // pipeline's pixels for the changes the person JUST made, rendered as a
      // short window on the quick lane. It never replaces the clip -- the full
      // re-render clears it when it lands, and the frame is labelled while it
      // shows. Same-pipeline pixels, so the one-origin invariant holds.
      edVideoUrl: !edClip ? '' : (edClip.stylePreview && edClip.stylePreview.url
        ? edClip.stylePreview.url + (edClip.stylePreview.url.indexOf('?') > -1 ? '&' : '?') + 'sp=' + encodeURIComponent(String(edClip.stylePreview.at || ''))
        : edSourceFallback
        ? '/api/clips/' + encodeURIComponent(edClip.id) + '/source-preview'
        : '/api/clips/' + encodeURIComponent(edClip.id) + '/video?rv='
          + encodeURIComponent(String(edClip.renderVersion || 1) + '.' + String(edClip.renderQuality || 'final'))),
      edPreviewActive: Boolean(edClip && edClip.stylePreview && edClip.stylePreview.url),
      edExportUrl: edClip ? edClip.videoUrl || '' : '',
      // Read from the template rather than printed as a literal: the tab used
      // to say "1080 × 1920" whatever the clip actually was, which is a lie
      // waiting for the first person to pick a different output shape.
      edResolution: (function () {
        var w = Math.round(Number(tpl && tpl.width) || 1080);
        var h = Math.round(Number(tpl && tpl.height) || 1920);
        return w + ' × ' + h;
      })(),
      edDownloadHint: edClip && edClip.status === 'draft'
        ? 'This is the draft render. Approving the clip renders it at full quality.'
        : 'Saves the rendered MP4, captions burned in, ready to post anywhere.',
      downloadClip: function (e) {
        stop(e);
        if (!edClip) return;
        global.StudioAdapter.onDownloadClips([edClip.id]);
      },
      // True only while the fallback is on screen; the host labels the frame
      // so the uncaptioned source can never be mistaken for the clip.
      edSourceFallback: edSourceFallback,
      // One line on the frame, never a stack: while a render job is speaking
      // (edRenderNotice), this stays quiet -- two banners covered the video.
      edSourceNote: (edClipRecord && edClipRecord.rerender && (edClipRecord.rerender.status === 'queued' || edClipRecord.rerender.status === 'processing'))
        ? ''
        : (edClip && edClip.stylePreview && edClip.stylePreview.url)
        ? 'Preview of your changes (short window) — the full clip is re-rendering'
        : edSourceFallback
        ? 'Uncaptioned source — this clip has no rendered file yet'
        : '',
      edIsDraft: Boolean(edClip && edClip.renderQuality === 'draft' && !edSourceFallback),
      // Clip-local time. The rendered clip IS the clip: it starts at zero and
      // its timeline equals the clip's, so there is no offset arithmetic on
      // this path at all. Only the clean-source fallback plays the whole
      // lecture and needs the clip's start subtracted.
      edStartSec: (edClip && edSourceFallback) ? Number(edClip.startSec) || 0 : 0,
      edPoster: edClip ? edClip.thumbUrl || '' : '',
      edPlaying: Boolean(UI.edPlaying),
      edPlayIcon: UI.edPlaying ? 'ph ph-pause' : 'ph ph-play',
      edDurationSec: edDuration,
      edTimeSec: edTime,
      // How the video sits in the 9:16 frame: the same three modes the renderer
      // uses, so what the editor shows is what the export produces.
      // 'fit' is not a mode the schema has -- the enum value is 'contain',
      // so Full-video mode was previewing as a crop. Blur also shows the
      // whole video; only Fill covers.
      edVideoFit: (tpl.fitMode === 'contain' || tpl.fitMode === 'blur') ? 'contain' : 'cover',
      edVideoZoom: tpl.fitMode === 'crop' ? Math.max(0.75, Math.min(2.5, Number(tpl.smartFramingZoom) || 1)) : 1,
      edVideoBlurBg: tpl.fitMode === 'blur',
      // The renderer's grade, as CSS, applied to the real footage: preset +
      // warmth via lookFilter, vignette and grain as host-drawn overlays.
      edVideoFilter: lookFilter(tpl).replace(/^filter:\s*/, '').replace(/;$/, ''),
      edVideoVignette: Math.max(0, Math.min(1, Number(tpl.vignette) || 0)),
      edVideoGrain: Math.max(0, Math.min(100, Number(tpl.grain) || 0)),
      // Play/pause. The design draws the button but exports no handler for it,
      // so the binding exists for the host to attach.
      togglePlay: function (e) {
        stop(e);
        var v = edVideo();
        if (!v) return;
        if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      },
      // Ruler marks across the real duration, replacing the design's six
      // hardcoded strings ("0s 8s 15s ...") that described some other clip.
      edRuler: (function () {
        var marks = [];
        for (var m = 0; m < 6; m++) marks.push({ label: secsToClock(edDuration * (m / 5)) });
        return marks;
      })(),
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

      // The header tells the truth about the invisible work: while a re-render
      // or preview runs, "All changes saved" alone reads as "and nothing is
      // happening", which is exactly what made edits feel broken.
      edDirtyLabel: (function () {
        var job = edClip && edClip.rerender;
        if (job && (job.status === 'queued' || job.status === 'processing')) {
          var pct = Number(job.progress || 0);
          return (job.preview ? 'Rendering preview' : 'Updating clip')
            + (pct > 0 ? ' · ' + Math.round(pct) + '%' : '…');
        }
        if (UI.edDirty || (edClip && edClip.stylePending)) return 'Save clip to render your changes';
        return 'All changes saved';
      })(),
      edDirtyDot: 'width: 7px; height: 7px; border-radius: 50%; background: ' + ((UI.edDirty || (edClip && edClip.stylePending)) ? '#E6B770' : '#7FD1A6') + ';',
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
            ? UI.edBlockDraft : b.sourceText;
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
      // flex: none, because the panel is a scrolling flex column: with the
      // style row and length chips added the content outgrew 88vh, every
      // child shrank to share the space, and an aspect-ratio box shrinks to
      // a sliver -- the lecture's own thumbnail vanished into a hairline at
      // the top of the panel. Capped too, so a tall window does not give the
      // poster half the dialog.
      // A fixed 152px strip, not a hero. The panel asks one question at a
      // time now and the source is context for it, not the subject.
      jobPosterStyle: 'position: relative; display: block; flex: none; width: 216px; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden;'
        + ' border: 1px solid #2A2A32; background-color: #17171A;'
        + ' box-shadow: 0 10px 26px rgba(0,0,0,.5), inset 0 1px 0 rgba(248,248,249,.06);'
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
      // The expectation is set before tokens are committed, not discovered
      // mid-wait. The range is measured, not vibes: whisper-small transcribes
      // at ~0.21x duration on the worker (benchmarked 20 Aug 2026 on a real
      // lecture), and download + scoring + rendering brings the whole job to
      // roughly 0.6-1.0x the selected length on the current single worker.
      jobLenLabel: !job ? '' : job.durationKnown
        ? humanDuration(job.end - job.start) + ' selected · ready in roughly '
          + jobEtaRange(job.end - job.start)
        : 'Length is confirmed once the worker downloads the source. '
          + 'As a guide: a 60-minute lecture takes roughly 35\u201360 minutes to transcribe and render.',
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
      // A stand-in waveform for the source. It is shaped, not random: the same
      // lecture draws the same picture every time the panel opens, so the
      // handles land against a fixed landmark rather than a shuffling one.
      // Real peaks would need the audio decoded client-side, which is not
      // worth a download to draw a scrubber.
      jobWaveform: (function () {
        var seed = String((job && job.url) || '').length + String((job && job.title) || '').length;
        var bars = [];
        for (var i = 0; i < 64; i += 1) {
          var wave = Math.abs(Math.sin((i + seed) * 0.7) * Math.cos((i + seed) * 0.29));
          var h = 22 + Math.round(52 * wave);
          bars.push({ style: 'flex: 1 1 0; height: ' + h + '%; border-radius: 1px; background: #26262C;' });
        }
        return bars;
      })(),

      // ── the wizard ───────────────────────────────────────────────────
      jobStepCount: JOB_STEPS.length,
      jobStepTitle: JOB_STEPS[jobStepIndex() - 1].title,
      jobStepHint: jobStepId() === 'sound' && jobTypeQuran
        ? 'A recitation carries no nasheed. Nothing is mixed underneath it.'
        : JOB_STEPS[jobStepIndex() - 1].hint,
      jobStepCounter: jobStepIndex() + ' / ' + JOB_STEPS.length,
      segRail: SEG_RAIL,
      // A label, in its own column, not another word on the same line as the
      // options -- as an inline run "Which nasheed" read as a fourth choice
      // and highlighted like body text when anyone dragged over it.
      fieldLabel: 'font-size: 13px; color: #8B8B93; user-select: none; white-space: nowrap;',
      // One line that fills. Seven separate segments, a numbered chip and the
      // words STEP 3 OF 7 were three renderings of one small fact, stacked on
      // top of the question they belonged to.
      jobProgressStyle: 'position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px;'
        + ' background: linear-gradient(90deg, #C9A468, #F0D6A6);'
        + ' transition: width .34s cubic-bezier(.2,.75,.3,1);'
        + ' width: ' + ((jobStepIndex() / JOB_STEPS.length) * 100).toFixed(2) + '%;',
      jobIsStepKind: jobStepId() === 'kind',
      jobIsStepTrim: jobStepId() === 'trim',
      jobIsStepLengths: jobStepId() === 'lengths',
      jobIsStepStyle: jobStepId() === 'style',
      jobIsStepPicture: jobStepId() === 'picture',
      jobIsStepSound: jobStepId() === 'sound',
      jobIsStepReview: jobStepId() === 'review',
      // What pressing the button actually sets off. The last of these is the
      // point: nothing is published without you, so the cost being spent here
      // is not a decision about what goes out.
      jobPlanSteps: [
        { icon: 'ph ph-download-simple', title: 'The lecture comes down and is transcribed',
          note: 'Word timings come from this, which is what every caption is cut against.' },
        { icon: 'ph ph-magic-wand', title: 'Moments are scored and cut',
          note: 'Only within the part you selected, and only to the lengths you allowed.' },
        { icon: 'ph ph-film-strip', title: 'Each clip is rendered in your style',
          note: 'Captions, framing, nasheed and watermark are burned in together.' },
        { icon: 'ph ph-eye', title: 'They land in the review queue',
          note: 'Nothing is published until you approve it. Editing and re-rendering are free.' },
      ],
      jobSoundBlocked: jobStepId() === 'sound' && jobTypeQuran,
      // A recitation carries nothing underneath, so the switch is not
      // offered at all rather than offered and refused.
      jobSoundOffered: jobStepId() === 'sound' && !jobTypeQuran,
      jobBackShown: jobStepIndex() > 1,
      jobFirstStep: jobStepIndex() === 1,
      // The last step's action is Generate, in the rail. Offering Continue
      // beside it would be a button with nowhere to go.
      jobNextShown: jobStepId() !== 'review',
      // Wrappers rather than sc-if, because the template <select> is the
      // binding the style row drives -- taking it out of the DOM would leave
      // the picker writing to nothing.
      jobTplSelectWrapStyle: 'position: relative; align-items: center; display: '
        + (jobStepId() === 'style' ? 'flex' : 'none') + ';',
      jobCountsWrapStyle: 'position: relative; width: 100%; margin-top: 6px; display: '
        + (jobStepId() === 'lengths' ? 'block' : 'none') + ';',
      jobDurWrapStyle: 'position: relative; align-items: center; display: '
        + (jobStepId() === 'lengths' ? 'flex' : 'none') + ';',
      jobNextLabel: jobStepBlocker(DATA, job) || 'Continue',
      jobNextStyle: 'display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 24px; border-radius: 10px; font-family: inherit; font-size: 13.5px; font-weight: 600; transition: background .16s ease, box-shadow .16s ease; cursor: '
        + (jobStepBlocker(DATA, job) ? 'not-allowed' : 'pointer') + '; border: 1px solid '
        + (jobStepBlocker(DATA, job)
          ? '#2A2A30; background: #17171A; color: #6E6E76;'
          : 'rgba(217,180,120,.55); background: linear-gradient(180deg, rgba(217,180,120,.2), rgba(217,180,120,.1)); color: #F5E3C0; box-shadow: 0 6px 18px rgba(217,180,120,.12);'),
      jobNext: function (e) {
        stop(e);
        if (jobStepBlocker(DATA, job)) return;
        setUI({ jobStep: Math.min(JOB_STEPS.length, jobStepIndex() + 1) });
      },
      jobBack: function (e) { stop(e); setUI({ jobStep: Math.max(1, jobStepIndex() - 1) }); },
      // Every answered step is editable from the review, which is the point of
      // showing the summary before anything is spent.
      jobEditSteps: JOB_STEPS.slice(0, JOB_STEPS.length - 1).map(function (step, i) {
        return { label: step.title, go: function (e) { stop(e); setUI({ jobStep: i + 1 }); } };
      }),

      // ── the running total ────────────────────────────────────────────
      //
      // The panel used to commit tokens behind a single "≈ 45 tokens" line
      // and say nothing about the wait. These are the four things somebody
      // wants settled before they press Start.
      jobCostBig: !job ? '' : job.durationKnown
        ? String(Math.max(1, Math.ceil((job.end - job.start) / 60 * tokenRate)))
        : '\u2248 1',
      jobCostUnit: !job ? '' : job.durationKnown ? 'tokens' : 'token per minute',
      jobCostBasis: !job ? '' : job.durationKnown
        ? humanDuration(job.end - job.start) + ' of source, charged once'
        : 'confirmed once the worker downloads the source',
      jobSummaryRows: !job ? [] : jobSummaryRows(DATA, job, tokenRate),
      jobEtaLabel: !job ? '' : job.durationKnown
        ? 'Ready in roughly ' + jobEtaRange(job.end - job.start)
        : 'Ready in roughly 0.6\u20131x the length',
      jobQueueLabel: 'measured on the worker, not a guess',
      jobTokenLabel: !job ? '' : job.durationKnown
        ? tokenCostLine(DATA, Math.max(1, Math.ceil((job.end - job.start) / 60 * tokenRate)))
        : '\u22481 token per minute of lecture \u2014 confirmed after download',
      // A picker, not a label: the template renders one button per entry, so a
      // string here renders one button per character.
      // Nasheed off for this job. Music is mandatory by default and stays that
      // way; this is a per-job choice, not a setting, so forgetting to upload
      // one still fails loudly instead of quietly shipping silent clips.
      jobMusicOn: jobMusicOn,
      jobTypeQuran: jobTypeQuran,
      // Picking a kind also resets the nasheed switch to that kind's default
      // (off for recitation), unless the operator already touched it -- their
      // explicit answer outlives a kind change.
      pickJobType: function (kind) {
        // The lecture default has to be a style the account can actually use.
        // This hardcoded 'mono-minimal', which became a Pro style when the
        // catalogue was tiered -- so picking "lecture" on a free plan selected
        // a template the server then refused, with nothing on screen saying
        // why. Take the first style the account is entitled to instead.
        var offered = (DATA.templates || []).filter(function (t) {
          return !(t.pro && !planAllowsProTemplates(DATA));
        });
        var lecture = '';
        for (var i = 0; i < offered.length; i += 1) {
          if (offered[i].captionMode !== 'quran') { lecture = offered[i].id; break; }
        }
        setUI({ jobTplId: kind === 'quran' ? 'quran-recitation' : (lecture || 'clean-line') });
      },
      // How loud the nasheed sits under the voice. It was only reachable from
      // the Nasheed library screen, which is a trip away from the one moment
      // anybody thinks about it. The server accepts 1-50%.
      // Three named steps could not say 17%, and every level between them was
      // unreachable from the one screen anybody sets it on.
      jobVolume: musicVolume || 13,
      jobVolumeValue: (musicVolume || 13) + '%',
      jobVolumeMin: VOL_MIN,
      jobVolumeMax: VOL_MAX,
      setJobVolume: setVolumeFrom,
      jobMusicLabel: UI.jobMusic === false ? 'No nasheed' : 'Nasheed on',
      jobMusicTrack: switchTrack(UI.jobMusic !== false),
      jobMusicKnob: switchKnob(UI.jobMusic !== false),
      toggleJobMusic: function (e) { stop(e); setUI({ jobMusic: UI.jobMusic === false, jobMusicTouched: true }); },
      jobNasheeds: (UI.jobMusic === false ? [] : [{ id: '', name: 'Rotate all' }].concat(tracks)).map(function (t) {
        var on = t.id ? UI.jobTrackId === t.id : !UI.jobTrackId;
        return {
          label: t.name || t.fileName || 'Untitled',
          style: wordOption(on, 14),
          select: function (e) { stop(e); setUI({ jobTrackId: t.id || null }); },
        };
      }),
      // Upload right here, as the spec asked -- not a trip to the Music screen
      // mid-job. The host owns the file dialog.
      jobUploadStyle: 'display: inline-flex; align-items: center; gap: 6px; padding: 9px 13px; border: 1px dashed #33333C;'
        + ' border-radius: 9px; background: none; font-family: inherit; font-size: 13.5px; color: #8B8B93;'
        + ' cursor: pointer; transition: color .16s ease, border-color .16s ease;',
      uploadNasheed: function (e) { stop(e); global.StudioAdapter.onUploadNasheedPrompt(); },
      // jobTplId is cleared with the panel: it is the JOB's template choice,
      // and left behind it pinned activeTemplate everywhere -- the Templates
      // screen preview stopped following the selection because a stale job
      // choice silently outranked it.
      closeJob: function (e) { stop(e); setUI({ job: null, jobTplId: null, jobStep: 1, jobLang: null, volumeDraft: null }); },
      runGenerate: function (e) {
        stop(e);
        if (!job || UI.generating) return;
        UI.jobError = null;
        setUI({ generating: true });
        global.StudioAdapter.onGenerate(job.url, job.durationKnown
          ? { startSec: Math.round(job.start), endSec: Math.round(job.end) }
          : null, {
            musicEnabled: jobMusicOn,
            templateId: (activeTemplate && activeTemplate.id) || '',
            // The chip row was cosmetic before this: a picked nasheed was
            // never sent, so every job shuffled the whole library anyway.
            musicTrackId: (jobMusicOn && UI.jobTrackId) || '',
          });
      },
      // The panel stays mounted while an error is showing. It used to render
      // only while `generating` was true, and jobFailed() clears that flag in
      // the same call that sets the message -- so the reason for a failure was
      // bound to a node that had already unmounted, and the comment claiming it
      // "sits next to the button" described something nobody could ever see.
      genBusy: UI.generating || Boolean(UI.jobError) || UI.uploadPct !== null,
      genLabel: UI.generating ? 'Starting…' : 'Generate clips',
      genIcon: UI.generating ? 'ph ph-circle-notch' : 'ph-fill ph-sparkle',
      genIconStyle: 'font-size: 15px;' + (UI.generating ? ' animation: dcSpin 1.1s linear infinite;' : ''),
      // A real percentage while bytes move, a sweep while the server thinks.
      genBarStyle: UI.uploadPct !== null
        ? 'position: absolute; left: 0; bottom: 0; height: 2px; width: ' + Math.max(2, Math.min(100, UI.uploadPct)) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6); transition: width .2s ease;'
        : UI.generating
        ? 'position: absolute; left: 0; bottom: 0; height: 2px; width: 40%; background: linear-gradient(90deg, #D9B478, #F0D6A6); animation: dcSweep 1.1s ease-in-out infinite;'
        : 'display: none;',
      genProgressLabel: UI.uploadPct !== null
        ? 'Uploading ' + UI.uploadPct + '%' + (UI.uploadTotal ? ' · ' + fmtBytes(UI.uploadSent) + ' of ' + fmtBytes(UI.uploadTotal) : '')
        : UI.generating ? 'Queuing the lecture…' : (UI.jobError || ''),

      // ── Values the design hardcoded ──
      // These were literal text in the .dc.html. design/text-overrides.json turns
      // them into bindings at import time so they can carry the account's own
      // data; without that a customer sees the designer's placeholders, including
      // a payment card and a connection status that were never real.
      accountName: (DATA.user && (DATA.user.name || DATA.user.email)) || '',
      greeting: 'Studio' + (firstName ? ' · Salām, ' + firstName : ''),
      connSummary: connectedCount
        ? plural(connectedCount, 'account') + ' connected'
          + (activeCount < connectedCount ? ' · posting to ' + activeCount : '')
          + (needsReconnect.length ? ' · ' + needsReconnect.join(', ') + ' needs reconnecting' : '')
        : 'No accounts connected',
      cardLabel: current.stripeCustomerId ? 'Card on file · manage in billing' : 'No card on file',
      spendSummary: (current.used || 0) + ' spent this period · top-up tokens never expire',
      // What the balance actually buys, from the balance. The design shipped
      // "≈ 20 hours of lecture processing, or about 62 rendered clips" as a
      // literal, so the same sentence appeared under 6000 tokens and under 2.
      balanceMeans: (function () {
        if (current.unlimited) return 'No limit on this account — process as much as the worker can take.';
        var left = Math.max(0, Number(current.remaining || 0));
        var rate = Number((DATA.billing && DATA.billing.tokenRatePerMinute) || 1) || 1;
        var minutes = Math.floor(left / rate);
        if (!minutes) return 'Nothing left to spend. A top-up or a plan adds more.';
        var hours = Math.floor(minutes / 60);
        var length = hours >= 1
          ? '≈ ' + plural(hours, 'hour') + ' of lecture'
          : '≈ ' + plural(minutes, 'minute') + ' of lecture';
        // Clips come from the lecture, not from the wallet: a clip is free to
        // render, the source minutes it was cut from are what cost.
        return length + ' — that is what your tokens buy, charged on the range you select.';
      }()),
      // Real bytes, measured from the files on disk (engine storageBytes).
      // These tiles used to dress record counts up as a storage figure.
      storageSummary: plural(projects.length, 'lecture') + ' · ' + plural(clips.length, 'clip')
        + (storageTotal ? ' · ' + fmtBytes(storageTotal) : ''),
      storageSources: storage.sourceBytes ? fmtBytes(storage.sourceBytes) : String(projects.length),
      storageClips: storage.clipBytes ? fmtBytes(storage.clipBytes) : String(clips.length),
      storageTranscripts: String(projects.filter(function (p) { return lecState(p) === 'ready'; }).length),
      jobTitle: active ? projectTitle[active.id] : 'Nothing processing',
      jobMeta: active
        ? humanDuration(active.durationSec || active.sourceDurationSec) + ' source · ' + plural(active.clipCount || 0, 'clip') + ' requested'
        : 'Paste a lecture to start',
      // Failures need a person more urgently than unreviewed clips do, so the
      // badge counts both rather than quietly ignoring the failures.
      // Dismissed failures are excluded; clips awaiting review are not, because
      // dismissing a notification does not review a clip.
      activityNeedsYou: (liveFailures.length + needsCount) + ' need you',
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
      postWindowNote: 'Set on the server' + (DATA.timezone ? ' · ' + DATA.timezone : '') + '.',
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
      edSourceLabel: edClip ? secsToClock(edDuration) + ' · clip' : '',
      edTimeReadout: edClip ? secsToClock(edTime) + ' / ' + secsToClock(edDuration) : '',

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
      // Height-led, not width-led: at width:100% a 9:16 frame inside the modal
      // was taller than the screen, so the preview opened with its controls and
      // most of the picture below the fold. 70vh keeps the whole clip and the
      // close button in view on any window.
      playerThumb: 'position: relative; height: min(70vh, 640px); aspect-ratio: 9 / 16; width: auto; margin: 0 auto; border-radius: 10px; background: ' + thumb(UI.playerClip && UI.playerClip.thumbUrl) + ';',
      closePlayer: function (e) { stop(e); setUI({ playerClip: null }); },
      // Scrubs the clip: click anywhere on the timeline to move the playhead,
      // and the video follows. e.dcTarget is the delegation fix -- currentTarget
      // is the mount, not the bar that was clicked.
      seek: function (e) {
        var bar = (e && e.dcTarget) || (e && e.currentTarget);
        if (!bar || !bar.getBoundingClientRect) return;
        var box = bar.getBoundingClientRect();
        if (!box.width) return;
        var ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
        var seconds = ratio * edDuration;
        setUI({ edPlayhead: ratio, edTime: seconds });
        seekHost(seconds);
      },

      // No boot animation: the host page has already run its own splash by the
      // time the dashboard mounts, and a second one just delays the first paint.
      booting: false,
      navLoading: false,
      // ── The guided tour ──
      // The design ships the whole thing -- veil, spotlight, card, dots -- and
      // it was stubbed off with a note about the legacy dashboard "owning
      // onboarding". That dashboard is gone, so a new account was handed an
      // empty studio and no explanation, and three data-tour anchors sat in
      // the markup doing nothing. A control that cannot fire must not be
      // shipped (CLAUDE.md); this makes it fire.
      tourOn: tourOn,
      tourNotFirst: tourIndex > 0,
      tourTitle: tourStep ? tourStep.title : '',
      tourBody: tourStep ? tourStep.body : '',
      tourCount: tourStep ? 'Step ' + (tourIndex + 1) + ' of ' + tourSteps.length : '',
      // The last step on Home is the one that hands over to the actual work.
      tourNextLabel: tourIndex < tourSteps.length - 1 ? 'Next'
        : UI.screen === 'home' ? 'Start clipping' : 'Got it',
      tourDots: tourSteps.map(function (_step, i) {
        return {
          style: 'width: ' + (i === tourIndex ? '16px' : '6px') + '; height: 6px; border-radius: 20px; background: '
            + (i === tourIndex ? '#F0D6A6' : '#33333A') + '; transition: width .18s ease, background .18s ease;',
        };
      }),
      tourVeilStyle: tourOn
        ? 'position: fixed; inset: 0; z-index: 200; background: rgba(6,6,8,.72); backdrop-filter: blur(2px);'
        : 'display: none;',
      // The spotlight is the anchor's own rectangle, measured each paint, with
      // a ring around it -- so it keeps up with a collapsing rail or a resize
      // instead of pointing at where an element used to be.
      tourSpotStyle: (function () {
        if (!tourOn) return 'display: none;';
        var box = tourRect;
        if (!box) return 'display: none;';
        return 'position: fixed; z-index: 201; pointer-events: none; border-radius: 12px;'
          + ' left: ' + Math.round(box.left - 6) + 'px; top: ' + Math.round(box.top - 6) + 'px;'
          + ' width: ' + Math.round(box.width + 12) + 'px; height: ' + Math.round(box.height + 12) + 'px;'
          + ' box-shadow: 0 0 0 9999px rgba(6,6,8,.72), 0 0 0 2px rgba(240,214,166,.9);';
      }()),
      tourCardStyle: (function () {
        if (!tourOn) return 'display: none;';
        var vh = global.innerHeight || 800;
        var vw = global.innerWidth || 1280;
        // Capped and scrollable, so a long step can never be taller than the
        // screen it has to fit on.
        var base = 'position: fixed; z-index: 202; width: min(340px, calc(100vw - 32px));'
          + ' max-height: calc(100vh - 32px); overflow: auto;'
          + ' display: flex; flex-direction: column; gap: 9px; padding: 16px;'
          + ' border: 1px solid #2C2C32; border-radius: 14px;'
          + ' background: linear-gradient(160deg, #16161A, #101013);'
          + ' box-shadow: 0 30px 70px rgba(0,0,0,.7);';
        var box = tourRect;
        if (!box) return base + ' left: 50%; top: 50%; transform: translate(-50%, -50%);';
        // Below the anchor when there is room, otherwise above it -- and
        // clamped on BOTH axes. It was clamped horizontally only, so placing
        // above an anchor near the top of the page pushed the card off the top
        // of the screen: the title and most of the body were simply not there,
        // leaving a paragraph ending mid-sentence and a Next button.
        var CARD_H = 230;
        var width = Math.min(340, vw - 32);
        var left = Math.max(16, Math.min(vw - width - 16, box.left));
        var below = box.top + box.height + 14;
        var top = (below + CARD_H < vh) ? below : box.top - CARD_H - 14;
        top = Math.max(16, Math.min(top, vh - CARD_H - 16));
        return base + ' left: ' + Math.round(left) + 'px; top: ' + Math.round(top) + 'px;';
      }()),
      tourNext: function (e) {
        stop(e);
        if (tourIndex >= tourSteps.length - 1) return endTour();
        setUI({ tourStep: tourIndex + 1 });
      },
      tourBack: function (e) { stop(e); setUI({ tourStep: Math.max(0, tourIndex - 1) }); },
      tourSkip: function (e) { stop(e); endTour(); },
      // The dimmed area is a way out. A veil with nothing to dismiss it is an
      // unusable page, and that is the one failure a tour must never cause.
      tourDismiss: function (e) { stop(e); endTour(); },
      // Offered for good in the account menu, so it is repeatable rather than
      // a one-shot a new user can lose by clicking past it.
      startTour: function (e) { stop(e); forgetTours(); setUI({ tourStep: 0, tourScreen: 'home', menuOpen: false, screen: 'home' }); },
      // "Show me around" on the screen you are looking at.
      tourHere: function (e) { stop(e); setUI({ tourStep: 0, tourScreen: UI.screen }); },
      tourHereShown: tourSteps.length > 0 && !tourOn,

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
      // These two were an <a href="#"> with no handler and a link to the
      // marketing page. Clicking "Account settings" left you on whatever
      // screen you were already on, and "Help & guides" sold you the product
      // you had already bought.
      accountSettings: function (e) { stop(e); global.StudioAdapter.onAccountSettings(); },
      helpGuides: function (e) { stop(e); global.StudioAdapter.onContactSupport(); },
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
        var base = clash ? t.name + ' (' + (i + 1) + ')' : t.name;
        return base + (t.pro && !planAllowsProTemplates(DATA) ? ' \u00b7 Pro' : '');
      }),
      activeTpl: (function () {
        if (!activeTemplate) return '';
        var i = templates.findIndex ? templates.findIndex(function (t) { return t.id === activeTemplate.id; }) : -1;
        var clash = templates.filter(function (o) { return o.name === activeTemplate.name; }).length > 1;
        return clash && i > -1 ? activeTemplate.name + ' (' + (i + 1) + ')' : activeTemplate.name;
      })(),
      setActiveTpl: function (e) {
        var label = String(e.target.value).replace(/ \u00b7 Pro$/, '');
        var picked = templates.filter(function (t, i) {
          var clash = templates.filter(function (o) { return o.name === t.name; }).length > 1;
          return (clash ? t.name + ' (' + (i + 1) + ')' : t.name) === label;
        })[0];
        if (!picked) return;
        // Said here, before any request goes out, rather than arriving as a 400
        // with the select snapping back.
        if (picked.pro && !planAllowsProTemplates(DATA)) {
          toast('"' + picked.name + '" is a Pro style. Any paid plan unlocks it.');
          refresh();
          return;
        }
        // In the editor this dropdown means "render THIS CLIP with that
        // template". It used to change the account's default template
        // instead, which the pinned clip never reads -- so picking a style
        // here visibly did nothing.
        if (UI.screen === 'editor' && UI.edClipId) {
          setUI({ edTplId: picked.id, edStyleDraft: null, edBlockDraft: null });
          global.StudioAdapter.onApplyTemplateToClip(UI.edClipId, picked.id);
          return;
        }
        global.StudioAdapter.onSelectTemplate(picked.id);
      },
      tplStyleRows: tplRow([
        { icon: 'ph ph-layout', label: 'Clip layout', field: 'fitMode', opts: ENUMS.fitMode, labels: { contain: 'Fit with blurred bars', blur: 'Blurred background', crop: 'Fill, face-tracked' } },
        { icon: 'ph ph-crosshair', label: 'Framing bias', field: 'smartFramingBias', opts: ENUMS.smartFramingBias },
        { icon: 'ph ph-closed-captioning', label: 'Caption', field: 'captionMode', opts: ENUMS.captionMode, labels: { phrase: 'One phrase', word: 'Word by word', 'dynamic-stack': 'Stacked lines', 'stack-build': 'Building stack', cards: 'Phrase cards' } },
        { icon: 'ph ph-palette', label: 'Look', field: 'filterPreset', opts: ENUMS.filterPreset },
      ]),
      tplBrandRows: tplRow([
        { icon: 'ph ph-image-square', label: 'Watermark position', field: 'watermarkPosition', opts: ENUMS.watermarkPosition },
        { icon: 'ph ph-text-aa', label: 'Caption position', field: 'captionPosition', opts: ENUMS.captionPosition },
        { icon: 'ph ph-align-center-horizontal', label: 'Caption alignment', field: 'captionHorizontal', opts: ENUMS.captionHorizontal },
      ]),
      // Voice enhancement is the one processing toggle the worker really applies.
      tplAIRows: [{ key: 'voiceEnhance', icon: 'ph ph-waveform', label: 'Voice enhancement', note: 'levels and clarity on speech' },
        { key: 'captionBehindSubject', icon: 'ph ph-user-focus', label: 'Captions behind speaker', note: 'the speaker is cut out and laid over the text' }].map(function (r) {
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
      capPreviewText: tpl.captionMode === 'quran' ? SAMPLE_AYAH.arabic : sampleCaptionAt(previewAt, tpl.captionMode, tpl.captionStackMaxWords),

      // The words on screen, with the live one marked, so the preview can show
      // the highlight in its own face, slant, colour and glow -- the thing that
      // makes the stacked style read, and which the renderer has always done
      // even though nothing could configure it.
      capWords: (function () {
        // Quran mode draws scripture: one ayah in the Quranic face with its
        // verse mark and translation, no per-word highlight -- the render
        // never animates an ayah. The English sample said nothing true about
        // this mode.
        if (tpl.captionMode === 'quran') {
          var sampleMark = (tpl.captionArabicFont || 'Amiri') === 'KFGQPC HAFS Uthmanic Script'
            ? SAMPLE_AYAH.mark.replace('\u06DD', '')
            : SAMPLE_AYAH.mark;
          return [{ text: SAMPLE_AYAH.arabic + '\u00A0' + sampleMark, style: '' }];
        }
        var parts = sampleCaptionParts(previewAt, tpl.captionMode, tpl.captionStackMaxWords);
        return parts.words.map(function (text, i) {
          var on = i === parts.liveIndex;
          return {
            text: text,
            style: on ? captionHighlightStyle(tpl) : '',
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

      capGloss: tpl.captionMode === 'quran' && tpl.captionTranslation !== false ? SAMPLE_AYAH.gloss : '',
      capGlossStyle: ayahGlossStyle(tpl),
      capMarkScale: ayahMarkScale(tpl.captionArabicFont || 'Amiri'),
      capStyle: captionPlacementStyle(tpl, UI.dragPreview && UI.dragPreview.kind === 'caption' ? UI.dragPreview.y : null)
        + (tpl.captionMode === 'quran' ? ayahFaceStyle(tpl) : captionFaceStyle(tpl))
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
        if (UI.tplPast.length) { UI.capTextStepAt = 0; return replayStyle(UI.tplPast, UI.tplFuture, 'undo'); }
        // The editor has no "discard the shared template" fallback: with no
        // steps recorded there is nothing to go back to, and saying so beats
        // resetting a template the user is not even looking at.
        if (UI.screen === 'editor') { toast('Nothing to undo.'); return; }
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
        if (!url) { toast('Paste a lecture link first, or upload an MP4.'); return; }
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

      tplNames: templates.map(function (t) {
        return t.name + (t.pro && !planAllowsProTemplates(DATA) ? ' \u00b7 Pro' : '');
      }),
      jobTpl: activeTemplate ? activeTemplate.name : '',
      setTpl: function (e) {
        var label = String(e.target.value).replace(/ \u00b7 Pro$/, '');
        var picked = templates.filter(function (t) { return t.name === label; })[0];
        if (picked && picked.pro && !planAllowsProTemplates(DATA)) {
          toast('"' + picked.name + '" is a Pro style. Any paid plan unlocks it.');
          refresh();
          return;
        }
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
      // The account's own value joins the presets when it is not one of them.
      // Stored counts do not have to come from this control -- the settings
      // screen and older versions both wrote others -- and an account on 8
      // saw four options with none of them selected, a control that could not
      // show its own state.
      countOpts: [3, 6, 9, 12].concat([3, 6, 9, 12].indexOf(clipsPerVideo) === -1 && clipsPerVideo > 0 ? [clipsPerVideo] : [])
        .sort(function (a, b) { return a - b; })
        .map(function (n) {
        var on = clipsPerVideo === n;
        return {
          // The number alone. Five options each ending in "clips" repeated the
          // unit five times; it is said once, after the row.
          label: String(n),
          rowStyle: 'display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; cursor: pointer; color: ' + (on ? '#F0D6A6' : '#BCBCC3') + ';',
          // Inline in the wizard rather than behind a dropdown. As a menu it
          // opened downward out of the panel, overlapping Continue and
          // clipping at the dialog's edge -- and it sat under the length
          // pills as a bare text button, which read as an afterthought
          // rather than the second half of the same question.
          optStyle: wordOption(on, 15),
          boxStyle: 'display: grid; place-items: center; width: 15px; height: 15px; flex: none; border-radius: 4px; border: 1px solid ' +
            (on ? '#D9B478; background: rgba(217,180,120,.18);' : '#33333A; background: #0E0E11;'),
          toggle: function (e) {
            stop(e);
            UI.countsOpen = false;
            global.StudioAdapter.onClipSettings({ clipsPerVideo: n });
          },
        };
      }),

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
          remove: function (e) { stop(e); global.StudioAdapter.onRemoveTrack(t.id); },
        };
      }),
      // The template already writes " nasheeds in rotation." after this, so it
      // takes the bare count.
      rotCount: String(tracks.length),
      nasheedVol: musicVolume,
      nasheedVolLabel: musicVolume + '%',
      nasheedDb: (musicVolume ? Math.round(20 * Math.log10(musicVolume / 100)) : -60) + ' dB under speech',
      setVol: setVolumeFrom,

      // ── Performance ──
      // The product does not collect view, save or watch-time data: a published
      // clip's record carries delivery status only. Rather than invent numbers,
      // the tiles report what is genuinely known and the leaderboard ranks by the
      // score the worker assigned.
      // Everything on this screen now answers to the chosen range. A clip
       // counts by when it was made, a lecture by when it was submitted.
      perfRangeNote: PERF_WINDOW
        ? 'Counting what was made in the ' + String(UI.perfRange).toLowerCase().replace(/^last /, 'last ') + '.'
        : 'Counting everything on the account.',
      perfRanges: ['Last 7 days', 'Last 30 days', 'All time'].map(function (label) {
        return {
          label: label,
          style: tabStyle(UI.perfRange === label),
          select: function (e) { stop(e); setUI({ perfRange: label }); },
        };
      }),
      perfTiles: [
        { icon: 'ph-fill ph-stack', label: 'Clips generated', value: String(perfClips.length) },
        { icon: 'ph-fill ph-check-circle', label: 'Approved', value: String(perfClips.filter(function (c) { return decision(c) === 'approved'; }).length) },
        { icon: 'ph-fill ph-paper-plane-tilt', label: 'Posted', value: String(perfClips.filter(function (c) { return c.postedAt; }).length) },
        { icon: 'ph-fill ph-film-script', label: 'Lectures', value: String(perfProjects.length) },
      ].map(function (t) {
        return { icon: t.icon, label: t.label, value: t.value, delta: '', deltaIcon: '', deltaStyle: 'display: none;' };
      }),
      perfBoard: perfClips.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 5).map(function (c, i) {
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
        // Free has no price id, so it can never be "chosen" -- the server
        // refuses it with "Choose weekly, monthly, or yearly." The card
        // nonetheless rendered an enabled Choose button to every paying
        // customer, which is the only thing on the screen that looks like a
        // downgrade. Downgrading means cancelling, and cancelling lives in the
        // portal, so the card says that instead of throwing.
        var isFreeCard = p.id === 'free';
        var unavailable = p.enabled === false || (isFreeCard && !isCurrent);
        return {
          name: p.name || p.id || '',
          price: p.priceLabel || (p.id === 'free' ? 'Free' : 'Price not set'),
          per: p.interval && p.interval !== 'one-time' ? 'per ' + p.interval : '',
          // The markup already writes the word after it, so pluralising here
          // produced "40 tokens tokens" on every card.
          tokens: p.tokens != null ? String(p.tokens) : '',
          // The server has computed exactly what a paid plan adds and exactly
          // what free already includes since the plan split was built, and
          // shipped both to the browser in publicBilling -- where nothing has
          // ever rendered them. A free user had no screen telling them what
          // paying changes, and the free card never said how much it already
          // does. Both are named here, from the server's own lists, so the two
          // can never drift from what the gates enforce.
          lines: [{ text: p.description || '' }]
            .concat(p.id === 'free'
              ? (DATA.billing && DATA.billing.freeIncludes || []).map(function (t) { return { text: t }; })
              : Object.keys(DATA.billing && DATA.billing.proFeatures || {}).map(function (k) {
                return { text: DATA.billing.proFeatures[k] };
              }))
            .filter(function (l) { return l.text; }),
          hasTag: Boolean(isCurrent || p.badge),
          tag: isCurrent ? 'Current plan' : (p.badge || ''),
          tagStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: ' +
            (isCurrent ? 'rgba(217,180,120,.16); color: #F0D6A6;' : 'rgba(127,209,166,.14); color: #7FD1A6;'),
          cardStyle: 'display: flex; flex-direction: column; gap: 9px; padding: 14px; border-radius: 12px; border: 1px solid ' +
            (isCurrent ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.05);' : '#1E1E22; background: #121214;'),
          cta: isCurrent ? 'Current' : isFreeCard ? 'Cancel to return here' : unavailable ? 'Not available' : 'Choose',
          btnStyle: 'padding: 8px 12px; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: ' +
            (isCurrent || unavailable ? 'default' : 'pointer') + '; border: 1px solid ' +
            (isCurrent || unavailable ? '#26262A; background: #17171A; color: #6E6E76;' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'),
          choose: function (e) {
            stop(e);
            if (isCurrent) return;
            if (isFreeCard) { toast('To go back to Free, cancel your plan under Manage billing.'); return; }
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
      // Said in the order a person needs it: what is wrong, then what is
      // temporary, then the ordinary renewal date. "Renews in 0 days" used to
      // show on an unlimited owner account, which is true of nothing.
      planNote: (function () {
        var status = String(current.status || '').toLowerCase();
        if (current.unlimited) return 'Owner account — no limit and no renewal.';
        if (status === 'past_due' || status === 'unpaid') {
          return 'Your last payment failed. Update your card under Manage billing or the plan will stop.';
        }
        var free = current.freeTrial || {};
        if (free.expired && (current.plan || 'free') === 'free') return 'Your free trial has ended. Choose a plan to keep going.';
        if (free.endsAt && !free.expired) return plural(free.daysLeft || 0, 'free day') + ' left, then a plan is needed.';
        if (current.trial && current.trial.active) {
          return 'Trial — ' + plural(current.trial.daysLeft || 0, 'day') + ' left. Your full allowance starts on the first paid day.';
        }
        return current.periodEndsInDays != null
          ? 'Renews in ' + plural(current.periodEndsInDays, 'day')
          : 'No renewal date on this plan.';
      }()),
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
    // The host registers the editor's <video> here and reports playback back.
    // The adapter cannot create the element itself -- the design compiles to a
    // still frame, and a re-render would tear a playing video down -- so the
    // element is host-owned and this is the seam between them.
    setEditorVideo: function (node) { edVideo(node); },
    editorVideo: function () { return edVideo(); },
    seekEditor: seekHost,
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
    onToggleDesktopNotifs: function () {},
    onGenerate: function () {},
    onUploadNasheedPrompt: function () {},
    onApplyTemplateToClip: function () {},
    onBulkClips: function () {},
    onBulkProjects: function () {},
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
      UI.jobStep = 1;
      UI.generating = false;
      UI.jobUrl = '';
      // The kind ALWAYS opens on "Islamic lecture" (Goal item 06). It used
      // to inherit the account's selected template, so an account whose
      // default style was the Quran one opened every new lecture pre-set to
      // scripture-only captions -- and a lazy Continue produced clips whose
      // lecture speech was silently uncaptioned (invariant 7). Set
      // explicitly, because the server's own fallback is that same selected
      // template. Quran stays one deliberate click away.
      var offered = (LAST_DATA && LAST_DATA.templates) || [];
      for (var i = 0; i < offered.length; i += 1) {
        if (offered[i].captionMode !== 'quran' && !(offered[i].pro && !planAllowsProTemplates(LAST_DATA))) {
          UI.jobTplId = offered[i].id;
          break;
        }
      }
      refresh();
    },
    jobDone: function () { UI.job = null; UI.generating = false; refresh(); },
    // Called when the server refused the source. The panel stays open so the
    // reason sits next to the button that caused it.
    jobFailed: function (message) {
      UI.generating = false;
      UI.uploadPct = null;
      UI.jobError = String(message || 'That source was refused.');
      refresh();
    },
    // Called by the host on every upload progress event. Passing null ends it,
    // whether the upload finished or threw.
    setUploadProgress: function (pct, sent, total) {
      if (pct === null || pct === undefined) {
        UI.uploadPct = null; UI.uploadSent = 0; UI.uploadTotal = 0;
      } else {
        UI.uploadPct = Math.max(0, Math.min(100, Math.round(pct)));
        UI.uploadSent = Number(sent) || 0;
        UI.uploadTotal = Number(total) || 0;
      }
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
    onRestore: function () {},
    onMoreClips: function () {},
    onRetryProject: function () {},
    onAccountSettings: function () {},
    onContactSupport: function () {},
    onDownloadClips: function () {},
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
