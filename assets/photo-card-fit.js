// Photo hero: keep the rounded card inside the window so it can sit centred.
// When the names and biography make the card taller than the window allows,
// scale them (CSS zoom through --text-fit) just enough to fit, never below 80%.
// Runs from the head: the first fit happens in the animation frame before the
// hero is first painted, so the text never visibly jumps on load.
(() => {
  const root = document.documentElement;
  const stacked = matchMedia('(max-width: 900px), (max-aspect-ratio: 1/1)');
  const MIN_FIT = .8;
  let pending = 0;

  const fit = () => {
    pending = 0;
    const hero = document.querySelector('.hero');
    const card = hero?.querySelector('.hero-backdrop');
    if (!card) return;
    if (root.dataset.hero !== 'photo' || stacked.matches) {
      hero.style.removeProperty('--text-fit');
      return;
    }
    // The card may be as tall as the window less the gap above and below it.
    const room = root.clientHeight - 2 * parseFloat(getComputedStyle(hero).paddingTop) + .5;
    const set = value => hero.style.setProperty('--text-fit', value.toFixed(4));
    const fits = value => (set(value), card.getBoundingClientRect().height <= room);
    if (fits(1) || !fits(MIN_FIT)) return;
    let lo = MIN_FIT, hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    set(lo);
  };
  const schedule = () => { pending ||= requestAnimationFrame(fit); };

  // Before the first paint: wait until the hero (and the section after it) is parsed.
  const early = () => {
    if (document.getElementById('second-page')) fit();
    else if (document.readyState === 'loading') requestAnimationFrame(early);
  };
  requestAnimationFrame(early);
  document.addEventListener('DOMContentLoaded', fit, { once: true });
  addEventListener('load', schedule, { once: true });
  addEventListener('resize', schedule);
  document.fonts?.ready.then(schedule);
  document.fonts?.addEventListener?.('loadingdone', schedule);
})();
