/**
 * Renders the PNG icons from the SVG sources with headless Chrome.
 *
 *   npm run icons
 *
 * The 16 and 32 px icons (toolbar, 1x and 2x) use the simplified `*-small.svg` drawings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSION_DIR, launchChrome } from './lib/chrome.js';

const ICONS_DIR = join(EXTENSION_DIR, 'icons');

const OUTPUTS = [
    ...[16, 32, 48, 128, 256, 512].map((size) => ({ size, name: `icon${size}.png`, paused: false })),
    ...[16, 32, 48, 128].map((size) => ({ size, name: `icon${size}-paused.png`, paused: true }))
];

/**
 * @param {{ evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any> }} page
 * @param {string} svg
 * @param {number} size
 */
async function renderPng (page, svg, size) {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.evaluate(`new Promise((done) => {
        document.body.innerHTML = '<img width="${size}" height="${size}" style="display:block">';
        const img = document.body.firstChild;
        img.onload = done;
        img.src = ${JSON.stringify(src)};
    })`);
    const { data } = await page.send('Page.captureScreenshot', {
        format: 'png',
        clip  : { x: 0, y: 0, width: size, height: size, scale: 1 }
    });
    return Buffer.from(data, 'base64');
}

const chrome = await launchChrome({ extension: false });
try {
    const page = await chrome.openPage('about:blank');
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.evaluate('document.documentElement.style.margin = document.body.style.margin = "0"');

    for (const { size, name, paused } of OUTPUTS) {
        const source = `icon${size <= 32 ? '-small' : ''}${paused ? '-paused' : ''}.svg`;
        const png = await renderPng(page, readFileSync(join(ICONS_DIR, source), 'utf8'), size);
        writeFileSync(join(ICONS_DIR, name), png);
        console.log(`${name}  <-  ${source}`);
    }
}
finally {
    await chrome.close();
}
