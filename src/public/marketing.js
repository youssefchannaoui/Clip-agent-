/* DeenClipped public site behaviour.
 *
 * `mjs` on <html> is the gate for every scripted visual: .reveal only hides
 * when this file actually ran, and the pinned-scene heights in the CSS only
 * exist under it — so with no JavaScript the page renders complete and
 * static, in its final pose. Content is never delivered BY an animation.
 */
document.documentElement.classList.add('mjs');

const menuButton = document.querySelector('[data-menu]');
const navLinks = document.querySelector('.nav-links');

menuButton?.addEventListener('click', () => {
  const open = navLinks?.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(Boolean(open)));
});

navLinks?.addEventListener('click', event => {
  if (event.target.closest('a')) {
    navLinks.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  }
});

// Escape closes whichever navigation surface is open: the mobile drawer, or
// a dropdown held open by focus (blurring releases :focus-within).
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (document.activeElement?.closest('.nav-group')) document.activeElement.blur();
  if (navLinks?.classList.contains('open')) {
    navLinks.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.focus();
  }
});

for (const form of document.querySelectorAll('[data-source-form]')) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = String(new FormData(form).get('source') || '').trim();
    const target = value ? `/app?source=${encodeURIComponent(value)}` : '/app';
    window.location.assign(`/login?returnTo=${encodeURIComponent(target)}`);
  });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealItems = [...document.querySelectorAll('.reveal')];

if (reducedMotion || !('IntersectionObserver' in window)) {
  revealItems.forEach(item => item.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const group = entry.target.hasAttribute('data-stagger')
        ? [...entry.target.children]
        : [entry.target];
      group.forEach((node, index) => {
        node.style.transitionDelay = index ? `${Math.min(index * 70, 420)}ms` : '';
        node.classList.add('is-visible');
      });
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  revealItems.forEach(item => revealObserver.observe(item));
  document.querySelectorAll('[data-stagger]').forEach(node => revealObserver.observe(node));
}

/* The scroll-scene engine. Each [data-scene] wrapper gets a `--p` custom
 * property running 0 → 1 across its scroll span; the CSS turns that into
 * transforms and opacity on the compositor. One rAF-coalesced handler, one
 * getBoundingClientRect per on-screen scene per frame, no layout writes —
 * reading rects and writing a custom property does not thrash layout.
 * Under reduced motion the engine never starts and `--p` stays at its CSS
 * default of 1: the final, legible pose. */
if (!reducedMotion) {
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const rootEl = document.documentElement;
  const wide = window.matchMedia('(min-width: 961px)');
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const scene of scenes) {
      const rect = scene.getBoundingClientRect();
      if (rect.bottom < -300 || rect.top > vh + 300) continue;
      const span = rect.height - vh;
      const raw = span > 60
        ? -rect.top / span
        : (vh - rect.top) / (vh + rect.height);
      const p = Math.min(1, Math.max(0, raw));
      scene.style.setProperty('--p', p.toFixed(4));
      // The journey: stamp the active stage (gates visibility and which
      // stage is interactive), and let stage two demonstrate both hearing
      // modes — clicking still wins whenever the page is at rest.
      if (wide.matches && scene.classList.contains('sc-journey')) {
        const js = p * 7.7;
        if (!scene._stages) scene._stages = [...scene.querySelectorAll('.journey-stage')];
        const active = Math.max(0, Math.min(6, Math.floor(js - 0.15)));
        scene._stages.forEach((el, i) => el.classList.toggle('on', i === active));
        const quran = document.getElementById('ct-quran');
        const lecture = document.getElementById('ct-lecture');
        if (quran && lecture && js > 1.15 && js < 2.05) (js > 1.62 ? quran : lecture).checked = true;
      }
    }
    // Whole-page progress for the orientation hairline, and the point where
    // the header wordmark condenses into the rotating seal.
    const max = rootEl.scrollHeight - vh;
    const frac = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    rootEl.style.setProperty('--scroll', frac.toFixed(4));
    // Condense after the hero; resolve back into the full wordmark at the
    // foot of the page, closing the loop the seal opened.
    rootEl.classList.toggle('condensed', window.scrollY > vh * 0.55 && frac < 0.965);
  };
  const request = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();
  window.addEventListener('load', update);

  /* A 170ms stage-black veil between public routes. Plain navigations only:
     modified clicks, new-tab targets and same-page anchors pass through
     untouched, and pageshow clears the veil so back/forward (including the
     bfcache) never restores a dark page. Skipped entirely under reduced
     motion — the listener is inside the same guard. */
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.hash) return;
    event.preventDefault();
    document.documentElement.classList.add('leaving');
    window.setTimeout(() => window.location.assign(link.href), 170);
  });
  window.addEventListener('pageshow', () => document.documentElement.classList.remove('leaving'));
}
