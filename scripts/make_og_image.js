/* Renders og-image.png (1200x630), the link-preview picture, from the app's own hero.
   Usage: serve the repo on :8765, then  node scripts/make_og_image.js <fontsource dir>
   Fonts are loaded from local @fontsource files so the image doesn't depend on Google Fonts. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const fontDir = process.argv[2];
const b64 = (f) => fs.readFileSync(path.join(fontDir, f)).toString('base64');
const faces = [['Manrope', 300, 'manrope/files/manrope-latin-300-normal.woff2'], ['Manrope', 400, 'manrope/files/manrope-latin-400-normal.woff2'],
  ['Manrope', 500, 'manrope/files/manrope-latin-500-normal.woff2'], ['Geist Mono', 400, 'geist-mono/files/geist-mono-latin-400-normal.woff2'],
  ['Geist Mono', 500, 'geist-mono/files/geist-mono-latin-500-normal.woff2']]
  .map(([fam, w, f]) => `@font-face{font-family:"${fam}";font-weight:${w};src:url(data:font/woff2;base64,${b64(f)}) format("woff2")}`).join('\n');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, reducedMotion: 'reduce' });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.addInitScript(() => { try { localStorage.setItem('retsim-theme', 'dark'); } catch (e) {} });
  await p.goto('http://localhost:8765/');
  await p.addStyleTag({ content: faces + `
    .top, main > *:not(.hero), .foot { display: none !important; }
    .hero { height: 630px; border: 0; }
    .hero-inner { padding-top: 92px !important; }
    .hero-title { font-size: 76px !important; }
    .hero-copy { font-size: 19px !important; max-width: 30em; }
    .og-url { position: absolute; left: 64px; bottom: 44px; font: 500 15px "Geist Mono", monospace; color: #7f8c9d; letter-spacing: .02em; z-index: 2; }
    .og-badge { position: absolute; left: 64px; bottom: 82px; z-index: 2; font: 500 15px "Manrope", sans-serif; color: #f1f5fa;
      border: 1px solid rgba(214,228,248,.15); background: rgba(16,24,35,.72); border-radius: 999px; padding: 8px 16px; }
    .og-badge b { color: #74a9dd; font-weight: 600; }` });
  await p.evaluate(() => {
    const h = document.querySelector('.hero');
    h.insertAdjacentHTML('beforeend', '<div class="og-badge">Emma, age 30, saving $12,000 a year: <b>50.5%</b> chance of reaching $1.5M</div><div class="og-url">ldiazbusquets.github.io/retirement-sim</div>');
    document.querySelector('.hero-inner').style.paddingLeft = '64px';
    document.querySelector('.hero-copy').textContent = 'Plays out 10,000 possible futures using 94 years of S&P 500 returns and shows how often you reach your goal.';
    dispatchEvent(new Event('resize'));
  });
  await document_fonts(p);
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'og-image.png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await b.close();
})();
async function document_fonts(p) { await p.evaluate(() => document.fonts.ready); }
