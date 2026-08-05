function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function logoMark() {
  return `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 26" fill="none"><path d="M3.2 25V11.4C3.2 6.6 12 1 12 1s8.8 5.6 8.8 10.4V25Z" stroke="currentColor" stroke-width="1.7"/><path d="M10 11.2 15.4 14.6 10 18Z" fill="currentColor"/></svg></span>`;
}

function icon(name) {
  const icons = {
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 13.5 14 9.5"/><path d="M7.2 16.3 5.8 17.7a4 4 0 0 1-5.6-5.6l3.5-3.5a4 4 0 0 1 5.6 0"/><path d="m16.8 7.7 1.4-1.4a4 4 0 0 1 5.6 5.6l-3.5 3.5a4 4 0 0 1-5.6 0"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v5h16v-5"/></svg>',
    clips: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="m10 9 6 3-6 3Z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 16.5 9-9 3.5 3.5-9 9H4Z"/><path d="m15 6 1.5-1.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L18 9"/></svg>',
    publish: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 20h16"/></svg>',
    captions: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10a3 3 0 1 0 0 4m7-4a3 3 0 1 0 0 4"/></svg>',
    template: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4 8v8l8 5 8-5V8Z"/><path d="m4 8 8 5 8-5M12 13v8"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></svg>',
    account: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.3 3.5-6.5 8-6.5s7.2 2.2 8 6.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none"><path d="m14 6-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none"><path d="m10 6 6 6-6 6"/></svg>',
  };
  return icons[name] || icons.check;
}

function navActions(currentUser) {
  if (currentUser) return `<div class="nav-actions"><a class="button primary compact" href="/app">My dashboard ${icon('arrow')}</a></div>`;
  return `<div class="nav-actions"><a class="button text-button" href="/login?returnTo=/app">Sign in</a><a class="button primary compact" href="/login?returnTo=/app">Get started ${icon('arrow')}</a></div>`;
}

function layout({ base, currentUser, title, description, canonicalPath = '/', body }) {
  const canonical = `${String(base || 'https://deenclipped.online').replace(/\/+$/, '')}${canonicalPath === '/' ? '' : canonicalPath}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta name="theme-color" content="#070708">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="/marketing.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand" href="/" aria-label="DeenClipped home">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a>
      <button class="menu-button" type="button" data-menu aria-label="Open navigation"><span></span><span></span><span></span></button>
      <nav class="nav-links" aria-label="Main navigation">
        <a href="/#how-it-works">How it works</a>
        <a href="/features">Features</a>
        <a href="/pricing">Pricing</a>
        <a href="/#faq">FAQ</a>
        <a href="/contact">Contact</a>
      </nav>
      ${navActions(currentUser)}
    </div>
  </header>
  ${body}
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand"><a class="brand" href="/">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a><p>Turn long lectures and videos into review-ready short clips, refine every detail, then publish to your own connected channels.</p></div>
        <div class="footer-col"><h4>Product</h4><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/app">Dashboard</a></div>
        <div class="footer-col"><h4>Company</h4><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
        <div class="footer-col"><h4>Start</h4><a href="/login?returnTo=/app">Sign in</a><a href="/login?returnTo=/app">Create free clips</a><a href="mailto:support@deenclipped.online">Support</a></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} DeenClipped</span><span>Import · Review · Edit · Publish</span></div>
    </div>
  </footer>
  <script src="/marketing.js" defer></script>
</body>
</html>`;
}

function sourceForm() {
  return `<form class="source-bar" data-source-form><span class="source-icon">${icon('link')}</span><label class="sr-only" for="source-url">Video URL</label><input id="source-url" name="source" placeholder="Paste a YouTube or video link" autocomplete="off"><button type="submit">Get clips ${icon('arrow')}</button></form>`;
}

function checkItem(title, text) {
  return `<div class="detail-item"><span class="detail-check">${icon('check')}</span><span><b>${title}</b><small>${text}</small></span></div>`;
}

function pricingCards() {
  return `<div class="pricing-grid">
    <article class="price-card"><span class="plan-kicker">Start</span><h3>Free</h3><div class="price">40 <small>tokens</small></div><p>Explore the complete workflow before choosing a paid plan.</p><ul><li>Generate from selected source time</li><li>Review clips before posting</li><li>Access templates and editor</li></ul><a class="button secondary full" href="/login?returnTo=/app">Start free</a></article>
    <article class="price-card"><span class="plan-kicker">Flexible</span><h3>Weekly</h3><div class="price">120 <small>tokens/week</small></div><p>For occasional lectures, events and short campaigns.</p><ul><li>Weekly token refresh</li><li>Full review and editor</li><li>Publishing workflow</li></ul><a class="button secondary full" href="/login?returnTo=/app">Choose weekly</a></article>
    <article class="price-card popular"><span class="popular-label">Most popular</span><span class="plan-kicker">Consistent</span><h3>Monthly</h3><div class="price">650 <small>tokens/month</small></div><p>For creators building a dependable short-form schedule.</p><ul><li>More source-video minutes</li><li>Scheduling and connections</li><li>Complete clip workflow</li></ul><a class="button primary full" href="/login?returnTo=/app">Choose monthly</a></article>
    <article class="price-card"><span class="plan-kicker">Best value</span><h3>Yearly</h3><div class="price">9,000 <small>tokens/year</small></div><p>For higher-volume clipping across the full year.</p><ul><li>Annual token allocation</li><li>Complete workspace</li><li>Best long-term value</li></ul><a class="button secondary full" href="/login?returnTo=/app">Choose yearly</a></article>
  </div>`;
}

function faqBlock() {
  return `<div class="faq reveal">
    <details><summary>What does DeenClipped do?</summary><p>DeenClipped turns long lectures and videos into short-form clips, lets you review and edit every result, then helps publish or schedule approved clips.</p></details>
    <details><summary>Can I paste a YouTube link?</summary><p>Yes. You can begin with a supported video link or upload a video directly. DeenClipped then reads the source and lets you choose the processing range.</p></details>
    <details><summary>Do customers need to upload browser cookies?</summary><p>No. Customer-facing workflows should not ask users to upload browser cookies. Import handling remains behind the product experience.</p></details>
    <details><summary>Does publishing go to my own channel?</summary><p>Yes. Each DeenClipped user connects their own supported social accounts, and publishing uses that user's saved connection.</p></details>
    <details><summary>Can I review clips before posting?</summary><p>Yes. The workflow is review-first. You can approve, edit, regenerate, shorten, lengthen or remove clips before they are posted.</p></details>
  </div>`;
}

export function home({ base, currentUser }) {
  const body = `
  <main>
    <section class="hero wrap">
      <span class="eyebrow"><i></i>Built for lecture-to-short workflows</span>
      <h1>Turn long lectures into <span>powerful short clips.</span></h1>
      <p class="hero-copy">DeenClipped finds strong moments, creates vertical clips, adds captions, gives you a real editor, and helps publish to your connected platforms.</p>
      <p class="purpose-line"><strong>DeenClipped</strong> is a web application that helps users create, edit, and publish short-form clips from long videos.</p>
      ${sourceForm()}
      <div class="hero-actions"><a class="button secondary" href="/features">Explore the workflow</a><a class="button text-link" href="/pricing">View pricing ${icon('arrow')}</a></div>
      <div class="hero-product reveal" data-parallax>
        <div class="hero-glow"></div>
        <div class="app-frame hero-app-frame"><div class="window-bar"><span></span><span></span><span></span><i>deenclipped.online/app</i></div><img src="/marketing-assets/hero-dashboard.webp" alt="DeenClipped dashboard showing the complete clipping workflow" fetchpriority="high"></div>
        <figure class="floating-clip floating-a"><img src="/marketing-assets/floating-clip-a.webp" alt="A finished DeenClipped vertical clip"><figcaption><b>Captioned</b><span>Ready to review</span></figcaption></figure>
        <figure class="floating-clip floating-b"><img src="/marketing-assets/floating-clip-b.webp" alt="A vertical lecture clip created in DeenClipped"><figcaption><b>Reframed</b><span>9:16 output</span></figcaption></figure>
        <figure class="floating-clip floating-c"><img src="/marketing-assets/floating-clip-c.webp" alt="A completed short-form clip"><figcaption><b>Publish-ready</b><span>Your final approval</span></figcaption></figure>
        <div class="status-float status-left"><span>${icon('clips')}</span><div><b>Strong moments found</b><small>Review the best clips first</small></div></div>
        <div class="status-float status-right"><span>${icon('calendar')}</span><div><b>Schedule ready</b><small>Post to your channels</small></div></div>
      </div>
      <div class="capability-rail reveal"><span>${icon('link')} Import a source</span><i>${icon('arrow')}</i><span>${icon('clips')} Find strong moments</span><i>${icon('arrow')}</i><span>${icon('edit')} Refine every clip</span><i>${icon('arrow')}</i><span>${icon('publish')} Publish or schedule</span></div>
    </section>

    <section class="section workflow-section" id="how-it-works">
      <div class="wrap">
        <div class="section-head align-left reveal"><span class="section-label">One connected workflow</span><h2>Everything between the long video and the final post.</h2><p>DeenClipped is more than a clip generator. It keeps the source, generated clips, editor, templates, schedule and platform connections together.</p></div>
        <div class="workflow-story reveal">
          <div class="story-copy"><span class="story-number">01</span><h3>Start with the exact source you need.</h3><p>Paste a supported video link or upload a file. DeenClipped reads the source, lets you choose the start and end time, and estimates tokens from only the selected source window.</p>${checkItem('Full video by default','Process everything, or shorten the range to save tokens.')}${checkItem('Clear generation settings','Choose clip count, target length and template before rendering.')}</div>
          <div class="story-visual source-visual"><div class="app-frame"><img src="/marketing-assets/dashboard-overview.webp" alt="DeenClipped source import and dashboard"></div><div class="mini-control"><span>${icon('link')}</span><div><b>Source understood</b><small>Choose the section to process</small></div></div></div>
        </div>
      </div>
    </section>

    <section class="section clips-section">
      <div class="wrap split-layout">
        <div class="media-stack reveal">
          <div class="app-frame media-main"><img src="/marketing-assets/clip-library.webp" alt="DeenClipped project with generated clip thumbnails"></div>
          <div class="stack-card stack-one"><img src="/marketing-assets/floating-clip-a.webp" alt="Generated vertical clip one"></div>
          <div class="stack-card stack-two"><img src="/marketing-assets/floating-clip-b.webp" alt="Generated vertical clip two"></div>
          <div class="stack-card stack-three"><img src="/marketing-assets/floating-clip-c.webp" alt="Generated vertical clip three"></div>
        </div>
        <div class="feature-copy reveal"><span class="section-label">AI clip discovery</span><h2>See the actual clips, not a wall of settings.</h2><p>Generated moments appear as real visual results with thumbnails, captions, titles, scores and posting status. You can quickly understand what the AI created before spending time editing.</p><div class="detail-list">${checkItem('Visual clip review','Compare several generated moments at a glance.')}${checkItem('Hook and title guidance','Start with the strongest openings and clearer titles.')}${checkItem('Refine without starting over','Shorten, lengthen, retitle, regenerate or open the editor.')}</div><a class="button primary" href="/login?returnTo=/app">Create your first clips ${icon('arrow')}</a></div>
      </div>
    </section>

    <section class="section editor-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Real editing control</span><h2>AI starts the edit. You decide how it finishes.</h2><p>Move beyond one-click output with practical controls for captions, framing, templates, audio and timing.</p></div>
        <div class="editor-showcase reveal">
          <div class="app-frame editor-main"><img src="/marketing-assets/editor-timeline.webp" alt="DeenClipped editor with vertical preview and timeline"></div>
          <div class="editor-detail speaker-card"><img src="/marketing-assets/speaker-focus.webp" alt="DeenClipped automatic speaker focus control"><span><b>Speaker focus</b><small>Keep attention on the person speaking.</small></span></div>
          <div class="editor-detail preview-card"><img src="/marketing-assets/caption-preview.webp" alt="DeenClipped caption preview"><span><b>Caption control</b><small>Position readable captions exactly where they belong.</small></span></div>
          <div class="editor-label label-one">Drag captions</div><div class="editor-label label-two">Adjust framing</div><div class="editor-label label-three">Refine the timeline</div>
        </div>
        <div class="feature-row reveal"><div><span>${icon('captions')}</span><b>Caption positioning</b><p>Select, drag and place captions around the speaker and important visual content.</p></div><div><span>${icon('edit')}</span><b>Framing and canvas</b><p>Resize and reposition the video for a cleaner vertical composition.</p></div><div><span>${icon('template')}</span><b>Reusable templates</b><p>Keep typography, branding and layout consistent across every clip.</p></div></div>
      </div>
    </section>

    <section class="section organise-section">
      <div class="wrap split-layout reverse">
        <div class="feature-copy reveal"><span class="section-label">Projects and operations</span><h2>Keep every lecture, clip and next action organised.</h2><p>The project library keeps the original source at the top level and the generated clips inside it. Your workflow queue shows what is processing, what needs review, and what is ready to publish.</p><div class="detail-list">${checkItem('Source-first project library','Find the original lecture quickly, then open its clips.')}${checkItem('Clear workflow status','See processing, review and publishing progress in one place.')}${checkItem('Built for multiple accounts','Each user keeps their own projects and connected platforms.')}</div></div>
        <div class="double-media reveal"><div class="app-frame back-media"><img src="/marketing-assets/projects-library.webp" alt="DeenClipped project library"></div><div class="app-frame front-media"><img src="/marketing-assets/workflow-queue.webp" alt="DeenClipped workflow queue and platform connections"></div></div>
      </div>
    </section>

    <section class="section publishing-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Publish with control</span><h2>Create once. Review carefully. Publish consistently.</h2><p>Approved clips can be downloaded, posted immediately, or placed into a publishing schedule for your own connected accounts.</p></div>
        <div class="publishing-canvas reveal"><div class="app-frame schedule-frame"><img src="/marketing-assets/publishing-schedule.webp" alt="DeenClipped publishing schedule"></div><div class="connection-panel"><img src="/marketing-assets/vertical-clip.webp" alt="DeenClipped social platform connections"><div class="connection-caption"><span>${icon('account')}</span><div><b>Your accounts stay yours</b><small>Connections are stored per DeenClipped user.</small></div></div></div></div>
      </div>
    </section>

    <section class="section gallery-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Inside the workspace</span><h2>Explore more of the real product.</h2><p>Use the arrows to move through the dashboard, clip review, projects, editor and publishing workflow.</p></div>
        <div class="product-gallery reveal" data-gallery>
          <div class="gallery-track">
            <figure class="gallery-slide active"><img src="/marketing-assets/hero-dashboard.webp" alt="DeenClipped dashboard"><figcaption><b>Dashboard</b><span>Import, monitor and continue the next task.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/clip-results.webp" alt="DeenClipped generated clip results"><figcaption><b>Clip results</b><span>Review real thumbnails, scores and posting actions.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/projects-library.webp" alt="DeenClipped projects"><figcaption><b>Projects</b><span>Keep sources and generated clips organised.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/editor-timeline.webp" alt="DeenClipped editor"><figcaption><b>Editor</b><span>Refine framing, captions and timing.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/publishing-schedule.webp" alt="DeenClipped schedule"><figcaption><b>Publishing</b><span>Post now, download, or schedule the next clip.</span></figcaption></figure>
          </div>
          <button class="gallery-button previous" type="button" data-gallery-prev aria-label="Previous screenshot">${icon('left')}</button><button class="gallery-button next" type="button" data-gallery-next aria-label="Next screenshot">${icon('right')}</button><div class="gallery-dots" data-gallery-dots></div>
        </div>
      </div>
    </section>

    <section class="section pricing-section">
      <div class="wrap"><div class="section-head reveal"><span class="section-label">Simple source-time pricing</span><h2>Use tokens on the video time you choose to process.</h2><p>One token represents one selected source-video minute. Template-only rerenders remain free under the current plan rules.</p></div>${pricingCards()}</div>
    </section>

    <section class="section faq-section" id="faq"><div class="wrap"><div class="section-head reveal"><span class="section-label">Questions</span><h2>Know how the workflow works before you start.</h2></div>${faqBlock()}</div></section>

    <section class="section final-section"><div class="wrap final-cta reveal"><div><span class="section-label">Start creating</span><h2>Turn the next lecture into clips worth watching.</h2><p>Bring in a source, choose the range and build a review-ready set of short clips in one connected workspace.</p></div><a class="button primary" href="/login?returnTo=/app">Open DeenClipped ${icon('arrow')}</a></div></section>
  </main>`;
  return layout({ base, currentUser, title: 'DeenClipped', description: 'DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.', canonicalPath: '/', body });
}

export function features({ base, currentUser }) {
  const body = `<main>
    <section class="page-hero wrap"><span class="eyebrow"><i></i>Product features</span><h1>A complete workflow for turning long videos into short-form content.</h1><p>Import, clip, review, edit, organise, schedule and publish without moving between disconnected tools.</p></section>
    <section class="page-content"><div class="wrap">
      <div class="feature-row feature-page-row"><div><span>${icon('clips')}</span><b>AI clip discovery</b><p>Find complete, strong moments from lectures and long-form videos.</p></div><div><span>${icon('captions')}</span><b>Captions</b><p>Create readable captions and position them around the speaker.</p></div><div><span>${icon('edit')}</span><b>Editor</b><p>Adjust framing, video position, captions, audio and timing.</p></div><div><span>${icon('template')}</span><b>Templates</b><p>Reuse consistent caption, branding and layout choices.</p></div><div><span>${icon('calendar')}</span><b>Scheduling</b><p>Place approved clips into clear publishing windows.</p></div><div><span>${icon('account')}</span><b>Own account connections</b><p>Each user connects and publishes to their own supported channels.</p></div></div>
      <div class="feature-page-showcase"><div class="app-frame"><img src="/marketing-assets/clip-results.webp" alt="DeenClipped clip review"></div><div class="app-frame"><img src="/marketing-assets/editor-timeline.webp" alt="DeenClipped editor"></div><div class="app-frame"><img src="/marketing-assets/publishing-schedule.webp" alt="DeenClipped publishing schedule"></div></div>
      <div class="final-cta reveal"><div><span class="section-label">See it together</span><h2>Open one workspace instead of five separate tools.</h2><p>Start from the source video and continue through generation, review, editing and publishing.</p></div><a class="button primary" href="/login?returnTo=/app">Open DeenClipped ${icon('arrow')}</a></div>
    </div></section>
  </main>`;
  return layout({ base, currentUser, title: 'Features — DeenClipped', description: 'Explore DeenClipped AI clipping, captions, templates, review, editing, scheduling and social publishing features.', canonicalPath: '/features', body });
}

export function pricing({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Pricing</span><h1>Pay for the source time you choose to process.</h1><p>One token represents one selected source-video minute. Full-video processing is selected by default, and trimming the source range reduces usage.</p></section><section class="page-content"><div class="wrap">${pricingCards()}<div class="pricing-explainer"><div><span class="section-label">How tokens work</span><h2>Clear before you render.</h2><p>DeenClipped reads the source duration, lets you select a start and end time, then estimates usage from that selected range. Final usage is based on confirmed source time.</p>${checkItem('1 token per source minute','Usage follows the selected source window.')}${checkItem('Template rerenders stay free','Changing the visual template does not re-charge source time under current rules.')}</div><div class="app-frame"><img src="/marketing-assets/pricing-plans.webp" alt="DeenClipped token plans"></div></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Pricing — DeenClipped', description: 'Compare DeenClipped free, weekly, monthly and yearly token plans.', canonicalPath: '/pricing', body });
}

export function contact({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Contact</span><h1>Talk to DeenClipped.</h1><p>Questions about your account, publishing connections, billing or the clipping workflow can be sent directly to support.</p></section><section class="page-content"><div class="wrap"><div class="contact-card"><span class="contact-icon">${logoMark()}</span><h2>Support</h2><p>Email <a href="mailto:support@deenclipped.online">support@deenclipped.online</a></p><p>Include the email attached to your account and a short description of what happened.</p><a class="button primary" href="mailto:support@deenclipped.online">Email support ${icon('arrow')}</a></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Contact — DeenClipped', description: 'Contact DeenClipped support.', canonicalPath: '/contact', body });
}

export function privacy({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Privacy Policy</h1><p>How DeenClipped handles account, video, billing and connected-platform information.</p></section><section class="page-content"><article class="legal"><p>Last updated: 4 August 2026</p><p>DeenClipped helps users create, edit and publish short-form clips from long videos. This Privacy Policy explains what information is collected and how it is used.</p><h2>Information we collect</h2><p>We may collect account details such as your name, email address and profile picture when you sign in. We may also store project settings, uploaded or imported source information, generated clips, captions, templates, schedules and publishing preferences.</p><h2>Connected accounts</h2><p>When you connect YouTube or another social platform, DeenClipped may receive access and refresh tokens, channel identifiers and basic account information needed to provide the connection. Connections are stored per DeenClipped user and are used only to perform actions requested through the service.</p><h2>Billing</h2><p>Payments are processed by Stripe. DeenClipped may store subscription status, plan, token balance and Stripe customer references, but does not directly store complete payment-card details.</p><h2>How information is used</h2><p>Information is used to operate the service, process videos, generate clips, save account settings, provide publishing and scheduling, manage billing, prevent abuse and support users.</p><h2>Content and retention</h2><p>You are responsible for ensuring you have permission to process and publish source content. Stored content and account data may be retained while your account is active or as reasonably needed to provide the service, resolve disputes and meet legal obligations.</p><h2>Contact</h2><p>Privacy questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  return layout({ base, currentUser, title: 'Privacy Policy — DeenClipped', description: 'Privacy Policy for DeenClipped.', canonicalPath: '/privacy', body });
}

export function terms({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Terms of Service</h1><p>The rules for using DeenClipped to create, edit and publish short-form clips.</p></section><section class="page-content"><article class="legal"><p>Last updated: 4 August 2026</p><p>These Terms govern use of DeenClipped, a service for creating, editing and publishing short-form clips from long videos.</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions.</p><h2>Connected platforms</h2><p>When you connect YouTube or another platform, DeenClipped publishes using the account permissions you grant. You remain responsible for complying with each platform's terms and policies.</p><h2>Billing and tokens</h2><p>Some features require tokens, subscriptions or paid plans. Token usage may be based on selected source-video time and the plan rules displayed in the app. Checkout displays final billing terms before purchase.</p><h2>Service availability</h2><p>Features may change, pause or be removed over time. DeenClipped does not guarantee uninterrupted access or that every external video URL can be imported.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  return layout({ base, currentUser, title: 'Terms of Service — DeenClipped', description: 'Terms of Service for DeenClipped.', canonicalPath: '/terms', body });
}
