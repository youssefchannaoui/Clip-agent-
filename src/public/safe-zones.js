/*
 * WHERE EACH PLATFORM COVERS THE FRAME, and the one place that answers it.
 *
 * Youssef, 6 Sept 2026, on the Templates preview: "make social media safe zone
 * more actirate for all videos cause its not." It was not, and the reason it
 * could stay wrong is that the answer was written down in SIX places, no two
 * of which agreed:
 *
 *   the design export    a hardcoded `left/right 8%, top 8%, bottom 14%` box,
 *                        symmetric, platform-blind and far too generous at the
 *                        bottom -- it called the lowest 14% of the frame safe
 *                        while the strictest platform covers 35% of it;
 *   the adapter          SAFE_TOP/SAFE_BOTTOM literals matching that box;
 *   the free checker     per-platform pixel insets;
 *   ...and two lines below them, a "union of all three" rectangle 130px TALLER
 *                        than the union of those very insets;
 *   the checker's legend a hand-typed table of the same numbers, beside a
 *                        hand-written drawing routine that used different ones;
 *   the guide prose      "a centred 900 x 1400 rectangle", in four sentences,
 *                        matching none of the above -- and not centred, because
 *                        the right-hand action rail is more than twice the left
 *                        margin and the bottom band is two and a half times the
 *                        top.
 *
 * So: one table, read by the studio, by the public checker and by the tests
 * that pin the prose. A number quoted anywhere about safe zones comes from
 * here or it is wrong.
 *
 * THESE ARE WORKING RULES, NOT A SPECIFICATION, and that is not a hedge -- it
 * is the reason the free checker exists. Platforms move their interface
 * without announcing it, the covered area changes with caption length and
 * whether the viewer has expanded the description, and every source below says
 * so in its own words. Erring tight costs a little picture; erring loose puts
 * the caption under a button, which is the fault being fixed.
 *
 * Loaded as a plain script by the studio and by the tool pages, and importable
 * by node for the tests -- the same arrangement studio-runtime.js uses. It has
 * no imports of its own so anything may read it.
 */
(function (global) {
  'use strict';

  /*
   * Insets from each edge of the reference 1080x1920 frame, in frame pixels.
   * Checked 6 September 2026.
   *
   * TikTok: the figures TikTok's own Creative Center publishes and every 2026
   * guide repeats -- 130 top (the Following/For You tabs and search), 484
   * bottom (caption, music, account name), 140 right (the profile/like/comment
   * /share stack), 44 left (edge cropping across device sizes).
   *
   * Instagram and Facebook Reels are ONE ENTRY BECAUSE META MADE THEM ONE.
   * Meta unified the Stories and Reels safe areas in March 2026, and the
   * unified figure is the strictest thing either platform has ever asked for:
   * 270 top, 670 bottom -- 35% of the height, because the bottom stacks the
   * caption, likes, comments, share, save, audio and CTA. The repo's previous
   * Reels numbers (220/430) predate that change and were the single biggest
   * error here.
   *
   * THE RIGHT EDGE IS THE ONE JUDGEMENT CALL IN THIS TABLE, and it is written
   * down so it can be undone knowingly. Meta publishes 6% (65px) sides, and
   * that figure is for AD placements, where the profile block and the call to
   * action sit along the bottom. This product posts ORGANICALLY, and an
   * organic Reel carries the like/comment/share/save column down the right --
   * which every independent measurement puts at 130-150px, and which 65 plainly
   * does not clear. So the left takes Meta's own number and the right takes the
   * measured organic rail. If DeenClipped ever posts as an ad, revisit this.
   *
   * YouTube Shorts is the mildest, and its trap is the DESCRIPTION: the bottom
   * overlay grows to about 400px once a viewer taps to expand it, so a line
   * that clears the collapsed state is covered in the state people actually
   * read in. Designed for expanded, deliberately.
   */
  var ZONES = {
    youtube: {
      key: 'youtube', label: 'YouTube Shorts', short: 'Shorts',
      top: 150, right: 140, bottom: 400, left: 60, colour: '#ff8a3d',
    },
    tiktok: {
      key: 'tiktok', label: 'TikTok', short: 'TikTok',
      top: 130, right: 140, bottom: 484, left: 44, colour: '#ff4d6d',
    },
    instagram: {
      key: 'instagram', label: 'Instagram Reels', short: 'Reels',
      top: 270, right: 150, bottom: 670, left: 65, colour: '#c86bff',
    },
    facebook: {
      key: 'facebook', label: 'Facebook Reels', short: 'Facebook',
      top: 270, right: 150, bottom: 670, left: 65, colour: '#4a9dff',
    },
  };

  // The order they are offered in, and the order a union is described in.
  var ORDER = ['youtube', 'tiktok', 'instagram', 'facebook'];

  var REF_WIDTH = 1080;
  var REF_HEIGHT = 1920;

  var CHECKED = 'September 2026';

  function zoneList(keys) {
    var wanted = (keys && keys.length) ? keys : ORDER;
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      if (wanted.indexOf(ORDER[i]) > -1) out.push(ZONES[ORDER[i]]);
    }
    return out;
  }

  /*
   * The worst case on every edge, which is what "one export that works
   * everywhere" means.
   *
   * Taken per EDGE rather than by naming whichever platform looks strictest.
   * Meta happens to be strictest on all four TODAY, so for the full set this
   * is simply Meta's box -- but that is a fact about this month's numbers, not
   * a rule, and it is already false for a SUBSET: an account on YouTube and
   * TikTok takes its top from Shorts (150 against 130) and its bottom from
   * TikTok (484 against 400). Naming a platform would uncover an edge there,
   * and would uncover one for everybody the next time a platform moves.
   *
   * With nothing chosen it unions everything, which is the safe direction: a
   * box that clears all four is never wrong about a platform, it is only
   * tighter than one account needed.
   */
  function unionInsets(keys) {
    var list = zoneList(keys);
    var out = { top: 0, right: 0, bottom: 0, left: 0 };
    for (var i = 0; i < list.length; i++) {
      out.top = Math.max(out.top, list[i].top);
      out.right = Math.max(out.right, list[i].right);
      out.bottom = Math.max(out.bottom, list[i].bottom);
      out.left = Math.max(out.left, list[i].left);
    }
    return out;
  }

  /*
   * THE SAFE BOX FOR AN OUTPUT OF ANY SHAPE, as fractions of that output.
   *
   * This is the half that makes it right "for all videos". The insets above
   * describe a full-screen 9:16 PLAYER, not the file -- so converting them
   * straight to percentages is only correct when the clip is itself 9:16. A
   * square or widescreen clip is letterboxed into that player, and the chrome
   * at the very top and bottom of the screen then sits on the black bars
   * rather than on the picture. Treating a 1:1 export as though it lost its
   * bottom 35% would fence the caption into a strip for no reason.
   *
   * So the output is fitted into the reference player the way a player fits it
   * (contain, centred), the safe rectangle is intersected with where the video
   * actually lands, and the result is expressed against the video's own edges.
   * A 9:16 clip comes back with the insets unchanged, which is the common case
   * and the one to check first when this looks wrong.
   */
  function safeArea(keys, width, height) {
    return boxFromInsets(unionInsets(keys), width, height);
  }

  function boxFromInsets(ins, width, height) {
    var w = Math.max(1, Number(width) || REF_WIDTH);
    var h = Math.max(1, Number(height) || REF_HEIGHT);

    // Where the video sits inside the player, in reference pixels.
    var scale = Math.min(REF_WIDTH / w, REF_HEIGHT / h);
    var drawnW = w * scale;
    var drawnH = h * scale;
    var offX = (REF_WIDTH - drawnW) / 2;
    var offY = (REF_HEIGHT - drawnH) / 2;

    // The safe rectangle, clipped to the picture.
    var x0 = Math.max(ins.left, offX);
    var y0 = Math.max(ins.top, offY);
    var x1 = Math.min(REF_WIDTH - ins.right, offX + drawnW);
    var y1 = Math.min(REF_HEIGHT - ins.bottom, offY + drawnH);

    // A degenerate box means the chrome covers the whole picture. Report the
    // whole frame rather than a negative one: a caption has to go somewhere,
    // and an inverted box would render as a rectangle with its edges crossed.
    if (x1 <= x0 || y1 <= y0) {
      return { top: 0, right: 1, bottom: 1, left: 0, degenerate: true };
    }

    return {
      left: (x0 - offX) / drawnW,
      right: (x1 - offX) / drawnW,
      top: (y0 - offY) / drawnH,
      bottom: (y1 - offY) / drawnH,
      degenerate: false,
    };
  }

  /*
   * Which platforms an account actually posts to, from its own publishing
   * settings. The safe box is only honest if it describes where the clip is
   * going: fencing a YouTube-only account into Meta's bottom 35% costs it a
   * third of the frame for a platform it does not use.
   *
   * A platform counts when it is switched on AND connected. Switched on with
   * nothing connected posts nowhere, so it must not tighten the box.
   * With none, the caller gets the union of all four.
   */
  function platformsFor(publishingSettings, social) {
    var ps = publishingSettings || {};
    var provs = (social && social.providers) || {};
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      var item = ps[key];
      var conn = provs[key];
      if (item && item.enabled && conn && conn.connected) out.push(key);
    }
    return out;
  }

  /*
   * THE PLATFORMS THE BOX IS DRAWN FOR. Youssef, 6 Sept 2026: "figure out the
   * perfect safe social zone using TikTok and YouTube and use it for ours".
   * So the box always clears TikTok AND YouTube Shorts -- the two this product
   * is actually posting to, whether or not either happens to be connected at
   * the moment somebody is designing a template -- and a connected Meta
   * platform WIDENS it (Reels covers more of the frame than either). Nothing
   * ever narrows it below the pair: a template designed against a lone
   * YouTube box lands its caption under TikTok's caption block the day TikTok
   * is connected, and that is the fault the whole table exists to prevent.
   *
   * Union of the pair: top 150 (Shorts), right 140, bottom 484 (TikTok),
   * left 60 (Shorts) -- 7.8% / 13.0% / 25.2% / 5.6% of a 9:16 frame.
   */
  var BASE_PLATFORMS = ['youtube', 'tiktok'];

  /*
   * THE BOTTOM THE STUDIO SHADES, AND WHY IT IS NOT THE TABLE'S.
   *
   * Youssef, 6 Sept 2026, with his cursor 172px below the shaded band's top
   * edge: "move the social safe zone down to shere my cursor is."
   *
   * He was pointing at a real inconsistency rather than asking for a looser
   * rule. The band was cut at TikTok's 484 while the silhouette drawn inside
   * it -- the handle, the caption lines, the sound line and the tab bar,
   * drawn from the chrome that is actually on screen -- starts at 312 from
   * the bottom. So 172px of the picture was dimmed with nothing drawn on it,
   * which reads as the shade being arbitrary. Measured: his cursor sat at
   * 83.8% of the frame; the top of the handle bar is 83.75%.
   *
   * The two numbers answer different questions and BOTH are right:
   *
   *   484  what TikTok asks you to keep clear -- their published figure,
   *        which reserves room for a MULTI-LINE caption. It is the number
   *        the free public checker cites and the number the shipped-template
   *        law is enforced against, and it is not touched here: it is a
   *        factual claim about somebody else's product.
   *   312  what TikTok's interface actually covers on every clip -- the
   *        handle, one caption line, the sound line and the tab bar. This is
   *        what the preview shades, because the preview is a picture of the
   *        phone rather than a specification.
   *
   * IT IS THE SAME NUMBER THE SILHOUETTE IS DRAWN FROM, deliberately: the
   * band's top edge and the topmost drawn element are one value, so the shade
   * can never again claim more than it shows. safeSilhouette's `handle` sits
   * at H - POSTING_BOTTOM and test/safe-chrome.test.mjs pins the two together.
   *
   * A CONNECTED META PLATFORM STILL WIDENS IT to Reels' own 670. That figure
   * is not a caption allowance -- Meta's unified bottom stacks the caption,
   * likes, comments, share, save, audio and CTA -- so there is nothing
   * over-generous about it to trim.
   *
   * To undo this, delete POSTING_BOTTOM and let postingInsets return
   * unionInsets unchanged.
   */
  var POSTING_BOTTOM = 258;

  /*
   * The union the STUDIO draws, as insets: top, left and right from the table,
   * and the bottom from the chrome above -- NEVER from a connected platform.
   *
   * IT USED TO TAKE THE LARGEST CONNECTED PLATFORM'S BOTTOM, and that is what
   * Youssef was looking at on 6 Sept 2026: "SOCIAL SAFE BOX IS STILL WRONG IT
   * SHOULD GO ALL THE WAY DOWN TO ON TOP OF THE CAPTIONS". With Meta connected
   * the band started at Meta's published 670 -- **more than double** the 312 it
   * used, a third of the frame -- and swallowed the picture right up to under
   * the clip's own caption. That is Meta's ASK (room for a multi-line caption
   * they may or may not draw), not what the interface COVERS, and mixing the
   * two is exactly the confusion POSTING_BOTTOM was split out to end.
   *
   * The other three edges do not have this problem and are left alone, because
   * the silhouette draws them RELATIVE to the band: the feed tabs hang off
   * `box.top` and the whole action rail is stacked up from `box.bottom`, so
   * they follow whatever the union says and the drawing cannot disagree. Only
   * the foot is in absolute frame coordinates, so only the foot could drift --
   * and it did.
   */
  function postingInsets(keys) {
    var ins = unionInsets(keys);
    ins.bottom = POSTING_BOTTOM;
    return ins;
  }

  /** The studio's box: postingInsets, fitted to the output's own shape. */
  function postingBox(keys, width, height) {
    return boxFromInsets(postingInsets(keys), width, height);
  }


  function postingSet(publishingSettings, social) {
    var connected = platformsFor(publishingSettings, social);
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      if (BASE_PLATFORMS.indexOf(key) > -1 || connected.indexOf(key) > -1) out.push(key);
    }
    return out;
  }

  /** "TikTok and Reels", for a sentence saying what the box clears. */
  function describe(keys) {
    var names = zoneList(keys).map(function (z) { return z.short; });
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  global.DCSafeZones = {
    ZONES: ZONES,
    ORDER: ORDER,
    REF_WIDTH: REF_WIDTH,
    REF_HEIGHT: REF_HEIGHT,
    CHECKED: CHECKED,
    zoneList: zoneList,
    unionInsets: unionInsets,
    safeArea: safeArea,
    platformsFor: platformsFor,
    BASE_PLATFORMS: BASE_PLATFORMS,
    POSTING_BOTTOM: POSTING_BOTTOM,
    postingSet: postingSet,
    postingInsets: postingInsets,
    postingBox: postingBox,
    describe: describe,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
