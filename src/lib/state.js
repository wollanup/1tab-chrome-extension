/**
 * Storage layout shared by the service worker and the extension pages.
 *
 * - `chrome.storage.local`   user settings, kept across browser restarts.
 * - `chrome.storage.session` runtime state (pause). It survives the service
 *   worker being stopped by Chrome, and is cleared when the browser restarts.
 */
import { DEFAULT_MATCH_MODE, toMatchMode } from './normalize.js';

/**
 * @typedef {object} Settings
 * @property {import('./normalize.js').MatchMode} matchMode
 * @property {boolean} autoSwitch  close a new foreground tab and switch to the existing one
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
    matchMode : DEFAULT_MATCH_MODE,
    autoSwitch: false
};

/** @returns {Promise<Settings>} */
export async function getSettings () {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    return {
        matchMode : toMatchMode(settings.matchMode),
        autoSwitch: !!settings.autoSwitch
    };
}

/** @param {Partial<Settings>} settings */
export function saveSettings (settings) {
    return chrome.storage.local.set(settings);
}

/** @returns {Promise<boolean>} */
export async function isPaused () {
    const { paused } = await chrome.storage.session.get({ paused: false });
    return !!paused;
}

/** @param {boolean} paused */
export function setPaused (paused) {
    return chrome.storage.session.set({ paused });
}
