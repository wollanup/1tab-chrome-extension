import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findOriginal, groupDuplicates, pickTabToKeep, tabsToClose, tabUrl } from '../src/lib/duplicates.js';

const URL_A = 'https://example.com/a';
const URL_B = 'https://example.com/b';

let nextId = 1;
const tab = (props) => ({ id: nextId++, windowId: 1, incognito: false, url: URL_A, ...props });
const none = () => false;

describe('tabUrl', () => {
    it('prefers the pending url of a loading tab', () => {
        assert.equal(tabUrl({ url: URL_A, pendingUrl: URL_B }), URL_B);
        assert.equal(tabUrl({ url: URL_A }), URL_A);
    });
});

describe('findOriginal', () => {
    it('finds a tab with the same page', () => {
        const original = tab();
        const other = tab({ url: URL_B });
        const candidate = tab();
        assert.equal(findOriginal(candidate, [original, other, candidate], 'exact', none), original);
    });

    it('returns nothing without a match', () => {
        const candidate = tab();
        assert.equal(findOriginal(candidate, [tab({ url: URL_B }), candidate], 'exact', none), undefined);
    });

    it('ignores browser pages', () => {
        const candidate = tab({ url: 'chrome://newtab/' });
        assert.equal(findOriginal(candidate, [tab({ url: 'chrome://newtab/' })], 'exact', none), undefined);
    });

    it('uses the pending url of loading tabs', () => {
        const original = tab({ url: URL_B, pendingUrl: URL_A });
        const candidate = tab({ url: '', pendingUrl: URL_A });
        assert.equal(findOriginal(candidate, [original], 'exact', none), original);
        assert.equal(findOriginal(tab({ url: URL_B }), [original], 'exact', none), undefined);
    });

    it('keeps incognito and normal tabs apart', () => {
        const candidate = tab({ incognito: true });
        assert.equal(findOriginal(candidate, [tab()], 'exact', none), undefined);
    });

    it('never lets two new tabs close each other', () => {
        const first = tab();
        const second = tab();
        const isNew = () => true;
        assert.equal(findOriginal(first, [first, second], 'exact', isNew), undefined);
        assert.equal(findOriginal(second, [first, second], 'exact', isNew), first);
    });

    it('matches a newer tab once it has loaded', () => {
        const candidate = tab();
        const newer = tab();
        assert.equal(findOriginal(candidate, [newer], 'exact', none), newer);
    });

    it('prefers the same window, then the most recently used tab', () => {
        const otherWindowRecent = tab({ windowId: 2, lastAccessed: 300 });
        const sameWindowOld = tab({ lastAccessed: 100 });
        const sameWindowRecent = tab({ lastAccessed: 200 });
        const candidate = tab();
        assert.equal(findOriginal(candidate, [otherWindowRecent, sameWindowOld, sameWindowRecent], 'exact', none), sameWindowRecent);
        assert.equal(findOriginal(candidate, [otherWindowRecent, tab({ windowId: 3, lastAccessed: 100 })], 'exact', none), otherWindowRecent);
    });
});

describe('groupDuplicates', () => {
    it('groups tabs showing the same page and drops single tabs', () => {
        const a1 = tab();
        const a2 = tab({ url: 'http://www.example.com/a/' });
        const b = tab({ url: URL_B });
        const newTab = tab({ url: 'chrome://newtab/' });
        const newTab2 = tab({ url: 'chrome://newtab/' });
        assert.deepEqual(groupDuplicates([a1, b, a2, newTab, newTab2], 'exact'), [[a1, a2]]);
    });

    it('follows the mode', () => {
        const a = tab();
        const b = tab({ url: URL_B });
        assert.deepEqual(groupDuplicates([a, b], 'exact'), []);
        assert.deepEqual(groupDuplicates([a, b], 'domain'), [[a, b]]);
    });

    it('keeps incognito and normal tabs apart', () => {
        assert.deepEqual(groupDuplicates([tab(), tab({ incognito: true })], 'exact'), []);
    });
});

describe('pickTabToKeep / tabsToClose', () => {
    it('keeps the active tab, then a pinned one, then the most recently used', () => {
        const old = tab({ lastAccessed: 100 });
        const recent = tab({ lastAccessed: 300 });
        const pinned = tab({ lastAccessed: 200, pinned: true });
        assert.equal(pickTabToKeep([old, recent], undefined), recent);
        assert.equal(pickTabToKeep([old, recent, pinned], undefined), pinned);
        assert.equal(pickTabToKeep([old, recent, pinned], old.id), old);
    });

    it('never closes pinned tabs', () => {
        const active = tab();
        const pinned = tab({ pinned: true });
        const other = tab();
        assert.deepEqual(tabsToClose([active, pinned, other], active.id), [other]);
    });
});
