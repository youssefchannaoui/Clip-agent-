import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The configuration a customer sets before a clip is posted.
 *
 * Youssef, 4 Sept 2026: "add more configuration make it match and looks super
 * clean things like on looks of the upload like black and white or idk just
 * more so they can easily just config beofre posring on the selector ... also
 * add another thing so they can add sencery or layover, so layour can be dark
 * with rain drops but still the video of couese."
 *
 * Twelve graded looks and a weather layer, both configured on the Templates
 * screen -- ONE place, deliberately. The job wizard already picks the
 * template; putting these controls there as well would be two controls for one
 * setting, which this repo has repeatedly found to be worse than none.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;
const templates = await import('../src/templates.js');

function paint(patch = {}) {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null });
  const tpl = { id: 'x', name: 'X', width: 1080, height: 1920, ...patch };
  return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [tpl], selectedTemplate: tpl });
}
const rows = vals => Array.from(vals.tplStyleRows).map(r => ({ label: r.label, value: r.value }));
const rowFor = (vals, label) => rows(vals).find(r => r.label === label);

test('the schema carries the weather, with defaults that change nothing', () => {
  const fresh = templates.sanitiseTemplate({});
  assert.equal(fresh.overlayEffect, 'none', 'off out of the box');
  assert.equal(fresh.overlayDarken, 0);
  assert.equal(fresh.overlayIntensity, 55, 'and a strength that is one of the offered levels');
});

test('darken stops short of hiding the video, and strength has a floor', () => {
  // "but still the video of course". 100 is an opaque black rectangle with
  // captions floating on it, which is not what was asked for.
  assert.equal(templates.sanitiseTemplate({ overlayDarken: 100 }).overlayDarken, 80);
  assert.equal(templates.sanitiseTemplate({ overlayDarken: -5 }).overlayDarken, 0);
  // An effect switched on and drawing nothing is a control that does nothing;
  // 'none' is how it is turned off.
  assert.equal(templates.sanitiseTemplate({ overlayIntensity: 0 }).overlayIntensity, 10);
  assert.equal(templates.sanitiseTemplate({ overlayIntensity: 500 }).overlayIntensity, 100);
});

test('a single clip may differ from its template', () => {
  // These are look, not framing, so they belong in the style a clip can
  // override -- and NOT in the framing fields, which must never travel
  // between siblings.
  for (const field of ['overlayEffect', 'overlayIntensity', 'overlayDarken']) {
    assert.ok(templates.CLIP_STYLE_FIELDS.includes(field), field + ' is a clip style');
    assert.ok(!templates.FRAMING_FIELDS.includes(field), field + ' is not framing');
  }
  const patch = templates.sanitiseClipStyle({ overlayEffect: 'rain', overlayDarken: 40 });
  assert.deepEqual(patch, { overlayEffect: 'rain', overlayDarken: 40 });
  // A value the schema has never heard of is dropped, not stored.
  assert.deepEqual(templates.sanitiseClipStyle({ overlayEffect: 'locusts' }), {});
});

test('the picker can only ever offer a value the sanitiser accepts', () => {
  // Two data tables in two files, so they are compared as data. A picker
  // offering something sanitiseTemplate() rejects looks like a control that
  // silently snaps back.
  const source = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  const grab = name => {
    const block = new RegExp(name + ': \\[(.*?)\\],', 's').exec(source)[1];
    return Array.from(block.matchAll(/'([a-z-]+)'/g)).map(m => m[1]);
  };
  for (const value of grab('overlayEffect')) {
    assert.equal(templates.sanitiseTemplate({ overlayEffect: value }).overlayEffect, value,
      'the picker offers ' + value);
  }
  for (const value of grab('filterPreset')) {
    assert.equal(templates.sanitiseTemplate({ filterPreset: value }).filterPreset, value,
      'the picker offers the ' + value + ' look');
  }
  assert.equal(grab('filterPreset').length, 12, 'twelve looks are offered');
});

test('every look is named in words, never as its own key', () => {
  // "Teal & orange" and "Noir · hard B&W" say what the look does. `titleCase`
  // on the raw key gives "Teal" and "Noir", which tells nobody anything.
  const seen = new Set();
  for (const key of ['natural', 'crisp', 'vivid', 'warm', 'cinematic', 'teal',
    'faded', 'night', 'monochrome', 'noir', 'silver', 'sepia']) {
    const label = rowFor(paint({ filterPreset: key }), 'Look').value;
    assert.ok(label && label.length, key + ' has a label');
    assert.ok(!seen.has(label), 'no two looks read the same: ' + label);
    seen.add(label);
  }
  // The three black-and-white looks say WHICH black and white they are, or
  // they read as the same entry three times.
  assert.match(rowFor(paint({ filterPreset: 'monochrome' }), 'Look').value, /Black & white/);
  assert.match(rowFor(paint({ filterPreset: 'noir' }), 'Look').value, /B&W/);
  assert.match(rowFor(paint({ filterPreset: 'silver' }), 'Look').value, /B&W/);
});

test('the strength row appears only once there is an effect to strengthen', () => {
  const off = paint({ overlayEffect: 'none' });
  assert.equal(rowFor(off, 'Atmosphere').value, 'None');
  assert.equal(rowFor(off, 'Atmosphere strength'), undefined,
    'a level control over an effect that is off is a dead control');
  // Darken stands alone: dimming a bright frame so the captions read is worth
  // doing with no weather at all.
  assert.equal(rowFor(off, 'Darken video').value, 'Off');

  const on = paint({ overlayEffect: 'rain', overlayIntensity: 75, overlayDarken: 40 });
  assert.equal(rowFor(on, 'Atmosphere').value, 'Rain');
  assert.equal(rowFor(on, 'Atmosphere strength').value, 'Strong');
  assert.equal(rowFor(on, 'Darken video').value, 'Medium');
});

test('a stored value between the levels still reads as one of them', () => {
  // The levels are a few named steps over a 0-100 field, so a template saved
  // by the editor's slider -- or by an older build -- lands between them. A
  // bare "63" in that row is a value nobody chose.
  const vals = paint({ overlayEffect: 'snow', overlayIntensity: 63, overlayDarken: 37 });
  assert.equal(rowFor(vals, 'Atmosphere strength').value, 'Medium', '63 is nearer 55 than 75');
  assert.equal(rowFor(vals, 'Darken video').value, 'Medium', '37 is nearer 40');
  assert.equal(rowFor(paint({ overlayEffect: 'snow', overlayIntensity: 71 }), 'Atmosphere strength').value,
    'Strong', 'and 71 is nearer 75');
});

test('the preview draws the scrim exactly and the weather only when it is on', () => {
  const plain = paint({});
  assert.equal(plain.pvFxStyle, 'display: none;', 'nothing over a plain template');

  // The scrim is the SAME arithmetic the renderer's drawbox does, so this half
  // of the preview is the truth rather than an impression of it.
  const dark = paint({ overlayDarken: 40 });
  assert.match(dark.pvFxStyle, /rgba\(0,0,0,0\.400\)/);
  assert.ok(!/214,228,255/.test(dark.pvFxStyle), 'and no weather nobody asked for');

  const rain = paint({ overlayEffect: 'rain', overlayIntensity: 100, overlayDarken: 40 });
  assert.match(rain.pvFxStyle, /214,228,255/, 'rain is drawn in the colour the renderer uses');
  assert.match(rain.pvFxStyle, /background-position:/, 'the two fields are offset from each other');
  // Every layer must state its own size AND position, or the browser cycles
  // the shorter list and the grain's 3px tile lands on the raindrops.
  // Split at the TOP level only: these gradients are full of nested commas.
  const top = value => {
    const parts = []; let depth = 0, at = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      else if (value[i] === ',' && depth === 0) { parts.push(value.slice(at, i)); at = i + 1; }
    }
    parts.push(value.slice(at));
    return parts;
  };
  const layers = top(rain.pvFxStyle.match(/background-image: (.*?);/)[1]).length;
  assert.equal(top(rain.pvFxStyle.match(/background-size: (.*?);/)[1]).length, layers, 'one size per layer');
  assert.equal(top(rain.pvFxStyle.match(/background-position: (.*?);/)[1]).length, layers, 'one position per layer');

  const snow = paint({ overlayEffect: 'snow', overlayIntensity: 100 });
  assert.ok(!/214,228,255/.test(snow.pvFxStyle), 'snow is not drawn in rain colours');
});

test('the preview grades itself with the numbers the renderer uses', () => {
  // The five that shipped before must be untouched -- a saved template cannot
  // start previewing differently.
  assert.match(paint({ filterPreset: 'natural' }).pvImgStyle, /brightness\(1\.000\) contrast\(1\.000\) saturate\(1\.000\)/);
  assert.match(paint({ filterPreset: 'cinematic' }).pvImgStyle, /brightness\(0\.985\) contrast\(1\.130\) saturate\(0\.880\)/);
  assert.match(paint({ filterPreset: 'monochrome' }).pvImgStyle, /saturate\(0\.000\)/);
  // The new ones grade too, rather than silently falling back to Natural.
  assert.match(paint({ filterPreset: 'noir' }).pvImgStyle, /contrast\(1\.360\) saturate\(0\.000\)/);
  assert.match(paint({ filterPreset: 'vivid' }).pvImgStyle, /saturate\(1\.340\)/);
  // CSS has no colour matrix, so sepia and teal are approximations -- but they
  // must be VISIBLY different from Natural or the row teaches nothing.
  assert.match(paint({ filterPreset: 'sepia' }).pvImgStyle, /sepia\(1\)/);
  assert.match(paint({ filterPreset: 'teal' }).pvImgStyle, /hue-rotate\(-7deg\)/);
});

test('the library thumbnail knows all three black-and-white looks', () => {
  // It keyed on `monochrome` alone, so noir and silver drew in colour on the
  // one screen that exists to show what a template looks like.
  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const line = /const mono = ([^;]+);/.exec(host)[1];
  for (const look of ['monochrome', 'noir', 'silver']) {
    assert.ok(line.includes("'" + look + "'"), line + ' must cover ' + look);
  }
});

test('the phone gets the new rows without a second implementation', () => {
  // studio-mobile.js renders tplStyleRows generically, so a row added to the
  // adapter reaches the phone by itself. A copy of the list there would be a
  // second place for these to drift.
  const mobile = fs.readFileSync(path.join(ROOT, 'src/public/studio-mobile.js'), 'utf8');
  assert.ok(mobile.includes("tplRows('tplStyleRows'"), 'the phone renders the same rows');
  assert.ok(!/overlayEffect|filterPreset/.test(mobile),
    'and does not name the fields itself');
});
