/*
 * Holds the clip editor back until it is ready, without hiding that it exists.
 *
 * The editor still opens from the queue and still draws itself, blurred, behind
 * a notice -- so what is coming is visible and what is not ready is stated. The
 * blur is studio-editor-gate.css; this file adds the notice and makes the
 * editor unreachable underneath it.
 *
 * Both halves are needed. CSS pointer-events stops the mouse; only `inert`
 * stops the keyboard, and a Save button that is merely blurry can still be
 * tabbed to and pressed -- which would write an edit nobody asked for onto a
 * customer's clip.
 *
 * Built here rather than in the design export on purpose: turning the editor on
 * is then deleting two files and one <link>, with no design re-import and no
 * regenerated class names.
 */
(function () {
  'use strict';

  var OVERLAY_ID = 'dcEditorSoon';

  function closeEditor() {
    // The app's own binding first; the back link is the fallback. A synthetic
    // click still runs its handler even though the link is inert -- inert
    // stops the user, not the page.
    // bindings is a FUNCTION that builds a fresh set for the current state, not
    // a standing object -- reading .closeEditor off it directly finds nothing.
    var adapter = window.StudioAdapter;
    var built = adapter && typeof adapter.bindings === 'function' ? adapter.bindings() : null;
    var close = built && built.closeEditor;
    if (typeof close === 'function') { close(); return; }
    var back = document.querySelector('#studio [data-dc-editor] a[href="#"]');
    if (back) back.click();
  }

  function buildNotice() {
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    var card = document.createElement('div');
    // The notice speaks for the region the editor would have announced, which
    // is now hidden from assistive technology along with the rest of it.
    card.setAttribute('role', 'status');

    var badge = document.createElement('span');
    badge.className = 'dc-soon-badge';
    badge.textContent = 'Coming soon';

    var heading = document.createElement('h2');
    heading.textContent = 'The clip editor lands in the next update';

    var lead = document.createElement('p');
    lead.textContent = 'Retiming captions, reframing the speaker and trimming a clip all happen '
      + 'here — it is close, but not ready for your clips yet.';

    var reassurance = document.createElement('p');
    reassurance.className = 'dc-soon-quiet';
    reassurance.textContent = 'Nothing else changes: review, approve, schedule and download '
      + 'your clips from the queue as usual.';

    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Back to the queue';
    button.addEventListener('click', closeEditor);

    card.appendChild(badge);
    card.appendChild(heading);
    card.appendChild(lead);
    card.appendChild(button);
    card.appendChild(reassurance);
    overlay.appendChild(card);
    return overlay;
  }

  // What the topbar says instead of the beta line, which promises that edits
  // save the moment they are made -- true of the editor, not of this.
  var GATED_SUBTITLE = 'Opens in the next update. Your clips are unaffected.';

  function apply() {
    var editor = document.querySelector('#studio [data-dc-editor]');
    // Read by studio-editor-gate.css to silence the beta popup, which explains
    // how saving works on a screen where nothing saves. Set on <body>, which
    // sits outside the observed subtree, so this cannot re-trigger the observer.
    document.body.classList.toggle('dc-editor-gated', !!editor);
    if (!editor) return;

    // Only ever rewrites the editor's own beta line, and only while the editor
    // is the screen: every other subtitle is left exactly as the app wrote it.
    var subtitle = document.querySelector('#dcTopbar > div:first-child > span');
    if (subtitle && /beta/i.test(subtitle.textContent) && subtitle.textContent !== GATED_SUBTITLE) {
      subtitle.textContent = GATED_SUBTITLE;
    }
    var overlay = editor.querySelector('#' + OVERLAY_ID);
    if (!overlay) {
      overlay = buildNotice();
      editor.appendChild(overlay);
    }
    // Re-applied after every render: the app rebuilds this subtree, and a fresh
    // node arrives without the attribute.
    var children = editor.children;
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child === overlay) continue;
      // Guarded so this never mutates on a pass with nothing to do -- the
      // observer that calls it watches for exactly these mutations.
      if (!child.inert) {
        child.inert = true;
        child.setAttribute('aria-hidden', 'true');
      }
    }
  }

  function start() {
    var studio = document.getElementById('studio');
    if (!studio) return;
    apply();
    new MutationObserver(apply).observe(studio, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
