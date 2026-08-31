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
    // Children of one group enter together, a beat apart, instead of every
    // element on the page fading independently. A uniform fade on everything is
    // what makes a page read as generated; a short stagger reads as composed.
    // The delay is set here rather than in CSS so a section added later needs no
    // matching nth-child rules.
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

  /* The scroll-driven stepper: the active step lights as it passes the middle of
     the screen and a progress line grows to match. Driven by one observer rather
     than a scroll handler, so it costs nothing per frame. */
  const steps = [...document.querySelectorAll('[data-step]')];
  if (steps.length) {
    const line = document.querySelector('[data-step-line]');
    const stepObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        entry.target.classList.toggle('step-active', entry.isIntersecting);
      }
      const active = steps.filter(s => s.classList.contains('step-active'));
      if (line && active.length) {
        const last = steps.indexOf(active[active.length - 1]);
        line.style.setProperty('--step-progress', `${((last + 1) / steps.length) * 100}%`);
      }
    }, { threshold: 0.55, rootMargin: '-20% 0px -20% 0px' });
    steps.forEach(step => stepObserver.observe(step));
  }
}

for (const gallery of document.querySelectorAll('[data-gallery]')) {
  const slides = [...gallery.querySelectorAll('.gallery-slide')];
  const dotsRoot = gallery.querySelector('[data-gallery-dots]');
  const previous = gallery.querySelector('[data-gallery-prev]');
  const next = gallery.querySelector('[data-gallery-next]');
  if (!slides.length || !dotsRoot) continue;

  let index = Math.max(0, slides.findIndex(slide => slide.classList.contains('active')));
  let timer = null;

  const dots = slides.map((_, dotIndex) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Show product image ${dotIndex + 1}`);
    dot.addEventListener('click', () => show(dotIndex, true));
    dotsRoot.append(dot);
    return dot;
  });

  function show(nextIndex, restart = false) {
    index = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => slide.classList.toggle('active', slideIndex === index));
    dots.forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === index));
    if (restart) start();
  }

  function start() {
    window.clearInterval(timer);
    if (reducedMotion) return;
    timer = window.setInterval(() => show(index + 1), 6500);
  }

  previous?.addEventListener('click', () => show(index - 1, true));
  next?.addEventListener('click', () => show(index + 1, true));
  gallery.addEventListener('mouseenter', () => window.clearInterval(timer));
  gallery.addEventListener('mouseleave', start);
  gallery.addEventListener('focusin', () => window.clearInterval(timer));
  gallery.addEventListener('focusout', start);

  show(index);
  start();
}
