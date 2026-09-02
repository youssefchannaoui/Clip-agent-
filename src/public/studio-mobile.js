/*
 * studio-mobile.js — the phone dashboard.
 *
 * HAND-WRITTEN. A design re-import never touches this file, and nothing in it
 * names one of the export's hashed classes.
 *
 * What it is: a SECOND TEMPLATE over the SAME bindings. StudioAdapter.bindings()
 * computes one object of values and handlers; the desktop template renders it
 * one way, and this file renders it another, through the same StudioRuntime
 * (same diffing patcher, same delegated events, same handler table). Every
 * button here calls the very function the desktop button calls, so there is no
 * second copy of any logic, no new state on the server and no new route.
 *
 * When it exists: only while the viewport matches the phone query — the 820px
 * seam studio-responsive.css has always cut at, so no device changes regime.
 * paintMobile() is called at the end of paintStudio(); at any wider width it
 * unmounts and returns, so a desktop render never contains a byte of this.
 *
 * What it owns on a phone:
 *   - the shell: a 56px header (mark · title · search · activity · account),
 *     a bottom tab bar (Home · Clips · Create · Schedule · More) and the sheets
 *     those open (More, search, activity, account, create, focused review);
 *   - five screens rebuilt for a thumb: Home, Clips (review queue), Lectures,
 *     a lecture's detail and Schedule. While one of these is up the desktop
 *     rendering of that screen is hidden by CSS (body.dcm-own) — never a
 *     feature, only the layout: every control the desktop screen has is drawn
 *     here from the same binding, and test/studio-mobile.test.mjs asserts it;
 *   - every other screen (Templates, Nasheed library, Language, Performance,
 *     Tokens, Owner, DeenAI, Help, the gated editor) keeps its desktop DOM,
 *     framed by this header and tab bar and tidied by studio-mobile.css.
 *
 * The design's own overlays (the job panel, option sheets, the player, the
 * activity detail, the tour, toasts, the per-platform dialog) are root-level
 * siblings of <main>. They render on a phone exactly as before; this file only
 * STAMPS them (data-host-ov="job" …) after each paint so the stylesheet can
 * turn them into bottom sheets. data-host-* attributes are the one kind the
 * runtime's patcher never strips.
 */
(function (global) {
  'use strict';

  // The 820px seam the app has always cut at, plus a rotated PHONE: a touch
  // device under 500px tall is a phone on its side, and the desktop rail in a
  // 390px-tall window is no use to anyone. Desktops report a fine pointer and
  // tablets are taller than 500px in landscape, so neither is caught.
  var MQ = '(max-width: 820px), (pointer: coarse) and (max-height: 500px)';
  var OWNED = ['home', 'queue', 'library', 'detail', 'schedule', 'templates', 'music', 'performance', 'tokens', 'deenai'];
  var CLIPS = ['queue', 'library', 'detail'];
  // Root-level overlays in the ORDER the template declares them after <main>.
  // Each renders nothing when its flag is false, so the open ones are exactly
  // the root children after <main>, in this order. A test pins this against
  // the template so a re-import that reorders them fails loudly.
  var OVERLAYS = [
    ['job', 'jobOpen'], ['sheet', 'sheetOpen'], ['detail', 'activityDetailOpen'],
    ['player', 'playerOpen'], ['tour', 'tourOn'], ['boot', 'booting'],
    ['dock', 'liveDock'], ['toast', 'toastOn'], ['conn', 'connOpen'],
  ];

  // Mobile-only UI state. Deliberately tiny: which sheet is open, and which
  // clip the focused review is on. Everything else is the adapter's UI.
  var M = { sheet: null, sheetClosing: null, review: null, theme: null, lastScreen: '', screenCls: '', screenAt: 0 };
  // Night is the default and the product's own look; paper is a choice, kept
  // in this browser only (a per-viewer convenience, so no route and no server
  // state). Reading storage can THROW in a private window, so it is guarded
  // and falls back to the default rather than taking the app down with it.
  function themeNow() {
    if (M.theme) return M.theme;
    var saved = '';
    try { saved = (global.localStorage && global.localStorage.getItem('dcmTheme')) || ''; } catch (e) { saved = ''; }
    M.theme = saved === 'light' ? 'light' : 'dark';
    return M.theme;
  }
  function setTheme(next) {
    M.theme = next === 'light' ? 'light' : 'dark';
    try { if (global.localStorage) global.localStorage.setItem('dcmTheme', M.theme); } catch (e) { /* private window */ }
  }
  var root = null, studio = null, rvVideo = null, template = null, listening = false;

  // ── template helpers (the runtime's AST, without the JSON noise) ──────────
  function b(p) { return { p: p }; }
  function cat() { return { cat: Array.prototype.slice.call(arguments) }; }
  function tx(p) { return { t: 'txt', v: { p: p } }; }
  function h(tag, attrs, children) {
    var node = { t: 'el', tag: tag }, a = {}, has = false;
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === 'on') {
          node.on = {};
          for (var evt in attrs.on) node.on[evt] = typeof attrs.on[evt] === 'string' ? { p: attrs.on[evt] } : attrs.on[evt];
        } else if (k === 'st') {
          node.st = typeof attrs.st === 'string' ? { p: attrs.st } : attrs.st;
        } else { a[k] = attrs[k]; has = true; }
      }
    }
    if (has) node.a = a;
    if (children !== undefined && children !== null) node.ch = Array.isArray(children) ? children : [children];
    return node;
  }
  function iff(cond, children) { return { t: 'if', c: typeof cond === 'string' ? { p: cond } : cond, ch: Array.isArray(children) ? children : [children] }; }
  function each(list, as, children) { return { t: 'for', l: { p: list }, as: as, ch: Array.isArray(children) ? children : [children] }; }
  function ph(cls) { return h('i', { class: cls + ' dcm-ph', 'aria-hidden': 'true' }); }
  function phb(path) { return h('i', { class: cat(b(path), ' dcm-ph'), 'aria-hidden': 'true' }); }
  // One <path> per icon, always. The runtime writes SVG leaves as void tags
  // (no closing tag), and in foreign content a second <path> then NESTS inside
  // the first and is never drawn -- so every icon here is a single path whose
  // `d` carries all of its subpaths, and dots are zero-length round-capped
  // strokes rather than circles.
  var I = {
    home: 'M3 11.5 12 4l9 7.5M5 10.5V20h14v-9.5',
    clips: 'M3 5h18v14H3zM7 5v14M17 5v14M3 12h4M17 12h4',
    plus: 'M12 5v14M5 12h14',
    cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4.2-4.2',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
    back: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
    x: 'M6 6l12 12M18 6 6 18',
    check: 'M5 12.5l4.5 4.5L19 7',
    edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17zM13.5 6.5l3 3',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    play: 'M8 5v14l11-7z',
    compass: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z',
    warn: 'M12 3 2.5 20h19zM12 10v4M12 17.5v.5',
    trash: 'M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
  };
  function svg(d, extra) {
    var a = { viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'dcm-svg' };
    if (d === I.more) a['stroke-width'] = '3.4';
    if (d === I.play) { a.fill = 'currentColor'; a.stroke = 'none'; }
    if (extra) for (var k in extra) a[k] = extra[k];
    return h('svg', a, [h('path', { d: d })]);
  }
  function arch() {
    return h('span', { class: 'dcm-arch', 'aria-hidden': 'true' }, [
      h('svg', { viewBox: '0 0 40 52', width: '20', height: '26', fill: 'none' }, [
        h('path', { d: 'M20 2C11.2 2 4 9.2 4 18v32h32V18C36 9.2 28.8 2 20 2Z', stroke: '#D9B478', 'stroke-width': '2.6', 'stroke-linejoin': 'round' }),
      ]),
      h('svg', { viewBox: '0 0 40 52', width: '20', height: '26', fill: '#D9B478' }, [
        h('path', { d: 'M16.6 20.4 25.4 26l-8.8 5.6V20.4Z' }),
      ]),
    ]);
  }

  // ── shell pieces ─────────────────────────────────────────────────────────
  function header() {
    return h('header', { class: 'dcm-head', role: 'banner' }, [
      h('button', { type: 'button', class: 'dcm-brand', on: { click: 'm.goHome' }, 'aria-label': 'DeenClipped home' }, [arch()]),
      h('div', { class: 'dcm-head-t' }, [
        h('strong', {}, [tx('m.title')]),
        iff('m.sub', [h('span', {}, [tx('m.sub')])]),
      ]),
      h('button', { type: 'button', class: 'dcm-hbtn', on: { click: 'm.openSearch' }, 'aria-label': 'Search clips or lectures' }, [svg(I.search)]),
      h('button', { type: 'button', class: 'dcm-hbtn', on: { click: 'm.openActivity' }, 'aria-label': 'Activity' }, [
        svg(I.bell), iff('activityUnread', [h('span', { class: 'dcm-unread' })]),
      ]),
      h('button', { type: 'button', class: 'dcm-avatar', on: { click: 'm.openAccount' }, 'aria-label': 'Account' }, [h('span', { class: 'dcm-avatar-c' }, [tx('m.initials')])]),
    ]);
  }
  function tab(clsPath, click, iconParts, label, countPath) {
    var kids = [svg(iconParts), h('span', { class: 'dcm-tab-l' }, label)];
    if (countPath) kids.push(iff(countPath, [h('span', { class: 'dcm-tab-n' }, [tx(countPath)])]));
    return h('button', { type: 'button', class: cat('dcm-tab ', b(clsPath)), on: { click: click } }, kids);
  }
  function tabs() {
    // The bar floats: an outer track that holds it clear of the safe area and
    // an inner slab that carries the ground, the border and the shadow.
    return h('nav', { class: 'dcm-tabs', 'data-tour': 'rail', 'aria-label': 'Main' }, [
      h('div', { class: 'dcm-tabs-in' }, [
        tab('m.tabHome', 'm.goHome', I.home, 'Home'),
        tab('m.tabClips', 'm.goClips', I.clips, 'Clips', 'needsCount'),
        h('button', { type: 'button', class: 'dcm-tab dcm-tab-create', on: { click: 'm.openCreate' }, 'aria-label': 'Create clips' }, [
          h('span', { class: 'dcm-plus' }, [svg(I.plus, { 'stroke-width': '2.4' })]),
          h('span', { class: 'dcm-tab-l' }, 'Create'),
        ]),
        tab('m.tabSchedule', 'm.goSchedule', I.cal, 'Schedule'),
        tab('m.tabMore', 'm.openMore', I.more, 'More'),
      ]),
    ]);
  }
  function sheet(flag, title, body, opts) {
    opts = opts || {};
    var head = [h('strong', {}, typeof title === 'string' ? title : [title])];
    if (opts.headExtra) head = head.concat(opts.headExtra);
    head.push(h('button', { type: 'button', class: 'dcm-x', on: { click: 'm.closeSheet' }, 'aria-label': 'Close' }, [svg(I.x)]));
    return iff(flag, [h('div', { class: cat('dcm-sheet' + (opts.tall ? ' dcm-sheet-tall' : '') + ' ', b('m.sheetCls')), role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Sheet' }, [
      h('div', { class: 'dcm-sheet-back', on: { click: 'm.closeSheet' } }),
      h('div', { class: 'dcm-sheet-card' }, [
        h('div', { class: 'dcm-grip', 'aria-hidden': 'true' }),
        h('div', { class: 'dcm-sheet-head' }, head),
        h('div', { class: 'dcm-sheet-body' }, body),
      ]),
    ])]);
  }
  function secHead(title, linkLabel, linkClick) {
    var kids = [h('h2', {}, title)];
    if (linkLabel) kids.push(h('button', { type: 'button', class: 'dcm-link', on: { click: linkClick } }, [linkLabel, svg(I.arrow, { width: '15', height: '15' })]));
    return h('div', { class: 'dcm-sec-h' }, kids);
  }
  function empty(text, extra) {
    return h('div', { class: 'dcm-empty' }, [h('p', {}, text)].concat(extra || []));
  }
  function row(attrs, kids) { attrs.class = 'dcm-row ' + (attrs.class || ''); attrs.type = 'button'; return h('button', attrs, kids); }

  // ── the blocker, compact ─────────────────────────────────────────────────
  function blocker() {
    return iff('blockersOn', [h('div', { class: 'dcm-blocker', role: 'status' }, [
      h('div', { class: 'dcm-blocker-t' }, [ph('ph-fill ph-warning-diamond'), h('span', {}, [tx('blockerText')])]),
      h('div', { class: 'dcm-blocker-a' }, [
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p', on: { click: 'resolveBlocker' } }, [tx('blockerCta')]),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-ghost', on: { click: 'dismissBlocker' } }, 'Dismiss'),
      ]),
    ])]);
  }

  // ── the create card (Home) and the create sheet share one form ───────────
  function createForm(inSheet) {
    return [
      h('label', { class: 'dcm-field' }, [
        h('span', { class: 'dcm-field-l' }, 'Lecture link'),
        h('input', { type: 'url', inputmode: 'url', enterkeyhint: 'go', autocomplete: 'off', placeholder: 'Paste a YouTube link',
          value: b('jobUrlVal'), 'data-tour': inSheet ? false : 'paste', class: 'dcm-input', on: { input: 'setJobUrl', keydown: 'm.jobKey' } }),
      ]),
      h('div', { class: 'dcm-create-a' }, [
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p dcm-btn-big', 'data-tour': inSheet ? false : 'start', on: { click: 'startJob' } }, [ph('ph ph-sparkle'), 'Start job']),
        h('label', { class: 'dcm-btn dcm-btn-big dcm-upload' }, [
          svg(I.upload, { width: '18', height: '18' }), 'Upload MP4',
          h('input', { type: 'file', accept: 'video/*', class: 'dcm-file', on: { input: 'm.createFile' } }),
        ]),
      ]),
      h('div', { class: 'dcm-posting' }, [
        h('span', { class: 'dcm-posting-l' }, 'Posting to'),
        h('div', { class: 'dcm-posting-r' }, [each('connections', 'conn', [
          h('button', { type: 'button', class: 'dcm-conn', title: b('conn.name'), 'aria-label': b('conn.name'), on: { click: 'conn.open' } }, [
            phb('conn.icon'), h('span', { st: 'conn.heroDotStyle' }),
          ]),
        ])]),
        h('span', { class: 'dcm-posting-s' }, [tx('connSummary')]),
      ]),
      h('p', { class: 'dcm-fine' }, 'Only content you own or are authorised to reuse. Long lectures cost more tokens — 1 per source minute. Start asks how much of the lecture to use, how long the clips should be and how the captions look before anything is spent.'),
    ];
  }

  // ── Home ─────────────────────────────────────────────────────────────────
  function homeScreen() {
    return [
      h('section', { class: 'dcm-greet' }, [h('h1', {}, [tx('m.hello')]), h('p', {}, [tx('m.today')])]),
      iff('startListOn', [h('section', { class: 'dcm-card dcm-setup' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Getting set up'), h('span', { class: 'dcm-pill' }, [tx('startDoneLabel')])]),
        each('startSteps', 's', [row({ class: cat('dcm-step ', b('s.doneCls')), on: { click: 's.open' } }, [
          h('span', { class: 'dcm-step-n' }, [tx('s.num')]),
          h('span', { class: 'dcm-step-t' }, [h('b', {}, [tx('s.title')]), h('i', {}, [tx('s.note')])]),
          svg(I.next, { width: '16', height: '16' }),
        ])]),
      ])]),
      h('section', { class: 'dcm-card dcm-create' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Create clips'), h('span', { class: 'dcm-muted' }, 'One lecture in, a week of reels out')]),
      ].concat(createForm(false))),
      h('section', { class: 'dcm-sec' }, [secHead('Happening now'), h('div', { id: 'dcmLiveSlot', class: 'dcm-live' })]),
      iff('isEmptyStudio', [h('section', { class: 'dcm-card dcm-explain' }, [
        h('strong', {}, 'Your studio is empty'),
        h('p', {}, 'What one lecture gives you: a transcript, scored moments, captioned 9:16 clips with a nasheed underneath — and nothing posts until you approve it.'),
        h('ol', {}, [
          h('li', {}, [h('b', {}, 'Paste a lecture'), ' — a URL you have permission to use, or upload the MP4.']),
          h('li', {}, [h('b', {}, 'Set the job'), ' — how much of it to use, clip length, caption style.']),
          h('li', {}, [h('b', {}, 'Review and post'), ' — approve the clips worth keeping and give them a time.']),
        ]),
      ])]),
      iff('m.notEmpty', [
        h('section', { class: 'dcm-sec' }, [
          secHead('Needs your review', 'See all', 'goQueue'),
          iff('m.hasReview', [h('div', { class: 'dcm-list' }, [each('reviewPreview', 'item', [
            h('div', { class: 'dcm-mini' }, [
              h('span', { class: 'dcm-mini-th', st: 'item.thumbStyle' }),
              h('span', { class: 'dcm-mini-t' }, [h('b', {}, [tx('item.caption')]), h('i', {}, [tx('item.score'), ' · ', tx('item.duration'), tx('item.flagText')])]),
              h('button', { type: 'button', class: 'dcm-btn dcm-btn-p dcm-btn-sm', on: { click: 'item.approve' } }, 'Approve'),
            ]),
          ])])]),
          iff('m.noReview', [empty('Nothing waiting for a decision.')]),
        ]),
        h('section', { class: 'dcm-sec' }, [
          secHead('Scheduled next', 'Schedule', 'goSchedule'),
          iff('m.hasSlots', [h('div', { class: 'dcm-list' }, [each('slots', 'slot', [
            h('div', { class: cat('dcm-mini ', b('slot.nextCls')) }, [
              h('span', { class: 'dcm-mini-time' }, [tx('slot.time')]),
              h('span', { class: 'dcm-mini-th', st: 'slot.thumbStyle' }),
              h('span', { class: 'dcm-mini-t' }, [h('b', {}, [tx('slot.title')]), h('i', {}, [phb('slot.icon'), ' ', tx('slot.dest')])]),
            ]),
          ])])]),
          iff('m.noSlots', [empty('Nothing has a slot yet. Approve a clip and give it a time.')]),
        ]),
        h('section', { class: 'dcm-sec' }, [
          secHead('Continue working', 'View all', 'goLibrary'),
          iff('m.hasLectures', [h('div', { class: 'dcm-hscroll' }, [each('m.homeLectures', 'lec', [
            h('button', { type: 'button', class: 'dcm-lcard', on: { click: 'lec.open' } }, [
              h('span', { class: 'dcm-lcard-th', st: 'lec.thumbStyle' }, [h('span', { class: cat('dcm-chip-s ', b('lec.chipCls')) }, [tx('lec.chip')])]),
              h('b', {}, [tx('lec.title')]),
              h('i', {}, [tx('lec.meta'), ' · ', tx('lec.clips')]),
            ]),
          ])])]),
          iff('m.noLectures', [empty('Nothing in your library yet. Paste a lecture link above to post your first clips.')]),
        ]),
        h('section', { class: 'dcm-sec' }, [
          secHead('This week'),
          h('div', { class: 'dcm-band' }, [
            h('div', {}, [h('b', {}, [tx('weekPosted')]), h('span', {}, 'clips posted')]),
            h('div', {}, [h('b', {}, [tx('weekHeld')]), h('span', {}, 'held for review')]),
            h('div', {}, [h('b', {}, [tx('weekMedian')]), h('span', {}, 'median score')]),
            h('div', {}, [h('b', {}, [tx('weekWorker')]), h('span', {}, 'worker time')]),
          ]),
        ]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('Recent activity', 'View all', 'm.openActivity'),
        iff('m.hasActivity', [h('div', { class: 'dcm-list' }, [each('m.homeActivity', 'act', [activityRow()])])]),
        iff('m.noActivity', [empty('Nothing has happened yet.')]),
      ]),
    ];
  }
  function activityRow() {
    return h('div', { class: 'dcm-act' }, [
      h('button', { type: 'button', class: 'dcm-act-b', on: { click: 'act.open' } }, [
        phb('act.icon'),
        h('span', { class: 'dcm-act-t' }, [h('b', {}, [tx('act.text')]), h('i', {}, [tx('act.meta')])]),
        iff('act.tag', [h('span', { class: 'dcm-tag', st: 'act.tagStyle' }, [tx('act.tag')])]),
      ]),
      h('button', { type: 'button', class: 'dcm-act-x', on: { click: 'act.dismiss' }, 'aria-label': 'Dismiss' }, [svg(I.x, { width: '14', height: '14' })]),
    ]);
  }

  // ── Clips: the queue, the lectures, one lecture ──────────────────────────
  function clipsSwitch() {
    return h('div', { class: 'dcm-seg dcm-seg-top', role: 'tablist' }, [
      h('button', { type: 'button', role: 'tab', class: cat('dcm-seg-b ', b('m.segQueue')), on: { click: 'goQueue' } }, ['To review', iff('needsCount', [h('span', { class: 'dcm-count' }, [tx('needsCount')])])]),
      h('button', { type: 'button', role: 'tab', class: cat('dcm-seg-b ', b('m.segLibrary')), on: { click: 'goLibrary' } }, 'Lectures'),
    ]);
  }
  function clipCard() {
    return h('article', { class: cat('dcm-clip ', b('it.cls')), 'data-clip': b('it.c.id') }, [
      h('button', { type: 'button', class: 'dcm-clip-th', st: 'it.c.thumbStyle', on: { click: 'it.open' }, 'aria-label': 'Open this clip' }, [
        h('span', { class: 'dcm-score' }, [tx('it.c.score')]),
        h('span', { class: 'dcm-dur' }, [tx('it.c.duration')]),
        iff('it.c.flagged', [h('span', { class: 'dcm-flag' }, 'Quote review')]),
        iff('it.c.stateChip', [h('span', { class: cat('dcm-state ', b('it.stateCls')) }, [tx('it.c.stateChip')])]),
        iff('it.c.hasRender', [h('span', { class: 'dcm-playmark' }, [svg(I.play, { width: '18', height: '18' })])]),
      ]),
      h('button', { type: 'button', class: cat('dcm-sel ', b('it.selCls')), on: { click: 'it.c.toggleSel' }, 'aria-label': 'Select', 'aria-pressed': b('it.selOn') }, [svg(I.check, { width: '14', height: '14' })]),
      h('div', { class: 'dcm-clip-b' }, [
        h('button', { type: 'button', class: 'dcm-clip-t', on: { click: 'it.open' } }, [tx('it.c.caption')]),
        h('span', { class: 'dcm-clip-l' }, [tx('it.c.lecTitle')]),
        iff('it.c.blockedNote', [h('span', { class: 'dcm-clip-n' }, [tx('it.c.blockedNote')])]),
        h('div', { class: 'dcm-clip-a', 'data-tour': b('it.decideTour') }, [
          h('button', { type: 'button', class: cat('dcm-btn dcm-btn-sm ', b('it.primaryCls')), on: { click: 'it.c.primary' } }, [phb('it.c.primaryIcon'), tx('it.c.primaryLabel')]),
          h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-ico', on: { click: 'it.c.third' }, 'aria-label': 'Reject' }, [svg(I.x, { width: '16', height: '16' })]),
          h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-ico', on: { click: 'it.c.edit' }, 'aria-label': 'Open in editor' }, [svg(I.edit, { width: '16', height: '16' })]),
        ]),
      ]),
    ]);
  }
  function queueScreen() {
    return [
      clipsSwitch(),
      h('div', { class: 'dcm-chips', 'data-tour': 'queue-tabs', role: 'tablist' }, [each('m.qTabs', 'tab', [
        h('button', { type: 'button', role: 'tab', class: cat('dcm-chip ', b('tab.cls')), on: { click: 'tab.select' } }, [tx('tab.label'), h('span', { class: 'dcm-chip-n' }, [tx('tab.count')])]),
      ])]),
      iff('anySel', [h('div', { class: 'dcm-bulk' }, [
        h('span', {}, [tx('selCount'), ' selected']),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-p', on: { click: 'selApprove' } }, 'Approve'),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm', on: { click: 'selReject' } }, 'Reject'),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm', on: { click: 'selDownload' } }, 'Download'),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-ghost', on: { click: 'selClear' } }, 'Clear'),
      ])]),
      h('p', { class: 'dcm-hint' }, 'Highest score first. Tap a clip to watch it and decide; nothing leaves this screen without your say-so.'),
      h('div', { class: 'dcm-grid' }, [each('m.queue', 'it', [clipCard()])]),
      iff('queueEmptyStream', [empty('No clips match this filter.', [
        h('button', { type: 'button', class: 'dcm-btn', on: { click: 'goLibrary' } }, 'Open the lecture library'),
      ])]),
    ];
  }
  function lectureCard() {
    return h('article', { class: 'dcm-lec' }, [
      h('button', { type: 'button', class: 'dcm-lec-th', st: 'it.l.thumbStyle', on: { click: 'it.l.openClips' }, 'aria-label': 'Open clips' }, [
        h('span', { class: cat('dcm-chip-s ', b('it.chipCls')) }, [phb('it.l.chipIcon'), ' ', tx('it.l.stateChip')]),
        iff('it.l.isProcessing', [h('span', { class: 'dcm-bar', st: 'it.l.barStyle' })]),
      ]),
      h('button', { type: 'button', class: cat('dcm-sel ', b('it.selCls')), on: { click: 'it.l.toggleSel' }, 'aria-label': 'Select', 'aria-pressed': b('it.selOn') }, [svg(I.check, { width: '14', height: '14' })]),
      h('div', { class: 'dcm-lec-b' }, [
        h('button', { type: 'button', class: 'dcm-lec-t', on: { click: 'it.l.openClips' } }, [tx('it.l.title')]),
        h('span', { class: 'dcm-lec-m' }, [phb('it.l.srcIcon'), ' ', tx('it.l.dur'), ' · ', tx('it.l.when'), ' · ', tx('it.l.clips')]),
        h('span', { class: 'dcm-lec-x' }, [tx('it.l.metric')]),
        h('div', { class: 'dcm-lec-a' }, [
          h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-p', on: { click: 'it.l.openClips' } }, 'Open clips'),
          h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm', on: { click: 'it.l.more' } }, [svg(I.more, { width: '16', height: '16' }), 'More']),
        ]),
      ]),
    ]);
  }
  function libraryScreen() {
    return [
      clipsSwitch(),
      h('div', { class: 'dcm-chips', 'data-tour': 'lib-tabs', role: 'tablist' }, [each('m.libTabs', 'tab', [
        h('button', { type: 'button', role: 'tab', class: cat('dcm-chip ', b('tab.cls')), on: { click: 'tab.select' } }, [tx('tab.label'), h('span', { class: 'dcm-chip-n' }, [tx('tab.count')])]),
      ])]),
      iff('libAnySel', [h('div', { class: 'dcm-bulk' }, [
        h('span', {}, [tx('libSelCount'), ' selected']),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-bad', on: { click: 'libSelDelete' } }, 'Delete selected'),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-ghost', on: { click: 'libSelClear' } }, 'Clear'),
      ])]),
      h('div', { class: 'dcm-toolrow' }, [
        h('span', { class: 'dcm-muted' }, [tx('librarySummary'), ' · newest first']),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-p', 'data-tour': 'lib-add', on: { click: 'm.openCreate' } }, [svg(I.plus, { width: '15', height: '15' }), 'Add a lecture']),
      ]),
      h('div', { class: 'dcm-list' }, [each('m.lectures', 'it', [lectureCard()])]),
      iff('libEmpty', [empty('Nothing here yet. Add a lecture and the worker cuts it into clips.', [
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p', on: { click: 'm.openCreate' } }, 'Add a lecture'),
      ])]),
      iff('m.stats.show', [h('section', { class: 'dcm-card dcm-stats' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Your lectures, counted')]),
        h('div', { class: 'dcm-band dcm-band-3' }, [
          h('div', {}, [h('b', {}, [tx('m.stats.made')]), h('span', {}, 'clips made')]),
          h('div', {}, [h('b', {}, [tx('m.stats.kept')]), h('span', {}, 'kept')]),
          h('div', {}, [h('b', {}, [tx('m.stats.posted')]), h('span', {}, 'posted')]),
        ]),
        iff('m.stats.best', [h('p', { class: 'dcm-stat-l' }, [h('span', { class: 'dcm-k' }, 'Clip more from '), h('b', {}, [tx('m.stats.best')]), ' — ', tx('m.stats.bestRate'), ' kept']),
        ]),
        iff('m.stats.worst', [h('p', { class: 'dcm-stat-l dcm-muted' }, [h('span', { class: 'dcm-k' }, 'Weakest so far '), h('b', {}, [tx('m.stats.worst')]), ' — ', tx('m.stats.worstRate'), ' kept'])]),
        h('p', { class: 'dcm-stat-l dcm-muted' }, [tx('m.stats.minutes'), ' source minutes clipped · ', tx('m.stats.waiting'), ' clips waiting · ', tx('m.stats.working'), ' processing']),
        iff('m.stats.hasAgain', [h('div', { class: 'dcm-again' }, [h('span', { class: 'dcm-k' }, 'Cut more from a lecture you already imported'), each('m.stats.again', 'ag', [
          row({ on: { click: 'ag.pick' } }, [ph('ph ph-arrow-counter-clockwise'), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('ag.name')]), h('i', {}, [tx('ag.length')])]), svg(I.next, { width: '15', height: '15' })]),
        ])])]),
        h('div', { class: 'dcm-storage' }, [
          h('span', { class: 'dcm-k' }, 'Storage'),
          h('span', {}, [tx('storageSummary')]),
          h('div', { class: 'dcm-storage-r' }, [
            h('span', {}, ['Source videos ', h('b', {}, [tx('storageSources')])]),
            h('span', {}, ['Rendered clips ', h('b', {}, [tx('storageClips')])]),
            h('span', {}, ['Transcripts ', h('b', {}, [tx('storageTranscripts')])]),
          ]),
        ]),
      ])]),
    ];
  }
  function detailScreen() {
    return [
      h('button', { type: 'button', class: 'dcm-back', on: { click: 'closeDetail' } }, [svg(I.back, { width: '18', height: '18' }), tx('detailBackLabel')]),
      h('section', { class: 'dcm-dhero' }, [
        h('span', { class: 'dcm-dthumb', st: 'detailThumbStyle' }),
        h('div', { class: 'dcm-dtext' }, [h('h1', {}, [tx('detailTitle')]), h('p', {}, [tx('detailMeta')]), h('p', { class: 'dcm-muted' }, [tx('detailCount')])]),
      ]),
      h('p', { class: 'dcm-hint' }, [tx('detailHint')]),
      h('div', { class: 'dcm-acts' }, [
        h('button', { type: 'button', class: 'dcm-btn', on: { click: 'openSource' } }, [svg(I.play, { width: '16', height: '16' }), 'Play source']),
        h('button', { type: 'button', class: 'dcm-btn', on: { click: 'recutClips' } }, [ph('ph ph-scissors'), 'Re-cut clips']),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p', on: { click: 'bulkAction' } }, [phb('bulkIcon'), tx('bulkLabel')]),
      ]),
      h('div', { class: 'dcm-grid' }, [each('m.detailList', 'it', [clipCard()])]),
      iff('m.detailEmpty', [empty('No clips from this lecture yet.')]),
    ];
  }

  // ── Schedule ─────────────────────────────────────────────────────────────
  function postCard() {
    return h('article', { class: cat('dcm-post ', b('it.cls')) }, [
      h('div', { class: 'dcm-post-top' }, [
        h('span', { class: 'dcm-post-time' }, [tx('it.p.time')]),
        h('span', { class: 'dcm-post-st', st: 'it.p.statusStyle' }, [tx('it.p.statusLabel')]),
      ]),
      h('div', { class: 'dcm-post-main' }, [
        h('span', { class: 'dcm-post-th', st: 'it.p.thumbStyle' }),
        h('div', { class: 'dcm-post-t' }, [
          h('b', {}, [tx('it.p.caption')]),
          h('div', { class: 'dcm-post-d' }, [each('it.p.dests', 'dst', [
            h('span', { class: 'dcm-dest', st: 'dst.style' }, [phb('dst.icon'), ' ', tx('dst.name'), iff('dst.state', [' · ', tx('dst.state')])]),
          ])]),
        ]),
      ]),
      iff('it.p.hasFailing', [h('div', { class: 'dcm-post-c' }, [each('it.p.checks', 'chk', [h('span', { st: 'chk.style' }, [phb('chk.icon'), ' ', tx('chk.label')])])])]),
      iff('it.p.failReason', [h('p', { class: 'dcm-post-f' }, [tx('it.p.failReason')])]),
      h('div', { class: 'dcm-post-a' }, [
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-ghost', on: { click: 'it.p.sendBack' } }, 'Send back to review'),
        h('button', { type: 'button', class: cat('dcm-btn dcm-btn-sm ', b('it.postCls')), on: { click: 'it.p.postNow' } }, [tx('it.p.postLabel')]),
      ]),
    ]);
  }
  function scheduleScreen() {
    return [
      iff('schedHasNext', [h('section', { class: 'dcm-card dcm-next' }, [
        h('span', { class: 'dcm-k' }, ['Next out ', tx('schedNextIn')]),
        h('b', {}, [tx('schedNextTitle')]), h('i', {}, [tx('schedNextAt')]),
      ])]),
      h('div', { class: 'dcm-meter' }, [
        h('span', {}, [tx('schedDayCount'), ' today']),
        h('div', { class: 'dcm-meter-r' }, [each('schedMeter', 'mb', [h('span', { st: 'mb.style' })])]),
      ]),
      h('div', { class: 'dcm-seg', 'data-tour': 'sched-views', role: 'tablist' }, [each('m.views', 'v', [
        h('button', { type: 'button', role: 'tab', class: cat('dcm-seg-b ', b('v.cls')), on: { click: 'v.select' } }, [tx('v.label')]),
      ])]),
      h('div', { class: 'dcm-range' }, [
        h('button', { type: 'button', class: 'dcm-hbtn', on: { click: 'schedPrev' }, 'aria-label': 'Previous' }, [svg(I.back)]),
        h('strong', {}, [tx('schedRangeLabel')]),
        h('button', { type: 'button', class: 'dcm-hbtn', on: { click: 'schedNext' }, 'aria-label': 'Next' }, [svg(I.next)]),
        iff('schedOffToday', [h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm', on: { click: 'schedToday' } }, 'Today')]),
      ]),
      iff('schedIsDay', [
        h('div', { class: 'dcm-list' }, [each('m.dayPosts', 'it', [postCard()])]),
        iff('schedDayEmpty', [empty('Nothing is scheduled for this day.')]),
        iff('schedDayCanAdd', [h('button', { type: 'button', class: 'dcm-btn dcm-btn-wide', on: { click: 'schedDayAdd' } }, [svg(I.plus, { width: '16', height: '16' }), 'Schedule an approved clip'])]),
      ]),
      iff('schedIsWeek', [h('div', { class: 'dcm-week' }, [each('m.week', 'd', [
        h('section', { class: cat('dcm-wday ', b('d.cls')) }, [
          h('div', { class: 'dcm-wday-h' }, [h('b', {}, [tx('d.name')]), h('span', {}, [tx('d.date')])]),
          each('d.slots', 's', [
            iff('s.live', [h('button', { type: 'button', class: cat('dcm-wslot ', b('s.cls')), on: { click: 's.act' } }, [
              h('span', { class: 'dcm-wslot-t' }, [tx('s.time')]),
              h('span', { class: 'dcm-wslot-x' }, [tx('s.text')]),
            ])]),
            iff('s.past', [h('span', { class: 'dcm-wslot is-past' }, [
              h('span', { class: 'dcm-wslot-t' }, [tx('s.time')]),
              h('span', { class: 'dcm-wslot-x' }, 'Passed'),
            ])]),
          ]),
        ]),
      ])])]),
      iff('schedIsMonth', [h('div', { class: 'dcm-month' }, [
        h('div', { class: 'dcm-month-h' }, [each('schedWeekdays', 'wd', [h('span', {}, [tx('wd.name')])])]),
        each('schedMonthWeeks', 'week', [h('div', { class: 'dcm-month-r' }, [each('week.cells', 'cell', [
          h('button', { type: 'button', class: cat('dcm-cell ', b('cell.cls')), on: { click: 'cell.open' } }, [
            h('span', { class: 'dcm-cell-d' }, [tx('cell.date')]),
            h('span', { class: 'dcm-pips' }, [each('cell.pips', 'pip', [h('span', { class: cat('dcm-pip ', b('pip.cls')) })])]),
            iff('cell.count', [h('span', { class: 'dcm-cell-n' }, [tx('cell.count')])]),
          ]),
        ])])]),
      ])]),
      h('section', { class: 'dcm-card', 'data-tour': 'sched-ready' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Ready to schedule'), h('span', { class: 'dcm-muted' }, [tx('schedWaitingLabel')])]),
        iff('schedHasWaiting', [h('div', { class: 'dcm-list' }, [each('schedWaiting', 'w', [
          h('div', { class: 'dcm-mini' }, [h('span', { class: 'dcm-mini-t' }, [h('b', {}, [tx('w.title')])]), h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-p', title: 'Put it in the next open slot', on: { click: 'w.schedule' } }, 'Slot it')]),
        ]), iff('schedHasWaitingMore', [h('span', { class: 'dcm-muted' }, [tx('schedWaitingMore')])])])]),
        iff('schedNoWaiting', [h('p', { class: 'dcm-muted' }, 'Everything you approved has a time. Approve more in the review queue.')]),
      ]),
      iff('schedHasOverdue', [h('section', { class: 'dcm-card dcm-card-warn' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Missed their slot'), h('span', { class: 'dcm-muted' }, [tx('schedOverdueLabel')])]),
        h('div', { class: 'dcm-list' }, [each('m.overduePosts', 'it', [postCard()])]),
      ])]),
      h('section', { class: 'dcm-card', 'data-tour': 'sched-outlets' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Where it posts')]),
        each('schedOutlets', 'o', [row({ on: { click: 'o.open' } }, [h('span', { st: 'o.dotStyle' }), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('o.name')])]), h('span', { class: 'dcm-muted', st: 'o.noteStyle' }, [tx('o.note')]), svg(I.next, { width: '15', height: '15' })])]),
        iff('schedNothingPosts', [h('p', { class: 'dcm-warn-t' }, 'No channel is switched on, so nothing posts. Connect one and switch it on.')]),
      ]),
      h('section', { class: 'dcm-card' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Posting windows')]),
        h('div', { class: 'dcm-windows' }, [h('span', {}, [tx('postWindow1')]), h('span', {}, [tx('postWindow2')]), h('span', {}, [tx('postWindow3')])]),
        h('p', { class: 'dcm-muted' }, [tx('postWindowNote')]),
        iff('dailyLimitNote', [h('p', { class: 'dcm-muted' }, [tx('dailyLimitNote')])]),
      ]),
    ];
  }

  // ── sheets ───────────────────────────────────────────────────────────────
  // Dark or light, in both sheets. Youssef could not find it under Account, and
  // More is where a phone looks for a setting -- so it is in both, built once
  // from one binding so the two can never disagree about which is on.
  function themeRow() {
    return h('div', { class: 'dcm-row dcm-theme' }, [
      ph('ph ph-moon-stars'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Appearance'), h('i', {}, [tx('m.themeNote')])]),
      h('div', { class: 'dcm-seg' }, [
        h('button', { type: 'button', class: cat('dcm-seg-b ', b('m.themeDarkCls')), on: { click: 'm.themeDark' } }, 'Dark'),
        h('button', { type: 'button', class: cat('dcm-seg-b ', b('m.themeLightCls')), on: { click: 'm.themeLight' } }, 'Light'),
      ]),
    ]);
  }
  function moreSheet() {
    return sheet('m.sheetMore', 'More', [
      h('div', { class: 'dcm-menu' }, [
        themeRow(),
        each('m.nav', 'it', [row({ on: { click: 'it.go' } }, [phb('it.icon'), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('it.label')])]), iff('it.count', [h('span', { class: 'dcm-count' }, [tx('it.count')])]), svg(I.next, { width: '15', height: '15' })])]),
        row({ on: { click: 'm.openConnections' } }, [ph('ph ph-plugs-connected'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Publishing connections'), h('i', {}, [tx('connSummary')])]), svg(I.next, { width: '15', height: '15' })]),
        row({ on: { click: 'm.goTokens' } }, [ph('ph-fill ph-coins'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Tokens & billing'), h('i', {}, [tx('tokenBalance'), ' tokens · ', tx('currentPlan')])]), svg(I.next, { width: '15', height: '15' })]),
        row({ on: { click: 'm.accountSettings' } }, [ph('ph ph-user-circle'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Account settings')]), svg(I.next, { width: '15', height: '15' })]),
        row({ on: { click: 'm.startTour' } }, [ph('ph ph-compass'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Take the tour')]), svg(I.next, { width: '15', height: '15' })]),
        h('a', { class: 'dcm-row', href: 'https://deenclipped.online' }, [ph('ph ph-arrow-square-out'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Back to main website')])]),
        row({ class: 'dcm-row-quiet', on: { click: 'm.signOut' } }, [ph('ph ph-sign-out'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Sign out')])]),
      ]),
    ]);
  }
  function searchSheet() {
    return sheet('m.sheetSearch', 'Search', [
      h('label', { class: 'dcm-field' }, [
        h('span', { class: 'dcm-sr' }, 'Search clips or lectures'),
        h('input', { type: 'search', class: 'dcm-input', placeholder: 'Search clips or lectures', autocomplete: 'off', value: b('query'), on: { input: 'setQuery' }, 'data-dcm-autofocus': '1' }),
      ]),
      iff('m.searchHas', [h('div', { class: 'dcm-menu' }, [each('m.search', 'r', [
        row({ on: { click: 'r.open' } }, [phb('r.icon'), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('r.title')]), h('i', {}, [tx('r.sub')])]), svg(I.next, { width: '15', height: '15' })]),
      ])])]),
      iff('m.searchNone', [h('p', { class: 'dcm-muted' }, 'Nothing matches yet.')]),
      iff('m.searchIdle', [h('p', { class: 'dcm-muted' }, 'Type a word from a clip, a lecture title or a link. The review queue and the library narrow to the same search.')]),
    ], { tall: true });
  }
  function activitySheet() {
    return sheet('m.sheetActivity', 'Activity', [
      h('div', { class: 'dcm-acts dcm-acts-tight' }, [
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm', on: { click: 'markRead' } }, 'Mark all read'),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-ghost', on: { click: 'clearAllActivity' } }, 'Clear all'),
      ]),
      h('div', { class: 'dcm-notif' }, [
        row({ on: { click: 'toggleDesktopNotifs' } }, [ph('ph ph-bell-ringing'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Desktop notifications'), h('i', {}, [tx('desktopNotifsNote')])]), h('span', { class: cat('dcm-switch ', b('desktopNotifsCls')), 'aria-hidden': 'true' })]),
        row({ on: { click: 'm.toggleEmail' } }, [ph('ph ph-envelope-simple'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Email notifications'), h('i', {}, [tx('m.emailNote')])]), h('span', { class: cat('dcm-switch ', b('m.emailCls')), 'aria-hidden': 'true' })]),
      ]),
      iff('activityHasRows', [h('div', { class: 'dcm-list' }, [each('activity', 'act', [activityRow()])])]),
      iff('m.noActivity', [h('p', { class: 'dcm-muted' }, 'Nothing has happened yet.')]),
      h('div', { class: 'dcm-acts dcm-acts-tight' }, [
        iff('moreActivity', [h('button', { type: 'button', class: 'dcm-link', on: { click: 'showAllActivity' } }, 'Show everything')]),
        iff('hasDismissed', [h('button', { type: 'button', class: 'dcm-link', on: { click: 'restoreActivity' } }, 'Bring dismissed ones back')]),
        h('span', { class: 'dcm-muted' }, [tx('activityTotal')]),
      ]),
    ], { tall: true });
  }
  function accountSheet() {
    return sheet('m.sheetAccount', 'Account', [
      h('div', { class: 'dcm-me' }, [
        h('span', { class: 'dcm-avatar-c dcm-avatar-lg' }, [tx('m.initials')]),
        h('span', { class: 'dcm-me-t' }, [h('b', {}, [tx('accountName')]), h('i', {}, [tx('accountEmail')]), h('em', {}, [tx('currentPlan'), ' · ', tx('tokenBalance'), ' tokens'])]),
      ]),
      h('div', { class: 'dcm-menu' }, [
        themeRow(),
        row({ on: { click: 'goTokens' } }, [ph('ph-fill ph-coins'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Tokens & billing')]), svg(I.next, { width: '15', height: '15' })]),
        row({ on: { click: 'accountSettings' } }, [ph('ph ph-user-circle'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Account settings')]), svg(I.next, { width: '15', height: '15' })]),
        row({ on: { click: 'helpGuides' } }, [ph('ph ph-lifebuoy'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Help & guides')]), svg(I.next, { width: '15', height: '15' })]),
        iff('isOperatorUser', [row({ on: { click: 'goOwner' } }, [ph('ph ph-coins'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Owner')]), svg(I.next, { width: '15', height: '15' })])]),
        h('a', { class: 'dcm-row', href: 'https://deenclipped.online' }, [ph('ph ph-arrow-square-out'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Back to main website')])]),
        row({ class: 'dcm-row-quiet', on: { click: 'signOut' } }, [ph('ph ph-sign-out'), h('span', { class: 'dcm-row-t' }, [h('b', {}, 'Sign out')])]),
      ]),
    ]);
  }
  function createSheet() {
    return sheet('m.sheetCreate', 'Create clips', createForm(true));
  }
  function reviewSheet() {
    return iff('m.rvOn', [h('div', { class: 'dcm-sheet dcm-sheet-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review clip' }, [
      h('div', { class: 'dcm-sheet-card dcm-rv' }, [
        h('div', { class: 'dcm-rv-head' }, [
          h('button', { type: 'button', class: 'dcm-hbtn', on: { click: 'm.rv.close' }, 'aria-label': 'Back' }, [svg(I.back)]),
          h('span', { class: 'dcm-rv-pos' }, [tx('m.rv.pos')]),
          h('button', { type: 'button', class: cat('dcm-hbtn ', b('m.rv.prevCls')), on: { click: 'm.rv.prev' }, 'aria-label': 'Previous clip' }, [svg(I.back, { width: '18', height: '18' })]),
          h('button', { type: 'button', class: cat('dcm-hbtn ', b('m.rv.nextCls')), on: { click: 'm.rv.next' }, 'aria-label': 'Next clip' }, [svg(I.next, { width: '18', height: '18' })]),
        ]),
        h('div', { class: 'dcm-rv-body' }, [
          h('div', { class: 'dcm-rv-frame' }, [
            h('div', { class: 'dcm-rv-video', id: 'dcmRvVideo', st: 'm.rv.thumbStyle' }, [
              iff('m.rv.noRender', [h('span', { class: 'dcm-rv-nr' }, 'Not rendered yet — this is the source frame')]),
            ]),
          ]),
          h('div', { class: 'dcm-rv-meta' }, [
            h('span', { class: 'dcm-score' }, [tx('m.rv.score')]),
            h('span', { class: 'dcm-muted' }, [tx('m.rv.meta')]),
            iff('m.rv.flagged', [h('span', { class: 'dcm-flag' }, 'Quote review')]),
            iff('m.rv.stateChip', [h('span', { class: cat('dcm-state ', b('m.rv.stateCls')) }, [tx('m.rv.stateChip')])]),
          ]),
          h('h2', { class: 'dcm-rv-t' }, [tx('m.rv.caption')]),
          h('button', { type: 'button', class: 'dcm-link dcm-rv-lec', on: { click: 'm.rv.openLecture' } }, [ph('ph ph-film-script'), tx('m.rv.lecTitle')]),
          iff('m.rv.blockedNote', [h('p', { class: 'dcm-warn-t' }, [tx('m.rv.blockedNote')])]),
          iff('m.rv.flagged', [h('p', { class: 'dcm-warn-t' }, 'This clip carries scripture, so it waits for a human decision — nothing here is auto-approved.')]),
          iff('m.rv.hasWhy', [h('details', { class: 'dcm-details', open: true }, [h('summary', {}, 'Why the worker scored it this way'), h('p', {}, [tx('m.rv.why')])])]),
          iff('m.rv.hasTranscript', [h('details', { class: 'dcm-details' }, [h('summary', {}, 'Transcript'), h('p', { class: 'dcm-transcript' }, [tx('m.rv.transcript')])])]),
        ]),
        h('div', { class: 'dcm-rv-acts', 'data-tour': 'queue-decide' }, [
          h('button', { type: 'button', class: 'dcm-btn dcm-btn-big dcm-btn-bad', on: { click: 'm.rv.reject' } }, [svg(I.x, { width: '18', height: '18' }), 'Reject']),
          h('button', { type: 'button', class: 'dcm-btn dcm-btn-big', on: { click: 'm.rv.edit' } }, [svg(I.edit, { width: '18', height: '18' }), 'Edit']),
          h('button', { type: 'button', class: cat('dcm-btn dcm-btn-big ', b('m.rv.primaryCls')), on: { click: 'm.rv.primary' } }, [svg(I.check, { width: '18', height: '18' }), tx('m.rv.primaryLabel')]),
        ]),
      ]),
    ])]);
  }

  // ── Templates ────────────────────────────────────────────────────────────
  // The desktop screen is a two-column workbench with a live 9:16 preview
  // beside the setting rows. On a phone the preview leads and the rows follow,
  // and every row is the SAME `open` handler the desktop calls -- the option
  // picker is a host dialog, which this shell already lays out as a sheet.
  function tplRows(path, title) {
    return h('section', { class: 'dcm-sec' }, [
      secHead(title),
      h('div', { class: 'dcm-list' }, [
        each(path, 'r', [row({ on: { click: 'r.open' } }, [
          phb('r.icon'), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('r.label')])]),
          h('span', { class: 'dcm-row-v' }, [tx('r.value')]), svg(I.next, { width: '15', height: '15' }),
        ])]),
      ]),
    ]);
  }
  function templatesScreen() {
    return [
      h('div', { class: 'dcm-tplhead' }, [
        h('div', { class: 'dcm-pv', id: 'dcmPvFrame' }),
        h('div', { class: 'dcm-tplpick' }, [
          h('span', { class: 'dcm-k' }, 'Clip style'),
          h('select', { class: 'dcm-select', on: { change: 'setActiveTpl' }, 'aria-label': 'Clip style' }, [
            each('m.tplOpts', 'o', [h('option', { selected: b('o.on') }, [tx('o.label')])]),
          ]),
          h('p', { class: 'dcm-muted' }, [tx('tplDirtyLabel')]),
        ]),
      ]),
      tplRows('tplStyleRows', 'Style'),
      tplRows('tplBrandRows', 'Placement'),
      h('section', { class: 'dcm-sec' }, [
        secHead('Processing'),
        h('div', { class: 'dcm-list' }, [
          each('tplAIRows', 'r', [h('div', { class: 'dcm-row' }, [
            phb('r.icon'), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('r.label')]), h('i', {}, [tx('r.note')])]),
            h('button', { type: 'button', class: cat('dcm-switch ', b('r.onCls')), on: { click: 'r.toggle' }, 'aria-label': 'Toggle' }),
          ])]),
        ]),
      ]),
      h('div', { class: 'dcm-acts' }, [
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p dcm-btn-big', on: { click: 'saveTpl' } }, 'Save and apply'),
        h('button', { type: 'button', class: 'dcm-btn', on: { click: 'saveAsStyle' } }, 'Save as new style'),
      ]),
      h('p', { class: 'dcm-fine' }, 'A style applies to every clip cut from now on. Clips already rendered keep the style they were made with.'),
    ];
  }

  // ── Nasheed library ──────────────────────────────────────────────────────
  function musicScreen() {
    return [
      h('div', { class: 'dcm-card dcm-create' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Nasheed bed'), h('span', { class: 'dcm-pill' }, [tx('nasheedVolLabel')])]),
        h('p', { class: 'dcm-muted' }, [tx('nasheedDb')]),
        h('input', { class: 'dcm-slider', type: 'range', min: '0', max: '100', value: b('nasheedVol'), on: { input: 'setVol' }, 'aria-label': 'Nasheed volume' }),
        h('label', { class: 'dcm-btn dcm-btn-p dcm-btn-wide dcm-upload' }, [
          svg(I.plus, { width: '18', height: '18' }), 'Add a nasheed',
          h('input', { class: 'dcm-file', type: 'file', accept: 'audio/*', on: { change: 'onFile' } }),
        ]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('In rotation'),
        iff('m.noTracks', [empty('No nasheeds yet. Every clip renders silent under the speech until you add one.')]),
        iff('m.hasTracks', [h('div', { class: 'dcm-list' }, [
          each('nasheedList', 't', [h('div', { class: 'dcm-track' }, [
            h('button', { type: 'button', class: 'dcm-track-p', on: { click: 't.play' }, 'aria-label': 'Play' }, [phb('t.playIcon')]),
            h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('t.name')]), h('i', {}, [tx('t.mood'), ' · ', tx('t.dur')])]),
            h('button', { type: 'button', class: 'dcm-btn dcm-btn-ico dcm-btn-ghost', on: { click: 't.remove' }, 'aria-label': 'Remove' }, [svg(I.trash)]),
          ])]),
        ])]),
      ]),
      h('p', { class: 'dcm-fine' }, 'The Quran template never carries a nasheed, whatever is in rotation.'),
    ];
  }

  // ── Performance ──────────────────────────────────────────────────────────
  function barRows(path, emptyPath, emptyText) {
    return [
      iff(emptyPath, [empty(emptyText)]),
      each(path, 'r', [h('div', { class: 'dcm-brow' }, [
        h('span', { class: 'dcm-brow-n' }, [tx('r.name')]),
        h('span', { class: 'dcm-brow-t' }, [h('span', { class: 'dcm-brow-b', st: 'r.mBar' })]),
        h('b', {}, [tx('r.value')]),
      ])]),
    ];
  }
  function performanceScreen() {
    return [
      h('div', { class: 'dcm-chips' }, [
        each('perfRanges', 'r', [h('button', { type: 'button', class: cat('dcm-chip ', b('r.onCls')), on: { click: 'r.select' } }, [tx('r.label')])]),
      ]),
      h('p', { class: 'dcm-hint' }, [tx('perfRangeNote')]),
      h('div', { class: 'dcm-tiles' }, [
        each('perfTiles', 't', [h('div', { class: 'dcm-tile' }, [
          h('b', {}, [tx('t.value')]), h('span', { class: 'dcm-tile-l' }, [tx('t.label')]), h('i', {}, [tx('t.note')]),
        ])]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('Made to posted'),
        h('div', { class: 'dcm-list' }, [
          each('perfFunnel', 'f', [h('div', { class: 'dcm-fun' }, [
            h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('f.name')]), h('i', {}, [tx('f.rate')])]),
            h('strong', {}, [tx('f.value')]),
          ])]),
        ]),
        h('p', { class: 'dcm-fine' }, [tx('perfFunnelNote')]),
      ]),
      h('section', { class: 'dcm-sec' }, [secHead('Where clips went')].concat(barRows('perfDests', 'perfDestsEmpty', 'Nothing has been published yet.'))),
      h('section', { class: 'dcm-sec' }, [secHead('When they post')].concat(barRows('perfSlots', 'perfSlotsEmpty', 'No clip has posted yet, so there is no pattern to read.'))),
      h('section', { class: 'dcm-sec' }, [
        secHead('Lectures worth clipping'),
        iff('perfLecturesEmpty', [empty('Import a lecture and this fills in.')]),
        h('div', { class: 'dcm-list' }, [
          each('perfLectures', 'l', [row({ on: { click: 'l.open' } }, [
            h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('l.name')]), h('i', {}, [tx('l.clips'), ' clips · ', tx('l.kept'), ' kept · ', tx('l.posted'), ' posted'])]),
            h('span', { class: 'dcm-row-v' }, [tx('l.score')]), svg(I.next, { width: '15', height: '15' }),
          ])]),
        ]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('Strongest clips'),
        iff('perfBoardEmpty', [empty('No clips in this window.')]),
        h('div', { class: 'dcm-list' }, [
          each('perfBoard', 'c', [h('div', { class: 'dcm-brd' }, [
            h('span', { class: 'dcm-brd-r' }, [tx('c.rank')]),
            h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('c.caption')]), h('i', {}, [tx('c.duration'), ' · ', tx('c.where')])]),
            h('span', { class: cat('dcm-tag ', b('c.mState')) }, [tx('c.state')]),
          ])]),
        ]),
        h('p', { class: 'dcm-fine' }, [tx('perfBoardNote')]),
      ]),
      h('p', { class: 'dcm-fine' }, [tx('perfFootNote')]),
    ];
  }

  // ── Tokens & billing ─────────────────────────────────────────────────────
  function tokensScreen() {
    return [
      h('div', { class: 'dcm-card dcm-create' }, [
        h('span', { class: 'dcm-k' }, 'Your plan'),
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, [tx('currentPlan')]), h('span', { class: 'dcm-pill' }, [tx('tokenBalance'), ' tokens'])]),
        h('p', { class: 'dcm-muted' }, [tx('planNote')]),
        h('div', { class: 'dcm-acts' }, [
          h('button', { type: 'button', class: 'dcm-btn', on: { click: 'changeCard' } }, 'Manage billing'),
          iff('resumeShow', [h('button', { type: 'button', class: 'dcm-btn dcm-btn-p', on: { click: 'resumeSub' } }, 'Resume plan')]),
        ]),
        h('div', { class: 'dcm-spend' }, [
          each('spendRows', 'r', [h('span', {}, [phb('r.icon'), tx('r.label'), h('b', {}, [tx('r.cost')])])]),
        ]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('Plans'),
        h('div', { class: 'dcm-seg' }, [
          each('billingPeriods', 'p', [h('button', { type: 'button', class: cat('dcm-seg-b ', b('p.onCls')), on: { click: 'p.select' } }, [tx('p.label')])]),
        ]),
        iff('periodNote', [h('p', { class: 'dcm-hint' }, [tx('periodNote')])]),
        h('div', { class: 'dcm-list' }, [
          each('tierCards', 't', [h('div', { class: cat('dcm-plan ', b('t.mCls')) }, [
            h('div', { class: 'dcm-card-h' }, [
              h('strong', {}, [tx('t.name')]),
              iff('t.tag', [h('span', { class: 'dcm-pill' }, [tx('t.tag')])]),
            ]),
            h('p', { class: 'dcm-muted' }, [tx('t.tagline')]),
            h('div', { class: 'dcm-price' }, [h('b', {}, [tx('t.price')]), h('span', {}, [tx('t.per')])]),
            iff('t.tokens', [h('span', { class: 'dcm-k' }, [tx('t.tokens')])]),
            h('span', { class: 'dcm-k' }, [tx('t.linesLabel')]),
            h('ul', { class: 'dcm-ticks' }, [each('t.lines', 'l', [h('li', {}, [tx('l.text')])])]),
            h('button', { type: 'button', class: cat('dcm-btn dcm-btn-wide ', b('t.mBtn')), on: { click: 't.choose' } }, [tx('t.cta')]),
            iff('t.foot', [h('p', { class: 'dcm-fine' }, [tx('t.foot')])]),
          ])]),
        ]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('Top up'),
        h('div', { class: 'dcm-list' }, [
          each('packs', 'p', [h('div', { class: 'dcm-pack' }, [
            h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('p.name')]), h('i', {}, [tx('p.tokens'), ' tokens · ', tx('p.rate')])]),
            h('button', { type: 'button', class: 'dcm-btn dcm-btn-sm dcm-btn-p', on: { click: 'p.buy' } }, [tx('p.price')]),
          ])]),
        ]),
        h('p', { class: 'dcm-fine' }, 'Top-up tokens never expire and are spent after your plan allowance.'),
      ]),
    ];
  }

  // ── DeenAI ───────────────────────────────────────────────────────────────
  function deenaiScreen() {
    return [
      h('div', { class: 'dcm-card dcm-create' }, [
        h('div', { class: 'dcm-card-h' }, [h('strong', {}, 'Ask DeenAI'), iff('aiCount', [h('span', { class: 'dcm-pill' }, [tx('aiCount')])])]),
        h('p', { class: 'dcm-muted' }, [tx('aiSub')]),
        h('input', { class: 'dcm-input', type: 'text', value: b('aiQ'), placeholder: 'What should I do next?', on: { input: 'aiSetQ' }, 'aria-label': 'Ask DeenAI' }),
        h('div', { class: 'dcm-chips dcm-chips-flat' }, [
          each('aiPrompts', 'p', [h('button', { type: 'button', class: 'dcm-chip', on: { click: 'p.pick' } }, [tx('p.text')])]),
        ]),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p dcm-btn-wide', on: { click: 'aiAsk' } }, [tx('aiAskLabel')]),
        h('p', { class: 'dcm-fine' }, [tx('aiAskNote')]),
        iff('aiHasAnswer', [h('p', { class: 'dcm-answer' }, [tx('aiAnswer')])]),
      ]),
      iff('aiAskGate', [h('div', { class: 'dcm-card dcm-card-warn' }, [
        h('p', { class: 'dcm-muted' }, [tx('aiGateNote')]),
        h('button', { type: 'button', class: 'dcm-btn dcm-btn-p dcm-btn-wide', on: { click: 'aiUpgrade' } }, [tx('aiGateCta')]),
      ])]),
      iff('aiHeadShow', [h('div', { class: 'dcm-card dcm-explain' }, [
        iff('aiHeadKicker', [h('span', { class: 'dcm-k' }, [tx('aiHeadKicker')])]),
        h('strong', {}, [tx('aiHeadTitle')]),
        iff('aiHeadFigureShow', [h('div', { class: 'dcm-price' }, [h('b', {}, [tx('aiHeadFigure')]), h('span', {}, [tx('aiHeadFigureLabel')])])]),
        h('p', {}, [tx('aiHeadBody')]),
      ])]),
      h('div', { class: 'dcm-tiles' }, [
        each('aiMetrics', 'm2', [h('div', { class: 'dcm-tile' }, [
          h('b', {}, [tx('m2.value')]), h('span', { class: 'dcm-tile-l' }, [tx('m2.label')]), h('i', {}, [tx('m2.note')]),
        ])]),
      ]),
      h('section', { class: 'dcm-sec' }, [
        secHead('What your records say'),
        iff('aiEmpty', [empty('Not enough decided clips yet for a pattern worth printing.')]),
        h('div', { class: 'dcm-list' }, [
          each('aiCards', 'c', [h('div', { class: 'dcm-ai' }, [
            phb('c.icon'), h('span', { class: 'dcm-row-t' }, [h('b', {}, [tx('c.title')]), h('i', {}, [tx('c.body')])]),
          ])]),
        ]),
      ]),
      h('p', { class: 'dcm-fine' }, [tx('aiFootnote')]),
    ];
  }

  function buildTemplate() {
    return [
      header(),
      h('div', { class: cat('dcm-body ', b('m.screenCls')), id: 'dcmScreen' }, [iff('m.own', [
        blocker(),
        iff('isHome', homeScreen()),
        iff('isQueue', queueScreen()),
        iff('isLibrary', libraryScreen()),
        iff('isDetail', detailScreen()),
        iff('isSchedule', scheduleScreen()),
        iff('isTemplates', templatesScreen()),
        iff('isMusic', musicScreen()),
        iff('isPerf', performanceScreen()),
        iff('isTokens', tokensScreen()),
        iff('isDeenai', deenaiScreen()),
      ])]),
      tabs(),
      moreSheet(), searchSheet(), activitySheet(), accountSheet(), createSheet(), reviewSheet(),
    ];
  }

  // ── the mobile bindings: the adapter's, plus what the shell needs ────────
  function act(fn) { return function (e) { if (e && e.preventDefault) e.preventDefault(); fn(e); }; }
  function repaint() { if (typeof global.paintStudio === 'function') global.paintStudio(); }
  /*
   * Closing is not instantaneous any more. A sheet removed from the tree the
   * moment its handler runs cannot animate out -- there is no node left to
   * animate -- so the close is two steps: the flag moves to `sheetClosing`,
   * which keeps the sheet rendered with an exit class and no pointer events,
   * and a 200ms timer then drops it for real. Every close path in this file
   * goes through closeSheet() so the behaviour cannot vary by which button
   * was pressed.
   */
  var closeTimer = null;
  function dropClosing() {
    if (closeTimer) { global.clearTimeout(closeTimer); closeTimer = null; }
    M.sheetClosing = null;
  }
  function closeSheet() {
    if (!M.sheet) return;
    dropClosing();
    M.sheetClosing = M.sheet;
    M.sheet = null;
    closeTimer = global.setTimeout(function () { closeTimer = null; M.sheetClosing = null; repaint(); }, 200);
  }
  function openSheet(name) {
    return act(function () {
      if (M.sheet === name) { closeSheet(); repaint(); return; }
      dropClosing();
      M.sheet = name;
      repaint();
    });
  }
  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'DC';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function stateCls(chip) {
    return chip === 'Approved' ? 'ok' : chip === 'Rejected' ? 'no' : chip ? 'warn' : '';
  }
  function primaryCls(label) {
    return label === 'Approved' ? 'dcm-btn-done' : label === 'Restore' ? '' : 'dcm-btn-p';
  }
  function wrapClips(list, from, ui) {
    return list.map(function (c, i) {
      return {
        c: c,
        cls: (c.stateChip === 'Rejected' ? 'is-rejected' : c.stateChip === 'Approved' ? 'is-approved' : '') + (ui.selClips[c.id] ? ' is-selected' : ''),
        selCls: ui.selClips[c.id] ? 'on' : '',
        selOn: ui.selClips[c.id] ? 'true' : 'false',
        stateCls: stateCls(c.stateChip),
        primaryCls: primaryCls(c.primaryLabel),
        decideTour: from === 'queue' && i === 0 ? 'queue-decide' : false,
        open: act(function () { M.review = { id: c.id, from: from, idx: i }; repaint(); }),
      };
    });
  }
  function wrapPosts(list) {
    return list.map(function (p) {
      return {
        p: p,
        cls: p.hasFailing ? 'is-warn' : '',
        postCls: /cursor: pointer/.test(String(p.postStyle || '')) ? 'dcm-btn-p' : 'dcm-btn-dim',
      };
    });
  }
  function searchRows(q, DATA, ui) {
    if (!q || !DATA) return [];
    var titles = {};
    (DATA.projects || []).forEach(function (p) { titles[p.id] = p.title || 'Lecture'; });
    var clips = (DATA.clips || []).filter(function (c) {
      return ((c.title || '') + ' ' + (titles[c.projectId] || '') + ' ' + (c.transcript || '')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 6);
    var lectures = (DATA.projects || []).filter(function (p) {
      return ((p.title || '') + ' ' + (p.url || '')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 4);
    return clips.map(function (c) {
      return {
        icon: 'ph ph-film-strip', title: c.title || 'Clip', sub: (titles[c.projectId] || '') + (c.score ? ' · score ' + c.score : ''),
        open: act(function () {
          ui.filter = 'all'; ui.query = ''; ui.screen = 'queue'; ui.deckMode = false;
          closeSheet(); M.review = { id: c.id, from: 'queue', idx: 0 }; repaint();
        }),
      };
    }).concat(lectures.map(function (p) {
      return {
        icon: 'ph ph-film-script', title: p.title || 'Lecture', sub: p.url ? 'Lecture · YouTube import' : 'Lecture · uploaded',
        open: act(function () { ui.query = ''; ui.screen = 'detail'; ui.openProject = p.id; closeSheet(); repaint(); }),
      };
    }));
  }

  function mobileVals(vals, DATA) {
    var ui = global.StudioAdapter.ui;
    var screen = ui.screen;
    var own = OWNED.indexOf(screen) !== -1;
    // A sheet that has done its job closes itself: the create sheet once the
    // job panel is up, the review once its screen is gone.
    if (M.sheet === 'create' && vals.jobOpen) M.sheet = null;
    if (M.review && ((M.review.from === 'queue' && screen !== 'queue') || (M.review.from === 'detail' && screen !== 'detail'))) M.review = null;

    var m = {};
    m.own = own;
    m.screen = screen;
    m.title = screen === 'detail' ? (vals.detailTitle || vals.pageTitle) : vals.pageTitle;
    m.sub = screen === 'detail' ? '' : (vals.subline || '');
    m.initials = initialsOf(vals.accountName);
    var first = String(vals.accountName || '').trim().split(/\s+/)[0] || '';
    m.hello = 'Salām' + (first && first.toLowerCase() !== 'deenclipped' ? ', ' + first : '');
    m.today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    m.tabHome = screen === 'home' ? 'on' : '';
    m.tabClips = CLIPS.indexOf(screen) !== -1 ? 'on' : '';
    m.tabSchedule = screen === 'schedule' ? 'on' : '';
    m.tabMore = (!own) ? 'on' : '';
    m.goHome = act(function (e) { closeSheet(); M.review = null; vals.goHome(e); });
    m.goClips = act(function (e) { closeSheet(); if (CLIPS.indexOf(ui.screen) === -1) vals.goQueue(e); else repaint(); });
    m.goSchedule = act(function (e) { closeSheet(); M.review = null; vals.goSchedule(e); });
    m.openMore = openSheet('more'); m.openSearch = openSheet('search'); m.openActivity = openSheet('activity');
    m.openAccount = openSheet('account'); m.openCreate = openSheet('create');
    m.closeSheet = act(function () { closeSheet(); repaint(); });
    var theme = themeNow();
    m.themeDarkCls = theme === 'dark' ? 'on' : '';
    m.themeLightCls = theme === 'light' ? 'on' : '';
    m.themeNote = theme === 'light' ? 'Paper — light, for daylight' : 'Night — the default';
    m.themeDark = act(function () { setTheme('dark'); repaint(); });
    m.themeLight = act(function () { setTheme('light'); repaint(); });
    m.openConnections = act(function () { closeSheet(); global.StudioAdapter.onOpenConnections(); });
    var shown = function (name) { return M.sheet === name || M.sheetClosing === name; };
    m.sheetMore = shown('more'); m.sheetSearch = shown('search'); m.sheetActivity = shown('activity');
    m.sheetAccount = shown('account'); m.sheetCreate = shown('create');
    m.sheetCls = M.sheetClosing ? 'is-closing' : '';
    /*
     * The screen transition, gated the way every animation in this app has to
     * be: the studio repaints on every state poll, so a class that is always
     * present would replay the entry every few seconds and read as a flicker.
     * It is stamped only on the paint where the screen actually changed and
     * falls away on the next one -- and it names the DIRECTION, from the tab
     * order, so moving right slides in from the right.
     */
    var order = ['home', 'queue', 'library', 'detail', 'schedule'];
    var rank = function (name) { var i = order.indexOf(name); return i === -1 ? order.length : i; };
    if (M.lastScreen !== screen) {
      m.screenCls = 'dcm-in-' + (rank(screen) < rank(M.lastScreen) ? 'prev' : 'next');
      M.lastScreen = screen;
      M.screenCls = m.screenCls;
      M.screenAt = Date.now();
    } else {
      m.screenCls = (Date.now() - (M.screenAt || 0) < 420) ? (M.screenCls || '') : '';
    }
    m.jobKey = function (e) { if (e && e.key === 'Enter') vals.startJob(e); };
    // The create sheet's own file input, routed straight to the lecture
    // uploader: the shared onFile routes by screen, and from the Nasheed
    // screen it would have sent a lecture to the nasheed library.
    m.createFile = function (e) {
      var files = e && e.target && e.target.files ? Array.prototype.slice.call(e.target.files) : [];
      if (files.length) { M.sheet = null; global.StudioAdapter.onUploadFile(files[0]); }
    };

    // Home
    m.notEmpty = !vals.isEmptyStudio;
    m.hasReview = (vals.reviewPreview || []).length > 0; m.noReview = !m.hasReview;
    m.hasSlots = (vals.slots || []).length > 0; m.noSlots = !m.hasSlots;
    m.homeLectures = (vals.lectures || []).slice(0, 6).map(function (l) {
      return Object.assign({}, l, { chipCls: l.chip === 'Processing' ? 'warn' : l.chip === 'Ready' ? 'ok' : 'no' });
    });
    m.hasLectures = m.homeLectures.length > 0; m.noLectures = !m.hasLectures;
    m.homeActivity = (vals.activity || []).slice(0, 4);
    m.hasActivity = m.homeActivity.length > 0; m.noActivity = !m.hasActivity;
    (vals.slots || []).forEach(function (s) { s.nextCls = s.next ? 'is-next' : ''; });
    (vals.startSteps || []).forEach(function (s) { s.doneCls = s.done ? 'is-done' : ''; });

    // Clips
    m.segQueue = screen === 'queue' ? 'on' : ''; m.segLibrary = screen === 'library' ? 'on' : '';
    m.qTabs = (vals.qTabs || []).map(function (t) { return Object.assign({}, t, { cls: t.on ? 'on' : '' }); });
    m.libTabs = (vals.libTabs || []).map(function (t) { return Object.assign({}, t, { cls: t.on ? 'on' : '' }); });
    m.queue = wrapClips(vals.queueClips || [], 'queue', ui);
    m.detailList = wrapClips(vals.detailClips || [], 'detail', ui);
    m.detailEmpty = m.detailList.length === 0;
    m.lectures = (vals.libraryItems || []).map(function (l) {
      return { l: l, selCls: ui.selLecs[l.id] ? 'on' : '', selOn: ui.selLecs[l.id] ? 'true' : 'false',
        chipCls: l.isProcessing ? 'warn' : l.stateChip === 'Ready' ? 'ok' : 'no' };
    });
    var st = vals.libStats || {};
    var pct = function (r) { return Math.round((r || 0) * 100) + '%'; };
    m.stats = {
      show: Boolean(st && !st.empty && (st.made || st.working || st.waiting)),
      made: String(st.made || 0), kept: String(st.kept || 0), posted: String(st.posted || 0),
      best: st.best ? st.best.name : '', bestRate: st.best ? pct(st.best.rate) : '',
      worst: st.worst ? st.worst.name : '', worstRate: st.worst ? pct(st.worst.rate) : '',
      minutes: String(st.minutes || 0), waiting: String(st.waiting || 0), working: String(st.working || 0),
      hasAgain: Boolean(st.again && st.again.length),
      again: (st.again || []).map(function (a) {
        return { name: a.name, length: a.length, pick: act(function () { ui.jobUrl = a.url; M.sheet = 'create'; repaint(); }) };
      }),
    };

    // Schedule
    m.views = (vals.schedViewOpts || []).map(function (v) { return Object.assign({}, v, { cls: v.on ? 'on' : '' }); });
    m.dayPosts = wrapPosts(vals.schedDayItems || []);
    m.overduePosts = wrapPosts(vals.schedOverdueItems || []);
    var days = vals.schedWeekDays || [], rows = vals.schedWeekRows || [];
    m.week = days.map(function (d, di) {
      var today = /F0D6A6/.test(String(d.style || ''));
      return {
        name: d.name, date: d.date, cls: today ? 'is-today' : '',
        slots: rows.map(function (r) {
          var cell = r.cells[di] || {};
          return {
            time: r.label, act: cell.act || act(function () {}),
            live: Boolean(cell.filled || cell.free), past: !cell.filled && !cell.free,
            cls: cell.filled ? 'is-filled' : 'is-free',
            text: cell.filled ? cell.title : 'Free — tap to schedule',
          };
        }),
      };
    });
    (vals.schedMonthWeeks || []).forEach(function (w) {
      (w.cells || []).forEach(function (cell) {
        cell.cls = (cell.isToday ? 'is-today ' : '') + (cell.inMonth ? '' : 'is-out ') + (cell.past ? 'is-past' : '');
        (cell.pips || []).forEach(function (pip) { pip.cls = (pip.filled ? 'on ' : '') + (pip.extra ? 'extra' : ''); });
      });
    });

    // Sheets
    var navSeen = {};
    m.nav = [].concat(vals.navProduce || [], vals.navSetup || [], vals.navTail || []).filter(function (it) {
      if (!it || ['home', 'queue', 'schedule'].indexOf(it.key) !== -1 || navSeen[it.key]) return false;
      navSeen[it.key] = true; return true;
    });
    // Youssef, 2 Sept 2026: "when I click ANY tab it should open the page
    // close the more selection page". Every row in the More sheet therefore
    // goes through one wrapper that clears the sheet BEFORE delegating to the
    // handler the rail itself uses -- the destination is never re-implemented
    // here, only the dismissal is added.
    var closeThen = function (fn) {
      // Repaint AFTER the handler as well as before it: a destination that
      // opens a host DIALOG rather than changing the screen (Account settings)
      // never triggers a studio paint of its own, so the sheet stayed on
      // screen with M.sheet already null -- shut in state and open on screen.
      return act(function (e) { closeSheet(); if (typeof fn === 'function') fn(e); repaint(); });
    };
    m.nav = m.nav.map(function (it) { return Object.assign({}, it, { go: closeThen(it.click) }); });
    m.goTokens = closeThen(vals.goTokens);
    m.accountSettings = closeThen(vals.accountSettings);
    m.startTour = closeThen(vals.startTour);
    m.signOut = closeThen(vals.signOut);
    var q = String(ui.query || '').trim().toLowerCase();
    m.search = M.sheet === 'search' ? searchRows(q, DATA, ui) : [];
    m.searchHas = m.search.length > 0; m.searchNone = Boolean(q) && !m.searchHas; m.searchIdle = !q;
    var emailServer = !(DATA && DATA.emailNotifs === false);
    if (global.__dcEmailPending !== undefined && emailServer === global.__dcEmailPending) delete global.__dcEmailPending;
    var emailOn = global.__dcEmailPending !== undefined ? global.__dcEmailPending : emailServer;
    m.emailNote = emailOn ? 'On — clip ready, posted and failure emails' : 'Off — no product emails will be sent';
    m.emailCls = emailOn ? 'on' : '';
    m.toggleEmail = act(function () { global.__dcEmailPending = !emailOn; global.StudioAdapter.onToggleEmailNotifs(); repaint(); });

    // The focused review: one clip, from whichever list it was opened in.
    m.rvOn = false;
    if (M.review) {
      var list = M.review.from === 'detail' ? (vals.detailClips || []) : (vals.queueClips || []);
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === M.review.id) { idx = i; break; }
      if (idx === -1) {
        // The clip left this list (decided, filtered out): advance to what is
        // now in its place, the same way the deck does, or close on an empty list.
        idx = Math.min(M.review.idx || 0, list.length - 1);
        if (idx >= 0) M.review.id = list[idx].id; else M.review = null;
      }
      if (M.review) {
        M.review.idx = idx;
        var clip = list[idx];
        var raw = ((DATA && DATA.clips) || []).filter(function (c) { return c.id === clip.id; })[0] || {};
        var go = function (n) { return act(function () { if (list[n]) { M.review = { id: list[n].id, from: M.review.from, idx: n }; repaint(); } }); };
        m.rvOn = true;
        m.rv = {
          id: clip.id, caption: clip.caption, score: clip.score, duration: clip.duration, style: clip.style || '',
          meta: clip.duration + (clip.style ? ' \u00b7 ' + clip.style : ''),
          lecTitle: clip.lecTitle, flagged: clip.flagged, blockedNote: clip.blockedNote, stateChip: clip.stateChip, stateCls: stateCls(clip.stateChip),
          thumbStyle: clip.thumbStyle, hasRender: clip.hasRender, noRender: !clip.hasRender, videoUrl: clip.videoUrl, poster: raw.thumbUrl || '',
          why: clip.scoreWhy, hasWhy: Boolean(clip.scoreWhy),
          transcript: String(raw.transcript || ''), hasTranscript: Boolean(raw.transcript),
          pos: (idx + 1) + ' of ' + list.length,
          prevCls: idx > 0 ? '' : 'is-off', nextCls: idx < list.length - 1 ? '' : 'is-off',
          prev: go(idx - 1), next: go(idx + 1),
          close: act(function () { M.review = null; repaint(); }),
          primary: clip.primary, primaryLabel: clip.primaryLabel, primaryCls: primaryCls(clip.primaryLabel),
          reject: clip.third, edit: clip.edit, openLecture: clip.openLecture,
        };
      }
    }
    if (!m.rvOn) m.rv = { close: act(function () {}), prev: act(function () {}), next: act(function () {}), primary: act(function () {}), reject: act(function () {}), edit: act(function () {}), openLecture: act(function () {}) };


    // ── the screens the shell now draws itself ────────────────────────────
    // Fields only: every handler below is the adapter's own, so the phone and
    // the desktop cannot disagree about what a control does.
    m.tplOpts = (vals.tplList || []).map(function (label) {
      return { label: label, on: label === vals.activeTpl ? 'selected' : false };
    });
    (vals.tplAIRows || []).forEach(function (r) { r.onCls = r.on ? 'on' : ''; });
    m.hasTracks = (vals.nasheedList || []).length > 0;
    m.noTracks = !m.hasTracks;
    (vals.perfRanges || []).forEach(function (r) { r.onCls = r.on ? 'on' : ''; });
    var barFill = function (r, bad) {
      r.mBar = 'width: ' + (r.pct || 3) + '%; background: ' + (bad ? '#A64738' : '#A2762C') + ';';
    };
    (vals.perfDests || []).forEach(function (r) { barFill(r, r.failed); });
    (vals.perfSlots || []).forEach(function (r) { barFill(r, false); });
    (vals.perfBoard || []).forEach(function (c) {
      c.mState = c.state === 'Posted' ? 'is-ok' : c.state === 'Discarded' ? 'is-bad' : c.state === 'Approved' ? 'is-gold' : 'is-quiet';
    });
    (vals.billingPeriods || []).forEach(function (pr) { pr.onCls = pr.on ? 'on' : ''; });
    (vals.tierCards || []).forEach(function (t) {
      t.mCls = (t.isCurrent ? 'is-current ' : '') + (t.tier === 'studio' ? 'is-top' : '');
      t.mBtn = t.disabled ? 'dcm-btn-dim' : 'dcm-btn-p';
    });

    var out = Object.create(vals);
    out.m = m;
    return out;
  }

  // ── mounting ─────────────────────────────────────────────────────────────
  function isActive() {
    if (!global.matchMedia || !global.document) return false;
    if (!global.matchMedia(MQ).matches) return false;
    return Boolean(global.document.body && global.document.body.classList.contains('studio-active'));
  }
  function mount() {
    if (root && root.isConnected) return;
    var doc = global.document;
    root = doc.getElementById('dcMobile') || doc.createElement('div');
    root.id = 'dcMobile';
    root.setAttribute('data-host-owned', '');
    // BEFORE #studio, deliberately: the tour finds its spotlight target with a
    // document-order querySelector, and on a phone the element that carries
    // data-tour="paste" must be this shell's, not the hidden desktop one.
    var studioEl = doc.getElementById('studio');
    if (!root.isConnected) {
      if (studioEl && studioEl.parentNode) studioEl.parentNode.insertBefore(root, studioEl);
      else doc.body.appendChild(root);
    }
    if (!template) template = buildTemplate();
    studio = global.StudioRuntime.mount(root, template);
    if (!listening) {
      listening = true;
      doc.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !root || !root.isConnected) return;
        if (M.review) { M.review = null; repaint(); } else if (M.sheet) { closeSheet(); repaint(); }
      });
      if (global.matchMedia) {
        var mq = global.matchMedia(MQ);
        var onChange = function () { repaint(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
      }
    }
  }
  function unmount() {
    var doc = global.document;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; studio = null;
    if (rvVideo) { try { rvVideo.pause(); } catch (err) { /* nothing to pause */ } rvVideo = null; }
    if (doc && doc.body) { doc.body.classList.remove('dcm-on', 'dcm-own', 'dcm-sheet', 'dcm-light'); }
    stampOverlays(null);
  }
  // Stamp the design's open overlays so the stylesheet can turn each into a
  // bottom sheet. Re-done on EVERY paint from the current flags: the patcher
  // pairs root children by index, so a stamp left on a node could outlive the
  // overlay it was for and land on the next one to render in that slot.
  function stampOverlays(vals) {
    var doc = global.document;
    var shell = doc && doc.querySelector('#studio > div');
    if (!shell) return;
    var open = [];
    if (vals) OVERLAYS.forEach(function (pair) { var v = vals[pair[1]]; if (Array.isArray(v) ? v.length : Boolean(v)) open.push(pair[0]); });
    var after = false, n = 0;
    for (var i = 0; i < shell.children.length; i++) {
      var child = shell.children[i];
      if (child.tagName === 'MAIN') { after = true; continue; }
      if (!after) continue;
      if (child.hasAttribute('data-host-owned')) continue;
      var name = open[n++];
      if (name) { if (child.getAttribute('data-host-ov') !== name) child.setAttribute('data-host-ov', name); }
      else if (child.hasAttribute('data-host-ov')) child.removeAttribute('data-host-ov');
    }
  }
  function dockLive() {
    var doc = global.document;
    var slot = doc.getElementById('dcmLiveSlot');
    var live = doc.getElementById('studioLiveHome');
    if (!slot || !live) return;
    if (live.parentElement !== slot) slot.appendChild(live);
    live.classList.add('slh-docked');
  }
  function mountReviewVideo(mv) {
    var doc = global.document;
    var slot = doc.getElementById('dcmRvVideo');
    if (!slot || !mv.m.rvOn) {
      if (rvVideo) { try { rvVideo.pause(); } catch (err) { /* already gone */ } if (rvVideo.parentNode) rvVideo.parentNode.removeChild(rvVideo); rvVideo = null; }
      return;
    }
    if (!rvVideo) {
      rvVideo = doc.createElement('video');
      rvVideo.setAttribute('data-host-owned', '');
      rvVideo.setAttribute('playsinline', '');
      rvVideo.playsInline = true;
      rvVideo.controls = true;
      rvVideo.preload = 'metadata';
      rvVideo.className = 'dcm-rv-v';
    }
    if (rvVideo.parentElement !== slot) slot.insertBefore(rvVideo, slot.firstChild);
    var src = mv.m.rv.hasRender ? String(mv.m.rv.videoUrl) : '';
    if (rvVideo.dataset.src !== src) {
      rvVideo.dataset.src = src;
      if (src) rvVideo.src = src; else { rvVideo.removeAttribute('src'); try { rvVideo.load(); } catch (err) { /* nothing loaded */ } }
    }
    rvVideo.style.display = src ? '' : 'none';
    if (mv.m.rv.poster && rvVideo.poster !== mv.m.rv.poster) rvVideo.poster = mv.m.rv.poster;
  }
  function focusAuto() {
    var el = global.document.querySelector('#dcMobile [data-dcm-autofocus]');
    if (el && el !== global.document.activeElement && !el.dataset.dcmFocused) { el.dataset.dcmFocused = '1'; try { el.focus({ preventScroll: true }); } catch (err) { /* not focusable yet */ } }
  }

  function paintMobile(vals, DATA) {
    if (!isActive()) { if (root) unmount(); return; }
    mount();
    var mv = mobileVals(vals, DATA);
    studio.render(mv);
    var body = global.document.body;
    body.classList.add('dcm-on');
    body.classList.toggle('dcm-light', themeNow() === 'light');
    body.classList.toggle('dcm-own', Boolean(mv.m.own));
    body.classList.toggle('dcm-sheet', Boolean(M.sheet || M.review));
    stampOverlays(vals);
    dockLive();
    mountReviewVideo(mv);
    focusAuto();
  }

  global.StudioMobile = {
    template: buildTemplate,
    vals: mobileVals,
    state: M,
    active: isActive,
    OVERLAYS: OVERLAYS,
    OWNED: OWNED,
    query: MQ,
  };
  global.paintMobile = paintMobile;
})(typeof window !== 'undefined' ? window : globalThis);
