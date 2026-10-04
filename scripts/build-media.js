/**
 * Generates the README images and the Chrome Web Store images from the real
 * popup, with headless Chrome:
 *
 *   npm run media
 *
 * Web pages are served by request interception (no network access), so the
 * tabs have realistic URLs and titles.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { EXTENSION_DIR, launchChrome, waitFor } from './lib/chrome.js';

const MEDIA_DIR = resolve(fileURLToPath(import.meta.url), '../../media');
const STORE_DIR = join(MEDIA_DIR, 'store');

const PAGES = {
    mdnMap     : { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map', title: 'Array.prototype.map() - JavaScript | MDN' },
    mdnFilter  : { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter', title: 'Array.prototype.filter() - JavaScript | MDN' },
    mdnFetch   : { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', title: 'Fetch API - Web APIs | MDN' },
    wikipedia  : { url: 'https://en.wikipedia.org/wiki/Tab_(interface)', title: 'Tab (interface) - Wikipedia' },
    github     : { url: 'https://github.com/wollanup/1tab-chrome-extension', title: 'wollanup/1tab-chrome-extension' },
    hackerNews : { url: 'https://news.ycombinator.com/', title: 'Hacker News' }
};

/** Letter favicons, so that the popup list does not show generic globes. */
const FAVICONS = {
    'developer.mozilla.org': ['M', '#111827'],
    'en.wikipedia.org'     : ['W', '#6b7280'],
    'github.com'           : ['G', '#24292f'],
    'news.ycombinator.com' : ['Y', '#ff6600']
};

const TEXT = {
    en: {
        shot1Title: 'Spot duplicate tabs at a glance',
        shot1Text : 'A badge tells you when the current page is already open in another tab.',
        shot2Title: 'Clean up in one click',
        shot2Text : 'Group tabs by page, path or site, then close the extra copies.',
        tagline   : 'One page, one tab.'
    },
    fr: {
        shot1Title: 'Repérez les doublons d’un coup d’œil',
        shot1Text : 'Un badge indique quand la page courante est déjà ouverte dans un autre onglet.',
        shot2Title: 'Faites le ménage en un clic',
        shot2Text : 'Regroupez les onglets par page, chemin ou site, puis fermez les copies en trop.',
        tagline   : 'Une page, un onglet.'
    }
};

const dataUri = (type, content) => `data:${type};base64,${Buffer.from(content).toString('base64')}`;
const ICON_LARGE = dataUri('image/png', readFileSync(join(EXTENSION_DIR, 'icons/icon512.png')));
const ICON_32 = dataUri('image/png', readFileSync(join(EXTENSION_DIR, 'icons/icon32.png')));

/** @param {Awaited<ReturnType<typeof launchChrome>>} chrome */
function servePages (chrome) {
    const titles = new Map(Object.values(PAGES).map((p) => [p.url, p.title]));
    chrome.cdp.on(async ({ method, params, sessionId }) => {
        if (method !== 'Fetch.requestPaused') {
            return;
        }
        const url = new URL(params.request.url);
        const [letter, color] = FAVICONS[url.hostname] ?? ['?', '#2563eb'];
        const [type, body] = url.pathname === '/favicon.svg'
            ? ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${color}"/><text x="8" y="12" font-size="11" font-weight="700" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif">${letter}</text></svg>`]
            : ['text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>${titles.get(url.href) ?? url.hostname}</title><link rel="icon" href="/favicon.svg">`];
        await chrome.cdp.send('Fetch.fulfillRequest', {
            requestId      : params.requestId,
            responseCode   : 200,
            responseHeaders: [{ name: 'content-type', value: type }],
            body           : Buffer.from(body).toString('base64')
        }, sessionId);
    });
    return chrome.cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
}

/** Chrome caps extension popups at 600 px high. */
const POPUP_MAX_HEIGHT = 600;

/**
 * Renders the popup and returns it as a 2x PNG.
 *
 * The popup is rendered in a regular 360 px wide tab: real popups do not
 * support device metrics emulation, so they cannot be captured at 2x. The tab
 * the popup sees as current is the last one open on `currentUrl`.
 *
 * @param {Awaited<ReturnType<typeof launchChrome>>} chrome
 * @param {{ dark?: boolean, before?: string, currentUrl?: string }} [options]  `before`: script run in the popup first
 */
async function capturePopup (chrome, { dark = false, before, currentUrl = PAGES.mdnMap.url } = {}) {
    const page = await chrome.openPageWith(`chrome-extension://${chrome.extensionId}/popup.html`, async (blank) => {
        await blank.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 2, mobile: false });
        await blank.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
        await blank.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `{
                const query = chrome.tabs.query.bind(chrome.tabs);
                chrome.tabs.query = async (filter) => filter.active && filter.currentWindow
                    ? (await query({})).filter((t) => t.url === ${JSON.stringify(currentUrl)}).slice(-1)
                    : query(filter);
            }`
        });
    });
    await waitFor(() => page.evaluate('document.querySelectorAll(".group").length > 0'));
    if (before) {
        await page.evaluate(before);
    }
    await sleep(400); // favicons, transitions
    const height = await page.evaluate('document.body.offsetHeight');
    if (height > POPUP_MAX_HEIGHT) {
        console.warn(`warning: the popup is ${height}px high, Chrome will make it scroll`);
    }
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 360, height, scale: 1 } });
    await chrome.closePage(page);
    return { png: Buffer.from(data, 'base64'), height };
}

/**
 * Renders an HTML document to a PNG of exactly `width` x `height` pixels.
 *
 * @param {Awaited<ReturnType<typeof launchChrome>>} chrome
 */
async function renderHtml (chrome, html, width, height) {
    const page = await chrome.openPage('about:blank');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await page.send('Page.getFrameTree');
    await page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await page.evaluate('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode())))');
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
    await chrome.cdp.send('Target.closeTarget', { targetId: page.targetId });
    return Buffer.from(data, 'base64');
}

const BASE_CSS = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color: #0f172a; }
    .stage { position: relative; overflow: hidden; width: 100vw; height: 100vh;
        background: radial-gradient(circle at 85% 10%, #c7d2fe 0, transparent 45%), radial-gradient(circle at 0% 100%, #bfdbfe 0, transparent 50%), #eef2ff; }
`;

/** A store screenshot: caption on the left, a browser window with the popup on the right. */
function screenshotHtml ({ title, text, popup, tabs, url, badge }) {
    const tabItems = tabs.map(({ title: tabTitle, letter, color, active }) => `
        <div class="tab ${active ? 'active' : ''}"><span class="fav" style="background:${color}">${letter}</span><span>${tabTitle}</span></div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
        .caption { position: absolute; left: 72px; top: 0; bottom: 0; width: 420px; display: flex; flex-direction: column; justify-content: center; gap: 20px; }
        .caption img { width: 72px; height: 72px; }
        .caption h1 { margin: 0; font-size: 44px; line-height: 1.15; letter-spacing: -0.5px; }
        .caption p { margin: 0; font-size: 22px; line-height: 1.45; color: #475569; }
        .window { position: absolute; left: 540px; top: 64px; width: 700px; height: 760px; border-radius: 14px; background: #fff;
            box-shadow: 0 30px 80px rgba(30, 41, 99, .25), 0 0 0 1px rgba(30, 41, 99, .08); overflow: hidden; }
        .tabs { display: flex; gap: 4px; padding: 10px 12px 0; background: #dfe3eb; height: 46px; }
        .tab { display: flex; align-items: center; gap: 8px; width: 150px; padding: 0 12px; font-size: 13px; color: #334155; border-radius: 10px 10px 0 0; white-space: nowrap; overflow: hidden; }
        .tab span:last-child { overflow: hidden; text-overflow: ellipsis; }
        .tab.active { background: #fff; color: #0f172a; }
        .fav { flex: none; display: grid; place-items: center; width: 16px; height: 16px; border-radius: 3px; color: #fff; font: 700 11px Arial, sans-serif; }
        .toolbar { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid #e2e8f0; }
        .address { flex: 1; padding: 8px 16px; border-radius: 20px; background: #f1f5f9; font-size: 14px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .action { position: relative; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: #e0e7ff; }
        .action img { width: 18px; height: 18px; }
        .badge { position: absolute; right: -4px; bottom: -2px; min-width: 16px; padding: 0 4px; border-radius: 8px; background: #d97706; color: #fff; font: 700 11px/16px Arial, sans-serif; text-align: center; }
        .popup { position: absolute; right: 10px; top: 104px; width: 360px; border-radius: 10px; box-shadow: 0 12px 40px rgba(15, 23, 42, .28), 0 0 0 1px rgba(15, 23, 42, .1); }
        .page { padding: 40px 32px; display: flex; flex-direction: column; gap: 14px; }
        .line { height: 14px; border-radius: 7px; background: #eef2f7; }
    </style></head><body><div class="stage">
        <div class="caption"><img src="${ICON_LARGE}" alt=""><h1>${title}</h1><p>${text}</p></div>
        <div class="window">
            <div class="tabs">${tabItems}</div>
            <div class="toolbar"><div class="address">${url}</div><div class="action"><img src="${ICON_32}" alt=""><span class="badge">${badge}</span></div></div>
            <div class="page">${'<div class="line"></div>'.repeat(3)}<div class="line" style="width:60%"></div><br>${'<div class="line"></div>'.repeat(4)}</div>
            <img class="popup" src="${popup}" alt="">
        </div>
    </div></body></html>`;
}

/** Two captures of the same size, the second one drawn over the top-left half. */
function diagonalHtml (bottom, top) {
    return `<!doctype html><html><head><style>
        body { margin: 0; }
        div { position: relative; width: 100vw; height: 100vh; }
        img { position: absolute; inset: 0; width: 100%; height: 100%; }
        img + img { clip-path: polygon(0 0, 100% 0, 0 100%); }
    </style></head><body><div><img src="${dataUri('image/png', bottom)}" alt=""><img src="${dataUri('image/png', top)}" alt=""></div></body></html>`;
}

/** A promotional tile: logo, name and tagline. */
function promoHtml ({ tagline, scale }) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
        .stage { display: flex; align-items: center; justify-content: center; gap: ${48 * scale}px; }
        img { width: ${180 * scale}px; height: ${180 * scale}px; }
        h1 { margin: 0; font-size: ${96 * scale}px; letter-spacing: -2px; line-height: 1; }
        p { margin: ${12 * scale}px 0 0; font-size: ${34 * scale}px; color: #4338ca; font-weight: 600; }
    </style></head><body><div class="stage"><img src="${ICON_LARGE}" alt=""><div><h1>1Tab</h1><p>${tagline}</p></div></div></body></html>`;
}

/** Tabs drawn in the fake tab strip of the store screenshots; the last one is active. */
function tabStrip () {
    const keys = ['github', 'mdnMap', 'wikipedia', 'mdnMap'];
    return keys.map((key, i) => {
        const [letter, color] = FAVICONS[new URL(PAGES[key].url).hostname];
        return { title: PAGES[key].title, letter, color, active: i === keys.length - 1 };
    });
}

async function openTabs (chrome, keys) {
    for (const key of keys) {
        await chrome.openPage(PAGES[key].url, { background: true });
    }
}

mkdirSync(STORE_DIR, { recursive: true });
const write = (dir, name, png) => {
    writeFileSync(join(dir, name), png);
    console.log(join(dir, name));
};

for (const lang of ['en', 'fr']) {
    const chrome = await launchChrome({ lang });
    try {
        await servePages(chrome);
        await openTabs(chrome, ['github', 'mdnMap', 'wikipedia', 'hackerNews', 'wikipedia', 'mdnFilter', 'mdnFetch']);
        // The active tab: a page that is already open.
        await chrome.openPage(PAGES.mdnMap.url, { background: true });
        await sleep(500);

        // 1. Exact mode: the current page is open twice.
        const light = await capturePopup(chrome);
        if (lang === 'en') {
            const dark = await capturePopup(chrome, { dark: true });
            // Light and dark themes, split along the diagonal.
            write(MEDIA_DIR, 'popup-light-dark-en.png', await renderHtml(chrome, diagonalHtml(light.png, dark.png), 720, light.height * 2));
        }
        const t = TEXT[lang];
        write(STORE_DIR, `screenshot-1-${lang}.png`, await renderHtml(chrome, screenshotHtml({
            title: t.shot1Title, text: t.shot1Text, popup: dataUri('image/png', light.png), tabs: tabStrip(), url: PAGES.mdnMap.url.replace('https://', ''), badge: 2
        }), 1280, 800));

        // 2. Host mode: the MDN group unfolded.
        await chrome.worker.evaluate(`chrome.storage.local.set({ matchMode: 'domain' })`);
        await sleep(300);
        const expanded = await capturePopup(chrome, {
            before: `[...document.querySelectorAll('.group-title')].find((el) => el.textContent.includes('mozilla'))?.closest('.group-link').click()`
        });
        write(STORE_DIR, `screenshot-2-${lang}.png`, await renderHtml(chrome, screenshotHtml({
            title: t.shot2Title, text: t.shot2Text, popup: dataUri('image/png', expanded.png), tabs: tabStrip(), url: PAGES.mdnMap.url.replace('https://', ''), badge: 4
        }), 1280, 800));
        await chrome.worker.evaluate(`chrome.storage.local.set({ matchMode: 'exact' })`);

        if (lang === 'en') {
            const paused = await capturePopup(chrome, {
                before: `document.getElementById('pauseBtn').click(); new Promise((done) => setTimeout(done, 300))`
            });
            write(MEDIA_DIR, 'popup-paused-en.png', paused.png);
            await chrome.worker.evaluate('chrome.storage.session.set({ paused: false })');
        }

        // Promotional tiles (Chrome Web Store sizes).
        write(STORE_DIR, `promo-small-${lang}.png`, await renderHtml(chrome, promoHtml({ tagline: t.tagline, scale: 0.42 }), 440, 280));
        write(STORE_DIR, `promo-marquee-${lang}.png`, await renderHtml(chrome, promoHtml({ tagline: t.tagline, scale: 1.25 }), 1400, 560));
    }
    finally {
        await chrome.close();
    }
}
