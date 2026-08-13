import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/public/studio-v6.css', import.meta.url), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must remain a named application renderer`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete implementation body`);
}

function assertText(source, labels, scope) {
  for (const label of labels) {
    assert.ok(source.includes(label), `${scope} must visibly include “${label}”`);
  }
}

function assertInOrder(source, labels, scope) {
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${scope} must place “${label}” after the preceding approved element`);
    cursor = next;
  }
}

function assertClass(source, className, scope) {
  assert.match(source, new RegExp(`(?:class=["'][^"']*\\b${className}\\b|\\.${className}\\b)`),
    `${scope} needs the semantic ${className} surface from the approved hierarchy`);
}

/*
 * Canonical visual target: the seven approved 1672 x 941 V7 mockups supplied
 * on 12 August 2026. These tests intentionally lock hierarchy, density and
 * interaction contracts. User content and operational numbers must still come
 * from the workspace; the example people, titles and metrics in the mockups
 * are composition references, never seed data.
 */

test('the shared V7 shell matches the approved desktop frame and navigation hierarchy', () => {
  const shell = functionBody(ui, 'injectShell');
  assert.match(css, /body\.dc-v7-shell\s*\{[^}]*--dc-side\s*:\s*292px[^}]*--dc-top\s*:\s*80px/s,
    'the 1672×941 reference uses a 292px sidebar and an 80px top bar');
  assert.match(css, /body\.dc-v7-shell\s+#app>\.wrap\s*\{[^}]*padding\s*:[^;}]*calc\(var\(--dc-top\)\s*\+\s*(?:28|30|32)px\)[^;}]*calc\(var\(--dc-side\)\s*\+\s*(?:26|28|30)px\)/s,
    'the content origin must match the approved breathing room beside the 292px rail');

  assertInOrder(shell, ['Create', 'Home', 'Projects', 'Review', 'Publish', 'Publishing', 'Channels',
    'Studio', 'Templates', 'Brand Kit', 'AI Director', 'Audio', 'Insights', 'Settings', 'Collapse sidebar'],
  'the approved left rail');
  assert.doesNotMatch(shell, /<span>Account<\/span>[\s\S]*ACCOUNT_NAV\.map/,
    'Subscription is opened from the token pill and must not add an unapproved Account group to the rail');
  assertText(shell, ['Search projects, clips and posts', 'Loading account', 'Checking', 'Tokens', '＋ New'],
    'the approved top bar');
  assert.match(shell, /dc-global-search[\s\S]*dc-experience-badge[\s\S]*dc-health[\s\S]*dc-token-pill[\s\S]*dc-user-menu-button[\s\S]*dcNewProject/,
    'top-bar controls must keep the mockup order: search, plan, health, tokens, account, New');
});

test('Home matches the approved hero, creation area and right-hand rail', () => {
  // Updated 12 Aug to the reference the customer approved. The previous
  // version pinned the earlier V7 screen: a "Continue your workflow" strip and
  // a two-card row of Create clips / Up next. Both were deliberately replaced
  //
  //   the workflow strip      four buttons that only navigated to screens
  //                           already one click away in the rail
  //   Up next                 became "Scheduled next", showing the real queue
  //                           rather than a single next clip
  //   the two-card row        Create clips now takes the wide column with
  //                           uploads beneath it, and scheduling plus activity
  //                           moved to a narrower rail
  //
  // Kept from the old assertions: the hero summary counts and the requirement
  // that hero cards use real clip scores and durations.
  const profile = functionBody(ui, 'homeExperienceContent');
  const home = functionBody(ui, 'renderHome');
  const cards = functionBody(ui, 'v5HeroCards');
  const scheduled = functionBody(ui, 'v7Scheduled');
  const activity = functionBody(ui, 'v7Activity');
  const uploads = functionBody(ui, 'v7Uploads');
  const source = `${profile}\n${home}\n${cards}\n${scheduled}`;

  const headline = functionBody(ui, 'v7Headline');
  assertText(headline, ['One talk.', 'Your next month of', 'content.'], 'the approved three-line hero headline');
  assert.match(headline, /<em>content\.<\/em>/,
    'only the closing words are emphasised, so the gold lands on "content."');
  assert.match(home, /v7Headline\(\)/, 'the hero must use the built headline, not a string replace');
  assert.match(profile, /Review\s+\$\{?waiting|`Review \$\{waiting\} ready`/,
    'the secondary hero action must show the real number of clips ready for review');
  assertText(home, ['Sources', 'Clips', 'To review', 'Published'], 'the hero workspace summary');

  // The strip and the old card are gone, not merely hidden.
  assert.doesNotMatch(home, /dc-v7-workflow-strip/, 'the workflow strip was removed');
  assert.doesNotMatch(home, /Continue your workflow/);
  assert.doesNotMatch(home, /v5UpNext\(/, 'Up next was replaced by Scheduled next');

  assertClass(home, 'dc-v7-home-main', 'Home');
  assert.match(home, /dc-v7-home-left[\s\S]*dc-v7-create[\s\S]*v7Uploads\([\s\S]*dc-v7-home-side/,
    'Create clips and uploads take the wide column; the rail follows it');
  assertText(home, ['Create clips', 'Paste a supported video link or upload your original file.',
    'Template', 'Clip length', 'Output', '9:16 Vertical', 'Generate clips', 'Upload original'],
    'the approved Create clips card');
  assertText(scheduled, ['Scheduled next', 'View calendar'], 'the Scheduled next rail card');
  assertText(activity, ['Recent activity', 'View all activity'], 'the Recent activity rail card');
  assertText(uploads, ['Your uploads', 'Name', 'Type', 'Duration', 'Date added', 'Status'],
    'the uploads table');

  // The rail must read live data, or it is decoration.
  assert.match(scheduled, /publishingClipGroups\(/, 'Scheduled next must use the real publishing queue');
  assert.match(activity, /recentActivity\(/, 'Recent activity must use the real activity feed');

  assert.match(cards, /clips[\s\S]*(?:score|scoreBreakdown)/,
    'floating hero cards must use real clip scores');
  assert.match(cards, /(?:durationMs|formatDuration|formatClock)/,
    'floating hero cards must show each real clip duration');
  assert.match(cards, /thumbUrl/, 'floating hero cards must use real thumbnails when available');
  // Was `upNext`; the card it referred to is now Scheduled next. The intent is
  // unchanged — the rail must be derived from real workspace state, not props.
  assert.match(scheduled, /(?:thumbUrl|scheduledAt|targets)/,
    'Scheduled next must be derived from real workspace state');
});

test('Projects matches the approved two-column visual library with workflow and tip rail', () => {
  const projects = functionBody(ui, 'renderProjects');
  const card = functionBody(ui, 'libraryProjectRow');
  const source = `${projects}\n${card}`;

  assertInOrder(projects, ['Projects', 'Your source library', '＋ New project',
    'Search projects', 'All projects', 'Newest first'], 'the Projects header and toolbar');
  assertClass(projects, 'dc-v7-project-grid', 'Projects');
  assertClass(card, 'dc-v7-project-card', 'Projects');
  assert.match(card, /thumb[\s\S]*(?:status|label)[\s\S]*(?:title|projectDisplayTitle)[\s\S]*(?:clip|updated)[\s\S]*Open project/s,
    'each project card must keep the image, top-right status, title/meta and Open project action hierarchy');
  assertClass(projects, 'dc-v7-project-rail', 'Projects');
  assertInOrder(projects, ['Workflow', 'Processing', 'Needs review', 'Ready', 'Published', 'All projects',
    'Tip', 'Keep your source projects organised', 'Learn more'], 'the Projects side rail');
  assert.match(projects, /d\.projects|\(d\.projects\s*\|\|\s*\[\]\)/,
    'project counts and cards must come from the signed-in workspace');
  assert.match(projects, /d\.clips|allClips/,
    'workflow counts must be calculated from real clips');
});

test('Brand Kit matches the approved live preview and three compact control panels', () => {
  const brand = functionBody(ui, 'renderBrandKit');
  const save = functionBody(ui, 'saveBrandKit');

  assertInOrder(brand, ['Brand Kit', 'Keep every clip recognisably yours', 'Save changes'],
    'the Brand Kit page header');
  assertClass(brand, 'dc-v7-brand-layout', 'Brand Kit');
  assertClass(brand, 'dc-v7-brand-preview', 'Brand Kit');
  assertInOrder(brand, ['Applied to', 'New clips using your templates', 'Open Templates'],
    'the preview footer');
  assertInOrder(brand, ['Logo & watermark', 'Replace', 'Size', 'Opacity', 'Corner position',
    'Brand colours', 'Typography', 'Heading font', 'Body font'], 'the Brand Kit controls');
  assert.match(brand, /(?:brandSettings|const brand=d\.brandSettings)/,
    'the preview and controls must read real Brand Kit settings');
  assert.match(brand, /(?:clips|selectedTemplate|templateDraft)/,
    'the preview should use the workspace clip/template context instead of a fake customer clip');
  assert.match(save, /callApi\(\s*['"]\/api\/brand-settings['"]/,
    'Save changes must persist through the existing Brand Kit endpoint');
});

test('Audio matches the approved track list, global mix and now-previewing rail', () => {
  const audio = functionBody(ui, 'renderAudioLibrary');
  const track = functionBody(ui, 'trackCard');
  const source = `${audio}\n${track}`;

  assertInOrder(audio, ['Audio', 'Keep speech clear and your sound consistent', 'Upload track'],
    'the Audio page header');
  assertText(audio, ['Tracks', 'Default volume', 'Shuffle'], 'the Audio metric strip');
  assertClass(audio, 'dc-v7-audio-layout', 'Audio');
  assertClass(audio, 'dc-v7-track-list', 'Audio');
  assert.match(track, /(?:waveform|dc-audio-wave)/,
    'each audio row needs the approved waveform treatment');
  assert.match(track, /(?:durationSec|formatClock|formatDuration)/,
    'audio durations must come from each real track');
  assert.match(track, /(?:data-audio-play|<audio|play\()/,
    'each track must retain a working preview action');
  assertInOrder(audio, ['Global mix', 'Default volume', 'Speech / music balance', 'Enhance voice',
    'Shuffle tracks', 'Save audio settings', 'Now previewing'], 'the Audio right rail');
  assert.match(audio, /tracks=d\.tracks|d\.tracks\s*\|\|/,
    'the list must render actual uploaded tracks');
  assert.match(audio, /settings=d\.musicSettings|d\.musicSettings\s*\|\|/,
    'the mix must reflect actual saved audio settings');
  assert.match(audio, /id=["']dcMusicFile["'][\s\S]*id=["']dcUploadMusic["']/,
    'the polished Upload track action must retain the working file input');
});

test('Channels matches the approved list-plus-approval-rail composition without weakening safeguards', () => {
  const channels = functionBody(ui, 'renderConnections');
  const card = functionBody(ui, 'connectionCard');
  const save = functionBody(ui, 'savePublishingRules');

  assertInOrder(channels, ['Channels', 'Connect once, publish when you approve.',
    'Connected', 'Available', 'Approval required'], 'the Channels header and metrics');
  assertClass(channels, 'dc-v7-channels-layout', 'Channels');
  assertClass(channels, 'dc-v7-channel-list', 'Channels');
  assertInOrder(channels, ['Approval & destinations', 'Nothing posts without approval',
    'Save publishing rules', 'Channel health'], 'the Channels right rail');
  assertText(card, ['Connected', 'Last sync:', 'Publishing', 'Manage', 'Connect'],
    'each approved destination row');
  assert.match(channels, /\['youtube','tiktok','instagram','facebook'\]\.map\(providerInfo\)/,
    'all four rows must be generated from live provider state');
  assert.match(channels, /automationSettings[\s\S]*reviewBeforePosting/,
    'the approval card must be derived from the canonical safety setting');
  assert.match(channels, /requiresManualReview[\s\S]*Nothing posts without approval/,
    'the exact approval promise may only be shown when human review is truly enabled');
  assert.match(save, /callApi\(\s*['"]\/api\/publishing-settings['"]/,
    'destination switches must continue to save through the real endpoint');
});

test('Admin Console matches the approved command centre while keeping every metric live', () => {
  const page = functionBody(ui, 'renderAdminPage');
  const tabs = functionBody(ui, 'adminTabs');
  const overview = functionBody(ui, 'adminOverview');
  const source = `${page}\n${tabs}\n${overview}`;

  assertInOrder(page, ['Admin Console', 'Business, users and infrastructure at a glance.',
    'Refresh', 'All systems operational'], 'the Admin header');
  assertInOrder(tabs, ['Overview', 'Users', 'Subscriptions', 'Infrastructure', 'Integrations'],
    'the approved Admin primary tabs');
  assertInOrder(overview, ['creators', 'MRR', 'jobs today', 'uptime', 'Business pulse',
    'Revenue', 'Usage', 'Weekly', 'Monthly', 'System health', 'Service', 'Status', 'Latency',
    'Recent creators', 'Processing lanes', 'Needs attention', 'Open operations'],
  'the Admin overview hierarchy');
  assertClass(overview, 'dc-v7-admin-chart', 'Admin Console');
  assert.match(overview, /(?:adminOps|ops)[\s\S]*(?:adminAnalytics|stats)/,
    'the dashboard must use live operational and analytics payloads');
  assert.doesNotMatch(overview, /(?:A\$4,820|99\.9%|>128<|>24<|A\$1,125)/,
    'numbers in the mockup are examples and must never be hard-coded into production');
  assert.match(overview, /(?:service|infrastructure|health|latency)/i,
    'System health must be built from actual service data');
});

test('AI Director matches the approved two-column intelligence workspace and remains grounded', () => {
  const director = functionBody(ui, 'renderCreatorLab');
  const tools = functionBody(ui, 'directorToolSurface');
  const apply = functionBody(ui, 'directorPartHtml');
  const source = `${director}\n${tools}\n${apply}`;

  assertInOrder(director, ['AI Director', 'One intelligence layer for stronger clips and smarter growth.',
    'Focus project'], 'the AI Director header');
  assertInOrder(ui.slice(ui.indexOf('const DIRECTOR_MODES='), ui.indexOf('const directorChat=')),
    ['Director', 'Viral potential', 'Hooks', 'Titles & captions', 'Trends', 'Audience', 'Posting'],
    'the AI Director mode bar');
  assertClass(director, 'dc-v7-director-layout', 'AI Director');
  assertClass(director, 'dc-v7-director-main', 'AI Director');
  assertClass(director, 'dc-v7-director-rail', 'AI Director');
  assertInOrder(director, ['You', 'AI Director', 'Growth brief', 'Viral potential',
    'Key opportunity factors', 'Top recommendation', 'Stronger hook', 'Copy', 'Apply to clip',
    'Generate 5 hooks', 'Create title pack', 'Find trend angles', 'Ask Director'],
  'the Director main conversation surface');
  assertInOrder(source, ['AI tools working together', 'Hook AI', 'Retention AI', 'Title AI',
    'Trend AI', 'Audience AI', 'Posting AI', 'Recommended next', 'Potential score', 'Open clip'],
  'the Director recommendation rail');
  assert.match(source, /(?:clips=d\.clips|d\.clips\s*\|\||data\(\)\?\.clips)/,
    'scores, recommendations and clip cards must come from real workspace clips');
  assert.match(source, /(?:scoreBreakdown|quality\?\.scoreBreakdown|growthPack)/,
    'opportunity factors must use real processing signals');
  assert.match(source, /no invented live trends|Missing data stays missing|nothing I suggest is made up/,
    'Trend and Audience AI must state their data limits');
  assert.match(ui, /data-director-apply-title[\s\S]*callApi\(`\/api\/clips\/\$\{encodeURIComponent\(clip\.id\)\}`/,
    'Apply to clip must keep the working PATCH integration');
});

test('all seven approved screens use real state and retain their existing mutation paths', () => {
  const mutationContracts = [
    ['Home import', /id=["']dcGenerate["'][\s\S]*generateProject/],
    ['Project open', /data-open-project[\s\S]*handleProjectOpenCapture/],
    ['Brand save', /callApi\(\s*['"]\/api\/brand-settings['"]/],
    ['Audio upload', /callApi\(\s*['"]\/api\/music['"]/],
    ['Audio settings', /callApi\(\s*['"]\/api\/music-settings['"]/],
    ['Channel connect', /callApi\(`\/api\/social\/\$\{encodeURIComponent\(provider\)\}\/connect`/],
    ['Publishing rules', /callApi\(\s*['"]\/api\/publishing-settings['"]/],
    ['Admin operations', /callApi\(\s*['"]\/api\/admin\/operations['"]/],
    ['Director apply', /method:\s*['"]PATCH['"]/],
  ];
  for (const [label, pattern] of mutationContracts) {
    assert.match(ui, pattern, `${label} functionality must survive the visual rebuild`);
  }

  for (const sample of [
    'The Power of Sabr in Tough Times', 'Quran Reflections – Ramadan Series',
    'Whispers of Faith', 'Deen Reflections', 'Hamza Ahmed', 'Aisha Rahman',
  ]) {
    assert.ok(!ui.includes(sample), `“${sample}” is mockup-only content and must not replace signed-in customer data`);
  }
});
