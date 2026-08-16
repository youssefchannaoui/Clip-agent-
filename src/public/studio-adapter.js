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
    hoverNav: null,
    menuOpen: false,
    bellOpen: false,
    query: '',
    activityAll: false,
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
    return clips.filter(function (c) {
      return c.status === 'ready' && !c.approvedBy && !c.scheduledAt && !c.postedAt;
    });
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
    var isHover = UI.hoverNav === key;
    var open = UI.railOpen;
    return {
      label: label,
      icon: icon,
      count: count || '',
      click: function (e) { stop(e); setUI({ screen: key, menuOpen: false, bellOpen: false }); },
      enter: function () { setUI({ hoverNav: key }); },
      leave: function () { setUI({ hoverNav: null }); },
      style: 'position: relative; display: flex; align-items: center; gap: 10px; padding: ' + (open ? '8px 10px' : '9px 0') + '; ' + (open ? '' : 'justify-content: center; ') +
        'border-radius: 8px; font-weight: ' + (on ? '500' : '400') + '; cursor: pointer; white-space: nowrap; transition: background .14s ease, color .14s ease; border-left: 2px solid ' +
        (on ? '#D9B478; background: rgba(217,180,120,.09); color: #F0D6A6;' : 'transparent; ' + (isHover ? 'background: #17171A; color: #F2F2F4;' : 'color: #A2A2AA;')),
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
          dest: platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Not connected',
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

      connections: ['youtube', 'instagram', 'tiktok'].map(function (name) {
        var provider = social[name] || {};
        var ok = Boolean(provider.connected);
        return {
          name: name.charAt(0).toUpperCase() + name.slice(1),
          handle: (provider.accounts && provider.accounts[0] && provider.accounts[0].name) || 'Not connected',
          note: ok ? 'Connected' : 'Connect to publish',
          icon: name === 'youtube' ? 'ph ph-youtube-logo' : name === 'instagram' ? 'ph ph-instagram-logo' : 'ph ph-tiktok-logo',
          open: function (e) { stop(e); setUI({ screen: 'templates' }); },
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
