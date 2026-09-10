/*
 * The Start-job panel, as designed on the canvas (design-canvas/Main.dc.html,
 * v9) and moved into the app as its own panel -- the same device as the
 * Templates screen and the phone: markup the host owns, drawn from the SAME
 * StudioAdapter bindings the export renders from, calling the SAME handlers.
 * No new state, no new route. The export's own dialog is hidden in place
 * while this is mounted; when the job closes the export removes the overlay
 * and this goes with it.
 *
 * The step LIST is the adapter's (JOB_STEPS): brief+range, kind, lengths,
 * template, sound, review. What this file owns is how each looks.
 */
(function () {
  'use strict';
  var ROOT_ID = 'dcJob';
  var LENGTH_BANDS = [[10, 30, 'Up to 30s'], [30, 45, '30–45s'], [45, 60, '45–60s'], [60, 90, '60–90s']];
  var DEST = [
    ['youtube', 'YouTube', '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000"></rect><path d="M10 9l5 3-5 3z" fill="#fff"></path></svg>'],
    ['tiktok', 'TikTok', '<svg viewBox="0 0 24 24"><path d="M16.5 3c.3 2.3 1.6 3.7 3.8 3.9v3.1c-1.4 0-2.7-.4-3.8-1.2v6.3c0 3.2-2.6 5.6-5.7 5.6S5 18.3 5 15.1s2.6-5.6 5.7-5.6c.3 0 .6 0 .9.1v3.2c-.3-.1-.6-.2-.9-.2-1.4 0-2.5 1.1-2.5 2.5s1.1 2.5 2.5 2.5 2.6-1.1 2.6-2.5V3z" fill="#fff"></path></svg>'],
    ['instagram', 'Instagram', '<svg viewBox="0 0 24 24" fill="none" stroke="#E1306C" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r="1.2" fill="#E1306C" stroke="none"></circle></svg>'],
    ['facebook', 'Facebook', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877F2"></circle><path d="M13.3 20v-6.2h2.1l.3-2.5h-2.4V9.8c0-.7.2-1.2 1.2-1.2h1.3V6.4c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.7H8.6v2.5h2.1V20z" fill="#fff"></path></svg>'],
  ];
  // The question, split the way the canvas sets it: a white line, then the
  // clause in gold italic.
  var Q = {
    brief: ['Which part, and', 'what for?'],
    kind: ['What are you', 'clipping?'],
    lengths: ['How many clips,', 'how long?'],
    style: ['Which', 'template?'],
    sound: ['What plays', 'underneath?'],
    review: ['Ready', 'to go'],
  };
  var NAMES = { brief: 'Lecture', kind: 'Kind', lengths: 'Clips', style: 'Template', sound: 'Sound', review: 'Review' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function A() { return window.StudioAdapter; }
  function B(DATA) { return A().bindings(DATA); }
  function repaint() { if (typeof window.paintStudio === 'function') window.paintStudio(); }
  function stepId(DATA) {
    var v = B(DATA);
    return v.jobIsStepBrief ? 'brief' : v.jobIsStepKind ? 'kind' : v.jobIsStepLengths ? 'lengths' : v.jobIsStepStyle ? 'style' : v.jobIsStepSound ? 'sound' : 'review';
  }
  function stepNo(id) { return ['brief', 'kind', 'lengths', 'style', 'sound', 'review'].indexOf(id) + 1; }
  function posterImage(vals) {
    var m = /background-image:\s*([^;]+);/.exec(vals.jobPosterStyle || '');
    return m ? m[1] : '';
  }
  // The template previews, at 1080-frame geometry scaled to the card. The
  // same numbers the canvas used, read from the template itself.
  function capStyle(t, w) {
    var k = w / 1080, mode = t.captionMode, size = Number(t.captionFontSize) || 60;
    var top = t.captionPosition === 'top', mid = t.captionPosition === 'middle';
    var mv = Number(t.captionMarginV) || 0;
    var pos = top ? 'top: ' + (mv / 1920 * 100).toFixed(1) + '%;' : mid ? 'top: 50%; transform: translateY(-50%);' : 'bottom: ' + (mv / 1920 * 100).toFixed(1) + '%;';
    // The stack's 187 is sized for four short words on a 1080 frame; on a
    // 196px card the sample's longest word needs a little less than scale.
    var fs = (size * k * (mode === 'quran' ? 1.6 : mode === 'stack-build' ? .82 : 1)).toFixed(1);
    return pos + ' font-size: ' + fs + 'px; letter-spacing: ' + ((Number(t.captionLetterSpacing) || 0) * k).toFixed(1) + 'px; line-height: ' + (t.captionLineHeight || 1.05) + ';'
      + (t.captionUppercase ? ' text-transform: uppercase;' : '') + " font-family: '" + esc(t.captionFont || 'Outfit') + "', Outfit, sans-serif; color: " + esc(t.captionPrimary || '#fff') + ';';
  }
  function capInner(t) {
    var mode = t.captionMode;
    if (mode === 'quran') return '<span class="tq">الرَّحْمَـٰنِ الرَّحِيمِ</span><small>The Most Merciful</small>';
    if (mode === 'stack-build') return '<span>He</span><span class="dim">never</span><span>stops</span><span class="dim">answering</span>';
    if (mode === 'cards') return '<span>He never stops answering</span>';
    if (mode === 'word') return '<span>answering</span>';
    return '<span>He never stops</span><span>answering you</span>';
  }
  function capCls(t) {
    var m = t.captionMode;
    return m === 'stack-build' ? 'bold' : m === 'cards' ? 'cards' : m === 'word' ? 'mono' : m === 'quran' ? 'quran' : 'head';
  }
  function tplCard(t, on, locked, w) {
    var q = t.captionMode === 'quran';
    return '<button type="button" class="tpl' + (on ? ' on' : '') + (locked ? ' locked' : '') + '" data-tpl="' + esc(t.name) + '" style="width: ' + w + 'px">'
      + '<img class="bg" src="' + (q ? '/marketing-assets/reel-quran.webp' : '/preview-sample.webp') + '"' + ((t.filterPreset === 'monochrome' || t.filterPreset === 'noir' || t.filterPreset === 'silver') ? ' style="filter: grayscale(1)"' : '') + '>'
      + (q ? '' : '<div class="mark" style="top: ' + Math.round(60 * w / 1080) + 'px; font-size: ' + (26 * w / 1080).toFixed(1) + 'px">DEENCLIPPED</div>')
      + '<div class="tc ' + capCls(t) + '" style="' + capStyle(t, w) + '">' + capInner(t) + '</div>'
      + '<div class="tplN"><span>' + esc(t.name) + '</span>' + (t.pro ? '<small>Pro</small>' : '') + '</div>'
      + '</button>';
  }

  function render(vals, DATA) {
    var ui = A().ui, job = ui.job || {};
    var id = stepId(DATA), n = stepNo(id), q = Q[id];
    var segs = '';
    for (var i = 1; i <= 6; i += 1) segs += '<div class="stp"><i style="transform: scaleX(' + (i <= n ? 1 : 0) + ')"></i></div>';
    var head = '<div class="hall"><img src="/marketing-assets/hero-hall.webp" alt=""></div><div class="hallFade"></div><div class="grain"></div>'
      + '<div class="frame"><div class="top">'
      + '<div class="poster" style="' + (posterImage(vals) ? 'background-image: ' + esc(posterImage(vals)) : '') + '"><span>' + esc(vals.jobRangeLabel) + '</span></div>'
      + '<div style="min-width: 0"><div class="eyebrow">New lecture</div><div class="lecT">' + esc(vals.jobSourceLabel) + '</div><div class="lecM">' + esc(vals.jobLenLabel) + '</div></div>'
      + '<div class="path"><div class="pathN"><b>' + n + '</b><span> / 6 · ' + NAMES[id] + '</span></div><div class="steps">' + segs + '</div>'
      + '</div></div>'
      + '<button type="button" class="x" data-act="close" aria-label="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
      + '<div class="hr"><i></i></div>'
      + '<div class="q"><h1 class="rv"><span>' + esc(q[0]) + '</span> <em>' + esc(q[1]) + '</em></h1><div class="lead rv">' + esc(vals.jobStepHint) + '</div></div>'
      + '<div class="work">';
    var body = '';
    if (id === 'brief') {
      var bars = (vals.jobWaveform || []).map(function (b) { return '<span style="' + esc(b.style).replace(/var\([^)]*\)/g, 'rgba(245,241,232,.22)') + '"></span>'; }).join('');
      var l = Number(vals.jobStart) || 0, r = Number(vals.jobEnd) || 100;
      body += '<div class="rv briefBig"><textarea class="briefBox" rows="2" maxlength="' + (vals.jobBriefMax || 400) + '" placeholder="Clip the parts about…">' + esc(vals.jobBrief) + '</textarea></div>'
        + '<div class="rv" style="margin-top: 18px"><div class="strip"><div class="wv">' + bars + '</div>'
        + '<div class="band" style="left: ' + l.toFixed(2) + '%; width: ' + Math.max(0, r - l).toFixed(2) + '%"><span class="grip" style="left: -4px"></span><span class="grip" style="right: -4px"></span></div>'
        + '<input class="a" type="range" min="0" max="100" value="' + l + '" data-act="start"><input class="b" type="range" min="0" max="100" value="' + r + '" data-act="end"></div>'
        + '<div class="clock"><span>0:00</span><b>' + esc(vals.jobRangeLabel) + (vals.jobCostBig ? ' · ' + esc(vals.jobCostBig) + ' ' + esc(vals.jobCostUnit) : '') + '</b><span>' + esc(vals.jobLenLabel.split(' · ')[0] || '') + '</span></div></div>'
        + '<div class="rv" style="display: flex; gap: 8px; margin-top: 10px">'
        + [['whole', 'Whole lecture', 0, 100], ['first', 'First third', 0, 33], ['middle', 'The middle', 33, 67], ['last', 'Last third', 67, 100]].map(function (c) {
          var on = Math.abs(l - c[2]) < 1 && Math.abs(r - c[3]) < 1;
          return '<button type="button" class="opt' + (on ? ' on' : '') + '" data-act="cut" data-a="' + c[2] + '" data-b="' + c[3] + '">' + c[1] + '</button>';
        }).join('') + '</div>'
        + '<div class="rv fnote" style="margin-top: 14px">Skip the box and the clipper picks the strongest moments on its own.</div>';
    } else if (id === 'kind') {
      var quran = Boolean(vals.jobTypeQuran);
      var lang = ui.jobLang || (quran ? 'ar' : 'en');
      body += '<div class="rv kinds">'
        + '<button type="button" class="kc' + (!quran ? ' on' : '') + '" data-act="kind" data-kind="lecture"><div class="pf"><img src="/preview-sample.webp" alt=""><div class="mk">DEENCLIPPED</div><div class="cyc"><span>He <b>never</b> stops</span><span><i>Turn back to Him</i></span><span>THE DOOR <b>NEVER</b> CLOSES</span></div></div>'
        + '<div><div class="kT">Islamic lecture</div><div class="kD">Captions what is said. Moments are scored and cut for you, with a nasheed underneath.</div></div><div class="kOn"></div></button>'
        + '<button type="button" class="kc' + (quran ? ' on' : '') + '" data-act="kind" data-kind="quran"><div class="pf"><img src="/marketing-assets/reel-quran.webp" alt=""><div class="cyc ar"><span>إِنَّ مَعَ الْعُسْرِ يُسْرًا<small>With hardship comes ease</small></span><span>فَاذْكُرُونِي أَذْكُرْكُمْ<small>Remember Me; I will remember you</small></span><span>وَسَيَجْزِي اللَّهُ الشَّاكِرِينَ<small>Allah will reward the grateful</small></span></div></div>'
        + '<div><div class="kT">Qur’an recitation</div><div class="kD">Captions the ayah from the Qur’an itself, with its translation. No nasheed, nothing over scripture.</div></div><div class="kOn"></div></button>'
        + '</div>'
        + '<div class="rv lang"><span>Spoken language</span>' + [['en', 'English'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['auto', 'Auto-detect']].map(function (x) {
          return '<button type="button" class="opt' + (lang === x[0] ? ' on' : '') + '" data-act="lang" data-lang="' + x[0] + '">' + x[1] + '</button>';
        }).join('') + '</div>';
    } else if (id === 'lengths') {
      var cs = DATA.clipSettings || {};
      var bands = Array.isArray(cs.clipLengthBands) && cs.clipLengthBands.length ? cs.clipLengthBands : [];
      var bandOn = function (lo, hi) { return bands.some(function (b) { return Number(b[0]) === lo && Number(b[1]) === hi; }); };
      var count = Number(cs.clipsPerVideo) || 6;
      var deck = '';
      var imgs = ['reel-halal', 'reel-dua', 'reel-beneficial', 'reel-dunya', 'reel-depart', 'reel-winter', 'reel-kaaba-a', 'reel-landscape'];
      var shown = Math.min(count, 8);
      for (var d = 0; d < 8; d += 1) {
        var k = d - (shown - 1) / 2;
        deck += '<div class="cardF" style="' + (d >= shown ? 'display: none' : 'transform: translateX(' + (110 + k * 22) + 'px) rotate(' + (k * 5) + 'deg); z-index: ' + d) + '"><img src="/marketing-assets/' + imgs[d] + '.webp" alt=""></div>';
      }
      body += '<div style="display: flex; gap: 40px; align-items: flex-start"><div class="deck rv">' + deck + '</div>'
        + '<div class="rv" style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 26px 34px">'
        + '<div class="sec"><div class="secT">How many</div><div style="display: flex; align-items: center; gap: 12px"><div class="seg">'
        + (vals.countOpts || []).map(function (o) { return '<button type="button" class="' + (o.label === String(count) ? 'on' : '') + '" data-act="count" data-n="' + esc(o.label) + '">' + esc(o.label) + '</button>'; }).join('')
        + '</div><span class="fnote">clips per lecture</span></div></div>'
        + '<div class="sec"><div class="secT">Lengths allowed · pick any</div><div class="opts">'
        + LENGTH_BANDS.map(function (b) { return '<button type="button" class="opt' + (bandOn(b[0], b[1]) ? ' on' : '') + '" data-act="band" data-lo="' + b[0] + '" data-hi="' + b[1] + '">' + b[2] + '</button>'; }).join('')
        + '</div><div class="fnote" style="margin-top: 8px">' + esc(bands.length ? bands.length + ' allowed · the clipper picks per moment' : 'Any length — tick some to narrow it') + (vals.jobLengthNote ? ' · ' + esc(vals.jobLengthNote) : '') + '</div></div>'
        + '</div></div>';
    } else if (id === 'style') {
      var active = vals.jobTpl || '';
      var cur = DATA.billing && DATA.billing.current;
      var paid = !cur ? true : (cur.features && typeof cur.features.templates === 'boolean') ? cur.features.templates : String(cur.plan || 'free') !== 'free';
      var tpls = DATA.templates || [];
      var w = 118;
      var mini = typeof window.dcTplMiniHtml === 'function' ? window.dcTplMiniHtml : null;
      body += mini
        ? '<div class="rv bgt-row dcjTpls">' + tpls.map(function (t) {
            var on = t.name === active, locked = Boolean(t.pro) && !paid;
            return '<button type="button" class="bgt-card' + (on ? ' on' : '') + (locked ? ' locked' : '') + '" data-tpl="' + esc(t.name) + '" title="' + esc(t.description || t.name) + '">' + mini(t)
              + (locked ? '<span class="bgt-lock dc-pro">Pro</span>' : '') + '<span class="bgt-name">' + esc(t.name) + '</span></button>';
          }).join('') + '</div>'
        : '<div class="rv tpls big">' + tpls.map(function (t) { return tplCard(t, t.name === active, Boolean(t.pro) && !paid, w); }).join('') + '</div>';
    } else if (id === 'sound') {
      if (vals.jobSoundBlocked) {
        body += '<div class="rv fnote" style="font-size: 14px; color: #a8a196">' + esc(vals.jobStepHint) + '</div>';
      } else {
        var vol = Number(vals.jobVolume) || 13;
        body += '<div class="soundWrap" style="display: flex; gap: 40px; align-items: flex-start; flex: 1; min-height: 0"><div class="rv trackList" style="flex: 1; display: flex; flex-direction: column; align-self: stretch">'
          + (vals.jobMusicOn ? (vals.jobNasheeds || []).map(function (t, ix) {
            var on = /rgba\(217,182,111/.test(t.style || '') || /F0D6A6/.test(t.style || '');
            var wave = ''; for (var wi = 0; wi < 22; wi += 1) wave += '<i style="animation-delay: ' + ((wi * 37) % 40) / 100 + 's"></i>';
            return '<button type="button" class="track' + (on ? ' on' : '') + '" data-act="track" data-ix="' + ix + '"><div class="play"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"></path></svg></div><div class="trT"><span>' + esc(t.label) + '</span><small>' + (ix === 0 ? 'A different nasheed under each clip' : 'Muffled, ducked under the voice') + '</small></div><div class="wave">' + wave + '</div></button>';
          }).join('') : '<div class="fnote">Nothing underneath — voice only.</div>')
          + '<button type="button" class="opt" data-act="upload" style="margin-top: 12px; align-self: flex-start">Upload a nasheed</button>'
          + '</div><div class="rv sec" style="width: 320px; flex: none">'
          + '<div class="secT">Nasheed</div><div class="seg"><button type="button" class="' + (vals.jobMusicOn ? 'on' : '') + '" data-act="music">Mixed in</button><button type="button" class="' + (!vals.jobMusicOn ? 'on' : '') + '" data-act="music">Off</button></div>'
          + (vals.jobMusicOn ? '<div class="secT" style="margin-top: 16px">Level under the voice</div><div class="sld"><span>Volume</span><div class="sldT"><i style="width: ' + vol + '%"></i><b style="left: ' + vol + '%"></b><input type="range" min="' + (vals.jobVolumeMin || 0) + '" max="' + (vals.jobVolumeMax || 100) + '" value="' + vol + '" data-act="volume"></div><span class="sldV">' + esc(vals.jobVolumeValue) + '</span></div>'
          + '<div class="fnote" style="line-height: 1.6">Of the speaker’s level, and ducked further wherever the voice is loudest.</div>' : '')
          + '</div></div>';
      }
    } else {
      var ps = DATA.publishingSettings || {}, provs = (DATA.social || {}).providers || {};
      var usable = DEST.filter(function (m) { return provs[m[0]] && provs[m[0]].connected && ps[m[0]] && ps[m[0]].enabled; });
      if (!Array.isArray(ui.jobPublishTo)) ui.jobPublishTo = usable.map(function (m) { return m[0]; });
      var dests = usable.length ? usable.map(function (m) {
        var on = ui.jobPublishTo.indexOf(m[0]) !== -1;
        var acct = (provs[m[0]].accounts && provs[m[0]].accounts[0] && (provs[m[0]].accounts[0].name || provs[m[0]].accounts[0].title)) || provs[m[0]].name || '';
        return '<button type="button" class="dst' + (on ? ' on' : ' off') + '" data-act="dest" data-k="' + m[0] + '">' + m[2] + '<div><b>' + m[1] + '</b><small>' + esc(acct) + '</small></div><i class="dstS">' + (on ? 'Posting' : 'Skipped') + '</i></button>';
      }).join('') : '<div class="fnote">No destination connected yet. The clips still land in your review queue.</div>';
      var rows = (vals.jobSummaryRows || []).map(function (r) {
        return '<div class="row"><span class="rk">' + esc(r.label) + '</span>' + (r.go ? '<button type="button" class="re" data-act="row" data-label="' + esc(r.label) + '">Edit</button>' : '') + '<span class="rvv">' + esc(r.value) + '</span></div>';
      }).join('');
      var plan = (vals.jobPlanSteps || []).map(function (p, ix) {
        return '<div class="wr"><div class="wn">' + (ix + 1) + '</div><div><div class="wt">' + esc(p.title) + '</div><div class="ws">' + esc(p.note) + '</div></div></div>';
      }).join('');
      body += '<div class="review"><div class="revL rv"><div class="secT">Posting to</div><div class="dests">' + dests + '</div>'
        + '<div class="fnote" style="margin-top: 8px">Just this lecture. Your Connections settings stay as they are.</div>'
        + '<div class="secT" style="margin-top: 16px">What happens next</div><div class="what">' + plan + '</div></div>'
        + '<div class="revCard rv"><div><div class="secT">This run costs</div><div class="cost"><b>' + esc(vals.jobCostBig) + '</b><span>' + esc(vals.jobCostUnit) + '</span></div><div class="fnote" style="margin-top: 4px">' + esc(vals.jobCostBasis) + '</div></div>'
        + '<div class="hrl"></div><div class="rows" style="margin-top: 0">' + rows + '</div>'
        + '<div class="clockBox"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d9b66f" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg><div><b>' + esc(vals.jobEtaLabel) + '</b><span>' + esc(vals.jobQueueLabel) + '</span></div></div>'
        + (vals.genBusy ? '<div class="fnote">' + esc(vals.genProgressLabel || 'Starting…') + '</div>' : '')
        + '<button type="button" class="go" data-act="generate"' + (vals.genBusy ? ' disabled' : '') + '><span>' + esc(vals.genLabel || 'Generate clips') + '</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"></path></svg></button>'
        + '</div></div>';
    }
    var blocker = vals.jobNextLabel && vals.jobNextLabel !== 'Continue' ? vals.jobNextLabel : '';
    var foot = '</div><div class="foot">'
      + (n > 1 ? '<button type="button" class="back" data-act="back"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6M12 5l-7 7 7 7"></path></svg>Back</button>' : '<span></span>')
      + '<div class="fnote">' + (id === 'review' ? 'Anything above can still be changed.' : 'Step ' + n + ' of 6' + (vals.jobCostBig ? ' · ' + esc(vals.jobCostBig) + ' ' + esc(vals.jobCostUnit) : '') + (vals.jobEtaLabel ? ' · ' + esc(vals.jobEtaLabel).toLowerCase() : '')) + '</div>'
      + (id !== 'review' ? '<button type="button" class="cta" data-act="next"' + (blocker ? ' style="opacity: .6"' : '') + '><span>' + esc(blocker || 'Continue') + '</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"></path></svg></button>' : '')
      + '</div></div>';
    return head + body + foot;
  }

  function wire(root, DATA) {
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      var act = el.dataset.act, v = B(DATA), ui = A().ui;
      e.preventDefault(); e.stopPropagation();
      if (act === 'close') return v.closeJob(e);
      if (act === 'next') return v.jobNext(e);
      if (act === 'back') return v.jobBack(e);
      if (act === 'cut') { v.setJobStart({ target: { value: el.dataset.a } }); v.setJobEnd({ target: { value: el.dataset.b } }); return; }
      if (act === 'kind') { v.pickJobType(el.dataset.kind); return; }
      if (act === 'lang') { ui.jobLang = el.dataset.lang; repaint(); return; }
      if (act === 'count') { var o = (v.countOpts || []).filter(function (x) { return x.label === el.dataset.n; })[0]; if (o) o.toggle(e); return; }
      if (act === 'band') {
        var lo = Number(el.dataset.lo), hi = Number(el.dataset.hi);
        var live = (DATA.clipSettings || {}).clipLengthBands;
        var base = (Array.isArray(live) ? live : []).filter(function (x) { return LENGTH_BANDS.some(function (b) { return Number(x[0]) === b[0] && Number(x[1]) === b[1]; }); });
        var next = base.filter(function (x) { return !(Number(x[0]) === lo && Number(x[1]) === hi); });
        if (next.length === base.length) next = base.concat([[lo, hi]]);
        if (!next.length) return;
        next = next.map(function (x) { return [Number(x[0]), Number(x[1])]; }).sort(function (a, b) { return a[0] - b[0]; });
        A().onClipSettings({ clipMinSeconds: Math.min.apply(null, next.map(function (x) { return x[0]; })), clipMaxSeconds: Math.max.apply(null, next.map(function (x) { return x[1]; })), clipLengthBands: next });
        return;
      }
      if (act === 'tpl') { v.setTpl({ target: { value: el.dataset.tpl } }); return; }
      if (act === 'track') { var t = (v.jobNasheeds || [])[Number(el.dataset.ix)]; if (t) t.select(e); return; }
      if (act === 'music') { v.toggleJobMusic(e); return; }
      if (act === 'upload') { v.uploadNasheed(e); return; }
      if (act === 'dest') {
        var k = el.dataset.k, now = ui.jobPublishTo.filter(function (x) { return x !== k; });
        ui.jobPublishTo = now.length === ui.jobPublishTo.length ? ui.jobPublishTo.concat([k]) : now;
        repaint(); return;
      }
      if (act === 'row') { var r = (v.jobSummaryRows || []).filter(function (x) { return x.label === el.dataset.label; })[0]; if (r && r.go) r.go(e); return; }
      if (act === 'generate') { v.runGenerate(e); return; }
    });
    root.addEventListener('input', function (e) {
      var el = e.target, v = B(DATA);
      if (el.classList.contains('briefBox')) { v.onJobBrief(el.value); return; }
      if (el.dataset.act === 'start') { v.setJobStart({ target: { value: el.value } }); return; }
      if (el.dataset.act === 'end') { v.setJobEnd({ target: { value: el.value } }); return; }
      if (el.dataset.act === 'volume') { v.setJobVolume({ target: { value: el.value } }); return; }
    });
    // Template cards are buttons with their own act.
    root.querySelectorAll('[data-tpl]').forEach(function (b) { b.dataset.act = 'tpl'; });
  }

  function paint(vals, DATA) {
    var slot = document.getElementById('studioJobSlot');
    var open = Boolean(A().ui.job) && slot;
    var root = document.getElementById(ROOT_ID);
    if (!open) { if (root) root.remove(); return; }
    var dialog = slot.parentElement && slot.parentElement.parentElement;
    if (!dialog) return;
    if (!root || root.parentElement !== dialog) {
      if (root) root.remove();
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('data-host-owned', '');
      dialog.appendChild(root);
      wire(root, DATA);
      root.dataset.sig = '';
    }
    // Hide the export's own children in place: taking them out would shift
    // the patcher's pairing (v3.124.5).
    Array.prototype.forEach.call(dialog.children, function (c) {
      if (c === root) return;
      if (!c.hasAttribute('data-host-style')) { c.setAttribute('data-host-style', ''); c.style.display = 'none'; }
    });
    dialog.style.padding = '0'; dialog.style.border = '0'; dialog.style.background = 'transparent'; dialog.style.boxShadow = 'none'; dialog.style.maxWidth = '1060px';
    var html = render(vals, DATA);
    // The brief textarea and the range inputs are live controls: never
    // rebuild them under the caret. Signature excludes the brief text and
    // the handles' own values.
    var sig = html.replace(/<textarea[\s\S]*?<\/textarea>/, '').replace(/value="[\d.]+" data-act="(start|end|volume)"/g, '');
    if (root.dataset.sig === sig) return;
    var focused = document.activeElement, keep = focused && root.contains(focused) && (focused.classList.contains('briefBox') || focused.type === 'range');
    if (keep) {
      // Patch what changed around the live control rather than replacing it.
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var band = root.querySelector('.band'), nb = tmp.querySelector('.band');
      if (band && nb) band.setAttribute('style', nb.getAttribute('style'));
      var clock = root.querySelector('.clock'), nc = tmp.querySelector('.clock');
      if (clock && nc) clock.innerHTML = nc.innerHTML;
      var fn = root.querySelector('.foot .fnote'), nf = tmp.querySelector('.foot .fnote');
      if (fn && nf) fn.innerHTML = nf.innerHTML;
      var sv = root.querySelector('.sldV'), nsv = tmp.querySelector('.sldV');
      if (sv && nsv) { sv.innerHTML = nsv.innerHTML; var fill = root.querySelector('.sldT > i'), nfill = tmp.querySelector('.sldT > i'); if (fill && nfill) { fill.setAttribute('style', nfill.getAttribute('style')); root.querySelector('.sldT > b').setAttribute('style', tmp.querySelector('.sldT > b').getAttribute('style')); } }
      root.dataset.sig = sig;
      return;
    }
    root.innerHTML = html;
    root.querySelectorAll('[data-tpl]').forEach(function (b) { b.dataset.act = 'tpl'; });
    root.dataset.sig = sig;
  }

  window.StudioJob = { paint: paint, mounted: function () { return Boolean(document.getElementById(ROOT_ID)); } };
})();
