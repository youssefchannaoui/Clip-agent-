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
    // The unsaved trim, as {from,to} in clip-local seconds. null = untouched.
    edTrim: null,
    // Sections removed from INSIDE the trim, as [from, to] pairs; null means
    // "whatever the clip has saved". edCutMark is the first end of a cut in
    // progress -- the playhead position when "Cut a section from here" was
    // pressed -- or null.
    edCutOuts: null,
    edCutMark: null,
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
    // The deck's in-place player. Muted by default because the deck can render
    // without a user gesture (autoplay with sound would simply be blocked and
    // read as broken); M / the sound chip unmutes, which IS a gesture.
    deckMuted: true,
    deckRate: 1,
    // DeenAI's ask box. The answer is held here, not in DATA: it belongs to
    // this sitting, and a state poll must not wipe a reply mid-read.
    aiQ: '',
    aiAnswer: '',
    aiBusy: false,
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

  // ── desktop notifications ────────────────────────────────────────────────
  // FOUR states, and they need four different things said, which is why this
  // is a state rather than a boolean: 'unsupported' and 'denied' cannot be
  // fixed by pressing the switch, so a surface that only knows on/off shows a
  // control that silently refuses -- exactly the "I don't think they work"
  // report this was written for. The preference is per BROWSER (it decides
  // whether THIS browser pops up while a tab is open), so it lives in
  // localStorage rather than on the account, and the browser's own permission
  // is the other half: either one being off means no pop-up.
  function desktopNotifsState() {
    try {
      if (typeof Notification === 'undefined') return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      if (Notification.permission !== 'granted') return 'off';
      return localStorage.getItem('deenDesktopNotifs') === 'on' ? 'on' : 'off';
    } catch (e) { return 'off'; }
  }
  /*
   * "Desktop notifications" stopped being true when Web Push shipped: the same
   * switch now reaches a phone, and reaches it with DeenClipped closed. The
   * bell dropdown's copy is a literal in the design export, so it is a
   * text-override (design/text-overrides.json) rather than a re-import, which
   * would regenerate every hashed class name in the app for one label. One
   * constant, read by all three surfaces, so they cannot call it three things.
   */
  var NOTIFS_LABEL = 'Notifications on this device';
  var DESKTOP_NOTIF_NOTE = {
    unsupported: 'Not available in this browser',
    denied: 'Blocked in your browser settings',
    on: 'On — you will be told when clips are ready',
    off: 'Off — turn on to hear when clips are ready',
  };
  /*
   * Whether THIS browser holds a Web Push subscription -- i.e. whether the
   * notification arrives with DeenClipped closed, or only while a tab is open.
   * The page owns the answer (only it can ask the PushManager) and writes it
   * to one global; every surface reads it from here so none of them can make a
   * different promise about the same switch. False is the safe default: it
   * describes the weaker guarantee, and over-promising here is how someone
   * closes the tab and misses the thing they turned this on for.
   */
  function pushArrivesClosed() {
    try { return Boolean(global.__dcPushOn); } catch (e) { return false; }
  }

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
    return u ? 'var(--dc-bg-raised, #17171A) url("' + cssUrl(u) + '") center/cover no-repeat' : 'var(--dc-bg-raised, #17171A)';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  // A percentage is a true answer that means nothing to the person moving the
  // slider. "Centred" is what they are actually choosing.
  function cropLabel(value, low, mid, high) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0.5;
    var pct = Math.round(Math.max(0, Math.min(1, n)) * 100);
    if (pct <= 12) return low;
    if (pct >= 88) return high;
    if (pct >= 45 && pct <= 55) return mid;
    return pct + '%';
  }
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
  // What the deck is showing right now -- written on every bindings run, read
  // by deckAct() below so the host's keyboard lands on the same clip the
  // buttons would. Never rendered; purely the seam between key and card.
  var deckNowId = null;
  var deckNowCount = 0;

  function decision(c) {
    if (UI.pending[c.id]) return UI.pending[c.id];
    if (c.status === 'rejected') return 'rejected';
    if (SETTLED[c.status]) return 'approved';
    if (c.status === 'waiting') return null;
    return 'other';   // still processing, or failed — not part of the review queue
  }

  function tabStyle(on) {
    return 'display: flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 20px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; border: 1px solid ' +
      (on ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: var(--dc-gold-lit, #F0D6A6);' : 'var(--dc-line, #26262A); background: var(--dc-bg, #121214); color: var(--dc-ink-soft, #A2A2AA);');
  }

  function pillStyle(on) {
    return 'padding: 1px 6px; border-radius: 20px; font-size: 10.5px; background: ' +
      (on ? 'rgba(217,180,120,.18)' : 'var(--dc-n-1d1d21, #1D1D21)') + '; color: inherit;';
  }

  function toggleBtnStyle(on) {
    return 'display: grid; place-items: center; width: 30px; height: 28px; border-radius: 7px; cursor: pointer; transition: background .14s ease; border: 1px solid ' +
      (on ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.12); color: var(--dc-gold-lit, #F0D6A6);' : 'var(--dc-line, #26262A); background: var(--dc-bg, #121214); color: var(--dc-ink-dim, #8B8B93);');
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
      (on ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.22);' : 'var(--dc-n-33333a, #33333A); background: var(--dc-bg-raised, #17171A);');
  }
  function switchKnob(on) {
    return 'position: absolute; top: 2px; left: ' + (on ? '17px' : '2px') + '; width: 13px; height: 13px; border-radius: 50%; background: ' +
      (on ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-faint, #6E6E76)') + '; transition: left .16s ease, background .16s ease;';
  }

  // Every word-sized choice in the job wizard wears this: the word itself,
  // over a rule that is gold when chosen and invisible when not. A bordered
  // pill with a tinted fill and a little icon announces that it is a control
  // before it says which one is picked -- five of them in a row read as
  // decoration, and the wizard had four such rows.
  function wordOption(on, size) {
    return 'min-width: 46px; padding: 9px 15px; border: 0; border-radius: 8px; cursor: pointer;'
      + ' background: ' + (on ? 'var(--dc-n-26262e, #26262E)' : 'transparent') + ';'
      + ' font-family: inherit; font-size: ' + (size || 14) + 'px;'
      + ' font-weight: ' + (on ? '600' : '400') + '; letter-spacing: -.01em;'
      + ' color: ' + (on ? 'var(--dc-n-f6f6f8, #F6F6F8)' : 'var(--dc-n-9a9aa2, #9A9AA2)') + ';'
      + ' transition: background .16s ease, color .16s ease;';
  }
  // The track the segments sit in.
  var SEG_RAIL = 'display: inline-flex; padding: 3px; border-radius: 11px;'
    + ' background: var(--dc-n-121215, #121215); border: 1px solid var(--dc-n-212127, #212127);';

  var volumeSaveTimer = null;
  function saveVolumeSoon(n) {
    if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(function () {
      volumeSaveTimer = null;
      global.StudioAdapter.onMusicSettings({ volumePercent: n });
    }, 320);
  }

  function sliderTrack() {
    return 'position: relative; flex: 1; height: 4px; border-radius: 4px; background: var(--dc-line, #26262A);';
  }
  function sliderKnob(on) {
    return 'position: absolute; top: 50%; translate: 0 -50%; width: 14px; height: 14px; border-radius: 50%; background: ' +
      (on ? 'var(--dc-gold, #D9B478)' : 'var(--dc-ink-faint, #6E6E76)') + '; box-shadow: 0 2px 6px rgba(0,0,0,.5);';
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
          + (tone === 'warn' ? 'var(--dc-n-ff5566, #FF5566)' : tone === 'gold' ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink, #F2F2F4)') + ';',
        rowStyle: 'display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-radius: 7px; margin: 0 -8px; padding: 5px 8px; text-decoration: none; color: inherit;'
          + (step ? ' cursor: pointer;' : ' cursor: default;'),
        editStyle: 'font-size: 11px; color: var(--dc-ink-faint, #6E6E76); display: ' + (step ? 'inline' : 'none') + ';',
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
      { anchor: 'perf-tiles', title: 'What happened to your work',
        body: 'Everything on this screen answers to the range you pick above: what was cut, what you kept, what actually posted, what a destination refused, and the source minutes it all cost.' },
      { anchor: 'perf-board', title: 'Scored, not measured',
        body: 'Clips are ranked by the score the worker gave each one when it cut them. DeenClipped does not collect views or watch time from any platform, so nothing here is audience data -- an invented number would be worse than an absent one.' },
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

  /**
   * Publish failures, which are a different animal from import failures.
   *
   * Everything in EXPLAIN above is about getting a lecture IN: download
   * refusals, the clipping service, disk, tokens. A destination refusing to
   * take a finished clip has nothing to do with any of that -- but the tables
   * were never separated, so `/403|forbidden/` matched TikTok's publish
   * refusal and answered it with "Download the video yourself and use Upload
   * MP4", which is advice about a video that had already been made. Reported
   * as "all are the same, this was never updated", and that is exactly what it
   * was.
   *
   * These are consulted FIRST for any row that names a destination, so an
   * import guide can never answer a publish question again.
   */
  var EXPLAIN_PUBLISH = [
    {
      match: /unaudited_client_can_only_post_to_private_accounts|has not finished reviewing/i,
      title: 'TikTok has not reviewed this app yet',
      cause: 'Until TikTok approves the app, it will only deliver posts to a TikTok account that is itself set to private. Nothing is wrong with the clip, the connection or your account — TikTok is refusing the destination, not the video.',
      fixes: [
        'Set that TikTok account to private and the clip posts immediately.',
        'Or finish the TikTok app review, after which public posting is allowed.',
        'Retrying without changing one of those two things will fail the same way.',
        'YouTube is unaffected — clips going there have already posted.',
      ],
    },
    {
      // Since v3.114.0 the clean copy TikTok requires is rendered
      // AUTOMATICALLY on both engines, so reaching here means that render
      // itself failed -- not that a watermark is in the way. The old entry
      // told people to switch the watermark off by hand, which is now advice
      // for a problem the app solves on its own.
      match: /watermark-free copy|TikTok-safe/i,
      title: 'The TikTok copy could not be rendered',
      cause: 'TikTok\u2019s posting rules refuse video carrying another app\u2019s mark, so DeenClipped renders a separate copy without one and posts that. Nothing reached TikTok \u2014 this is the extra render failing, and the reason is on the line above.',
      fixes: [
        'Press Retry: the copy is rendered again from the original lecture.',
        'If it keeps failing, check the lecture still has its source and a nasheed \u2014 the copy is a full re-render and needs both.',
        'Your own clip is untouched and still carries your watermark everywhere else.',
        'YouTube, Instagram and Facebook take the clip exactly as it is \u2014 they have no such rule.',
      ],
    },
    {
      match: /spam_risk|too_many_(?:posts|pending)|rate.?limit|reached the (?:daily|hourly) limit/i,
      title: 'The platform is rate-limiting this account',
      cause: 'The destination accepted the app but says this account has posted too much too quickly. It is a temporary cap, not a rejection of the clip.',
      fixes: [
        'Leave it a few hours and press Retry — the window rolls forward.',
        'Space the posting windows further apart if this keeps happening.',
        'Do not press Retry repeatedly; each attempt counts against the same cap.',
      ],
    },
    {
      match: /quota|uploadLimitExceeded|exceeded the number of videos/i,
      title: 'The daily upload limit has been reached',
      cause: 'The platform caps how many videos an account may upload in a day, separately from anything this app controls. The clip is fine and still rendered.',
      fixes: [
        'Retry after the limit resets — for YouTube that is midnight Pacific time.',
        'A brand new channel has a much lower cap until it is verified.',
        'Nothing was charged for this attempt.',
      ],
    },
    {
      match: /reconnect|no access token|not connected|revoked|refresh token|invalid_grant|unauthor/i,
      title: 'The connection to this account has expired',
      cause: 'The permission this app was given has lapsed or been withdrawn, so the platform no longer recognises it. This happens on its own after a password change, or if access was removed from the account\'s security settings.',
      fixes: [
        'Open Connections and reconnect that account.',
        'Then press Retry — the clip is still rendered and ready to go.',
        'Every clip waiting on that account will keep failing until it is reconnected.',
      ],
    },
    {
      match: /duplicate|already (?:been )?uploaded|identical video/i,
      title: 'The platform thinks this is a duplicate',
      cause: 'The destination has seen this exact video before and refused a second copy. Usually it means an earlier attempt actually succeeded.',
      fixes: [
        'Check the channel — the clip is very likely already live.',
        'If it is there, dismiss this rather than retrying.',
        'If it is not, change the title or re-render before trying again.',
      ],
    },
    {
      match: /too long|duration|exceeds the maximum|file (?:is )?too large|size limit/i,
      title: 'The clip is outside what this platform accepts',
      cause: 'The destination rejected the file on its length or its size rather than on its content.',
      fixes: [
        'Shorten the clip in the review queue and re-render it.',
        'Check that platform\'s current limit — they change without notice.',
        'The other destinations may have accepted it already.',
      ],
    },
    {
      match: /copyright|content id|claim|community guidelines|policy/i,
      title: 'The platform flagged the content itself',
      cause: 'This is a moderation or rights decision by the destination, not a technical failure. It will not resolve by retrying.',
      fixes: [
        'Open the platform\'s own studio to read the specific claim.',
        'The nasheed bed is the usual cause of a music claim — try another track.',
        'Do not retry until something about the clip has changed.',
      ],
    },
  ];

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
    // A publish failure never gets an import answer. The row names a
    // destination, or its text starts with "Publish failed" -- either is
    // enough, and both are set where these rows are built.
    var publishing = Boolean(row && (row.provider || /^publish failed/i.test(String(row.text || ''))));
    if (publishing) {
      for (var p = 0; p < EXPLAIN_PUBLISH.length; p += 1) {
        if (EXPLAIN_PUBLISH[p].match.test(text)) return EXPLAIN_PUBLISH[p];
      }
      // Still better than the import table: it names the destination, says
      // plainly that the clip itself is fine, and does not send anyone off to
      // re-download a video that has already been made.
      var where = (PLATFORM_NAMES[row.provider] || row.provider || 'The destination');
      return {
        title: where + ' would not accept this clip',
        cause: 'The clip is rendered and ready — ' + where + ' refused to publish it. The exact wording it gave is below; it is written for developers rather than for reading.',
        fixes: [
          'Press Retry once: a fair share of these are momentary.',
          'Check that account is still connected under Connections.',
          'Any other destination for this clip is unaffected and may already have posted.',
          'If it keeps refusing, the message below is what to quote when asking.',
        ],
      };
    }
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
        ? 'linear-gradient(to right, var(--dc-gold-lit, #F0D6A6), var(--dc-gold-lit, #F0D6A6))'
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
      out += ' background: ' + hexToRgba(t.captionBackground || 'var(--dc-n-000000, #000000)', opacity / 100) + ';'
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
      var colour = t.captionOutline || 'var(--dc-page, #09090A)';
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
    return ' color: ' + (t.captionPrimary || 'var(--dc-n-ffffff, #FFFFFF)') + ';'
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
    return ' color: ' + (t.captionPrimary || 'var(--dc-n-ffffff, #FFFFFF)') + ';'
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
    return 'color: ' + (t.captionHighlight || 'var(--dc-gold, #D9B478)') + ';'
      + ' font-family: ' + webFontFor(t.captionHighlightFont) + ';'
      + (t.captionHighlightItalic ? ' font-style: italic;' : '')
      + (glow ? ' text-shadow: 0 0 ' + ((glow / 2) / fontPx).toFixed(3) + 'em ' + (t.captionHighlight || 'var(--dc-gold, #D9B478)') + ';' : '')
      // display:inline-block, or transform does nothing on an inline box.
      + (popping ? ' display: inline-block; --dc-pop: ' + (popScale / 100).toFixed(3)
        + '; animation: dcCapPop ' + popMs + 'ms ease-out 1;' : '');
  }

  function hexToRgba(hex, alpha) {
    var value = String(hex || 'var(--dc-n-000000, #000000)').replace('#', '');
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
  // Would a viewer see a watermark on the export? The same two-part question
  // templates.js asks server-side, and it must stay the same question: a
  // watermark of one zero-width space renders as nothing, and a preview that
  // draws DEENCLIPPED for it is claiming a mark the export does not carry.
  // NO_INK mirrors templates.js — trim() alone removes whitespace and line
  // terminators and NOTHING else, which is exactly how the paid feature was
  // once taken for free.
  var NO_INK = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]/g;
  function markIsVisible(tpl) {
    return String(tpl && tpl.watermark || '').replace(NO_INK, '').trim() !== ''
      && Number(tpl && tpl.watermarkOpacity) > 0;
  }

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
    return 'position: absolute; ' + v + ' ' + h + ' max-width: 84%; color: ' + (colour || 'var(--dc-n-ffffff, #FFFFFF)') +
      '; font-size: ' + Math.max(9, Math.round(Number(size || 40) / 6)) + 'px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 6px rgba(0,0,0,.7);'
      + (font ? ' font-family: ' + font + ';' : '')
      + (upper ? ' text-transform: uppercase;' : '');
  }


  // Platforms spell themselves; naive capitalisation gives "Tiktok".
  // Free, then the commitment ladder. The period tabs used to impose this order
  // by showing one plan at a time; with every plan on screen the cards have to
  // carry it themselves. Free has no interval, so ranking on interval alone
  // sorted it to the end -- the cheapest option last, after the yearly one.
  var INTERVAL_ORDER = { week: 1, month: 2, year: 3 };
  function planRank(plan) {
    if (String(plan && plan.id) === 'free') return 0;
    return INTERVAL_ORDER[plan && plan.interval] || 9;
  }
  var PLATFORM_NAMES = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
  var PLATFORM_ICONS = {
    youtube: 'ph ph-youtube-logo', instagram: 'ph ph-instagram-logo',
    tiktok: 'ph ph-tiktok-logo', facebook: 'ph ph-facebook-logo',
  };
  // A schedule row used to name targets[0] and nothing else, so a clip going to
  // three places said "YouTube" and a clip whose YouTube post had failed while
  // TikTok went out looked, on the row, entirely fine. Each destination now
  // carries its own state and says it in its own colour.
  var TARGET_STATES = {
    posted: { word: 'posted', colour: 'var(--dc-n-7fd1a6, #7FD1A6)' },
    publishing: { word: 'posting now', colour: 'var(--dc-n-e4c489, #E4C489)' },
    retrying: { word: 'retrying', colour: 'var(--dc-n-e6b770, #E6B770)' },
    failed: { word: 'failed', colour: '#E08770' },
    scheduled: { word: 'waiting', colour: 'var(--dc-ink-dim, #8B8B93)' },
    cancelled: { word: 'cancelled', colour: 'var(--dc-ink-faint, #6E6E76)' },
  };
  function destinations(clip) {
    return (clip.targets || []).map(function (t) {
      var platform = t.platform || t.provider || '';
      var state = TARGET_STATES[t.status] || TARGET_STATES.scheduled;
      var label = (PLATFORM_NAMES[platform] || platform || 'Unknown')
        + (t.accountName ? ' · ' + t.accountName : '') + ' — ' + state.word;
      // THE LOGO CARRIES IT WHEN NOTHING IS WRONG. Youssef, 3 Sept 2026, on
      // the schedule: "for the logos here dont be writing just put logos that
      // are posting." A row going to two places read as
      // "YouTube · DeenClipped — waiting  TikTok · DeenClipped — waiting",
      // which is two sentences to say what two marks say.
      //
      // A PROBLEM STILL GETS ITS WORD. Colour alone would be carrying it, and
      // this app has already shipped the bug where a clip live on YouTube with
      // a refused TikTok "looked entirely fine on the row" (v3.28.0). Anything
      // that needs a person keeps its text; waiting, posting and posted do not.
      var quiet = t.status === 'scheduled' || t.status === 'publishing' || t.status === 'posted';
      return {
        name: '',
        who: '',
        state: quiet ? '' : ' ' + state.word,
        // The whole sentence is still there, on hover, for the rows that no
        // longer print it.
        title: label,
        icon: PLATFORM_ICONS[platform] || 'ph ph-share-network',
        style: 'display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: ' + state.colour + ';',
      };
    });
  }
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
    // The chosen list, falling back to the single id every record held before
    // multi-account. Filtered against what is actually connected, so an id left
    // behind by a disconnected Page does not render as a ticked box for an
    // account that is no longer there.
    var live = {};
    for (var a = 0; a < accounts.length; a++) live[accounts[a].id] = 1;
    var chosen = (setting.accountIds && setting.accountIds.length ? setting.accountIds : [setting.accountId])
      .filter(function (id) { return id && live[id]; });
    var limit = ((DATA.publishingLimits || {})[key]) || 1;
    return {
      key: key,
      title: PLATFORM_TITLES[key] || key,
      oauth: OAUTH_OF[key] || key,
      icon: key === 'youtube' ? 'ph ph-youtube-logo' : key === 'instagram' ? 'ph ph-instagram-logo'
        : key === 'tiktok' ? 'ph ph-tiktok-logo' : 'ph ph-facebook-logo',
      status: status,
      accounts: accounts,
      accountIds: chosen,
      maxAccounts: limit,
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

  // Short names for the phone tab bar. A 375px screen divided by five leaves
  // about 70px a tab, and "Lecture library" simply does not fit -- it rendered
  // as "Lecture lib...", which is a label that has stopped being one.
  var NAV_SHORT = {
    home: 'Home', library: 'Library', queue: 'Review', schedule: 'Schedule',
    templates: 'Styles', music: 'Nasheed', performance: 'Stats', owner: 'Owner',
  };
  // Five is the most a phone tab bar can carry. Nasheed, Performance and Owner
  // come off it rather than being squeezed: two of them ran clean off the right
  // edge of the screen, which is worse than not being in the bar at all. They
  // stay reachable from the account menu.
  var NAV_PRIMARY = { home: 1, library: 1, queue: 1, schedule: 1, templates: 1 };

  function navItem(key, label, icon, count) {
    var on = UI.screen === key;
    var open = UI.railOpen && (global.innerWidth || 1280) > 820;
    return {
      key: key,
      label: label,
      short: NAV_SHORT[key] || label,
      // Read only by the phone stylesheet; on a wide screen every item shows.
      mobileClass: NAV_PRIMARY[key] ? 'dc-nav-primary' : 'dc-nav-secondary',
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
        (on ? 'var(--dc-gold, #D9B478); background: rgba(217,180,120,.09) !important; color: var(--dc-gold-lit, #F0D6A6) !important;' : 'transparent; color: var(--dc-ink-soft, #A2A2AA);'),
      labelStyle: open ? 'overflow: hidden; text-overflow: ellipsis;' : 'display: none;',
      countStyle: (open && count) ? 'margin-left: auto; padding: 1px 6px; border-radius: 20px; background: ' + (on ? 'rgba(217,180,120,.16)' : 'var(--dc-n-1d1d21, #1D1D21)') + '; font-size: 10.5px; font-weight: 600; color: ' + (on ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-dim, #8B8B93)') + ';' : 'display: none;',
      tipStyle: open
        ? 'display: none;'
        : 'position: absolute; left: calc(100% + 10px); top: 50%; translate: 0 -50%; z-index: 40; padding: 5px 9px; border: 1px solid var(--dc-line, #26262A); border-radius: 7px; background: var(--dc-bg-raised, #17171A); color: var(--dc-ink, #F2F2F4); font-size: 11.5px; font-weight: 500; box-shadow: 0 12px 30px rgba(0,0,0,.55); pointer-events: none; opacity: 0; transition: opacity .12s ease;',
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
    // A studio screen, not a navigation away — and SEPARATED from the rest of
    // the rail (Youssef, 28 Aug: "side bar should be separated to rest...
    // I'm saying OWNER"). The other items share one grammar; this one is the
    // operator's own door: pushed apart by a gap and dressed in its own gold
    // ring, so it never reads as just another studio screen.
    var item = navItem('owner', 'Owner', 'ph ph-coins', '');
    var on = UI.screen === 'owner';
    var open = UI.railOpen && (global.innerWidth || 1280) > 820;
    item.style = 'position: relative; display: flex; align-items: center; gap: 10px; margin-top: 18px; ' +
      'padding: ' + (open ? '10px 12px' : '11px 0') + '; ' + (open ? '' : 'justify-content: center; ') +
      'border-radius: 10px; font-weight: 600; cursor: pointer; white-space: nowrap; ' +
      'transition: background .14s ease, color .14s ease, border-color .14s ease; border: 1px solid ' +
      (on
        ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.12) !important; color: var(--dc-gold-lit, #F0D6A6) !important;'
        : 'rgba(217,180,120,.26); background: rgba(217,180,120,.05); color: var(--dc-n-e7cd9e, #E7CD9E);');
    var inner = item.click;
    item.click = function (e) {
      inner(e);
      global.StudioAdapter.onLoadOwner(UI.ownerDays || 180);
    };
    return item;
  }

  /**
   * Help sits in the rail like any other screen.
   *
   * No gate of any kind: someone who cannot work out how to use what they have
   * bought is the last person to put a paywall in front of. The screen itself
   * is host-rendered (see paintHelp in index.html), because adding a screen to
   * the design export regenerates every hashed class name in the app.
   */
  function helpNavItem() {
    var item = navItem('help', 'Help', 'ph ph-lifebuoy', '');
    var inner = item.click;
    item.click = function (e) {
      inner(e);
      global.StudioAdapter.onLoadHelp();
    };
    return item;
  }

  function deenaiNavItem() {
    // Everyone sees the tab — the demo is the shop window — so it is not
    // gated here. What IS gated is the data: the host fetch behind
    // onLoadDeenai returns demo cards for a free account, and the server
    // refuses /api/deenai/ask outright. Presentation never guards anything.
    var item = navItem('deenai', 'DeenAI', 'ph ph-sparkle', 'STUDIO');
    // First of the rail's bottom cluster. The class attribute is already bound
    // to mobileClass, so marking it here costs no template change; the phone
    // hides every dc-nav-secondary item anyway, and the CSS that acts on this
    // is inside a desktop-only media query.
    item.mobileClass = item.mobileClass + ' dc-nav-tail';
    // The count slot is a pill already; this one is a word, so it loses the
    // number styling and takes the gold the tier uses everywhere else.
    var railOpen = UI.railOpen && (global.innerWidth || 1280) > 820;
    item.countStyle = railOpen
      ? 'margin-left: auto; padding: 1px 6px; border-radius: 20px; border: 1px solid rgba(217,180,120,.4);'
        + ' background: rgba(217,180,120,.1); font-size: 8.5px; font-weight: 700; letter-spacing: .1em; color: var(--dc-gold-lit, #F0D6A6);'
      : 'display: none;';
    var inner = item.click;
    item.click = function (e) {
      inner(e);
      global.StudioAdapter.onLoadDeenai();
    };
    return item;
  }

  /**
   * A billing date a person can read.
   *
   * Day-month-year with the month spelled: "3/9" is the 3rd of September to
   * this customer and the 9th of March to a US card statement, and this string
   * sits next to the sentence telling them when their access stops.
   */
  function billingDate(ms) {
    var n = Number(ms || 0);
    if (!n) return '';
    try {
      return new Date(n).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) { return new Date(n).toDateString(); }
  }

  /** A {name: count} map as sorted table rows, largest first, capped for the screen. */
  function topPairs(map) {
    return Object.keys(map || {}).map(function (k) { return { name: k, count: String(map[k]) }; })
      .sort(function (a, b) { return Number(b.count) - Number(a.count); })
      .slice(0, 12);
  }

  /* ── Owner-screen helpers ─────────────────────────────────────────── */

  // What a Traffic tile can be set to show. Twelve numbers worth watching, six
  // slots: the screen stays quiet and every slot is the owner's choice.
  function periodIndex(id) {
    for (var i = 0; i < BILLING_PERIODS.length; i++) if (BILLING_PERIODS[i].id === id) return i;
    return 1;
  }

  // The billing periods the pricing grid toggles between.
  var BILLING_PERIODS = [
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'yearly', label: 'Yearly' },
  ];

  /*
   * Three words, and they had drifted. Youssef, 2 Sept 2026: "unique should be
   * ONLY NEW PEOPLE WHO HAVE NEVER CAME ON THE WEBSITE and visits is anything
   * and revisits."
   *
   *   Visits             every page opened, however many times.
   *   Visitors           devices seen, counted once per day.
   *   First-time         this browser had never opened the site before.
   *   Returning          it had.
   *
   * "Unique visitors" was the worst label of the four: it summed a per-DAY
   * count over the window, so one person visiting on three days counted three
   * times -- not unique in the window at all -- and it read as "new people",
   * which is a different number the app already has. The word is gone.
   */
  var ANA_METRICS = [
    { key: 'views', label: 'Visits' },
    { key: 'newVisitors', label: 'First-time' },
    { key: 'returningVisitors', label: 'Returning' },
    { key: 'uniques', label: 'Visitors' },
    { key: 'returning', label: 'Returning share' },
    { key: 'viewsPerVisitor', label: 'Visits per visitor' },
    { key: 'live', label: 'Live now' },
    { key: 'signups', label: 'New signups' },
    { key: 'checkouts', label: 'Started checkout' },
    { key: 'paid', label: 'New paying' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'posts', label: 'Clips posted' },
    { key: 'visitToSignup', label: 'Visit \u2192 signup' },
    { key: 'signupToCheckout', label: 'Signup \u2192 checkout' },
    { key: 'visitToPaid', label: 'Visit \u2192 paid' },
    { key: 'bots', label: 'Crawler hits' },
  ];
  var ANA_DEFAULT_TILES = ['views', 'newVisitors', 'returningVisitors', 'uniques', 'live', 'visitToSignup'];

  /** The six chosen metrics, healed against anything stale or unknown. */
  function anaTilePicks() {
    var picked = Array.isArray(UI.anaTiles) ? UI.anaTiles : [];
    return ANA_DEFAULT_TILES.map(function (fallback, index) {
      var key = picked[index];
      return ANA_METRICS.some(function (m) { return m.key === key; }) ? key : fallback;
    });
  }

  /** One metric, resolved against a webmetrics payload. */
  /**
   * A note that never overstates. New/returning only exists from the deploy
   * that added the seen-flag, so before that both counters are zero -- and a
   * bare "0 first visits" would read as nobody arriving rather than as us not
   * having been counting.
   */
  function anaFirstSeenNote(ana, phrase) {
    var t = (ana && ana.totals) || {};
    if ((t.newVisitors || 0) + (t.returningVisitors || 0) > 0) return phrase;
    return 'not counted before this release';
  }

  function anaMetric(key, ana) {
    var t = (ana && ana.totals) || {};
    var r = (ana && ana.rates) || {};
    var label = (ANA_METRICS.filter(function (m) { return m.key === key; })[0] || {}).label || key;
    var pct = function (v) { return v === null || v === undefined ? '\u2014' : v + '%'; };
    var money = function () {
      if (!t.revenueMinor) return '0';
      var amount = (t.revenueMinor / 100).toFixed(2);
      return t.revenueCurrency && t.revenueCurrency !== 'mixed'
        ? t.revenueCurrency.toUpperCase() + ' ' + amount
        : amount + (t.revenueCurrency === 'mixed' ? ' (mixed currencies)' : '');
    };
    var table = {
      uniques: [String(t.uniques || 0), 'devices seen, counted once a day', ''],
      // "People who never opened it before" -- the thing that could not be
      // answered until the seen-flag existed. Days captured before it read as
      // zero on both counters, so the note says when counting began rather
      // than letting an empty history look like nobody is new.
      newVisitors: [String(t.newVisitors || 0), anaFirstSeenNote(ana, 'had never opened the site'), 'pos'],
      returningVisitors: [String(t.returningVisitors || 0), anaFirstSeenNote(ana, 'had been before'), ''],
      returning: [pct(r.returning), 'of the visitors we could classify', 'pos'],
      viewsPerVisitor: [t.uniques ? (Math.round((t.views / t.uniques) * 10) / 10).toFixed(1) : '\u2014',
        'pages opened per visitor', ''],
      views: [String(t.views || 0), (t.views7 || 0) + ' in the last 7 days', ''],
      live: [String((ana && ana.liveNow) || 0), 'in the last 5 minutes', 'live'],
      signups: [String(t.signups || 0), 'accounts created in the window', ''],
      checkouts: [String(t.checkoutsStarted || 0), 'reached Stripe checkout', ''],
      paid: [String(t.paidConversions || 0), 'subscriptions started', 'pos'],
      revenue: [money(), (t.topups || 0) + ' top-up' + (t.topups === 1 ? '' : 's') + ' in the window', ''],
      posts: [String(t.postsPublished || 0), 'published to connected channels', ''],
      visitToSignup: [pct(r.visitToSignup), plural(t.signups || 0, 'signup'), 'pos'],
      signupToCheckout: [
        // Same reason as the funnel step: this can exceed 100%, and a bare
        // "6000%" beside "of signups reached checkout" reads as a broken tile.
        (r.signupToCheckout !== null && r.signupToCheckout !== undefined && r.signupToCheckout > 100)
          ? '>100%' : pct(r.signupToCheckout),
        (r.signupToCheckout > 100)
          ? 'checkouts include people who signed up earlier'
          : 'of signups reached checkout',
        'pos'],
      visitToPaid: [pct(r.visitToPaid), plural(t.paidConversions || 0, 'paying customer'), 'pos'],
      bots: [String((ana && ana.botHits) || 0), 'filtered out of every number here', 'unknown'],
    };
    var row = table[key] || ['\u2014', '', ''];
    return { key: key, label: label, value: row[0], note: row[1], tone: row[2] };
  }


  /** Minor units in, human money out; junk currency codes fall back plainly. */
  function owMoney(minor, currency) {
    var amount = Number(minor || 0) / 100;
    var code = String(currency || (global.DC_OWNER && global.DC_OWNER.finance && global.DC_OWNER.finance.currency) || 'aud').toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amount);
    } catch (err) { return code + ' ' + amount.toFixed(2); }
  }

  function owDate(ms) {
    if (!ms) return '\u2014';
    var d = new Date(Number(ms));
    if (!isFinite(d.getTime())) return '\u2014';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function owRelDays(days) {
    if (days === null || days === undefined) return '';
    if (days < 0) return Math.abs(days) + 'd overdue';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return 'in ' + days + 'd';
  }

  function owPill(tone) {
    var colours = {
      good: 'rgba(127,209,166,.34);background:rgba(127,209,166,.12);color:var(--dc-n-7fd1a6, #7FD1A6);',
      warn: 'rgba(230,183,112,.4);background:rgba(230,183,112,.12);color:var(--dc-n-e6b770, #E6B770);',
      bad: 'rgba(224,135,112,.4);background:rgba(224,135,112,.12);color:#E08770;',
      gold: 'rgba(217,180,120,.42);background:rgba(217,180,120,.12);color:var(--dc-gold-lit, #F0D6A6);',
    };
    return 'display:inline-block;padding:2px 8px;border-radius:20px;font-size:10.5px;font-weight:600;border:1px solid ' +
      (colours[tone] || 'var(--dc-line, #26262A);background:var(--dc-bg-raised, #17171A);color:var(--dc-ink-soft, #A2A2AA);');
  }

  /** A KPI tile: value colour carries the judgement, note carries the caveat. */
  function owTile(label, value, note, tone) {
    var colour = tone === 'pos' ? 'var(--dc-n-7fd1a6, #7FD1A6)' : tone === 'neg' ? '#E08770' : tone === 'unknown' ? 'var(--dc-n-e6b770, #E6B770)' : tone === 'live' ? 'var(--dc-n-7fd1a6, #7FD1A6)' : 'var(--dc-ink, #F2F2F4)';
    return {
      label: label, value: value, note: note || '', tone: tone || '',
      // Tabular figures, or a row of tiles jitters as the numbers refresh.
      valueStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 30px; font-weight: 600; letter-spacing: -.04em;'
        + ' line-height: 1.02; font-variant-numeric: tabular-nums; color: ' + colour + ';',
    };
  }

  /**
   * The open KPI row: no boxes — cells divided by hairlines. The divider is
   * per-cell (border-left on every cell but the first), which is why the
   * style has to be assigned here, where the index is known.
   */
  function owKpis(tiles) {
    return tiles.map(function (tile, index) {
      // Cards, not hairline-divided cells. Six numbers in a row of identical
      // text blocks read as a list of figures with nothing leading; a card
      // gives each one a boundary, and the first carries a gold edge so the
      // eye has somewhere to start. The row's own gap is CSS (studio-owner),
      // because the row element belongs to the design export.
      tile.cellStyle = 'flex: 1 1 170px; min-width: 158px; display: flex; flex-direction: column; gap: 7px;'
        + ' padding: 15px 17px; border-radius: 14px; border: 1px solid rgba(242,242,244,.055);'
        + ' background: linear-gradient(180deg, rgba(242,242,244,.038), rgba(242,242,244,.012));'
        + (index === 0 ? ' box-shadow: inset 2px 0 0 rgba(217,180,120,.55);' : '');
      return tile;
    });
  }

  /** {name: number} -> proportional bar rows, largest first. */
  function owBars(map, valueLabel) {
    var entries = Object.keys(map || {}).map(function (k) { return [k, Number(map[k]) || 0]; })
      .filter(function (e) { return e[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var peak = entries.length ? entries[0][1] : 1;
    return entries.map(function (e) {
      return { name: e[0], val: valueLabel(e[1]),
        barStyle: 'display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,var(--dc-gold, #D9B478),var(--dc-gold-lit, #F0D6A6));width:' + Math.max(4, Math.round(e[1] / peak * 100)) + '%;' };
    });
  }

  /** The picker pills in the cost editor (cadence, category, active). */
  function pickerStyle(on) {
    return 'padding: 6px 11px; border-radius: 18px; font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; text-transform: capitalize; border: 1px solid ' +
      (on ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.12); color: var(--dc-gold-lit, #F0D6A6);' : 'var(--dc-line, #26262A); background: var(--dc-bg, #121214); color: var(--dc-ink-soft, #A2A2AA);');
  }

  function owBlankCost() {
    return { id: '', name: '', vendor: '', amount: '', currency: 'aud', cadence: 'monthly', category: 'other', due: '', notes: '', active: true, error: '' };
  }

  function owEditorPatch(patch) {
    var next = {};
    var current = UI.owEditor || owBlankCost();
    Object.keys(current).forEach(function (k) { next[k] = current[k]; });
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    setUI({ owEditor: next });
  }

  /** An input setter that keeps typing out of the render loop until blur. */
  function owEditorSet(field) {
    return function (e) {
      var patch = {}; patch[field] = e.target.value;
      owEditorPatch(patch);
    };
  }

  var TITLES = {
    home: 'Home', queue: 'Review queue', library: 'Lecture library', schedule: 'Schedule',
    templates: 'Templates', music: 'Nasheed library', language: 'Arabic & terms',
    performance: 'Performance', editor: 'Clip editor \u00b7 BETA', tokens: 'Tokens & billing',
    owner: 'Owner', deenai: 'DeenAI', help: 'Help',
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
      case 'schedule': return 'Up to ' + (ctx.postSlots || 0) + ' posts a day · every clip is checked before it goes out';
      case 'music': return plural(ctx.tracks.length, 'nasheed') + ' · shuffled automatically';
      case 'deenai': return 'Growth advice from your own numbers — nothing leaves this server';
      case 'help': return 'How every part of DeenClipped works, with screenshots of the real app';
      case 'tokens': return ctx.planLabel;
      default: return '';
    }
  }

  // ── the binding table ─────────────────────────────────────────────────────

  // The last state bindings painted with, for adapter entry points that run
  // outside a paint (openJob needs the template list to pick a default).
  var LAST_DATA = null;

  function accountName(u) {
    u = u || {};
    var name = String(u.name || '').trim();
    if (name) return name;
    // No name on the record: the local part of the email is still a person's
    // handle, and it fits. A bare "Account" is the last resort.
    var email = String(u.email || '').trim();
    return email ? email.split('@')[0] : 'Account';
  }

  function accountInitials(u) {
    var parts = accountName(u).split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0].charAt(0);
    var second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + second).toUpperCase();
  }

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

    // Owner-screen source data, shaped once per render.
    var ownerData = DATA.ownerData || {};
    var owFinance = ownerData.finance || null;
    var owAnalytics = ownerData.analytics || null;
    var owBurnKnown = Boolean(owFinance && owFinance.moneyOut.unpricedCount === 0);
    var owNotes = [];
    if (owFinance) {
      if (owFinance.stripe && owFinance.stripe.mode === 'test') owNotes.push('Stripe is in test mode, so every revenue figure here is sandbox data, not real money.');
      if (owFinance.stripe && !owFinance.stripe.configured) owNotes.push('No Stripe key is configured on this deployment, so revenue cannot be read.');
      else if (owFinance.stripe && !owFinance.stripe.revenueAvailable) owNotes.push('Stripe revenue could not be read: ' + owFinance.stripe.revenueReason);
      (owFinance.stripe && owFinance.stripe.problems || []).forEach(function (problem) { owNotes.push(problem); });
      if (owFinance.profit && owFinance.profit.completeness) owNotes.push(owFinance.profit.completeness);
    }
    var current = (DATA.billing && DATA.billing.current) || {};
    // One word for the state of the subscription, and the colour that goes
    // with it. A failed payment is the case worth shouting about: the plan
    // keeps working for a few days and then stops, and the only warning used
    // to be a sentence of grey body text.
    var billingStatus = String(current.status || '').toLowerCase();
    var planStateWord = 'Active';
    var planStateTone = 'good';
    if (current.unlimited) { planStateWord = 'Unlimited'; }
    else if (billingStatus === 'past_due' || billingStatus === 'unpaid') { planStateWord = 'Payment failed'; planStateTone = 'bad'; }
    // Stripe keeps a cancelled-at-period-end subscription 'active' until the
    // day arrives, so without this branch a customer who cancelled saw an
    // Active pill and concluded the cancellation had not worked.
    else if (current.cancelAtPeriodEnd) { planStateWord = 'Ending soon'; planStateTone = 'warn'; }
    else if (billingStatus === 'canceled' || billingStatus === 'cancelled') { planStateWord = 'Cancelled'; planStateTone = 'warn'; }
    else if (current.trial && current.trial.active) { planStateWord = 'Trial'; planStateTone = 'warn'; }
    else if ((current.plan || 'free') === 'free') {
      var freeWin = current.freeTrial || {};
      planStateWord = freeWin.expired ? 'Trial ended' : 'Free';
      planStateTone = freeWin.expired ? 'bad' : 'warn';
    }

    var pending = awaitingReview(clips);
    var needsCount = pending.length;
    var scheduled = clips.filter(function (c) { return c.scheduledAt && !c.postedAt; })
      .sort(function (a, b) { return new Date(a.scheduledAt) - new Date(b.scheduledAt); });
    var recent4 = clips.slice(-4).reverse();

    // The server names the plan, because the raw id carries the billing period
    // and capitalising it produced "Studio_monthly" in the header -- the app
    // failing to say plainly which subscription somebody pays for. The old
    // spelling stays as the fallback for a browser holding a payload from
    // before planName existed.
    var planLabel = current.planName
      || (current.unlimited ? 'Unlimited'
        : (current.plan ? current.plan.charAt(0).toUpperCase() + current.plan.slice(1) : 'Free'));
    // How many windows a day THIS account gets. The server sends the tiered
    // list (Studio buys eight), so anything that wants to say "four" must count
    // it rather than spell it -- the Schedule was telling a Studio customer
    // "up to four posts a day" while scheduling into eight, and drawing four
    // bars for a day that holds eight.
    //
    // ONE number drives the subline, the sentence and the meter. They were
    // three separate literals, which is how they were able to disagree.
    // Falls back to four for a payload that carries no postTimes at all --
    // an older browser, or a misconfigured server -- rather than claiming the
    // day holds nothing and reading as "Today is full" beside empty days.
    var daySlots = (DATA.postTimes || []).length || 4;
    // Whether the extra windows come from the PLAN. Read from the tier rather
    // than inferred from "more than four", because the base window count is a
    // server setting and an operator could configure six of them tomorrow.
    var studioSlots = current.tier === 'studio' || Boolean(current.unlimited);
    // Array.from is not in the browsers this file still supports; the rest of
    // the adapter builds ranges the same way.
    function countTo(n) {
      var out = [];
      for (var i = 0; i < n; i += 1) out.push(i);
      return out;
    }
    var ctx = { projects: projects, clips: clips, tracks: tracks, needsCount: needsCount, planLabel: planLabel, postSlots: daySlots };

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
        id: c.id,
        caption: c.title || '',
        videoUrl: c.videoUrl || '',
        hasRender: Boolean(c.videoUrl),
        // This clip's own loudness, for the bars under the thumbnail. Null for
        // anything rendered before the worker measured it -- the card then
        // draws a flat baseline rather than inventing a shape.
        waveform: Array.isArray(c.waveform) && c.waveform.length ? c.waveform : null,
        duration: secsToClock((c.durationMs || 0) / 1000),
        style: (c.templateName || '') + (c.renderQuality === 'draft' ? ((c.templateName ? ' \u00b7 ' : '') + 'draft') : ''),
        lecTitle: projectTitle[c.projectId] || '',
        score: c.score || '—',
        // The worker has always explained itself -- "complete ending", "question
        // hook", "clear speaking pace" -- and stored the reasons on the clip,
        // and the server has always sent them. Nothing rendered them, so the
        // score arrived as a bare number out of 100 with no working shown,
        // which is exactly how a number stops being believed.
        scoreWhy: (function () {
          var reasons = Array.isArray(c.scoreReasons) ? c.scoreReasons.filter(Boolean) : [];
          if (!reasons.length) return '';
          return reasons.slice(0, 3).join(' · ');
        })(),
        scoreWhyStyle: (Array.isArray(c.scoreReasons) && c.scoreReasons.filter(Boolean).length)
          ? 'font-size: 10.5px; line-height: 1.45; color: var(--dc-ink-faint, #6E6E76); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;'
          : 'display: none;',
        flagged: gate && Boolean(c.reviewRequired),
        thumbStyle: 'position: relative; aspect-ratio: 9 / 16; overflow: hidden; background: ' + thumb(c.thumbUrl) + ';',
        cardStyle: 'display: flex; flex-direction: column; border: 1px solid ' +
          (st === 'approved' ? 'rgba(127,209,166,.34)' : st === 'rejected' ? 'var(--dc-n-2a2024, #2A2024)' : 'var(--dc-line-soft, #1E1E22)') +
          '; border-radius: 11px; overflow: hidden; background: var(--dc-bg, #121214); opacity: ' + (st === 'rejected' ? '.5' : '1') +
          '; animation: dcRise .26s cubic-bezier(.2,.8,.2,1) ' + Math.min(i * 0.03, 0.4) + 's both; box-shadow: 0 8px 22px rgba(0,0,0,.26);',
        // An approval the allocator could not place. The decision held -- the
        // clip is approved -- but nothing will go out until the reason is
        // dealt with, and the card is where that has to be readable.
        blockedNote: (st === 'approved' && c.scheduleError) ? c.scheduleError : '',
        blockedStyle: (st === 'approved' && c.scheduleError)
          ? 'display: flex; align-items: flex-start; gap: 6px; font-size: 10.5px; line-height: 1.45; color: var(--dc-n-e6b980, #E6B980);'
          : 'display: none;',
        stateChip: st === 'approved' ? (c.scheduleError ? 'Not scheduled' : 'Approved') : st === 'rejected' ? 'Rejected' : '',
        stateChipStyle: st
          ? 'position: absolute; top: 8px; right: 38px; padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid ' +
            (st === 'rejected' ? 'var(--dc-n-3a2a2a, #3A2A2A); background: rgba(10,10,12,.85); color: var(--dc-n-e3928c, #E3928C);'
              : (st === 'approved' && c.scheduleError) ? 'rgba(230,185,128,.4); background: rgba(10,10,12,.85); color: var(--dc-n-e6b980, #E6B980);'
                : 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: var(--dc-n-7fd1a6, #7FD1A6);')
          : 'display: none;',
        selStyle: 'position: absolute; top: 8px; right: 8px; z-index: 3; display: grid; place-items: center; '
          + 'width: 22px; height: 22px; border-radius: 7px; cursor: pointer; transition: background .12s ease; border: 1px solid '
          + (UI.selClips[c.id]
            ? 'var(--dc-gold, #D9B478); background: rgba(217,180,120,.92); color: var(--dc-bg-deepest, #0E0E11);'
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
          (st === 'approved' ? 'rgba(127,209,166,.4); background: rgba(127,209,166,.1); color: var(--dc-n-7fd1a6, #7FD1A6);' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: var(--dc-gold-lit, #F0D6A6);'),
        approve: function (e) { stop(e); approve(c.id); },
        primary: st === 'rejected'
          ? function (e) { stop(e); global.StudioAdapter.onRestore(c.id); }
          : function (e) { stop(e); approve(c.id); },
        reject: function (e) { stop(e); reject(c.id); },
        // Approve / edit / reject is the card's action row; `third` is reject.
        third: function (e) { stop(e); reject(c.id); },
        thirdIcon: 'ph ph-x',
        edit: function (e) { stop(e); setUI({ screen: 'editor', edClipId: c.id, edStyleDraft: null, edBlockDraft: null, edTrim: null, edCutOuts: null, edCutMark: null, edBlock: 0, edTime: 0, edPlayhead: 0 }); },
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
    var queueRaw = clips.filter(function (c) {
      if (q && ((c.title || '') + ' ' + (projectTitle[c.projectId] || '')).toLowerCase().indexOf(q) === -1) return false;
      var st = decision(c);
      if (UI.filter === 'review') return st === null;
      if (UI.filter === 'flagged') return gate && c.reviewRequired && st === null;
      if (UI.filter === 'approved') return st === 'approved';
      return true;
    }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var queueClips = queueRaw.map(clipCard);

    var deckAt = Math.min(UI.deckIdx, Math.max(0, queueClips.length - 1));
    var deckClip = queueClips[deckAt] || null;
    // The raw record behind the card: the host mounts the RENDERED clip's
    // <video> into the deck from this (invariant: the queue plays the same
    // bytes that post, never a drawn imitation).
    var deckRaw = queueRaw[deckAt] || null;
    // The keyboard seam. Key handling lives in the host (it owns the window),
    // but a decision must go through the same path as the buttons -- pending,
    // repaint, then the API -- so the deck advances instantly either way.
    deckNowId = deckRaw ? deckRaw.id : null;
    deckNowCount = queueClips.length;

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
        id: p.id,
        title: projectTitle[p.id],
        dur: humanDuration(p.durationSec || p.sourceDurationSec),
        when: since(p.submittedAt),
        clips: plural(mine.length, 'clip'),
        srcIcon: p.url ? 'ph-fill ph-youtube-logo' : 'ph-fill ph-upload-simple',
        srcLabel: p.url ? 'YouTube import' : 'Uploaded MP4',
        // The scrim is not decoration: the clip count and state sit along the
        // bottom edge with no background of their own, and were unreadable over
        // a bright thumbnail. It only mattered once posters started appearing.
        thumbStyle: 'position: relative; aspect-ratio: 16 / 9; background-color: var(--dc-bg-raised, #17171A);' +
          (p.sourceThumbUrl
            ? ' background-image: linear-gradient(to bottom, rgba(8,8,10,0) 40%, rgba(8,8,10,.82) 100%), url("' + cssUrl(p.sourceThumbUrl) + '");'
              + ' background-size: cover, cover; background-position: center, center 30%;'
            : ''),
        stateChip: state === 'processing' ? 'Processing' : state === 'ready' ? 'Ready' : 'Archived',
        chipStyle: 'display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; border: 1px solid ' +
          (state === 'processing' ? 'rgba(217,180,120,.4); background: rgba(10,10,12,.82); color: var(--dc-gold-lit, #F0D6A6);'
            : state === 'ready' ? 'rgba(127,209,166,.32); background: rgba(10,10,12,.82); color: var(--dc-n-7fd1a6, #7FD1A6);'
            : 'var(--dc-n-33333a, #33333A); background: rgba(10,10,12,.82); color: var(--dc-ink-soft, #A2A2AA);'),
        chipIcon: state === 'processing' ? 'ph ph-circle-notch' : state === 'ready' ? 'ph-fill ph-check-circle' : 'ph ph-archive',
        chipIconStyle: 'font-size: 11px;' + (state === 'processing' ? ' animation: dcSpin 1.1s linear infinite;' : ''),
        isProcessing: state === 'processing',
        barStyle: 'position: absolute; left: 0; bottom: 0; height: 3px; width: ' + Math.round(p.progress || 0) + '%; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6)); transition: width .5s ease;',
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
            ? 'var(--dc-gold, #D9B478); background: rgba(217,180,120,.92); color: var(--dc-bg-deepest, #0E0E11);'
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
            var slotAt = Number(c.scheduledAt) || 0;
            // The Day view is a list, not a grid, but a card there is the same
            // thing as a cell in the week: one clip on one slot. It carries the
            // same two attributes so ONE drag implementation serves both, and
            // neither has to guess a card's identity from its position.
            var slotAt = Number(c.scheduledAt) || 0;
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
            // Posted somewhere, refused somewhere else: the destination that
            // refused is the one thing still worth pressing.
            var retryTarget = c.postedAt
              ? (c.targets || []).filter(function (t) { return t.status !== 'posted'; })[0] || null
              : null;
            return {
              // The slot this card sits on, and the clip on it — the two things
              // a drag needs, identical to what a week cell carries.
              at: slotAt,
              clipId: slotAt && !c.postedAt ? String(c.id) : '',
              failReason: failedTarget ? String(failedTarget.error) : '',
              time: timeOf(c.scheduledAt),
              dest: PLATFORM_NAMES[platform] || 'No account',
              icon: PLATFORM_ICONS[platform] || 'ph ph-share-network',
              // Every place this clip is going, each with its own state. A row
              // with no destinations says so rather than showing an empty gap:
              // "nowhere yet" is the most useful thing a schedule can tell you
              // about a clip that is about to go nowhere.
              dests: destinations(c).length ? destinations(c) : [{
                name: 'No account connected', who: '', state: '',
                icon: 'ph ph-warning-circle',
                style: 'display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--dc-n-e6b770, #E6B770);',
              }],
              caption: c.title || '',
              score: c.score || '',
              duration: secsToClock((c.durationMs || 0) / 1000),
              thumbStyle: 'width: 42px; height: 58px; flex: none; border-radius: 7px; border: 1px solid var(--dc-line, #26262A);'
                + ' box-shadow: inset 0 0 0 1px rgba(0,0,0,.4); background: ' + thumb(c.thumbUrl) + ';',
              checks: checks.map(function (k) {
                return {
                  label: k.label,
                  icon: k.ok ? 'ph-fill ph-check-circle' : 'ph-fill ph-warning-circle',
                  style: 'font-size: 12px; color: ' + (k.ok ? 'var(--dc-n-7fd1a6, #7FD1A6)' : 'var(--dc-n-e6b770, #E6B770)'),
                };
              }),
              hasFailing: !ready,
              statusLabel: c.postedAt ? 'Posted' : ready ? '4/4 checks' : failing.length + ' failing',
              statusStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; border: 1px solid ' +
                (ready ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: var(--dc-n-7fd1a6, #7FD1A6);' : 'var(--dc-n-3a2a2a, #3A2A2A); background: rgba(10,10,12,.85); color: var(--dc-n-e6b770, #E6B770);'),
              cardStyle: 'display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid ' +
                (ready ? 'var(--dc-line-soft, #1E1E22)' : 'var(--dc-n-2a2024, #2A2024)') + '; border-radius: 10px; background: var(--dc-bg, #121214);',
              // Nothing posts unchecked: the button says why instead of failing.
              // A clip that posted to one channel and was refused by another is
              // posted -- and the only thing left to press is the retry for the
              // one that refused. "Post now" there re-ran the whole set and
              // left the row looking untouched.
              postLabel: (c.postedAt && retryTarget) ? ('Retry ' + (PLATFORM_NAMES[retryTarget.provider] || retryTarget.provider))
                : c.postedAt ? 'Posted'
                : !ready ? 'Fix first'
                : !publishingOn ? 'Publishing off'
                : !activeCount ? 'No channel on'
                : 'Post now',
              postStyle: 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: ' + ((retryTarget || (ready && !c.postedAt)) ? 'pointer' : 'not-allowed') + '; border: 1px solid ' +
                (retryTarget
                  ? 'rgba(230,183,112,.42); background: rgba(230,183,112,.1); color: var(--dc-n-e6b770, #E6B770);'
                  : ready && !c.postedAt && publishingOn && activeCount
                    ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: var(--dc-gold-lit, #F0D6A6);'
                    : 'var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-faint, #6E6E76);'),
              postNow: function (e) {
                stop(e);
                if (retryTarget) { global.StudioAdapter.onPostNow(c.id); return; }
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
              isToday: isToday, inMonth: inMonth, past: past, count: items.length,
              // overflow:hidden because a busy day's chips and its "+N more"
              // were spilling past the cell's own border. min-width:0 so the
              // grid column may actually shrink -- without it a long chip sets
              // the column's floor and the whole row grows instead of clipping.
              style: 'position: relative; display: flex; flex-direction: column; gap: 3px; height: 100%; min-height: 62px; padding: 5px 7px 6px;'
                + ' overflow: hidden; min-width: 0;'
                + ' border: 1px solid ' + (isToday ? 'rgba(240,214,166,.45)' : 'var(--dc-n-1c1c21, #1C1C21)') + '; border-radius: 10px;'
                + ' background: ' + (isToday ? 'rgba(217,180,120,.05)' : inMonth ? 'var(--dc-n-141418, #141418)' : 'var(--dc-n-0f0f12, #0F0F12)') + ';'
                + ' text-align: left; font-family: inherit; cursor: pointer;'
                + ' opacity: ' + (!inMonth ? '.4' : past ? '.6' : '1') + '; transition: border-color .14s ease, background .14s ease;',
              dateStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 11.5px; font-weight: ' + (isToday ? '700' : '500') + ';'
                + ' color: ' + (isToday ? 'var(--dc-gold-lit, #F0D6A6)' : past ? 'var(--dc-n-5e5e66, #5E5E66)' : 'var(--dc-n-9a9aa2, #9A9AA2)') + '; font-variant-numeric: tabular-nums;',
              // One pip per post the day can hold, filled for each one taken:
              // the day's load without a number to read. EIGHT of them on
              // Studio, in two rows of four -- Youssef's own idea, and the
              // right one: the capacity the plan buys is the thing being
              // shown, so showing four of them on an eight-post plan was the
              // same lie the header was telling.
              //
              // They are positioned from their OWN inline styles rather than
              // laid out by their container. The container is a generated
              // class (inline-flex, no wrap), so a second row would need CSS
              // hung on a hashed name that a design re-import regenerates
              // silently. The cell is already position:relative, so absolute
              // pips need nothing from the export and cannot be broken by it.
              pips: (items.length || (!past && inMonth)) ? countTo(daySlots).map(function (n) {
                var row = Math.floor(n / 4);
                var col = n % 4;
                var perRow = Math.min(4, daySlots);
                var filled = n < items.length;
                // The EXTRA windows -- the ones past the four every plan gets
                // -- are a different colour from the base four, so the second
                // row reads as the capacity this subscription added rather
                // than as more of the same. Youssef, 1 Sept 2026: "the 4 new
                // dots should be different color to show the subscrition i
                // have."
                //
                // The base four keep exactly what Pro and Basic draw: solid
                // gold when filled, quiet grey when not. The extras are gold
                // in BOTH states -- bright when filled, faint when empty --
                // which is the only pair of dots on the screen that never goes
                // grey, and that is the point.
                // Four is the base every plan gets and also the row width
                // above, so the extras are exactly the second row.
                var extra = studioSlots && n >= 4;
                var colour = extra
                  ? (filled ? 'var(--dc-gold-lit, #F0D6A6)' : 'rgba(217,180,120,.34)')
                  : (filled ? 'var(--dc-gold, #D9B478)' : 'var(--dc-n-212127, #212127)');
                return { filled: filled, extra: extra, style: 'position: absolute; display: block; width: 5px; height: 5px; border-radius: 50%;'
                  + ' top: ' + (7 + row * 8) + 'px; right: ' + (7 + (perRow - 1 - col) * 8) + 'px;'
                  + ' background: ' + colour + ';' };
              }) : [],
              // Two chips once there is a "+N more" to show, three when there
              // is not. Measured at 1440x950: the cell is 101px and three
              // chips plus the more-line came to 112, so the line was pushed
              // through the bottom border -- reported as "the plus-two-more
              // wording goes out of the box". Clipping it would have hidden
              // the count instead of fitting it, which is not the same thing.
              chips: items.slice(0, items.length > 3 ? 2 : 3).map(function (c) {
                return {
                  label: timeOf(c.scheduledAt) + '  ' + String(c.title || 'Clip'),
                  rowStyle: 'display: flex; align-items: center; gap: 5px; min-width: 0;',
                  thumbStyle: 'width: 12px; height: 21px; flex: none; border-radius: 3px; border: 1px solid var(--dc-line, #26262A);'
                    + ' background: ' + thumb(c.thumbUrl) + ';',
                  style: 'display: block; font-size: 10.5px; line-height: 1.35; color: var(--dc-ink-body, #BCBCC3);'
                    + ' white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
                };
              }),
              moreLabel: items.length > 3 ? '+' + (items.length - 2) + ' more' : '',
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
            // What the drag needs: which instant this square is, and which clip
            // is sitting on it. Both are attributes on the button, so the host
            // never has to work out a cell's identity from its position in the
            // grid -- the mistake that put one clip's waveform on another
            // clip's card.
            at: at,
            clipId: held ? String(held.id) : '',
            title: held ? String(held.title || 'Clip') : '',
            style: 'position: relative; display: flex; flex-direction: column; justify-content: flex-end; flex: 1 1 0; min-width: 0;'
              + ' height: 100%; min-height: 56px; padding: 6px 7px; border-radius: 9px; overflow: hidden; text-align: left; font-family: inherit; cursor: '
              + (held || !past ? 'pointer' : 'default') + ';'
              + ' border: 1px ' + (held ? 'solid var(--dc-n-26262e, #26262E)' : past ? 'solid var(--dc-n-161619, #161619)' : 'dashed var(--dc-n-232329, #232329)') + ';'
              + (held && held.thumbUrl
                ? ' background-image: linear-gradient(to bottom, rgba(8,8,10,.15) 30%, rgba(8,8,10,.88) 100%), url("' + cssUrl(held.thumbUrl) + '");'
                  + ' background-size: cover, cover; background-position: center, center 28%; background-color: var(--dc-bg-raised, #17171A);'
                : ' background: ' + (held ? 'var(--dc-n-1b1b21, #1B1B21)' : 'transparent') + ';')
              + ' opacity: ' + (past && !held ? '.45' : '1') + '; transition: border-color .14s ease, background .14s ease;',
            titleStyle: 'font-size: 11px; line-height: 1.25; color: var(--dc-ink, #F2F2F4); text-shadow: 0 1px 3px rgba(0,0,0,.8);'
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
              + ' border: 1px solid ' + (held ? 'var(--dc-n-26262e, #26262E)' : 'transparent') + '; background: ' + (held ? 'var(--dc-n-1b1b21, #1B1B21)' : 'transparent') + ';'
              + ' cursor: ' + (held ? 'pointer' : 'default') + ';',
            titleStyle: 'font-size: 11px; line-height: 1.3; color: var(--dc-ink-bright, #E9E9ED); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
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
      captionPrimary: 'var(--dc-n-ffffff, #FFFFFF)', captionFontSize: 96, captionMarginV: 180,
      captionFont: 'DejaVu Sans', captionUppercase: false,
      watermarkPosition: 'top-center', watermarkColor: 'var(--dc-gold, #D9B478)', watermarkFontSize: 28,
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
    /**
     * Drag one end of the trim.
     *
     * Measured against the lane the handles live in, which is the same box the
     * playhead and the caption blocks are positioned inside -- so the handle
     * lands exactly where the ruler says it does. Nothing is written to the
     * server here: the trim is part of the unsaved edit, and Save is what
     * renders it, in keeping with render-on-save.
     */
    // The ranges of the clip that survive: the trim envelope with every removed
    // section taken out of it. This is the list the worker cuts on -- a trim
    // is one range, a section cut is a gap in it, and both are the same
    // primitive to the render (retime_for_cuts in clip_worker.py).
    function keepRanges(trim, cutOuts, duration) {
      var from = Math.max(0, Number(trim.from) || 0);
      var to = Math.min(duration, Number(trim.to) || duration);
      if (to <= from) return [];
      var keeps = [[from, to]];
      var cuts = (cutOuts || []).map(function (c) { return [Number(c[0]), Number(c[1])]; })
        .filter(function (c) { return isFinite(c[0]) && isFinite(c[1]) && c[1] > c[0]; })
        .sort(function (a, b) { return a[0] - b[0]; });
      for (var i = 0; i < cuts.length; i++) {
        var next = [];
        for (var k = 0; k < keeps.length; k++) {
          var a = keeps[k][0], b = keeps[k][1], ca = cuts[i][0], cb = cuts[i][1];
          if (cb <= a || ca >= b) { next.push([a, b]); continue; }
          if (ca > a) next.push([a, ca]);
          if (cb < b) next.push([cb, b]);
        }
        keeps = next;
      }
      // A sliver under a quarter second is a mis-click, and ffmpeg renders it
      // as a flash of one frame -- the same floor agent.updateClip applies.
      return keeps.filter(function (r) { return r[1] - r[0] >= 0.25; });
    }

    // Removed sections, merged where they touch, so two cuts drawn over each
    // other read as one hatched stretch rather than a stack.
    function mergeCutOuts(cutOuts) {
      var sorted = (cutOuts || []).map(function (c) { return [Math.min(c[0], c[1]), Math.max(c[0], c[1])]; })
        .sort(function (a, b) { return a[0] - b[0]; });
      var out = [];
      for (var i = 0; i < sorted.length; i++) {
        if (out.length && sorted[i][0] <= out[out.length - 1][1]) {
          out[out.length - 1][1] = Math.max(out[out.length - 1][1], sorted[i][1]);
        } else out.push([sorted[i][0], sorted[i][1]]);
      }
      return out;
    }

    function startTrimDrag(e, edge, duration, current) {
      stop(e);
      var handle = e.dcTarget || (this && this.nodeType === 1 ? this : null) || e.currentTarget;
      var lane = handle && handle.parentElement;
      if (!lane) return;
      var box = lane.getBoundingClientRect();
      if (!box.width) return;
      var next = { from: current.from, to: current.to };
      // A clip shorter than a second is not a clip. The two handles may not
      // cross, and may not meet.
      var MIN = 1;
      var move = function (ev) {
        var at = ((ev.clientX - box.left) / box.width) * duration;
        if (edge === 'from') next.from = Math.max(0, Math.min(next.to - MIN, at));
        else next.to = Math.min(duration, Math.max(next.from + MIN, at));
        UI.edTrim = { from: next.from, to: next.to };
        UI.edDirty = true;
        paintNow();
      };
      var up = function () {
        global.removeEventListener('mousemove', move);
        global.removeEventListener('mouseup', up);
        paintNow();
      };
      global.addEventListener('mousemove', move);
      global.addEventListener('mouseup', up);
      move(e);
    }

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
        var dragPaint = 0;
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
          // One repaint per FRAME, not one per mouse event.
          //
          // paintNow() re-renders the whole studio -- rail, header, panels and
          // preview -- and a mouse reports far faster than the screen draws
          // (125Hz is ordinary, 1000Hz exists), so this was running the entire
          // render up to sixteen times per displayed frame and throwing all but
          // the last away. Every one of those also tore out and rebuilt the
          // host-injected panels beside it: measured FOUR watermark-row rebuilds
          // in a two-move drag, so a real drag of a few hundred moves rebuilds
          // it a few hundred times. That is what made dragging a caption feel
          // like the page was jumping.
          //
          // The state above is still written synchronously, so the frame that
          // does paint always draws the newest position -- coalescing drops
          // redundant renders, never the latest one.
          // Outside a browser there are no frames to coalesce into -- the
          // tests drive move() directly and read the preview straight after --
          // so fall back to painting synchronously there.
          if (typeof global.requestAnimationFrame !== 'function') { paintNow(); }
          else if (!dragPaint) {
            dragPaint = global.requestAnimationFrame(function () { dragPaint = 0; paintNow(); });
          }
        }
        function up() {
          if (dragPaint && typeof global.cancelAnimationFrame === 'function') { global.cancelAnimationFrame(dragPaint); }
          dragPaint = 0;
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
    // The trim being edited, or the clip's saved one, or the whole clip. Held
    // as a single kept range: split and delete-a-section are the same primitive
    // with more ranges, and the worker already takes a list.
    var edSavedCuts = (edClip && Array.isArray(edClip.cutsSec) && edClip.cutsSec.length) ? edClip.cutsSec : null;
    var edTrim = (function () {
      if (UI.edTrim) return UI.edTrim;
      if (!edSavedCuts) return { from: 0, to: edDuration };
      return { from: Math.max(0, Number(edSavedCuts[0][0]) || 0), to: Math.min(edDuration, Number(edSavedCuts[edSavedCuts.length - 1][1]) || edDuration) };
    })();
    // The sections removed from inside that envelope. A saved list of several
    // keep ranges is read back as its gaps, so a clip opened again shows the
    // cuts it already carries rather than only its outer trim.
    var edCutOuts = (function () {
      if (Array.isArray(UI.edCutOuts)) return UI.edCutOuts;
      if (!edSavedCuts || edSavedCuts.length < 2) return [];
      var gaps = [];
      for (var g = 1; g < edSavedCuts.length; g++) {
        var ga = Number(edSavedCuts[g - 1][1]), gb = Number(edSavedCuts[g][0]);
        if (gb - ga >= 0.25) gaps.push([ga, gb]);
      }
      return gaps;
    })();
    var edKeeps = keepRanges(edTrim, edCutOuts, edDuration);
    var edKeptSec = edKeeps.reduce(function (sum, r) { return sum + (r[1] - r[0]); }, 0);
    var edTrimmed = edTrim.from > 0.05 || edTrim.to < edDuration - 0.05 || edKeeps.length > 1;
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
          + 'background: ' + (live ? 'rgba(217,180,120,.22)' : 'var(--dc-bg, #121214)') + '; border: 1px solid '
          + (live ? 'rgba(240,214,166,.9)' : on ? 'rgba(217,180,120,.55)' : 'var(--dc-line-soft, #1E1E22)') + ';',
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

    // One picture, always, at Youssef's instruction (1 Sept 2026): "that's the
    // photo going to be for the template at all times."
    //
    // It used to be the newest lecture's own thumbnail, falling back to a grey
    // illustration when the account had imported nothing. Two shapes for one
    // frame meant the Templates screen looked different from account to
    // account, and a brand-new account -- the one most in need of seeing what
    // a template does -- got the emptiest version of it.
    //
    // The photo is 9:16, the same shape as the frame, so it fills under
    // `cover` and shows whole under `contain` without distorting either way.
    var previewSource = '/preview-sample.webp';

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
    // 0 Import · 1 Transcribe · 2 Score · 3 Render · 4 Upload. The first four
    // come from the worker's own phase; upload has no phase of its own, so the
    // global percentage past the render band is what names it.
    function liveStageIdx(j) {
      var name = phaseOf(j.project || {});
      if (!name) return Number(j.progress) >= STAGE_BANDS.render[1] ? 4 : 0;
      return ['import', 'transcribe', 'score', 'render'].indexOf(name);
    }
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
      // A social variant is deliberately NOT a row here. It is the copy TikTok
      // requires, rendered on the customer's behalf, and the publish target
      // below already carries it -- "Clip -> TikTok - Rendering a copy TikTok
      // will accept". Showing both puts two rows on screen for one piece of
      // work, and this one would read "Editing clip" at somebody who edited
      // nothing.
      if (j.socialVariant) return;
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
    // Working before waiting, newest first within each. Sorting by time alone
    // let a queued job submitted a minute ago take the floating bar's headline
    // off the lecture actually rendering.
    jobsLive.sort(function (a, b) {
      if (Boolean(a.queued) !== Boolean(b.queued)) return a.queued ? 1 : -1;
      return Number(b.at || 0) - Number(a.at || 0);
    });

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
    // "142 MB / 380 MB" while the total is known, "142 MB" while it is not --
    // a server that sends no Content-Length is common and must not print "of 0".
    function transferLabel(done, total) {
      var a = sizeLabel(done);
      if (!a) return '';
      var b = sizeLabel(total);
      return b ? a + ' / ' + b : a;
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
            + '%; background: ' + (done ? 'var(--dc-n-7fd1a6, #7FD1A6)' : 'linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6))') + ';',
          icon: done ? 'ph-fill ph-check-circle' : running ? 'ph ph-circle-notch' : 'ph ph-clock',
          iconStyle: 'font-size: 13px; color: ' + (done ? 'var(--dc-n-7fd1a6, #7FD1A6)' : running ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-n-4a4a52, #4A4A52)') + ';',
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
        // A queued job has not started; "0%" on it reads as stuck rather than
        // waiting, so it says nothing until the worker takes it.
        percent: pct === null || j.queued ? '' : pct + '%',
        eta: eta,
        transfer: transfer,
        // The dock binds text/textStyle; supplying only label left every row of
        // the floating bar unstyled and unreadable.
        text: j.title + ' · ' + detail + (pct === null ? '' : ' · ' + pct + '%'),
        textStyle: 'font-size: 11.5px; color: var(--dc-ink-body, #BCBCC3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
        meta: detail,
        barStyle: 'height: 3px; border-radius: 3px; width: ' + (pct === null ? 100 : pct) + '%; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6));',
        icon: j.kind === 'publish' ? 'ph ph-paper-plane-tilt' : j.kind === 'render' ? 'ph ph-film-strip' : 'ph ph-circle-notch',
        // The spin is NOT set here. On the Home card this icon is also the
        // 32px tile -- border, warm background and glyph in one element -- so
        // an inline animation turned the BOX as well as the mark, and an
        // inline style is the one thing a stylesheet cannot override. Youssef,
        // 2 Sept 2026: "that loading animation and the box behind are both
        // rotating it looks so bad." The glyph's ::before carries the rotation
        // instead (index.html), which leaves the tile still.
        iconStyle: 'font-size: 14px; color: var(--dc-gold-lit, #F0D6A6);',
        // Where the job stands in the pipeline, for the stage strip both live
        // surfaces draw. Only a full lecture job walks the pipeline; edits,
        // more-clips and publishes are single-stage and get no strip (null).
        // A queued lecture is -1: the strip shows with nothing lit, which is
        // the honest picture of a job that has not started. Past the render
        // band the worker is uploading -- phaseOf answers '' there, and the
        // global percentage is what says so.
        stageIdx: j.kind === 'project' ? (j.queued ? -1 : liveStageIdx(j)) : null,
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
      // Same reason as the live row above: the publish target reports this
      // one, with the destination named and its own guidance entry. Here it
      // would read "Edit failed" about an edit nobody made.
      if (j.socialVariant) return;
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

    /*
     * Whether the blocker banner is actually ON SCREEN, hoisted so the banner
     * and the Getting-started strip read ONE answer. The strip defers to this
     * rather than repeating a line the banner is already showing with its own
     * button (v3.95.0) -- two controls for one thing is the fault that release
     * exists to remove.
     */
    var blockerShowing = Boolean(blocker) && (moneyNotice && moneyNotice.blocking ? true : !UI.blockerDismissed && (function () {
      // Dismissal outlives the tab, keyed by the message: the nasheed nag came
      // back on every page load however many times it was dismissed. A
      // DIFFERENT blocker (new gap, new wording) still shows.
      try { return global.localStorage.getItem('deenBlockerDismissed') !== blocker; } catch (e) { return true; }
    }()));

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
        rowStyle: 'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-bottom: 1px solid var(--dc-bg-alt, #1A1A1E); cursor: pointer; background: rgba(227,146,140,.07);',
        iconStyle: 'font-size: 15px; flex: none; margin-top: 1px; color: var(--dc-n-e3928c, #E3928C)',
        tagStyle: 'flex: none; padding: 2px 7px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: rgba(227,146,140,.16); color: var(--dc-n-e3928c, #E3928C);',
      };
    });

    var logRows = (UI.activityAll ? log : log.slice(0, 6)).map(function (entry) {
      var urgent = entry.level === 'error' || entry.level === 'warn';
      var color = entry.level === 'error' ? 'var(--dc-n-e3928c, #E3928C)' : entry.level === 'warn' ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-n-7fd1a6, #7FD1A6)';
      var message = entry.message || entry.text || '';
      var at = entry.at || entry.createdAt;
      return {
        id: activityId('log', message, at),
        text: message,
        meta: since(at),
        full: message, code: '', at: at, screen: '', provider: '',
        tag: entry.level === 'error' ? 'Issue' : entry.level === 'warn' ? 'Check' : '',
        icon: entry.level === 'error' ? 'ph-fill ph-warning-circle' : entry.level === 'warn' ? 'ph-fill ph-warning' : 'ph-fill ph-check-circle',
        rowStyle: 'display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-bottom: 1px solid var(--dc-bg-alt, #1A1A1E); cursor: pointer; transition: background .14s ease; background: ' + (urgent ? 'rgba(217,180,120,.045)' : 'transparent'),
        iconStyle: 'font-size: 15px; flex: none; margin-top: 1px; color: ' + color,
        tagStyle: 'flex: none; padding: 2px 7px; border-radius: 20px; font-size: 9.5px; font-weight: 600; letter-spacing: .02em; background: var(--dc-n-1d1d21, #1D1D21); color: var(--dc-ink-dim, #8B8B93);',
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
            + ' border: 0; border-radius: 6px; background: transparent; color: var(--dc-ink-faint, #6E6E76); font-family: inherit;'
            + ' font-size: 12px; cursor: pointer; transition: background .14s ease, color .14s ease;',
        });
      });

    // NOT named `detail`: that name is already the open project in this scope,
    // and shadowing it silently turned "More clips" into a no-op.
    var activityRow = activityRows.filter(function (row) { return row.id === UI.activityDetail; })[0] || null;
    var activityWhy = activityRow ? explainFailure(activityRow) : { title: '', cause: '', fixes: [] };

    // ── DeenAI ──
    // Whether this account HAS DeenAI comes from the plan features already in
    // /api/state, so the lock is honest on first paint; /api/deenai (fetched
    // when the tab opens) only supplies the numbers. For a locked account they
    // arrive marked demo:true and are labelled as such on screen.
    var aiOn = Boolean(current.features && current.features.deenai);
    // Three states, not two: Basic sees a demo, Pro sees its own numbers with
    // the ask held back, Studio sees everything. Collapsing Pro into either
    // neighbour is what would make the middle tier feel like a mistake.
    var aiAskOn = Boolean(current.features && current.features.deenaiAsk);
    var aiData = DATA.deenai || null;
    var aiAllCards = (aiData && aiData.insights) || [];
    // The first card is the headline and gets the room; the rest are rows. The
    // server decides which is first -- the screen must not re-rank, or the two
    // halves of one answer would disagree about what matters most.
    var aiHead = aiAllCards[0] || null;
    var aiRows = aiAllCards.slice(1);
    var aiMetricRows = (aiData && aiData.metrics) || [];
    var AI_TONES = {
      gold: { border: 'rgba(217,180,120,.4)', icon: 'var(--dc-gold-lit, #F0D6A6)', value: 'var(--dc-gold-lit, #F0D6A6)' },
      good: { border: 'rgba(127,209,166,.3)', icon: 'var(--dc-n-7fd1a6, #7FD1A6)', value: 'var(--dc-n-7fd1a6, #7FD1A6)' },
      warn: { border: 'rgba(224,135,112,.35)', icon: '#E08770', value: 'var(--dc-n-e6b770, #E6B770)' },
      '': { border: 'var(--dc-line, #26262A)', icon: 'var(--dc-ink-body, #BCBCC3)', value: 'var(--dc-ink, #F2F2F4)' },
    };
    var aiTone = function (tone) { return AI_TONES[tone] || AI_TONES['']; };
    var aiDemoChip = function (on) {
      return on
        ? 'flex: none; margin-left: 8px; padding: 1px 7px; border-radius: 20px; border: 1px solid var(--dc-n-2c2c32, #2C2C32); background: var(--dc-bg-raised, #17171A); font-size: 8.5px; font-weight: 700; letter-spacing: .12em; color: var(--dc-ink-faint, #6E6E76);'
        : 'display: none;';
    };
    // Three openers worth typing, and they FILL the box rather than only
    // reading as suggestions -- a chip that does nothing is a dead control.
    var AI_PROMPTS = ['What should I clip next?', 'How do I grow on TikTok?', 'Which lecture is worth more clips?'];

    // ── the three tiers, at the chosen period ──
    var billingPeriod = BILLING_PERIODS.some(function (p) { return p.id === UI.billingPeriod; })
      ? UI.billingPeriod : 'monthly';
    var planGrid = (DATA.billing && DATA.billing.plans) || {};
    var featureLabels = (DATA.billing && DATA.billing.featureLabels) || {};
    var currentPlanId = String(current.plan || 'free');
    var TIER_LOOK = {
      // ph-seedling is NOT in @phosphor-icons/web 2.1.1's regular set -- it
      // drew an empty ring next to Pro's lightning and Studio's sparkle. Only
      // glyphs seen rendering in the live app are used here now.
      basic: { icon: 'ph-fill ph-house', accent: 'var(--dc-ink-body, #BCBCC3)', ring: 'var(--dc-line, #26262A)' },
      pro: { icon: 'ph-fill ph-lightning', accent: 'var(--dc-gold-lit, #F0D6A6)', ring: 'rgba(217,180,120,.45)' },
      studio: { icon: 'ph-fill ph-sparkle', accent: 'var(--dc-gold-lit, #F0D6A6)', ring: 'rgba(217,180,120,.6)' },
    };
    var TIER_TAG = { basic: '', pro: 'Most popular', studio: 'For channels at scale' };
    function periodJustMoved() {
      return Boolean(UI.billingFrom) && UI.billingFrom !== billingPeriod
        && (Date.now() - (UI.tokensAnimAt || 0) < 900);
    }

    // The plan record for whatever id this account actually carries. A
    // subscriber who signed up before tiers has 'monthly', which is no longer a
    // key in the grid -- looked up naively their plan displayed as "Free" while
    // they were being charged.
    var LEGACY_PLANS = { weekly: 'pro_weekly', monthly: 'pro_monthly', yearly: 'pro_yearly' };
    function currentPlanRecord() {
      var wanted = LEGACY_PLANS[currentPlanId] || currentPlanId;
      return planList.filter(function (p) { return String(p.id) === wanted; })[0] || null;
    }

    var tierCards = ['basic', 'pro', 'studio'].map(function (tier) {
      var plan = tier === 'basic' ? planGrid.free : planGrid[tier + '_' + billingPeriod];
      plan = plan || {};
      var look = TIER_LOOK[tier];
      var isCurrent = tier === 'basic'
        ? (currentPlanId === 'free' || !currentPlanId)
        : String(plan.id || '') === currentPlanId
          // The three original ids mean Pro at that period, and a subscriber
          // who signed up before tiers still carries one.
          || (tier === 'pro' && currentPlanId === billingPeriod);
      var unconfigured = tier !== 'basic' && plan.enabled === false;
      // What each tier ADDS over the one before it: repeating Pro's list inside
      // Studio's makes three identical columns and hides the actual difference.
      var adds = (DATA.billing && DATA.billing.tierAdds && DATA.billing.tierAdds[tier]) || [];
      var lines = (tier === 'basic'
        ? (DATA.billing && DATA.billing.freeIncludes || [])
        : adds).map(function (text) {
        return {
          text: text,
          icon: 'ph-fill ph-check-circle',
          iconStyle: 'font-size: 13px; flex: none; margin-top: 2px; color: ' + (tier === 'basic' ? 'var(--dc-n-7fd1a6, #7FD1A6)' : look.accent) + ';',
        };
      });
      return {
        name: plan.name && tier !== 'basic' ? plan.name.split(' ')[0] : (tier === 'basic' ? 'Basic' : plan.name || tier),
        tier: tier, isCurrent: isCurrent, disabled: Boolean(isCurrent || tier === 'basic' || unconfigured),
        tagline: plan.description || '',
        icon: look.icon,
        iconStyle: 'font-size: 15px; color: ' + look.accent + ';',
        markStyle: 'display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; border: 1px solid ' + look.ring + '; background: ' + (tier === 'basic' ? 'var(--dc-bg-raised, #17171A)' : 'rgba(217,180,120,.08)') + ';',
        tag: isCurrent ? 'Your plan' : TIER_TAG[tier],
        tagStyle: (isCurrent || TIER_TAG[tier])
          ? 'position: absolute; top: -9px; left: 16px; padding: 2px 9px; border-radius: 20px; border: 1px solid ' + look.ring + '; background: var(--dc-bg-deepest, #0E0E11); font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ' + (isCurrent ? 'var(--dc-n-7fd1a6, #7FD1A6)' : look.accent) + ';'
          : 'display: none;',
        price: tier === 'basic' ? 'Free' : (plan.priceLabel || 'Price not set'),
        priceStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 30px; font-weight: 600; letter-spacing: -.04em; line-height: 1; color: ' + (tier === 'basic' ? 'var(--dc-ink, #F2F2F4)' : look.accent) + ';',
        per: tier === 'basic' ? 'for ' + (DATA.billing && DATA.billing.trialDays || 3) + ' days' : 'per ' + billingPeriod.replace('ly', ''),
        tokens: plan.tokens != null ? Number(plan.tokens).toLocaleString() + ' tokens' : '',
        linesLabel: tier === 'basic' ? 'Included' : tier === 'pro' ? 'Everything in Basic, plus' : 'Everything in Pro, plus',
        lines: lines,
        cta: isCurrent ? 'Your plan' : tier === 'basic' ? 'Where you start' : unconfigured ? 'Opening soon' : 'Choose ' + (plan.name || '').split(' ')[0],
        btnStyle: 'margin-top: auto; padding: 11px 12px; border-radius: 9px; font-family: inherit; font-size: 12.5px; font-weight: 600; border: 1px solid '
          + (isCurrent || tier === 'basic' || unconfigured
            ? 'var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-faint, #6E6E76); cursor: default;'
            : 'rgba(217,180,120,.45); background: rgba(217,180,120,.13); color: var(--dc-gold-lit, #F0D6A6); cursor: pointer;'),
        foot: unconfigured ? 'Not open for checkout yet.' : '',
        footStyle: unconfigured ? 'font-size: 10.5px; color: var(--dc-ink-faint, #6E6E76);' : 'display: none;',
        cardStyle: 'position: relative; display: flex; flex-direction: column; gap: 14px; padding: 26px 24px 24px; border-radius: 16px; border: 1px solid '
          + (isCurrent ? 'rgba(127,209,166,.4)' : tier === 'studio' ? 'rgba(217,180,120,.4)' : 'var(--dc-line-soft, #1E1E22)')
          + '; background: ' + (tier === 'basic' ? 'var(--dc-bg, #121214)' : 'linear-gradient(180deg, rgba(217,180,120,.05), rgba(217,180,120,.01)), var(--dc-bg, #121214)') + ';',
        choose: function (e) {
          stop(e);
          if (isCurrent || tier === 'basic') { if (tier === 'basic' && !isCurrent) toast('To go back to Basic, cancel your plan under Manage billing.'); return; }
          if (unconfigured) { toast((plan.name || 'That plan') + ' is not open for checkout yet.'); return; }
          global.StudioAdapter.onChoosePlan(plan.id);
        },
      };
    });

    var vals = {
      // ── shell: rail ──
      railOpen: open,
      railStyle: 'position: relative; align-self: stretch; height: 100%; min-height: 0; ' + (open ? 'overflow-y: auto; overflow-x: hidden; ' : 'overflow: visible; ') + 'display: flex; flex-direction: column; gap: 18px; width: ' + (open ? '228px' : '68px') + '; padding: 16px 12px; border-right: 1px solid var(--dc-line-soft, #1E1E22); background: linear-gradient(180deg, var(--dc-bg-deep, #101013), var(--dc-page-2, #0B0B0D)); transition: width .18s ease;',
      brandRowStyle: 'display: flex; align-items: center; gap: 10px; padding: ' + (open ? '4px 6px' : '4px 0') + '; ' + (open ? '' : 'flex-direction: column;'),
      brandTextStyle: open ? 'display: flex; flex-direction: column; line-height: 1.2; min-width: 0;' : 'display: none;',
      // The channel banner's own device: a hairline between the arch and the
      // wordmark. Only when the rail is open -- collapsed, there is no wordmark
      // to divide from.
      brandRuleStyle: open
        ? 'width: 1px; height: 20px; flex: none; margin: 0 1px; background: linear-gradient(180deg, rgba(217,180,120,0), rgba(217,180,120,.42), rgba(217,180,120,0));'
        : 'display: none;',
      // The mihrab lattice that used to fill the rail's lower half is GONE
      // (29 Aug 2026): "bottom left remove that ugly silloeut". It was one of
      // the three banner devices carried in at v3.25.0; the hairline rule and
      // the spaced STUDIO subtitle stay, this one did not earn its place.
      // Kept as an empty binding because the template still names it -- a
      // missing binding is a render error, not a blank element.
      railMotifStyle: 'display: none;',
      // At the BOTTOM of the rail now, not beside the wordmark: "make it the
      // collpas ebutton instead the top one". The rail is position:relative,
      // so this anchors to it and stays centred at either width -- 228px open,
      // 68px collapsed -- without the template moving.
      // A 26px bordered square floating in the rail's empty lower half read as
      // a stray artefact rather than a control -- Youssef: "improve that
      // collpas ebutton looks dumb". It is the rail's last ROW now: the same
      // padding, radius, gap and hover as a nav item, one shade quieter, with
      // the word for what it does when there is room for it. Still pinned to
      // the bottom (the rail is position:relative) so the nav above it does
      // not move.
      railToggleStyle: ((global.innerWidth || 1280) <= 820 ? 'display: none; ' : 'display: flex; ')
        + 'position: absolute; left: 12px; right: 12px; bottom: 12px; '
        // A small z-index because it floats OVER the rail's content rather than
        // sitting in the brand row's flow; without one, anything the nav grows
        // into that space would take the clicks. (A dialog scrim at z-index 200
        // still covers it, which is correct -- the tour and the modals are
        // meant to block the app underneath.)
        + 'z-index: 5; align-items: center; '
        + (open ? 'gap: 10px; padding: 9px 10px; ' : 'justify-content: center; padding: 9px 0; ')
        + 'border: 0; border-radius: 8px; background: transparent; color: var(--dc-ink-faint, #6E6E76); '
        + 'font-family: inherit; font-size: 11.5px; font-weight: 500; text-align: left; '
        + 'cursor: pointer; transition: background .14s ease, color .14s ease;',
      railToggleLabel: open ? 'Collapse' : '',
      railToggleLabelStyle: open ? 'white-space: nowrap;' : 'display: none;',
      // The plain caret, unchanged: it is the glyph that was visibly rendering
      // in the live app, and ph-seedling already cost a release by being a
      // name that reads fine and draws nothing. The word beside it carries the
      // meaning now anyway.
      railToggleIcon: open ? 'ph ph-caret-left' : 'ph ph-caret-right',
      railToggleTitle: open ? 'Collapse sidebar' : 'Expand sidebar',
      toggleRail: function (e) { stop(e); setUI({ railOpen: !UI.railOpen }); },

      navHome: [navItem('home', 'Home', 'ph-fill ph-house', '')],
      // The two group headings are literal strings inside the generated
      // template, so what each group MEANS has to be earned by what is put in
      // it rather than by renaming the label -- renaming would need a design
      // re-import, and that regenerates every hashed class name in the app.
      //
      // Produce is the working loop end to end: bring a lecture in, decide on
      // the clips, give them slots, then see how they did. Performance sat
      // under "Set up", which it has never been -- nobody configures it.
      navProduce: [
        navItem('library', 'Lecture library', 'ph ph-film-script', ''),
        navItem('queue', 'Review queue', 'ph-fill ph-stack', needsCount || ''),
        navItem('schedule', 'Schedule', 'ph ph-calendar-dots', scheduled.length || ''),
        navItem('performance', 'Performance', 'ph ph-chart-line-up', ''),
      ],
      // Set up is now only the two things an account configures once, and then
      // the tail: the assistant, help and the operator's own door, which are
      // not steps in anybody's workflow. The tail is pushed to the foot of the
      // rail by CSS (dc-nav-tail in studio-tokens.css) -- the items were
      // ending 340px short of the bottom, which reads as an unfinished column.
      navSetup: [
        navItem('templates', 'Templates', 'ph ph-text-aa', ''),
        navItem('music', 'Nasheed library', 'ph ph-music-notes', ''),
        deenaiNavItem(),
        helpNavItem(),
      ].concat(isOperator(DATA) ? [ownerNavItem()] : []),

      workerCardStyle: 'margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: ' + (open ? '11px' : '9px 6px') + '; border: 1px solid var(--dc-line-soft, #1E1E22); border-radius: 10px; background: var(--dc-bg, #121214);',
      workerTextStyle: open ? 'white-space: nowrap;' : 'display: none;',
      workerMetaStyle: open ? 'margin-left: auto; color: var(--dc-ink-faint, #6E6E76); white-space: nowrap;' : 'display: none;',

      // ── shell: header ──
      pageTitle: TITLES[UI.screen] || 'Studio',
      subline: sublineFor(UI.screen, ctx),
      query: UI.query,
      setQuery: function (e) { UI.query = e.target.value; refresh(); },
      tokenBalance: current.unlimited ? '∞' : Number(current.remaining || 0).toLocaleString(),
      currentPlan: planLabel,
      goTokens: function (e) {
        stop(e);
        setUI({ screen: 'tokens', lastScreen: UI.screen === 'tokens' ? UI.lastScreen : UI.screen, menuOpen: false, tokensAnimAt: Date.now() });
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
        var on = desktopNotifsState() === 'on';
        return 'position: relative; width: 34px; height: 19px; flex: none; border-radius: 20px; cursor: pointer; border: 1px solid '
          + (on ? 'rgba(127,209,166,.5); background: rgba(127,209,166,.16);' : 'var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A);');
      })(),
      desktopNotifsKnobStyle: (function () {
        var on = desktopNotifsState() === 'on';
        return 'position: absolute; top: 2px; left: ' + (on ? '17px' : '2px') + '; width: 13px; height: 13px; border-radius: 50%; background: ' + (on ? 'var(--dc-n-7fd1a6, #7FD1A6)' : 'var(--dc-n-6e6e76, #6E6E76)') + ';';
      })(),
      // The phone's Activity sheet reads these two; the desktop template reads
      // the inline styles above. All four come from ONE state function, so no
      // surface can say a different thing about the same switch.
      /*
       * "Desktop notifications" stopped being true when Web Push shipped: the
       * same switch now reaches a phone, and reaches it with DeenClipped
       * closed. The literal lives in the design export, so it is a
       * text-override rather than a re-import (which would regenerate every
       * hashed class name in the app for one label).
       */
      notifsLabel: NOTIFS_LABEL,
      desktopNotifsOn: desktopNotifsState() === 'on',
      desktopNotifsCls: desktopNotifsState() === 'on' ? 'on' : '',
      toggleDesktopNotifs: function (e) { stop(e); global.StudioAdapter.onToggleDesktopNotifs(); },
      // The row sits at the TOP of the dropdown now and outside the
      // dismissed-items branch it used to be nested in -- the one control that
      // turns notifications on was only shown to someone who had already
      // dismissed a notification. This line says which of the three states it
      // is in, because "off" and "the browser refused" need different actions.
      desktopNotifsNote: DESKTOP_NOTIF_NOTE[desktopNotifsState()],

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
      // The AVATAR was a literal "YC" in the design export, so every customer
      // wore the operator's initials on their own account.
      accountInitials: accountInitials(DATA.user),

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
      isDeenai: UI.screen === 'deenai',
      isHelp: UI.screen === 'help',
      isEmptyStudio: projects.length === 0,

      // ── DeenAI ──
      aiLocked: !aiOn,
      aiUnlocked: aiAskOn,
      aiAskGate: !aiAskOn,
      // Both CTAs on this screen name STUDIO, never Pro. Youssef, 1 Sept 2026:
      // "it should be unlock with studio."
      //
      // It is also the only truthful answer for the button under Ask. The two
      // halves of DeenAI sit behind different gates -- insights are `deenai`
      // (Pro), asking is `deenaiAsk` (Studio) -- and one binding was serving
      // both buttons, so the Ask box told a free account to buy Pro for the one
      // thing Pro does not include. Studio is the plan that unlocks the whole
      // screen, so Studio is what both buttons say; the note below is where Pro
      // is mentioned, rather than on a button that would be selling the wrong
      // plan.
      aiGateCta: aiOn ? 'Upgrade to Studio' : 'Unlock with Studio',
      // Shown under the locked banner. Free accounts only -- `aiLocked` is
      // !aiOn -- so it never has to speak to a Pro account.
      aiDemoNote: 'These numbers are sample output. Studio reads your own clips, '
        + 'scores and posting record and answers your questions. Pro turns the '
        + 'figures real without the asking.',
      aiGateNote: aiOn
        ? 'Your insights above are real. Asking DeenAI questions runs on our own render box, and that is what Studio buys.'
        : 'Studio answers your questions. Pro turns the figures above into your own numbers.',
      aiSub: aiAskOn
        ? 'Reads your own clips, scores and posting record — and answers back.'
        : aiOn
          ? 'Reads your own clips, scores and posting record. Asking is a Studio feature.'
          : 'A Studio feature — free accounts can look, not use',
      aiCount: aiData ? plural(aiAllCards.length, 'insight').toUpperCase() : '',
      aiNote: aiData ? (aiOn ? 'from your own records' : 'sample output') : '',
      aiFootnote: aiOn
        ? 'Every figure above is counted from your own clips — DeenAI never invents a number.'
        : 'On a paid plan these are your own numbers, counted from your own clips.',
      aiUpgrade: function (e) { stop(e); setUI({ screen: 'tokens', tokensAnimAt: Date.now() }); },

      // the headline insight
      aiHeadShow: Boolean(aiHead),
      aiHeadFigureShow: Boolean(aiHead && aiHead.figure),
      aiHeadFigure: aiHead ? String(aiHead.figure || '') : '',
      aiHeadFigureLabel: aiHead ? String(aiHead.figureLabel || '') : '',
      aiHeadFigureNote: aiHead ? String(aiHead.figureNote || '') : '',
      aiHeadKicker: aiHead ? String(aiHead.kicker || '') : '',
      aiHeadKickerStyle: (aiHead && aiHead.kicker)
        ? 'font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--dc-ink-dim, #8B8B93);'
        : 'display: none;',
      aiHeadTitle: aiHead ? String(aiHead.title || '') : '',
      // An Arabic lecture title renders right-to-left in Amiri, the face the
      // renderer itself uses for Arabic. Left in Inter it reads as a foreign
      // string the app does not understand.
      aiHeadTitleStyle: (aiHead && aiHead.rtl)
        ? 'direction: rtl; text-align: left; font-family: Amiri, serif; font-size: 28px; line-height: 1.5; color: var(--dc-ink, #F2F2F4); text-wrap: pretty;'
        : 'font-family: Outfit, Inter, sans-serif; font-size: 22px; font-weight: 600; letter-spacing: -.02em; line-height: 1.3; color: var(--dc-ink, #F2F2F4); text-wrap: pretty;',
      aiHeadBody: aiHead ? String(aiHead.body || '') : '',

      // the band of figures
      aiMetrics: aiMetricRows.map(function (m, index) {
        return {
          label: String(m.label || ''),
          value: String(m.value || ''),
          unit: String(m.unit || ''),
          note: String(m.note || ''),
          demoStyle: aiDemoChip(m.demo),
          cellStyle: 'flex: 1 1 200px; display: flex; flex-direction: column; gap: 5px; padding: 4px 26px;'
            + (index === 0 ? ' padding-left: 4px;' : ' border-left: 1px solid rgba(242,242,244,.07);'),
          valueStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 30px; font-weight: 600; line-height: 1.1;'
            + ' font-variant-numeric: tabular-nums; color: ' + aiTone(m.tone).value + ';',
        };
      }),

      // everything else, as rows rather than boxes
      aiCards: aiRows.map(function (card) {
        var tone = aiTone(card.tone);
        return {
          icon: card.icon || 'ph ph-sparkle',
          iconWrapStyle: 'flex: none; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid '
            + tone.border + '; border-radius: 10px; background: ' + (card.tone === 'gold' ? 'rgba(217,180,120,.07)' : 'var(--dc-bg, #121214)') + ';',
          iconStyle: 'font-size: 15px; color: ' + tone.icon + ';',
          // A row has no kicker slot, so the card supplies the whole line where
          // its kicker began a sentence. Without this, "You keep the" /
          // "shorter ones" arrived on screen as a heading reading "shorter
          // ones", which means nothing on its own.
          title: String(card.line || card.title || ''),
          titleStyle: 'font-size: 13.5px; font-weight: 600; color: ' + (card.tone === 'warn' ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-ink, #F2F2F4)') + '; text-wrap: pretty;',
          demoStyle: aiDemoChip(card.demo),
          body: String(card.body || ''),
        };
      }),
      aiEmpty: Boolean(aiOn && aiData && aiAllCards.length === 0 && aiMetricRows.length === 0),

      // the ask
      aiQ: UI.aiQ,
      aiSetQ: function (e) { UI.aiQ = e.target.value; refresh(); },
      aiPrompts: AI_PROMPTS.map(function (text) {
        return {
          text: text,
          click: null,
          pick: function (e) { stop(e); setUI({ aiQ: text }); },
        };
      }),
      aiAsk: function (e) { stop(e); global.StudioAdapter.onAskDeenAI(); },
      aiAskStyle: 'flex: none; display: inline-flex; align-items: center; gap: 7px; margin-top: 3px; padding: 11px 18px; border: 1px solid rgba(217,180,120,.55); border-radius: 9px; '
        + (UI.aiBusy
          ? 'background: rgba(217,180,120,.06); color: #A08A63; cursor: default;'
          : 'background: rgba(217,180,120,.14); color: var(--dc-gold-lit, #F0D6A6); cursor: pointer;')
        + ' font-family: inherit; font-size: 13px; font-weight: 600; transition: background .14s ease;',
      aiAskLabel: UI.aiBusy ? 'Thinking…' : 'Ask',
      aiAskIcon: UI.aiBusy ? 'dcai-spin' : 'ph-fill ph-paper-plane-tilt',
      aiAskIconStyle: UI.aiBusy
        ? 'width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(240,214,166,.3); border-top-color: var(--dc-gold-lit, #F0D6A6);'
        : 'font-size: 13px;',
      aiBusyShow: Boolean(UI.aiBusy),
      aiAskNote: UI.aiBusy
        ? 'Running on DeenClipped’s own box — usually under half a minute.'
        : 'Answers use your numbers, never your transcripts.',
      aiHasAnswer: Boolean(UI.aiAnswer),
      aiAnswer: UI.aiAnswer,

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
            (processing ? 'rgba(230,183,112,.4); background: rgba(10,10,12,.8); color: var(--dc-n-e6b770, #E6B770);'
              : state === 'ready' ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.8); color: var(--dc-n-7fd1a6, #7FD1A6);'
              : 'rgba(226,124,124,.4); background: rgba(10,10,12,.8); color: var(--dc-n-e27c7c, #E27C7C);'),
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
          thumbStyle: 'width: 26px; height: 38px; flex: none; border-radius: 5px; border: 1px solid var(--dc-line, #26262A); background: ' + thumb(c.thumbUrl) + ';',
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
          thumbStyle: 'width: 24px; height: 34px; flex: none; border-radius: 5px; border: 1px solid var(--dc-line, #26262A); background: ' + thumb(c.thumbUrl) + ';',
          timeStyle: 'font-size: 11.5px; font-weight: 600; letter-spacing: .02em; width: 38px; flex: none; color: ' + (i === 0 ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-dim, #8B8B93)'),
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
            (state === 'approved' ? 'rgba(127,209,166,.4); background: rgba(10,10,12,.82); color: var(--dc-n-7fd1a6, #7FD1A6);' : 'rgba(217,180,120,.36); background: rgba(10,10,12,.82); color: var(--dc-gold-lit, #F0D6A6);'),
          style: 'position: absolute; top: ' + p.top + '; left: ' + p.left + '; width: ' + p.w + '; aspect-ratio: 9 / 16; border-radius: 11px; overflow: hidden; rotate: ' + p.rot + '; animation: dcFloat ' + p.dur + ' ease-in-out ' + p.delay + ' infinite;' +
            (c ? ' border: 1px solid var(--dc-line, #26262A); background: ' + thumb(c.thumbUrl) + '; box-shadow: 0 18px 40px rgba(0,0,0,.5);'
               : ' border: 1px dashed var(--dc-n-2c2c32, #2C2C32); background: var(--dc-well, rgba(18,18,20,.5)); display: grid; place-items: center;'),
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
          key: t.key, on: UI.filter === t.key,
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
      deckClip: deckClip || { id: '', caption: '', score: '', duration: '', lecTitle: '', thumbStyle: 'display:none;', flagged: false, style: '' },
      deckApprove: function (e) { stop(e); if (deckClip) deckClip.approve(e); },
      deckReject: function (e) { stop(e); if (deckClip) deckClip.reject(e); },
      deckEdit: function (e) { stop(e); if (deckClip) deckClip.edit(e); },
      deckSkip: function (e) { stop(e); setUI({ deckIdx: Math.min(UI.deckIdx + 1, Math.max(0, queueClips.length - 1)) }); },
      deckBack: function (e) { stop(e); setUI({ deckIdx: Math.max(0, UI.deckIdx - 1) }); },
      // How far through the waiting stack this position is -- the strip above
      // the card, so working the queue feels like progress rather than a
      // bottomless pile.
      deckProgStyle: 'position: absolute; inset: 0 auto 0 0; border-radius: 20px; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6)); transition: width .25s ease; width: '
        + (queueClips.length ? Math.round(Math.min(UI.deckIdx + 1, queueClips.length) / queueClips.length * 100) : 0) + '%;',
      // Decisions made since the screen was opened. UI.pending is exactly that
      // ledger -- it holds this session's optimistic decisions until the server
      // state catches up -- so the tally costs nothing to keep.
      deckTally: (function () {
        var a = 0; var r = 0;
        Object.keys(UI.pending).forEach(function (k) {
          if (UI.pending[k] === 'approved') a += 1;
          else if (UI.pending[k] === 'rejected') r += 1;
        });
        if (!a && !r) return '';
        var parts = [];
        if (a) parts.push(a + ' approved');
        if (r) parts.push(r + ' rejected');
        return parts.join(' \u00b7 ');
      })(),
      // The worker's own reasons for the score, on the deck where the decision
      // is actually made. The grid has carried them for a while; the deck --
      // the surface built for deciding -- never did.
      deckWhy: (deckClip && deckClip.scoreWhy) || '',
      deckWhyStyle: (deckClip && deckClip.scoreWhy)
        ? 'display: flex; align-items: flex-start; gap: 5px; margin-top: 2px; font-size: 10.5px; line-height: 1.5; color: var(--dc-ink-dim, #8B8B93); text-align: left; max-width: 100%;'
        : 'display: none;',
      // While the render plays in place, the card stops drawing text over it:
      // the rendered clip already carries its own captions, and painting more
      // words on top is the second-rendering-engine mistake by another door.
      // The title moves below the card either way.
      deckShowMeta: !(deckRaw && deckRaw.videoUrl),
      deckShadeStyle: (deckRaw && deckRaw.videoUrl)
        ? 'position: absolute; inset: 0 0 auto 0; height: 30%; z-index: 1; background: linear-gradient(180deg, rgba(9,9,10,.55), transparent); pointer-events: none;'
        : 'position: absolute; inset: 0; background: linear-gradient(180deg, rgba(9,9,10,.45), transparent 34%, rgba(9,9,10,.88));',
      deckSoundStyle: (deckRaw && deckRaw.videoUrl)
        ? 'position: absolute; top: 10px; right: 10px; z-index: 4; display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid rgba(255,255,255,.22); border-radius: 50%; background: rgba(10,10,12,.72); color: '
          + (UI.deckMuted ? 'var(--dc-ink-body, #BCBCC3)' : 'var(--dc-gold-lit, #F0D6A6)') + '; cursor: pointer; transition: color .14s ease, border-color .14s ease;'
        : 'display: none;',
      deckSoundIcon: UI.deckMuted ? 'ph ph-speaker-simple-slash' : 'ph ph-speaker-simple-high',
      deckSoundTitle: UI.deckMuted ? 'Sound on (M)' : 'Mute (M)',
      deckToggleSound: function (e) { stop(e); setUI({ deckMuted: !UI.deckMuted }); },
      deckRateLabel: (UI.deckRate === 1 ? '1' : UI.deckRate === 1.5 ? '1.5' : '2') + '\u00d7',
      deckCycleRate: function (e) { stop(e); setUI({ deckRate: UI.deckRate === 1 ? 1.5 : UI.deckRate === 1.5 ? 2 : 1 }); },
      // The next few waiting clips, one thumb each, so the queue can be walked
      // out of order -- a low scorer worth checking early, a flagged one saved
      // for last. The window slides with the position.
      deckStrip: (function () {
        if (queueClips.length < 2) return [];
        var span = Math.min(8, queueClips.length);
        var startAt = Math.max(0, Math.min(deckAt - 3, queueClips.length - span));
        return queueRaw.slice(startAt, startAt + span).map(function (c, i) {
          var at = startAt + i;
          var current = at === deckAt;
          return {
            score: c.score || '\u2014',
            title: (c.title || 'Clip') + ' \u00b7 ' + (c.score || '?'),
            jump: function (e) { stop(e); setUI({ deckIdx: at }); },
            style: 'position: relative; width: ' + (current ? 44 : 38) + 'px; height: ' + (current ? 78 : 68) + 'px; padding: 0; overflow: hidden; cursor: pointer; border-radius: 8px; transition: opacity .14s ease, border-color .14s ease; border: 1px solid '
              + (current ? 'var(--dc-gold, #D9B478)' : 'var(--dc-line, #26262A)') + '; opacity: ' + (current ? 1 : .55) + '; background: ' + thumb(c.thumbUrl) + ';',
            scoreStyle: 'position: absolute; left: 0; right: 0; bottom: 0; padding: 1px 0 2px; font-size: 8.5px; font-weight: 700; color: ' + (current ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-body, #BCBCC3)') + '; background: linear-gradient(180deg, transparent, rgba(9,9,10,.9));',
          };
        });
      })(),
      // Zero left to decide is an achievement, not an empty stream. Only on the
      // decide tab, and only when the studio has clips at all -- an empty
      // studio keeps its own get-started state.
      deckClear: queueClips.length === 0 && UI.filter === 'review' && clips.length > 0,
      deckClearMsg: (function () {
        var a = 0;
        Object.keys(UI.pending).forEach(function (k) { if (UI.pending[k] === 'approved') a += 1; });
        var approvedNow = clips.filter(function (c) { return decision(c) === 'approved'; }).length;
        return (a ? 'Every clip has a decision \u2014 ' + a + ' approved this session. ' : 'Every clip has a decision. ')
          + (approvedNow ? 'Approved clips take the next free posting slots on the schedule.' : 'New clips land here as lectures finish processing.');
      })(),
      deckGoSchedule: function (e) { stop(e); setUI({ screen: 'schedule' }); },

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
          iconStyle: 'font-size: 14px; color: ' + (done ? 'var(--dc-n-7fd1a6, #7FD1A6)' : running ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-n-4a4a52, #4A4A52)') + (running ? '; animation: dcSpin 1.1s linear infinite' : ''),
          labelStyle: 'color: ' + (done || running ? 'var(--dc-ink-bright, #E9E9ED)' : 'var(--dc-ink-faint, #6E6E76)'),
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
          iconStyle: 'font-size: 14px; color: ' + (c.ok ? 'var(--dc-n-7fd1a6, #7FD1A6)' : 'var(--dc-gold-lit, #F0D6A6)'),
        };
      }),

      // A blocking money notice cannot be dismissed away. The nasheed nag is
      // advice; "your free trial has ended" is the reason nothing works, and
      // hiding it would leave the account silently unable to do anything.
      blockersOn: blockerShowing,
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
          key: t.key, on: UI.libFilter === t.key,
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
      detailThumbStyle: 'width: 168px; flex: none; aspect-ratio: 16 / 9; border-radius: 10px; border: 1px solid var(--dc-line, #26262A); background: ' + thumb(detail && detail.sourceThumbUrl) + ';',
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
            + ' color: ' + (isToday ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-dim, #8B8B93)') + ';',
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
          key: v.id, on: schedView === v.id,
          label: v.label,
          style: wordOption(schedView === v.id, 13),
          select: function (e) { stop(e); setUI({ schedView: v.id }); },
        };
      }),
      // The same progress, carried on every screen. Seen only on Home, a new
      // user walking through the product has no idea anything is still
      // outstanding until they navigate back.
      setupChipStyle: 'display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 20px;'
        + ' border: 1px solid rgba(217,180,120,.34); background: rgba(217,180,120,.08); color: var(--dc-gold-lit, #F0D6A6);'
        + ' font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;'
        + ' transition: border-color .14s ease, background .14s ease;',
      openSetup: function (e) { stop(e); setUI({ screen: 'home' }); },

      startDoneLabel: setupDoneCount + ' of ' + setupSteps.length + ' done',
      /*
       * RETIRED (v3.95.0). Youssef, looking at the live Home screen: "remove
       * the getting start and improve this one cause i already had it" -- the
       * Create -> Review -> Publish strip had been built beside a five-step
       * checklist that was already there, which is two onboarding systems on
       * one screen telling one person two different things about where they
       * are.
       *
       * Held false rather than deleted: this one binding gates BOTH the Home
       * card and the header's "1 of 5 done" chip (one `sc-if` in the design
       * export wraps each), so switching it off removes both with no
       * re-import -- and a re-import regenerates every hashed class name in
       * the app. The steps themselves are still computed because the template
       * names them and a missing binding is a render error, and because
       * everything they checked was folded into the strip's copy
       * (src/onboarding.js): the nasheed prerequisite into Create, connecting
       * a channel and giving a clip a time into Publish.
       */
      startListOn: false,

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
              + (item.done ? 'rgba(127,209,166,.5); background: rgba(127,209,166,.14); color: var(--dc-n-7fd1a6, #7FD1A6);'
                           : 'var(--dc-n-2c2c33, #2C2C33); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-dim, #8B8B93);'),
            num: item.done ? '\u2713' : String(i + 1),
            titleStyle: 'font-family: Outfit, Inter, sans-serif; font-size: 13px; font-weight: 500; color: '
              + (item.done ? 'var(--dc-ink-faint, #6E6E76)' : 'var(--dc-ink, #F2F2F4)') + ';' + (item.done ? ' text-decoration: line-through;' : ''),
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
      schedMeter: countTo(daySlots).map(function (n) {
        return { style: 'flex: 1; height: 5px; border-radius: 20px; transition: background .2s ease; background: '
          + (n < schedTodayCount ? 'linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6))' : 'var(--dc-n-26262c, #26262C)') + ';' };
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
            + (live ? 'var(--dc-n-7fd1a6, #7FD1A6)' : p.connected ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-n-4a4a54, #4A4A54)') + ';',
          noteStyle: 'margin-left: auto; font-size: 11px; color: ' + (live ? 'var(--dc-ink-dim, #8B8B93)' : 'var(--dc-n-e0a188, #E0A188)') + ';',
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
            (on ? 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: var(--dc-gold-lit, #F0D6A6);' : 'transparent; background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-dim, #8B8B93);'),
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
      edThumbStyle: 'position: relative; container-type: inline-size; width: 100%; max-width: 268px; aspect-ratio: 9 / 16; border-radius: 13px; overflow: hidden; border: 1px solid var(--dc-line, #26262A); background: ' +
        thumb(edClip && edClip.thumbUrl) + '; box-shadow: 0 26px 60px rgba(0,0,0,.5);',
      closeEditor: function (e) { stop(e); setUI({ screen: 'queue', edClipId: null, edStyleDraft: null, edBlockDraft: null, edTrim: null, edCutOuts: null, edCutMark: null }); },

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
      hlColour: tpl.captionHighlight || 'var(--dc-gold, #D9B478)',
      hlColourLabel: String(tpl.captionHighlight || 'var(--dc-gold, #D9B478)').toUpperCase(),
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
      capOutline: tpl.captionOutline || 'var(--dc-page, #09090A)',
      capOutlineLabel: String(tpl.captionOutline || 'var(--dc-page, #09090A)').toUpperCase(),
      setCapOutline: function (e) { saveStyle({ captionOutline: String(e.target.value || '').toUpperCase() }); },
      capOutlineWidth: Math.max(0, Math.min(14, Number(tpl.captionOutlineWidth) || 0)),
      capOutlineWidthLabel: (Number(tpl.captionOutlineWidth) || 0) ? Number(tpl.captionOutlineWidth) + '' : 'None',
      setCapOutlineWidth: function (e) { saveStyle({ captionOutlineWidth: Number(e.target.value) }); },
      capShadow: Math.max(0, Math.min(8, Number(tpl.captionShadow) || 0)),
      capShadowLabel: (Number(tpl.captionShadow) || 0) ? Number(tpl.captionShadow) + '' : 'None',
      setCapShadow: function (e) { saveStyle({ captionShadow: Number(e.target.value) }); },
      capBg: tpl.captionBackground || 'var(--dc-n-000000, #000000)',
      capBgLabel: String(tpl.captionBackground || 'var(--dc-n-000000, #000000)').toUpperCase(),
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

      // Overriding where the crop sits. Audit item: "users must be able to
      // override AI framing" — and until now they could not, because the only
      // controls that existed lived in the classic shell nothing links to, and
      // those wrote 0-100 into a field the schema clamps to [0,1], so any
      // non-zero setting pinned the crop hard against the right or bottom edge.
      // The percentages here are display only; the value written is 0-1.
      edCropRowStyle: String(tpl.fitMode || '') === 'crop'
        ? 'display: flex; flex-direction: column; gap: 5px;'
        : 'display: none;',
      edCropX: Math.round((Number(tpl.cropPositionX) >= 0 ? Number(tpl.cropPositionX) : 0.5) * 100),
      edCropY: Math.round((Number(tpl.cropPositionY) >= 0 ? Number(tpl.cropPositionY) : 0.5) * 100),
      edCropXLabel: cropLabel(tpl.cropPositionX, 'Left', 'Centred', 'Right'),
      edCropYLabel: cropLabel(tpl.cropPositionY, 'Top', 'Middle', 'Bottom'),
      setCropX: function (e) { saveStyle({ cropPositionX: Math.max(0, Math.min(1, Number(e.target.value) / 100)) }); },
      setCropY: function (e) { saveStyle({ cropPositionY: Math.max(0, Math.min(1, Number(e.target.value) / 100)) }); },
      edCropNote: tpl.smartFramingEnabled
        ? 'Only used where the speaker cannot be found — face tracking wins when it succeeds.'
        : 'Where the 9:16 window sits over the wider source.',

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
        + (UI.edSafe ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.12); color: var(--dc-gold-lit, #F0D6A6);'
                     : 'var(--dc-line, #26262A); background: var(--dc-bg, #121214); color: var(--dc-ink-dim, #8B8B93);'),
      toggleSafe: function (e) { stop(e); setUI({ edSafe: !UI.edSafe }); },
      edMarkStyle: 'position: absolute; z-index: 8; right: 11px; ' +
        (String(tpl.watermarkPosition).indexOf('top') === 0 ? 'top: 11px;' : 'bottom: 42px;') +
        ' font-family: Outfit, Inter, sans-serif; font-size: 8.5px; font-weight: 700; letter-spacing: .12em; color: ' +
        (tpl.watermarkColor || 'var(--dc-gold-lit, #F0D6A6)') + '; display: ' + (Number(tpl.watermarkOpacity) > 0 ? 'block' : 'none') + ';',
      // The playhead's wrapper. The design draws it as a 34px round button, which
      // in the timeline is an empty circle taking a lane's worth of height while
      // the actual playhead -- the absolutely positioned line inside it -- spans
      // the track anyway. Made into a transparent overlay so only the line shows.
      // ── Trim ────────────────────────────────────────────────────────────
      // The render pipeline learned to cut in v3.2.0 and no control ever asked
      // it to. These are clip-local seconds against the same denominator the
      // playhead and the caption blocks use, because a trim that disagreed with
      // the ruler by even a little would be worse than no trim at all.
      edTrimLaneStyle: 'position: absolute; inset: 0; pointer-events: none;',
      edTrimKeepStyle: (function () {
        // Dark wherever the clip is NOT kept: outside the trim, and across
        // every removed section, in one gradient.
        var stops = [];
        var cursor = 0;
        var pct = function (t) { return ((t / edDuration) * 100).toFixed(2) + '%'; };
        edKeeps.forEach(function (r) {
          if (r[0] > cursor) stops.push('rgba(8,8,10,.72) ' + pct(cursor) + ' ' + pct(r[0]));
          stops.push('transparent ' + pct(r[0]) + ' ' + pct(r[1]));
          cursor = r[1];
        });
        if (cursor < edDuration) stops.push('rgba(8,8,10,.72) ' + pct(cursor) + ' 100%');
        return 'position: absolute; top: 0; bottom: 0; left: 0; right: 0;'
          + ' background: linear-gradient(90deg, ' + (stops.join(', ') || 'transparent 0 100%') + ');'
          + ' border-radius: 7px; pointer-events: none;'
          + (edTrimmed ? '' : ' opacity: 0;');
      })(),
      edTrimStartStyle: 'position: absolute; top: -3px; bottom: -3px; left: ' + ((edTrim.from / edDuration) * 100).toFixed(2)
        + '%; width: 10px; margin-left: -5px; border-radius: 4px; cursor: ew-resize; pointer-events: auto;'
        + ' background: linear-gradient(180deg, var(--dc-gold-lit, #F0D6A6), var(--dc-gold, #D9B478)); box-shadow: 0 0 0 1px rgba(8,8,10,.6);',
      edTrimEndStyle: 'position: absolute; top: -3px; bottom: -3px; left: ' + ((edTrim.to / edDuration) * 100).toFixed(2)
        + '%; width: 10px; margin-left: -5px; border-radius: 4px; cursor: ew-resize; pointer-events: auto;'
        + ' background: linear-gradient(180deg, var(--dc-gold-lit, #F0D6A6), var(--dc-gold, #D9B478)); box-shadow: 0 0 0 1px rgba(8,8,10,.6);',
      edTrimLabel: edTrimmed
        ? 'Keeping ' + secsToClock(edKeptSec) + ' of ' + secsToClock(edDuration)
          + (edKeeps.length > 1
            ? ' in ' + edKeeps.length + ' sections'
            : ' · ' + secsToClock(edTrim.from) + ' to ' + secsToClock(edTrim.to))
          + ' · Save to render the cut'
        : 'Drag either handle to trim, or cut a section from the middle. The whole clip is kept.',
      edTrimResetStyle: 'padding: 4px 10px; border: 1px solid var(--dc-line, #26262A); border-radius: 7px; background: transparent;'
        + ' color: ' + (edTrimmed ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-n-4a4a52, #4A4A52)') + '; font-family: inherit; font-size: 10.5px; font-weight: 600;'
        + ' cursor: ' + (edTrimmed ? 'pointer' : 'default') + ';',
      dragTrimStart: function (e) { startTrimDrag(e, 'from', edDuration, edTrim); },
      dragTrimEnd: function (e) { startTrimDrag(e, 'to', edDuration, edTrim); },
      resetTrim: function (e) {
        stop(e);
        if (!edTrimmed && UI.edCutMark === null) return;
        UI.edTrim = null;
        UI.edCutOuts = edSavedCuts ? [] : null;
        UI.edCutMark = null;
        UI.edDirty = true;
        paintNow();
      },

      // ── Section cuts ───────────────────────────────────────────────────
      // Two presses of one button: the playhead marks where the cut starts,
      // then where it ends. Host-rendered beside "Use the whole clip" (the
      // timeline is generated markup, and a design re-import would regenerate
      // every class name in the app for one button), so these bindings are
      // data the host reads rather than template slots.
      edKeeps: edKeeps,
      edCutSections: edCutOuts.map(function (c, i) {
        return {
          index: i, from: c[0], to: c[1],
          label: secsToClock(c[0]) + '\u2013' + secsToClock(c[1]),
          leftPct: ((c[0] / edDuration) * 100).toFixed(2),
          widthPct: (((c[1] - c[0]) / edDuration) * 100).toFixed(2),
        };
      }),
      edCutMarkAt: (UI.edCutMark === null || UI.edCutMark === undefined) ? null : UI.edCutMark,
      edCutMarkPct: (UI.edCutMark === null || UI.edCutMark === undefined) ? null : ((UI.edCutMark / edDuration) * 100).toFixed(2),
      edCutButtonLabel: (UI.edCutMark === null || UI.edCutMark === undefined)
        ? 'Cut a section from here (' + secsToClock(edTime) + ')'
        : (Math.abs(edTime - UI.edCutMark) < 0.5
          ? 'Move the playhead, then cut to here'
          : 'Cut to here (' + secsToClock(Math.min(UI.edCutMark, edTime)) + '\u2013' + secsToClock(Math.max(UI.edCutMark, edTime)) + ')'),
      edCutArmed: !(UI.edCutMark === null || UI.edCutMark === undefined),
      markCut: function (e) {
        stop(e);
        if (!edClip) return;
        if (UI.edCutMark === null || UI.edCutMark === undefined) {
          UI.edCutMark = edTime;
          paintNow();
          return;
        }
        var a = Math.min(UI.edCutMark, edTime), b = Math.max(UI.edCutMark, edTime);
        UI.edCutMark = null;
        // Under half a second is a double-press, not a cut.
        if (b - a < 0.5) { paintNow(); return; }
        UI.edCutOuts = mergeCutOuts(edCutOuts.concat([[a, b]]));
        // The envelope has to be held explicitly once a cut exists, or Save
        // would see no trim state and drop the sections with it.
        UI.edTrim = UI.edTrim || { from: edTrim.from, to: edTrim.to };
        UI.edDirty = true;
        paintNow();
      },
      cancelCutMark: function (e) {
        stop(e);
        UI.edCutMark = null;
        paintNow();
      },
      restoreCut: function (index) {
        UI.edCutOuts = edCutOuts.filter(function (_, i) { return i !== index; });
        UI.edTrim = UI.edTrim || { from: edTrim.from, to: edTrim.to };
        UI.edDirty = true;
        paintNow();
      },

      edPlayStyle: 'position: absolute; inset: 0; pointer-events: none;',
      edPlayHeadStyle: 'position: absolute; top: 0; bottom: 0; left: ' + ((edTime / edDuration) * 100).toFixed(2) + '%; width: 2px; background: var(--dc-gold-lit, #F0D6A6);',
      edProgressStyle: 'height: 3px; border-radius: 3px; width: ' + ((edTime / edDuration) * 100).toFixed(2) + '%; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6));',
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
      edDirtyDot: 'width: 7px; height: 7px; border-radius: 50%; background: ' + ((UI.edDirty || (edClip && edClip.stylePending)) ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-n-7fd1a6, #7FD1A6)') + ';',
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
        // The trim travels with the save, in keeping with render-on-save: the
        // handles move instantly, and Save is what puts the cut on the video.
        // An untouched trim sends nothing rather than a range covering the
        // whole clip, so a clip with no cut keeps no cut.
        var payload = { transcript: text || edClip.transcript };
        if (UI.edTrim || Array.isArray(UI.edCutOuts)) {
          // The whole list of kept ranges: the trim with its sections cut
          // out. agent.updateClip clamps and orders it and the worker cuts
          // on it -- one shape from the handle to the render.
          payload.cutsSec = edTrimmed ? edKeeps : [];
          UI.edTrim = null;
          UI.edCutOuts = null;
          UI.edCutMark = null;
        }
        global.StudioAdapter.onSaveClip(edClip.id, payload);
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
        + ' border: 1px solid var(--dc-n-2a2a32, #2A2A32); background-color: var(--dc-bg-raised, #17171A);'
        + ' box-shadow: 0 10px 26px rgba(0,0,0,.5), inset 0 1px 0 rgba(248,248,249,.06);'
        + (job && job.thumbnail ? ' background-image: ' + posterLayers(job) + '; background-size: cover; background-position: center; background-repeat: no-repeat;' : ''),

      // ── The range handles ──
      // The design placed one input at top:2px and the other at bottom:2px, so
      // it read as two separate sliders rather than one range. Both sit on the
      // same track now. The input ignores the pointer so the upper one cannot
      // swallow clicks meant for the lower handle; only the thumbs are grabbable
      // (see the dc-range rules in index.html).
      jobRangeStartStyle: RANGE_INPUT_STYLE + ' accent-color: var(--dc-gold, #D9B478);',
      jobRangeEndStyle: RANGE_INPUT_STYLE + ' accent-color: var(--dc-gold-lit, #F0D6A6);',
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
          bars.push({ style: 'flex: 1 1 0; height: ' + h + '%; border-radius: 1px; background: var(--dc-n-26262c, #26262C);' });
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
      fieldLabel: 'font-size: 13px; color: var(--dc-ink-dim, #8B8B93); user-select: none; white-space: nowrap;',
      // One line that fills. Seven separate segments, a numbered chip and the
      // words STEP 3 OF 7 were three renderings of one small fact, stacked on
      // top of the question they belonged to.
      jobProgressStyle: 'position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px;'
        + ' background: linear-gradient(90deg, var(--dc-n-c9a468, #C9A468), var(--dc-gold-lit, #F0D6A6));'
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
          ? 'var(--dc-n-2a2a30, #2A2A30); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-faint, #6E6E76);'
          : 'rgba(217,180,120,.55); background: linear-gradient(180deg, rgba(217,180,120,.2), rgba(217,180,120,.1)); color: var(--dc-n-f5e3c0, #F5E3C0); box-shadow: 0 6px 18px rgba(217,180,120,.12);'),
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
      jobUploadStyle: 'display: inline-flex; align-items: center; gap: 6px; padding: 9px 13px; border: 1px dashed var(--dc-n-33333c, #33333C);'
        + ' border-radius: 9px; background: none; font-family: inherit; font-size: 13.5px; color: var(--dc-ink-dim, #8B8B93);'
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
        ? 'position: absolute; left: 0; bottom: 0; height: 2px; width: ' + Math.max(2, Math.min(100, UI.uploadPct)) + '%; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6)); transition: width .2s ease;'
        : UI.generating
        ? 'position: absolute; left: 0; bottom: 0; height: 2px; width: 40%; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6)); animation: dcSweep 1.1s ease-in-out infinite;'
        : 'display: none;',
      genProgressLabel: UI.uploadPct !== null
        ? 'Uploading ' + UI.uploadPct + '%' + (UI.uploadTotal ? ' · ' + fmtBytes(UI.uploadSent) + ' of ' + fmtBytes(UI.uploadTotal) : '')
        : UI.generating ? 'Queuing the lecture…' : (UI.jobError || ''),

      // ── Values the design hardcoded ──
      // These were literal text in the .dc.html. design/text-overrides.json turns
      // them into bindings at import time so they can carry the account's own
      // data; without that a customer sees the designer's placeholders, including
      // a payment card and a connection status that were never real.
      // Falling back to the whole email is what rendered the account button as
      // "youssefchannaoui05@gm..." -- width spent saying nothing. The local
      // part is still a handle, and it fits.
      accountName: accountName(DATA.user),
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
      // Counts AND size on one line. The three rows used to read "0 / 0 / 0"
      // beside a heading that already said "0 lectures - 0 clips", so the card
      // repeated itself and answered nothing.
      storageSources: plural(projects.length, 'lecture')
        + (storage.sourceBytes ? ' \u00b7 ' + fmtBytes(storage.sourceBytes) : ''),
      storageClips: plural(clips.length, 'clip')
        + (storage.clipBytes ? ' \u00b7 ' + fmtBytes(storage.clipBytes) : ''),
      storageTranscripts: plural(projects.filter(function (p) { return lecState(p) === 'ready'; }).length, 'lecture') + ' transcribed',

      /**
       * The Lecture library's sidebar, which used to end in three warnings.
       *
       * Youssef, 1 Sept 2026: "before you import, to be honest, all of them are
       * pretty useless ... they're not very informational or helpful."
       *
       * Every figure here is counted from this account's own projects and
       * clips -- the same rows the Performance screen counts -- so the two
       * screens cannot tell different stories about one lecture. Nothing is
       * fetched and no new route exists for this.
       *
       * Each block is null when it has nothing true to say. A card that pads
       * itself out with "0 of 0" teaches less than no card at all, and the
       * host draws only what it is given.
       */
      /*
       * First run: Step 1 Create -> Step 2 Review -> Step 3 Publish.
       *
       * The SERVER decides where the account is (src/onboarding.js, itself
       * derived from referrals.activationOf -- the one definition the growth
       * funnel, the nudge emails and DeenAI's next-action card already read).
       * This only shapes it for drawing, so the strip cannot say a different
       * thing from the operator's funnel about the same person.
       *
       * `show` goes false the moment a clip publishes, which is the whole of
       * "disappears after activation": it is DERIVED, not dismissed, so it
       * cannot be waved away before it is true or come back on another device.
       */
      onboarding: (function () {
        var ob = DATA.onboarding || null;
        if (!ob || !ob.show) return { show: false, steps: [], hint: '', at: '' };
        /*
         * DEFER TO THE BANNER. The blocker notice sits directly above this
         * strip and already carries the nasheed and the connection, each with
         * its own button -- so a strip repeating them is the second control
         * for one thing that this whole release exists to remove. It speaks
         * the step's own meaning instead, and drops its button rather than
         * offering a second one going to the same screen.
         *
         * Only while the banner is actually SHOWING: it is dismissible, and
         * once it is gone the prerequisite would otherwise be unspoken
         * anywhere. `blocker`/`blockerScreen`/`blockersOn` are computed above.
         */
        var bannerHas = blockerShowing && (
          (ob.action === 'nasheed' && blockerScreen === 'music')
          || (ob.action === 'connect' && blockerOpensConnections));
        if (bannerHas) {
          ob = Object.assign({}, ob, {
            hint: ob.action === 'nasheed'
              ? 'A nasheed has to be in place before a lecture can finish — the notice above will take you there.'
              : 'Your clip is approved and waiting for somewhere to go — the notice above will connect one.',
            action: '', actionLabel: '',
          });
        }
        /*
         * The server names the ACTION; this only knows how to perform it. Five
         * of them, because the retired five-step checklist's destinations were
         * folded into the three steps and every one of them still has to be
         * reachable -- a step that names a prerequisite and cannot take you to
         * it is worse than the list it replaced.
         */
        var go = function (e) { global.StudioAdapter.goToStep(ob.action, e); };
        // A step that has been passed is still a place to go back to -- the
        // retired checklist's rows were all buttons, and losing that would
        // have made the replacement strictly less useful than the thing it
        // replaced.
        var jump = { create: 'home', review: 'queue', publish: 'schedule' };
        return {
          show: true, at: ob.at, hint: ob.hint || '',
          progress: ob.progress || '',
          // The first-run panel needs both, and neither was carried through
          // at first: `imported` decides whether the full panel or the slim
          // strip is right, and without it an account whose lecture came back
          // EMPTY (still on Create) would be shown the whole beginner's guide
          // a second time. `tokensLeft` is stated beside the field that
          // spends it.
          imported: Boolean(ob.imported),
          tokensLeft: ob.tokensLeft == null ? null : ob.tokensLeft,
          // ONE flag for "this account has never imported anything", read by
          // the desktop panel and the phone card alike, so the two surfaces
          // cannot disagree about who is a beginner.
          firstRun: ob.at === 'create' && !ob.imported,
          beats: [
            { num: '1', title: 'You pick the minutes', note: 'Paste a link, drag the range. Only that stretch is fetched.' },
            { num: '2', title: 'We do the work', note: 'Transcribed, scored, rendered with your Clip Style and a nasheed. About 20 minutes.' },
            { num: '3', title: 'You keep the good ones', note: 'They land in your review queue. Nothing posts until you approve it.' },
          ],
          cost: 'About one token a minute of the stretch you pick, so a five-minute run is roughly five tokens'
            + (ob.tokensLeft != null ? ' of your ' + ob.tokensLeft : '') + '.',
          // The numbers are the design's, not ours: "Step 1 / 2 / 3" is how
          // the ask was phrased and how the strip reads out loud.
          steps: (ob.steps || []).map(function (step, i) {
            return { key: step.key, label: step.label, num: String(i + 1), state: step.state,
              isDone: step.state === 'done', isNow: step.state === 'now',
              open: (function (screen) {
                return function (e) { stop(e); setUI({ screen: screen }); };
              }(jump[step.key] || 'home')) };
          }),
          actionLabel: ob.actionLabel || '', action: go,
        };
      })(),
      libStats: (function () {
        var ready = projects.filter(function (p) { return lecState(p) === 'ready'; });

        // ── which lecture is worth clipping ──
        // Keep rate needs a decided sample: with two clips reviewed, "50%" is
        // one person's shrug wearing a percentage sign. Four is the floor.
        var MIN_DECIDED = 4;
        var rated = ready.map(function (p) {
          var mine = clipsOf(p.id);
          var decided = mine.filter(function (c) { return decision(c) !== null; });
          var kept = decided.filter(function (c) { return decision(c) === 'approved'; }).length;
          return {
            id: p.id,
            name: projectTitle[p.id] || 'Lecture',
            clips: mine.length,
            decided: decided.length,
            kept: kept,
            rate: decided.length ? kept / decided.length : 0,
          };
        }).filter(function (r) { return r.decided >= MIN_DECIDED; })
          .sort(function (a, b) { return b.rate - a.rate; });

        var best = rated.length ? rated[0] : null;
        // The worst is only worth naming when it is genuinely a different
        // answer. One lecture, or two that agree, is not a comparison.
        var worst = rated.length > 1 && rated[rated.length - 1].rate < rated[0].rate
          ? rated[rated.length - 1] : null;

        // ── what a source minute actually buys ──
        // Minutes are what a token pays for, so this is the rate the account is
        // getting -- charged on the range selected, not the whole lecture.
        var minutes = 0;
        projects.forEach(function (p) {
          var span = Number(p.sourceEndSec || 0) - Number(p.sourceStartSec || 0);
          if (!(span > 0)) span = Number(p.sourceDurationSec || 0);
          minutes += Math.max(0, span) / 60;
        });
        minutes = Math.round(minutes);
        var kept = clips.filter(function (c) { return decision(c) === 'approved'; }).length;
        var posted = clips.filter(function (c) { return c.postedAt; }).length;

        // ── where the queue is stuck ──
        var waiting = clips.filter(function (c) { return decision(c) === null && c.status !== 'rendering'; }).length;
        var working = projects.filter(function (p) { return lecState(p) === 'processing'; }).length;
        var failed = projects.filter(function (p) { return p.status === 'failed'; }).length;

        // ── import again ──
        // A URL this account has already imported is cheap to cut again: the
        // box caches the source by URL AND window, so a different stretch of a
        // lecture already fetched costs minutes rather than bandwidth.
        var again = projects.filter(function (p) { return p.url && lecState(p) !== 'processing'; })
          .slice(0, 3)
          .map(function (p) {
            return {
              id: p.id,
              name: projectTitle[p.id] || 'Lecture',
              url: String(p.url),
              length: humanDuration(p.sourceDurationSec || p.durationSec || 0),
            };
          });

        return {
          best: best,
          worst: worst,
          minutes: minutes,
          made: clips.length,
          kept: kept,
          posted: posted,
          waiting: waiting,
          working: working,
          failed: failed,
          // Fully reviewed lectures are the ones whose source is dead weight:
          // every clip decided, nothing left to re-cut from the original.
          settled: ready.filter(function (p) {
            var mine = clipsOf(p.id);
            return mine.length > 0 && mine.every(function (c) { return decision(c) !== null; });
          }).length,
          sourceBytes: Number(storage.sourceBytes || 0),
          again: again,
          empty: !projects.length,
        };
      })(),
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
      // Says how many windows there are and, on Studio, WHY there are that
      // many. "How do I know I get eight?" is not answered by counting the
      // times yourself -- the card has to attribute them to the plan.
      postWindowNote: (studioSlots ? daySlots + ' windows a day on Studio · ' : '')
        + 'Set on the server' + (DATA.timezone ? ' · ' + DATA.timezone : '') + '.',
      postWindow1: postTimes[0] || '—',
      postWindow2: postTimes[1] || '—',
      postWindow3: postTimes.slice(2).join(' · ') || '—',
      dailyLimitNote: (function () {
        // postTimes is the account's OWN list, so this counts what it can
        // really fill. The "four checks" is a different four -- nasheed,
        // captions, Clip Style, render -- and does not move with the plan.
        var slots = daySlots;
        return todayCount >= slots
          ? 'Today is full — ' + slots + ' of ' + slots + '. Nothing posts unless its four checks pass.'
          : todayCount + ' of ' + slots + ' scheduled today. Nothing posts unless its four checks pass.';
      })(),

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
          rowStyle: 'display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-bottom: 1px solid var(--dc-bg-alt, #1A1A1E); cursor: pointer; color: var(--dc-ink-bright, #E9E9ED);',
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
            + (i === tourIndex ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-n-33333a, #33333A)') + '; transition: width .18s ease, background .18s ease;',
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
          + ' border: 1px solid var(--dc-n-2c2c32, #2C2C32); border-radius: 14px;'
          + ' background: linear-gradient(160deg, var(--dc-n-16161a, #16161A), var(--dc-bg-deep, #101013));'
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
      // The three destinations that come off the phone tab bar. Hidden on
      // desktop, where they are already in the rail; a screen you can reach
      // from exactly one place, and that place is off-screen, is not reachable.
      goMusic: function (e) { stop(e); setUI({ screen: 'music', menuOpen: false }); },
      goPerformance: function (e) { stop(e); setUI({ screen: 'performance', menuOpen: false }); },
      // The profile menu's Owner entry opens the tab like the rail does —
      // the /owner page it used to navigate to no longer exists.
      goOwner: function (e) {
        stop(e);
        setUI({ screen: 'owner', menuOpen: false });
        global.StudioAdapter.onLoadOwner(UI.ownerDays || 180);
      },
      isOperatorUser: isOperator(DATA),
      ownerMenuStyle: isOperator(DATA)
        ? 'display: none; align-items: center; gap: 9px; padding: 8px 9px; border-radius: 8px; color: var(--dc-ink-bright, #E9E9ED); font-size: 12.5px;'
        : 'display: none !important;',
      // Straight to the in-app Help screen — it exists now, and a support
      // dialog for "help & guides" answered a different question.
      helpGuides: function (e) { stop(e); setUI({ screen: 'help', menuOpen: false }); },
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
        (!conn ? 'var(--dc-line, #26262A);'
          : !conn.configured ? 'var(--dc-n-3a2a2a, #3A2A2A); background: rgba(10,10,12,.85); color: var(--dc-n-e3928c, #E3928C);'
          : conn.enabled ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: var(--dc-n-7fd1a6, #7FD1A6);'
          : conn.connected ? 'rgba(217,180,120,.4); background: rgba(10,10,12,.85); color: var(--dc-gold-lit, #F0D6A6);'
          : 'var(--dc-n-33333a, #33333A); background: rgba(10,10,12,.85); color: var(--dc-ink-soft, #A2A2AA);'),
      connDotStyle: 'width: 8px; height: 8px; border-radius: 50%; background: ' +
        (!conn ? 'var(--dc-ink-faint, #6E6E76)' : !conn.configured ? 'var(--dc-n-e3928c, #E3928C)' : conn.enabled ? 'var(--dc-n-7fd1a6, #7FD1A6)' : conn.connected ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-ink-faint, #6E6E76)') + ';',
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
      // POST /api/templates has always existed and Studio never called it, so
      // the only way to get a style of your own was to edit a built-in and let
      // the server fork it behind your back under a name it chose. Naming your
      // own work is the difference between a saved style and an accident.
      // The editor's caption panel deliberately carries only per-clip fitting
      // — position, tracking, line height. Colour, outline and font belong to
      // the template, so one clip cannot drift away from its siblings. That is
      // a good rule that read as missing features, because nothing on the
      // screen said where those controls had gone.
      goTemplates: function (e) { stop(e); setUI({ screen: 'templates' }); },
      saveAsStyle: function (e) {
        stop(e);
        if (!activeTemplate) { toast('Pick a style to base it on first.'); return; }
        global.StudioAdapter.onSaveAsStyle(activeTemplate.name || 'My style');
      },
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
          icon: r.icon, label: r.label, note: r.note, on: on,
          trackStyle: 'position: relative; margin-left: auto; width: 34px; height: 19px; flex: none; border-radius: 20px; cursor: pointer; transition: background .16s ease, border-color .16s ease; border: 1px solid ' +
            (on ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.22);' : 'var(--dc-n-33333a, #33333A); background: var(--dc-bg-raised, #17171A);'),
          knobStyle: 'position: absolute; top: 2px; left: ' + (on ? '17px' : '2px') + '; width: 13px; height: 13px; border-radius: 50%; background: ' + (on ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-faint, #6E6E76)') + '; transition: left .16s ease, background .16s ease;',
          toggle: function (e) { stop(e); saveStyle({ voiceEnhance: !on }); },
        };
      }),
      tplDirtyLabel: UI.tplDirty ? 'Unsaved changes' : 'All changes saved',
      tplDirtyDotStyle: 'width: 7px; height: 7px; border-radius: 50%; background: ' + (UI.tplDirty ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-n-7fd1a6, #7FD1A6)') + ';',
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
            (on ? 'rgba(217,180,120,.5); background: rgba(217,180,120,.13); color: var(--dc-gold-lit, #F0D6A6);' : 'var(--dc-line, #26262A); background: var(--dc-bg, #121214); color: var(--dc-ink-soft, #A2A2AA);'),
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
          + ' padding: 2px 8px; border-radius: 999px; background: var(--dc-gold-lit, #F0D6A6); color: #17140E;'
          + ' font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 700;'
          + ' letter-spacing: .02em; white-space: nowrap; box-shadow: 0 2px 10px rgba(0,0,0,.45);'
        : 'display: none;',

      // ── Preview picture ──
      // One photograph for every account (see previewSource above).
      pvSrc: previewSource,
      // Fill crops to the frame. Fit letterboxes onto the template's frame
      // colour. Blur letterboxes the same way over a blown-up blurred copy,
      // which is what the renderer's overlay does.
      //
      // The sample is 9:16 -- the frame's own shape -- so all three land on the
      // same picture here. They are not dead: they act on the imported 16:9
      // lecture, which is not what this frame is showing.
      pvBackStyle: tpl.fitMode === 'blur'
        ? 'position: absolute; inset: 0; z-index: 0; background-image: url("' + cssUrl(previewSource) + '");'
          + ' background-size: cover; background-position: center; filter: blur(18px) saturate(1.2); transform: scale(1.15);'
        : 'display: none;',
      pvImgStyle: 'position: absolute; inset: 0; z-index: 1; background-repeat: no-repeat; background-position: center;'
        + ' background-image: url("' + cssUrl(previewSource) + '");'
        + ' background-size: ' + (tpl.fitMode === 'crop' ? 'cover' : 'contain') + ';'
        + (tpl.fitMode === 'contain' ? ' background-color: ' + (tpl.frameBackground || 'var(--dc-n-000000, #000000)') + ';' : '')
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
      // Hidden when the export would carry no watermark. The mark node is a
      // LITERAL "DEENCLIPPED" in the design export with markStyle its only
      // control, so with no visibility rule this frame drew the watermark for
      // every template whatever the switch said -- including Quran Recitation,
      // which ships watermark:'' and is never allowed to draw over scripture.
      // That is invariant 4 by another door: a preview claiming something the
      // renderer does not do. The editor's own preview (edMarkStyle) has always
      // had this rule; this frame never did.
      markStyle: overlayStyle(tpl.watermarkPosition.indexOf('top') === 0 ? 'top' : 'bottom',
        tpl.watermarkPosition.indexOf('left') > -1 ? 'left' : tpl.watermarkPosition.indexOf('right') > -1 ? 'right' : 'center',
        tpl.watermarkColor, tpl.watermarkFontSize)
        + ' display: ' + (markIsVisible(tpl) ? 'block' : 'none') + ';'
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
      selectStyle: 'appearance: none; padding: 7px 26px 7px 10px; border: 1px solid var(--dc-line, #26262A); border-radius: 8px; background: var(--dc-bg, #121214); color: var(--dc-ink, #F2F2F4); font-family: inherit; font-size: 12.5px; cursor: pointer;',

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
          rowStyle: 'display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; cursor: pointer; color: ' + (on ? 'var(--dc-gold-lit, #F0D6A6)' : 'var(--dc-ink-body, #BCBCC3)') + ';',
          // Inline in the wizard rather than behind a dropdown. As a menu it
          // opened downward out of the panel, overlapping Continue and
          // clipping at the dialog's edge -- and it sat under the length
          // pills as a bare text button, which read as an afterthought
          // rather than the second half of the same question.
          optStyle: wordOption(on, 15),
          boxStyle: 'display: grid; place-items: center; width: 15px; height: 15px; flex: none; border-radius: 4px; border: 1px solid ' +
            (on ? 'var(--dc-gold, #D9B478); background: rgba(217,180,120,.18);' : 'var(--dc-n-33333a, #33333A); background: var(--dc-bg-deepest, #0E0E11);'),
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
          rowStyle: 'display: flex; align-items: center; gap: 11px; padding: 10px 12px; border: 1px solid var(--dc-line-soft, #1E1E22); border-radius: 10px; background: var(--dc-bg, #121214); animation: dcRise .24s cubic-bezier(.2,.8,.2,1) ' + Math.min(i * 0.03, 0.3) + 's both;',
          playStyle: 'display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 50%; border: 1px solid var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A); color: var(--dc-gold-lit, #F0D6A6); cursor: pointer;',
          playIcon: UI.playingTrack === t.id ? 'ph-fill ph-pause' : 'ph-fill ph-play',
          play: function (e) { stop(e); setUI({ playingTrack: UI.playingTrack === t.id ? null : t.id }); global.StudioAdapter.onPlayTrack(t.id); },
          waveStyle: 'flex: 1; height: 22px; border-radius: 4px; background: repeating-linear-gradient(90deg, var(--dc-line, #26262A) 0 2px, transparent 2px 5px);',
          rotStyle: 'display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; cursor: pointer; border: 1px solid rgba(127,209,166,.32); background: rgba(10,10,12,.82); color: var(--dc-n-7fd1a6, #7FD1A6);',
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
          on: UI.perfRange === label,
          label: label,
          style: tabStyle(UI.perfRange === label),
          select: function (e) { stop(e); setUI({ perfRange: label }); },
        };
      }),
      perfTiles: (function () {
        var made = perfClips.length;
        var kept = perfClips.filter(function (c) { return decision(c) === 'approved'; }).length;
        var posted = perfClips.filter(function (c) { return c.postedAt; }).length;
        var refused = perfClips.filter(function (c) { return decision(c) === 'rejected'; }).length;
        var failed = 0;
        perfClips.forEach(function (c) {
          (c.targets || []).forEach(function (t) { if (t.status === 'failed') failed += 1; });
        });
        // Source minutes are what a token buys, so this is the honest cost of
        // the window -- not a guess from clip count.
        var minutes = 0;
        perfProjects.forEach(function (p) {
          var span = Number(p.sourceEndSec || 0) - Number(p.sourceStartSec || 0);
          if (!(span > 0)) span = Number(p.sourceDurationSec || 0);
          minutes += Math.max(0, span) / 60;
        });
        return owKpis([
          owTile('Clips made', String(made), plural(perfProjects.length, 'lecture') + ' in this window', ''),
          owTile('Kept', String(kept), made ? Math.round((kept / made) * 100) + '% of what was made' : 'nothing to review yet', 'pos'),
          owTile('Posted', String(posted), kept ? Math.round((posted / kept) * 100) + '% of what you kept' : 'nothing approved yet', ''),
          // Turning a weak clip down is the review queue working, not a
          // failure, so it is not painted as one.
          owTile('Discarded', String(refused), 'clips you turned down', ''),
          owTile('Failed posts', String(failed), failed ? 'destinations that refused' : 'nothing was refused', failed ? 'neg' : 'pos'),
          owTile('Source minutes', String(Math.round(minutes)), 'what these lectures cost in tokens', ''),
        ]);
      })(),
      // Generated -> kept -> scheduled -> posted, which is the only question a
      // creator can act on today. The old screen ranked by score and then
      // showed three columns of "-" for views, saves and watch time: numbers
      // no platform has ever handed this app.
      perfFunnel: (function () {
        var made = perfClips.length;
        var kept = perfClips.filter(function (c) { return decision(c) === 'approved'; }).length;
        var slotted = perfClips.filter(function (c) { return c.scheduledAt || c.postedAt; }).length;
        var posted = perfClips.filter(function (c) { return c.postedAt; }).length;
        var vStyle = function (colour) {
          return 'font-family: Outfit, Inter, sans-serif; font-size: 25px; font-weight: 600; letter-spacing: -.03em; line-height: 1.05; color: ' + colour + ';';
        };
        var share = function (part, whole) { return whole ? Math.round((part / whole) * 100) + '% of made' : '\u2014'; };
        return [
          { name: 'Made', value: String(made), rate: 'cut from your lectures', notFirst: false, valueStyle: vStyle('var(--dc-ink, #F2F2F4)') },
          { name: 'Kept', value: String(kept), rate: share(kept, made), notFirst: true, valueStyle: vStyle('var(--dc-ink, #F2F2F4)') },
          { name: 'Given a slot', value: String(slotted), rate: share(slotted, made), notFirst: true, valueStyle: vStyle('var(--dc-ink, #F2F2F4)') },
          { name: 'Posted', value: String(posted), rate: share(posted, made), notFirst: true, valueStyle: vStyle('var(--dc-gold-lit, #F0D6A6)') },
        ];
      })(),
      perfFunnelNote: (function () {
        var made = perfClips.length;
        if (!made) return 'Nothing was made in this window, so there is nothing to follow through.';
        var waiting = perfClips.filter(function (c) { return decision(c) === null; }).length;
        return waiting
          ? plural(waiting, 'clip') + ' still waiting on you in the review queue.'
          : 'Every clip in this window has been decided on.';
      })(),
      perfDests: (function () {
        var tally = {};
        perfClips.forEach(function (c) {
          (c.targets || []).forEach(function (t) {
            var key = PLATFORM_NAMES[t.provider] || t.provider || 'Unknown';
            var row = (tally[key] = tally[key] || { posted: 0, failed: 0 });
            if (t.status === 'posted') row.posted += 1;
            else if (t.status === 'failed') row.failed += 1;
          });
        });
        var max = 1;
        Object.keys(tally).forEach(function (k) { if (tally[k].posted + tally[k].failed > max) max = tally[k].posted + tally[k].failed; });
        return Object.keys(tally).sort(function (a, b) {
          return (tally[b].posted + tally[b].failed) - (tally[a].posted + tally[a].failed);
        }).map(function (name) {
          var row = tally[name];
          var total = row.posted + row.failed;
          return {
            name: name,
            value: row.failed ? row.posted + ' \u00b7 ' + row.failed + ' failed' : String(row.posted),
            pct: Math.max(3, Math.round((total / max) * 100)),
            failed: row.failed > 0,
            barStyle: 'position: absolute; inset: 0 auto 0 0; width: ' + Math.max(3, Math.round((total / max) * 100)) + '%; border-radius: 20px; background: '
              + (row.failed ? 'linear-gradient(90deg, #C77E6E, var(--dc-n-e6b770, #E6B770))' : 'linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6))') + ';',
          };
        });
      })(),
      perfDestsEmpty: !perfClips.some(function (c) { return (c.targets || []).length; }),
      perfSlots: (function () {
        // The posting windows this account actually used, by hour, so a slot
        // that never delivers is visible as an empty one.
        var tally = {};
        perfClips.forEach(function (c) {
          if (!c.postedAt) return;
          var hour = new Date(c.postedAt).getHours();
          var key = String(hour).padStart(2, '0') + ':00';
          tally[key] = (tally[key] || 0) + 1;
        });
        var max = 1;
        Object.keys(tally).forEach(function (k) { if (tally[k] > max) max = tally[k]; });
        return Object.keys(tally).sort().map(function (name) {
          return {
            name: name,
            value: String(tally[name]),
            pct: Math.max(3, Math.round((tally[name] / max) * 100)),
            barStyle: 'position: absolute; inset: 0 auto 0 0; width: ' + Math.max(3, Math.round((tally[name] / max) * 100)) + '%; border-radius: 20px; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6));',
          };
        });
      })(),
      perfSlotsEmpty: !perfClips.some(function (c) { return c.postedAt; }),
      perfLectures: (function () {
        var byProject = {};
        perfClips.forEach(function (c) {
          var row = (byProject[c.projectId] = byProject[c.projectId] || { clips: 0, kept: 0, posted: 0, score: 0 });
          row.clips += 1;
          if (decision(c) === 'approved') row.kept += 1;
          if (c.postedAt) row.posted += 1;
          row.score += Number(c.score || 0);
        });
        return Object.keys(byProject).map(function (id) {
          var row = byProject[id];
          return {
            id: id,
            name: projectTitle[id] || 'Lecture',
            clips: String(row.clips),
            kept: String(row.kept),
            posted: String(row.posted),
            score: row.clips ? String(Math.round(row.score / row.clips)) : '\u2014',
            sort: row.clips ? row.score / row.clips : 0,
            open: function (e) { stop(e); setUI({ screen: 'detail', openProject: id }); },
          };
        }).sort(function (a, b) { return b.sort - a.sort; }).slice(0, 8);
      })(),
      perfLecturesEmpty: !perfClips.length,
      perfBoardNote: 'Ranked by the score each clip was cut with.',
      perfBoardEmpty: !perfClips.length,
      perfBoard: perfClips.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 6).map(function (c, i) {
        var st = decision(c);
        var went = (c.targets || []).filter(function (t) { return t.status === 'posted'; })
          .map(function (t) { return PLATFORM_NAMES[t.provider] || t.provider; });
        return {
          rank: String(i + 1),
          caption: c.title || '',
          lecTitle: projectTitle[c.projectId] || '',
          duration: secsToClock((c.durationMs || 0) / 1000),
          // Where it actually went, rather than three columns of platform
          // numbers no platform has ever sent this app.
          where: went.length ? 'on ' + went.join(', ')
            : st === 'approved' ? 'waiting for its slot'
              : st === 'rejected' ? 'discarded' : 'awaiting review',
          state: st === 'approved' ? (c.postedAt ? 'Posted' : 'Approved') : st === 'rejected' ? 'Discarded' : 'In review',
          stateStyle: 'flex: none; padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid '
            + (c.postedAt ? 'rgba(127,209,166,.35); color: var(--dc-n-7fd1a6, #7FD1A6);'
              : st === 'approved' ? 'rgba(217,180,120,.35); color: var(--dc-gold-lit, #F0D6A6);'
                : st === 'rejected' ? 'var(--dc-n-3a2a2a, #3A2A2A); color: var(--dc-n-e3928c, #E3928C);' : 'var(--dc-line, #26262A); color: var(--dc-ink-dim, #8B8B93);'),
          score: String(Math.round(Number(c.score || 0))),
          thumbStyle: 'width: 30px; height: 42px; flex: none; border-radius: 6px; border: 1px solid var(--dc-line, #26262A); background: ' + thumb(c.thumbUrl) + ';',
          more: function (e) { stop(e); global.StudioAdapter.onMoreClips(c.projectId, 4); },
        };
      }),
      perfFootNote: 'Everything here comes from your own account. Platform view counts are not shown because no connected platform sends them to DeenClipped \u2014 an invented number is worse than an absent one.',

      // (owner derivations are hoisted just below; see the owner block)
      // ── Owner ─────────────────────────────────────────────────────────
      // The whole owner surface as a studio screen: sub-tabs are client
      // state, so nothing here ever navigates or reloads. Data arrives from
      // four owner-gated endpoints when the tab opens (the host caches it
      // across state polls); each figure renders "not set" or an empty note
      // rather than a zero nobody entered.
      isOwner: UI.screen === 'owner',
      owSubline: (function () {
        var od = DATA.ownerData;
        if (UI.screen !== 'owner') return '';
        if (!od || !od.finance) return 'Loading the books\u2026';
        return 'Updated ' + new Date(od.finance.generatedAt || Date.now()).toLocaleTimeString()
          + ' \u00b7 window ' + (UI.ownerDays || 180) + ' days';
      })(),
      owBadge: (function () {
        var f = DATA.ownerData && DATA.ownerData.finance;
        if (!f || !f.stripe) return 'Owner';
        return { live: 'Stripe live', test: 'Stripe test mode', none: 'Stripe not configured' }[f.stripe.mode] || 'Stripe';
      })(),
      owBadgeStyle: (function () {
        var f = DATA.ownerData && DATA.ownerData.finance;
        var mode = f && f.stripe ? f.stripe.mode : '';
        return 'padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; border: 1px solid ' +
          (mode === 'live' ? 'rgba(127,209,166,.34); background: rgba(127,209,166,.1); color: var(--dc-n-7fd1a6, #7FD1A6);'
            : mode === 'test' ? 'rgba(230,183,112,.4); background: rgba(230,183,112,.1); color: var(--dc-n-e6b770, #E6B770);'
              : 'var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-dim, #8B8B93);');
      })(),
      owBanner: owNotes.join('  \u00b7  '),
      owBannerShow: owNotes.length > 0,
      // Open tabs: plain text with a gold ink bar under the active one — no
      // pills, no boxes ("tabs that don't look boxy", 28 Aug).
      owTabs: [['overview', 'Overview'], ['traffic', 'Traffic'], ['in', 'Money in'], ['out', 'Money out'], ['users', 'Users'], ['activity', 'Activity'], ['health', 'Health']]
        .map(function (t) {
          var on = (UI.ownerTab || 'overview') === t[0];
          return {
            label: t[1],
            style: 'position: relative; background: none; border: none; padding: 0 0 9px; font-family: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; transition: color .14s ease; ' +
              (on ? 'font-weight: 600; color: var(--dc-gold-lit, #F0D6A6);' : 'font-weight: 500; color: var(--dc-ink-soft, #A2A2AA);'),
            ink: on
              ? 'position: absolute; left: 0; right: 0; bottom: 0; height: 2.5px; border-radius: 3px; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6));'
              : 'display: none;',
            select: function (e) { stop(e); setUI({ ownerTab: t[0], ownerAnimAt: Date.now() }); },
          };
        }),
      owRanges: [30, 90, 180, 365].map(function (d) {
        var on = (UI.ownerDays || 180) === d;
        return {
          label: d + 'd',
          style: 'background: none; border: none; padding: 0; font-family: inherit; font-size: 12px; cursor: pointer; transition: color .14s ease; ' +
            (on ? 'font-weight: 700; color: var(--dc-gold-lit, #F0D6A6);' : 'font-weight: 400; color: var(--dc-ink-faint, #6E6E76);'),
          select: function (e) { stop(e); setUI({ ownerDays: d, ownerAnimAt: Date.now() }); global.StudioAdapter.onLoadOwner(d); },
        };
      }),
      owRefresh: function (e) { stop(e); setUI({ ownerAnimAt: Date.now() }); global.StudioAdapter.onLoadOwner(UI.ownerDays || 180); },
      // Entry animations replay on a tab or range change and then stand down:
      // the studio re-renders wholesale on every state poll, and a screen that
      // re-animated every few seconds would be unbearable. The class is only
      // emitted inside a short window after a deliberate navigation.
      owAnimClass: (Date.now() - (UI.ownerAnimAt || 0) < 900) ? 'dcow-rise' : '',
      owShowOverview: (UI.ownerTab || 'overview') === 'overview',
      owShowTraffic: UI.ownerTab === 'traffic',
      owShowIn: UI.ownerTab === 'in',
      owShowOut: UI.ownerTab === 'out',
      owShowUsers: UI.ownerTab === 'users',
      owShowActivity: UI.ownerTab === 'activity',
      owShowHealth: UI.ownerTab === 'health',

      owTiles: owKpis(owFinance ? [
        owTile('MRR', owFinance.moneyIn.mrrMinor ? owMoney(owFinance.moneyIn.mrrMinor) : 'none active',
          owFinance.moneyIn.activeSubscriptions ? plural(owFinance.moneyIn.activeSubscriptions, 'active subscription') : 'No active Stripe subscriptions',
          owFinance.moneyIn.mrrMinor ? 'pos' : 'unknown'),
        owTile('Net in, this month', owMoney(owFinance.moneyIn.thisMonthNetMinor), owMoney(owFinance.moneyIn.thisMonthGrossMinor) + ' gross, after Stripe fees', ''),
        owTile('Monthly out', owMoney(owFinance.moneyOut.totalMonthlyOutMinor) + (owBurnKnown ? '' : '+'),
          owMoney(owFinance.moneyOut.monthlyBurnMinor) + ' subscriptions + ' + owMoney(owFinance.moneyOut.oneOff && owFinance.moneyOut.oneOff.monthlyAverageMinor || 0) + ' usage'
            + (owBurnKnown ? '' : ' \u00b7 ' + owFinance.moneyOut.unpricedCount + ' still need an amount'),
          owBurnKnown ? '' : 'unknown'),
        owTile('Profit, this month', owMoney(owFinance.profit.monthlyNetMinor),
          owBurnKnown ? (owFinance.profit.marginPercent === null ? 'No revenue this month' : owFinance.profit.marginPercent + '% margin') : 'Understated \u2014 costs are missing amounts',
          owFinance.profit.monthlyNetMinor > 0 ? 'pos' : owFinance.profit.monthlyNetMinor < 0 ? 'neg' : ''),
        owTile('Accounts', String(owAnalytics ? owAnalytics.overview.users : '\u2014'),
          owAnalytics ? owAnalytics.overview.newUsers30d + ' new in 30d \u00b7 ' + owAnalytics.overview.activeUsers7d + ' active in 7d' : 'Loading\u2026', ''),
        owTile('Paying accounts', String(owAnalytics ? owAnalytics.overview.paidUsers : '\u2014'),
          owAnalytics ? owAnalytics.overview.freeUsers + ' free \u00b7 ' + owAnalytics.overview.trialUsers + ' trialing' : 'Loading\u2026',
          owAnalytics && owAnalytics.overview.paidUsers > 0 ? 'pos' : 'unknown'),
      ] : []),
      owMonths: (function () {
        if (!owFinance) return [];
        var months = owFinance.months || [];
        var burn = owFinance.moneyOut.monthlyBurnMinor || 0;
        var peak = Math.max(1, burn);
        months.forEach(function (m) { if (m.netMinor > peak) peak = m.netMinor; });
        return months.map(function (m) {
          var inH = Math.max(2, Math.round(Math.max(0, m.netMinor) / peak * 124));
          var outH = Math.max(2, Math.round(burn / peak * 124));
          var monthLabel = m.month.slice(5);
          return {
            label: monthLabel,
            tip: m.month + ': ' + owMoney(m.netMinor) + ' net in; current burn ' + owMoney(burn),
            inStyle: 'display: block; width: 14px; height: ' + inH + 'px; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, var(--dc-gold-lit, #F0D6A6), var(--dc-gold, #D9B478));',
            outStyle: 'display: block; width: 14px; height: ' + outH + 'px; border-radius: 3px 3px 0 0; background: var(--dc-n-3a3a42, #3A3A42);',
          };
        });
      })(),
      owChartNote: 'Gold is net in per month. Grey is TODAY\u2019S burn repeated \u2014 historic burn was never recorded, and drawing it as history would be a lie in a chart.',
      owUpcoming: (owFinance && owFinance.moneyOut.dueNext60Days || []).map(function (item) {
        return {
          name: item.name, vendor: item.vendor || '',
          whenLabel: owRelDays(item.daysAway),
          whenStyle: owPill(item.daysAway < 0 ? 'bad' : item.daysAway <= 7 ? 'warn' : 'good'),
          dateLabel: owDate(item.dueAt),
          amount: item.needsAmount ? 'not set' : owMoney(item.amountMinor, item.currency),
        };
      }),
      owUpcomingEmpty: !owFinance || (owFinance.moneyOut.dueNext60Days || []).length === 0,
      owUpcomingTotal: owFinance && (owFinance.moneyOut.dueNext60Days || []).length
        ? owMoney(owFinance.moneyOut.dueNext60DaysTotalMinor) + ' due across the next 60 days.' : '',

      owInTiles: owKpis(owFinance ? [
        owTile('Gross in', owMoney(owFinance.moneyIn.grossMinor), 'over the last ' + owFinance.moneyIn.windowDays + ' days', ''),
        owTile('Stripe fees', owMoney(owFinance.moneyIn.feeMinor),
          owFinance.moneyIn.grossMinor ? Math.round(owFinance.moneyIn.feeMinor / owFinance.moneyIn.grossMinor * 1000) / 10 + '% of gross' : '',
          owFinance.moneyIn.feeMinor ? 'neg' : ''),
        owTile('Net in', owMoney(owFinance.moneyIn.netMinor), 'What actually landed', owFinance.moneyIn.netMinor ? 'pos' : ''),
        owTile('Refunded', owMoney(owFinance.moneyIn.refundMinor), '', owFinance.moneyIn.refundMinor ? 'neg' : ''),
        owTile('MRR', owFinance.moneyIn.mrrMinor ? owMoney(owFinance.moneyIn.mrrMinor) : 'none', 'From active subscriptions', owFinance.moneyIn.mrrMinor ? 'pos' : 'unknown'),
        owTile('ARR', owFinance.moneyIn.arrMinor ? owMoney(owFinance.moneyIn.arrMinor) : 'none', 'MRR \u00d7 12', owFinance.moneyIn.arrMinor ? 'pos' : 'unknown'),
      ] : []),
      owInMonths: (owFinance && owFinance.months || []).map(function (m) {
        return { month: m.month, gross: owMoney(m.grossMinor), fees: owMoney(m.feeMinor), net: owMoney(m.netMinor),
          refunds: m.refundMinor ? owMoney(m.refundMinor) : '\u2014', count: String(m.count || 0) };
      }),
      owInMonthsEmpty: !owFinance || (owFinance.months || []).length === 0,
      owInSource: owFinance ? (owFinance.moneyIn.source === 'stripe'
        ? 'Read live from Stripe balance transactions, so fees are real.'
        : 'Stripe could not be read, so these are the ' + (owFinance.moneyIn.localEventCount || 0) + ' payments recorded locally \u2014 fees are not known on this path.') : '',
      owInPlans: owBars(owFinance && owFinance.moneyIn.planCounts, function (v) { return v + ' active'; }),
      owInPlansEmpty: !owFinance || Object.keys(owFinance.moneyIn.planCounts || {}).length === 0,
      owInRecent: (owFinance && owFinance.recentRevenue || []).map(function (ev) {
        return { date: owDate(ev.createdAt),
          kindLabel: ev.kind, kindStyle: owPill(ev.kind === 'topup' ? 'gold' : 'good'),
          desc: ev.description || '\u2014', amount: owMoney(ev.amountMinor, ev.currency) };
      }),
      owInRecentEmpty: !owFinance || (owFinance.recentRevenue || []).length === 0,

      owOutTiles: owKpis(owFinance ? [
        owTile('Subscriptions', owMoney(owFinance.moneyOut.monthlyBurnMinor),
          owFinance.moneyOut.unpricedCount ? 'Understated: ' + owFinance.moneyOut.unpricedCount + ' without an amount' : 'Per month, all priced',
          owFinance.moneyOut.unpricedCount ? 'unknown' : ''),
        owTile('Usage and one-offs', owMoney(owFinance.moneyOut.oneOff && owFinance.moneyOut.oneOff.monthlyAverageMinor || 0),
          'Averaged from what was actually paid', ''),
        owTile('Total out, per month', owMoney(owFinance.moneyOut.totalMonthlyOutMinor), 'What profit is measured against', ''),
        owTile('Due in 60 days', owMoney(owFinance.moneyOut.dueNext60DaysTotalMinor), (owFinance.moneyOut.dueNext60Days || []).length + ' payment(s) scheduled', ''),
        owTile('Tracked costs', String(owFinance.moneyOut.entries || 0), 'Active entries in the ledger', ''),
      ] : []),
      owOutNote: owFinance ? (owFinance.moneyOut.unpricedCount
        ? (owFinance.moneyOut.unpricedNames || []).join(', ') + ' \u2014 tracked but with no amount, because a guessed hosting bill would make the profit figure fiction. Set them once and every total becomes real.'
        : 'Every active cost has an amount, so burn and profit are complete.') : '',
      owAddCost: function (e) { stop(e); setUI({ owEditor: owBlankCost() }); },
      owEditorOpen: Boolean(UI.owEditor),
      owEditorTitle: UI.owEditor && UI.owEditor.id ? 'Edit cost' : 'Add a cost',
      owCostName: UI.owEditor ? UI.owEditor.name : '',
      setOwCostName: owEditorSet('name'),
      owCostVendor: UI.owEditor ? UI.owEditor.vendor : '',
      setOwCostVendor: owEditorSet('vendor'),
      owCostAmount: UI.owEditor ? UI.owEditor.amount : '',
      setOwCostAmount: owEditorSet('amount'),
      owCostCurrency: UI.owEditor ? UI.owEditor.currency : '',
      setOwCostCurrency: owEditorSet('currency'),
      owCostDue: UI.owEditor ? UI.owEditor.due : '',
      setOwCostDue: owEditorSet('due'),
      owCostNotes: UI.owEditor ? UI.owEditor.notes : '',
      setOwCostNotes: owEditorSet('notes'),
      owCadences: ['weekly', 'monthly', 'quarterly', 'yearly', 'once'].map(function (c) {
        return { label: c, style: pickerStyle(UI.owEditor && UI.owEditor.cadence === c),
          select: function (e) { stop(e); owEditorPatch({ cadence: c }); } };
      }),
      owCategories: ['hosting', 'storage', 'domain', 'ai', 'tooling', 'marketing', 'other'].map(function (c) {
        return { label: c, style: pickerStyle(UI.owEditor && UI.owEditor.category === c),
          select: function (e) { stop(e); owEditorPatch({ category: c }); } };
      }),
      owToggleActive: function (e) { stop(e); owEditorPatch({ active: !(UI.owEditor && UI.owEditor.active) }); },
      owActiveLabel: UI.owEditor && UI.owEditor.active ? 'Active' : 'Paused',
      owActiveStyle: pickerStyle(Boolean(UI.owEditor && UI.owEditor.active)),
      owEditorError: UI.owEditor && UI.owEditor.error || '',
      owEditorErrorShow: Boolean(UI.owEditor && UI.owEditor.error),
      owSaveCost: function (e) {
        stop(e);
        var d = UI.owEditor;
        if (!d) return;
        if (!String(d.name || '').trim()) { owEditorPatch({ error: 'A cost needs a name.' }); return; }
        global.StudioAdapter.onSaveOwnerCost({
          id: d.id || undefined, name: d.name, vendor: d.vendor,
          amount: Number(d.amount || 0), currency: d.currency || 'aud',
          cadence: d.cadence, category: d.category,
          // Parsed as UTC midday, so a date typed in Australia does not land
          // on the previous day for the server.
          nextDueAt: d.due ? Date.parse(d.due + 'T12:00:00Z') : null,
          notes: d.notes, active: d.active,
        });
      },
      owCancelCost: function (e) { stop(e); setUI({ owEditor: null }); },
      owDeleteCost: function (e) {
        stop(e);
        if (UI.owEditor && UI.owEditor.id) global.StudioAdapter.onDeleteOwnerCost(UI.owEditor.id);
      },
      owDeleteStyle: UI.owEditor && UI.owEditor.id
        ? 'margin-left: auto; padding: 8px 12px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid rgba(226,122,122,.34); background: rgba(226,122,122,.08); color: var(--dc-n-e27a7a, #E27A7A);'
        : 'display: none;',
      owCosts: (owFinance && owFinance.costs || []).map(function (cost) {
        return {
          name: cost.name, notes: cost.notes || '', vendor: cost.vendor || '\u2014',
          category: cost.category, cadence: cost.cadence,
          amountText: cost.needsAmount ? 'not set' : owMoney(cost.amountMinor, cost.currency),
          amountStyle: cost.needsAmount ? owPill('warn') : 'font-variant-numeric: tabular-nums; color: var(--dc-ink, #F2F2F4);',
          perMonth: cost.monthlyMinor ? owMoney(cost.monthlyMinor, cost.currency) : '\u2014',
          dueText: cost.nextDueAt ? owDate(cost.nextDueAt) : 'no date',
          dueStyle: cost.nextDueAt ? 'color: var(--dc-ink-body, #BCBCC3);' : owPill('warn'),
          edit: function (e) {
            stop(e);
            setUI({ owEditor: {
              id: cost.id, name: cost.name, vendor: cost.vendor || '',
              amount: cost.amountMinor ? (cost.amountMinor / 100).toFixed(2) : '',
              currency: cost.currency || 'aud', cadence: cost.cadence, category: cost.category,
              due: cost.nextDueAt ? new Date(cost.nextDueAt).toISOString().slice(0, 10) : '',
              notes: cost.notes || '', active: cost.active !== false, error: '',
            } });
          },
        };
      }),
      owCostsEmpty: !owFinance || (owFinance.costs || []).length === 0,
      owSpend: (owFinance && owFinance.moneyOut.oneOff && owFinance.moneyOut.oneOff.rows || []).slice(0, 60).map(function (item) {
        return { paid: owDate(item.paidAt), name: item.name, notes: item.notes || '',
          source: item.source || '', amount: owMoney(item.amountMinor, item.currency) };
      }),
      owSpendEmpty: !owFinance || !(owFinance.moneyOut.oneOff && (owFinance.moneyOut.oneOff.rows || []).length),
      owSpendHint: (function () {
        var oneOff = owFinance && owFinance.moneyOut.oneOff;
        if (!oneOff || !(oneOff.rows || []).length) return '';
        return owMoney(oneOff.totalMinor) + ' across ' + (oneOff.coveredDays || 0) + ' days of payments \u2014 about ' + owMoney(oneOff.monthlyAverageMinor) + ' a month, from what was actually paid.';
      })(),
      owCats: owBars(owFinance && owFinance.moneyOut.byCategory, function (v) { return owMoney(v); }),
      owCatsEmpty: !owFinance || Object.keys(owFinance.moneyOut.byCategory || {}).filter(function (k) { return owFinance.moneyOut.byCategory[k] > 0; }).length === 0,

      owUserTiles: owKpis(owAnalytics ? [
        owTile('Total accounts', String(owAnalytics.overview.users), '', ''),
        owTile('Active, 7 days', String(owAnalytics.overview.activeUsers7d), owAnalytics.overview.newUsers30d + ' joined in 30 days', ''),
        owTile('Projects', String(owAnalytics.overview.projects), owAnalytics.overview.processingProjects + ' processing \u00b7 ' + owAnalytics.overview.failedProjects + ' failed', ''),
        owTile('Clips', String(owAnalytics.overview.clips), owAnalytics.overview.postedClips + ' posted \u00b7 ' + owAnalytics.overview.readyClips + ' ready', ''),
        owTile('Tokens used, 30d', String(owAnalytics.overview.tokensUsed30d), owAnalytics.overview.tokensSold30d + ' sold', ''),
        owTile('Unspent top-ups', String(owAnalytics.overview.purchasedTopupBalance), 'Paid for and not yet used', ''),
      ] : []),
      owUserFilterVal: UI.ownerUserFilter || '',
      setOwUserFilter: function (e) { UI.ownerUserFilter = e.target.value; refresh(); },
      owUsers: (function () {
        if (!owAnalytics) return [];
        var filter = String(UI.ownerUserFilter || '').trim().toLowerCase();
        return (owAnalytics.users || []).filter(function (u) {
          return !filter || (u.name + ' ' + u.email + ' ' + u.plan + ' ' + u.role).toLowerCase().indexOf(filter) !== -1;
        }).map(function (u) {
          return {
            name: u.name, email: u.email || 'no email',
            planLabel: u.plan,
            planStyle: owPill(['weekly', 'monthly', 'yearly'].indexOf(u.plan) !== -1 ? 'good' : u.plan === 'admin' ? 'gold' : ''),
            status: u.billingStatus || '',
            left: u.remainingTokens === null ? 'unlimited' : String(u.remainingTokens),
            used: String(u.tokensUsed || 0), projects: String(u.projects || 0),
            clips: String(u.clips || 0), posted: String(u.posted || 0),
            lastSeen: owDate(u.lastLoginAt), providers: (u.providers || []).join(', ') || '\u2014',
          };
        });
      })(),
      owUsersEmpty: !owAnalytics || (owAnalytics.users || []).length === 0,

      owActivity: (owAnalytics && owAnalytics.recentActivity || []).map(function (ev) {
        return { when: owDate(ev.createdAt), typeLabel: ev.type,
          typeStyle: owPill(ev.type === 'tokens_added' ? 'good' : ''),
          tokens: String(ev.amount || 0), detail: ev.message || '\u2014' };
      }),
      owActivityEmpty: !owAnalytics || (owAnalytics.recentActivity || []).length === 0,
      owSocial: owBars(owAnalytics && owAnalytics.social, function (v) { return v + ' account(s)'; }),
      owSocialEmpty: !owAnalytics || Object.keys(owAnalytics.social || {}).length === 0,

      owHealthTiles: owKpis((function () {
        var h = DATA.ownerData && DATA.ownerData.health;
        if (!h) return [owTile('Pipeline', 'Loading\u2026', 'Asking the worker', '')];
        if (h.error) return [owTile('Pipeline', 'Unreachable', String(h.error).slice(0, 60), 'neg')];
        var totals = h.totals || {}; var worker = h.worker || {};
        return [
          owTile('Jobs finished', String((totals.completed || 0) + (totals.failed || 0)), 'last ' + h.days + ' days', ''),
          owTile('Failed', String(totals.failed || 0), (totals.failureRate || 0) + '% of finished jobs', totals.failed ? 'neg' : ''),
          owTile('Worker', worker.error ? 'Unreachable' : 'Reachable',
            worker.error ? String(worker.error).slice(0, 60) : 'answered its health check', worker.error ? 'neg' : 'pos'),
          // The one number that has cost this project weeks: which release the
          // box is actually running. A worker behind the app means every
          // worker change since then -- captions, language detection, the
          // section downloads -- is committed, green, pushed and NOT live.
          owTile('Deployed', (h.deploy && h.deploy.workerVersion) ? 'v' + h.deploy.workerVersion : 'Unknown',
            (h.deploy && h.deploy.note) || 'The box has not reported a version.',
            (h.deploy && h.deploy.behind === false) ? 'pos' : 'neg'),
        ];
      })()),
      owHealthCodes: (function () {
        var h = DATA.ownerData && DATA.ownerData.health;
        return (h && h.topFailures || []).map(function (row) {
          return { code: row.code, codeStyle: owPill('bad'), times: String(row.count || 0), sample: row.sample || '\u2014' };
        });
      })(),
      owHealthCodesEmpty: !(DATA.ownerData && DATA.ownerData.health && (DATA.ownerData.health.topFailures || []).length),
      owHealthProviders: (function () {
        var h = DATA.ownerData && DATA.ownerData.health;
        var providers = h && h.importProviders || {};
        return Object.keys(providers).sort(function (a, b) { return providers[b] - providers[a]; })
          .map(function (name) { return { name: name, count: String(providers[name]) }; });
      })(),
      owHealthProvidersEmpty: !(DATA.ownerData && DATA.ownerData.health && Object.keys(DATA.ownerData.health.importProviders || {}).length),
      owHealthRecent: (function () {
        var h = DATA.ownerData && DATA.ownerData.health;
        return (h && h.recent || []).map(function (row) {
          return { when: row.at ? owDate(row.at) : '\u2014', title: row.title || row.id || '\u2014',
            code: row.code, codeStyle: owPill('bad'), message: row.error || '\u2014' };
        });
      })(),
      owHealthRecentEmpty: !(DATA.ownerData && DATA.ownerData.health && (DATA.ownerData.health.recent || []).length),

      // Every tile is a dropdown. Six slots, twelve things worth watching:
      // pick per slot rather than putting twelve boxes on screen, which is
      // what "so it doesnt look clouded" asked for.
      anaMetricOptions: ANA_METRICS.map(function (m) { return { key: m.key, label: m.label }; }),
      anaTiles: (function () {
        var ana = DATA.webmetrics;
        if (!ana) return [];
        var chosen = anaTilePicks();
        return owKpis(chosen.map(function (key, index) {
          var metric = anaMetric(key, ana);
          var tile = owTile(metric.label, metric.value, metric.note, metric.tone);
          tile.metric = metric.key;
          tile.choose = function (event) {
            var value = event && event.target ? event.target.value : '';
            var next = anaTilePicks().slice();
            next[index] = value;
            setUI({ anaTiles: next, ownerAnimAt: Date.now() });
          };
          return tile;
        }));
      })(),
      anaGrainLabel: (UI.anaGrain === 'hour' ? 'Visitors by hour' : 'Visitors by day'),
      anaGrains: ['day', 'hour'].map(function (grain) {
        var on = (UI.anaGrain === 'hour' ? 'hour' : 'day') === grain;
        return {
          label: grain === 'hour' ? 'By hour' : 'By day',
          style: 'background: none; border: 0; padding: 0; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; color: '
            + (on ? 'var(--dc-gold-lit, #F0D6A6);' : 'var(--dc-ink-faint, #6E6E76);'),
          select: function (e) { stop(e); setUI({ anaGrain: grain, ownerAnimAt: Date.now() }); },
        };
      }),
      anaLiveShow: Boolean(UI.screen === 'owner' && UI.ownerTab === 'traffic' && DATA.webmetrics),
      anaLiveLabel: (DATA.webmetrics && DATA.webmetrics.liveNow || 0) + ' live right now',
      anaFunnel: (function () {
        var ana = DATA.webmetrics;
        if (!ana) return [];
        var t = ana.totals || {}; var r = ana.rates || {};
        var pct = function (v) { return v === null || v === undefined ? '\u2014' : v + '%'; };
        // A funnel step can legitimately exceed 100%: checkout_started is not
        // gated on signing up IN THIS WINDOW, so someone who signed up last
        // month and checks out today counts in the numerator and not the
        // denominator. "6000% of signups" is arithmetically true and reads as
        // broken, so past 100 the step says what happened instead.
        var step = function (v, normal, over) {
          if (v === null || v === undefined) return '\u2014';
          return v > 100 ? over : v + '% ' + normal;
        };
        var vStyle = function (colour) {
          return 'font-family: Outfit, Inter, sans-serif; font-size: 25px; font-weight: 600; letter-spacing: -.03em; line-height: 1.05; color: ' + colour + ';';
        };
        return [
          { name: 'Visited', value: String(t.uniques || 0), rate: 'visitors, counted once a day', notFirst: false, valueStyle: vStyle('var(--dc-ink, #F2F2F4)') },
          { name: 'Signed up', value: String(t.signups || 0), rate: step(r.visitToSignup, 'of visitors', 'more signups than visitors counted'), notFirst: true, valueStyle: vStyle('var(--dc-ink, #F2F2F4)') },
          { name: 'Started checkout', value: String(t.checkoutsStarted || 0), rate: step(r.signupToCheckout, 'of signups', 'more checkouts than signups this window'), notFirst: true, valueStyle: vStyle('var(--dc-ink, #F2F2F4)') },
          { name: 'Paid', value: String(t.paidConversions || 0), rate: step(r.visitToPaid, 'of visitors', 'more paid than visitors counted'), notFirst: true, valueStyle: vStyle('var(--dc-gold-lit, #F0D6A6)') },
        ];
      })(),
      anaChannels: (function () {
        var ch = DATA.webmetrics && DATA.webmetrics.channels;
        if (!ch) return [];
        return owBars({ Search: ch.search, Social: ch.social, Direct: ch.direct, Referral: ch.referral },
          function (v) { return String(v); });
      })(),
      anaChannelsEmpty: (function () {
        var ch = DATA.webmetrics && DATA.webmetrics.channels;
        return !ch || (ch.search + ch.social + ch.direct + ch.referral) === 0;
      })(),
      anaCampaigns: topPairs(DATA.webmetrics && DATA.webmetrics.campaigns),
      anaCampaignsEmpty: topPairs(DATA.webmetrics && DATA.webmetrics.campaigns).length === 0,
      anaDevices: owBars(DATA.webmetrics && DATA.webmetrics.devices, function (v) { return String(v); }),
      anaDevicesEmpty: Object.keys(DATA.webmetrics && DATA.webmetrics.devices || {}).length === 0,
      anaLanguages: owBars(DATA.webmetrics && DATA.webmetrics.languages, function (v) { return String(v); }),
      anaLanguagesEmpty: Object.keys(DATA.webmetrics && DATA.webmetrics.languages || {}).length === 0,
      anaMissing: topPairs(DATA.webmetrics && DATA.webmetrics.missing),
      anaMissingEmpty: topPairs(DATA.webmetrics && DATA.webmetrics.missing).length === 0,
      anaBotsNote: (function () {
        var bots = DATA.webmetrics && DATA.webmetrics.botHits || 0;
        return bots ? bots + ' crawler hit' + (bots === 1 ? '' : 's') + ' filtered out of every number here.' : '';
      })(),
      anaBars: (function () {
        var ana = DATA.webmetrics;
        // By hour reads the same series a different way: 48 columns of two
        // numbers each, so "when do people actually turn up" is answerable
        // without exporting anything.
        var byHour = UI.anaGrain === 'hour';
        var rows = (ana && (byHour ? ana.hourly : ana.days)) || [];
        var max = 1;
        rows.forEach(function (d) { if (d.views > max) max = d.views; });
        return rows.map(function (d) {
          var h = Math.max(d.views ? 4 : 2, Math.round((d.views / max) * 100));
          var when = byHour ? (d.day + ' ' + d.hour + ' UTC') : d.day;
          return {
            tip: when + ': ' + d.views + ' view' + (d.views === 1 ? '' : 's') + ', ' + d.uniques + ' unique',
            style: 'flex: 1; min-width: 2px; height: ' + h + '%; border-radius: 3px 3px 0 0; background: ' +
              (d.views ? 'linear-gradient(180deg, var(--dc-gold-lit, #F0D6A6), var(--dc-gold, #D9B478))' : 'var(--dc-line-soft, #1E1E22)') + ';',
          };
        });
      })(),
      anaBarsNote: (function () {
        var ana = DATA.webmetrics;
        if (!ana) return '';
        return ana.captureSince
          ? 'Page views count from ' + ana.captureSince + '. Signups, revenue and posts include earlier history \u2014 they come from the app\u2019s own records.'
          : 'No page views recorded yet \u2014 they start counting from the first visit after this deploy.';
      })(),
      anaPages: topPairs(DATA.webmetrics && DATA.webmetrics.byPath),
      anaPagesEmpty: topPairs(DATA.webmetrics && DATA.webmetrics.byPath).length === 0,
      anaReferrers: topPairs(DATA.webmetrics && DATA.webmetrics.referrers),
      anaReferrersEmpty: topPairs(DATA.webmetrics && DATA.webmetrics.referrers).length === 0,
      anaUtm: topPairs(DATA.webmetrics && DATA.webmetrics.utm),
      anaUtmEmpty: topPairs(DATA.webmetrics && DATA.webmetrics.utm).length === 0,
      // Search-visibility data is NOT here, and the note says so rather than
      // leaving a gap that reads as zero traffic. Impressions, queries and
      // average position live in Google Search Console; nothing in this app
      // has an API connection to it, and inventing those numbers would make
      // every other figure on this screen suspect.
      // The four words, stated in the note this screen already renders rather
      // than in a new element -- the Owner markup lives in the design export,
      // so a new node there would mean a re-import and every hashed class name
      // in the app regenerating. Each tile also carries its own one-line
      // definition, which is where the confusion actually happens.
      anaFootnote: 'Visits are every page opened. Visitors are devices, counted once a day \u2014 so somebody here on three '
        + 'days counts three times. First-time means this browser had never opened the site before; returning means it had. '
        + 'Each visitor is one daily-rotating hash \u2014 no addresses stored, nothing sent anywhere \u2014 which is '
        + 'why a visitor cannot be recognised across days and only the browser\u2019s own flag can tell first-time from returning. '
        + 'Search impressions, queries and ranking positions are not here: they come from Google Search Console, '
        + 'which this app is not connected to. Public pages in the sitemap: ' + (DATA.webmetrics && DATA.webmetrics.publicPages || '\u2014') + '.',

      // ── Tokens & billing ──
      // The period tabs filter the real plan list by its own `interval`, so the
      // prices and token counts change with the period instead of the tabs
      // merely highlighting.
      // The period tabs are gone. They read as a filter and behaved as one:
      // planCards was filtered by the selected interval, so a customer could
      // only ever see ONE paid plan and had nothing to compare it against.
      // Every plan is on screen now and each card states its own interval.
      //
      // What replaces them is the thing that was actually missing -- somewhere
      // to see and control the subscription. Changing plan, cancelling and
      // updating a card all live in Stripe's portal; the screen said so only
      // in a "Change" link beside a card number at the very bottom.
      planTitle: (function () {
        if (current.unlimited) return 'Owner';
        var named = currentPlanRecord();
        return (named && named.name) || 'Basic';
      })(),
      planPriceLine: (function () {
        if (current.unlimited) return 'no limit, no renewal';
        var named = currentPlanRecord();
        if (!named || named.id === 'free') return 'no charge';
        return (named.priceLabel || '') + (named.interval ? ' per ' + named.interval : '');
      })(),
      planState: planStateWord,
      planStateStyle: 'padding: 2px 9px; border-radius: 20px; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; border: 1px solid ' +
        (planStateTone === 'bad' ? 'rgba(224,135,112,.4); background: rgba(224,135,112,.12); color: #E08770;'
          : planStateTone === 'warn' ? 'rgba(230,183,112,.4); background: rgba(230,183,112,.12); color: var(--dc-n-e6b770, #E6B770);'
            : 'rgba(127,209,166,.34); background: rgba(127,209,166,.12); color: var(--dc-n-7fd1a6, #7FD1A6);'),
      // A real fraction. The design shipped this bar as a hoisted class with a
      // literal width: 41%, so every customer saw the same gauge no matter how
      // many tokens they had left -- an invented number on the one screen where
      // numbers are the whole point.
      tokenBarStyle: 'position: absolute; inset: 0 auto 0 0; border-radius: 20px; background: linear-gradient(90deg, var(--dc-gold, #D9B478), var(--dc-gold-lit, #F0D6A6)); width: ' +
        (current.unlimited || !current.allowance
          ? '100%'
          : Math.max(2, Math.min(100, Math.round((Number(current.remaining) || 0) / Number(current.allowance) * 100))) + '%'),
      manageLabel: current.stripeSubscriptionId ? 'Change or cancel plan' : 'Manage billing',
      manageStyle: 'display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 9px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid rgba(217,180,120,.42); background: rgba(217,180,120,.14); color: var(--dc-gold-lit, #F0D6A6);',
      billingGhostStyle: 'display: inline-flex; align-items: center; gap: 7px; padding: 9px 13px; border-radius: 9px; font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; border: 1px solid var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-body, #BCBCC3);',
      cardLabel: 'Payment method',
      manageBilling: function (e) { stop(e); global.StudioAdapter.onBillingPortal(); },
      resumeSub: function (e) { stop(e); global.StudioAdapter.onResumeSubscription(); },
      resumeShow: Boolean(current.cancelAtPeriodEnd),
      resumeSubStyle: current.cancelAtPeriodEnd
        ? 'display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 9px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid rgba(127,209,166,.4); background: rgba(127,209,166,.12); color: var(--dc-n-7fd1a6, #7FD1A6);'
        // Not drawn at all when nothing is winding down (invariant 8).
        : 'display: none;',
      manageHint: current.stripeSubscriptionId
        ? 'Changing plan, cancelling and card details all open your secure Stripe billing page.'
        : 'Opens your secure Stripe billing page. Nothing is charged from here.',
      // ── the pricing grid ──
      // Three TIERS across, one billing period at a time. It used to be a flat
      // list of every plan, which with two paid tiers would be seven cards in a
      // row and no way to see that Pro and Studio are the same product at
      // different heights. The period is a toggle above the grid, so a customer
      // compares tiers at one price basis instead of comparing a weekly card
      // with a yearly one.
      billingPeriods: BILLING_PERIODS.map(function (period) {
        var on = period.id === billingPeriod;
        return {
          key: period.id, on: on,
          label: period.label,
          select: function (e) {
            stop(e);
            // The period we are LEAVING. Everything below slides from it:
            // the pill from where it was, the prices from the side the
            // switch travelled.
            setUI({ billingPeriod: period.id, billingFrom: billingPeriod, tokensAnimAt: Date.now() });
          },
          // No background of its own: the pill behind them carries the
          // highlight, which is what lets it slide between the three.
          style: 'position: relative; z-index: 1; width: 78px; padding: 6px 0; border: 0; border-radius: 20px; background: transparent; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: color .16s ease; color: '
            + (on ? 'var(--dc-gold-lit, #F0D6A6);' : 'var(--dc-ink-dim, #8B8B93);'),
        };
      }),
      periodNote: billingPeriod === 'yearly' ? 'Two months free on every yearly plan' : '',
      // The highlight is its own element so it can travel. A CSS transition
      // would not fire: the studio re-renders through innerHTML, so this node
      // is BRAND NEW every time and has no previous position to move from.
      // An animation does fire on a fresh node, so the distance it came from
      // travels with it as a custom property.
      periodPillStyle: (function () {
        var STEP = 80; // 78px button + the 2px gap
        var to = periodIndex(billingPeriod);
        var from = periodIndex(UI.billingFrom);
        var moved = UI.billingFrom && UI.billingFrom !== billingPeriod && (Date.now() - (UI.tokensAnimAt || 0) < 900);
        return 'position: absolute; top: 3px; left: ' + (3 + to * STEP) + 'px; width: 78px; height: calc(100% - 6px); '
          + 'border-radius: 20px; background: rgba(217,180,120,.16); pointer-events: none; '
          + (moved ? '--dcx: ' + ((from - to) * STEP) + 'px; animation: dcPillSlide .3s cubic-bezier(.2,.8,.2,1) both;' : '');
      })(),
      // Which way the prices should come in from, so the movement matches the
      // direction the switch itself travelled.
      tierSlideClass: periodJustMoved()
        ? (periodIndex(billingPeriod) > periodIndex(UI.billingFrom) ? 'dcslide-next' : 'dcslide-prev')
        : '',
      // Gated like the Owner screen's: the studio re-renders on every state
      // poll, so an ungated entry animation would replay every few seconds.
      // Only a deliberate act -- opening the screen or moving the switch --
      // stamps tokensAnimAt.
      // The entry rise and the sideways slide are the same element's animation,
      // so only one may be on at a time: pressing the switch slides, arriving
      // on the screen rises.
      tierAnimClass: (Date.now() - (UI.tokensAnimAt || 0) < 900 && !periodJustMoved()) ? 'dctier-in' : '',
      tierCards: tierCards,

      packs: topupList.map(function (pk) {
        var unavailable = pk.enabled === false;
        return {
          name: pk.name || pk.id,
          // The markup writes "tokens" in its own span right after this, so
          // pluralising here rendered "100 tokens tokens" on every pack. The
          // plan cards were fixed for this and the packs were missed.
          tokens: String(pk.tokens || 0),
          price: pk.priceLabel || 'Price not set',
          per: 'one-off',
          rate: pk.tokens ? 'about ' + Math.round(pk.tokens / Math.max(1, tokenRate)) + ' source minutes' : '',
          equiv: pk.description || '',
          popular: pk.badge === 'Most popular',
          cardStyle: 'display: flex; flex-direction: column; gap: 8px; padding: 13px; border-radius: 12px; border: 1px solid ' +
            (pk.badge === 'Most popular' ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.05);' : 'var(--dc-line-soft, #1E1E22); background: var(--dc-bg, #121214);'),
          cta: unavailable ? 'Not available' : 'Buy tokens',
          btnStyle: 'margin-top: auto; padding: 10px 12px; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: ' +
            (unavailable ? 'default' : 'pointer') + '; border: 1px solid ' +
            (unavailable ? 'var(--dc-line, #26262A); background: var(--dc-bg-raised, #17171A); color: var(--dc-ink-faint, #6E6E76);' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: var(--dc-gold-lit, #F0D6A6);'),
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
        if (current.cancelAtPeriodEnd) {
          // The part people get wrong, stated with the date: it keeps working.
          return (current.cancelAt
            ? 'Cancelled. Everything keeps working until ' + billingDate(current.cancelAt) + ', then this account moves to Free.'
            : 'Cancelled. Everything keeps working until the end of the paid period, then this account moves to Free.')
            + ' Top-up tokens you bought stay on the account.';
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
        var dot = 'position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--dc-n-0c0c0e, #0C0C0E); background: ' +
          (!p.configured ? 'var(--dc-n-e3928c, #E3928C)' : p.enabled ? 'var(--dc-n-7fd1a6, #7FD1A6)' : p.connected ? 'var(--dc-n-e6b770, #E6B770)' : 'var(--dc-ink-faint, #6E6E76)') + ';';
        return {
          name: PLATFORM_NAMES[p.key],
          handle: p.account ? p.account.name : (p.configured ? 'No account linked' : 'Needs API keys'),
          note: !p.configured ? 'Not configured on the server'
            : !p.connected ? 'Connect to publish'
            : !p.enabled ? 'Connected — not switched on'
            : 'Active',
          icon: p.icon,
          key: p.key,
          // Everything the account picker needs. `accounts` is what the
          // connection actually holds (one Facebook login can carry several
          // Pages), `accountIds` is what has been chosen, and `maxAccounts` is
          // what this plan allows on THIS platform -- 1 for YouTube and TikTok
          // whatever the plan, because their credentials can only hold one.
          accounts: p.accounts,
          accountIds: p.accountIds,
          maxAccounts: p.maxAccounts,
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
    // Exposed so the failure guidance can be tested by CALLING it. Asserting
    // that a table contains a regex proves nothing about which entry answers a
    // given error -- and the bug this fixes was exactly a wrong entry winning.
    explainFailure: explainFailure,
    // The review deck's keyboard, one verb per key. The host owns the window
    // (and the <video>, so Space stays there), but a decision made by key must
    // travel the same road as the buttons: the optimistic ledger first, then a
    // repaint, then the API -- or the deck would sit on a decided clip until
    // the server answered. Returns false when there is nothing to act on, so
    // the host can let unclaimed keys fall through.
    deckAct: function (kind) {
      if (kind === 'approve' || kind === 'reject') {
        if (!deckNowId) return false;
        UI.pending[deckNowId] = kind === 'approve' ? 'approved' : 'rejected';
        refresh();
        if (kind === 'approve') global.StudioAdapter.onApprove(deckNowId);
        else global.StudioAdapter.onReject(deckNowId);
        return true;
      }
      if (kind === 'skip') { setUI({ deckIdx: Math.min(UI.deckIdx + 1, Math.max(0, deckNowCount - 1)) }); return true; }
      if (kind === 'back') { setUI({ deckIdx: Math.max(0, UI.deckIdx - 1) }); return true; }
      if (kind === 'sound') { setUI({ deckMuted: !UI.deckMuted }); return true; }
      if (kind === 'rate') { setUI({ deckRate: UI.deckRate === 1 ? 1.5 : UI.deckRate === 1.5 ? 2 : 1 }); return true; }
      return false;
    },
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
    // Exposed so the host-rendered Account dialog reads the SAME answer the
    // bell dropdown and the phone read, rather than deriving a fifth one.
    desktopNotifsState: desktopNotifsState,
    pushArrivesClosed: pushArrivesClosed,
    notifsLabel: NOTIFS_LABEL,
    onGenerate: function () {},
    onUploadNasheedPrompt: function () {},
    onApplyTemplateToClip: function () {},
    onBulkClips: function () {},
    onBulkProjects: function () {},
    onSaveClip: function () {},
    clipSaved: function () { UI.edSaving = false; UI.edDirty = false; UI.edCaption = null; UI.edBlockDraft = null; UI.edTrim = null; UI.edCutOuts = null; UI.edCutMark = null; refresh(); },
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
      // Cleared per job, so the last step ALWAYS opens on the account's own
      // Connections settings rather than on whatever the previous lecture was
      // narrowed to. Youssef: "keep it how it is as those settings to begin
      // with all the time, and then they can change their mind whenever they
      // post." A per-lecture choice that quietly became the new default would
      // be a settings change nobody made.
      UI.jobPublishTo = null;
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
    onLoadOwner: function () {},
    onLoadDeenai: function () {},
    onAskDeenAI: function () {},
    onSaveOwnerCost: function () {},
    onDeleteOwnerCost: function () {},
    onResumeSubscription: function () {},
    onToast: function () {},
    // The host clears optimistic decisions once fresh state has landed.
    // Both decisions are persisted now, so the refreshed state is the truth and
    // nothing needs to be held over it.
    settled: function () { UI.pending = {}; },
    /*
     * The five places an onboarding step can send you, by name.
     *
     * A METHOD on the adapter rather than an entry in bindings(), because both
     * callers reach it from outside a render: the Home strip's own button and
     * the task ladder's rows (Youssef, 3 Sept 2026: "connect the side bar
     * perctnage thing to first user interface hero thing to work with one
     * another"). Two lists of destinations that have to agree is how a row
     * ends up going somewhere the strip beside it does not -- the first cut of
     * this sat inside bindings(), so StudioAdapter.goToStep was undefined and
     * clicking a task row silently did nothing.
     */
    goToStep: function (action, e) {
      var where = {
        // Home is where the paste field is; the host focuses it after the
        // paint (paintOnboarding), because the field is drawn by the template
        // and does not exist yet at this point.
        paste: function () { setUI({ screen: 'home', focusPaste: Date.now() }); },
        nasheed: function () { setUI({ screen: 'music' }); },
        review: function () { setUI({ screen: 'queue', queueTab: 'decide' }); },
        connect: function () { global.StudioAdapter.onOpenConnections(); },
        schedule: function () { setUI({ screen: 'schedule' }); },
      }[String(action || '')];
      if (!where) return false;
      if (e && e.preventDefault) e.preventDefault();
      where();
      return true;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
