/**
 * Minimal in-memory fake of the chrome.* APIs used by the service worker, with
 * helpers that fire events the way the browser does.
 */

const event = () => {
    const listeners = [];
    return {
        addListener: (l) => listeners.push(l),
        fire: (...args) => listeners.forEach((l) => l(...args))
    };
};

const storageArea = (data) => ({
    data,
    onChanged: event(),
    async get (keys) {
        if (typeof keys === 'string') {
            return keys in data ? { [keys]: data[keys] } : {};
        }
        const out = { ...keys };
        for (const k in keys) {
            if (k in data) {
                out[k] = data[k];
            }
        }
        return out;
    },
    async set (obj) {
        const changes = {};
        for (const k in obj) {
            changes[k] = { oldValue: data[k], newValue: obj[k] };
            data[k] = obj[k];
        }
        this.onChanged.fire(changes);
    },
    async remove (keys) {
        [].concat(keys).forEach((k) => delete data[k]);
    }
});

export const NORMAL_WINDOW = 1;
export const POPUP_WINDOW = 2;

export function createFakeBrowser ({ session = {}, settings = {} } = {}) {
    let nextId = 100;
    const tabs = new Map();
    const windows = [
        { id: NORMAL_WINDOW, type: 'normal' },
        { id: POPUP_WINDOW, type: 'popup' }
    ];
    /** Actions performed by the extension, e.g. ['remove', 101]. */
    const actions = [];
    let icon;
    /** Badge text per tab id. */
    const badges = new Map();

    const chrome = {
        runtime: { onInstalled: event(), onStartup: event() },
        action: {
            setIcon: async ({ path }) => { icon = path[16]; },
            setBadgeText: async ({ tabId, text }) => {
                if (!tabs.has(tabId)) {
                    throw new Error(`No tab with id: ${tabId}`);
                }
                badges.set(tabId, text);
            },
            setTitle: async () => {},
            setBadgeBackgroundColor: async () => {},
            setBadgeTextColor: async () => {}
        },
        i18n: {
            getMessage: (key, args = []) => [key, ...args].join(' ')
        },
        storage: {
            local: storageArea({ matchMode: 'exact', autoSwitch: false, ...settings }),
            session: storageArea({ ...session })
        },
        windows: {
            getAll: async ({ windowTypes }) => windows
                .filter((w) => windowTypes.includes(w.type))
                .map((w) => ({ ...w, tabs: [...tabs.values()].filter((t) => t.windowId === w.id).map((t) => ({ ...t })) })),
            update: async (id) => { actions.push(['focusWindow', id]); }
        },
        tabs: {
            onCreated: event(),
            onUpdated: event(),
            onRemoved: event(),
            onReplaced: event(),
            onAttached: event(),
            query: async () => [...tabs.values()].map((t) => ({ ...t })),
            get: async (id) => {
                if (!tabs.has(id)) {
                    throw new Error(`No tab with id: ${id}`);
                }
                return { ...tabs.get(id) };
            },
            update: async (id) => { actions.push(['activate', id]); },
            remove: async (id) => {
                actions.push(['remove', id]);
                tabs.delete(id);
                chrome.tabs.onRemoved.fire(id);
            }
        }
    };

    const addTab = (props) => {
        const tab = { id: nextId++, windowId: NORMAL_WINDOW, incognito: false, active: false, status: 'complete', url: '', ...props };
        tabs.set(tab.id, tab);
        return tab;
    };

    return {
        chrome,
        actions,
        get icon () { return icon; },
        badge: (id) => badges.get(id) ?? '',
        hasTab: (id) => tabs.has(id),

        /** A tab that already exists when the worker starts. */
        existingTab: (url, props) => addTab({ url, ...props }).id,

        /** The user opens a new tab on `url`. */
        openTab (url, props) {
            const tab = addTab({ active: true, status: 'loading', pendingUrl: url, ...props });
            chrome.tabs.onCreated.fire({ ...tab });
            return tab.id;
        },

        /** The tab navigates (link, typed URL, redirect…). */
        navigate (id, url) {
            const tab = tabs.get(id);
            Object.assign(tab, { url, pendingUrl: undefined, status: 'loading' });
            chrome.tabs.onUpdated.fire(id, { url, status: 'loading' }, { ...tab });
        },

        /** The tab finishes loading. */
        finishLoading (id) {
            const tab = tabs.get(id);
            if (tab.pendingUrl) {
                Object.assign(tab, { url: tab.pendingUrl, pendingUrl: undefined });
                chrome.tabs.onUpdated.fire(id, { url: tab.url }, { ...tab });
            }
            tab.status = 'complete';
            chrome.tabs.onUpdated.fire(id, { status: 'complete' }, { ...tab });
        }
    };
}

/** Lets the worker's queued async handlers run. */
export const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the debounced badge refresh. */
export const flushBadges = () => flush(250);
