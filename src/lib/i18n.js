/**
 * Translates extension pages: every element with `data-i18n="key"` gets the
 * message as text, with optional comma-separated `data-i18n-args`.
 */

/**
 * @param {ParentNode} [root]
 */
export function translatePage (root = document) {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    for (const el of root.querySelectorAll('[data-i18n]')) {
        const args = el.getAttribute('data-i18n-args')?.split(',');
        const message = chrome.i18n.getMessage(el.getAttribute('data-i18n'), args);
        if (message) {
            el.textContent = message;
        }
    }
}

/**
 * Picks `<key>_one`, `<key>_other`… according to the UI language plural rules.
 *
 * @param {string} key
 * @param {number} count
 * @returns {string}
 */
export function pluralMessage (key, count) {
    const category = new Intl.PluralRules(chrome.i18n.getUILanguage()).select(count);
    return chrome.i18n.getMessage(`${key}_${category}`, [String(count)])
        || chrome.i18n.getMessage(`${key}_other`, [String(count)]);
}
