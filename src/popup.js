import { findOriginal, groupDuplicates, pickTabToKeep, tabsToClose, tabUrl } from './lib/duplicates.js';
import { pluralMessage, translatePage } from './lib/i18n.js';
import { normalizeUrl } from './lib/normalize.js';
import { getSettings, isPaused, saveSettings, setPaused } from './lib/state.js';

const $ = (id) => document.getElementById(id);
const msg = (key, args) => chrome.i18n.getMessage(key, args);

const modeSelect = /** @type {HTMLSelectElement} */ ($('mode'));
const autoSwitchBox = /** @type {HTMLInputElement} */ ($('autoSwitch'));
const groupTemplate = /** @type {HTMLTemplateElement} */ ($('groupTemplate'));
const tabTemplate = /** @type {HTMLTemplateElement} */ ($('tabTemplate'));

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

/** Tabs of normal windows (popup, app and devtools windows are ignored). */
async function loadTabs () {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    return windows.flatMap((w) => w.tabs ?? []);
}

/**
 * Activates a tab and focuses its window. Not awaited on purpose: the popup is
 * closed as soon as the browser window changes.
 *
 * @param {chrome.tabs.Tab} tab
 */
function focusTab (tab) {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
}

/** @param {number[]} tabIds */
async function closeTabs (tabIds) {
    await chrome.tabs.remove(tabIds);
    await render();
}

/** @param {string} pageUrl */
function faviconUrl (pageUrl) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '32');
    return url.href;
}

/** Groups unfolded by the user, by group key; kept across re-renders. */
const expandedGroups = new Set();

/**
 * @param {Element} button
 * @param {string} label
 */
function setLabel (button, label) {
    button.title = label;
    button.setAttribute('aria-label', label);
}

/**
 * One row per tab of an unfolded group.
 *
 * @param {chrome.tabs.Tab} tab
 * @param {boolean} kept  the tab kept when closing the copies
 */
function renderGroupTab (tab, kept) {
    const item = /** @type {HTMLElement} */ (tabTemplate.content.firstElementChild.cloneNode(true));
    const url = tabUrl(tab);
    const link = item.querySelector('.group-tab-link');
    link.title = url;
    link.addEventListener('click', () => {
        focusTab(tab);
        window.close();
    });
    item.querySelector('.group-tab-title').textContent = tab.title || url;
    item.querySelector('.group-tab-url').textContent = url.replace(/^https?:\/\/(www\.)?/, '');

    const keptTag = item.querySelector('.kept-tag');
    keptTag.hidden = !kept;
    keptTag.textContent = msg('keptTag');

    const close = item.querySelector('.tab-close');
    setLabel(close, msg('closeTab'));
    close.addEventListener('click', () => closeTabs([tab.id]));
    return item;
}

/**
 * @param {chrome.tabs.Tab[]} group
 * @param {import('./lib/normalize.js').MatchMode} matchMode
 */
function renderGroup (group, matchMode) {
    const keep = pickTabToKeep(group, activeTab?.id);
    const closable = tabsToClose(group, activeTab?.id);
    const item = /** @type {HTMLElement} */ (groupTemplate.content.firstElementChild.cloneNode(true));
    const link = item.querySelector('.group-link');
    const title = item.querySelector('.group-title');

    item.querySelector('.favicon').src = faviconUrl(tabUrl(keep));
    item.querySelector('.group-count').textContent = `×${group.length}`;

    if (matchMode === 'exact') {
        // Copies of the same page: the row leads to the tab that would be kept.
        title.textContent = keep.title || tabUrl(keep);
        link.title = tabUrl(keep);
        link.addEventListener('click', () => {
            focusTab(keep);
            window.close();
        });
    }
    else {
        // Different pages of the same host (or path): the row unfolds the list.
        const key = normalizeUrl(tabUrl(keep), matchMode);
        const groupKey = `${keep.incognito} ${key}`;
        const tabList = item.querySelector('.group-tabs');
        const others = group.filter((t) => t !== keep).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
        tabList.replaceChildren(renderGroupTab(keep, true), ...others.map((t) => renderGroupTab(t, false)));

        title.textContent = key;
        item.querySelector('.chevron').removeAttribute('hidden'); // SVG: no .hidden property
        const setExpanded = (expanded) => {
            item.classList.toggle('is-expanded', expanded);
            link.setAttribute('aria-expanded', String(expanded));
            tabList.hidden = !expanded;
        };
        setExpanded(expandedGroups.has(groupKey));
        link.addEventListener('click', () => {
            const expanded = !expandedGroups.delete(groupKey);
            if (expanded) {
                expandedGroups.add(groupKey);
            }
            setExpanded(expanded);
        });
    }

    const close = item.querySelector('.group-close');
    close.hidden = closable.length === 0;
    setLabel(close, msg('closeCopies'));
    close.addEventListener('click', () => closeTabs(closable.map((t) => t.id)));
    return item;
}

async function render () {
    const [{ matchMode, autoSwitch }, paused, tabs] = await Promise.all([getSettings(), isPaused(), loadTabs()]);
    const groups = groupDuplicates(tabs, matchMode);

    // The current page has copies in other tabs.
    const current = tabs.find((t) => t.id === activeTab?.id);
    const currentGroup = current && groups.find((g) => g.includes(current));
    $('current').hidden = !currentGroup;
    if (currentGroup) {
        const other = findOriginal(current, currentGroup, matchMode, () => false);
        // In host modes, the other tabs show different pages of the same site.
        $('currentText').textContent = pluralMessage(matchMode === 'exact' ? 'currentDuplicated' : 'currentMatches', currentGroup.length - 1);
        $('goToOther').onclick = () => {
            focusTab(other);
            window.close();
        };
        $('closeCurrent').onclick = () => {
            focusTab(other);
            chrome.tabs.remove(current.id);
            window.close();
        };
    }

    // All duplicates.
    const closable = groups.flatMap((g) => tabsToClose(g, activeTab?.id));
    $('groups').replaceChildren(...groups.map((g) => renderGroup(g, matchMode)));
    $('noDuplicates').hidden = groups.length > 0;
    $('closeAll').hidden = closable.length === 0;
    $('closeAll').textContent = msg('closeAll', [String(closable.length)]);
    $('closeAll').onclick = () => closeTabs(closable.map((t) => t.id));

    // Settings.
    modeSelect.value = matchMode;
    autoSwitchBox.checked = autoSwitch;
    document.body.classList.toggle('is-paused', paused);
    $('pauseBtn').setAttribute('aria-pressed', String(paused));
    $('pauseLabel').textContent = msg(paused ? 'resume' : 'pause');
}

translatePage();

// The settings section remembers whether it was left open (convenience only).
const settings = /** @type {HTMLDetailsElement} */ ($('settings'));
try {
    settings.open = localStorage.getItem('settingsOpen') === 'true';
}
catch {
    // storage unavailable: keep it closed
}
settings.addEventListener('toggle', () => {
    try {
        localStorage.setItem('settingsOpen', String(settings.open));
    }
    catch {
        // ignore
    }
});

modeSelect.addEventListener('change', () => saveSettings({ matchMode: /** @type {any} */ (modeSelect.value) }));
autoSwitchBox.addEventListener('change', () => saveSettings({ autoSwitch: autoSwitchBox.checked }));
$('pauseBtn').addEventListener('click', async () => setPaused(!await isPaused()));

chrome.storage.onChanged.addListener((changes) => {
    if (changes.paused || changes.matchMode || changes.autoSwitch) {
        render();
    }
});
chrome.tabs.onRemoved.addListener(() => render());
chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url || change.title) {
        render();
    }
});

await render();
