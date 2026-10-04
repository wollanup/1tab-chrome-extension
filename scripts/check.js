/**
 * Static checks of the extension sources, run by CI:
 *
 *   npm run check
 *
 * - manifest.json: files it references exist, version matches package.json;
 * - locales: same keys and placeholders in every language, every key used by
 *   the code exists, no unused key.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');
const errors = [];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// ---------- Manifest ----------

const manifest = readJson(join(SRC, 'manifest.json'));
const pkg = readJson(join(ROOT, 'package.json'));
if (manifest.version !== pkg.version) {
    errors.push(`manifest.json version ${manifest.version} differs from package.json version ${pkg.version}`);
}
const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
];
for (const file of referenced) {
    if (!existsSync(join(SRC, file))) {
        errors.push(`manifest.json references a missing file: ${file}`);
    }
}

// ---------- Locales ----------

const LOCALES_DIR = join(SRC, '_locales');
const locales = Object.fromEntries(readdirSync(LOCALES_DIR).map((lang) => [lang, readJson(join(LOCALES_DIR, lang, 'messages.json'))]));
const reference = locales[manifest.default_locale];
const placeholders = (message) => [...message.matchAll(/\$\d/g)].map((m) => m[0]).sort().join();

for (const [lang, messages] of Object.entries(locales)) {
    for (const key of Object.keys(reference)) {
        if (!(key in messages)) {
            errors.push(`${lang}: missing key "${key}"`);
        }
        else if (placeholders(messages[key].message) !== placeholders(reference[key].message)) {
            errors.push(`${lang}: placeholders of "${key}" differ from ${manifest.default_locale}`);
        }
    }
    for (const key of Object.keys(messages)) {
        if (!(key in reference)) {
            errors.push(`${lang}: unknown key "${key}"`);
        }
    }
}

// Keys used by the code: data-i18n attributes, __MSG_key__ in the manifest,
// getMessage/msg/pluralMessage calls with literal keys (`cond ? 'a' : 'b'` included).
const sources = readdirSync(SRC, { recursive: true })
    .filter((file) => /\.(js|html|json)$/.test(file) && !file.includes('_locales'))
    .map((file) => readFileSync(join(SRC, file), 'utf8'))
    .map((code) => code.replace(/\/\*[\s\S]*?\*\//g, '')) // doc comments show examples
    .join('\n');
const calls = [...sources.matchAll(/(?:getMessage|msg|pluralMessage)\(([^;]*?)[,)]/g)].map((m) => m[1]);
const used = new Set([
    ...[...sources.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
    ...[...sources.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
    ...calls.flatMap((args) => {
        const ternary = args.match(/\?\s*'(\w+)'\s*:\s*'(\w+)'/);
        const literal = args.match(/^\s*'(\w+)'\s*$/);
        return ternary ? [ternary[1], ternary[2]] : literal ? [literal[1]] : [];
    })
]);
const isDefined = (key) => key in reference || `${key}_other` in reference;
const isUsed = (key) => used.has(key) || used.has(key.replace(/_(zero|one|two|few|many|other)$/, ''));

for (const key of used) {
    if (!isDefined(key)) {
        errors.push(`code uses an undefined message key "${key}"`);
    }
}
for (const key of Object.keys(reference)) {
    if (!isUsed(key)) {
        errors.push(`${manifest.default_locale}: unused key "${key}"`);
    }
}

if (errors.length) {
    console.error(errors.map((e) => `✗ ${e}`).join('\n'));
    process.exit(1);
}
console.log(`✓ manifest ${manifest.version}, ${Object.keys(locales).length} locales, ${Object.keys(reference).length} messages`);
