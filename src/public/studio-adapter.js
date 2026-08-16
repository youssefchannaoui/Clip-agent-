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
    jobTrackId: null,
    countsOpen: false,
    playingTrack: null,
    perfRange: 'Last 7 days',
    planPeriod: 'Monthly',
    termA: '',
    termB: '',
    blockerDismissed: false,
    tplLayer: 'caption',
    tplDirty: false,
    sheet: null,
    toast: null,
    playerClip: null,
    connProvider: null,
    job: null,
    generating: false,
    edClipId: null,
    edTab: 'captions',
    edCaption: null,
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

  // The worker reports free-text progress ("Downloading source video") rather than
  // a stage key, so the rail's five steps are matched by what that text starts
  // with. Anything unrecognised leaves the rail at the last step it did match.
  var STAGES = [
    { label: 'Source imported', match: /download|loading saved|preparing selected/i },
    { label: 'Transcribing audio', match: /transcri|speech audio/i },
    { label: 'Moments scored', match: /scor|analysing transcript|finding/i },
    { label: 'Rendering with your template', match: /render/i },
    { label: 'FFprobe verification', match: /verif|complete/i },
  ];
  function stageIndex(text) {
    var found = 0;
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].match.test(text || '')) found = i;
    return found;
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
  function handleStyle(on) {
    return on
      ? 'position: absolute; inset: -6px; border: 1px dashed rgba(217,180,120,.7); border-radius: 6px; pointer-events: none;'
      : 'display: none;';
  }
  // Places a preview overlay from the template's own position fields.
  function overlayStyle(vertical, horizontal, colour, size) {
    var v = vertical === 'top' ? 'top: 8%;' : vertical === 'bottom' ? 'bottom: 8%;' : 'top: 50%; translate: 0 -50%;';
    var h = horizontal === 'left' ? 'left: 8%; text-align: left;'
      : horizontal === 'right' ? 'right: 8%; text-align: right;'
      : 'left: 50%; transform: translateX(-50%); text-align: center;';
    return 'position: absolute; ' + v + ' ' + h + ' max-width: 84%; color: ' + (colour || '#FFFFFF') +
      '; font-size: ' + Math.max(9, Math.round(Number(size || 40) / 6)) + 'px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 6px rgba(0,0,0,.7);';
  }


  // Platforms spell themselves; naive capitalisation gives "Tiktok".
  var PLATFORM_NAMES = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };

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

    // The quote-review gate is a real automation setting, not a demo prop.
    var gate = !(DATA.automationSettings && DATA.automationSettings.skipQuotes === false);
    var connectedCount = ['youtube', 'instagram', 'tiktok']
      .filter(function (n) { return social[n] && social[n].connected; }).length;

    var projectTitle = {};
    projects.forEach(function (p) { projectTitle[p.id] = p.title || p.sourceTitle || 'Untitled lecture'; });

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
        edit: function (e) { stop(e); setUI({ screen: 'editor', edClipId: c.id }); },
        openLecture: function (e) { stop(e); setUI({ screen: 'detail', openProject: c.projectId }); },
      };
    }

    function approve(id) {
      UI.pending[id] = 'approved';
      refresh();
      global.StudioAdapter.onApprove(id);
    }
    // Reject is deliberately local and session-scoped. The server has no rejected
    // state: approve/pullBack only move a clip between `waiting` and `approved`,
    // and the only way to make a clip go away for good is DELETE. Wiring a
    // one-tap deck button to a permanent delete is not a trade worth making, so
    // rejecting hides the clip for this session and nothing is destroyed.
    // Persisting it needs a real field on the clip record.
    function reject(id) {
      UI.pending[id] = 'rejected';
      refresh();
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
    var active = projects.filter(function (p) {
      return p.status !== 'ready' && p.status !== 'failed' && p.status !== 'cancelled';
    })[0] || null;
    var activeStage = active ? stageIndex(active.stage) : 0;

    // A lecture's shelf state, from the record's own status.
    function lecState(p) {
      if (p.status === 'ready') return 'ready';
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
        thumbStyle: 'position: relative; aspect-ratio: 16 / 9; background-color: #17171A;' +
          (p.sourceThumbUrl ? ' background-image: url("' + cssUrl(p.sourceThumbUrl) + '"); background-size: cover; background-position: center 30%;' : ''),
        stateChip: state === 'processing' ? 'Processing' : state === 'ready' ? 'Ready' : 'Archived',
        chipStyle: 'display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; border: 1px solid ' +
          (state === 'processing' ? 'rgba(217,180,120,.4); background: rgba(10,10,12,.82); color: #F0D6A6;'
            : state === 'ready' ? 'rgba(127,209,166,.32); background: rgba(10,10,12,.82); color: #7FD1A6;'
            : '#33333A; background: rgba(10,10,12,.82); color: #A2A2AA;'),
        chipIcon: state === 'processing' ? 'ph ph-circle-notch' : state === 'ready' ? 'ph-fill ph-check-circle' : 'ph ph-archive',
        chipIconStyle: 'font-size: 11px;' + (state === 'processing' ? ' animation: dcSpin 1.1s linear infinite;' : ''),
        isProcessing: state === 'processing',
        barStyle: 'position: absolute; left: 0; bottom: 0; height: 3px; width: ' + Math.round(p.progress || 0) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6); transition: width .5s ease;',
        metric: state === 'processing' ? (p.stage || 'working…') : median ? 'median score ' + median : 'no clips yet',
        openClips: function (e) { stop(e); setUI({ screen: 'detail', openProject: p.id }); },
      };
    });

    var detail = projects.filter(function (p) { return p.id === UI.openProject; })[0] || projects[0] || null;
    var detailClips = detail ? clipsOf(detail.id).sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).map(clipCard) : [];

    // Schedule: the next seven days, filled from clips that already hold a slot.
    var DAY_MS = 86400000;
    var startOfDay = function (t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    var today = startOfDay(Date.now());
    var scheduleDays = [];
    for (var dnum = 0; dnum < 7; dnum++) {
      (function (dayStart) {
        var label = dnum === 0 ? 'Today' : dnum === 1 ? 'Tomorrow'
          : new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long' });
        var items = scheduled.filter(function (c) { return startOfDay(c.scheduledAt) === dayStart; })
          .map(function (c) {
            var target = (c.targets && c.targets[0]) || {};
            var platform = target.platform || '';
            var failing = [];
            if (!c.musicVerified) failing.push('nasheed');
            if (!c.renderVerified) failing.push('render');
            if (!c.templateId) failing.push('template');
            return {
              time: timeOf(c.scheduledAt),
              dest: PLATFORM_NAMES[platform] || 'No account',
              icon: platform === 'youtube' ? 'ph ph-youtube-logo' : platform === 'instagram' ? 'ph ph-instagram-logo' : platform === 'tiktok' ? 'ph ph-tiktok-logo' : 'ph ph-share-network',
              caption: c.title || '',
              score: c.score || '',
              duration: secsToClock((c.durationMs || 0) / 1000),
              thumbStyle: 'width: 30px; height: 42px; flex: none; border-radius: 6px; border: 1px solid #26262A; background: ' + thumb(c.thumbUrl) + ';',
              hasFailing: failing.length > 0,
              statusLabel: c.postedAt ? 'Posted' : failing.length ? failing.length + ' check failing' : 'Ready',
              statusStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; border: 1px solid ' +
                (failing.length ? '#3A2A2A; background: rgba(10,10,12,.85); color: #E3928C;' : 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: #7FD1A6;'),
              cardStyle: 'display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid ' +
                (failing.length ? '#2A2024' : '#1E1E22') + '; border-radius: 10px; background: #121214;',
            };
          });
        scheduleDays.push({
          day: label,
          countLabel: items.length + ' of 4 scheduled',
          canAdd: items.length < 4,
          items: items,
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
    }, activeTemplate || {});

    function saveTemplate(patch) {
      UI.tplDirty = true;
      global.StudioAdapter.onTemplateField(activeTemplate && activeTemplate.id, patch);
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
              if (idx > -1) saveTemplate(defObj(d.field, d.opts[idx]));
            });
          },
        };
      });
    }
    function defObj(k, v) { var o = {}; o[k] = v; return o; }

    // Plans come from billing.publicBilling(); shape varies, so read defensively.
    var planList = (DATA.billing && (DATA.billing.plans || DATA.billing.availablePlans)) || [];
    if (!Array.isArray(planList)) {
      planList = Object.keys(planList).map(function (k) {
        var v = planList[k]; return typeof v === 'object' ? Object.assign({ id: k }, v) : { id: k, name: k };
      });
    }

    // The clip open in the editor, and the caption split into readable blocks.
    var edClip = clips.filter(function (c) { return c.id === UI.edClipId; })[0] || null;
    var edCaptionText = UI.edCaption !== null ? UI.edCaption : (edClip && edClip.transcript) || '';
    var edCaptionBlocks = String(edCaptionText).split(/(?<=[.!?\u061F])\s+/).filter(Boolean).map(function (line, i) {
      return {
        text: line,
        style: 'padding: 8px 10px; border-radius: 8px; border: 1px solid ' + (i === 0 ? 'rgba(217,180,120,.3)' : '#1E1E22') + '; background: #121214; font-size: 12.5px; line-height: 1.45;',
        select: function () {},
      };
    });
    // Other clips cut from the same lecture, for the editor's filmstrip.
    var edSiblings = edClip ? clips.filter(function (c) { return c.projectId === edClip.projectId; }).slice(0, 8).map(function (c) {
      var on = c.id === edClip.id;
      return {
        style: 'width: 46px; flex: none; aspect-ratio: 9 / 16; border-radius: 7px; cursor: pointer; background: ' + thumb(c.thumbUrl) +
          '; border: 1px solid ' + (on ? '#D9B478' : '#26262A') + ';',
        select: function (e) { stop(e); setUI({ edClipId: c.id, edCaption: null, edDirty: false }); },
      };
    }) : [];

    // Where the caption sits in the preview, as a percentage of frame height.
    var firstName = String((DATA.user && DATA.user.name) || '').trim().split(/\s+/)[0] || '';
    var needsReconnect = ['youtube', 'instagram', 'tiktok'].filter(function (n) {
      var p = social[n] || {};
      return p.configured && !p.connected;
    }).map(function (n) { return PLATFORM_NAMES[n] || n; });

    var capTop = tpl.captionPosition === 'top' ? 22 : tpl.captionPosition === 'bottom' ? 80 : 50;

    var job = UI.job;
    var tokenRate = Number((DATA.billing && DATA.billing.tokenRatePerMinute) || 1);

    // The connection the modal is showing, if any.
    var PROVIDERS = {
      youtube: { title: 'YouTube', icon: 'ph ph-youtube-logo', oauth: 'youtube' },
      instagram: { title: 'Instagram', icon: 'ph ph-instagram-logo', oauth: 'meta' },
      tiktok: { title: 'TikTok', icon: 'ph ph-tiktok-logo', oauth: 'tiktok' },
    };
    var conn = null;
    if (UI.connProvider && PROVIDERS[UI.connProvider]) {
      var p = social[UI.connProvider] || {};
      conn = {
        key: UI.connProvider,
        title: PROVIDERS[UI.connProvider].title,
        icon: PROVIDERS[UI.connProvider].icon,
        oauth: PROVIDERS[UI.connProvider].oauth,
        connected: Boolean(p.connected),
        configured: Boolean(p.configured),
        handle: (p.accounts && p.accounts[0] && p.accounts[0].name) || 'No account linked',
      };
    }

    // The live dock mirrors work actually in flight.
    var liveItems = projects.filter(function (pr) {
      return pr.status !== 'ready' && pr.status !== 'failed' && pr.status !== 'cancelled';
    }).slice(0, 3).map(function (pr) {
      return {
        label: projectTitle[pr.id],
        meta: pr.stage || 'queued',
        barStyle: 'height: 3px; border-radius: 3px; width: ' + Math.round(pr.progress || 0) + '%; background: linear-gradient(90deg, #D9B478, #F0D6A6);',
        iconStyle: 'font-size: 14px; color: #F0D6A6; animation: dcSpin 1.1s linear infinite;',
        icon: 'ph ph-circle-notch',
      };
    });

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
      markRead: function (e) { stop(e); setUI({ bellOpen: false }); },
      moreActivity: function (e) { stop(e); setUI({ activityAll: !UI.activityAll }); },
      activity: (UI.activityAll ? log : log.slice(0, 5)).map(function (entry) {
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
        };
      }),

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
        var processing = p.status !== 'ready' && p.status !== 'failed';
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
        { label: 'Publishing tokens', value: connectedCount + ' valid', ok: connectedCount > 0 },
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
      scheduleDays: scheduleDays,

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

      // Caption text is genuinely per-clip: it is the clip's transcript.
      edCapText: UI.edCaption !== null ? UI.edCaption : (edClip && edClip.transcript) || '',
      setCapText: function (e) { UI.edCaption = e.target.value; UI.edDirty = true; refresh(); },
      edSelText: '', edSelRange: '',
      edCapBlocks: edCaptionBlocks,
      // Overlays sit inside the preview frame, positioned as fractions of it.
      edCapOverlayStyle: 'position: absolute; z-index: 8; width: 80%; left: 50%; top: ' + capTop + '%; translate: -50% -50%; text-align: center; padding: 7px 9px; border-radius: 6px; background: rgba(10,10,12,.5); color: ' +
        (tpl.captionPrimary || '#F0D6A6') + '; font-family: Outfit, Inter, sans-serif; font-weight: 600; line-height: 1.2; font-size: ' +
        Math.max(8, Math.round(Number(tpl.captionFontSize || 96) / 8)) + 'px;' + (tpl.captionUppercase ? ' text-transform: uppercase;' : ''),
      edCapHandle: 'position: absolute; inset: -5px; border: 1px dashed rgba(240,214,166,.7); border-radius: 8px; pointer-events: none;',
      dragEdCap: function () {},

      // captionFontSize, range 24-140 in the schema.
      edSize: Number(tpl.captionFontSize) || 96,
      edSizeLabel: (Number(tpl.captionFontSize) || 96) + ' px',
      setSize: function (e) { saveTemplate({ captionFontSize: Number(e.target.value) }); },
      // captionMarginV, range 20-800.
      edCapPosY: Number(tpl.captionMarginV) || 180,
      setPosY: function (e) { saveTemplate({ captionMarginV: Number(e.target.value) }); },
      edPosLabelLive: (Number(tpl.captionMarginV) || 180) + ' px',
      edUpperTrack: switchTrack(Boolean(tpl.captionUppercase)),
      edUpperKnob: switchKnob(Boolean(tpl.captionUppercase)),
      toggleUpper: function (e) { stop(e); saveTemplate({ captionUppercase: !tpl.captionUppercase }); },
      edFonts: ['DejaVu Sans', 'Inter', 'Amiri'].map(function (f) {
        return { label: f, style: tabStyle(tpl.captionFont === f), select: function (e) { stop(e); saveTemplate({ captionFont: f }); } };
      }),

      // fitMode, and the one framing toggle the schema keeps.
      edCrops: ENUMS.fitMode.map(function (m) {
        var labels = { contain: 'Fit', blur: 'Blur', crop: 'Fill' };
        return { label: labels[m], style: tabStyle(tpl.fitMode === m), select: function (e) { stop(e); saveTemplate({ fitMode: m }); } };
      }),
      edFaceTrack: switchTrack(Boolean(tpl.smartFramingEnabled)),
      edFaceKnob: switchKnob(Boolean(tpl.smartFramingEnabled)),
      toggleFace: function (e) { stop(e); saveTemplate({ smartFramingEnabled: !tpl.smartFramingEnabled }); },

      // vignette, range 0-1 in the schema, shown as a percentage.
      edVignette: Math.round((Number(tpl.vignette) || 0) * 100),
      edVignetteLabel: Math.round((Number(tpl.vignette) || 0) * 100) + '%',
      setVignette: function (e) { saveTemplate({ vignette: Number(e.target.value) / 100 }); },
      // grain 0-100, warm -100..100, zoom 0.75-2.5 in the schema.
      edGrain: Number(tpl.grain) || 0,
      edGrainLabel: (Number(tpl.grain) || 0) + '%',
      setGrain: function (e) { saveTemplate({ grain: Number(e.target.value) }); },
      edWarm: Number(tpl.warm) || 0,
      edWarmLabel: (Number(tpl.warm) > 0 ? '+' : '') + (Number(tpl.warm) || 0),
      setWarm: function (e) { saveTemplate({ warm: Number(e.target.value) }); },
      edZoom: Math.round((Number(tpl.smartFramingZoom) || 1) * 100),
      edZoomLabel: Math.round((Number(tpl.smartFramingZoom) || 1) * 100) + '%',
      setZoom: function (e) { saveTemplate({ smartFramingZoom: Number(e.target.value) / 100 }); },

      edWmTrack: sliderTrack(),
      edWmKnob: sliderKnob(Number(tpl.watermarkOpacity) > 0),
      edWmNote: tpl.watermark ? tpl.watermark + ' at ' + (Number(tpl.watermarkOpacity) || 0) + '%' : 'No watermark',
      toggleWatermark: function (e) { stop(e); saveTemplate({ watermarkOpacity: Number(tpl.watermarkOpacity) > 0 ? 0 : 100 }); },
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
      edPlayHeadStyle: 'position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: #F0D6A6;',
      edProgressStyle: 'height: 3px; border-radius: 3px; width: 0%; background: linear-gradient(90deg, #D9B478, #F0D6A6);',
      edProgressLabel: '0:00',
      edSiblings: edSiblings,

      edDirtyLabel: UI.edDirty ? 'Unsaved changes' : 'All changes saved',
      edDirtyDot: 'width: 7px; height: 7px; border-radius: 50%; background: ' + (UI.edDirty ? '#E6B770' : '#7FD1A6') + ';',
      edSaving: UI.edSaving,
      edSaveLabel: UI.edSaving ? 'Saving…' : 'Save clip',
      edSaveIcon: UI.edSaving ? 'ph ph-circle-notch' : 'ph ph-floppy-disk',
      edSaveIconStyle: 'font-size: 15px;' + (UI.edSaving ? ' animation: dcSpin 1.1s linear infinite;' : ''),
      saveEdit: function (e) {
        stop(e);
        if (!edClip || UI.edSaving) return;
        setUI({ edSaving: true });
        global.StudioAdapter.onSaveClip(edClip.id, {
          transcript: UI.edCaption !== null ? UI.edCaption : edClip.transcript,
        });
      },

      // ── Source range panel ──
      // Opens after /api/source-info resolves a pasted link, so the range and the
      // token estimate are based on the real source rather than a guess. The
      // chosen range becomes sourceStartSeconds/sourceEndSeconds on /api/videos.
      jobOpen: Boolean(job),
      jobSourceLabel: job ? job.title : '',
      jobStart: job ? job.start : 0,
      jobEnd: job ? job.end : 0,
      setJobStart: function (e) {
        if (!UI.job || !UI.job.durationKnown) return;
        UI.job.start = Math.max(0, Math.min(Number(e.target.value), (UI.job.end || 0) - 30));
        refresh();
      },
      setJobEnd: function (e) {
        if (!UI.job || !UI.job.durationKnown) return;
        UI.job.end = Math.min(UI.job.durationSec, Math.max(Number(e.target.value), (UI.job.start || 0) + 30));
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
      // Charging is per source minute, so an estimate is only honest once the
      // length is known. The server confirms the real cost before processing.
      jobTokenLabel: !job ? '' : job.durationKnown
        ? '≈ ' + plural(Math.max(1, Math.ceil((job.end - job.start) / 60 * tokenRate)), 'token')
        : 'Cost confirmed before processing',
      // A picker, not a label: the template renders one button per entry, so a
      // string here renders one button per character.
      jobNasheeds: tracks.map(function (t) {
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
        setUI({ generating: true });
        global.StudioAdapter.onGenerate(job.url, job.durationKnown
          ? { startSec: Math.round(job.start), endSec: Math.round(job.end) }
          : null);
      },
      genBusy: UI.generating,
      genLabel: UI.generating ? 'Starting…' : 'Generate clips',
      genIcon: UI.generating ? 'ph ph-circle-notch' : 'ph-fill ph-sparkle',
      genIconStyle: 'font-size: 15px;' + (UI.generating ? ' animation: dcSpin 1.1s linear infinite;' : ''),
      genBarStyle: UI.generating
        ? 'position: absolute; left: 0; bottom: 0; height: 2px; width: 40%; background: linear-gradient(90deg, #D9B478, #F0D6A6); animation: dcSweep 1.1s ease-in-out infinite;'
        : 'display: none;',
      genProgressLabel: UI.generating ? 'Queuing the lecture…' : '',

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
      storageTranscripts: String(projects.filter(function (p) { return p.status === 'ready'; }).length),
      jobTitle: active ? projectTitle[active.id] : 'Nothing processing',
      jobMeta: active
        ? humanDuration(active.durationSec || active.sourceDurationSec) + ' source · ' + plural(active.clipCount || 0, 'clip') + ' requested'
        : 'Paste a lecture to start',
      activityNeedsYou: needsCount + ' need you',
      activityTotal: log.length + ' in total',
      emptySampleNote: 'Sample of what a lecture produces',
      emptySampleCaption: 'This is what one lecture produces',

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
          select: function (e) {
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
      seek: function () {},

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

      liveDock: liveItems.length > 0,
      liveItems: liveItems,
      showAllActivity: function (e) { stop(e); setUI({ activityAll: true, bellOpen: true }); },

      // ── Account menu ──
      accountSettings: function (e) { stop(e); setUI({ screen: 'tokens', menuOpen: false }); },
      helpGuides: function (e) { stop(e); global.open('https://deenclipped.online/features', '_blank', 'noopener'); },
      signOut: function (e) { stop(e); global.StudioAdapter.onSignOut(); },

      // ── Connections modal ──
      connOpen: UI.connProvider !== null,
      connName: conn ? conn.title : '',
      connHandle: conn ? conn.handle : '',
      connIcon: conn ? conn.icon : '',
      connStatus: conn ? (conn.connected ? 'Connected' : 'Not connected') : '',
      connStatusStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; border: 1px solid ' +
        (conn && conn.connected ? 'rgba(127,209,166,.35); background: rgba(10,10,12,.85); color: #7FD1A6;' : '#3A2A2A; background: rgba(10,10,12,.85); color: #E3928C;'),
      connDotStyle: 'width: 8px; height: 8px; border-radius: 50%; background: ' + (conn && conn.connected ? '#7FD1A6' : '#E6B770') + ';',
      connNote: conn
        ? (conn.connected
          ? 'Reconnecting refreshes the publishing token — scheduled posts keep their slots.'
          : conn.configured ? 'Connect to publish approved clips automatically.' : 'This platform is not configured on the server yet.')
        : '',
      connBtnLabel: conn && conn.connected ? 'Reconnect' : 'Connect',
      connBtnIcon: conn && conn.connected ? 'ph ph-arrows-clockwise' : 'ph ph-plugs-connected',
      connBtnIconStyle: 'font-size: 15px;',
      reconnect: function (e) { stop(e); if (conn) global.StudioAdapter.onConnect(conn.key); },
      disconnect: function (e) { stop(e); if (conn) global.StudioAdapter.onDisconnect(conn.oauth); },
      testPost: function (e) { stop(e); if (conn) global.StudioAdapter.onTestConnection(conn.key); },
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
      tplList: templates.map(function (t) { return t.name; }),
      activeTpl: activeTemplate ? activeTemplate.name : '',
      setActiveTpl: function (e) {
        var picked = templates.filter(function (t) { return t.name === e.target.value; })[0];
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
          toggle: function (e) { stop(e); saveTemplate({ voiceEnhance: !on }); },
        };
      }),
      tplDirtyLabel: UI.tplDirty ? 'Unsaved changes' : 'All changes saved',
      tplDirtyDotStyle: 'width: 7px; height: 7px; border-radius: 50%; background: ' + (UI.tplDirty ? '#E6B770' : '#7FD1A6') + ';',
      saveTpl: function (e) { stop(e); global.StudioAdapter.onSaveTemplate(); },
      resetTpl: function (e) { stop(e); setUI({ tplDirty: false }); global.StudioAdapter.onResetTemplate(); },
      duplicateTpl: function (e) { stop(e); global.StudioAdapter.onDuplicateTemplate(activeTemplate && activeTemplate.id); },
      previewClip: function (e) { stop(e); toast('Preview renders from the next clip this template produces.'); },
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
      capStyle: overlayStyle(tpl.captionPosition, tpl.captionHorizontal, tpl.captionPrimary, tpl.captionFontSize),
      capHandle: handleStyle(UI.tplLayer === 'caption'),
      headStyle: 'display: none;',
      headHandle: 'display: none;',
      markStyle: overlayStyle(tpl.watermarkPosition.indexOf('top') === 0 ? 'top' : 'bottom',
        tpl.watermarkPosition.indexOf('left') > -1 ? 'left' : tpl.watermarkPosition.indexOf('right') > -1 ? 'right' : 'center',
        tpl.watermarkColor, tpl.watermarkFontSize),
      markHandle: handleStyle(UI.tplLayer === 'mark'),
      guideVStyle: 'position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(217,180,120,.18);',
      guideHStyle: 'position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: rgba(217,180,120,.18);',
      edSafe: true,
      safePresetLabel: 'Shorts + Reels',
      cyclePreset: function (e) { stop(e); toast('Safe-zone presets are fixed for vertical output.'); },
      dragCaption: function () {}, dragHeadline: function () {}, dragMark: function () {},
      undoEdit: function (e) { stop(e); global.StudioAdapter.onResetTemplate(); },
      redoEdit: function (e) { stop(e); },

      // ── Start-a-job form (shared by Home and the library) ──
      jobUrlVal: UI.jobUrl,
      setJobUrl: function (e) { UI.jobUrl = e.target.value; refresh(); },
      startJob: function (e) {
        stop(e);
        var url = (UI.jobUrl || '').trim();
        if (!url) return;
        global.StudioAdapter.onProbeSource(url);
      },
      onFile: function (e) {
        var file = e.target && e.target.files && e.target.files[0];
        if (file) global.StudioAdapter.onUploadFile(file);
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
      recutClips: function (e) { stop(e); toast('Re-cutting a lecture is not available yet.'); },
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
          views: '—', saves: '—', watch: '—', more: '',
        };
      }),
      perfPatterns: [],

      // ── Tokens & billing ──
      planPeriods: ['Weekly', 'Monthly', 'Yearly'].map(function (label) {
        return {
          label: label,
          style: tabStyle(UI.planPeriod === label),
          select: function (e) { stop(e); setUI({ planPeriod: label }); },
        };
      }),
      planCards: planList.map(function (p) {
        var isCurrent = String(p.id || p.key || '').toLowerCase() === String(current.plan || '').toLowerCase();
        return {
          name: p.name || p.id || '',
          price: p.priceLabel || (p.price != null ? '£' + p.price : ''),
          per: p.interval || '',
          tokens: p.tokens != null ? plural(p.tokens, 'token') : '',
          lines: (p.features || []).map(function (f) { return { text: f }; }),
          hasTag: isCurrent,
          tag: 'Current plan',
          tagStyle: 'padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: rgba(217,180,120,.16); color: #F0D6A6;',
          cardStyle: 'display: flex; flex-direction: column; gap: 9px; padding: 14px; border-radius: 12px; border: 1px solid ' +
            (isCurrent ? 'rgba(217,180,120,.45); background: rgba(217,180,120,.05);' : '#1E1E22; background: #121214;'),
          cta: isCurrent ? 'Current' : 'Choose',
          btnStyle: 'padding: 8px 12px; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: ' + (isCurrent ? 'default' : 'pointer') + '; border: 1px solid ' +
            (isCurrent ? '#26262A; background: #17171A; color: #6E6E76;' : 'rgba(217,180,120,.42); background: rgba(217,180,120,.11); color: #F0D6A6;'),
          choose: function (e) { stop(e); if (!isCurrent) global.StudioAdapter.onChoosePlan(p.id || p.key); },
        };
      }),
      packs: [],
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

      connections: ['youtube', 'instagram', 'tiktok'].map(function (name) {
        var provider = social[name] || {};
        var ok = Boolean(provider.connected);
        return {
          name: PLATFORM_NAMES[name] || name,
          handle: (provider.accounts && provider.accounts[0] && provider.accounts[0].name) || 'Not connected',
          note: ok ? 'Connected' : 'Connect to publish',
          icon: name === 'youtube' ? 'ph ph-youtube-logo' : name === 'instagram' ? 'ph ph-instagram-logo' : 'ph ph-tiktok-logo',
          open: function (e) { stop(e); setUI({ connProvider: name }); },
          dotStyle: 'position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid #0C0C0E; background: ' + (ok ? '#7FD1A6' : '#E6B770') + ';',
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
    onStartJob: function () {},
    onUploadFile: function () {},
    onClipSettings: function () {},
    onMusicSettings: function () {},
    onPlayTrack: function () {},
    onRemoveTrack: function () {},
    onChoosePlan: function () {},
    onSelectTemplate: function () {},
    onSaveTemplate: function () {},
    onResetTemplate: function () {},
    onDuplicateTemplate: function () {},
    onTemplateField: function () {},
    onPickOption: function (title, options, cb) {
      UI.sheet = { title: title, subtitle: 'Applies to every clip on this template', options: options, cb: cb };
      refresh();
    },
    onSignOut: function () {},
    onProbeSource: function () {},
    onGenerate: function () {},
    onSaveClip: function () {},
    clipSaved: function () { UI.edSaving = false; UI.edDirty = false; UI.edCaption = null; refresh(); },
    // Called by the host once /api/source-info resolves, so the range picker can
    // open against the real duration.
    openJob: function (source) {
      var dur = Number(source && source.durationSec) || 0;
      UI.job = {
        url: source.url,
        title: source.title || source.url,
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
    onConnect: function () {},
    onDisconnect: function () {},
    onTestConnection: function () {},
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
    settled: function () {
      // Approvals are confirmed by the refreshed state; local rejects have
      // nowhere to persist to, so they survive until the page is reloaded.
      var keep = {};
      for (var id in UI.pending) if (UI.pending[id] === 'rejected') keep[id] = 'rejected';
      UI.pending = keep;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
