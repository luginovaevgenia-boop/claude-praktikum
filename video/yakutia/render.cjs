// Рендер index.html в MP4 1920×1080 (30 fps) через Playwright + ffmpeg.
//   node render.cjs                 → yakutia-demography.mp4
//   node render.cjs --stills 3,10   → PNG-кадры на 3-й и 10-й секунде (для проверки)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

(async () => {
  const args = process.argv.slice(2);
  const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.join(__dirname, 'index.html') + '?render=1');
  await page.evaluate(() => window.fontsReady);
  const { DURATION, FPS } = await page.evaluate(() => ({ DURATION: window.DURATION, FPS: window.FPS }));

  const grab = async t => Buffer.from(
    (await page.evaluate(t => { window.renderFrame(t); return document.getElementById('c').toDataURL('image/png'); }, t)).split(',')[1],
    'base64');

  if (stillsArg) {
    for (const s of stillsArg.split(',').map(Number)) {
      fs.writeFileSync(path.join(__dirname, `still-${s}.png`), await grab(s));
    }
    await browser.close();
    return;
  }

  const out = path.join(__dirname, 'yakutia-demography.mp4');
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(DURATION * FPS);
  for (let i = 0; i < total; i++) {
    const buf = await grab(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.error(`кадр ${i}/${total}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.error('Готово:', out);
})();
