function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function navActions(currentUser) {
  if (currentUser) {
    return `<div class="nav-actions"><a class="button primary" href="/app">My dashboard</a></div>`;
  }
  return `<div class="nav-actions"><a class="button ghost" href="/login?returnTo=/app">Sign in</a><a class="button primary" href="/login?returnTo=/app">Get started</a></div>`;
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
  <meta name="theme-color" content="#060607">
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
      <a class="brand" href="/" aria-label="DeenClipped home"><span class="brand-mark" aria-hidden="true"></span><span>DeenClipped</span></a>
      <button class="menu-button" type="button" data-menu aria-label="Open navigation">☰</button>
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
        <div class="footer-brand"><a class="brand" href="/"><span class="brand-mark"></span><span>DeenClipped</span></a><p>Turn long lectures and videos into clean short-form clips, review them, and publish to your own connected channels.</p></div>
        <div class="footer-col"><h4>Product</h4><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/app">Dashboard</a></div>
        <div class="footer-col"><h4>Company</h4><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
        <div class="footer-col"><h4>Start</h4><a href="/login?returnTo=/app">Sign in</a><a href="/login?returnTo=/app">Create free clips</a><a href="mailto:support@deenclipped.online">Support</a></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} DeenClipped</span><span>Built for clean, controlled short-form publishing.</span></div>
    </div>
  </footer>
  <script src="/marketing.js" defer></script>
</body>
</html>`;
}

function sourceForm() {
  return `<form class="source-bar" data-source-form><span class="source-icon">↗</span><label class="sr-only" for="source-url">Video URL</label><input id="source-url" name="source" placeholder="Paste a YouTube or video link" autocomplete="off"><button type="submit">Create free clips</button></form>`;
}

export function home({ base, currentUser }) {
  const body = `
  <main>
    <section class="hero wrap">
      <span class="eyebrow"><i></i>DeenClipped AI clip workspace</span>
      <h1><span>One lecture. Ten clean clips.</span><br>Ready to publish.</h1>
      <p class="hero-copy">Turn long Islamic lectures and videos into short-form clips with AI. DeenClipped finds strong moments, adds captions, gives you full review control, and helps you publish faster.</p>
      <p class="purpose-line"><strong>DeenClipped</strong> is a web application that helps users create, edit, and publish short-form clips from long videos.</p>
      ${sourceForm()}
      <div class="hero-actions"><a class="button ghost" href="/features">Explore features</a><a class="button ghost" href="/pricing">View pricing</a></div>
      <p class="hero-note">No editing experience required. Review every clip before it goes live.</p>
      <div class="hero-stage reveal">
        <div class="browser-bar"><i></i><i></i><i></i><span></span></div>
        <img class="product-image" src="/marketing-assets/dashboard.webp" alt="DeenClipped dashboard showing video import, clip review, templates and publishing">
        <div class="floating-chip chip-one"><i></i>4 clips ready to review</div>
        <div class="floating-chip chip-two"><i></i>Your workflow, in one place</div>
      </div>
      <div class="platform-strip">
        <span class="platform-pill"><i class="platform-dot yt"></i><b>YouTube</b> import & publish</span>
        <span class="platform-pill"><i class="platform-dot tt"></i><b>TikTok</b> publishing</span>
        <span class="platform-pill"><i class="platform-dot ig"></i><b>Instagram</b> Reels</span>
        <span class="platform-pill"><i class="platform-dot fb"></i><b>Facebook</b> Reels</span>
      </div>
    </section>

    <section class="section" id="how-it-works">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">How it works</span><h2>From one long video to a complete clip pipeline.</h2><p>Import once. Choose the source window. Review the strongest moments. Publish on your schedule.</p></div>
        <div class="workflow-grid reveal">
          <article class="workflow-card"><span class="number">01 — IMPORT</span><h3>Paste a link or upload</h3><p>Bring in a lecture or video, then select the exact source range you want DeenClipped to process.</p></article>
          <article class="workflow-card"><span class="number">02 — REVIEW</span><h3>Choose the best clips</h3><p>See real thumbnails, hook scores, titles and captions before approving anything.</p></article>
          <article class="workflow-card"><span class="number">03 — PUBLISH</span><h3>Post to your channels</h3><p>Connect your own accounts, publish immediately, or place clips into a clean schedule.</p></article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split reverse">
        <div class="real-panel clip-phone-wrap reveal"><img src="/marketing-assets/clip-review.webp" alt="DeenClipped clip review page with real generated clip thumbnails"><div class="phone-card"><img src="/marketing-assets/vertical-clip.webp" alt="A finished vertical short-form clip"></div></div>
        <div class="split-copy reveal"><span class="section-label">AI clip review</span><h2>See the clips, not a wall of settings.</h2><p>DeenClipped presents generated clips as real visual results. Review the thumbnail, hook strength, title and posting status before you move forward.</p><div class="feature-list"><div><span class="check">✓</span><span><b>Real clip thumbnails</b><span>Know exactly what was generated at a glance.</span></span></div><div><span class="check">✓</span><span><b>Approve before posting</b><span>Nothing is published without your review.</span></span></div><div><span class="check">✓</span><span><b>Regenerate and refine</b><span>Shorten, lengthen, retitle or edit the clip style.</span></span></div></div><a class="button primary" href="/login?returnTo=/app">Generate your first clips</a></div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split">
        <div class="split-copy reveal"><span class="section-label">Real editor control</span><h2>AI starts the edit. You stay in control.</h2><p>Open any clip in the editor, adjust the framing, move captions, change the template and refine the timeline before rendering.</p><div class="feature-list"><div><span class="check">✓</span><span><b>Caption positioning</b><span>Drag, select and snap captions where they belong.</span></span></div><div><span class="check">✓</span><span><b>Vertical framing</b><span>Fit the lecture into a clean short-form layout.</span></span></div><div><span class="check">✓</span><span><b>Template-based rendering</b><span>Keep every clip visually consistent.</span></span></div></div><a class="button ghost" href="/features">See every feature</a></div>
        <div class="real-panel reveal"><img src="/marketing-assets/editor.webp" alt="DeenClipped video editor with vertical preview, captions and timeline"></div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Publishing workflow</span><h2>Create once. Publish consistently.</h2><p>Schedule approved clips and keep each customer or creator connected to their own social accounts.</p></div>
        <div class="publish-grid reveal"><div class="real-panel"><img src="/marketing-assets/schedule.webp" alt="DeenClipped publishing schedule with upcoming short-form clips"></div><div class="real-panel portrait"><img src="/marketing-assets/connections.webp" alt="DeenClipped connected platforms and scheduled posts"></div></div>
      </div>
    </section>

    <section class="section-tight">
      <div class="wrap metrics reveal"><div class="metric"><strong>1 link</strong><span>Start from one lecture or source video.</span></div><div class="metric"><strong>AI clips</strong><span>Find strong moments automatically.</span></div><div class="metric"><strong>Full review</strong><span>Approve and refine before publishing.</span></div><div class="metric"><strong>Your accounts</strong><span>Publish to each user's own channels.</span></div></div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Everything in one workspace</span><h2>Built for the full clipping workflow.</h2><p>Not just generation. DeenClipped connects the import, review, edit and publishing stages.</p></div>
        <div class="features-grid reveal">
          <article class="feature-card"><span class="feature-icon">✦</span><h3>AI moment detection</h3><p>Find useful, complete moments instead of random cut points.</p></article>
          <article class="feature-card"><span class="feature-icon">CC</span><h3>Automatic captions</h3><p>Generate readable captions and support bilingual clip styles.</p></article>
          <article class="feature-card"><span class="feature-icon">⌗</span><h3>Smart reframing</h3><p>Convert landscape source videos into vertical clips built for Shorts and Reels.</p></article>
          <article class="feature-card"><span class="feature-icon">◇</span><h3>Reusable templates</h3><p>Save a consistent visual style across every render.</p></article>
          <article class="feature-card"><span class="feature-icon">✓</span><h3>Clip review</h3><p>Approve, delete, retitle and refine clips before they leave the workspace.</p></article>
          <article class="feature-card"><span class="feature-icon">↗</span><h3>Publish and schedule</h3><p>Send approved clips to connected platforms immediately or later.</p></article>
        </div>
      </div>
    </section>

    <section class="section" id="pricing-preview">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Simple plans</span><h2>Choose the amount of source time you need.</h2><p>Tokens are based on selected source-video minutes, so trimming the source window saves tokens.</p></div>
        ${pricingCards()}
        <div style="text-align:center;margin-top:24px"><a class="button ghost" href="/pricing">Compare all plans</a></div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="wrap"><div class="section-head reveal"><span class="section-label">Questions</span><h2>Everything you need to know.</h2></div>${faqBlock()}</div>
    </section>

    <section class="section-tight"><div class="wrap final-cta reveal"><span class="section-label">Start creating</span><h2>Turn the next lecture into clips people will actually watch.</h2><p>Bring in a source video, choose the range and let DeenClipped build a review-ready set of clips.</p><a class="button primary" href="/login?returnTo=/app">Create free clips</a></div></section>
  </main>`;
  return layout({ base, currentUser, title: 'DeenClipped', description: 'DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.', canonicalPath: '/', body });
}

function pricingCards() {
  return `<div class="pricing-grid reveal">
    <article class="price-card"><h3>Free</h3><div class="price">$0</div><p>Test the full workflow and create your first clips.</p><ul><li>40 starter tokens</li><li>Clip review and editor</li><li>Template rerenders stay free</li></ul><a class="button ghost" href="/login?returnTo=/app">Start free</a></article>
    <article class="price-card"><h3>Weekly</h3><div class="price">120 <small>tokens/week</small></div><p>Flexible access for occasional weekly clipping.</p><ul><li>Renews weekly</li><li>All creation tools</li><li>Publishing workflow</li></ul><a class="button ghost" href="/login?returnTo=/app">Choose weekly</a></article>
    <article class="price-card popular"><span class="price-badge">Popular</span><h3>Monthly</h3><div class="price">650 <small>tokens/month</small></div><p>Best for creators publishing clips consistently.</p><ul><li>More source minutes</li><li>Full review and editor</li><li>Scheduling and connections</li></ul><a class="button primary" href="/login?returnTo=/app">Choose monthly</a></article>
    <article class="price-card"><h3>Yearly</h3><div class="price">9,000 <small>tokens/year</small></div><p>Maximum value for high-volume long-form content.</p><ul><li>Annual token allocation</li><li>Complete workspace</li><li>Best long-term value</li></ul><a class="button ghost" href="/login?returnTo=/app">Choose yearly</a></article>
  </div>`;
}

function faqBlock() {
  return `<div class="faq reveal">
    <details><summary>What does DeenClipped do?</summary><p>DeenClipped turns long videos into short-form clips, lets you review and edit them, and helps publish or schedule approved clips.</p></details>
    <details><summary>Can I paste a YouTube link?</summary><p>Yes. DeenClipped supports URL import when the source can be accessed, with direct video upload available as the reliable alternative.</p></details>
    <details><summary>Do customers need to upload cookies?</summary><p>No. Customer-facing workflows should not ask users to upload browser cookies. Import handling stays behind the app experience.</p></details>
    <details><summary>Does publishing go to my own channel?</summary><p>Yes. Each user connects their own social accounts, and publishing uses that user's saved connection.</p></details>
    <details><summary>Can I review clips before posting?</summary><p>Yes. DeenClipped is built around review-first publishing. You can approve, edit, regenerate or delete clips before posting.</p></details>
  </div>`;
}

export function features({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Product features</span><h1>Everything between the long video and the final post.</h1><p>DeenClipped combines AI clipping with the practical controls needed to review, edit, organise and publish short-form content.</p></section><section class="page-content"><div class="wrap"><div class="features-grid">${[
    ['✦','AI clip detection','Find strong, complete moments from lectures and long-form videos.'],['CC','Captions','Generate readable captions and keep them consistent with saved templates.'],['⌗','Source range control','Choose the exact beginning and end of the source video before processing.'],['◇','Templates','Reuse layouts, fonts, caption styles and framing choices.'],['✓','Clip review','Approve, retitle, shorten, lengthen, edit or remove generated clips.'],['↗','Publishing','Connect each user’s own YouTube and social accounts.'],['◫','Project library','Keep the original source thumbnail at project level and clip thumbnails inside the project.'],['⌁','Scheduling','Place approved clips into publishing windows and post when ready.'],['▣','Editor','Fine-tune framing, captions, video placement and timeline elements.']
  ].map(([icon,title,text])=>`<article class="feature-card reveal"><span class="feature-icon">${icon}</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div><div class="section"><div class="real-panel reveal"><img src="/marketing-assets/dashboard.webp" alt="DeenClipped full dashboard"></div></div><div class="final-cta reveal"><h2>See the complete workflow in your own dashboard.</h2><p>Start with a source video and move through generation, review, editing and publishing without leaving DeenClipped.</p><a class="button primary" href="/login?returnTo=/app">Open DeenClipped</a></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Features — DeenClipped', description: 'Explore DeenClipped AI clipping, captions, templates, review, editing, scheduling and social publishing features.', canonicalPath: '/features', body });
}

export function pricing({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Pricing</span><h1>Pay for the source time you process.</h1><p>One token represents one selected source-video minute. Full-video processing is selected by default, and trimming the source range reduces usage.</p></section><section class="page-content"><div class="wrap">${pricingCards()}<div class="section-tight"><div class="legal"><h2>How tokens work</h2><p>DeenClipped reads the source duration, lets you select a start and end time, then estimates usage from the selected range. The final charge is based on confirmed source time. Template-only rerenders remain free under the current plan rules.</p><h2>Trials and billing</h2><p>Paid subscriptions may include a seven-day trial when shown during checkout. Current prices and final billing terms are displayed before purchase through Stripe.</p></div></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Pricing — DeenClipped', description: 'Compare DeenClipped free, weekly, monthly and yearly token plans.', canonicalPath: '/pricing', body });
}

export function contact({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Contact</span><h1>Talk to DeenClipped.</h1><p>Questions about your account, publishing connections, billing or the clipping workflow can be sent directly to support.</p></section><section class="page-content"><div class="wrap"><div class="contact-card"><h2>Support</h2><p>Email <a href="mailto:support@deenclipped.online">support@deenclipped.online</a></p><p>Include the email attached to your account and a short description of what happened.</p><a class="button primary" href="mailto:support@deenclipped.online">Email support</a></div></div></section></main>`;
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
