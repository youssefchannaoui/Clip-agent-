(() => {
  const menu = document.querySelector('[data-menu]');
  const nav = document.querySelector('.nav');
  if (menu && nav) menu.addEventListener('click', () => nav.classList.toggle('mobile-open'));

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      }), { threshold: 0.12 })
    : null;
  document.querySelectorAll('.reveal').forEach(element => observer ? observer.observe(element) : element.classList.add('visible'));

  document.querySelectorAll('[data-source-form]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const input = form.querySelector('input');
      const source = input?.value?.trim() || '';
      const target = new URL('/login', location.origin);
      target.searchParams.set('returnTo', '/app');
      if (source) target.searchParams.set('source', source);
      location.href = target.toString();
    });
  });
})();
