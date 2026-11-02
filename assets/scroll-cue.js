// The scroll cue (any link to #second-page) scrolls to the profile without writing
// #second-page into the address bar. The href stays, so the link still works without
// JavaScript. The fog hero handles its own navigation and is left alone.
(() => {
  const root = document.documentElement;
  if (root.dataset.hero === 'fog') return;
  // A #second-page already in the address (an older link or bookmark): still open at the
  // profile, but drop the hash. (Removing it first stops the browser's own jump, so jump here.)
  if (location.hash === '#second-page') {
    history.replaceState(history.state, '', location.pathname + location.search);
    document.getElementById('second-page')?.scrollIntoView({ behavior: 'instant' });
  }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href="#second-page"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById('second-page');
    if (!target) return;
    event.preventDefault();
    // Default behaviour follows the page's CSS: smooth, or instant with reduced motion.
    target.scrollIntoView();
    target.focus({ preventScroll: true });
  });
})();
