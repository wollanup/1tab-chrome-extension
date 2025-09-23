const DEFAULTS = { matchMode: 'exact', debug: false, debugLogs: [] };
const MAX_LOGS = 200;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['matchMode','debug'], (s) => {
    const init = {};
    if (s.matchMode === undefined) init.matchMode = DEFAULTS.matchMode;
    if (s.debug === undefined) init.debug = DEFAULTS.debug;
    if (Object.keys(init).length) chrome.storage.local.set(init);
  });
});

// util pour normaliser selon le mode choisi
function normalize(url, mode) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (mode === 'domain') return host;
    if (mode === 'path') {
      const p = u.pathname.replace(/\/+$/, '') || '/';
      return `${host}${p}`.toLowerCase();
    }
    // exact: origin + pathname + search (sans fragment)
    let s = u.origin + (u.pathname || '/');
    if (u.search) s += u.search;
    return s.toLowerCase();
  } catch (e) {
    // url non-std (chrome://, about:blank...) -> retourne en l'état
    return (url || '').toString();
  }
}

function logDebug(entry) {
  entry.ts = new Date().toISOString();
  chrome.storage.local.get({ debugLogs: [] }, (res) => {
    const arr = res.debugLogs || [];
    arr.unshift(entry);
    if (arr.length > MAX_LOGS) arr.splice(MAX_LOGS);
    chrome.storage.local.set({ debugLogs: arr });
  });
  console.log('[PreventDuplicateTabs]', entry);
}

// quand un onglet change d'URL (c'est le meilleur moment pour détecter la cible finale)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return; // on s'intéresse qu'aux navigations avec URL
  chrome.storage.local.get({ matchMode: DEFAULTS.matchMode, debug: DEFAULTS.debug }, (opts) => {
    const mode = opts.matchMode || DEFAULTS.matchMode;
    const debug = !!opts.debug;
    const newNorm = normalize(changeInfo.url, mode);

    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        if (!t || t.id === tabId) continue;
        const targetUrl = t.url || t.pendingUrl;
        if (!targetUrl) continue;
        const tNorm = normalize(targetUrl, mode);
        if (tNorm === newNorm) {
          // trouvé : on focalise l'existant et on ferme le doublon
          if (debug) logDebug({ event: 'duplicate-detected', newTabId: tabId, keptTabId: t.id, url: changeInfo.url, mode });

          chrome.windows.update(t.windowId, { focused: true }, () => {
            chrome.tabs.update(t.id, { active: true }, () => {
              // ferme l'onglet doublon (silent)
              chrome.tabs.remove(tabId, () => {
                if (chrome.runtime.lastError && debug) {
                  logDebug({ event: 'error-closing', error: chrome.runtime.lastError.message, tabId });
                } else if (debug) {
                  logDebug({ event: 'closed-duplicate', closedTabId: tabId, keptTabId: t.id });
                }
              });
            });
          });
          return;
        }
      }
      if (debug) logDebug({ event: 'no-duplicate-found', tabId, url: changeInfo.url, mode });
    });
  });
});

// bonus : on tente aussi sur creation si pendingUrl présent (cas où la créa porte déjà l'URL)
chrome.tabs.onCreated.addListener((tab) => {
  const url = tab.pendingUrl || tab.url;
  if (!url) return;
  chrome.storage.local.get({ matchMode: DEFAULTS.matchMode, debug: DEFAULTS.debug }, (opts) => {
    const mode = opts.matchMode || DEFAULTS.matchMode;
    const debug = !!opts.debug;
    const newNorm = normalize(url, mode);

    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        if (!t || t.id === tab.id) continue;
        const targetUrl = t.url || t.pendingUrl;
        if (!targetUrl) continue;
        if (normalize(targetUrl, mode) === newNorm) {
          if (debug) logDebug({ event: 'duplicate-on-created', newTabId: tab.id, keptTabId: t.id, url, mode });
          chrome.windows.update(t.windowId, { focused: true }, () => {
            chrome.tabs.update(t.id, { active: true }, () => {
              chrome.tabs.remove(tab.id);
            });
          });
          return;
        }
      }
    });
  });
});

