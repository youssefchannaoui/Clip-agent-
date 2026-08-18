// Interprets the AST emitted by scripts/import-design.mjs into DOM.
//
// HAND-WRITTEN — a design re-import never rewrites this file. It only ever has to
// change if Claude Design introduces a new template construct (a new sc-* element
// or attribute form), which the importer will surface as an unknown node type.
//
// The design's template language is small:
//   {t:'el'}   element   — tag, a (attrs), st (bound style), on (events), ch
//   {t:'txt'}  text      — v (value node)
//   {t:'if'}   sc-if     — c (condition), ch
//   {t:'for'}  sc-for    — l (list), as (loop var), ch
// A value is a string, {p:'a.b'} (path), {v:literal}, or {cat:[...]} (concat).

(function (global) {
  'use strict';

  var TEXT_ESC = /[&<>]/g;
  var ATTR_ESC = /[&<>"]/g;
  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function escText(s) { return String(s).replace(TEXT_ESC, function (c) { return ESCAPES[c]; }); }
  function escAttr(s) { return String(s).replace(ATTR_ESC, function (c) { return ESCAPES[c]; }); }

  // Void elements must not be given a closing tag.
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
    link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1, path: 1, circle: 1,
    rect: 1, line: 1, polygon: 1, polyline: 1, ellipse: 1, stop: 1, use: 1 };

  // Scope chain: loop variables shadow outer values without mutating them.
  function lookup(scope, path) {
    var parts = path.split('.');
    var cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // The readable name of a value spec, for reporting a binding that resolved to
  // nothing. Loop-scoped item properties ("opt.pick") are the ones that hide:
  // design:check only validates top-level names, so those slip through.
  function bindingName(node) {
    if (!node || typeof node !== 'object') return String(node);
    if (node.p !== undefined) return String(node.p);
    return JSON.stringify(node).slice(0, 60);
  }

  function evalValue(node, scope) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string') return node;
    if (Object.prototype.hasOwnProperty.call(node, 'v')) return node.v;
    if (node.p !== undefined) return lookup(scope, node.p);
    if (node.cat) {
      var out = '';
      for (var i = 0; i < node.cat.length; i++) {
        var part = evalValue(node.cat[i], scope);
        out += (part === null || part === undefined) ? '' : part;
      }
      return out;
    }
    return '';
  }

  function Renderer() {
    this.handlers = [];
    // Bindings the template asked for and the adapter did not supply. The
    // element still renders -- styled, cursor:pointer, looking live -- with no
    // listener, which is how every dead control here shipped unnoticed. Nothing
    // reads this at runtime; it exists so a test can assert it is empty.
    this.missing = [];
  }

  Renderer.prototype.render = function (nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) this.node(nodes[i], scope, out);
  };

  Renderer.prototype.node = function (n, scope, out) {
    if (typeof n === 'string') { out.push(escText(n)); return; }

    if (n.t === 'txt') {
      var val = evalValue(n.v, scope);
      out.push(val === null || val === undefined ? '' : escText(val));
      return;
    }

    if (n.t === 'if') {
      if (truthy(evalValue(n.c, scope))) this.render(n.ch || [], scope, out);
      return;
    }

    if (n.t === 'for') {
      var list = evalValue(n.l, scope);
      if (!list) return;
      if (!Array.isArray(list)) list = Array.prototype.slice.call(list);
      for (var i = 0; i < list.length; i++) {
        // A child scope keeps the loop variable local, and `$index` available.
        var child = Object.create(scope);
        child[n.as] = list[i];
        child.$index = i;
        this.render(n.ch || [], child, out);
      }
      return;
    }

    if (n.t !== 'el') return;

    out.push('<', n.tag);

    if (n.a) {
      for (var name in n.a) {
        if (!Object.prototype.hasOwnProperty.call(n.a, name)) continue;
        var v = evalValue(n.a[name], scope);
        if (v === false || v === null || v === undefined) continue;
        if (v === true) { out.push(' ', name); continue; }
        out.push(' ', name, '="', escAttr(v), '"');
      }
    }

    if (n.st) {
      var style = evalValue(n.st, scope);
      if (style) out.push(' style="', escAttr(style), '"');
    }

    if (n.on) {
      var spec = [];
      for (var evt in n.on) {
        if (!Object.prototype.hasOwnProperty.call(n.on, evt)) continue;
        var fn = evalValue(n.on[evt], scope);
        if (typeof fn !== 'function') {
          this.missing.push({ tag: n.tag, event: evt, binding: bindingName(n.on[evt]) });
          continue;
        }
        spec.push(evt + '=' + (this.handlers.push(fn) - 1));
      }
      if (spec.length) out.push(' data-dc-h="', spec.join(';'), '"');
    }

    out.push('>');

    if (VOID[n.tag]) return;
    if (n.ch) this.render(n.ch, scope, out);
    out.push('</', n.tag, '>');
  };

  function truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    return Boolean(v);
  }

  // ── mounting ──────────────────────────────────────────────────────────────
  // One delegated listener per event type, rebound to the current render's
  // handler table. Re-rendering replaces innerHTML, matching how the rest of the
  // dashboard already works.

  var BUBBLING = ['click', 'change', 'input', 'mousedown', 'submit', 'keydown'];
  // mouseenter/mouseleave do not propagate, so they are delegated through
  // mouseover/mouseout with a containment check.
  var HOVER = { mouseenter: 'mouseover', mouseleave: 'mouseout' };

  function Studio(root, template) {
    this.root = root;
    this.template = template;
    this.handlers = [];
    this.bound = false;
  }

  Studio.prototype.bind = function () {
    if (this.bound) return;
    this.bound = true;
    var self = this;

    BUBBLING.forEach(function (evt) {
      self.root.addEventListener(evt, function (e) {
        self.dispatch(evt, e, e.target);
      });
    });

    Object.keys(HOVER).forEach(function (logical) {
      self.root.addEventListener(HOVER[logical], function (e) {
        var el = e.target;
        while (el && el !== self.root) {
          if (el.hasAttribute && el.hasAttribute('data-dc-h')) {
            // Only fire when the pointer actually crossed this element's boundary.
            if (!el.contains(e.relatedTarget)) self.invoke(el, logical, e);
            return;
          }
          el = el.parentNode;
        }
      });
    });
  };

  Studio.prototype.dispatch = function (evt, e, target) {
    var el = target;
    while (el && el !== this.root) {
      if (el.hasAttribute && el.hasAttribute('data-dc-h')) {
        if (this.invoke(el, evt, e)) return;
      }
      el = el.parentNode;
    }
  };

  Studio.prototype.invoke = function (el, evt, e) {
    var spec = el.getAttribute('data-dc-h') || '';
    var pairs = spec.split(';');
    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf('=');
      if (eq === -1) continue;
      if (pairs[i].slice(0, eq) !== evt) continue;
      var fn = this.handlers[Number(pairs[i].slice(eq + 1))];
      if (typeof fn !== 'function') continue;
      if (evt === 'click' && el.tagName === 'A' && (el.getAttribute('href') || '') === '#') {
        e.preventDefault();
      }
      // Events are delegated from the mount, so e.currentTarget is the root and
      // not the element the handler was written against. A handler that needs
      // its own element -- the caption drag measures the preview frame it sits
      // inside -- got the whole dashboard instead and silently did nothing.
      // dcTarget is the element the binding is actually on.
      try { e.dcTarget = el; } catch (err) { /* frozen event: `this` still works */ }
      fn.call(el, e);
      return true;
    }
    return false;
  };

  // innerHTML replacement drops focus and caret position, which is visible while
  // typing in the header search. Capture and restore them around the swap.
  function captureFocus(root) {
    var el = document.activeElement;
    if (!el || !root.contains(el)) return null;
    var path = [], node = el;
    while (node && node !== root) {
      path.unshift(Array.prototype.indexOf.call(node.parentNode.children, node));
      node = node.parentNode;
    }
    var snap = { path: path };
    if (el.selectionStart !== undefined && el.selectionStart !== null) {
      try { snap.start = el.selectionStart; snap.end = el.selectionEnd; } catch (err) { /* not a text input */ }
    }
    return snap;
  }

  function restoreFocus(root, snap) {
    if (!snap) return;
    var node = root;
    for (var i = 0; i < snap.path.length; i++) {
      if (!node.children) return;
      node = node.children[snap.path[i]];
      if (!node) return;
    }
    try {
      node.focus({ preventScroll: true });
      if (snap.start !== undefined && node.setSelectionRange) {
        node.setSelectionRange(snap.start, snap.end);
      }
    } catch (err) { /* element is no longer focusable */ }
  }

  // ── DOM patching ──────────────────────────────────────────────────────────
  // Replacing innerHTML on every render destroys and rebuilds the whole tree.
  // Scroll position resets, CSS animations restart from frame zero, hover is
  // lost and the screen visibly flashes — every two seconds while a job runs,
  // whether or not anything changed. Patching touches only what actually
  // differs, so untouched nodes keep their scroll, focus and animation state.

  function sameNode(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType === 3) return true;                       // both text
    return a.nodeName === b.nodeName;
  }

  function syncAttributes(target, source) {
    // The host styles some of the design's own nodes -- the preview frame's
    // shape, the Templates column that has to scroll rather than the page. The
    // generated source carries no style attribute for those, so syncing blindly
    // stripped them on every patch: the page became scrollable again between
    // paints, and the next paint reset the scroll position, which read as being
    // yanked back to the top every couple of seconds.
    //
    // data-host-style marks a node whose style the host owns. Attributes named
    // data-host-* are never removed either, or the marker would be stripped on
    // the first patch and take the protection with it.
    var hostStyled = target.hasAttribute('data-host-style');
    var next = source.attributes;
    for (var i = 0; i < next.length; i++) {
      var attr = next[i];
      if (hostStyled && attr.name === 'style') continue;
      if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value);
    }
    // Remove anything the new render dropped, walking backwards because the
    // collection is live.
    var current = target.attributes;
    for (var j = current.length - 1; j >= 0; j--) {
      var name = current[j].name;
      if (name.indexOf('data-host') === 0) continue;
      if (hostStyled && name === 'style') continue;
      if (!source.hasAttribute(name)) target.removeAttribute(name);
    }
    // Form state lives on the property, not the attribute. Skip the field the
    // user is currently typing in so a re-render cannot fight their keystrokes.
    if ('value' in target && source.hasAttribute('value') && target !== document.activeElement) {
      var wanted = source.getAttribute('value');
      if (target.value !== wanted) target.value = wanted;
    }
  }

  // Nodes the host page injected into the design's tree — the live-work section
  // is docked inside a generated column — are not in the generated HTML.
  // Pairing children by raw index would compare one against a generated sibling,
  // replace it, and shift everything after it by one. They are skipped when
  // pairing and left exactly where the host put them.
  function hostOwned(node) {
    return node.nodeType === 1 && node.hasAttribute('data-host-owned');
  }

  function patch(target, source) {
    var oldNodes = [];
    for (var k = 0; k < target.childNodes.length; k++) {
      if (!hostOwned(target.childNodes[k])) oldNodes.push(target.childNodes[k]);
    }
    var newNodes = source.childNodes;
    var count = Math.max(oldNodes.length, newNodes.length);
    for (var i = 0; i < count; i++) {
      var oldNode = oldNodes[i];
      var newNode = newNodes[i];
      if (!newNode) {
        // A node the new render does not have. oldNodes is a snapshot, so
        // removing one cannot disturb the rest of this walk.
        if (oldNode) target.removeChild(oldNode);
        continue;
      }
      if (!oldNode) { target.appendChild(newNode.cloneNode(true)); continue; }
      if (!sameNode(oldNode, newNode)) { target.replaceChild(newNode.cloneNode(true), oldNode); continue; }
      if (oldNode.nodeType === 3) {
        if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
        continue;
      }
      syncAttributes(oldNode, newNode);
      patch(oldNode, newNode);
    }
  }

  // A `value` attribute does not select an <option>; HTML needs `selected` on the
  // option itself, so a <select> rendered from markup always fell to index 0. The
  // Templates picker therefore opened the wrong style, and anything saved there
  // never reached the user's clips. Applying value as a property after the swap
  // fixes every dropdown at once.
  function applyFormValues(root) {
    var fields = root.querySelectorAll('select[value], input[value], textarea[value]');
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (el === document.activeElement) continue;   // never overwrite what is being typed
      var wanted = el.getAttribute('value');
      if (el.value !== wanted) el.value = wanted;
    }
  }

  Studio.prototype.render = function (vals) {
    var r = new Renderer();
    var out = [];
    r.render(this.template, vals, out);
    var html = out.join('');

    // Handlers are re-indexed every render, so they are always taken -- but if
    // the markup is byte-identical there is nothing to do to the DOM. This is
    // the common case while polling: a job advances, the payload changes, the
    // rendered screen does not.
    this.handlers = r.handlers;
    if (html === this.lastHtml) { this.bind(); return; }
    this.lastHtml = html;

    if (!this.root.firstChild) {
      // First paint: nothing to patch against.
      this.root.innerHTML = html;
      applyFormValues(this.root);
      this.bind();
      return;
    }

    var next = document.createElement('div');
    next.innerHTML = html;
    var snap = captureFocus(this.root);
    patch(this.root, next);
    applyFormValues(this.root);
    restoreFocus(this.root, snap);
    this.bind();
  };

  global.StudioRuntime = {
    // mount(rootEl) -> { render(vals) }
    mount: function (root, template) {
      var tpl = template || global.STUDIO_TEMPLATE;
      if (!tpl) throw new Error('studio-runtime: STUDIO_TEMPLATE missing — run scripts/import-design.mjs');
      return new Studio(root, tpl);
    },
    // Exposed for tests.
    _internals: { evalValue: evalValue, lookup: lookup, Renderer: Renderer },
  };
})(typeof window !== 'undefined' ? window : globalThis);
