/* ============================================================================
   The notification dock — behaviour. See studio-notify.css for why it exists.
   ==========================================================================

   One dock, bottom right, above every layer this app draws. It answers three
   questions and nothing else:

     * did the thing I clicked happen?          -> done / failed
     * is this setting on or off now?           -> an On / Off chip
     * is it still going?                       -> a spinner that resolves

   Two rules hold the whole thing together:

   1. `toast(message, type)` is called from SEVENTY-ONE places in index.html
      and every one of them keeps working, untouched. This module takes that
      shape as its floor and adds a richer one beside it, rather than asking
      seventy-one call sites to change before anything improves.

   2. It fails towards SAYING SOMETHING. If this file never loads, index.html's
      toast() falls back to the old dock; if a caller hands us a blank title we
      still draw a card rather than swallowing the outcome silently. A
      notification system that can quietly show nothing is the bug it replaces.
*/
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc) return;

  var MAX_ON_SCREEN = 4;
  var LIFE = { good: 4200, on: 4200, off: 4200, info: 4200, bad: 7000, work: 0 };

  /* Stroke-based, currentColor, so a kind's colour is set once on the tile and
     the glyph follows it. */
  var SVG = function (d, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="' + d + '"/>' + (extra || '') + '</svg>';
  };
  var ICON = {
    good: SVG('M20 6 9 17l-5-5'),
    bad:  SVG('M12 8v5', '<path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>'),
    on:   SVG('M20 6 9 17l-5-5'),
    /* A power symbol, not a cross: a cross in this dock is the DISMISS
       control, and a card whose icon is the same glyph as its own close
       button reads as "click here to remove" rather than as "off". */
    off:  SVG('M12 4.5v6.5', '<path d="M7.6 7.6a6.2 6.2 0 1 0 8.8 0"/>'),
    info: SVG('M12 16v-5', '<path d="M12 8h.01"/><circle cx="12" cy="12" r="9"/>'),
    work: SVG('M21 12a9 9 0 1 1-6.2-8.56'),
    bell: SVG('M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', '<path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    sun:  SVG('M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4',
              '<circle cx="12" cy="12" r="4"/>'),
    moon: SVG('M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'),
    send: SVG('m22 2-7 20-4-9-9-4Z')
  };

  var dock = null;
  var live = [];               /* the cards on screen, oldest first */
  var seq = 0;

  function mount() {
    if (dock && dock.isConnected) return dock;
    dock = doc.getElementById('dcNotes');
    if (!dock) {
      dock = doc.createElement('div');
      dock.id = 'dcNotes';
      /* polite, not assertive: these announce an outcome, they do not
         interrupt. A failure card sets role="alert" on itself instead. */
      dock.setAttribute('aria-live', 'polite');
      dock.setAttribute('aria-relevant', 'additions');
    }
    if (!dock.isConnected && doc.body) doc.body.appendChild(dock);
    return dock;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function remove(card) {
    if (!card || card.__going) return;
    card.__going = true;
    if (card.__timer) { clearTimeout(card.__timer); card.__timer = 0; }
    card.classList.add('is-going');
    /* Off the live list IMMEDIATELY, and only then let the exit animation play
       out on the node. Splicing inside the callback below instead was an
       infinite loop: trim()'s `while (live.length > MAX)` removed a card, saw
       the length unchanged, removed it again, forever -- so the FIFTH
       notification of a burst hung the browser. Found by driving it, not by
       reading it. Logically a card is gone the moment it starts leaving; the
       DOM is just catching up. */
    var at = live.indexOf(card);
    if (at >= 0) live.splice(at, 1);
    var drop = function () {
      if (card.parentNode) card.parentNode.removeChild(card);
    };
    /* The exit has to be able to finish, but it must never be the only thing
       standing between a card and its removal: a tab that never composites
       fires no animationend at all, and a dock that silently fills up with
       invisible cards is worse than one that snaps. */
    var done = false;
    var finish = function () { if (!done) { done = true; drop(); } };
    card.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 400);
  }

  function arm(card, ms) {
    if (card.__timer) clearTimeout(card.__timer);
    card.__timer = 0;
    var bar = card.querySelector('.dcn-bar');
    if (!ms) { if (bar) bar.style.display = 'none'; return; }
    if (bar) {
      bar.style.display = '';
      bar.style.animation = 'none';
      /* Force a reflow so re-arming a deduped card restarts the countdown;
         re-pointing a rule at the same animation-name does not restart it. */
      void bar.offsetWidth;
      bar.style.animation = 'dcnBar ' + ms + 'ms linear forwards';
    }
    card.__timer = setTimeout(function () { remove(card); }, ms);
  }

  /* Hovering pauses the clock. The CSS pauses the BAR; this pauses the timer
     behind it, or the card would vanish under a still bar. */
  function holdable(card, ms) {
    if (!ms || card.__held) return;
    card.__held = true;
    card.addEventListener('mouseenter', function () {
      if (card.__timer) { clearTimeout(card.__timer); card.__timer = 0; }
    });
    card.addEventListener('mouseleave', function () {
      if (!card.__going && !card.__sticky && card.__life) arm(card, card.__life);
    });
  }

  function trim() {
    while (live.length > MAX_ON_SCREEN) remove(live[0]);
  }

  function draw(card, opts) {
    var kind = opts.kind || 'info';
    var life = opts.ms != null ? opts.ms : LIFE[kind];
    var icon = ICON[opts.icon] || ICON[kind] || ICON.info;
    var html = '<span class="dcn-ic">' + icon + '</span>'
      + '<div class="dcn-copy"><strong>' + esc(opts.title) + '</strong>'
      + (opts.detail ? '<span>' + esc(opts.detail) + '</span>' : '') + '</div>'
      + (opts.state ? '<span class="dcn-state">' + esc(opts.state) + '</span>' : '<span></span>')
      + (opts.action && opts.action.label
          ? '<button type="button" class="dcn-act">' + esc(opts.action.label) + '</button>' : '')
      + '<button type="button" class="dcn-x" aria-label="Dismiss">×</button>'
      + '<i class="dcn-bar"></i>';
    card.className = 'dcn dcn-' + kind;
    card.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    card.innerHTML = html;
    card.__sticky = !life;
    card.__life = life;
    card.__count = 1;
    card.__sig = kind + '|' + opts.title + '|' + (opts.detail || '') + '|' + (opts.state || '');
    arm(card, life);
    return life;
  }

  function push(opts) {
    mount();
    if (!dock) return null;
    var kind = opts.kind || 'info';
    var key = opts.key || (kind + ' ' + opts.title + ' ' + (opts.detail || ''));

    /* One repeated message is one problem, not seven. The old dock already
       restarted the timer on an identical sentence; this also COUNTS them, so
       three failed retries read as one problem that happened three times. */
    var sig = kind + '|' + opts.title + '|' + (opts.detail || '') + '|' + (opts.state || '');
    for (var i = 0; i < live.length; i++) {
      if (live[i].__key === key && !live[i].__going) {
        var seen = live[i];
        /* Same subject, DIFFERENT answer -- a switch flicked twice, a retry
           that failed differently. Redraw the card in place. Counting it
           instead left "YouTube / On" on screen after it had been switched
           off, which is worse than two stacked cards: it is wrong. */
        if (seen.__sig !== sig) {
          holdable(seen, draw(seen, opts));
          return seen.__id;
        }
        /* Genuinely the same message again. One repeated message is one
           problem, not seven, so it is counted rather than stacked. */
        seen.__count = (seen.__count || 1) + 1;
        var more = seen.querySelector('.dcn-more');
        if (!more) {
          more = doc.createElement('span');
          more.className = 'dcn-more';
          seen.appendChild(more);
        }
        more.textContent = '\u00d7' + seen.__count;
        if (!seen.__sticky) arm(seen, opts.ms != null ? opts.ms : LIFE[kind]);
        return seen.__id;
      }
    }

    var card = doc.createElement('div');
    card.__key = key;
    card.__id = 'dcn' + (++seq);
    var life = draw(card, opts);
    card.addEventListener('click', function (event) {
      var act = event.target && event.target.closest ? event.target.closest('.dcn-act') : null;
      if (act) {
        if (opts.action && typeof opts.action.run === 'function') {
          try { opts.action.run(); } catch (e) { /* an action must not kill the dock */ }
        }
      }
      remove(card);
    });
    holdable(card, life);
    dock.appendChild(card);
    live.push(card);
    trim();
    return card.__id;
  }

  function find(id) {
    for (var i = 0; i < live.length; i++) if (live[i].__id === id) return live[i];
    return null;
  }

  /* A trailing "on" / "off" is how every switch in this app already phrases
     itself ("Email notifications on", "Notifications off"), so the plain
     toast() calls become state cards with no call site rewritten. Guarded
     hard: never on a failure, never on a long sentence, and only when there
     is a label left over once the word is taken off the end. */
  var SWITCHY = /^(.{2,44}?)\s+(on|off)$/i;
  function readSwitch(message, type) {
    if (type === 'bad') return null;
    var hit = SWITCHY.exec(String(message).trim());
    if (!hit) return null;
    if (hit[1].split(/\s+/).length > 5) return null;
    return { label: hit[1], on: hit[2].toLowerCase() === 'on' };
  }

  var API = {
    /* The rich shape. Everything else here is a convenience over it. */
    say: function (title, opts) {
      opts = opts || {};
      return push({
        title: title || 'Done', detail: opts.detail, kind: opts.kind || 'info',
        state: opts.state, ms: opts.ms, key: opts.key, icon: opts.icon, action: opts.action
      });
    },
    done: function (title, detail) { return push({ title: title, detail: detail, kind: 'good' }); },
    fail: function (title, detail) { return push({ title: title, detail: detail, kind: 'bad' }); },

    /* A setting. The chip is the answer; the title is only what it belongs to. */
    switched: function (label, isOn, detail) {
      return push({
        title: label, detail: detail, kind: isOn ? 'on' : 'off',
        state: isOn ? 'On' : 'Off', icon: isOn ? 'on' : 'off',
        /* keyed on the LABEL alone, so flicking a switch twice replaces the
           card rather than stacking a contradictory pair. */
        key: 'switch ' + label
      });
    },

    /* Work in flight: a card that stays until it is resolved. Returns a handle
       so the caller does not have to hold an id. */
    working: function (title, detail) {
      var id = push({ title: title, detail: detail, kind: 'work', ms: 0, icon: 'work' });
      var settle = function (opts) {
        var card = find(id);
        if (!card) { push(opts); return; }
        card.__key = (opts.kind || 'info') + ' ' + opts.title + ' ' + (opts.detail || '');
        holdable(card, draw(card, opts));
      };
      return {
        id: id,
        done: function (t, d) { settle({ title: t || title, detail: d, kind: 'good' }); },
        fail: function (t, d) { settle({ title: t || 'That did not work', detail: d, kind: 'bad' }); },
        close: function () { remove(find(id)); }
      };
    },

    update: function (id, title, opts) {
      var card = find(id);
      if (!card) return null;
      opts = opts || {};
      var next = { title: title, detail: opts.detail, kind: opts.kind || 'info', state: opts.state,
                   ms: opts.ms, icon: opts.icon, action: opts.action };
      card.__key = next.kind + ' ' + next.title + ' ' + (next.detail || '');
      holdable(card, draw(card, next));
      return id;
    },

    clear: function (id) {
      if (id) remove(find(id));
      else live.slice().forEach(function (card) { remove(card); });
    },

    /* The compatibility floor: exactly what toast(message, type) has always
       meant, plus the switch reading above. */
    legacy: function (message, type) {
      var text = String(message == null ? '' : message).trim();
      if (!text) return null;
      var flip = readSwitch(text, type);
      if (flip) return API.switched(flip.label, flip.on);
      return push({ title: text, kind: type === 'good' ? 'good' : type === 'bad' ? 'bad' : 'info' });
    },

    /* Test and probe surface. Not used by the app. */
    _live: function () { return live.slice(); },
    _readSwitch: readSwitch
  };

  global.DCNotify = API;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})(typeof window !== 'undefined' ? window : this);
