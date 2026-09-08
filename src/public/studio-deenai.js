/*
 * studio-deenai.js — the DeenAI V2 screen.
 *
 * HAND-WRITTEN, host-rendered. Nothing here names one of the design export's
 * hashed classes, so a re-import cannot renumber it away and adding this
 * screen cost no re-import (which would regenerate every hashed class name in
 * the app for one panel).
 *
 * WHY IT REPLACES THE GENERATED SCREEN. Youssef: "deenai highkey sucks theres
 * not real use for it, no helpfulness from it", then the brief that followed.
 * V1's screen was an ask box over some cards -- one question, one answer, no
 * memory, no goal, no clip, nothing to press afterwards. Every part of what
 * makes V2 useful (modes, an attached clip, streaming, drafts you can preview,
 * feedback) is a control the generated template does not have.
 *
 * The generated screen is HIDDEN IN PLACE (data-host-style + display:none),
 * never removed: taking a generated node out shortens the live child list
 * against the rendered one and the patcher then pairs every later sibling one
 * across -- the fault v3.124.5 spent a session on.
 *
 * EVERY BUTTON REACHES SOMETHING REAL (invariant 9). The goal buttons write
 * the profile; Ask streams; Stop aborts; Retry re-asks; the draft's Accept
 * calls the route that goes through agent.updateClip; Open goes through
 * StudioAdapter.goToStep, the studio's ONE destination map. A control with
 * nothing behind it is not drawn.
 */
(function (global) {
  'use strict';

  var root = null;
  var hidden = null;
  var lastSig = '';

  /* Local screen state. Deliberately NOT in StudioAdapter.ui: this screen
     repaints on every state poll and a streaming answer must not be thrown
     away by one. */
  var M = {
    mode: 'today',
    question: '',
    clipId: '',
    conversationId: '',
    answer: '',
    streaming: false,
    steps: [],
    error: '',
    lastAsk: null,
    result: null,
    controller: null,
    drafts: [],
    importOpen: false,
    importText: '',
    importBusy: false,
  };

  function el(tag, cls, text) {
    var n = global.document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function api(path, options) {
    return global.fetch(path, Object.assign({
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    }, options || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(body.error || ('Request failed (' + r.status + ')'));
        return body;
      });
    });
  }
  function data() { return global.DC_DEENAI_V2 || null; }
  function toast(message, kind) {
    if (global.toast) global.toast(message, kind || 'info');
  }

  /* ── mount ─────────────────────────────────────────────────────────── */

  function generatedScreen(doc) {
    var main = doc.querySelector('#studio main');
    if (!main) return null;
    for (var i = 0; i < main.children.length; i++) {
      var kid = main.children[i];
      if (kid === root || kid.id === 'dcAi' || kid.id === 'dcTopbar') continue;
      // Found by the export's own literal, never by a hashed class.
      if (/ASK DEENAI/i.test(kid.textContent || '')) return kid;
    }
    return null;
  }
  function show(node) {
    if (!node) return;
    node.style.removeProperty('display');
    if (!node.getAttribute('style')) node.removeAttribute('style');
  }
  function unmount() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; lastSig = '';
    show(hidden); hidden = null;
  }

  /* ── pieces ────────────────────────────────────────────────────────── */

  function goalCard(payload) {
    var card = el('section', 'dcai-card');
    card.appendChild(el('p', 'dcai-label', 'What are you growing?'));
    var grid = el('div', 'dcai-goals');
    (payload.goals || []).forEach(function (goal) {
      var b = el('button', 'dcai-goal');
      b.type = 'button';
      b.setAttribute('aria-pressed', goal.chosen ? 'true' : 'false');
      b.appendChild(el('b', '', goal.label));
      b.appendChild(el('span', '', goal.blurb));
      b.onclick = function () {
        api('/api/deenai/goal', { method: 'POST', body: JSON.stringify({ goal: goal.chosen ? '' : goal.id }) })
          .then(function () { return reload(); })
          .then(function () { toast(goal.chosen ? 'Goal cleared' : 'Growing: ' + goal.label, 'on'); })
          .catch(function (e) { toast(e.message, 'bad'); });
      };
      grid.appendChild(b);
    });
    card.appendChild(grid);
    if (payload.profile && payload.profile.goal) {
      card.appendChild(el('p', 'dcai-note',
        'Measured by ' + (payload.goals.find(function (g) { return g.chosen; }) || {}).measure + '.'));
    }
    return card;
  }

  function todayCard(payload) {
    var card = el('section', 'dcai-card is-gold');
    card.appendChild(el('p', 'dcai-label', 'What should you do next?'));
    var list = payload.today || [];
    if (!list.length) {
      card.appendChild(el('p', 'dcai-note', 'Nothing is blocked and nothing is waiting. Ask DeenAI below.'));
      return card;
    }
    var grid = el('div', 'dcai-todo');
    list.forEach(function (item) {
      var box = el('div', 'dcai-do');
      box.appendChild(el('h4', '', item.title));
      box.appendChild(el('p', '', item.why));
      var meta = el('div', 'dcai-meta');
      var m1 = el('span', '', ''); m1.appendChild(el('b', '', 'Measure: ')); m1.appendChild(global.document.createTextNode(item.measure));
      var m2 = el('span', '', ''); m2.appendChild(el('b', '', 'Confidence: ')); m2.appendChild(global.document.createTextNode(item.confidence));
      var m3 = el('span', '', ''); m3.appendChild(el('b', '', 'Source: ')); m3.appendChild(global.document.createTextNode(item.source));
      meta.appendChild(m1); meta.appendChild(m2); meta.appendChild(m3);
      box.appendChild(meta);
      // A button ONLY where there is a screen to open. An action with no
      // destination gets no control rather than a dead one.
      if (item.action) {
        var go = el('button', 'dcai-btn', labelFor(item.action));
        go.type = 'button';
        go.onclick = function (e) { global.StudioAdapter.goToStep(stepFor(item.action), e); };
        box.appendChild(go);
      }
      grid.appendChild(box);
    });
    card.appendChild(grid);
    return card;
  }

  /* The action table lives on the server and travels with the answer; these
     two read whatever it sent rather than keeping a second copy of it. */
  var ACTION_LABELS = {
    'open-review': 'Open the review queue', 'open-connections': 'Open Connections',
    'open-schedule': 'Open the schedule', 'open-nasheed': 'Open the nasheed library',
    'open-paste': 'Add a lecture', 'open-library': 'Open the lecture library',
    'open-templates': 'Open Templates', 'open-plans': 'Open Tokens & billing',
    'open-performance': 'Open Performance', 'open-help': 'Open Help',
  };
  var ACTION_STEPS = {
    'open-review': 'review', 'open-connections': 'connect', 'open-schedule': 'schedule',
    'open-nasheed': 'nasheed', 'open-paste': 'paste', 'open-library': 'library',
    'open-templates': 'template', 'open-plans': 'plan', 'open-performance': 'performance',
    'open-help': 'help',
  };
  function labelFor(id) { return ACTION_LABELS[id] || 'Open'; }
  function stepFor(id) { return ACTION_STEPS[id] || ''; }

  function askCard(payload, vals) {
    /*
     * THE CONSOLE, and it is the hero of the screen.
     *
     * Youssef, 8 Sept 2026: "Deen Ai page looks so ugly layout is so bad needs
     * to be 100x better there no ai look to it". Measured before anything
     * moved: this screen was SEVEN equal bordered boxes stacked down 1632px of
     * a 785px viewport, and the ask -- the one thing on it no other screen can
     * do -- was the FOURTH, below the fold. Nothing on the screen moved and
     * nothing said a model was involved.
     *
     * So it is a card with light on it (the only one), it is first, and it
     * carries an aurora and a live dot. `is-console` is the only thing that
     * changes; every control inside is the one that was already here.
     */
    var card = el('section', 'dcai-card is-console');
    var aurora = el('span', 'dcai-aurora');
    aurora.setAttribute('aria-hidden', 'true');
    card.appendChild(aurora);
    var bar = el('div', 'dcai-cbar');
    var eyebrow = el('p', 'dcai-label is-live');
    eyebrow.appendChild(el('span', 'dcai-dot'));
    eyebrow.appendChild(el('span', '', 'Ask DeenAI'));
    bar.appendChild(eyebrow);
    bar.appendChild(el('span', 'dcai-where',
      'on DeenClipped\u2019s own server \u2014 your numbers, never your transcripts'));
    card.appendChild(bar);

    var modes = el('div', 'dcai-modes');
    (payload.modes || []).forEach(function (mode) {
      var b = el('button', 'dcai-mode', mode.label);
      b.type = 'button';
      b.title = mode.blurb;
      b.setAttribute('aria-pressed', M.mode === mode.id ? 'true' : 'false');
      b.onclick = function () { M.mode = mode.id; M.error = ''; repaint(); };
      modes.appendChild(b);
    });
    card.appendChild(modes);

    var ask = el('div', 'dcai-ask');
    var field = el('textarea', 'dcai-field');
    field.placeholder = placeholderFor(M.mode);
    field.value = M.question;
    field.disabled = M.streaming;
    field.oninput = function () { M.question = field.value; };
    field.onkeydown = function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    };
    ask.appendChild(field);

    var row = el('div', 'dcai-row');
    // Attaching a clip is what makes "improve this" and "why did this perform"
    // answerable at all, so the picker is drawn whenever there is a clip.
    var clips = ((vals && vals.__clips) || []);
    if (clips.length) {
      var sel = el('select', 'dcai-attach');
      var none = el('option', '', 'No clip attached');
      none.value = '';
      sel.appendChild(none);
      clips.forEach(function (c) {
        var o = el('option', '', (c.title || 'Untitled') + ' · ' + c.status);
        o.value = c.id;
        sel.appendChild(o);
      });
      sel.value = M.clipId;
      sel.onchange = function () { M.clipId = sel.value; };
      row.appendChild(sel);
    }
    var send$ = el('button', 'dcai-btn is-primary', M.streaming ? 'Thinking…' : 'Ask');
    send$.type = 'button';
    send$.disabled = M.streaming;
    send$.onclick = send;
    row.appendChild(send$);
    if (M.streaming) {
      var stop = el('button', 'dcai-btn', 'Stop');
      stop.type = 'button';
      stop.onclick = function () { if (M.controller) M.controller.abort(); };
      row.appendChild(stop);
    } else if (M.lastAsk) {
      var retry = el('button', 'dcai-btn', 'Retry');
      retry.type = 'button';
      retry.onclick = function () { M.question = M.lastAsk.question; M.mode = M.lastAsk.mode; send(); };
      row.appendChild(retry);
    }
    ask.appendChild(row);
    card.appendChild(ask);

    if (M.steps.length) {
      var steps = el('div', 'dcai-steps');
      M.steps.forEach(function (s, i) {
        var chip = el('span', 'dcai-step' + (M.streaming && i === M.steps.length - 1 ? ' is-live' : ''), s);
        steps.appendChild(chip);
      });
      card.appendChild(steps);
    }
    if (M.error) card.appendChild(el('p', 'dcai-err', M.error));
    return card;
  }

  function placeholderFor(mode) {
    return ({
      today: 'Ask about anything on this list, or press Ask for the reasoning behind it.',
      improve: 'Attach a clip, then ask for a stronger hook, title or caption.',
      next: 'Ask which clip should go out next, and why.',
      review: 'Attach a posted clip and ask why it did what it did.',
      plan: 'Ask for a week you can actually post.',
      product: 'Ask how something in DeenClipped works.',
      ask: 'Ask anything about this account.',
    })[mode] || 'Ask anything about this account.';
  }

  function answerCard() {
    if (!M.answer && !M.streaming) return null;
    // A REPLY, not another box in the stack: the gold rail, the avatar and the
    // shape say a model wrote this, which is the one thing the screen could
    // not say before. It sits directly under the console it came from.
    var card = el('section', 'dcai-card is-reply');
    var avatar = el('span', 'dcai-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    card.appendChild(avatar);
    var head = el('div', 'dcai-head');
    head.appendChild(el('p', 'dcai-label', 'DeenAI'));
    head.appendChild(el('div', 'dcai-spacer'));
    var result = M.result;
    if (result) {
      (result.sourceKinds || []).forEach(function (kind) {
        head.appendChild(el('span', 'dcai-pill', kind));
      });
      if (result.degraded) {
        head.appendChild(el('span', 'dcai-pill is-warn', 'limited fallback model'));
      } else if (result.model) {
        head.appendChild(el('span', 'dcai-pill is-gold', result.model));
      }
    }
    card.appendChild(head);

    var body = el('div', 'dcai-body');
    renderAnswer(body, M.answer);
    if (M.streaming) body.appendChild(el('span', 'dcai-caret'));
    card.appendChild(body);

    if (result && result.degraded && result.degradedReason) {
      card.appendChild(el('p', 'dcai-note',
        'The main model was not available (' + result.degradedReason + '), so this came from the small model on the render box. It has no tools and no access to your clips.'));
    }

    if (result && !M.streaming) {
      var row = el('div', 'dcai-row');
      (result.actions || []).forEach(function (a) {
        var b = el('button', 'dcai-btn', a.label);
        b.type = 'button';
        b.onclick = function (e) { global.StudioAdapter.goToStep(a.step, e); };
        row.appendChild(b);
      });
      // A confirm-class tool the model proposed. It did NOT happen; this is
      // the button that would make it happen, and it names the screen where
      // the person does it with the real control in front of them.
      (result.proposals || []).forEach(function (p) {
        if (p.tool !== 'add_draft_to_schedule') return;
        var b = el('button', 'dcai-btn', 'Add to the schedule yourself');
        b.type = 'button';
        b.title = 'DeenAI cannot schedule anything. This opens the Schedule.';
        b.onclick = function (e) { global.StudioAdapter.goToStep('schedule', e); };
        row.appendChild(b);
      });
      var up = el('button', 'dcai-btn', 'Helpful');
      up.type = 'button';
      up.onclick = function () { rate('up'); };
      var down = el('button', 'dcai-btn', 'Not helpful');
      down.type = 'button';
      down.onclick = function () { rate('down'); };
      row.appendChild(up); row.appendChild(down);
      var track = el('button', 'dcai-btn', 'Track the result');
      track.type = 'button';
      track.onclick = trackResult;
      row.appendChild(track);
      card.appendChild(row);
    }
    return card;
  }

  /* The contract's labels are bolded so the shape is readable at a glance.
     Deliberately a RENDER, not a rewrite: the model's own words are shown. */
  var CONTRACT_LABELS = /^(Recommendation|Evidence|Next action|Measure|Confidence|Source):/;
  function renderAnswer(box, text) {
    String(text || '').split('\n').forEach(function (line, i) {
      if (i) box.appendChild(global.document.createElement('br'));
      var m = line.match(CONTRACT_LABELS);
      if (m) {
        box.appendChild(el('strong', '', m[0] + ' '));
        box.appendChild(global.document.createTextNode(line.slice(m[0].length).trim()));
      } else {
        box.appendChild(global.document.createTextNode(line));
      }
    });
  }

  function draftsCard() {
    var open = M.drafts.filter(function (d) { return d.status === 'draft'; });
    if (!open.length) return null;
    var card = el('section', 'dcai-card');
    card.appendChild(el('p', 'dcai-label', 'Drafts waiting on you'));
    open.forEach(function (d) {
      var box = el('div', 'dcai-draft');
      if (d.reason) box.appendChild(el('p', 'dcai-note', d.reason));
      var diff = el('div', 'dcai-diff');
      Object.keys(d.changes).forEach(function (key) {
        var before = d.before[key];
        var after = d.changes[key];
        var beforeText = Array.isArray(before) ? before.join(' ') : String(before || '');
        var afterText = Array.isArray(after) ? after.join(' ') : String(after || '');
        if (beforeText) diff.appendChild(el('div', 'dcai-was', key + ': ' + beforeText));
        diff.appendChild(el('div', 'dcai-now', key + ': ' + afterText));
      });
      box.appendChild(diff);
      var row = el('div', 'dcai-row');
      var accept = el('button', 'dcai-btn is-primary', 'Use this');
      accept.type = 'button';
      accept.onclick = function () { decide(d.id, 'accept'); };
      var discard = el('button', 'dcai-btn', 'Discard');
      discard.type = 'button';
      discard.onclick = function () { decide(d.id, 'discard'); };
      var openClip = el('button', 'dcai-btn', 'Open the clip');
      openClip.type = 'button';
      // Through goToStep, the studio's ONE destination map -- there is no
      // setUI on StudioAdapter and inventing a second route to a screen is how
      // two answers to "where does this go" start.
      openClip.onclick = function (e) { global.StudioAdapter.goToStep('review', e); };
      row.appendChild(accept); row.appendChild(discard); row.appendChild(openClip);
      box.appendChild(row);
      card.appendChild(box);
    });
    return card;
  }

  function metricsCard(payload) {
    var card = el('section', 'dcai-card');
    card.appendChild(el('p', 'dcai-label', 'Your platform results'));
    var cover = payload.coverage || {};
    card.appendChild(el('p', 'dcai-note', cover.note || ''));
    var row = el('div', 'dcai-row');
    var open = el('button', 'dcai-btn', M.importOpen ? 'Close' : (cover.hasData ? 'Import more' : 'Import results'));
    open.type = 'button';
    open.onclick = function () { M.importOpen = !M.importOpen; repaint(); };
    row.appendChild(open);
    if (cover.hasData) {
      var clear = el('button', 'dcai-btn', 'Remove all');
      clear.type = 'button';
      clear.onclick = function () {
        if (!global.confirm('Remove every imported result on this account?')) return;
        api('/api/deenai/metrics', { method: 'DELETE' })
          .then(reload).then(function () { toast('Imported results removed', 'on'); })
          .catch(function (e) { toast(e.message, 'bad'); });
      };
      row.appendChild(clear);
    }
    card.appendChild(row);

    if (M.importOpen) {
      card.appendChild(el('p', 'dcai-note',
        'Paste the CSV your platform exports, or type one post\'s figures. Every row is stored with its source and '
        + 'the date it was measured, and nothing here is fetched from a platform.'));
      var area = el('textarea', 'dcai-field');
      area.placeholder = 'Video title,Platform,Video publish time,Report date,Views,Average percentage viewed\n'
        + 'Mercy has no closing time,YouTube,2026-09-01,2026-09-07,1204,48';
      area.value = M.importText;
      area.oninput = function () { M.importText = area.value; };
      card.appendChild(area);

      var manual = el('div', 'dcai-metrics');
      var fields = [
        ['provider', 'Platform'], ['clipId', 'Clip id (optional)'], ['title', 'Title'],
        ['postedAt', 'Posted (YYYY-MM-DD)'], ['measuredAt', 'Measured (YYYY-MM-DD)'],
        ['views', 'Views'], ['completionRate', 'Completion %'], ['likes', 'Likes'],
        ['comments', 'Comments'], ['shares', 'Shares'], ['saves', 'Saves'],
        ['followerDelta', 'Followers gained'], ['subscriberDelta', 'Subscribers gained'],
      ];
      fields.forEach(function (pair) {
        var lab = el('label', 'dcai-lab', pair[1]);
        var input = el('input', 'dcai-input');
        input.setAttribute('data-mx', pair[0]);
        lab.appendChild(input);
        manual.appendChild(lab);
      });
      card.appendChild(manual);

      var actions = el('div', 'dcai-row');
      var save = el('button', 'dcai-btn is-primary', M.importBusy ? 'Importing…' : 'Import');
      save.type = 'button';
      save.disabled = M.importBusy;
      save.onclick = function () { doImport(card); };
      actions.appendChild(save);
      card.appendChild(actions);
    }
    return card;
  }

  function historyCard(payload) {
    var list = payload.conversations || [];
    if (!list.length) return null;
    var card = el('section', 'dcai-card');
    card.appendChild(el('p', 'dcai-label', 'Recent conversations'));
    var row = el('div', 'dcai-convos');
    list.forEach(function (c) {
      var b = el('button', 'dcai-convo', c.title);
      b.type = 'button';
      b.title = c.title;
      b.setAttribute('aria-pressed', M.conversationId === c.id ? 'true' : 'false');
      b.onclick = function () { openConversation(c.id); };
      row.appendChild(b);
    });
    card.appendChild(row);
    if (M.conversationId) {
      var fresh = el('button', 'dcai-btn', 'Start a new conversation');
      fresh.type = 'button';
      fresh.onclick = function () {
        M.conversationId = ''; M.answer = ''; M.result = null; M.steps = []; repaint();
      };
      card.appendChild(fresh);
    }
    return card;
  }

  function insightsCard(vals) {
    var cards = (vals && vals.aiCards) || [];
    var head = (vals && vals.aiHeadTitle) ? vals : null;
    if (!cards.length && !head) return null;
    var card = el('section', 'dcai-card');
    card.appendChild(el('p', 'dcai-label', 'Counted from your own clips'));
    // Two across, not a stack. Appended straight to the card these ran the
    // full width of the column -- measured up to ~120 characters a line, which
    // is roughly twice the length prose stays readable at, and it made the one
    // section of hard numbers read as the densest thing on the screen.
    var grid = el('div', 'dcai-insights');
    cards.forEach(function (c) {
      var box = el('div', 'dcai-do');
      box.appendChild(el('h4', '', c.line || c.title || ''));
      if (c.body) box.appendChild(el('p', '', c.body));
      grid.appendChild(box);
    });
    card.appendChild(grid);
    return card;
  }

  /* ── behaviour ─────────────────────────────────────────────────────── */

  function reload() {
    return api('/api/deenai/v2').then(function (payload) {
      global.DC_DEENAI_V2 = payload;
      return refreshDrafts();
    }).then(function () { lastSig = ''; repaint(); });
  }

  function refreshDrafts() {
    return api('/api/deenai/drafts').then(function (body) { M.drafts = body.drafts || []; })
      .catch(function () { M.drafts = []; });
  }

  function openConversation(id) {
    api('/api/deenai/chats/' + encodeURIComponent(id)).then(function (body) {
      var chat = body.conversation;
      if (!chat) return;
      M.conversationId = chat.id;
      M.mode = chat.mode || 'ask';
      M.clipId = chat.clipId || '';
      var turns = chat.turns || [];
      var last = turns[turns.length - 1];
      M.answer = last && last.role === 'assistant' ? last.text : '';
      M.result = last && last.role === 'assistant'
        ? { model: last.model, degraded: last.degraded, actions: last.actions || [], proposals: last.proposals || [], sourceKinds: [] }
        : null;
      M.steps = [];
      repaint();
    }).catch(function (e) { toast(e.message, 'bad'); });
  }

  function rate(verdict) {
    if (!M.conversationId) return;
    api('/api/deenai/feedback', {
      method: 'POST',
      body: JSON.stringify({ conversationId: M.conversationId, turn: -1, rating: verdict }),
    }).then(function () { toast(verdict === 'up' ? 'Noted — thank you' : 'Noted', 'on'); })
      .catch(function (e) { toast(e.message, 'bad'); });
  }

  function trackResult() {
    var what = global.prompt('What happened after you followed this?');
    if (what === null) return;
    api('/api/deenai/recommendations', {
      method: 'POST',
      body: JSON.stringify({
        recommendation: String(M.answer || '').split('\n')[0].slice(0, 200),
        conversationId: M.conversationId,
        result: what,
        followed: true,
        verdict: 'unclear',
      }),
    }).then(function () { toast('Recorded', 'on'); reload(); })
      .catch(function (e) { toast(e.message, 'bad'); });
  }

  function decide(draftId, verb) {
    api('/api/deenai/drafts/' + encodeURIComponent(draftId) + '/' + verb, { method: 'POST' })
      .then(function () {
        toast(verb === 'accept' ? 'Applied to the clip — nothing re-rendered' : 'Draft discarded', 'on');
        // The clip list the studio polls is refreshed by its own loop; this
        // only reloads what this screen owns.
        return reload();
      })
      .catch(function (e) { toast(e.message, 'bad'); });
  }

  function doImport(card) {
    var payload = {};
    var csv = String(M.importText || '').trim();
    if (csv) {
      payload.csv = csv;
    } else {
      var row = {};
      card.querySelectorAll('[data-mx]').forEach(function (input) {
        var value = String(input.value || '').trim();
        if (value) row[input.getAttribute('data-mx')] = value;
      });
      if (!Object.keys(row).length) { toast('Paste a CSV or fill in one row first.', 'bad'); return; }
      payload.rows = [row];
    }
    M.importBusy = true; repaint();
    api('/api/deenai/metrics', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (body) {
        toast('Imported ' + body.imported + ' row' + (body.imported === 1 ? '' : 's')
          + (body.skipped ? ' · ' + body.skipped + ' skipped' : ''), 'on');
        M.importText = ''; M.importOpen = false;
        return reload();
      })
      .catch(function (e) { toast(e.message, 'bad'); })
      .then(function () { M.importBusy = false; repaint(); });
  }

  /*
   * The stream.
   *
   * `fetch` with a ReadableStream rather than EventSource, because this is a
   * POST carrying the question, the mode and the attached clip. The reader
   * splits on the blank line SSE uses between events; a partial one stays in
   * the buffer until the rest of it arrives.
   */
  function send() {
    var question = String(M.question || '').trim();
    if (!question) { M.error = 'Type a question first.'; repaint(); return; }
    if (M.streaming) return;
    M.streaming = true; M.answer = ''; M.error = ''; M.steps = []; M.result = null;
    M.lastAsk = { question: question, mode: M.mode };
    M.controller = new global.AbortController();
    repaint();

    global.fetch('/api/deenai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: M.controller.signal,
      body: JSON.stringify({
        question: question, mode: M.mode,
        conversationId: M.conversationId, clipId: M.clipId,
      }),
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || ('DeenAI refused the request (' + response.status + ')'));
        });
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var split;
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            var block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            var event = '';
            var payload = null;
            block.split('\n').forEach(function (line) {
              if (line.indexOf('event:') === 0) event = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) {
                try { payload = JSON.parse(line.slice(5).trim()); } catch (e) { payload = null; }
              }
            });
            handleEvent(event, payload);
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') { M.error = 'Stopped.'; }
      else { M.error = e.message || 'DeenAI could not answer.'; }
    }).then(function () {
      M.streaming = false; M.controller = null;
      M.question = '';
      repaint();
      refreshDrafts().then(repaint);
    });
  }

  function handleEvent(event, payload) {
    if (!payload) return;
    if (event === 'delta') { M.answer += payload.text || ''; repaint(); return; }
    if (event === 'step') {
      var pretty = String(payload.name || '').replace(/_/g, ' ');
      if (M.steps[M.steps.length - 1] !== pretty) M.steps.push(pretty);
      repaint();
      return;
    }
    if (event === 'done') {
      M.result = payload;
      M.conversationId = payload.conversationId || M.conversationId;
      // The stream carries the answer as deltas; the done event carries the
      // whole of it, which is what a refusal-free answer actually is.
      M.answer = payload.answer || M.answer;
      repaint();
      return;
    }
    if (event === 'failed') {
      M.error = payload.error || 'DeenAI could not answer.';
      M.answer = '';
      repaint();
    }
  }

  /* ── paint ─────────────────────────────────────────────────────────── */

  /*
   * WHAT THE SCREEN IS SHOWING, as one string.
   *
   * The studio repaints on every state poll, and this screen is rebuilt from
   * scratch when it repaints -- so without this the textarea somebody is
   * typing a question into is destroyed every couple of seconds, and a
   * streaming answer flickers. That is exactly the fault v3.124.5 found in
   * every other host panel; the rule there is `dcSetHtml`, and this is the
   * same rule for a panel built as nodes rather than as markup.
   *
   * The typed question is DELIBERATELY NOT in the signature: it lives in the
   * field, changes on every keystroke, and putting it here would rebuild the
   * field on every letter -- which is the bug this exists to prevent, arriving
   * by the other door.
   */
  function signature(payload, vals) {
    return JSON.stringify([
      Boolean(payload), payload && payload.unlocked,
      payload && payload.provider,
      payload && (payload.goals || []).map(function (g) { return g.id + (g.chosen ? '!' : ''); }),
      payload && (payload.today || []).map(function (t) { return t.id; }),
      payload && payload.coverage && payload.coverage.note,
      payload && (payload.conversations || []).map(function (c) { return c.id + c.updatedAt; }),
      M.mode, M.clipId, M.conversationId, M.streaming, M.answer, M.error,
      M.steps.join(','), M.importOpen, M.importBusy,
      M.result && [M.result.model, M.result.degraded, (M.result.actions || []).length, (M.result.proposals || []).length],
      M.drafts.filter(function (d) { return d.status === 'draft'; }).map(function (d) { return d.id; }),
      (vals.__clips || []).map(function (c) { return c.id + c.status; }),
      (vals.aiCards || []).map(function (c) { return c.title; }),
    ]);
  }

  var loading = false;
  function repaint() {
    if (!root) return;
    var payload = data();
    var vals = global.__dcAiVals || {};
    var sig = signature(payload, vals);
    if (sig === lastSig && root.firstChild) return;
    lastSig = sig;
    var next = global.document.createDocumentFragment();

    var head = el('div', 'dcai-head');
    var titles = el('div', '');
    titles.appendChild(el('h2', 'dcai-title', 'DeenAI'));
    titles.appendChild(el('p', 'dcai-sub',
      'Your own numbers, read by a growth assistant that can look at your clips. '
      + 'It never changes anything without you.'));
    head.appendChild(titles);
    head.appendChild(el('div', 'dcai-spacer'));
    if (payload && payload.provider) {
      var p = payload.provider;
      head.appendChild(el('span', 'dcai-pill' + (p.primary ? ' is-gold' : ' is-warn'),
        p.primary ? p.primaryModel : (p.fallback ? 'fallback model only' : 'no model configured')));
    }
    next.appendChild(head);

    if (!payload) {
      var wait = el('section', 'dcai-card');
      wait.appendChild(el('p', 'dcai-note', 'Reading your account…'));
      next.appendChild(wait);
    } else if (!payload.unlocked) {
      var locked = el('section', 'dcai-card is-gold');
      locked.appendChild(el('p', 'dcai-label', 'DeenAI'));
      locked.appendChild(el('p', 'dcai-note',
        'DeenAI reads your own clips and results and answers questions about them. It is on a paid plan.'));
      var up = el('button', 'dcai-btn is-primary', 'See plans');
      up.type = 'button';
      up.onclick = function (e) { global.StudioAdapter.goToStep('plan', e); };
      locked.appendChild(up);
      next.appendChild(locked);
    } else {
      if (payload.provider && !payload.provider.ready) {
        var none = el('section', 'dcai-card');
        none.appendChild(el('p', 'dcai-err',
          'No model is configured for this deployment, so asking is switched off. Everything below is computed without one.'));
        next.appendChild(none);
      }
      /*
       * CONSOLE LEFT, CONTEXT RIGHT -- the layout an assistant actually has,
       * and the fix for "layout is so bad".
       *
       * Every section below is the one that was already here; only WHERE they
       * are drawn changed. As one column they were seven equal boxes running
       * 1632px down a 785px viewport with the ask fourth, so the screen had no
       * spine and its own feature was below the fold.
       *
       * MAIN carries the working loop, in the order somebody uses it: ask ->
       * the reply -> the drafts it produced -> what to do next -> what the
       * numbers say. SIDE carries what is TRUE OF THE ACCOUNT rather than what
       * you do with it: the goal (a setting, chosen once), imported results,
       * and earlier conversations. A rail is where you look things up; a
       * column is where you work.
       */
      var grid = el('div', 'dcai-grid');
      var main = el('div', 'dcai-main');
      var side = el('aside', 'dcai-side');

      main.appendChild(askCard(payload, vals));
      var answer = answerCard();
      if (answer) main.appendChild(answer);
      var drafts = draftsCard();
      if (drafts) main.appendChild(drafts);
      main.appendChild(todayCard(payload));
      var insights = insightsCard(vals);
      if (insights) main.appendChild(insights);

      side.appendChild(goalCard(payload));
      side.appendChild(metricsCard(payload));
      var history = historyCard(payload);
      if (history) side.appendChild(history);

      grid.appendChild(main);
      grid.appendChild(side);
      next.appendChild(grid);
    }
    root.textContent = '';
    root.appendChild(next);
  }

  /*
   * `studioData` is the studio's own DATA, passed in.
   *
   * NAMED `studioData`, not `data`: a parameter called `data` SHADOWS this
   * module's own `data()` reader, and paintDeenai then threw "data is not a
   * function" on every paint -- caught by index.html's try/catch, so the screen
   * simply never drew and nothing anywhere said why. It was masked for two
   * runs because the browser driver happened to call StudioDeenai.reload()
   * itself, which paints by another road.
   *
   * NOT `window.DATA`, which is a DIFFERENT object -- the scope trap this repo
   * has now recorded six times. Reading it here drew NO clip picker at all,
   * because window.DATA.clips was empty while the scoped one held three, and
   * the "attach a clip" control simply did not exist. Found by driving the
   * screen in a browser, not by reading the diff.
   */
  function paintDeenai(vals, studioData) {
    var doc = global.document;
    if (!doc) return;
    var owned = global.StudioAdapter && global.StudioAdapter.ui.screen === 'deenai';
    // The phone draws its own screens; body.dcm-own would hide this anyway.
    if (owned && global.StudioMobile && global.matchMedia && global.matchMedia(global.StudioMobile.query).matches) owned = false;
    if (!owned) { if (root) unmount(); return; }

    var screen = generatedScreen(doc);
    if (!screen) return;
    if (!root || !root.isConnected) {
      root = doc.getElementById('dcAi') || doc.createElement('div');
      root.id = 'dcAi';
      root.setAttribute('data-host-owned', '');
      screen.parentNode.insertBefore(root, screen);
    }
    if (hidden !== screen) { show(hidden); hidden = screen; }
    screen.setAttribute('data-host-style', '');
    screen.style.display = 'none';

    // The clip list for the attach picker, and the computed insight cards,
    // both come from the bindings the studio already rendered from.
    global.__dcAiVals = {
      aiCards: (vals && vals.aiCards) || [],
      __clips: ((studioData && studioData.clips) || []).slice(0, 60).map(function (c) {
        return { id: c.id, title: c.title, status: c.status };
      }),
    };

    if (!data() && !loading) {
      loading = true;
      reload().catch(function () {}).then(function () { loading = false; });
    }
    repaint();
  }

  global.StudioDeenai = {
    mounted: function () { return Boolean(root && root.isConnected); },
    state: M,
    reload: reload,
  };
  global.paintDeenai = paintDeenai;
})(typeof window !== 'undefined' ? window : globalThis);
