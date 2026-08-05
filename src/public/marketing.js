(() => {
  const menu = document.querySelector('[data-menu]');
  const nav = document.querySelector('.nav');
  if (menu && nav) {
    menu.addEventListener('click', () => nav.classList.toggle('mobile-open'));
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => nav.classList.remove('mobile-open')));
  }

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.12 })
    : null;

  document.querySelectorAll('.reveal').forEach(element => {
    if (observer) observer.observe(element);
    else element.classList.add('visible');
  });

  document.querySelectorAll('[data-source-form]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const source = form.querySelector('input')?.value?.trim() || '';
      const target = new URL('/login', location.origin);
      target.searchParams.set('returnTo', '/app');
      if (source) target.searchParams.set('source', source);
      location.href = target.toString();
    });
  });

  const gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    const slides = [...gallery.querySelectorAll('.gallery-slide')];
    const dotsHost = gallery.querySelector('[data-gallery-dots]');
    const previous = gallery.querySelector('[data-gallery-prev]');
    const next = gallery.querySelector('[data-gallery-next]');
    let index = Math.max(0, slides.findIndex(slide => slide.classList.contains('active')));
    let timer = null;

    const dots = slides.map((_, dotIndex) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'gallery-dot';
      dot.setAttribute('aria-label', `Show screenshot ${dotIndex + 1}`);
      dot.addEventListener('click', () => show(dotIndex, true));
      dotsHost?.appendChild(dot);
      return dot;
    });

    function show(nextIndex, userInitiated = false) {
      index = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle('active', slideIndex === index));
      dots.forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === index));
      if (userInitiated) restart();
    }

    function restart() {
      if (timer) window.clearInterval(timer);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timer = window.setInterval(() => show(index + 1), 6000);
      }
    }

    previous?.addEventListener('click', () => show(index - 1, true));
    next?.addEventListener('click', () => show(index + 1, true));
    gallery.addEventListener('mouseenter', () => timer && window.clearInterval(timer));
    gallery.addEventListener('mouseleave', restart);
    gallery.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') show(index - 1, true);
      if (event.key === 'ArrowRight') show(index + 1, true);
    });
    show(index);
    restart();
  }

  const parallax = document.querySelector('[data-parallax]');
  if (parallax && window.matchMedia('(pointer:fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const items = [...parallax.querySelectorAll('.floating-clip,.status-float')];
    parallax.addEventListener('pointermove', event => {
      const rect = parallax.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      items.forEach((item, itemIndex) => {
        const depth = 6 + itemIndex * 2;
        item.style.translate = `${x * depth}px ${y * depth}px`;
      });
    });
    parallax.addEventListener('pointerleave', () => items.forEach(item => { item.style.translate = ''; }));
  }
})();
