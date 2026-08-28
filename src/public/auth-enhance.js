/*
 * Small enhancements for the signed-out pages.
 *
 * A separate file loaded with src= rather than an inline block, deliberately:
 * the CSP allows inline scripts only by sha256, and those hashes are computed
 * from src/public/index.html alone. The sign-in page is a template literal in
 * auth.js, so an inline block there would be blocked at runtime while looking
 * perfectly correct in the source.
 *
 * Everything here is progressive: the forms work without it.
 */
(function () {
  'use strict';

  /*
   * Show the password.
   *
   * On a phone this is the difference between signing in and being locked out:
   * the field is masked, the keyboard is small, and a wrong password used to be
   * unrecoverable. There is a reset now, but not needing it is better.
   */
  /*
   * Inline SVG rather than an icon font: the signed-out pages load no icon
   * set, and pulling one in for two glyphs would cost a network request on the
   * first screen anybody sees.
   *
   * Crossed-out eye while the password is hidden, plain eye once it is shown —
   * the icon describes the state of the field, which is the convention people
   * already have from every other sign-in form.
   */
  var EYE_OPEN = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M10.6 6.1A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17.7 17.7 0 0 1-3.4 4.2M6.3 7.8A17.4 17.4 0 0 0 2 12s3.6 6.5 10 6.5a9.8 9.8 0 0 0 4-.8"/>'
    + '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/></svg>';

  function addRevealButtons() {
    var fields = document.querySelectorAll('input[type="password"]');
    Array.prototype.forEach.call(fields, function (field) {
      if (field.dataset.revealReady) return;
      field.dataset.revealReady = '1';

      var wrap = document.createElement('span');
      wrap.style.cssText = 'position:relative;display:block';
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
      field.style.paddingRight = '44px';

      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = EYE_OFF;
      // A 34px target: comfortably tappable, and small enough that it never
      // crowds the text the way a word does.
      button.style.cssText = 'position:absolute;top:50%;right:7px;transform:translateY(-50%);'
        + 'display:grid;place-items:center;width:34px;height:34px;padding:0;'
        + 'border:0;border-radius:9px;background:transparent;color:#8b867f;'
        + 'cursor:pointer;transition:color .16s ease';
      button.addEventListener('mouseenter', function () { button.style.color = '#f1d18e'; });
      button.addEventListener('mouseleave', function () { button.style.color = '#8b867f'; });
      button.addEventListener('focus', function () { button.style.color = '#f1d18e'; });
      button.addEventListener('blur', function () { button.style.color = '#8b867f'; });

      button.addEventListener('click', function () {
        var shown = field.type === 'text';
        field.type = shown ? 'password' : 'text';
        button.innerHTML = shown ? EYE_OFF : EYE_OPEN;
        // The icon carries the meaning now that the word is gone, so the label
        // has to say it out loud for anyone not looking at it.
        button.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
        button.setAttribute('aria-pressed', shown ? 'false' : 'true');
        // Focus goes back to the field with the caret at the end, so revealing
        // mid-typing does not cost the person their place.
        field.focus();
        var end = field.value.length;
        try { field.setSelectionRange(end, end); } catch (error) { /* number-ish inputs */ }
      });

      wrap.appendChild(button);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addRevealButtons);
  } else {
    addRevealButtons();
  }
}());
