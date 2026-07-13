(function (root, factory) {
    'use strict';

    const api = factory();
    root.CNT = api;

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SCHEMA_VERSION = 4;
    const STORAGE_KEY = 'cnt';
    const CACHE_KEY = 'cntCache';

    const FONT_IDS = Object.freeze(['pretendard', 'mona', 'nanum']);
    const FONT_WEIGHTS = Object.freeze({
        pretendard: Object.freeze([100, 200, 300, 400, 500, 600, 700, 800, 900]),
        mona: Object.freeze([400, 700]),
        nanum: Object.freeze([400, 700, 800])
    });

    const FONT_ALIASES = Object.freeze({
        pretendard: 'pretendard',
        'pretendard-variable': 'pretendard',
        pretendardvariable: 'pretendard',
        mona: 'mona',
        mona12: 'mona',
        pixel: 'mona',
        'pixel-font': 'mona',
        nanum: 'nanum',
        'nanum-myeongjo': 'nanum',
        nanummyeongjo: 'nanum',
        myeongjo: 'nanum',
        serif: 'nanum'
    });

    const PRESETS = Object.freeze([
        Object.freeze({ id: 'preset:roblox', name: 'Roblox', domain: 'roblox.com', icon: 'R' }),
        Object.freeze({ id: 'preset:youtube', name: 'YouTube', domain: 'youtube.com', icon: 'Y' }),
        Object.freeze({ id: 'preset:twitter', name: 'X / Twitter', domain: 'twitter.com', icon: 'X' }),
        Object.freeze({ id: 'preset:naver', name: 'Naver', domain: 'naver.com', icon: 'N' }),
        Object.freeze({ id: 'preset:github', name: 'GitHub', domain: 'github.com', icon: 'G' }),
        Object.freeze({ id: 'preset:google', name: 'Google', domain: 'google.com', icon: 'G' }),
        Object.freeze({ id: 'preset:discord', name: 'Discord', domain: 'discord.com', icon: 'D' }),
        Object.freeze({ id: 'preset:instagram', name: 'Instagram', domain: 'instagram.com', icon: 'I' }),
        Object.freeze({ id: 'preset:notion', name: 'Notion', domain: 'notion.so', icon: 'N' }),
        Object.freeze({ id: 'preset:reddit', name: 'Reddit', domain: 'reddit.com', icon: 'R' })
    ]);

    const DEFAULT_STYLE = Object.freeze({
        fontId: 'pretendard',
        fontSize: 100,
        fontWeight: 400
    });

    const DEFAULT_BEHAVIOR = Object.freeze({
        protectIcons: true,
        protectCode: true,
        protectAriaHidden: true,
        protectAccessibilityText: true,
        applyControls: true,
        applyEditable: true
    });

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function finiteNumber(value, fallback) {
        const number = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function booleanValue(value, fallback) {
        return typeof value === 'boolean' ? value : fallback;
    }

    function deepClone(value) {
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (_) {
                // Settings are JSON-safe, so the compatibility path is sufficient.
            }
        }
        return JSON.parse(JSON.stringify(value));
    }

    function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    function canonicalFontId(value) {
        const raw = isPlainObject(value)
            ? value.id || value.key || value.value || value.family
            : value;
        const key = String(raw || DEFAULT_STYLE.fontId)
            .trim()
            .toLowerCase()
            .replace(/[\s_]+/g, '-');
        return FONT_ALIASES[key] || DEFAULT_STYLE.fontId;
    }

    function normalizeHostname(value) {
        if (value === null || value === undefined) return '';

        let raw = String(value).trim();
        if (!raw) return '';

        raw = raw.replace(/^\*\./, '').replace(/^\./, '');

        try {
            if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
                raw = new URL(raw).hostname;
            } else if (/[/?#]/.test(raw)) {
                raw = new URL(`https://${raw}`).hostname;
            }
        } catch (_) {
            raw = raw.split('/')[0].split('?')[0].split('#')[0];
        }

        raw = raw
            .trim()
            .toLowerCase()
            .replace(/\.$/, '')
            .replace(/^\[|\]$/g, '');

        if (!raw || raw.length > 253 || /\s/.test(raw)) return '';
        if (raw === 'localhost') return raw;

        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) {
            const valid = raw.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
            return valid ? raw : '';
        }

        if (raw.includes(':') && /^[0-9a-f:]+$/i.test(raw)) return raw;

        const labels = raw.split('.');
        if (labels.some((label) => !label || label.length > 63 || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) {
            return '';
        }
        return raw;
    }

    function parseDomainInput(value) {
        const raw = String(value || '').trim();
        return {
            domain: normalizeHostname(raw),
            includeSubdomains: /^\*\./.test(raw) || /^\./.test(raw)
        };
    }

    function normalizeStyle(value, fallback = DEFAULT_STYLE, partial = false) {
        const source = isPlainObject(value) ? value : {};
        const result = {};

        if (!partial || 'fontId' in source || 'font' in source || 'selectedFont' in source) {
            result.fontId = canonicalFontId(source.fontId ?? source.font ?? source.selectedFont ?? fallback.fontId);
        }

        if (!partial || 'fontSize' in source || 'scalePercent' in source || 'size' in source) {
            let size = finiteNumber(source.fontSize ?? source.scalePercent ?? source.size, fallback.fontSize);
            if (size > 0 && size <= 3) size *= 100;
            result.fontSize = Math.round(clamp(size, 75, 150));
        }

        if (!partial || 'fontWeight' in source || 'targetWeight' in source || 'weight' in source) {
            const weight = finiteNumber(source.fontWeight ?? source.targetWeight ?? source.weight, fallback.fontWeight);
            result.fontWeight = Math.round(clamp(weight, 100, 900) / 100) * 100;
        }

        return result;
    }

    function normalizeBehavior(value) {
        const source = isPlainObject(value) ? value : {};
        return {
            protectIcons: booleanValue(source.protectIcons ?? source.preserveIcons, DEFAULT_BEHAVIOR.protectIcons),
            protectCode: booleanValue(source.protectCode ?? source.preserveCode, DEFAULT_BEHAVIOR.protectCode),
            protectAriaHidden: booleanValue(source.protectAriaHidden, DEFAULT_BEHAVIOR.protectAriaHidden),
            protectAccessibilityText: booleanValue(source.protectAccessibilityText, DEFAULT_BEHAVIOR.protectAccessibilityText),
            applyControls: booleanValue(source.applyControls, DEFAULT_BEHAVIOR.applyControls),
            applyEditable: booleanValue(source.applyEditable, DEFAULT_BEHAVIOR.applyEditable)
        };
    }

    function createRuleId(prefix = 'rule') {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `${prefix}:${crypto.randomUUID()}`;
        }
        const random = Math.random().toString(36).slice(2, 10);
        return `${prefix}:${Date.now().toString(36)}:${random}`;
    }

    function presetForDomain(domain) {
        return PRESETS.find((preset) => preset.domain === domain) || null;
    }

    function normalizeRule(value, index = 0) {
        const source = isPlainObject(value) ? value : {};
        const domain = normalizeHostname(source.domain ?? source.host ?? source.hostname);
        if (!domain) return null;

        const preset = presetForDomain(domain);
        const sourceType = source.source === 'preset' || String(source.id || '').startsWith('preset:')
            ? 'preset'
            : 'custom';
        const id = String(source.id || (sourceType === 'preset' && preset ? preset.id : `legacy:${domain}:${index}`));

        return {
            id,
            domain,
            enabled: booleanValue(source.enabled, true),
            includeSubdomains: booleanValue(source.includeSubdomains ?? source.subdomains, sourceType === 'preset'),
            source: sourceType,
            overrides: normalizeStyle(source.overrides ?? source.style ?? source, DEFAULT_STYLE, true)
        };
    }

    function createDefaultSettings() {
        return {
            schemaVersion: SCHEMA_VERSION,
            globalEnabled: true,
            defaults: deepClone(DEFAULT_STYLE),
            behavior: deepClone(DEFAULT_BEHAVIOR),
            sites: PRESETS.map((preset) => ({
                id: preset.id,
                domain: preset.domain,
                enabled: false,
                includeSubdomains: true,
                source: 'preset',
                overrides: {}
            }))
        };
    }

    function migrateLegacySettings(input) {
        const base = createDefaultSettings();
        const source = isPlainObject(input) ? input : {};

        base.globalEnabled = booleanValue(source.globalEnabled, base.globalEnabled);
        base.defaults = normalizeStyle({
            fontId: source.fontId ?? source.selectedFont ?? source.defaults?.fontId,
            fontSize: source.fontSize ?? source.defaults?.fontSize,
            fontWeight: source.fontWeight ?? source.defaults?.fontWeight
        });
        base.behavior = normalizeBehavior(source.behavior ?? source.options);

        const rules = new Map(base.sites.map((rule) => [rule.id, rule]));
        const legacyPresets = isPlainObject(source.presets) ? source.presets : {};

        for (const preset of PRESETS) {
            const legacy = legacyPresets[preset.id.replace('preset:', '')] || legacyPresets[preset.domain];
            if (!isPlainObject(legacy)) continue;
            const existing = rules.get(preset.id);
            existing.enabled = booleanValue(legacy.enabled, existing.enabled);
            existing.overrides = normalizeStyle(legacy.overrides ?? legacy, base.defaults, true);
        }

        const incomingSites = Array.isArray(source.sites) ? source.sites : [];
        incomingSites.forEach((entry, index) => {
            const normalized = normalizeRule(entry, index);
            if (normalized) rules.set(normalized.id, normalized);
        });

        const customSites = Array.isArray(source.customSites) ? source.customSites : [];
        customSites.forEach((legacy, index) => {
            const normalized = normalizeRule({
                ...legacy,
                id: legacy.id || `legacy:custom:${index}:${normalizeHostname(legacy.domain)}`,
                source: 'custom',
                includeSubdomains: booleanValue(legacy.includeSubdomains, true)
            }, index);
            if (normalized) rules.set(normalized.id, normalized);
        });

        const siteFontSizes = isPlainObject(source.siteFontSizes) ? source.siteFontSizes : {};
        Object.entries(siteFontSizes).forEach(([rawDomain, rawSize], index) => {
            const domain = normalizeHostname(rawDomain);
            if (!domain) return;
            let rule = Array.from(rules.values()).find((item) => item.domain === domain && item.source === 'custom');
            if (!rule) {
                rule = {
                    id: `legacy:size:${index}:${domain}`,
                    domain,
                    enabled: true,
                    includeSubdomains: false,
                    source: 'custom',
                    overrides: {}
                };
                rules.set(rule.id, rule);
            }
            rule.overrides.fontSize = normalizeStyle({ fontSize: rawSize }).fontSize;
        });

        base.sites = Array.from(rules.values());
        return base;
    }

    function normalizeSettings(input) {
        if (!isPlainObject(input)) return createDefaultSettings();

        const source = input.schemaVersion === SCHEMA_VERSION && Array.isArray(input.sites)
            ? input
            : migrateLegacySettings(input);
        const defaults = normalizeStyle(source.defaults ?? source);
        const behavior = normalizeBehavior(source.behavior);
        const seenIds = new Set();
        const normalizedRules = [];

        const incomingRules = Array.isArray(source.sites) ? source.sites : [];
        incomingRules.forEach((value, index) => {
            const rule = normalizeRule(value, index);
            if (!rule) return;
            if (seenIds.has(rule.id)) rule.id = createRuleId(rule.source);
            seenIds.add(rule.id);
            normalizedRules.push(rule);
        });

        for (const preset of PRESETS) {
            if (normalizedRules.some((rule) => rule.id === preset.id)) continue;
            normalizedRules.push({
                id: preset.id,
                domain: preset.domain,
                enabled: false,
                includeSubdomains: true,
                source: 'preset',
                overrides: {}
            });
        }

        return {
            schemaVersion: SCHEMA_VERSION,
            globalEnabled: booleanValue(source.globalEnabled, true),
            defaults,
            behavior,
            sites: normalizedRules
        };
    }

    function domainMatches(hostname, rule) {
        const host = normalizeHostname(hostname);
        const domain = normalizeHostname(rule?.domain);
        if (!host || !domain) return false;
        if (host === domain) return true;
        return Boolean(rule.includeSubdomains && host.endsWith(`.${domain}`));
    }

    function ruleSpecificity(hostname, rule) {
        const host = normalizeHostname(hostname);
        const exact = host === rule.domain ? 1 : 0;
        const sourcePriority = rule.source === 'custom' ? 1 : 0;
        return [exact, rule.domain.length, sourcePriority];
    }

    function compareSpecificity(hostname, left, right) {
        const a = ruleSpecificity(hostname, left);
        const b = ruleSpecificity(hostname, right);
        for (let index = 0; index < a.length; index += 1) {
            if (a[index] !== b[index]) return b[index] - a[index];
        }
        return String(left.id).localeCompare(String(right.id));
    }

    function resolveForHost(input, hostname) {
        const settings = normalizeSettings(input);
        const host = normalizeHostname(hostname);

        const candidates = host
            ? settings.sites
                .filter((rule) => domainMatches(host, rule))
                .filter((rule) => rule.source === 'custom' || rule.enabled)
                .sort((a, b) => compareSpecificity(host, a, b))
            : [];

        const matchedRule = candidates[0] || null;
        const style = {
            ...settings.defaults,
            ...(matchedRule?.overrides || {})
        };
        const actualWeight = snapWeight(style.fontId, style.fontWeight);
        const siteAllowed = matchedRule ? matchedRule.enabled : true;

        return {
            active: Boolean(settings.globalEnabled && host && siteAllowed),
            globalEnabled: settings.globalEnabled,
            hostname: host,
            matchedRule: matchedRule ? deepClone(matchedRule) : null,
            fontId: style.fontId,
            fontSize: style.fontSize,
            scalePercent: style.fontSize,
            fontWeight: style.fontWeight,
            targetWeight: style.fontWeight,
            actualWeight,
            behavior: deepClone(settings.behavior)
        };
    }

    function snapWeight(fontId, requestedWeight) {
        const canonical = canonicalFontId(fontId);
        const weights = FONT_WEIGHTS[canonical] || FONT_WEIGHTS.pretendard;
        const requested = clamp(finiteNumber(requestedWeight, DEFAULT_STYLE.fontWeight), 100, 900);
        let best = weights[0];
        let distance = Math.abs(requested - best);

        for (let index = 1; index < weights.length; index += 1) {
            const next = weights[index];
            const nextDistance = Math.abs(requested - next);
            if (nextDistance < distance || (nextDistance === distance && next > best)) {
                best = next;
                distance = nextDistance;
            }
        }
        return best;
    }

    function findRule(settings, predicate) {
        return normalizeSettings(settings).sites.find(predicate) || null;
    }

    function findExactRule(settings, hostname, source) {
        const host = normalizeHostname(hostname);
        if (!host) return null;
        return findRule(settings, (rule) =>
            rule.domain === host &&
            rule.includeSubdomains === false &&
            (!source || rule.source === source)
        );
    }

    function upsertRule(input, ruleInput) {
        const settings = normalizeSettings(input);
        const normalized = normalizeRule(ruleInput, settings.sites.length);
        if (!normalized) throw new TypeError('유효한 도메인 규칙이 필요합니다.');

        const index = settings.sites.findIndex((rule) => rule.id === normalized.id);
        if (index >= 0) settings.sites[index] = normalized;
        else settings.sites.push(normalized);
        return settings;
    }

    function removeRule(input, ruleId) {
        const settings = normalizeSettings(input);
        const target = settings.sites.find((rule) => rule.id === ruleId);
        if (target?.source === 'preset') {
            target.enabled = false;
            target.overrides = {};
            return settings;
        }
        settings.sites = settings.sites.filter((rule) => rule.id !== ruleId);
        return settings;
    }

    function ensureExactRule(input, hostname, enabled) {
        const settings = normalizeSettings(input);
        const host = normalizeHostname(hostname);
        if (!host) throw new TypeError('유효한 호스트가 필요합니다.');

        let rule = settings.sites.find((item) =>
            item.domain === host && item.includeSubdomains === false && item.source === 'custom'
        );

        if (!rule) {
            rule = {
                id: createRuleId('custom'),
                domain: host,
                enabled: typeof enabled === 'boolean' ? enabled : true,
                includeSubdomains: false,
                source: 'custom',
                overrides: {}
            };
            settings.sites.push(rule);
        } else if (typeof enabled === 'boolean') {
            rule.enabled = enabled;
        }

        return { settings, rule };
    }

    return Object.freeze({
        SCHEMA_VERSION,
        STORAGE_KEY,
        CACHE_KEY,
        FONT_IDS,
        FONT_WEIGHTS,
        PRESETS,
        DEFAULT_STYLE,
        DEFAULT_BEHAVIOR,
        clamp,
        deepClone,
        stableStringify,
        canonicalFontId,
        normalizeDomain: normalizeHostname,
        normalizeHostname,
        parseDomainInput,
        normalizeStyle,
        normalizeBehavior,
        normalizeSettings,
        createDefaultSettings,
        createRuleId,
        domainMatches,
        resolveForHost,
        snapWeight,
        findRule,
        findExactRule,
        upsertRule,
        removeRule,
        ensureExactRule
    });
});
