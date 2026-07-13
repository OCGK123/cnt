'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CNT = require('../shared.js');

test('default settings are complete and Roblox is enabled', () => {
    const settings = CNT.createDefaultSettings();
    assert.equal(settings.schemaVersion, CNT.SCHEMA_VERSION);
    assert.equal(settings.globalEnabled, true);
    assert.deepEqual(settings.defaults, {
        fontId: 'pretendard',
        fontSize: 100,
        fontWeight: 400
    });
    assert.equal(settings.sites.length, CNT.PRESETS.length);
    assert.equal(settings.sites.find((rule) => rule.id === 'preset:roblox').enabled, true);
});

test('legacy settings migrate without losing domains, sizes, or toggles', () => {
    const migrated = CNT.normalizeSettings({
        globalEnabled: true,
        fontSize: 112,
        presets: {
            roblox: { domain: 'roblox.com', enabled: false },
            youtube: { domain: 'youtube.com', enabled: true }
        },
        customSites: [
            { domain: 'Example.COM', enabled: true }
        ],
        siteFontSizes: {
            'example.com': 125
        }
    });

    assert.equal(migrated.defaults.fontSize, 112);
    assert.equal(migrated.sites.find((rule) => rule.id === 'preset:roblox').enabled, false);
    assert.equal(migrated.sites.find((rule) => rule.id === 'preset:youtube').enabled, true);

    const example = migrated.sites.find((rule) => rule.domain === 'example.com' && rule.source === 'custom');
    assert.ok(example);
    assert.equal(example.enabled, true);
    assert.equal(example.overrides.fontSize, 125);
});

test('exact custom exception wins over enabled parent preset', () => {
    const settings = CNT.createDefaultSettings();
    settings.sites.push({
        id: 'custom:exception',
        domain: 'www.roblox.com',
        enabled: false,
        includeSubdomains: false,
        source: 'custom',
        overrides: {}
    });

    const root = CNT.resolveForHost(settings, 'roblox.com');
    const exception = CNT.resolveForHost(settings, 'www.roblox.com');

    assert.equal(root.active, true);
    assert.equal(exception.active, false);
    assert.equal(exception.matchedRule.id, 'custom:exception');
});

test('longest matching domain wins for nested subdomains', () => {
    const settings = CNT.normalizeSettings({
        schemaVersion: CNT.SCHEMA_VERSION,
        globalEnabled: true,
        defaults: CNT.DEFAULT_STYLE,
        behavior: CNT.DEFAULT_BEHAVIOR,
        sites: [
            {
                id: 'custom:parent',
                domain: 'example.com',
                enabled: true,
                includeSubdomains: true,
                source: 'custom',
                overrides: { fontSize: 110 }
            },
            {
                id: 'custom:child',
                domain: 'app.example.com',
                enabled: true,
                includeSubdomains: true,
                source: 'custom',
                overrides: { fontSize: 125 }
            }
        ]
    });

    const resolved = CNT.resolveForHost(settings, 'deep.app.example.com');
    assert.equal(resolved.matchedRule.id, 'custom:child');
    assert.equal(resolved.fontSize, 125);
});

test('site overrides inherit unspecified global style fields', () => {
    const settings = CNT.normalizeSettings({
        schemaVersion: CNT.SCHEMA_VERSION,
        globalEnabled: true,
        defaults: { fontId: 'nanum', fontSize: 108, fontWeight: 700 },
        behavior: CNT.DEFAULT_BEHAVIOR,
        sites: [
            {
                id: 'custom:test',
                domain: 'test.dev',
                enabled: true,
                includeSubdomains: false,
                source: 'custom',
                overrides: { fontSize: 120 }
            }
        ]
    });

    const resolved = CNT.resolveForHost(settings, 'test.dev');
    assert.equal(resolved.fontId, 'nanum');
    assert.equal(resolved.fontSize, 120);
    assert.equal(resolved.fontWeight, 700);
});

test('domain parser handles URLs and explicit wildcard rules', () => {
    assert.deepEqual(CNT.parseDomainInput('https://WWW.Example.com/path?q=1'), {
        domain: 'www.example.com',
        includeSubdomains: false
    });
    assert.deepEqual(CNT.parseDomainInput('*.Example.com'), {
        domain: 'example.com',
        includeSubdomains: true
    });
    assert.equal(CNT.normalizeHostname('bad domain'), '');
    assert.equal(CNT.normalizeHostname('999.2.3.4'), '');
});

test('font values are canonicalized, clamped, and snapped safely', () => {
    const normalized = CNT.normalizeSettings({
        schemaVersion: CNT.SCHEMA_VERSION,
        globalEnabled: true,
        defaults: { fontId: 'myeongjo', fontSize: 999, fontWeight: 650 },
        behavior: {},
        sites: []
    });

    assert.equal(normalized.defaults.fontId, 'nanum');
    assert.equal(normalized.defaults.fontSize, 150);
    assert.equal(normalized.defaults.fontWeight, 700);
    assert.equal(CNT.snapWeight('mona', 500), 400);
    assert.equal(CNT.snapWeight('mona', 600), 700);
    assert.equal(CNT.snapWeight('nanum', 900), 800);
});

test('ensureExactRule preserves inherited enabled state and remains idempotent', () => {
    const initial = CNT.createDefaultSettings();
    const first = CNT.ensureExactRule(initial, 'www.roblox.com');
    const second = CNT.ensureExactRule(first.settings, 'www.roblox.com');

    assert.equal(first.rule.enabled, true);
    assert.equal(second.settings.sites.filter((rule) =>
        rule.source === 'custom' && rule.domain === 'www.roblox.com' && !rule.includeSubdomains
    ).length, 1);
});

test('removing a preset disables it instead of deleting schema-owned metadata', () => {
    const settings = CNT.removeRule(CNT.createDefaultSettings(), 'preset:roblox');
    const roblox = settings.sites.find((rule) => rule.id === 'preset:roblox');
    assert.ok(roblox);
    assert.equal(roblox.enabled, false);
    assert.deepEqual(roblox.overrides, {});
});
