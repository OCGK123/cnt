'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const API = require('../shared.js');

test('default settings apply globally', () => {
    const settings = API.createDefaultSettings();
    const resolved = API.resolveForHost(settings, 'example.com');
    assert.equal(resolved.active, true);
    assert.equal(resolved.fontId, 'pretendard');
    assert.equal(resolved.fontSize, 100);
});

test('master toggle disables every site', () => {
    const settings = API.createDefaultSettings();
    settings.globalEnabled = false;
    assert.equal(API.resolveForHost(settings, 'example.com').active, false);
});

test('exact custom OFF rule excludes only the exact host', () => {
    let settings = API.createDefaultSettings();
    settings = API.ensureExactRule(settings, 'www.example.com', false).settings;

    assert.equal(API.resolveForHost(settings, 'www.example.com').active, false);
    assert.equal(API.resolveForHost(settings, 'api.example.com').active, true);
});

test('enabled custom rule applies overrides', () => {
    let settings = API.createDefaultSettings();
    const result = API.ensureExactRule(settings, 'example.com', true);
    settings = result.settings;
    result.rule.overrides = {
        fontId: 'nanum',
        fontSize: 115,
        fontWeight: 700
    };

    const resolved = API.resolveForHost(settings, 'example.com');
    assert.equal(resolved.active, true);
    assert.equal(resolved.fontId, 'nanum');
    assert.equal(resolved.fontSize, 115);
    assert.equal(resolved.actualWeight, 700);
});

test('disabled preset rules are ignored under global application', () => {
    const settings = API.createDefaultSettings();
    const youtube = settings.sites.find((rule) => rule.id === 'preset:youtube');
    assert.equal(youtube.enabled, false);
    assert.equal(API.resolveForHost(settings, 'www.youtube.com').active, true);
});

test('enabled preset rule can provide an override', () => {
    const settings = API.createDefaultSettings();
    const youtube = settings.sites.find((rule) => rule.id === 'preset:youtube');
    youtube.enabled = true;
    youtube.overrides = { fontId: 'mona' };

    const resolved = API.resolveForHost(settings, 'music.youtube.com');
    assert.equal(resolved.active, true);
    assert.equal(resolved.fontId, 'mona');
});

test('exact custom rule wins over a parent preset', () => {
    const settings = API.createDefaultSettings();
    const preset = settings.sites.find((rule) => rule.id === 'preset:roblox');
    preset.enabled = true;
    preset.overrides = { fontId: 'mona' };

    settings.sites.push({
        id: 'custom:www.roblox.com',
        domain: 'www.roblox.com',
        enabled: true,
        includeSubdomains: false,
        source: 'custom',
        overrides: { fontId: 'nanum' }
    });

    assert.equal(API.resolveForHost(settings, 'www.roblox.com').fontId, 'nanum');
});

test('legacy settings migrate to schema version 4', () => {
    const migrated = API.normalizeSettings({
        globalEnabled: true,
        selectedFont: 'myeongjo',
        fontSize: 110,
        customSites: [{ domain: 'example.com', enabled: false }]
    });

    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.defaults.fontId, 'nanum');
    assert.equal(migrated.defaults.fontSize, 110);
    assert.equal(API.resolveForHost(migrated, 'example.com').active, false);
    assert.equal(API.resolveForHost(migrated, 'other.example').active, true);
});

test('font weights snap to supported local files', () => {
    assert.equal(API.snapWeight('pretendard', 550), 600);
    assert.equal(API.snapWeight('mona', 500), 400);
    assert.equal(API.snapWeight('mona', 600), 700);
    assert.equal(API.snapWeight('nanum', 900), 800);
});

test('domain parser handles wildcard input', () => {
    assert.deepEqual(API.parseDomainInput('*.Example.com/path'), {
        domain: 'example.com',
        includeSubdomains: true
    });
});
