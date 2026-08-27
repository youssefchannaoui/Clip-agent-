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
  function addRevealButtons() {
    var fields = document.querySelectorAll('input[type="password"]');
    Array.prototype.forEach.call(fields, function (field) {
      if (field.dataset.revealReady) return;
      field.dataset.revealReady = '1';

      var wrap = document.createElement('span');
      wrap.style.cssText = 'position:relative;display:block';
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
      field.style.paddingRight = '46px';

      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
      button.textContent = 'Show';
      button.style.cssText = 'position:absolute;top:50%;right:8px;transform:translateY(-50%);'
        + 'padding:6px 9px;border:0;border-radius:9px;background:transparent;'
        + 'color:#aaa59e;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer';

      button.addEventListener('click', function () {
        var shown = field.type === 'text';
        field.type = shown ? 'password' : 'text';
        button.textContent = shown ? 'Show' : 'Hide';
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
