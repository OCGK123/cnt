'use strict';

const API = globalThis.CNT;
const $ = (id) => document.getElementById(id);

let settings = API.createDefaultSettings();
let currentHost = '';
let scope = 'global';
let saveTimer = 0;

function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response?.ok) return reject(new Error(response?.error || '요청을 처리하지 못했습니다.'));
            resolve(response);
        });
    });
}

function activeTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
    });
}

function toast(message, error = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function scheduleSave(message = '저장됨') {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            const response = await runtimeMessage({ type: 'CNT_SAVE_SETTINGS', settings });
            settings = API.normalizeSettings(response.settings);
            render();
            toast(message);
        } catch (error) {
            toast(error.message, true);
        }
    }, 120);
}

function exactRule() {
    return settings.sites.find((rule) => rule.source === 'custom' && rule.domain === currentHost && !rule.includeSubdomains) || null;
}

function ensureRule(enabled) {
    const result = API.ensureExactRule(settings, currentHost, enabled);
    settings = result.settings;
    return settings.sites.find((rule) => rule.id === result.rule.id);
}

function editableStyle() {
    if (scope === 'global') return settings.defaults;
    return exactRule()?.overrides || {};
}

function effective() {
    return API.resolveForHost(settings, currentHost);
}

function setScope(next) {
    if (next === 'site' && !currentHost) return;
    scope = next;
    render();
}

function updateStyle(property, value) {
    if (scope === 'global') settings.defaults[property] = value;
    else ensureRule().overrides[property] = value;
    renderStyle();
    scheduleSave();
}

function inherit(property) {
    const rule = exactRule();
    if (!rule) return;
    delete rule.overrides[property];
    renderStyle();
    scheduleSave('기본값으로 변경됨');
}

function renderHeader() {
    const resolved = effective();
    const exact = exactRule();
    $('masterToggle').disabled = false;
    $('masterToggle').checked = settings.globalEnabled;
    $('masterStateText').textContent = settings.globalEnabled ? '켜짐' : '꺼짐';

    $('currentSiteTitle').textContent = currentHost || '지원하지 않는 페이지';
    $('siteToggle').disabled = !currentHost;
    $('siteToggle').checked = Boolean(exact?.enabled ?? resolved.matchedRule?.enabled);
    $('siteStatusDot').className = `status-dot ${resolved.active ? 'active' : currentHost ? 'blocked' : ''}`;
    $('effectiveStatus').textContent = resolved.active ? '적용 중' : settings.globalEnabled ? '미적용' : '전체 꺼짐';
    $('siteToggleHint').textContent = exact
        ? '이 호스트의 정확한 예외 규칙입니다.'
        : resolved.matchedRule
            ? `${resolved.matchedRule.domain} 규칙을 상속 중입니다.`
            : '이 주소에만 별도로 적용합니다.';

    $('scopeSite').disabled = !currentHost;
    $('scopeGlobal').classList.toggle('active', scope === 'global');
    $('scopeSite').classList.toggle('active', scope === 'site');
    $('scopeGlobal').setAttribute('aria-pressed', String(scope === 'global'));
    $('scopeSite').setAttribute('aria-pressed', String(scope === 'site'));
}

function renderStyle() {
    const own = editableStyle();
    const style = scope === 'global' ? settings.defaults : {
        ...settings.defaults,
        ...own
    };

    document.querySelectorAll('input[name="fontId"]').forEach((input) => {
        input.checked = input.value === style.fontId || (input.value === 'myeongjo' && style.fontId === 'nanum');
    });

    const size = style.fontSize;
    const weight = style.fontWeight;
    $('sizeSlider').value = size;
    $('sizeValue').textContent = `${size}%`;
    $('sizeSlider').style.setProperty('--range-fill', `${((size - 75) / 75) * 100}%`);
    $('sizeSlider').setAttribute('aria-valuetext', `${size}퍼센트`);
    $('weightSlider').value = weight;
    $('weightValue').textContent = String(weight);
    $('weightSlider').style.setProperty('--range-fill', `${((weight - 100) / 800) * 100}%`);
    $('requestedWeight').textContent = String(weight);
    $('actualWeight').textContent = String(API.snapWeight(style.fontId, weight));

    document.querySelectorAll('.quick-button').forEach((button) => {
        button.classList.toggle('active', Number(button.dataset.size) === size);
    });

    $('sizeContext').textContent = scope === 'global' ? '전체 기본 배율' : `${currentHost} 유효 배율`;
    $('weightContext').textContent = scope === 'global' ? '전체 기본 굵기' : `${currentHost} 유효 굵기`;
    $('inheritFont').hidden = scope !== 'site' || !('fontId' in own);
    $('inheritSize').hidden = scope !== 'site' || !('fontSize' in own);
    $('inheritWeight').hidden = scope !== 'site' || !('fontWeight' in own);
    $('inheritAll').hidden = scope !== 'site' || !Object.keys(own).length;

    const preview = $('livePreview');
    preview.dataset.font = style.fontId;
    preview.dataset.weight = API.snapWeight(style.fontId, weight);
    preview.style.fontSize = `${Math.max(12, 15 * size / 100)}px`;
    $('app').dataset.previewFont = style.fontId;
    $('app').dataset.previewWeight = String(API.snapWeight(style.fontId, weight));
}

function makeSwitch(checked, label, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'mini-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'visually-hidden';
    input.checked = checked;
    input.setAttribute('aria-label', label);
    const track = document.createElement('span');
    track.className = 'switch-track';
    track.innerHTML = '<span class="switch-thumb"></span>';
    input.addEventListener('change', () => onChange(input.checked));
    wrapper.append(input, track);
    return wrapper;
}

function renderPresets() {
    const list = $('presetList');
    list.replaceChildren();
    for (const preset of API.PRESETS) {
        const rule = settings.sites.find((item) => item.id === preset.id);
        const item = document.createElement('div');
        item.className = 'preset-item';
        const copy = document.createElement('div');
        copy.className = 'preset-copy';
        const title = document.createElement('strong');
        title.textContent = preset.name;
        const domain = document.createElement('small');
        domain.textContent = preset.domain;
        copy.append(title, domain);
        item.append(copy, makeSwitch(Boolean(rule?.enabled), `${preset.name} 적용`, (checked) => {
            const target = settings.sites.find((entry) => entry.id === preset.id);
            target.enabled = checked;
            scheduleSave();
            render();
        }));
        list.append(item);
    }
}

function renderRules() {
    const query = $('siteSearch').value.trim().toLowerCase();
    const rules = settings.sites
        .filter((rule) => rule.source === 'custom')
        .filter((rule) => !query || rule.domain.includes(query));
    const list = $('ruleList');
    list.replaceChildren();
    $('ruleEmpty').hidden = rules.length > 0;
    $('siteCount').textContent = String(settings.sites.filter((rule) => rule.source === 'custom').length);

    for (const rule of rules) {
        const item = document.createElement('div');
        item.className = 'rule-item';
        const copy = document.createElement('div');
        copy.className = 'rule-copy';
        const title = document.createElement('strong');
        title.textContent = rule.includeSubdomains ? `*.${rule.domain}` : rule.domain;
        const meta = document.createElement('small');
        meta.className = 'rule-meta';
        meta.textContent = Object.keys(rule.overrides).length ? '사이트별 스타일 있음' : '기본 스타일 사용';
        copy.append(title, meta);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-button';
        del.textContent = '×';
        del.setAttribute('aria-label', `${rule.domain} 삭제`);
        del.addEventListener('click', () => {
            settings = API.removeRule(settings, rule.id);
            if (currentHost === rule.domain) scope = 'global';
            scheduleSave('규칙 삭제됨');
            render();
        });
        item.append(copy, makeSwitch(rule.enabled, `${rule.domain} 적용`, (checked) => {
            rule.enabled = checked;
            scheduleSave();
            render();
        }), del);
        list.append(item);
    }
}

function renderSettings() {
    $('protectIcons').checked = settings.behavior.protectIcons;
    $('protectCode').checked = settings.behavior.protectCode;
    $('manifestVersion').textContent = `v${chrome.runtime.getManifest().version}`;
}

function render() {
    renderHeader();
    renderStyle();
    renderPresets();
    renderRules();
    renderSettings();
}

function bindTabs() {
    const tabs = [...document.querySelectorAll('.tab-button')];
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next].focus();
            selectTab(tabs[next]);
        });
    });

    function selectTab(selected) {
        tabs.forEach((tab) => {
            const active = tab === selected;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            const panel = $(tab.getAttribute('aria-controls'));
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });
    }
}

function bindEvents() {
    bindTabs();
    $('scopeGlobal').addEventListener('click', () => setScope('global'));
    $('scopeSite').addEventListener('click', () => setScope('site'));
    $('masterToggle').addEventListener('change', (event) => {
        settings.globalEnabled = event.target.checked;
        scheduleSave();
        render();
    });
    $('siteToggle').addEventListener('change', (event) => {
        ensureRule(event.target.checked);
        scope = 'site';
        scheduleSave();
        render();
    });
    document.querySelectorAll('input[name="fontId"]').forEach((input) => {
        input.addEventListener('change', () => updateStyle('fontId', API.canonicalFontId(input.value)));
    });
    $('sizeSlider').addEventListener('input', (event) => updateStyle('fontSize', Number(event.target.value)));
    $('weightSlider').addEventListener('input', (event) => updateStyle('fontWeight', Number(event.target.value)));
    document.querySelectorAll('.quick-button').forEach((button) => {
        button.addEventListener('click', () => updateStyle('fontSize', Number(button.dataset.size)));
    });
    $('inheritFont').addEventListener('click', () => inherit('fontId'));
    $('inheritSize').addEventListener('click', () => inherit('fontSize'));
    $('inheritWeight').addEventListener('click', () => inherit('fontWeight'));
    $('inheritAll').addEventListener('click', () => {
        const rule = exactRule();
        if (!rule) return;
        rule.overrides = {};
        renderStyle();
        scheduleSave('사이트 스타일 초기화됨');
    });
    $('protectIcons').addEventListener('change', (event) => {
        settings.behavior.protectIcons = event.target.checked;
        scheduleSave();
    });
    $('protectCode').addEventListener('change', (event) => {
        settings.behavior.protectCode = event.target.checked;
        scheduleSave();
    });
    $('addCurrentSite').addEventListener('click', () => {
        ensureRule(true);
        scope = 'site';
        scheduleSave('현재 사이트 추가됨');
        render();
    });
    $('addSiteForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const parsed = API.parseDomainInput($('siteInput').value);
        if (!parsed.domain) {
            $('siteInput').setAttribute('aria-invalid', 'true');
            $('siteInputMessage').textContent = '올바른 URL 또는 도메인을 입력하세요.';
            $('siteInputMessage').classList.add('error');
            return;
        }
        $('siteInput').removeAttribute('aria-invalid');
        $('siteInputMessage').classList.remove('error');
        const duplicate = settings.sites.some((rule) => rule.source === 'custom' && rule.domain === parsed.domain && rule.includeSubdomains === parsed.includeSubdomains);
        if (duplicate) return toast('이미 같은 규칙이 있습니다.', true);
        settings.sites.push({
            id: API.createRuleId('custom'),
            domain: parsed.domain,
            enabled: true,
            includeSubdomains: parsed.includeSubdomains,
            source: 'custom',
            overrides: {}
        });
        $('siteInput').value = '';
        scheduleSave('사이트 규칙 추가됨');
        render();
    });
    $('siteSearch').addEventListener('input', renderRules);
    $('resetSettings').addEventListener('click', async () => {
        if (!confirm('모든 CNT 설정을 초기화할까요?')) return;
        try {
            const response = await runtimeMessage({ type: 'CNT_RESET_SETTINGS' });
            settings = API.normalizeSettings(response.settings);
            scope = 'global';
            render();
            toast('설정 초기화 완료');
        } catch (error) {
            toast(error.message, true);
        }
    });
}

async function initialize() {
    bindEvents();
    try {
        const [response, tab] = await Promise.all([
            runtimeMessage({ type: 'CNT_GET_SETTINGS' }),
            activeTab()
        ]);
        settings = API.normalizeSettings(response.settings);
        try {
            const url = new URL(tab?.url || '');
            if (['http:', 'https:', 'file:'].includes(url.protocol)) currentHost = API.normalizeHostname(url.hostname || 'localhost');
        } catch (_) {
            currentHost = '';
        }
        $('addCurrentSite').disabled = !currentHost;
        $('addCurrentSiteText').textContent = currentHost ? `${currentHost} 추가` : '현재 사이트 추가';
        $('loadingState').hidden = true;
        $('workspace').hidden = false;
        $('app').dataset.loading = 'false';
        render();
    } catch (error) {
        $('loadingState').hidden = true;
        $('workspace').hidden = false;
        toast(error.message, true);
    }
}

document.addEventListener('DOMContentLoaded', initialize, { once: true });
