/**
 * Duplicate lookup. Pure module (no chrome.* API) so it can be unit-tested with Node.
 */
import { normalizeUrl } from './normalize.js';

/**
 * The subset of chrome.tabs.Tab used here.
 *
 * @typedef {object} TabLike
 * @property {number} id
 * @property {number} windowId
 * @property {boolean} incognito
 * @property {string} [url]
 * @property {string} [pendingUrl]
 * @property {number} [lastAccessed]
 * @property {boolean} [pinned]
 */

/**
 * URL a tab is showing or about to show. While a tab is loading, `url` may still
 * hold the previous page, so `pendingUrl` wins.
 *
 * @param {Pick<TabLike, 'url' | 'pendingUrl'>} tab
 * @returns {string | undefined}
 */
export const tabUrl = (tab) => tab.pendingUrl || tab.url;

/**
 * Finds the tab that `candidate` duplicates, if any.
 *
 * When two new tabs point to the same page (e.g. a restored group of bookmarks),
 * only the most recent one (higher id) is considered a duplicate, so both are
 * never closed.
 *
 * @param {TabLike} candidate         the newly opened tab
 * @param {TabLike[]} tabs            tabs to compare with (may include the candidate)
 * @param {import('./normalize.js').MatchMode} mode
 * @param {(tabId: number) => boolean} isNewTab  whether a tab is still loading its first page
 * @returns {TabLike | undefined}
 */
export function findOriginal (candidate, tabs, mode, isNewTab) {
    const key = normalizeUrl(tabUrl(candidate), mode);
    if (key === null) {
        return undefined;
    }

    const matches = tabs.filter((t) =>
        t.id !== candidate.id
        && t.incognito === candidate.incognito
        && !(isNewTab(t.id) && t.id > candidate.id)
        && normalizeUrl(tabUrl(t), mode) === key
    );

    // Prefer a tab in the same window, then the most recently used one.
    matches.sort((a, b) =>
        Number(b.windowId === candidate.windowId) - Number(a.windowId === candidate.windowId)
        || byMostRecent(a, b)
    );
    return matches[0];
}

/**
 * Groups tabs showing the same page. Only groups of 2 tabs or more are returned.
 * Incognito and normal tabs are never grouped together.
 *
 * @template {TabLike} T
 * @param {T[]} tabs
 * @param {import('./normalize.js').MatchMode} mode
 * @returns {T[][]}
 */
export function groupDuplicates (tabs, mode) {
    /** @type {Map<string, T[]>} */
    const groups = new Map();
    for (const tab of tabs) {
        const key = normalizeUrl(tabUrl(tab), mode);
        if (key === null) {
            continue;
        }
        const groupKey = `${tab.incognito ? 'incognito' : 'normal'} ${key}`;
        const group = groups.get(groupKey);
        if (group) {
            group.push(tab);
        }
        else {
            groups.set(groupKey, [tab]);
        }
    }
    return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * The tab to keep when cleaning a group: the given active tab if it belongs to
 * the group, then a pinned tab, then the most recently used one.
 *
 * @template {TabLike} T
 * @param {T[]} group
 * @param {number} [activeTabId]
 * @returns {T}
 */
export function pickTabToKeep (group, activeTabId) {
    return [...group].sort((a, b) =>
        Number(b.id === activeTabId) - Number(a.id === activeTabId)
        || Number(!!b.pinned) - Number(!!a.pinned)
        || byMostRecent(a, b)
    )[0];
}

/**
 * Tabs of the group that can be closed: all but the one to keep, pinned tabs excepted.
 *
 * @template {TabLike} T
 * @param {T[]} group
 * @param {number} [activeTabId]
 * @returns {T[]}
 */
export function tabsToClose (group, activeTabId) {
    const keep = pickTabToKeep(group, activeTabId);
    return group.filter((t) => t !== keep && !t.pinned);
}

/** @param {TabLike} a @param {TabLike} b */
function byMostRecent (a, b) {
    return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.id - b.id;
}
