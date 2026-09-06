/*
 * studio-templates.js — the desktop Templates screen.
 *
 * HAND-WRITTEN. A design re-import never touches this file, and nothing in it
 * names one of the export's hashed classes.
 *
 * WHY IT EXISTS. Youssef, 6 Sept 2026: "I need the template to be REDONE same
 * kinda thing a lot cleaner and just remake the whole layout and how it works
 * ... PERFECTLY LOOKING SIMPLE NICE WITH MANY OPTIONS TO CHOOSE FROM AND
 * SAVING AND ETC WORKING", then "clean up sliders and options add drop boxes
 * and etc make it look clean yet perfect with many configurations and sort out
 * a new system if needed in terms of saving templates".
 *
 * The design export's Templates screen offered NINE settings against a schema
 * of sixty-odd, and every one of them was the same control: a row that opens
 * an option sheet. Everything else -- every colour, every size, every timing --
 * was reachable only through the host-injected caption panel docked under one
 * row, or not at all. So the screen that decides how every clip looks showed a
 * fraction of what a template holds.
 *
 * WHAT THIS IS. A SECOND TEMPLATE over the SAME bindings, exactly the device
 * studio-mobile.js established: authored in the runtime's own AST, rendered by
 * the SAME StudioRuntime (same diffing patcher, same delegated events, same
 * handler table) from the SAME StudioAdapter.bindings() object the desktop
 * template renders from. Every write goes through `saveStyle`, the one funnel
 * the whole editor already uses -- so undo, the draft, the debounce and the
 * per-clip routing come with it and there is no second copy of any logic.
 *
 * The controls themselves are SPECIFIED IN THE ADAPTER (`tplControls`), not
 * here: what a field is, its range, its unit and when it may be shown are
 * answers a test can read as executed output, and the phone can draw the same
 * list later without a second table.
 *
 * WHAT IT REPLACES. While this is mounted the generated screen is hidden in
 * place (data-host-style + display:none) rather than removed -- taking a
 * generated node OUT shortens the live list against the rendered one and the
 * patcher then pairs every sibling one across, which is the fault v3.124.5
 * spent a session on. Its anchors still exist for the walkthrough, which is
 * why this shell carries its OWN data-tour attributes: tourAnchorEl is a
 * document-order querySelector, and #dcTemplates precedes #studio's screens.
 */
(function (global) {
  'use strict';

  var root = null, studio = null, template = null, hidden = null;

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
  function ph(cls) { return h('i', { class: cls, 'aria-hidden': 'true' }); }

  /*
   * ONE ROW BUILDER FOR EVERY KIND OF CONTROL.
   *
   * Alignment is by GEOMETRY, never by a nudge (the standing rule): the row is
   * a three-column grid -- label, control, readout -- so every label's left
   * edge, every control's left edge and every readout's right edge is ONE
   * value down the whole column by construction. A <select> spans the last two
   * columns so its right edge lands on the readouts' right edge rather than
   * stopping short of it, which is what would leave the one ragged edge.
   */
  function controlRow() {
    return h('div', { class: cat('dct-row dct-is-', b('c.kind')) }, [
      h('span', { class: 'dct-k' }, [h('span', { class: 'dct-kl' }, [tx('c.label')])]),
      h('span', { class: 'dct-c' }, [
        iff('c.isSelect', [
          h('select', { class: 'dct-select', 'aria-label': b('c.label'), value: b('c.value'), on: { change: 'c.set' } }, [
            each('c.opts', 'o', [h('option', { value: b('o.value'), selected: b('o.on') }, [tx('o.label')])]),
          ]),
        ]),
        iff('c.isRange', [
          h('input', {
            class: 'dct-range', type: 'range', 'aria-label': b('c.label'),
            min: b('c.min'), max: b('c.max'), step: b('c.step'), value: b('c.value'),
            st: b('c.fillStyle'), on: { input: 'c.set' },
          }),
        ]),
        iff('c.isColor', [
          h('label', { class: 'dct-swatch', st: b('c.swatchStyle') }, [
            h('input', { class: 'dct-colour', type: 'color', 'aria-label': b('c.label'), value: b('c.value'), on: { input: 'c.set' } }),
          ]),
        ]),
        iff('c.isSwitch', [
          h('button', {
            type: 'button', class: cat('dct-switch ', b('c.onCls')), role: 'switch',
            'aria-checked': b('c.on'), 'aria-label': b('c.label'), on: { click: 'c.toggle' },
          }, [h('i', {})]),
        ]),
      ]),
      iff('c.readout', [h('span', { class: 'dct-v' }, [tx('c.readout')])]),
      iff('c.note', [h('span', { class: 'dct-note' }, [tx('c.note')])]),
    ]);
  }

  function group(title, listPath, extra) {
    var kids = [
      h('div', { class: 'dct-gh' }, [h('span', {}, title)]),
      h('div', { class: 'dct-rows' }, [each(listPath, 'c', [controlRow()])]),
    ];
    return h('section', { class: 'dct-sec' }, extra ? kids.concat(extra) : kids);
  }

  // ── the preview frame ────────────────────────────────────────────────────
  // #studioPreviewPic docks in as the FIRST child (paintPreviewPic), and
  // paintSafeChrome appends its shaded bands after these, so the z-index
  // ladder is: picture 0, shade 1, safe edge 2, guides 6, caption 8.
  function frame() {
    return h('div', { class: 'dct-frame', id: 'dctPvFrame' }, [
      h('span', { class: 'dct-safe', st: cat(b('safeBoxStyle'), ' position: absolute; z-index: 2; pointer-events: none;') }),
      h('span', { st: b('guideVStyle') }),
      h('span', { st: b('guideHStyle') }),
      h('div', { class: 'dct-cap', id: 'dctCap', st: b('capStyle'), on: { mousedown: 'dragCaption' } }, [
        tx('capPreviewText'),
        h('span', { st: b('capHandle') }),
      ]),
      h('div', { class: 'dct-mark', st: b('markStyle'), on: { mousedown: 'dragMark' } }, [
        tx('markText'),
        h('span', { st: b('markHandle') }),
      ]),
    ]);
  }

  function buildTemplate() {
    return [
      // ── toolbar ──────────────────────────────────────────────────────────
      h('div', { class: 'dct-bar' }, [
        h('div', { class: 'dct-pick' }, [
          h('span', { class: 'dct-pl' }, 'Clip style'),
          // tplList is a list of STRINGS, and selection is keyed by the name --
          // the design's own shape, kept so `setActiveTpl` needs no second
          // form. `selected` is deliberately absent: applyFormValues sets the
          // property from the select's own `value` attribute after every swap,
          // which is the one thing that makes a rendered dropdown open on the
          // right row.
          h('select', {
            class: 'dct-select dct-style', 'data-tour': 'tpl-pick', 'aria-label': 'Clip style',
            value: b('activeTpl'), on: { change: 'setActiveTpl' },
          }, [each('tplList', 'o', [h('option', { value: b('o') }, [tx('o')])])]),
        ]),
        h('span', { class: 'dct-dirty' }, [
          h('i', { st: b('tplDirtyDotStyle') }),
          h('span', {}, [tx('tplDirtyLabel')]),
          iff('tplVersion', [h('em', {}, [tx('tplVersion')])]),
        ]),
        h('span', { class: 'dct-sp' }),
        h('button', { type: 'button', class: 'dct-icon', title: 'Undo', 'aria-label': 'Undo', on: { click: 'undoEdit' } }, [ph('ph ph-arrow-counter-clockwise')]),
        h('button', { type: 'button', class: 'dct-icon', title: 'Redo', 'aria-label': 'Redo', on: { click: 'redoEdit' } }, [ph('ph ph-arrow-clockwise')]),
        h('button', { type: 'button', class: 'dct-btn', on: { click: 'resetTpl' } }, 'Reset'),
        // Disabled with nothing to save. A save is the one action that bumps the
        // template's version AND re-renders every unposted clip, so pressing it
        // on an unchanged template spends a single-slot worker for nothing --
        // measured 6 Sept 2026, v3 -> v4 with no pending edit. The runtime omits
        // an attribute bound to `false`, so this is a real boolean.
        h('button', {
          type: 'button', class: 'dct-btn dct-primary', 'data-tour': 'tpl-save',
          disabled: b('tplSaveDisabled'), on: { click: 'saveTpl' },
        }, 'Save and apply'),
      ]),

      // ── body ─────────────────────────────────────────────────────────────
      h('div', { class: 'dct-body' }, [
        h('div', { class: 'dct-left' }, [
          // BRAND FIRST (Youssef, 6 Sept 2026: "Brand should be at the top of
          // the configurator"). The watermark and the promo bar are the two
          // settings that belong to the ACCOUNT rather than to this template,
          // so they are what somebody checks before touching anything else --
          // and they were the one group you had to scroll past six others to
          // reach. The two switches are host-rendered (paintWatermark) and
          // dock into this slot; the template's own watermark placement rows
          // sit under them.
          h('section', { class: 'dct-sec' }, [
            h('div', { class: 'dct-gh' }, [h('span', {}, 'Brand')]),
            h('div', { class: 'dct-slot', id: 'dctBrandSlot' }),
            h('div', { class: 'dct-rows' }, [each('tplControls.brand', 'c', [controlRow()])]),
          ]),
          group('Clip layout', 'tplControls.layout'),
          group('Captions', 'tplControls.captions'),
          group('Caption text', 'tplControls.text'),
          group('Outline and box', 'tplControls.outline'),
          iff('tplControls.highlight', [group('Highlighted word', 'tplControls.highlight')]),
          iff('tplControls.animation', [group('Animation', 'tplControls.animation')]),
          group('Look', 'tplControls.look'),
          group('Processing', 'tplControls.processing'),

          // ── saved looks ───────────────────────────────────────────────────
          h('section', { class: 'dct-sec' }, [
            h('div', { class: 'dct-gh' }, [h('span', {}, 'Saved looks')]),
            iff('hasPresets', [h('div', { class: 'dct-presets' }, [
              each('stylePresets', 'p', [h('div', { class: 'dct-preset' }, [
                h('span', { class: 'dct-pn' }, [
                  h('strong', {}, [tx('p.name')]),
                  iff('p.note', [h('span', {}, [tx('p.note')])]),
                ]),
                h('button', { type: 'button', class: 'dct-btn dct-sm', on: { click: 'p.apply' } }, 'Apply'),
                h('button', { type: 'button', class: 'dct-icon dct-sm', title: 'Rename', 'aria-label': 'Rename', on: { click: 'p.rename' } }, [ph('ph ph-pencil-simple')]),
                h('button', { type: 'button', class: 'dct-icon dct-sm', title: 'Delete', 'aria-label': 'Delete', on: { click: 'p.remove' } }, [ph('ph ph-trash')]),
              ])]),
            ])]),
            h('div', { class: 'dct-save' }, [
              h('input', {
                class: 'dct-text', type: 'text', placeholder: 'Name this look', maxlength: '40',
                'aria-label': 'Name this look', value: b('presetName'), on: { input: 'setPresetName' },
              }),
              h('button', { type: 'button', class: 'dct-btn', on: { click: 'savePreset' } }, 'Save look'),
            ]),
            h('p', { class: 'dct-fine' }, 'A saved look is every style setting on this screen, kept on your account. Applying one loads it as an unsaved change, so nothing re-renders until you press Save and apply.'),
            iff('tplCustomised', [
              h('button', { type: 'button', class: 'dct-btn dct-wide', on: { click: 'restoreTpl' } }, 'Restore the shipped defaults'),
            ]),
          ]),
        ]),

        h('div', { class: 'dct-right' }, [
          h('div', { class: 'dct-stage' }, [
            frame(),
            h('div', { class: 'dct-play', on: { click: 'togglePreviewPlay' } }, [
              ph(cat(b('pvPlayIcon'), ' dct-pi')),
              h('span', { class: 'dct-track' }, [h('span', { class: 'dct-fill', st: b('pvFillStyle') })]),
              h('span', { class: 'dct-time' }, [tx('pvTimeLabel')]),
            ]),
          ]),
          h('div', { class: 'dct-layers' }, [
            each('layerBtns', 'l', [
              h('button', { type: 'button', st: b('l.style'), on: { click: 'l.select' } }, [ph(b('l.icon')), tx('l.label')]),
            ]),
            h('span', { class: 'dct-sp' }),
            h('select', { class: 'dct-select dct-ratio', 'aria-label': 'Frame shape', value: b('safePresetLabel'), on: { change: 'setRatio' } }, [
              each('ratioOpts', 'r', [h('option', { value: b('r.value'), selected: b('r.on') }, [tx('r.label')])]),
            ]),
          ]),
          h('p', { class: 'dct-hint' }, [ph('ph ph-hand-grabbing'), tx('safeHint')]),
          h('button', { type: 'button', class: 'dct-btn dct-wide', 'data-tour': 'ed-preview', on: { click: 'previewClip' } }, 'Preview on a real clip'),
          // The sentence that stood here -- "a style applies to every clip cut
          // from now on" -- is the SCREEN'S OWN SUBTITLE, four inches above it.
          // Two answers to one question, and it cost the preview 46px of the
          // height that is the whole point of this column.
        ]),
      ]),
    ];
  }

  // ── values ───────────────────────────────────────────────────────────────
  // Object.create so the whole adapter binding set is reachable through the
  // prototype chain and nothing is copied: one object, two templates.
  function templateVals(vals) {
    return Object.create(vals);
  }

  // ── mounting ─────────────────────────────────────────────────────────────
  // The generated screen wrapper is found by the walkthrough anchor it carries,
  // never by a hashed class -- a design re-import renumbers every one of those.
  function generatedScreen(doc) {
    var main = doc.querySelector('#studio main');
    if (!main) return null;
    for (var i = 0; i < main.children.length; i++) {
      var kid = main.children[i];
      // THIS SHELL CARRIES THE SAME ANCHOR, deliberately -- the walkthrough
      // spotlights Save on the screen a person can actually see, and
      // tourAnchorEl is a document-order lookup that finds ours first. So the
      // finder must skip its own node: a bare querySelector for the anchor
      // returned #dcTemplates, and the next repaint hid the screen it had just
      // drawn and put the generated one back.
      if (kid === root || kid.id === 'dcTemplates' || kid.id === 'dcTopbar') continue;
      if (kid.querySelector('[data-tour="tpl-save"]')) return kid;
    }
    return null;
  }

  function mount(doc) {
    var screen = generatedScreen(doc);
    if (!screen) return false;
    if (!root || !root.isConnected) {
      root = doc.getElementById('dcTemplates') || doc.createElement('div');
      root.id = 'dcTemplates';
      root.setAttribute('data-host-owned', '');
      screen.parentNode.insertBefore(root, screen);
      if (!template) template = buildTemplate();
      // ITS OWN HANDLER ATTRIBUTE. This runtime is mounted INSIDE #studio, so
      // every event in it bubbles to the outer runtime's delegated listener as
      // well -- which would read data-dc-h, look the index up in ITS table and
      // call something else entirely. Measured: picking a caption mode called
      // the outer handler at that index and tore the screen down.
      studio = global.StudioRuntime.mount(root, template, { attr: 'data-dct-h' });
    }
    // Hidden IN PLACE. Removing it would shorten the live child list against
    // the rendered one and the patcher would pair every later sibling across.
    if (hidden !== screen) {
      show(hidden);
      hidden = screen;
    }
    screen.setAttribute('data-host-style', '');
    screen.style.display = 'none';
    return true;
  }

  function show(node) {
    if (!node) return;
    node.style.removeProperty('display');
    if (!node.getAttribute('style')) node.removeAttribute('style');
  }

  function unmount() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; studio = null;
    show(hidden);
    hidden = null;
  }

  /*
   * THE FRAME IS SIZED BY THE ROOM THE COLUMN HAS, NOT BY A GUESS.
   *
   * Measured from the ROW and the column's other children -- never from the
   * frame's own box, and never from a container the frame can grow. Reading a
   * height the frame contributes to feeds itself (v3.75.4: 1055 -> 1543 ->
   * 40711px across four repaints), so `.dct-right` is min-height:0 and cannot
   * push the row taller, and every row measured here is flex:none.
   */
  // Below this a 9:16 frame is a thumbnail rather than a preview, and the
  // preview IS the screen -- so the column scrolls instead of shrinking
  // further. `.dct-right` is overflow-y: auto for exactly that, never hidden:
  // content drawn and then clipped with nothing able to scroll it is the fault
  // v3.126.0 spent a release on.
  // THE ONLY CEILING IS THE COLUMN'S OWN WIDTH, and until v3.134.3 there was an
  // arbitrary 620 beside it. The preview IS this screen, so a cap that holds it
  // short of the room it has leaves the right-hand half half-empty -- measured
  // at 1920x1080: 759px of room, a frame pinned to 620, 139px unused. That is
  // the same fault the generated screen's own sizing carried until v3.132.0
  // ("The right side video should fill as much as the page can"), and shipping
  // it on the screen people actually see would have been that fix undone.
  //
  // The width cap is the real constraint and replaces it: a frame given the
  // full height wants to be `height * ratio` wide, and a WIDE template blows
  // straight through the column -- a 16:9 export at 759px of room asks for
  // 1349px inside a 778px one. `max-width: 100%` alone does NOT save it: with
  // an explicit height and aspect-ratio, clamping the width BREAKS the ratio
  // rather than the height, so the preview would render the wrong SHAPE and
  // quietly misrepresent the export. Every shipped template is 1080x1920 and
  // width/height are excluded from the style fields, so this is latent today --
  // but the safe-zone table already follows the output shape, so the data model
  // permits it and the guard costs one line.
  var FRAME_MIN = 300;
  function fitFrame() {
    if (!root || !root.isConnected) return;
    var right = root.querySelector('.dct-right');
    var box = root.querySelector('.dct-frame');
    if (!right || !box) return;
    var room = right.clientHeight;
    if (!room) return;
    // BOTH GAPS ARE READ, NEVER TYPED. They were hardcoded at 10 while the
    // stylesheet said 12, so the frame was sized 6px taller than the room it
    // had -- invisible because the column simply absorbed it, and exactly the
    // kind of drift a second copy of a number produces.
    var colGap = parseFloat(global.getComputedStyle(right).rowGap) || 0;
    var used = 0;
    for (var i = 0; i < right.children.length; i++) {
      var kid = right.children[i];
      if (kid.contains(box)) {
        // The stage holds the frame AND the play bar; only the bar counts.
        for (var j = 0; j < kid.children.length; j++) {
          if (!kid.children[j].contains(box)) used += kid.children[j].offsetHeight;
        }
        used += parseFloat(global.getComputedStyle(kid).rowGap) || 0;
        continue;
      }
      used += kid.offsetHeight;
    }
    var gaps = colGap * Math.max(0, right.children.length - 1);
    // The ratio comes from the template's own aspect (w/h), read off the style
    // the painter set rather than from the frame's measured box -- measuring
    // the box to size the box is the feedback this whole function avoids.
    var aspect = String(box.style.aspectRatio || '9 / 16').split('/');
    var ratio = (Number(aspect[0]) || 9) / (Number(aspect[1]) || 16);
    var cs = global.getComputedStyle(right);
    var usableW = right.clientWidth
      - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var byWidth = ratio > 0 ? usableW / ratio : Infinity;
    var wanted = Math.round(Math.max(FRAME_MIN, Math.min(byWidth, room - used - gaps)));
    if (root.style.getPropertyValue('--dct-frame-h') !== wanted + 'px') {
      root.style.setProperty('--dct-frame-h', wanted + 'px');
    }
  }

  var listening = false;
  function paintTemplates(vals) {
    var doc = global.document;
    if (!doc) return;
    var owned = global.StudioAdapter && global.StudioAdapter.ui.screen === 'templates';
    // The phone draws its own Templates screen; this one would be hidden by
    // body.dcm-own anyway, so it is never built there.
    if (owned && global.StudioMobile && global.matchMedia && global.matchMedia(global.StudioMobile.query).matches) owned = false;
    if (!owned) { if (root) unmount(); return; }
    if (!mount(doc)) return;
    studio.render(templateVals(vals));
    // The frame's shape is the template's own, so a square export previews square.
    var box = root.querySelector('.dct-frame');
    if (box && vals.pvAspect && box.style.aspectRatio !== vals.pvAspect) box.style.aspectRatio = vals.pvAspect;
    fitFrame();
    if (!listening) {
      listening = true;
      global.addEventListener('resize', function () { fitFrame(); });
    }
  }

  global.StudioTemplates = { template: buildTemplate, vals: templateVals, mounted: function () { return Boolean(root && root.isConnected); } };
  global.paintTemplates = paintTemplates;
})(typeof window !== 'undefined' ? window : globalThis);
