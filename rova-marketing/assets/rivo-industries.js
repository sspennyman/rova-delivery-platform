(() => {
  const root = document.querySelector('.industries-page');
  if (!root) return;
  const tablist = root.querySelector('.sector-tabs');
  const tabs = [...tablist.querySelectorAll('.sector-tab')];
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));
  tablist.setAttribute('role', 'tablist');
  function select(index, focus = false) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[index].id);
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].tabIndex = 0;
    tab.addEventListener('click', event => { event.preventDefault(); select(index); });
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); select(next, true); }
    });
  });
  const hashIndex = panels.findIndex(panel => '#' + panel.id === location.hash);
  select(hashIndex >= 0 ? hashIndex : 0);
  window.addEventListener('hashchange', () => {
    const index = panels.findIndex(panel => '#' + panel.id === location.hash);
    if (index >= 0) select(index);
  });
  const reveal = root.querySelectorAll('.foundation-heading, .foundation-steps article, .sector-closing');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    reveal.forEach(element => { element.setAttribute('data-sector-reveal', ''); observer.observe(element); });
  }
  root.classList.add('industry-enhanced');
})();
