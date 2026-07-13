'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('manifest references existing runtime files', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const referenced = [
        manifest.action.default_popup,
        manifest.background.service_worker,
        ...manifest.content_scripts.flatMap((entry) => entry.js)
    ];

    for (const file of referenced) {
        assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
    }
});

test('popup CSS uses local assets only', () => {
    const css = read('popup.css');
    assert.equal(/@import\s+url\(["']?https?:/i.test(css), false);
    assert.equal(/src:\s*url\(["']?https?:/i.test(css), false);
});

test('content engine avoids idle-callback full-page delay', () => {
    const content = read('content.js');
    assert.equal(content.includes('requestIdleCallback'), false);
    assert.equal(content.includes('SIZE_ATTRIBUTE'), true);
});

test('background contains duplicate-broadcast protection', () => {
    const background = read('background.js');
    assert.equal(background.includes('lastBroadcastSignature'), true);
    assert.equal(background.includes('Promise.allSettled'), true);
});
