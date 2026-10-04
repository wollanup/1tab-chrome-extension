/**
 * End-to-end tests: the extension running in a real (headless) Chrome.
 *
 *   npm run test:e2e
 *
 * Skipped when Chrome is not installed (set CHROME_PATH to use another build).
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { findChrome, launchChrome, waitFor } from '../../scripts/lib/chrome.js';

let server;
let base;

before(async () => {
    server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<title>Page ${req.url}</title><a id="link" href="/a" style="display:block;font-size:40px">link to /a</a>`);
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

/**
 * Starts Chrome with the extension, runs `test`, and always closes Chrome.
 *
 * @param {(chrome: Awaited<ReturnType<typeof launchChrome>>) => Promise<void>} test
 */
async function withChrome (test) {
    const chrome = await launchChrome();
    try {
        await test(chrome);
    }
    finally {
        await chrome.close();
    }
}

/** Badge text of every tab showing `url`. */
function badges (chrome, url) {
    return chrome.worker.evaluate(`chrome.tabs.query({})
        .then((tabs) => Promise.all(tabs
            .filter((t) => t.url === ${JSON.stringify(url)})
            .map((t) => chrome.action.getBadgeText({ tabId: t.id }))))`);
}

/**
 * Clicks the link of a page with the given mouse button.
 *
 * @param {'left' | 'middle'} button
 * @param {number} [modifiers]  2 = Ctrl
 */
async function clickLink (page, button, modifiers = 0) {
    const { x, y, height } = await page.evaluate('document.getElementById("link").getBoundingClientRect().toJSON()');
    const event = { x: x + 10, y: y + height / 2, button, clickCount: 1, modifiers };
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...event });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...event });
}

const count = (urls, url) => urls.filter((u) => u === url).length;

describe('extension in Chrome', { skip: !findChrome() && 'Chrome not found (set CHROME_PATH)' }, () => {
    it('shows the number of copies on duplicate tabs', () => withChrome(async (chrome) => {
        await chrome.openPage(`${base}/a`);
        await chrome.openPage(`${base}/a`);
        await chrome.openPage(`${base}/b`);
        await waitFor(async () => (await badges(chrome, `${base}/a`)).join() === '2,2');
        assert.deepEqual(await badges(chrome, `${base}/b`), ['']);
    }));

    it('keeps a duplicate opened with a middle click, by default', () => withChrome(async (chrome) => {
        await chrome.openPage(`${base}/a`, { background: true });
        const page = await chrome.openPage(`${base}/b`);
        await clickLink(page, 'middle');
        await waitFor(async () => count(await chrome.pageUrls(), `${base}/a`) === 2);
        await waitFor(async () => (await badges(chrome, `${base}/a`)).join() === '2,2');
    }));

    describe('auto switch', () => {
        it('switches to the existing tab instead of opening a duplicate in the foreground', () => withChrome(async (chrome) => {
            await chrome.worker.evaluate(`chrome.storage.local.set({ autoSwitch: true })`);
            await chrome.openPage(`${base}/a`);
            const page = await chrome.openPage(`${base}/b`);
            await clickLink(page, 'left', 2 | 8); // Ctrl+Shift+click: new foreground tab
            await sleep(1500);
            assert.equal(count(await chrome.pageUrls(), `${base}/a`), 1);
            const [active] = await chrome.worker.evaluate('chrome.tabs.query({ active: true, lastFocusedWindow: true })');
            assert.equal(active.url, `${base}/a`);
        }));

        it('leaves tabs opened in the background alone', () => withChrome(async (chrome) => {
            await chrome.worker.evaluate(`chrome.storage.local.set({ autoSwitch: true })`);
            await chrome.openPage(`${base}/a`, { background: true });
            const page = await chrome.openPage(`${base}/b`);
            await clickLink(page, 'left', 2); // Ctrl+click: new background tab
            await waitFor(async () => count(await chrome.pageUrls(), `${base}/a`) === 2);
            await sleep(1000);
            assert.equal(count(await chrome.pageUrls(), `${base}/a`), 2);
        }));
    });

    it('closes duplicates from the popup', () => withChrome(async (chrome) => {
        for (let i = 0; i < 3; i++) {
            await chrome.openPage(`${base}/a`, { background: true });
        }
        await chrome.openPage(`${base}/b`, { background: true });
        const popup = await chrome.openPage(`chrome-extension://${chrome.extensionId}/popup.html`);
        await waitFor(() => popup.evaluate('document.querySelectorAll(".group").length === 1'));
        assert.match(await popup.evaluate('document.getElementById("closeAll").textContent'), /2/);

        await popup.evaluate('document.getElementById("closeAll").click()');
        await waitFor(async () => count(await chrome.pageUrls(), `${base}/a`) === 1);
        assert.equal(count(await chrome.pageUrls(), `${base}/b`), 1);
        await waitFor(() => popup.evaluate('!document.getElementById("noDuplicates").hidden'));
    }));
});
