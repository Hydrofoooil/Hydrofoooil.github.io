// Check the single viewport using real wheel, keyboard, link and touch inputs.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.EDITOR_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const errors = [];
const open = async (context, hash = '') => {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/homepage/' + hash, base).href);
  await page.waitForFunction(() => document.body.classList.contains('has-hero-fog'));
  await page.evaluate(() => document.fonts.ready);
  return page;
};
const oneViewport = async page => assert.deepEqual(await page.evaluate(() => ({
  scroll: scrollY, height: document.documentElement.scrollHeight - innerHeight,
  sceneTop: document.querySelector('main').getBoundingClientRect().top,
  overflow: document.documentElement.scrollWidth > innerWidth,
})), { scroll: 0, height: 0, sceneTop: 0, overflow: false });
const landing = async page => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await oneViewport(page);
  assert(Math.abs((await page.locator('.site-header').boundingBox()).y) < .1, 'Initialization leaves the homepage copy in its original position');
  assert.equal(await page.locator('img.splash-photo').evaluate(el => getComputedStyle(el).opacity), '1', 'Initialization preserves the portrait');
  assert.equal(await page.locator('.scene-background').evaluate(el => getComputedStyle(el).opacity), '0', 'The new background stays hidden on landing and reload');
  assert(await page.locator('.bio-lead').evaluate(el => el.getBoundingClientRect().top >= innerHeight), 'Initialization leaves the profile below the viewport');
};
// Hold real asset requests to verify gestures during loading cannot cause a
// jump on readiness/reload. Releasing with true simulates failure.
const openLoading = async (context, paths = ['vendor/three/three.min.js'], clock = false) => {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (clock) await page.clock.install();
  let gate, release;
  const pause = () => { gate = new Promise(resolve => { release = resolve; }); };
  pause();
  await page.route('**/assets/**', async route => {
    if (paths.some(path => new URL(route.request().url()).pathname.endsWith(path))) {
      if (await gate) { await route.abort(); return; }
    }
    await route.continue();
  });
  await page.goto(new URL('/homepage/', base).href, { waitUntil: 'domcontentloaded' });
  return { page, release: fail => release(fail), reload: async () => {
    pause();
    await page.reload({ waitUntil: 'domcontentloaded' });
  } };
};
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cold = await openLoading(desktop, ['vendor/three/three.min.js', 'portrait-222.webp', 'background-333.webp', 'contour-splash-mask.svg']);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await cold.reload();
    assert.equal(await cold.page.locator('body').evaluate(el => el.classList.contains('has-hero-fog')), false);
    await cold.page.mouse.move(700, 400);
    for (let gesture = 0; gesture < 6; gesture++) await cold.page.mouse.wheel(0, 600);
    await cold.page.keyboard.press('PageDown');
    await cold.page.keyboard.press('End');
    await oneViewport(cold.page);
    assert.equal(await cold.page.locator('.second-page').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert((await cold.page.locator('.bio-lead').boundingBox()).y >= 900, 'Text stays below the viewport during asset loading');
    cold.release();
    await cold.page.waitForFunction(() => document.body.classList.contains('has-hero-fog'));
    await landing(cold.page);
    await cold.page.mouse.wheel(0, 405);
    await cold.page.waitForFunction(() => parseFloat(document.querySelector('main').style.getPropertyValue('--hero-copy-y')) < -400);
    await oneViewport(cold.page);
    assert.equal(await cold.page.locator('.living-ink-mask').evaluate(el => el.dataset.active), 'true', 'The first wheel gesture after readiness animates the photo mask');
    await cold.page.evaluate(() => { location.hash = '#honors'; });
    await cold.page.waitForFunction(() => document.querySelector('.honors-list li:last-child').getBoundingClientRect().bottom <= innerHeight);
  }
  await cold.page.close();

  const failed = await openLoading(desktop);
  await failed.page.mouse.wheel(0, 405);
  await oneViewport(failed.page);
  failed.release(true);
  await failed.page.waitForFunction(() => !document.documentElement.classList.contains('has-hero-scene'));
  assert.equal(await failed.page.locator('.living-ink-mask, .photo-depth').count(), 0, 'Failed initialization releases the scene');
  assert.equal(await failed.page.evaluate(() => scrollY), 0, 'Failure does not replay stale loading gestures');
  await failed.page.mouse.wheel(0, 705);
  await failed.page.waitForFunction(() => scrollY >= 700);
  await failed.page.close();

  // Playwright's clock applies to its whole context; isolate it from reload
  // checks that rely on real navigation timing.
  const timeoutContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const stalled = await openLoading(timeoutContext, undefined, true);
  await stalled.page.clock.fastForward(15001);
  await stalled.page.waitForFunction(() => !document.documentElement.classList.contains('has-hero-scene'));
  stalled.release();
  await stalled.page.waitForLoadState('load');
  assert.equal(await stalled.page.locator('.living-ink-mask, .photo-depth').count(), 0, 'Late assets cannot restart a timed-out initialization');
  await timeoutContext.close();

  const interrupted = await openLoading(desktop);
  await interrupted.page.keyboard.press('ArrowDown');
  await interrupted.page.emulateMedia({ reducedMotion: 'reduce' });
  await interrupted.page.waitForFunction(() => !document.documentElement.classList.contains('has-hero-scene'));
  interrupted.release();
  await interrupted.page.waitForLoadState('load');
  assert.equal(await interrupted.page.locator('.living-ink-mask, .photo-depth').count(), 0, 'A cancelled initialization stays cancelled');
  await interrupted.page.emulateMedia({ reducedMotion: 'no-preference' });
  await interrupted.page.waitForFunction(() => document.body.classList.contains('has-hero-fog'));
  await oneViewport(interrupted.page);
  await interrupted.page.close();

  const page = await open(desktop);
  await landing(page);
  assert.equal(await page.locator('.hero-fog').count(), 0, 'There is no separate fog surface covering the photo');
  // Read the alpha channel of the real shader, rather than inferring mask
  // deformation from an opacity value or from the overlaid page contents.
  const alpha = await page.evaluate(async () => {
    const photo = document.querySelector('img.splash-photo');
    const mask = new Image();
    mask.src = getComputedStyle(photo).maskImage.match(/url\(["']?(.*?)["']?\)/)[1];
    await mask.decode();
    const ink = createLivingInkMask({ photo, mask, depth: document.createElement('div'), THREE });
    try {
      ink.resize(420);
      const canvas = ink.canvas;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const sample = progress => {
        ink.setProgress(progress);
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return Uint8Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]);
      };
      const original = sample(0), middle = sample(.35);
      let keptOpaque = 0, erodedOpaque = 0;
      for (let i = 0; i < original.length; i++) if (original[i] > 250) {
        if (middle[i] > 250) keptOpaque++;
        if (middle[i] < 5) erodedOpaque++;
      }
      await new Promise(resolve => setTimeout(resolve, 1200));
      const flowing = sample(.35);
      let flowingPixels = 0;
      for (let i = 0; i < middle.length; i++) if (Math.abs(middle[i] - flowing[i]) > 10) flowingPixels++;
      const final = sample(1), restored = sample(0);
      return {
        keptOpaque, erodedOpaque, flowingPixels,
        finalAlpha: final.reduce((sum, value) => sum + value, 0),
        restoredExactly: restored.every((value, i) => value === original[i]),
      };
    } finally { ink.dispose(); }
  });
  assert(alpha.keptOpaque > 100 && alpha.erodedOpaque > 100, 'The mask erodes locally while its interior remains opaque');
  assert(alpha.flowingPixels > 100, 'The alpha boundary continues flowing while scroll progress is held fixed');
  assert.equal(alpha.finalAlpha, 0, 'The living mask completely dissolves the photo');
  assert(alpha.restoredExactly, 'Reversing restores the original saved ink mask');
  const originalPhoto = await page.locator('img.splash-photo').boundingBox();
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 405);
  await page.waitForFunction(() => document.querySelector('.bio-lead').getBoundingClientRect().top < innerHeight);
  await oneViewport(page);
  assert.equal(await page.locator('.second-page').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert((await page.locator('.name-en').boundingBox()).y < 0, 'Homepage name moves upward');
  const recedingPhoto = await page.locator('img.splash-photo').boundingBox();
  const backgroundOpacity = await page.locator('.scene-background').evaluate(el => Number(getComputedStyle(el).opacity));
  assert(backgroundOpacity > 0 && backgroundOpacity < 1, 'The new background gradually appears while the portrait recedes');
  const backgroundFrame = await page.locator('.scene-background img').boundingBox();
  assert.deepEqual(backgroundFrame, { x: 0, y: 0, width: 1440, height: 900 }, 'The revealed image covers the fixed viewport');
  assert(recedingPhoto.width < originalPhoto.width * .98 && recedingPhoto.height < originalPhoto.height * .98, 'Photo shrinks as fog wraps it');
  assert(Math.abs(recedingPhoto.x + recedingPhoto.width * .7 - originalPhoto.x - originalPhoto.width * .7) < .1, 'Subject remains anchored horizontally');
  assert(Math.abs(recedingPhoto.y + recedingPhoto.height * .43 - originalPhoto.y - originalPhoto.height * .43) < .1, 'Subject remains anchored vertically');
  await page.keyboard.press('End');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.splash-photo')).opacity === '0');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-background')).opacity === '1');
  await page.waitForFunction(() => document.querySelector('.honors-list li:last-child').getBoundingClientRect().bottom <= innerHeight);
  await oneViewport(page);
  await page.keyboard.press('Home');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.splash-photo')).opacity === '1');
  await page.waitForFunction(() => document.querySelector('.bio-lead').getBoundingClientRect().top >= innerHeight);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-background')).opacity === '0');
  await page.waitForFunction(width => Math.abs(document.querySelector('.splash-photo').getBoundingClientRect().width - width) < .05, originalPhoto.width);
  await page.locator('.scroll-cue').click();
  await page.waitForFunction(() => document.querySelector('.bio-lead').getBoundingClientRect().top < 100);
  await oneViewport(page);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('has-hero-fog'));
  await landing(page);
  assert.equal(new URL(page.url()).hash, '', 'Reload after the arrow returns to the portrait homepage');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phoneLoading = await openLoading(mobile);
  const phone = phoneLoading.page;
  const cdp = await mobile.newCDPSession(phone);
  const swipe = async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 720 }] });
    for (let y = 660; y >= 240; y -= 60) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
      await phone.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe();
  await oneViewport(phone);
  phoneLoading.release();
  await phone.waitForFunction(() => document.body.classList.contains('has-hero-fog'));
  await landing(phone);
  await swipe();
  await phone.waitForFunction(() => document.querySelector('.bio-lead').getBoundingClientRect().top < innerHeight);
  await oneViewport(phone);
  await phone.keyboard.press('End');
  await phone.waitForFunction(() => document.querySelector('.honors-list li:last-child').getBoundingClientRect().bottom <= innerHeight);
  assert.equal(await phone.locator('.scene-background').evaluate(el => getComputedStyle(el).opacity), '1', 'Touch scrolling also reveals the background');
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  await phone.waitForFunction(() => !document.documentElement.classList.contains('has-hero-scene'));
  assert(await phone.locator('.biography').isVisible(), 'Reduced motion preserves readable content');
  const linked = await open(desktop, '#publications');
  const publication = await linked.locator('#publications').boundingBox();
  assert(publication.y >= 0 && publication.y < 900, 'Publication deep link remains usable');
  assert.deepEqual(errors, []);
  console.log('PASS local mask erosion, continuous alpha flow, exact mask restoration, no fog overlay, background reveal and reversal, loading/reload, failure/timeout/cancellation fallback, single viewport, photo depth, transparent rising text, wheel/touch/keyboard, honors, arrow, deep links and reduced motion');
} finally {
  await browser.close();
}
