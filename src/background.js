// background.js - version with background-tab handling
const DEFAULTS = {
    matchMode: 'path', // Default: path mode
    debug    : false,
    debugLogs: []
};
const MAX_LOGS = 200;

// --- Counters for stats ---
let totalTabsOpened = 0;
let duplicateTabsPrevented = 0;
let extensionPaused = false;

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['matchMode', 'debug'], (s) => {
        const init = {};
        if (s.matchMode === undefined) {
            init.matchMode = DEFAULTS.matchMode;
        }
        if (s.debug === undefined) {
            init.debug = DEFAULTS.debug;
        }
        if (Object.keys(init).length) {
            chrome.storage.local.set(init);
        }
    });
});

/**
 * Normalizes a URL according to the selected duplicate detection mode.
 *
 * Available modes:
 * - 'domain': Based on the root domain (without subdomain).
 * - 'path': host + path.
 * - 'exact': host + path + parameters (?query), without fragment (#hash).
 *
 */
function normalize (url, mode) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (mode === 'domain') {
            return host;
        }
        const path = u.pathname.replace(/\/+$/, '').toLowerCase() || '/';
        if (mode === 'path') {
            return `${host}${path}`.toLowerCase();
        }
        // exact: origin + pathname + search (without fragment)
        let s = host + path;
        if (u.search) {
            s += u.search;
        }
        return s.toLowerCase();
    }
    catch (e) {
        // non-standard url (chrome://, about:blank...) -> return as is
        return (url || '').toString();
    }
}

function logDebug (entry) {
    entry.ts = new Date().toISOString();
    chrome.storage.local.get({ debugLogs: [] }, (res) => {
        const arr = res.debugLogs || [];
        arr.unshift(entry);
        if (arr.length > MAX_LOGS) {
            arr.splice(MAX_LOGS);
        }
        chrome.storage.local.set({ debugLogs: arr });
    });
    console.log('[PreventDuplicateTabs]', entry);
}

// Helper: close a tab and optionally log result
function safeRemoveTab (tabId, debug, logOnSuccessEvent) {
    chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
            if (debug) {
                logDebug({
                    event: 'error-closing',
                    error: chrome.runtime.lastError.message,
                    tabId
                });
            }
        }
        else {
            duplicateTabsPrevented++;
            if (debug && logOnSuccessEvent) {
                logDebug({
                    event      : logOnSuccessEvent,
                    closedTabId: tabId
                });
            }
        }
    });
}

// when a tab changes its URL (this is the best moment to detect the final target)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (extensionPaused) return;
    // only care when there is a navigated-to URL
    if (!changeInfo.url) {
        return;
    }

    chrome.storage.local.get({
        matchMode: DEFAULTS.matchMode,
        debug    : DEFAULTS.debug
    }, (opts) => {
        const mode = opts.matchMode || DEFAULTS.matchMode;
        const debug = !!opts.debug;
        const newNorm = normalize(changeInfo.url, mode);

        chrome.tabs.query({}, (tabs) => {
            for (const t of tabs) {
                if (!t || t.id === tabId) {
                    continue;
                }
                const targetUrl = t.url || t.pendingUrl;
                if (!targetUrl) {
                    continue;
                }
                const tNorm = normalize(targetUrl, mode);
                if (tNorm === newNorm) {
                    // found: handle depending on whether the new tab is active or in background
                    if (debug) {
                        logDebug({
                            event       : 'duplicate-detected',
                            newTabId    : tabId,
                            keptTabId   : t.id,
                            url         : changeInfo.url,
                            mode,
                            newTabActive: !!(tab?.active)
                        });
                    }

                    if (tab?.active) {
                        // if the new tab is active -> focus the existing one then close the duplicate
                        chrome.windows.update(t.windowId, { focused: true }, () => {
                            chrome.tabs.update(t.id, { active: true }, () => {
                                safeRemoveTab(tabId, debug, 'closed-duplicate');
                            });
                        });
                    }
                    else {
                        // new tab in background -> just close the duplicate without activating the existing one
                        safeRemoveTab(tabId, debug, 'closed-background-duplicate');
                    }

                    return; // stop loop
                }
            }
            if (debug) {
                logDebug({
                    event: 'no-duplicate-found',
                    tabId,
                    url  : changeInfo.url,
                    mode
                });
            }
        });
    });
});

// bonus: also try on creation if pendingUrl is present (case where creation already has the URL)
chrome.tabs.onCreated.addListener((tab) => {
    if (extensionPaused) return;
    totalTabsOpened++
    const url = tab.pendingUrl || tab.url;
    if (!url) {
        return;
    }

    chrome.storage.local.get({
        matchMode: DEFAULTS.matchMode,
        debug    : DEFAULTS.debug
    }, (opts) => {
        const mode = opts.matchMode || DEFAULTS.matchMode;
        const debug = !!opts.debug;
        const newNorm = normalize(url, mode);

        chrome.tabs.query({}, (tabs) => {
            for (const t of tabs) {
                if (!t || t.id === tab.id) {
                    continue;
                }
                const targetUrl = t.url || t.pendingUrl;
                if (!targetUrl) {
                    continue;
                }
                if (normalize(targetUrl, mode) === newNorm) {
                    if (debug) {
                        logDebug({
                            event       : 'duplicate-on-created',
                            newTabId    : tab.id,
                            keptTabId   : t.id,
                            url,
                            mode,
                            newTabActive: !!tab.active
                        });
                    }

                    if (tab.active) {
                        // Active duplicate tab -> focus the existing one then close
                        chrome.windows.update(t.windowId, { focused: true }, () => {
                            chrome.tabs.update(t.id, { active: true }, () => {
                                safeRemoveTab(tab.id, debug, 'closed-duplicate');
                            });
                        });
                    }
                    else {
                        // Duplicate tab in background -> just close without activating the existing one
                        safeRemoveTab(tab.id, debug, 'closed-background-duplicate');
                    }
                    return;
                }
            }
        });
    });
});

function setExtensionIcon(paused) {
  if (paused) {
    // SVG base64 for monochrome icon with orange pause (16px)
    chrome.action.setIcon({
      path: {
        "16": "icons/icon16-paused.png",
        "48": "icons/icon48-paused.png",
        "128": "icons/icon128-paused.png"
      }
    });
  } else {
    chrome.action.setIcon({
      path: {
        "16": "icons/icon16.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
      }
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'setPaused') {
        extensionPaused = !!msg.paused;
        setExtensionIcon(extensionPaused);
        return;
    }
    if (msg && msg.type === 'getPaused') {
        sendResponse({ paused: extensionPaused });
        return;
    }
    if (msg && msg.type === 'getStats') {
        sendResponse({
            totalTabsOpened,
            duplicateTabsPrevented
        });
    }
});
