// background.js - version with background-tab handling
const DEFAULTS = {
    matchMode: 'path', // Défaut : mode path
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
 * Normalise une URL selon le mode choisi pour la détection des doublons.
 *
 * Modes disponibles :
 * - 'domain' : Se base sur le domaine racine (sans sous-domaine).
 * - 'path' : hôte + chemin .
 * - 'exact' : hôte + chemin + paramètres (?query), sans fragment (#hash).
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
        // exact: origin + pathname + search (sans fragment)
        let s = host + path;
        if (u.search) {
            s += u.search;
        }
        return s.toLowerCase();
    }
    catch (e) {
        // url non-std (chrome://, about:blank...) -> retourne en l'état
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

// quand un onglet change d'URL (c'est le meilleur moment pour détecter la cible finale)
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
                    // trouvé : gérer selon si le nouvel onglet est actif ou en background
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
                        // si le nouvel onglet est actif -> focaliser l'existant puis fermer le doublon
                        chrome.windows.update(t.windowId, { focused: true }, () => {
                            chrome.tabs.update(t.id, { active: true }, () => {
                                safeRemoveTab(tabId, debug, 'closed-duplicate');
                            });
                        });
                    }
                    else {
                        // nouvel onglet en arrière-plan -> fermer juste le doublon sans activer l'existant
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

// bonus : on tente aussi sur creation si pendingUrl présent (cas où la créa porte déjà l'URL)
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
                        // Onglet doublon actif -> focus l'existant puis fermer
                        chrome.windows.update(t.windowId, { focused: true }, () => {
                            chrome.tabs.update(t.id, { active: true }, () => {
                                safeRemoveTab(tab.id, debug, 'closed-duplicate');
                            });
                        });
                    }
                    else {
                        // Onglet doublon en arrière-plan -> fermer juste sans activer l'existant
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
