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
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  revealItems.forEach(item => revealObserver.observe(item));
}

for (const journey of document.querySelectorAll('[data-journey]')) {
  const tabs = [...journey.querySelectorAll('[data-journey-tab]')];
  const panels = [...journey.querySelectorAll('[data-journey-panel]')];
  const progress = journey.querySelector('.journey-progress i');
  let index = 0;
  let timer = null;
  let paused = false;

  const restartProgress = () => {
    if (!progress || reducedMotion) return;
    progress.style.animation = 'none';
    void progress.offsetWidth;
    progress.style.animation = '';
  };

  const show = nextIndex => {
    index = (nextIndex + tabs.length) % tabs.length;
    tabs.forEach((tab, tabIndex) => {
      const active = tabIndex === index;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel, panelIndex) => {
      const active = panelIndex === index;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    restartProgress();
  };

  const start = () => {
    window.clearInterval(timer);
    if (reducedMotion) return;
    timer = window.setInterval(() => {
      const bounds = journey.getBoundingClientRect();
      const visible = bounds.bottom > 0 && bounds.top < window.innerHeight;
      if (!paused && visible) show(index + 1);
    }, 6200);
  };

  tabs.forEach((tab, tabIndex) => {
    tab.addEventListener('click', () => { show(tabIndex); start(); });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : tabIndex + (event.key === 'ArrowRight' ? 1 : -1);
      show(next);
      tabs[index].focus();
      start();
    });
  });
  journey.addEventListener('mouseenter', () => { paused = true; });
  journey.addEventListener('mouseleave', () => { paused = false; });
  journey.addEventListener('focusin', () => { paused = true; });
  journey.addEventListener('focusout', () => { paused = false; });
  show(0);
  start();
}

for (const workflow of document.querySelectorAll('[data-faith-workflow]')) {
  const tabs = [...workflow.querySelectorAll('[data-faith-tab]')];
  const panels = [...workflow.querySelectorAll('[data-faith-panel]')];
  const show = key => {
    tabs.forEach(tab => {
      const active = tab.dataset.faithTab === key;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.dataset.faithPanel === key;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => show(tab.dataset.faithTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      show(tabs[next].dataset.faithTab);
      tabs[next].focus();
    });
  });
  show(tabs.find(tab => tab.classList.contains('active'))?.dataset.faithTab || tabs[0]?.dataset.faithTab);
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
