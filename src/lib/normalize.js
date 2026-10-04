/**
 * URL normalization used to decide whether two tabs are duplicates.
 *
 * Pure module (no chrome.* API) so it can be unit-tested with Node.
 */

/** @typedef {'exact' | 'path' | 'domain'} MatchMode */

/** @type {readonly MatchMode[]} */
export const MATCH_MODES = ['exact', 'path', 'domain'];

/** @type {MatchMode} */
export const DEFAULT_MATCH_MODE = 'exact';

/** Query parameters that only carry tracking data and never change the page. */
const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid',
    'igshid', 'mc_cid', 'mc_eid', '_ga', '_gl', 'ref_src'
]);

const isTrackingParam = (name) => name.startsWith('utm_') || TRACKING_PARAMS.has(name);

/**
 * Only web pages take part in duplicate detection. Browser pages (new tab,
 * settings, extensions…), about:blank, file:, data: etc. are always ignored.
 *
 * @param {string | undefined} url
 * @returns {boolean}
 */
export function isComparableUrl (url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * @param {unknown} mode
 * @returns {MatchMode}
 */
export function toMatchMode (mode) {
    return MATCH_MODES.includes(/** @type {MatchMode} */ (mode)) ? /** @type {MatchMode} */ (mode) : DEFAULT_MATCH_MODE;
}

/**
 * Builds the comparison key of a URL for the given mode, or `null` when the URL
 * must not take part in duplicate detection.
 *
 * Common rules: the scheme (http/https) is ignored, the host is case-insensitive
 * and a leading `www.` is dropped, a non-default port is kept.
 *
 * - `domain`: host only.
 * - `path`:   host + path (trailing slashes ignored, case kept).
 * - `exact`:  host + path + query (tracking params removed, params sorted)
 *             + hash only when it looks like a client-side route (contains `/`).
 *
 * @param {string | undefined} url
 * @param {MatchMode} mode
 * @returns {string | null}
 */
export function normalizeUrl (url, mode) {
    if (!isComparableUrl(url)) {
        return null;
    }
    let u;
    try {
        u = new URL(/** @type {string} */ (url));
    }
    catch {
        return null;
    }

    // URL already lowercases the hostname and drops default ports.
    const host = u.host.replace(/^www\./, '');
    if (mode === 'domain') {
        return host;
    }

    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (mode === 'path') {
        return host + path;
    }

    const params = new URLSearchParams(u.search);
    for (const name of [...params.keys()]) {
        if (isTrackingParam(name)) {
            params.delete(name);
        }
    }
    params.sort();
    const query = params.size ? `?${params}` : '';
    const hash = u.hash.includes('/') ? u.hash : '';

    return host + path + query + hash;
}
