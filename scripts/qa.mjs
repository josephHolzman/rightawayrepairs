// QA harness for the static site: screenshots, visual diffs, layout measurements,
// axe, CDN-outage and keyboard checks. Serves the repo root itself on PORT.
//
//   node scripts/qa.mjs shots <name>      full-page screenshots -> qa/<name>/
//   node scripts/qa.mjs diff <a> <b>      pixel diff qa/<a> vs qa/<b> -> qa/diff-<a>-<b>/
//   node scripts/qa.mjs measure [name]    hero/grid/band metrics (-> qa/<name>/measure.json)
//   node scripts/qa.mjs axe               WCAG 2.x A/AA scan, exits 1 on any violation
//   node scripts/qa.mjs cdn-down          REQUEST SERVICE buttons with jsdelivr blocked, exits 1 if any fail
//   node scripts/qa.mjs keys              Tab order on each page
//   node scripts/qa.mjs forms             both forms against a stubbed EmailJS, exits 1 on any failed check
//
// Selectors use data-qa attributes only, never class names.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';

const { PNG } = pngjs;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA_DIR = path.join(ROOT, 'qa');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

const PAGES = [
  { name: 'index', file: '/index.html' },
  { name: 'serviceRequest', file: '/serviceRequest.html' },
  { name: 'thank-you', file: '/thank-you.html' },
];

const VIEWPORTS = [
  [375, 812], [768, 1024], [1024, 768],
  [1280, 600], [1280, 720], [1366, 657], // 1280x600 and 1366x657: laptops after browser chrome
  [1440, 900], [1536, 864], [1919, 1080], [1920, 1080],
  [2560, 1440], [3840, 2160],
].map(([w, h]) => ({ w, h }));

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ---------------------------------------------------------------- server

function startServer() {
  const reported = new Set();
  const server = http.createServer(async (req, res) => {
    const notFound = () => {
      if (!reported.has(req.url)) {
        reported.add(req.url);
        console.error(`[server] 404 ${req.url}`);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    };

    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, BASE).pathname);
    } catch {
      return notFound();
    }
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type || !file.startsWith(ROOT + path.sep)) return notFound();

    try {
      const body = await fsp.readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      notFound();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------- browser helpers

async function withBrowser(fn) {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function newPage(browser, vp, { blockCdn = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
  });
  // The forms email the client through EmailJS; make sure a QA run can never reach it.
  await context.route('https://api.emailjs.com/**', (route) => route.abort());
  if (blockCdn) await context.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  return context.newPage();
}

// Run after every navigation, including back/forward.
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function load(page, file) {
  await page.goto(BASE + file, { waitUntil: 'networkidle', timeout: 60_000 });
  await settle(page);
}

const vpName = (vp) => `${vp.w}x${vp.h}`;

function printTable(rows, columns) {
  const cell = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v ?? ''));
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(columns));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(columns.map((c) => cell(r[c]))));
}

// ---------------------------------------------------------------- shots

async function shots(name) {
  if (!name) usage('shots needs a name');
  const dir = path.join(QA_DIR, name);
  await fsp.mkdir(dir, { recursive: true });

  await withBrowser(async (browser) => {
    for (const vp of VIEWPORTS) {
      const page = await newPage(browser, vp);
      for (const p of PAGES) {
        await load(page, p.file);
        // A full-page screenshot doesn't scroll, so lazy images far below the fold never load.
        await page.evaluate(() => Promise.all([...document.querySelectorAll('img[loading="lazy"]')].map((img) => {
          img.loading = 'eager';
          return img.decode().catch(() => {});
        })));
        const out = path.join(dir, `${p.name}-${vpName(vp)}.png`);
        await page.screenshot({ path: out, fullPage: true, animations: 'disabled' });
        console.log(path.relative(ROOT, out));
      }
      await page.context().close();
    }
  });
}

// ---------------------------------------------------------------- diff

function crop(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
  return out;
}

async function diff(a, b) {
  if (!a || !b) usage('diff needs two names');
  const dirA = path.join(QA_DIR, a);
  const dirB = path.join(QA_DIR, b);
  for (const d of [dirA, dirB]) if (!fs.existsSync(d)) usage(`no such directory: ${path.relative(ROOT, d)}`);
  const outDir = path.join(QA_DIR, `diff-${a}-${b}`);
  await fsp.mkdir(outDir, { recursive: true });

  const rows = [];
  for (const p of PAGES) {
    for (const vp of VIEWPORTS) {
      const file = `${p.name}-${vpName(vp)}.png`;
      const fa = path.join(dirA, file);
      const fb = path.join(dirB, file);
      const row = { page: p.name, viewport: vpName(vp) };
      if (!fs.existsSync(fa) || !fs.existsSync(fb)) {
        if (fs.existsSync(fa) || fs.existsSync(fb)) {
          rows.push({ ...row, heights: `missing in ${fs.existsSync(fa) ? b : a}`, diff: '' });
        }
        continue;
      }

      const imgA = PNG.sync.read(await fsp.readFile(fa));
      const imgB = PNG.sync.read(await fsp.readFile(fb));
      const width = Math.min(imgA.width, imgB.width);
      const height = Math.min(imgA.height, imgB.height);
      const out = new PNG({ width, height });
      const changed = pixelmatch(
        crop(imgA, width, height).data,
        crop(imgB, width, height).data,
        out.data, width, height, { threshold: 0.1 },
      );
      await fsp.writeFile(path.join(outDir, file), PNG.sync.write(out));

      rows.push({
        ...row,
        heights: imgA.height === imgB.height
          ? String(imgA.height)
          : `${imgA.height} vs ${imgB.height} (top ${height}px compared)`,
        diff: `${((changed / (width * height)) * 100).toFixed(3)}%`,
      });
    }
  }

  printTable(rows, ['page', 'viewport', 'heights', 'diff']);
  console.log(`\nDiff images: ${path.relative(ROOT, outDir)}`);
}

// ---------------------------------------------------------------- measure

function measurePage() {
  const q = (name) => {
    const el = document.querySelector(`[data-qa="${name}"]`);
    if (!el) throw new Error(`missing [data-qa="${name}"]`);
    return el;
  };
  const rect = (el) => el.getBoundingClientRect();
  const r1 = (n) => Math.round(n * 10) / 10;

  const hero = rect(q('hero'));
  const content = q('hero-content');
  const contentStyle = getComputedStyle(content);
  const kids = [...content.children].map(rect);
  // Resolved track sizes; drop 0px tracks that auto-fit collapses.
  const tracks = getComputedStyle(q('service-grid')).gridTemplateColumns
    .split(/\s+/).filter((t) => parseFloat(t) > 0);
  const topbar = rect(q('topbar'));
  const cta = rect(q('cta-band'));
  const root = document.documentElement;

  return {
    rootFontPx: parseFloat(getComputedStyle(root).fontSize),
    contentW: r1(rect(content).width - parseFloat(contentStyle.paddingLeft) - parseFloat(contentStyle.paddingRight)),
    heroH: r1(hero.height),
    heroOverflow: r1(Math.max(...kids.map((k) => k.bottom)) - hero.bottom),
    heroGapTop: r1(Math.min(...kids.map((k) => k.top)) - hero.top),
    gridCols: tracks.length,
    topbarLR: [r1(topbar.left), r1(topbar.right)],
    ctaLR: [r1(cta.left), r1(cta.right)],
    aboutW: r1(rect(q('about-body')).width),
    hScroll: root.scrollWidth > root.clientWidth,
  };
}

async function measure(name) {
  const rows = await withBrowser(async (browser) => {
    const results = [];
    for (const vp of VIEWPORTS) {
      const page = await newPage(browser, vp);
      await load(page, '/index.html');
      results.push({ viewport: vpName(vp), ...(await page.evaluate(measurePage)) });
      await page.context().close();
    }
    return results;
  });

  printTable(rows, ['viewport', 'rootFontPx', 'contentW', 'heroH', 'heroOverflow', 'heroGapTop',
    'gridCols', 'topbarLR', 'ctaLR', 'aboutW', 'hScroll']);

  // The content column must never get narrower as the viewport gets wider.
  const byWidth = [...rows].sort((a, b) => parseInt(a.viewport) - parseInt(b.viewport));
  const shrinks = byWidth.filter((r, i) => i && r.contentW < byWidth[i - 1].contentW);
  for (const r of shrinks) {
    const prev = byWidth[byWidth.indexOf(r) - 1];
    console.log(`\nFAIL contentW shrinks: ${prev.viewport} ${prev.contentW} -> ${r.viewport} ${r.contentW}`);
  }
  if (shrinks.length) process.exitCode = 1;
  else console.log('\ncontentW never decreases as the viewport widens.');

  if (name) {
    const dir = path.join(QA_DIR, name);
    await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, 'measure.json');
    await fsp.writeFile(out, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`\nSaved ${path.relative(ROOT, out)}`);
  }
}

// ---------------------------------------------------------------- axe

async function axe() {
  const total = await withBrowser(async (browser) => {
    let count = 0;
    for (const p of PAGES) {
      for (const vp of [{ w: 375, h: 812 }, { w: 1440, h: 900 }]) {
        const page = await newPage(browser, vp);
        await load(page, p.file);
        const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        await page.context().close();

        console.log(`\n== ${p.file} @ ${vpName(vp)}: ${violations.length} violated rule(s)`);
        if (!violations.length) continue;
        count += violations.length;
        printTable(violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 3).map((n) => n.target.flat().join(' >>> ')).join('  |  '),
        })), ['rule', 'impact', 'nodes', 'targets']);
      }
    }
    return count;
  });

  console.log(`\nTotal violated rules across runs: ${total}`);
  if (total) process.exitCode = 1;
}

// ---------------------------------------------------------------- cdn-down

async function cdnDown() {
  const failures = await withBrowser(async (browser) => {
    const page = await newPage(browser, { w: 1440, h: 900 }, { blockCdn: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(`${page.url()}: ${err.message}`));
    await load(page, '/index.html');

    const ctas = page.locator('[data-qa="request-cta"]');
    const count = await ctas.count();
    const rows = [];
    for (let i = 0; i < count; i++) {
      const btn = ctas.nth(i);
      const where = await btn.evaluate((el) => {
        const owner = el.parentElement.closest('[data-qa], section[id], header');
        return owner ? owner.dataset.qa || owner.id : '';
      });
      await btn.click({ timeout: 5_000 });
      const navigated = await page
        .waitForURL(/\/serviceRequest\.html/, { timeout: 3_000 })
        .then(() => true, () => false);
      rows.push({ '#': i + 1, location: where, navigated: navigated ? 'yes' : 'NO', url: page.url().replace(BASE, '') });
      if (navigated) {
        await page.goBack();
        await settle(page);
      }
    }
    await page.context().close();

    console.log('index.html @ 1440x900 with https://cdn.jsdelivr.net/** blocked\n');
    printTable(rows, ['#', 'location', 'navigated', 'url']);
    console.log(`\nPage errors (${errors.length}):`);
    for (const e of errors) console.log(`  ${e}`);
    return rows.filter((r) => r.navigated !== 'yes').length;
  });

  if (failures) {
    console.log(`\n${failures} REQUEST SERVICE button(s) did not navigate.`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- keys

async function focusedInfo(page) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    return { tag: el.tagName.toLowerCase(), href: el.getAttribute('href') ?? '' };
  });
  if (!info) return null;
  // ariaSnapshot gives Chromium's computed role and accessible name, e.g. `- button "SUBMIT"`.
  const snap = await page.locator(':focus').ariaSnapshot({ timeout: 2_000 }).catch(() => '');
  const m = snap.match(/^- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/);
  return { ...info, role: m?.[1] ?? '', name: m?.[2] ?? '' };
}

async function keys() {
  await withBrowser(async (browser) => {
    for (const p of PAGES) {
      const page = await newPage(browser, { w: 1440, h: 900 });
      await load(page, p.file);

      const rows = [];
      let first = null;
      let wrapped = 0;
      for (let step = 1; step <= 40; step++) {
        await page.keyboard.press('Tab');
        const handle = await page.evaluateHandle(() => document.activeElement);
        if (first && (await page.evaluate(([a, b]) => a === b, [first, handle]))) {
          wrapped = step;
          break;
        }
        const info = await focusedInfo(page);
        if (!info) {
          rows.push({ step, tag: '(none: focus left the document)' });
          continue;
        }
        first ??= handle;
        rows.push({ step, ...info });
      }
      await page.context().close();

      console.log(`\n== ${p.file} @ 1440x900`);
      printTable(rows, ['step', 'tag', 'role', 'name', 'href']);
      console.log(wrapped ? `Focus wrapped to the first element at step ${wrapped}.` : 'Stopped after 40 Tabs without wrapping.');
    }
  });
}

// ---------------------------------------------------------------- forms

const EMAILJS_CDN = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';

// Stands in for the EmailJS CDN script. sendForm reports what it would send to the test
// (window.__recordSend, exposed by the test) and settles as window.__emailjsMode says:
// 'resolve', 'reject', or 'hold' (wait for window.__settleSend(true | false)).
const EMAILJS_STUB = `window.emailjs = {
  init() {},
  sendForm(serviceId, templateId, form) {
    const entries = [...new FormData(form)].map(([k, v]) => [k, v instanceof File ? 'file:' + v.name : v]);
    window.__recordSend({ serviceId, templateId, entries });
    const mode = window.__emailjsMode || 'resolve';
    return new Promise((resolve, reject) => {
      const settle = (ok) => ok ? resolve({ status: 200, text: 'OK' }) : reject({ status: 400, text: 'stub' });
      if (mode === 'hold') window.__settleSend = settle;
      else settle(mode === 'resolve');
    });
  },
};`;

const FORMS = [
  {
    form: 'consult', file: '/index.html', qa: 'hero-form',
    fields: ['fName', 'lName', 'email', 'phone', 'time'],
    fill: { fName: 'Test', lName: 'User', email: 'test@example.com', phone: '2025550123' },
  },
  {
    form: 'request', file: '/serviceRequest.html', qa: 'request-form',
    fields: ['fName', 'lName', 'email', 'phone', 'address', 'zip', 'description', 'deadline', 'image', 'time'],
    fill: {
      fName: 'Test', lName: 'User', email: 'test@example.com', phone: '2025550123',
      address: '1 Test St NW', zip: '20001', description: 'Test only', deadline: '2026-11-12',
    },
  },
];

// A 1x1 PNG for the photo upload.
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function formPage(browser, f, { mode = 'resolve', cdn = 'stub' } = {}) {
  const page = await newPage(browser, { w: 1440, h: 900 });
  const sends = [];
  await page.exposeFunction('__recordSend', (s) => { sends.push(s); });
  await page.addInitScript((m) => { window.__emailjsMode = m; }, mode);
  await page.context().route(EMAILJS_CDN, (route) => (cdn === 'stub'
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: EMAILJS_STUB })
    : route.abort()));
  await load(page, f.file);
  const form = page.locator(`[data-qa="${f.qa}"]`);
  for (const [name, value] of Object.entries(f.fill)) await form.locator(`[name="${name}"]`).fill(value);
  return { page, form, sends, submit: form.locator('button[type="submit"]') };
}

async function formState(form) {
  return form.evaluate((el) => {
    const btn = el.querySelector('button[type="submit"]');
    const err = el.querySelector('[role="alert"]');
    const active = document.activeElement;
    return {
      busy: el.getAttribute('aria-busy'),
      disabled: btn.disabled,
      label: btn.textContent,
      errorShown: !err.hidden,
      errorText: err.textContent,
      errorLinks: [...err.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      focus: active === btn ? 'submit button' : active === document.body ? 'body' : active.id || active.tagName,
    };
  });
}

async function forms() {
  const results = [];
  const check = (form, name, ok, detail = '') => results.push({ form, check: name, result: ok ? 'pass' : 'FAIL', detail });
  const ERROR = "We couldn't send your request. Please call (202) 670-6479 or email therightawayrepairs@gmail.com.";
  const landed = (page, f) => page
    .waitForURL(new RegExp(`/thank-you\\.html\\?form=${f.form}$`), { timeout: 5_000 })
    .then(() => true, () => false);

  await withBrowser(async (browser) => {
    for (const f of FORMS) {
      // Success: the payload has every original field name and no honeypot, then the thank-you page.
      {
        const { page, sends, submit } = await formPage(browser, f);
        if (f.form === 'request') {
          await page.locator('#image').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PIXEL_PNG });
          const count = page.locator('#imageCount');
          await count.filter({ hasText: /\S/ }).waitFor({ timeout: 3_000 }).catch(() => {});
          const info = await count.evaluate((el) => ({ role: el.getAttribute('role'), text: el.textContent, hidden: el.hidden }));
          check(f.form, 'photo count status', info.role === 'status' && info.text === '1 photo selected' && !info.hidden,
            `role=${info.role} "${info.text}"`);
        }
        await submit.click();
        check(f.form, 'success -> thank-you', await landed(page, f), page.url().replace(BASE, ''));
        const names = sends[0]?.entries.map(([k]) => k) ?? [];
        const missing = f.fields.filter((n) => !names.includes(n));
        check(f.form, 'payload: all fields, no honeypot',
          sends.length === 1 && !missing.length && !names.includes('company_website'),
          `[${[...new Set(names)].join(', ')}]${missing.length ? ` missing ${missing}` : ''}`);
        if (f.form === 'request') {
          const images = sends[0]?.entries.filter(([k]) => k === 'image').map(([, v]) => v) ?? [];
          check(f.form, 'payload: photo attached', images.join() === 'file:photo.png', `[${images}]`);
          const deadline = sends[0]?.entries.find(([k]) => k === 'deadline')?.[1];
          check(f.form, 'payload: deadline value', deadline === f.fill.deadline, String(deadline));
        }
        await page.context().close();
      }

      // Sending state, then a rejected sendForm: inline error, state restored, focus back on the button.
      {
        const { page, form, sends, submit } = await formPage(browser, f, { mode: 'hold' });
        await submit.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => typeof window.__settleSend === 'function');
        const during = await formState(form);
        check(f.form, 'sending state',
          during.busy === 'true' && during.disabled && during.label === 'Sending…' && !during.errorShown,
          `aria-busy=${during.busy} disabled=${during.disabled} "${during.label}" focus=${during.focus}`);
        await page.evaluate(() => window.__settleSend(false));
        await form.locator('[role="alert"]').waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
        const after = await formState(form);
        check(f.form, 'reject -> inline error', after.errorShown && after.errorText === ERROR
          && after.errorLinks.join() === 'tel:+12026706479,mailto:therightawayrepairs@gmail.com', after.errorText);
        check(f.form, 'reject -> state restored', after.busy === null && !after.disabled && after.label !== 'Sending…',
          `aria-busy=${after.busy} disabled=${after.disabled} "${after.label}"`);
        check(f.form, 'reject -> focus', after.focus === 'submit button', after.focus);
        check(f.form, 'reject -> stays on page', page.url().endsWith(f.file) && sends.length === 1, page.url().replace(BASE, ''));
        await page.context().close();
      }

      // EmailJS missing (CDN blocked): inline error, no navigation, no page error.
      {
        const { page, form, submit } = await formPage(browser, f, { cdn: 'blocked' });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await submit.click();
        await form.locator('[role="alert"]').waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
        const st = await formState(form);
        check(f.form, 'no emailjs -> inline error',
          st.errorShown && !st.disabled && page.url().endsWith(f.file) && !errors.length,
          errors.length ? errors.join('; ') : `shown=${st.errorShown} disabled=${st.disabled}`);
        await page.context().close();
      }

      // Honeypot filled: never calls sendForm, still lands on the thank-you page.
      {
        const { page, form, sends, submit } = await formPage(browser, f);
        await form.locator('[name="company_website"]').evaluate((el) => { el.value = 'http://spam.example'; });
        await submit.click();
        const ok = await landed(page, f);
        check(f.form, 'honeypot -> no send, thank-you', ok && sends.length === 0,
          `sends=${sends.length} ${page.url().replace(BASE, '')}`);
        await page.context().close();
      }
    }

    // iOS zooms into inputs under 16px: every user-facing field must compute to >= 16px.
    for (const vp of [{ w: 375, h: 812 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }]) {
      for (const f of FORMS) {
        const page = await newPage(browser, vp);
        await load(page, f.file);
        const sizes = await page.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
          .filter((el) => el.type !== 'hidden' && el.type !== 'file' && !el.closest('[aria-hidden="true"]'))
          .map((el) => ({ id: el.id, px: parseFloat(getComputedStyle(el).fontSize) })));
        const small = sizes.filter((s) => s.px < 16);
        check(f.form, `input font-size @ ${vpName(vp)}`, sizes.length && !small.length,
          `${sizes.length} fields, min ${Math.min(...sizes.map((s) => s.px))}px${small.length ? `; under 16: ${small.map((s) => s.id)}` : ''}`);
        await page.context().close();
      }
    }
  });

  printTable(results, ['form', 'check', 'result', 'detail']);
  const failed = results.filter((r) => r.result !== 'pass').length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------- main

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error('Usage: node scripts/qa.mjs <shots <name> | diff <a> <b> | measure [name] | axe | cdn-down | keys | forms>');
  process.exit(2);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  shots: () => shots(args[0]),
  diff: () => diff(args[0], args[1]),
  measure: () => measure(args[0]),
  axe,
  'cdn-down': cdnDown,
  keys,
  forms,
};
if (!commands[cmd]) usage(cmd ? `unknown command: ${cmd}` : '');
await commands[cmd]();
