// Keep the duplicated filmstrip in sync for a seamless horizontal loop.
for (const preview of document.querySelectorAll('.publication-preview')) {
  const publication = preview.closest('.publication');
  const details = publication.querySelector('.publication-details');
  const desktop = matchMedia('(min-width: 960px)');
  const alignPreview = () => {
    if (!desktop.matches) {
      publication.style.removeProperty('--publication-size');
      return;
    }
    const size = details.getBoundingClientRect().height;
    if (Math.abs(preview.getBoundingClientRect().width - size) > .25) {
      publication.style.setProperty('--publication-size', `${size}px`);
    }
  };
  // The text determines the square's size, including after fonts/window changes.
  new ResizeObserver(() => requestAnimationFrame(alignPreview)).observe(details);
  desktop.addEventListener('change', alignPreview);
  alignPreview();
  const videos = [...preview.querySelectorAll('video')];
  if (!videos.length) continue;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  const update = () => {
    const playing = visible && !motion.matches;
    for (const video of videos) {
      video.muted = true;
      if (playing) video.play().catch(() => {});
      else video.pause();
    }
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  }).observe(preview);
  motion.addEventListener('change', update);
  videos[0].addEventListener('timeupdate', () => {
    for (const video of videos.slice(1)) {
      if (video.readyState && Math.abs(video.currentTime - videos[0].currentTime) > .12) {
        video.currentTime = videos[0].currentTime;
      }
    }
  });
}
