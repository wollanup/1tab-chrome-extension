# Privacy policy

1Tab does not collect, store remotely, sell or share any personal data.

## What the extension accesses

- **Tabs** (`tabs` permission): the URL, title and state of your open tabs, to find tabs showing the same page, show the badge and list duplicates in the popup.
- **Storage** (`storage` permission): your settings (detection mode, automatic switch) and the pause state, kept in your browser.
- **Favicons** (`favicon` permission): the icons of the sites listed in the popup, read from the browser's own favicon cache.

## What it does with it

Everything happens locally, in your browser. The extension makes no network request: no analytics, no tracking, no remote server.

The settings are stored with `chrome.storage.local`; the pause state with `chrome.storage.session`, which is cleared when the browser restarts. Uninstalling the extension deletes them.

## Contact

Questions: open an issue on [GitHub](https://github.com/wollanup/1tab-chrome-extension/issues).
