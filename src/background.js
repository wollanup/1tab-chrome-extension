// background.js - version with background-tab handling
const DEFAULTS = {
    matchMode: 'exact',
    debug    : false,
    debugLogs: []
};
const MAX_LOGS = 200;

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

// util pour normaliser selon le mode choisi
function normalize (url, mode) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./i, '').toLowerCase();
        if (mode === 'domain') {
            return host;
        }
        if (mode === 'path') {
            const p = u.pathname.replace(/\/+$/, '') || '/';
            return `${host}${p}`.toLowerCase();
        }
        // exact: origin + pathname + search (sans fragment)
        let s = u.origin + (u.pathname || '/');
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
                            newTabActive: !!(tab && tab.active)
                        });
                    }

                    if (tab && tab.active) {
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
