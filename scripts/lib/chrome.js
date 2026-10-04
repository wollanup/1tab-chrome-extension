/**
 * Launches a throwaway Chrome profile driven through the DevTools protocol over
 * a pipe, with the extension loaded. Used by the e2e tests and the media scripts.
 *
 * Branded Chrome ignores --load-extension since Chrome 137, so the extension is
 * loaded with the CDP command Extensions.loadUnpacked, which requires
 * --remote-debugging-pipe and --enable-unsafe-extension-debugging.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const EXTENSION_DIR = resolve(fileURLToPath(import.meta.url), '../../../src');

const CANDIDATES = {
    win32 : [
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
};

/** @returns {string | undefined} */
export function findChrome () {
    return [process.env.CHROME_PATH, ...(CANDIDATES[process.platform] ?? [])].find((p) => p && existsSync(p));
}

/**
 * @param {object} [options]
 * @param {string} [options.lang]        UI language, e.g. 'en' or 'fr'
 * @param {boolean} [options.extension]  load the extension (default true)
 */
export async function launchChrome ({ lang = 'en', extension = true } = {}) {
    const executable = findChrome();
    if (!executable) {
        throw new Error('Chrome not found: set CHROME_PATH');
    }
    const profile = mkdtempSync(join(tmpdir(), '1tab-chrome-'));
    const args = [
        '--headless=new',
        '--remote-debugging-pipe',
        '--enable-unsafe-extension-debugging',
        `--user-data-dir=${profile}`,
        `--lang=${lang}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
        '--hide-scrollbars',
        ...(process.env.CI ? ['--no-sandbox'] : []),
        'about:blank'
    ];
    const child = spawn(executable, args, {
        stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
        env  : { ...process.env, LANGUAGE: lang }
    });

    const cdp = createConnection(/** @type {any} */ (child.stdio[3]), /** @type {any} */ (child.stdio[4]));
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    let extensionId;
    let worker;
    if (extension) {
        ({ id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_DIR }));
        const target = await waitFor(async () => (await targets()).find((t) => t.type === 'service_worker' && t.url.includes(extensionId)));
        worker = await attach(cdp, target.targetId);
    }

    async function targets () {
        return (await cdp.send('Target.getTargets')).targetInfos;
    }

    return {
        cdp,
        extensionId,
        /** Evaluates an expression in the extension service worker. */
        worker,
        targets,
        /** URLs of the open tabs. */
        async pageUrls () {
            return (await targets()).filter((t) => t.type === 'page').map((t) => t.url);
        },
        /**
         * Opens a tab and returns a session attached to it.
         *
         * @param {string} url
         * @param {{ background?: boolean }} [options]
         */
        async openPage (url, { background = false } = {}) {
            const { targetId } = await cdp.send('Target.createTarget', { url, background });
            const page = await attach(cdp, targetId);
            await page.send('Page.enable');
            await waitForLoad(page, url);
            return page;
        },
        /**
         * Opens a blank tab, lets `setup` prepare it (emulation, injected
         * scripts…), then navigates to `url`.
         *
         * @param {string} url
         * @param {(page: Awaited<ReturnType<typeof attach>>) => Promise<void>} setup
         */
        async openPageWith (url, setup) {
            const page = await this.openPage('about:blank');
            await setup(page);
            await page.send('Page.navigate', { url });
            await waitForLoad(page, url);
            return page;
        },
        /** @param {{ targetId: string }} page */
        closePage (page) {
            return cdp.send('Target.closeTarget', { targetId: page.targetId });
        },
        async close () {
            try {
                await cdp.send('Browser.close');
            }
            catch {
                child.kill();
            }
            await new Promise((done) => child.exitCode !== null ? done() : child.once('exit', done));
            rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
    };
}

/**
 * @param {import('node:stream').Writable} output
 * @param {import('node:stream').Readable} input
 */
function createConnection (output, input) {
    let lastId = 0;
    const pending = new Map();
    const listeners = new Set();
    let buffer = '';

    input.on('data', (chunk) => {
        buffer += chunk.toString();
        let end;
        while ((end = buffer.indexOf('\0')) >= 0) {
            const message = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (message.id && pending.has(message.id)) {
                const { resolve: done, reject } = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) {
                    reject(new Error(`${message.error.message} (${message.error.code})`));
                }
                else {
                    done(message.result);
                }
            }
            else {
                listeners.forEach((listener) => listener(message));
            }
        }
    });

    return {
        /**
         * @param {string} method
         * @param {object} [params]
         * @param {string} [sessionId]
         * @returns {Promise<any>}
         */
        send (method, params = {}, sessionId) {
            const id = ++lastId;
            output.write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + '\0');
            return new Promise((done, reject) => pending.set(id, { resolve: done, reject }));
        },
        /** @param {(message: any) => void} listener */
        on (listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}

/**
 * @param {ReturnType<typeof createConnection>} cdp
 * @param {string} targetId
 */
async function attach (cdp, targetId) {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const session = {
        targetId,
        /** @param {string} method @param {object} [params] */
        send: (method, params) => cdp.send(method, params, sessionId),
        /**
         * Evaluates an expression (promises are awaited) and returns its value.
         *
         * @param {string} expression
         */
        async evaluate (expression) {
            const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
                expression,
                awaitPromise : true,
                returnByValue: true
            }, sessionId);
            if (exceptionDetails) {
                throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
            }
            return result.value;
        }
    };
    await session.send('Runtime.enable');
    return session;
}

/**
 * Waits until the page has loaded `url`. A new tab first shows about:blank,
 * already "complete", so the URL must be checked too.
 *
 * @param {{ evaluate: (expression: string) => Promise<any> }} page
 * @param {string} url
 */
function waitForLoad (page, url) {
    const href = JSON.stringify(new URL(url).href);
    return waitFor(() => page.evaluate(`location.href === ${href} && document.readyState === "complete"`));
}

/**
 * Polls `check` until it returns a truthy value.
 *
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {number} [timeout]
 * @returns {Promise<T>}
 */
export async function waitFor (check, timeout = 10_000) {
    const end = Date.now() + timeout;
    for (;;) {
        let value;
        try {
            value = await check();
        }
        catch {
            // not ready yet (e.g. page still navigating)
        }
        if (value) {
            return value;
        }
        if (Date.now() > end) {
            throw new Error(`Timed out after ${timeout} ms waiting for ${check}`);
        }
        await sleep(100);
    }
}
