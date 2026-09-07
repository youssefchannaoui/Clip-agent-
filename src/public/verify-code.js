/*
 * The six-digit confirmation screen's behaviour.
 *
 * A separate file loaded with src= rather than an inline block, for the same
 * reason auth-enhance.js is one: the CSP allows inline scripts only by sha256,
 * and those hashes are computed from src/public/index.html alone. This page is
 * a template literal in auth.js, so an inline block would be blocked at runtime
 * while looking perfectly correct in the source.
 *
 * EVERYTHING HERE IS AN ENHANCEMENT AND THE PAGE WORKS WITHOUT IT. The six
 * cells are six real inputs in a real form, named code1..code6 and joined by
 * the server, so somebody with JavaScript off can type their code and press
 * the button exactly as before. The raised/sunk state of a cell is CSS
 * (:placeholder-shown), not script. What this file adds is the moving light,
 * the auto-advance, spreading a pasted or autofilled code across the cells,
 * the resend cooldown, and the confirmed disc at the end.
 *
 * Getting this wrong locks somebody out of an account they have just paid to
 * create, so every path below falls back to the ordinary form post.
 */
(function () {
  'use strict';

  var form = document.getElementById('vcForm');
  var card = document.getElementById('vcCard');
  if (!form || !card) return;

  var root = document.documentElement;
  var cells = Array.prototype.slice.call(form.querySelectorAll('.vc-cell input'));
  if (!cells.length) return;

  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ lamp */

  /*
   * ONE light source, and every shadow on the page is a plain multiple of the
   * same two numbers -- so the cells, the card and the button can never
   * disagree about where the light is.
   *
   * --sx/--sy are the direction a SHADOW FALLS, not where the light is. The
   * negation happens once, here, which is what keeps every rule in the
   * stylesheet a positive multiple and readable.
   *
   * The default is light from above and slightly left, which is what the page
   * renders as with no pointer at all: on a phone, with this file blocked, or
   * for anyone who asked for less motion.
   */
  var shadowX = 0.34;
  var shadowY = 0.72;
  var queued = false;

  function clamp(value) { return value < -1 ? -1 : value > 1 ? 1 : value; }

  function paintLamp() {
    queued = false;
    root.style.setProperty('--sx', shadowX.toFixed(3));
    root.style.setProperty('--sy', shadowY.toFixed(3));
  }

  function moveLamp(event) {
    var box = card.getBoundingClientRect();
    if (!box.width || !box.height) return;
    var dx = clamp((event.clientX - (box.left + box.width / 2)) / (box.width * 0.9));
    var dy = clamp((event.clientY - (box.top + box.height / 2)) / (box.height * 0.9));
    // Distance from the centre scales the throw, so the shadows are shortest
    // when the pointer is over the card and longest out at the edges.
    var reach = Math.min(1, Math.sqrt(dx * dx + dy * dy));
    shadowX = -dx * reach;
    shadowY = -dy * reach;
    // ONE rAF that parks itself the moment it has painted. A pointer reports
    // far faster than the screen draws, and a still page costs nothing.
    if (!queued) { queued = true; window.requestAnimationFrame(paintLamp); }
  }

  // Only where there is a pointer to follow. On a touch screen the light would
  // jump on every tap, which reads as a glitch rather than as lighting.
  if (!still && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('pointermove', moveLamp, { passive: true });
  }

  /* ----------------------------------------------------------------- cells */

  function focusCell(index) {
    var cell = cells[index];
    if (!cell) return;
    cell.focus();
    try { cell.select(); } catch (err) { /* older browsers refuse select() on some inputs */ }
  }

  /*
   * A pasted code, an iOS one-time-code autofill, or an Android keyboard
   * handing over the whole thing arrives as several characters in ONE field.
   * Truncating to a single digit and dropping the rest is the classic failure
   * of this control, so the digits are spread across the cells instead.
   */
  function spread(text, from) {
    var digits = String(text).replace(/\D/g, '').split('');
    if (!digits.length) return;
    var at = from;
    while (at < cells.length && digits.length) {
      cells[at].value = digits.shift();
      at += 1;
    }
    focusCell(Math.min(at, cells.length - 1));
  }

  cells.forEach(function (cell, index) {
    cell.addEventListener('input', function () {
      if (cell.value.length > 1) { spread(cell.value, index); return; }
      cell.value = cell.value.replace(/\D/g, '');
      if (cell.value) focusCell(index + 1);
    });

    cell.addEventListener('keydown', function (event) {
      if (event.key === 'Backspace' && !cell.value && index > 0) {
        // Backspace on an empty cell clears the one before it and goes there,
        // which is what everybody expects and what makes a mistyped code
        // recoverable without reaching for the mouse.
        event.preventDefault();
        cells[index - 1].value = '';
        focusCell(index - 1);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        focusCell(index - 1);
      } else if (event.key === 'ArrowRight' && index < cells.length - 1) {
        event.preventDefault();
        focusCell(index + 1);
      }
    });

    cell.addEventListener('paste', function (event) {
      var clip = event.clipboardData || window.clipboardData;
      if (!clip) return;
      var text = clip.getData('text');
      if (!text) return;
      event.preventDefault();
      spread(text, index);
    });

    cell.addEventListener('focus', function () {
      try { cell.select(); } catch (err) { /* as above */ }
    });
  });

  /*
   * IT DOES NOT SUBMIT ITSELF WHEN THE SIXTH DIGIT LANDS, deliberately.
   * The record allows six wrong attempts and is then spent, so one mistyped
   * digit submitting on its own costs a sixth of somebody's allowance before
   * they have had a chance to look at what they typed.
   */

  /* --------------------------------------------------------------- resend */

  /*
   * The server rate-limits resends to five an hour. This countdown is not that
   * limit -- it is what stops somebody spending all five in ten seconds, and it
   * only runs after a code has ACTUALLY been sent (the page comes back with the
   * cooldown stamped on the button). With this file blocked the button is an
   * ordinary submit and the server's own limit is still the real one.
   */
  var resend = document.getElementById('vcResend');
  var cooldown = resend ? parseInt(resend.getAttribute('data-cooldown') || '0', 10) : 0;
  if (resend && cooldown > 0) {
    var label = resend.textContent;
    var left = cooldown;
    resend.disabled = true;
    resend.classList.add('is-waiting');
    var tick = function () {
      if (left <= 0) {
        window.clearInterval(timer);
        resend.disabled = false;
        resend.classList.remove('is-waiting');
        resend.textContent = label;
        return;
      }
      resend.textContent = 'Another code in ' + left + 's';
      left -= 1;
    };
    var timer = window.setInterval(tick, 1000);
    tick();
  }

  /* --------------------------------------------------------------- submit */

  var busy = false;

  form.addEventListener('submit', function (event) {
    if (busy) { event.preventDefault(); return; }
    busy = true;
    card.classList.add('is-verifying');

    // No fetch means the ordinary post, with the pressed state still showing.
    if (!window.fetch || !window.URLSearchParams || !window.FormData) return;
    event.preventDefault();

    var data = new window.URLSearchParams();
    new window.FormData(form).forEach(function (value, key) { data.append(key, value); });

    window.fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data.toString(),
      credentials: 'same-origin'
    }).then(function (response) {
      var landed = new URL(response.url, window.location.href);
      /*
       * A wrong or expired code redirects back to this page with the reason in
       * the query string. Follow it rather than writing the copy again here --
       * the server already knows which of the three things went wrong, and a
       * second version of that wording would drift from the first.
       */
      if (!response.ok || landed.pathname === '/verify') {
        window.location.assign(response.url);
        return;
      }
      // Confirmed. Only now -- this is the server's answer, not a guess.
      card.classList.remove('is-verifying');
      card.classList.add('is-done');
      window.setTimeout(function () { window.location.assign(response.url); }, still ? 0 : 900);
    }).catch(function () {
      /*
       * A network hiccup here must never leave somebody standing outside their
       * own account looking at a spinner. The ordinary post is the fallback --
       * a programmatic submit() does not re-enter this handler, so it cannot
       * loop.
       */
      card.classList.remove('is-verifying');
      busy = false;
      form.submit();
    });
  });
})();
