/**
 * 1Tab service worker.
 *
 * - Badge: every tab whose page is open in other tabs shows the number of
 *   copies on the extension icon. The popup lets the user clean them up.
 * - Auto switch (optional): a new tab opened in the foreground on a page that
 *   is already open is closed, and the existing tab is activated instead.
 *   Tabs opened in the background (Ctrl+click, middle click) are left alone.
 *
 * A tab is "new" from its creation until its first web page has finished
 * loading (redirects included): navigating inside an existing tab never closes it.
 *
 * Chrome stops this worker when idle, so nothing important lives only in memory:
 * the set of new tabs and the pause flag are kept in storage.session.
 */
import { findOriginal, groupDuplicates, tabUrl } from './lib/duplicates.js';
import { isComparableUrl, normalizeUrl } from './lib/normalize.js';
import { getSettings, isPaused } from './lib/state.js';

/** Tabs restored by the browser at startup are left alone during this delay. */
const STARTUP_GRACE_MS = 10_000;
const BADGE_REFRESH_DELAY_MS = 150;
const BADGE_COLOR = '#d97706';

const ICONS = {
    active: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    paused: { 16: 'icons/icon16-paused.png', 32: 'icons/icon32-paused.png', 48: 'icons/icon48-paused.png', 128: 'icons/icon128-paused.png' }
};

/** Ids of tabs that are still loading their first web page. */
const newTabs = new Set();
let ignoreTabsUntil = 0;

// Every tab event is handled in order, one at a time: this prevents two handlers
// from racing on the same tabs (e.g. two new tabs closing each other).
let queue = restoreState();

/** @param {() => Promise<unknown>} task */
function enqueue (task) {
    queue = queue.then(task).catch((error) => console.error('[1Tab]', error));
}

async function restoreState () {
    const { newTabs: saved } = await chrome.storage.session.get('newTabs');
    if (Array.isArray(saved)) {
        saved.forEach((id) => newTabs.add(id));
    }
    else {
        // First run since the browser or the extension started: every tab that
        // is not showing a web page yet (new tab page, about:blank…) is new.
        const tabs = await chrome.tabs.query({});
        tabs.filter((t) => !isComparableUrl(tabUrl(t))).forEach((t) => newTabs.add(t.id));
        await saveNewTabs();
    }
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    await updateIcon(await isPaused());
    scheduleBadgeRefresh();
}

function saveNewTabs () {
    return chrome.storage.session.set({ newTabs: [...newTabs] });
}

/** @param {boolean} paused */
function updateIcon (paused) {
    return chrome.action.setIcon({ path: paused ? ICONS.paused : ICONS.active });
}

// ---------- Badges ----------

/** Badge text currently shown per tab, to skip useless API calls. */
const badgeTexts = new Map();
let badgeTimer;

function scheduleBadgeRefresh () {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => refreshBadges().catch((error) => console.error('[1Tab]', error)), BADGE_REFRESH_DELAY_MS);
}

async function refreshBadges () {
    const [{ matchMode }, paused, windows] = await Promise.all([
        getSettings(),
        isPaused(),
        chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    ]);
    const tabs = windows.flatMap((w) => w.tabs ?? []);

    /** @type {Map<number, number>} */
    const copies = new Map();
    if (!paused) {
        for (const group of groupDuplicates(tabs, matchMode)) {
            group.forEach((t) => copies.set(t.id, group.length));
        }
    }
    await Promise.all(tabs.map((t) => setBadge(t.id, copies.get(t.id) ?? 0)));
}

/**
 * @param {number} tabId
 * @param {number} copies  number of tabs showing this page, 0 when not a duplicate
 */
async function setBadge (tabId, copies) {
    const text = copies ? String(copies) : '';
    if (badgeTexts.get(tabId) === text) {
        return;
    }
    badgeTexts.set(tabId, text);
    const title = copies
        ? chrome.i18n.getMessage('badgeTitle', [String(copies)])
        : chrome.i18n.getMessage('extName');
    await Promise.all([
        chrome.action.setBadgeText({ tabId, text }),
        chrome.action.setTitle({ tabId, title })
    ]).catch(() => badgeTexts.delete(tabId)); // tab closed in the meantime
}

// ---------- Auto switch ----------

/**
 * Closes a new foreground tab if its page is already open, and switches to the
 * existing tab.
 *
 * @param {number} tabId
 */
async function switchIfDuplicate (tabId) {
    if (Date.now() < ignoreTabsUntil || await isPaused()) {
        return;
    }
    const { matchMode, autoSwitch } = await getSettings();
    if (!autoSwitch) {
        return;
    }

    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    // Background tabs (Ctrl+click, middle click) are only flagged by the badge.
    if (!tab?.active || !isComparableUrl(tabUrl(tab))) {
        return;
    }

    // Popups, apps and devtools windows are never touched nor used as originals.
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    if (!windows.some((w) => w.id === tab.windowId)) {
        return;
    }

    const tabs = windows.flatMap((w) => w.tabs ?? []);
    const original = findOriginal(tab, tabs, matchMode, (id) => newTabs.has(id));
    if (!original) {
        return;
    }

    console.debug('[1Tab] switch to existing tab', { key: normalizeUrl(tabUrl(tab), matchMode), closed: tab.id, kept: original.id });
    await chrome.tabs.update(original.id, { active: true });
    if (original.windowId !== tab.windowId) {
        await chrome.windows.update(original.windowId, { focused: true });
    }
    await chrome.tabs.remove(tab.id);
}

/**
 * A tab stops being new once its first web page has finished loading.
 *
 * @param {number} tabId
 */
async function forgetIfLoaded (tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab?.status === 'complete' && isComparableUrl(tab.url)) {
        newTabs.delete(tabId);
        await saveNewTabs();
    }
}

// ---------- Events ----------

chrome.runtime.onInstalled.addListener(() => enqueue(async () => {
    // Writes the defaults of missing settings, and fixes invalid ones.
    await chrome.storage.local.set(await getSettings());
    // Leftovers from versions < 2.0.
    await chrome.storage.local.remove(['debug', 'debugLogs']);
}));

chrome.runtime.onStartup.addListener(() => {
    ignoreTabsUntil = Date.now() + STARTUP_GRACE_MS;
});

chrome.tabs.onCreated.addListener((tab) => {
    // Registered right away (not in the queue): a tab being checked must already
    // see the tabs opened just after it as new.
    newTabs.add(tab.id);
    scheduleBadgeRefresh();
    enqueue(async () => {
        await saveNewTabs();
        if (isComparableUrl(tabUrl(tab))) {
            await switchIfDuplicate(tab.id);
        }
    });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url && change.status !== 'complete') {
        return;
    }
    scheduleBadgeRefresh();
    enqueue(async () => {
        if (!newTabs.has(tabId)) {
            return;
        }
        if (change.url && isComparableUrl(change.url)) {
            await switchIfDuplicate(tabId);
        }
        if (change.status === 'complete') {
            await forgetIfLoaded(tabId);
        }
    });
});

// Chrome swaps in a prerendered tab when a URL typed in the omnibox was
// prerendered: no onCreated/onUpdated is fired for it.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    scheduleBadgeRefresh();
    enqueue(async () => {
        if (!newTabs.delete(removedTabId)) {
            return;
        }
        newTabs.add(addedTabId);
        await saveNewTabs();
        await switchIfDuplicate(addedTabId);
        await forgetIfLoaded(addedTabId);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    badgeTexts.delete(tabId);
    scheduleBadgeRefresh();
    enqueue(async () => {
        if (newTabs.delete(tabId)) {
            await saveNewTabs();
        }
    });
});

// A tab moved between a popup window and a normal window.
chrome.tabs.onAttached.addListener(scheduleBadgeRefresh);

chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.paused) {
        updateIcon(!!changes.paused.newValue);
        scheduleBadgeRefresh();
    }
});

chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.matchMode) {
        scheduleBadgeRefresh();
    }
});
