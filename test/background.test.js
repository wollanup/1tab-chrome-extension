import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeBrowser, flush, flushBadges, POPUP_WINDOW } from './fake-browser.js';

const PAGE = 'https://example.com/a';
const OTHER_PAGE = 'https://example.com/b';
const AUTO_SWITCH = { settings: { autoSwitch: true } };

let instance = 0;

/**
 * Starts a fresh copy of the service worker on a fake browser.
 *
 * @param {Parameters<typeof createFakeBrowser>[0] & { tabs?: string[] }} [options]
 */
async function startWorker ({ tabs = [], ...options } = {}) {
    const browser = createFakeBrowser(options);
    const ids = tabs.map((url) => browser.existingTab(url));
    globalThis.chrome = browser.chrome;
    await import(`../src/background.js?instance=${instance++}`);
    await flush();
    return { browser, ids };
}

describe('badges', () => {
    it('shows the number of copies on duplicate tabs only', async () => {
        const { browser, ids: [a1, b, a2] } = await startWorker({ tabs: [PAGE, OTHER_PAGE, PAGE] });
        await flushBadges();
        assert.equal(browser.badge(a1), '2');
        assert.equal(browser.badge(a2), '2');
        assert.equal(browser.badge(b), '');
    });

    it('updates when tabs open and close', async () => {
        const { browser, ids: [original] } = await startWorker({ tabs: [PAGE] });
        const copy = browser.openTab(PAGE, { active: false });
        browser.finishLoading(copy);
        await flushBadges();
        assert.equal(browser.badge(original), '2');
        assert.equal(browser.badge(copy), '2');

        await browser.chrome.tabs.remove(copy);
        await flushBadges();
        assert.equal(browser.badge(original), '');
    });

    it('updates when a tab navigates', async () => {
        const { browser, ids: [a, b] } = await startWorker({ tabs: [PAGE, OTHER_PAGE] });
        browser.navigate(b, PAGE);
        await flushBadges();
        assert.equal(browser.badge(a), '2');
        assert.equal(browser.badge(b), '2');
    });

    it('follows the detection mode', async () => {
        const { browser, ids: [a, b] } = await startWorker({ tabs: [PAGE, OTHER_PAGE] });
        await flushBadges();
        assert.equal(browser.badge(a), '');
        await browser.chrome.storage.local.set({ matchMode: 'domain' });
        await flushBadges();
        assert.equal(browser.badge(a), '2');
        assert.equal(browser.badge(b), '2');
    });

    it('are cleared while paused', async () => {
        const { browser, ids: [a] } = await startWorker({ tabs: [PAGE, PAGE] });
        await flushBadges();
        assert.equal(browser.badge(a), '2');
        await browser.chrome.storage.session.set({ paused: true });
        await flushBadges();
        assert.equal(browser.badge(a), '');
        assert.equal(browser.icon, 'icons/icon16-paused.png');
    });
});

describe('without auto switch (default)', () => {
    it('never closes tabs', async () => {
        const { browser } = await startWorker({ tabs: [PAGE] });
        browser.openTab(PAGE);
        browser.openTab(PAGE, { active: false });
        await flush();
        assert.deepEqual(browser.actions, []);
    });
});

describe('auto switch', () => {
    it('switches to the existing tab when a new foreground tab opens the same page', async () => {
        const { browser, ids: [original] } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        const duplicate = browser.openTab(PAGE);
        await flush();
        assert.deepEqual(browser.actions, [['activate', original], ['remove', duplicate]]);
    });

    it('leaves tabs opened in the background (Ctrl+click, middle click) alone', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        browser.openTab(PAGE, { active: false });
        await flush();
        assert.deepEqual(browser.actions, []);
    });

    it('keeps new tab pages (Ctrl+T, Ctrl+N)', async () => {
        const { browser } = await startWorker({ tabs: ['chrome://newtab/', 'about:blank'], ...AUTO_SWITCH });
        browser.openTab('chrome://newtab/');
        browser.openTab('about:blank');
        await flush();
        assert.deepEqual(browser.actions, []);
    });

    it('catches an address typed in a new tab page', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        const tab = browser.openTab('chrome://newtab/');
        browser.finishLoading(tab);
        await flush();
        browser.navigate(tab, PAGE);
        await flush();
        assert.equal(browser.hasTab(tab), false);
    });

    it('catches a new tab redirected to an open page', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        const tab = browser.openTab('https://short.link/x');
        await flush();
        browser.navigate(tab, PAGE);
        await flush();
        assert.equal(browser.hasTab(tab), false);
    });

    it('never closes an existing tab that navigates', async () => {
        const { browser, ids: [, other] } = await startWorker({ tabs: [PAGE, OTHER_PAGE], ...AUTO_SWITCH });
        browser.navigate(other, PAGE);
        await flush();
        assert.equal(browser.hasTab(other), true);
    });

    it('never closes a new tab once its first page has loaded', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        const tab = browser.openTab(OTHER_PAGE);
        browser.finishLoading(tab);
        await flush();
        browser.navigate(tab, PAGE);
        await flush();
        assert.equal(browser.hasTab(tab), true);
    });

    it('closes only the second of two new tabs opened on the same page', async () => {
        const { browser } = await startWorker(AUTO_SWITCH);
        const first = browser.openTab(PAGE);
        const second = browser.openTab(PAGE);
        await flush();
        assert.equal(browser.hasTab(first), true);
        assert.equal(browser.hasTab(second), false);
    });

    it('ignores popup windows', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        browser.openTab(PAGE, { windowId: POPUP_WINDOW });
        await flush();
        assert.deepEqual(browser.actions, []);
    });

    it('keeps incognito and normal tabs apart', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        browser.openTab(PAGE, { incognito: true });
        await flush();
        assert.deepEqual(browser.actions, []);
    });

    it('leaves tabs restored at browser startup alone', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], ...AUTO_SWITCH });
        browser.chrome.runtime.onStartup.fire();
        browser.openTab(PAGE);
        await flush();
        assert.deepEqual(browser.actions, []);
    });

    it('does nothing while paused, even after a worker restart', async () => {
        const { browser } = await startWorker({ tabs: [PAGE], session: { paused: true }, ...AUTO_SWITCH });
        assert.equal(browser.icon, 'icons/icon16-paused.png');
        browser.openTab(PAGE);
        await flush();
        assert.deepEqual(browser.actions, []);
    });

    it('remembers new tabs across worker restarts', async () => {
        const browser = createFakeBrowser(AUTO_SWITCH);
        browser.existingTab(PAGE);
        const tab = browser.existingTab('chrome://newtab/', { active: true });
        // Saved by the previous worker before Chrome stopped it.
        browser.chrome.storage.session.data.newTabs = [tab];
        globalThis.chrome = browser.chrome;
        await import(`../src/background.js?instance=${instance++}`);
        browser.navigate(tab, PAGE);
        await flush();
        assert.equal(browser.hasTab(tab), false);
    });
});
