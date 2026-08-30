/*
 * The two free tools on the public site.
 *
 * Both do the thing the page says, in the visitor's own browser, with no
 * account and nothing sent to a server. That is the whole point: a "free tool"
 * that is a form leading to a sign-up is the oldest bait in this industry, and
 * one of those would cost more trust than the traffic is worth.
 *
 * Nothing here can make the pipeline do free work either. The safe zone
 * checker never uploads the image -- it is read with FileReader and drawn to a
 * canvas -- and the calculator is arithmetic.
 *
 * A separate file rather than an inline block because the CSP hashes inline
 * scripts from index.html only, and marketing pages have no such allowance.
 */
(function () {
  'use strict';


  /* ── Did these tools produce customers? ────────────────────────────────────
     A free tool is worth building only if it earns something, and there is no
     way to know without measuring the funnel it sits in:

       tool opened -> tool actually used -> CTA clicked -> signup -> paid

     The first three are recorded here. The last two already exist: the landing
     cookie is set on arrival, so a visitor who reaches this page, uses the
     tool, clicks through and later subscribes is credited to it in
     Owner -> Traffic like any other page.

     One beacon per event per page load, a bare event name and nothing else --
     no identifier, no payload, no third-party script. If the request fails,
     nothing happens: measurement must never break a tool. */
  var fired = {};
  function record(event) {
    if (fired[event]) return;
    fired[event] = true;
    try {
      var body = new Blob([JSON.stringify({ event: event })], { type: 'application/json' });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/tool-event', body);
      else fetch('/api/tool-event', { method: 'POST', body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* measurement must never break the tool */ }
  }

  /* ── Safe zone checker ─────────────────────────────────────────────────────
     Draws each platform's covered area over a frame the visitor supplies, so
     they can see what is hidden rather than measuring pixels against a blog
     post. The numbers are the ones stated in the guide, and they are working
     rules rather than a specification -- platforms move their interface
     without announcing it, which is exactly why seeing it on a real frame is
     worth more than the numbers are. */

  // Insets from each edge of a 1080x1920 frame, as of August 2026.
  var ZONES = {
    tiktok: { label: 'TikTok', top: 100, right: 140, bottom: 320, left: 40, colour: '#ff4d6d' },
    reels: { label: 'Instagram Reels', top: 220, right: 130, bottom: 430, left: 40, colour: '#c86bff' },
    shorts: { label: 'YouTube Shorts', top: 90, right: 60, bottom: 250, left: 40, colour: '#ff8a3d' },
  };
  // The union of all three, rounded outward: one export that works everywhere.
  var UNIVERSAL = { label: 'Safe on all three', width: 900, height: 1400, colour: '#79d6a0' };

  function initSafeZones(root) {
    var canvas = root.querySelector('[data-sz-canvas]');
    var input = root.querySelector('[data-sz-file]');
    var drop = root.querySelector('[data-sz-drop]');
    var status = root.querySelector('[data-sz-status]');
    if (!canvas || !input) return;

    var ctx = canvas.getContext('2d');
    var image = null;
    // The canvas is a scaled 1080x1920: every number below is in frame pixels
    // and divided by this, so the guide and the drawing cannot disagree.
    var SCALE = canvas.width / 1080;

    function activeZones() {
      return Array.prototype.filter.call(
        root.querySelectorAll('[data-sz-zone]'), function (box) { return box.checked; }
      ).map(function (box) { return box.getAttribute('data-sz-zone'); });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#141416';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (image) {
        // Cover: fill the 9:16 frame, cropping the overflow, which is what a
        // vertical export actually does to a 16:9 source.
        var scale = Math.max(canvas.width / image.width, canvas.height / image.height);
        var w = image.width * scale, h = image.height * scale;
        ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      } else {
        ctx.fillStyle = '#5c5952';
        ctx.font = '500 13px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Add a frame to see the zones over it', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'start';
      }

      var chosen = activeZones();
      chosen.forEach(function (key) {
        if (key === 'universal') {
          var uw = UNIVERSAL.width * SCALE, uh = UNIVERSAL.height * SCALE;
          var ux = (canvas.width - uw) / 2, uy = (canvas.height - uh) / 2;
          ctx.save();
          ctx.strokeStyle = UNIVERSAL.colour;
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          ctx.strokeRect(ux, uy, uw, uh);
          ctx.setLineDash([]);
          ctx.fillStyle = UNIVERSAL.colour;
          ctx.font = '600 11px Inter, system-ui, sans-serif';
          ctx.fillText(UNIVERSAL.label, ux + 6, uy - 6);
          ctx.restore();
          return;
        }
        var z = ZONES[key];
        if (!z) return;
        ctx.save();
        ctx.fillStyle = z.colour;
        ctx.globalAlpha = 0.28;
        // Four bands: the parts the platform covers with its own interface.
        ctx.fillRect(0, 0, canvas.width, z.top * SCALE);
        ctx.fillRect(0, canvas.height - z.bottom * SCALE, canvas.width, z.bottom * SCALE);
        ctx.fillRect(canvas.width - z.right * SCALE, 0, z.right * SCALE, canvas.height);
        ctx.fillRect(0, 0, z.left * SCALE, canvas.height);
        ctx.restore();
      });

      if (status) {
        status.textContent = chosen.length
          ? 'Shaded areas are covered by the platform. ' + (image ? '' : 'Add a frame to see it over your own clip.')
          : 'Choose a platform to see what it covers.';
      }
    }

    function load(file) {
      if (!file || !/^image\//.test(file.type)) {
        if (status) status.textContent = 'That is not an image file.';
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () { image = img; draw(); };
        img.onerror = function () { if (status) status.textContent = 'That image could not be read.'; };
        img.src = e.target.result;
      };
      // Read locally. The file never leaves the browser -- there is no upload
      // anywhere in this function and there must not be one.
      reader.readAsDataURL(file);
    }

    input.addEventListener('change', function () { record('safezone_used'); load(input.files && input.files[0]); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-sz-zone]'), function (box) {
      box.addEventListener('change', draw);
    });
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (name) {
        drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function (name) {
        drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
      });
      drop.addEventListener('drop', function (e) {
        record('safezone_used');
        load(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    }
    draw();
  }

  /* ── Clip calculator ───────────────────────────────────────────────────────
     Arithmetic, shown rather than hidden, so the answer can be checked. One
     token is one source minute; the free allowance is 40. Both are read from
     data attributes the server writes, so they cannot drift from billing. */

  function initCalculator(root) {
    var out = root.querySelector('[data-cc-out]');
    if (!out) return;
    var perMinute = Number(root.getAttribute('data-tokens-per-minute')) || 1;
    var freeTokens = Number(root.getAttribute('data-free-tokens')) || 0;

    function value(name, fallback) {
      var el = root.querySelector('[data-cc="' + name + '"]');
      var n = el ? Number(el.value) : NaN;
      return isFinite(n) && n >= 0 ? n : fallback;
    }

    function recalc() {
      var lengthMin = Math.min(600, value('length', 60));
      var usefulPct = Math.min(100, value('useful', 20));
      var clipSec = Math.max(5, Math.min(180, value('cliplen', 40)));

      var selectedMin = lengthMin * (usefulPct / 100);
      var tokens = Math.ceil(selectedMin * perMinute);
      // Not every selected minute becomes a clip -- some of it is the run-up
      // to a moment and the tail after it. Two thirds is a deliberately
      // conservative yield, and it is stated rather than hidden so the number
      // can be argued with.
      var clips = Math.floor((selectedMin * 60 * 0.66) / clipSec);

      root.querySelectorAll('[data-cc-echo]').forEach(function (el) {
        var k = el.getAttribute('data-cc-echo');
        if (k === 'useful') el.textContent = Math.round(usefulPct) + '%';
        if (k === 'cliplen') el.textContent = Math.round(clipSec) + 's';
      });

      var rows = [
        ['Minutes you would process', selectedMin < 1 ? selectedMin.toFixed(1) : Math.round(selectedMin) + ''],
        ['Tokens it costs', String(tokens)],
        ['Clips you would likely get', String(Math.max(0, clips))],
      ];
      var note = tokens <= freeTokens
        ? 'That fits inside the ' + freeTokens + ' tokens on the free plan.'
        : 'That is ' + (tokens - freeTokens) + ' tokens beyond the free plan’s ' + freeTokens + '.';

      out.innerHTML = rows.map(function (r) {
        return '<div class="cc-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>';
      }).join('') + '<p class="cc-note">' + note + '</p>';
    }

    Array.prototype.forEach.call(root.querySelectorAll('[data-cc]'), function (el) {
      el.addEventListener('input', function () { record('calculator_used'); });
      el.addEventListener('input', recalc);
      el.addEventListener('change', recalc);
    });
    recalc();
  }

  function boot() {
    var sz = document.querySelector('[data-tool="safe-zones"]');
    if (sz) { record('safezone_open'); initSafeZones(sz); }
    var cc = document.querySelector('[data-tool="clip-calculator"]');
    if (cc) { record('calculator_open'); initCalculator(cc); }
    // The CTA after the value has been delivered, never before it: the tool is
    // never interrupted, and the click is only counted where a person had
    // already got what they came for.
    document.addEventListener('click', function (e) {
      var link = e.target && e.target.closest && e.target.closest('a[href*="/login"], a[href="/pricing"]');
      if (link) record('tool_cta_click');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
