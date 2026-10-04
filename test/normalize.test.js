import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isComparableUrl, normalizeUrl, toMatchMode } from '../src/lib/normalize.js';

const same = (a, b, mode) => assert.equal(normalizeUrl(a, mode), normalizeUrl(b, mode), `${a} should match ${b} (${mode})`);
const differ = (a, b, mode) => assert.notEqual(normalizeUrl(a, mode), normalizeUrl(b, mode), `${a} should not match ${b} (${mode})`);

describe('isComparableUrl', () => {
    it('accepts web pages only', () => {
        assert.ok(isComparableUrl('https://example.com'));
        assert.ok(isComparableUrl('http://localhost:3000/'));
        for (const url of ['chrome://newtab/', 'about:blank', 'edge://settings', 'file:///C:/a.pdf', 'data:text/html,hi', '', undefined]) {
            assert.equal(isComparableUrl(url), false, String(url));
        }
    });
});

describe('normalizeUrl', () => {
    it('ignores browser pages', () => {
        assert.equal(normalizeUrl('chrome://newtab/', 'exact'), null);
        assert.equal(normalizeUrl('about:blank', 'domain'), null);
    });

    describe('common rules', () => {
        for (const mode of ['exact', 'path', 'domain']) {
            it(`${mode}: ignores scheme, www and host case`, () => {
                same('http://www.Example.com/a', 'https://example.com/a', mode);
            });
            it(`${mode}: keeps the port`, () => {
                differ('http://localhost:3000/', 'http://localhost:8080/', mode);
                same('https://example.com:443/', 'https://example.com/', mode);
            });
            it(`${mode}: keeps subdomains other than www`, () => {
                differ('https://blog.example.com/', 'https://example.com/', mode);
            });
        }
    });

    describe('exact', () => {
        const mode = 'exact';
        it('is case-sensitive in path and query', () => {
            differ('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=DQW4W9WGXCQ', mode);
            differ('https://github.com/Foo/Bar', 'https://github.com/foo/bar', mode);
        });
        it('compares the query', () => {
            differ('https://google.com/search?q=test', 'https://google.com/search?q=other', mode);
        });
        it('ignores query order and tracking params', () => {
            same('https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2', mode);
            same('https://example.com/a?id=42&utm_source=news&fbclid=x', 'https://example.com/a?id=42', mode);
        });
        it('ignores trailing slashes and anchors', () => {
            same('https://example.com/page/#section', 'https://example.com/page', mode);
        });
        it('keeps hash routes', () => {
            differ('https://app.example.com/#/inbox', 'https://app.example.com/#/settings', mode);
            differ('https://mail.google.com/mail/u/0/#inbox/abc', 'https://mail.google.com/mail/u/0/#inbox/def', mode);
        });
    });

    describe('path', () => {
        const mode = 'path';
        it('ignores query and hash', () => {
            same('https://google.com/search?q=test', 'https://google.com/search?q=other#here', mode);
        });
        it('compares the path', () => {
            differ('https://google.com/search', 'https://google.com/inbox', mode);
        });
    });

    describe('domain', () => {
        const mode = 'domain';
        it('compares the host only', () => {
            same('https://www.example.com', 'https://example.com/about?x=1', mode);
            differ('https://www.example.com', 'https://www.example.fr', mode);
        });
    });
});

describe('toMatchMode', () => {
    it('falls back to exact', () => {
        assert.equal(toMatchMode('path'), 'path');
        assert.equal(toMatchMode('bogus'), 'exact');
        assert.equal(toMatchMode(undefined), 'exact');
    });
});
