// Keep the duplicated filmstrip in sync for a seamless horizontal loop.
for (const preview of document.querySelectorAll('.publication-preview')) {
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
