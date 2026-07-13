'use strict';

const API = globalThis.CNT;
const $ = (id) => document.getElementById(id);

let settings = API?.createDefaultSettings?.() || null;
let currentHost = '';
let activeTabId = null;
let scope = 'global';
let saveTimer = 0;
let previewFrame = 0;
let revision = 0;
let saving = false;
let dirty = false;
let pendingToast = '저장됨';

function runtimeMessage(message, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('백그라운드 응답이 없습니다. 확장 프로그램을 다시 로드하세요.'));
        }, timeoutMs);

        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.ok) {
                    reject(new Error(response?.error || '요청을 처리하지 못했습니다.'));
                    return;
                }
                resolve(response);
            });
        } catch (error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        }
    });
}

function activeTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                resolve(null);
                return;
            }
            resolve(tabs?.[0] || null);
        });
    });
}

function toast(message, error = false) {
    const element = $('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', error);
    element.classList.add('show');
    clearTimeout(element._timer);
    element._timer = setTimeout(() => element.classList.remove('show'), 1800);
}

function exactRule() {
    if (!settings || !currentHost) return null;
    return settings.sites.find((rule) =>
        rule.source === 'custom' &&
        rule.domain === currentHost &&
        rule.includeSubdomains === false
    ) || null;
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

function sendPreviewNow() {
    previewFrame = 0;
    if (!Number.isInteger(activeTabId) || !currentHost) return;

    const resolved = effective();
    try {
        chrome.tabs.sendMessage(activeTabId, {
            type: 'CNT_PREVIEW',
            resolved
        }, () => {
            void chrome.runtime.lastError;
        });
    } catch (_) {
        // Pages without a content script are intentionally ignored.
    }
}

function queuePreview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(sendPreviewNow);
}

function markDirty(message = '저장됨', immediate = false) {
    revision += 1;
    dirty = true;
    pendingToast = message;
    queuePreview();

    clearTimeout(saveTimer);
    if (immediate) {
        void flushSave();
    } else {
        saveTimer = setTimeout(() => void flushSave(), 260);
    }
}

async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!dirty || saving || !settings) return;

    const savedRevision = revision;
    const snapshot = API.deepClone(settings);
    const successMessage = pendingToast;
    let failed = false;
    dirty = false;
    saving = true;

    try {
        const response = await runtimeMessage({
            type: 'CNT_SAVE_SETTINGS',
            settings: snapshot
        });

        if (revision === savedRevision) {
            settings = API.normalizeSettings(response.settings);
            render();
            toast(successMessage);
        }
    } catch (error) {
        dirty = true;
        failed = true;
        toast(error.message, true);
    } finally {
        saving = false;
        if (dirty && !failed) {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => void flushSave(), 120);
        }
    }
}

function setScope(nextScope) {
    if (nextScope === 'site' && !currentHost) return;
    scope = nextScope;
    renderHeader();
    renderStyle();
}

function updateStyle(property, value, immediate = false) {
    if (scope === 'global') {
        settings.defaults[property] = value;
    } else {
        ensureRule(true).overrides[property] = value;
    }
    renderStyle();
    markDirty('저장됨', immediate);
}

function inherit(property) {
    const rule = exactRule();
    if (!rule || !(property in rule.overrides)) return;
    delete rule.overrides[property];
    renderStyle();
    markDirty('기본값으로 변경됨', true);
}

function renderHeader() {
    const resolved = effective();
    const exact = exactRule();
    const masterToggle = $('masterToggle');
    const siteToggle = $('siteToggle');
    const statusBadge = $('effectiveStatus');

    masterToggle.disabled = false;
    masterToggle.checked = settings.globalEnabled;
    $('masterStateText').textContent = settings.globalEnabled ? '모든 사이트 적용' : '전체 중지';

    $('currentSiteTitle').textContent = currentHost || '지원하지 않는 페이지';
    siteToggle.disabled = !currentHost;
    siteToggle.checked = resolved.active;

    $('siteStatusDot').className = `status-dot ${resolved.active ? 'active' : currentHost ? 'blocked' : ''}`;
    statusBadge.className = `status-badge ${resolved.active ? 'active' : settings.globalEnabled ? 'blocked' : 'inactive'}`;
    statusBadge.textContent = resolved.active ? '즉시 적용 중' : settings.globalEnabled ? '이 사이트 제외' : '전체 꺼짐';

    if (exact?.enabled === false) {
        $('siteToggleHint').textContent = '이 호스트만 폰트 적용에서 제외했습니다.';
    } else if (exact?.enabled === true) {
        $('siteToggleHint').textContent = '이 호스트의 개별 설정을 사용합니다.';
    } else if (resolved.matchedRule) {
        $('siteToggleHint').textContent = `${resolved.matchedRule.domain} 규칙을 사용합니다.`;
    } else {
        $('siteToggleHint').textContent = '전체 기본 설정을 바로 적용합니다.';
    }

    $('scopeSite').disabled = !currentHost;
    $('scopeGlobal').classList.toggle('active', scope === 'global');
    $('scopeSite').classList.toggle('active', scope === 'site');
    $('scopeGlobal').setAttribute('aria-pressed', String(scope === 'global'));
    $('scopeSite').setAttribute('aria-pressed', String(scope === 'site'));
}

function renderStyle() {
    const own = editableStyle();
    const style = scope === 'global'
        ? settings.defaults
        : { ...settings.defaults, ...own };

    document.querySelectorAll('input[name="fontId"]').forEach((input) => {
        input.checked = input.value === style.fontId || (input.value === 'myeongjo' && style.fontId === 'nanum');
    });

    const size = style.fontSize;
    const weight = style.fontWeight;
    const actualWeight = API.snapWeight(style.fontId, weight);

    $('sizeSlider').value = String(size);
    $('sizeValue').textContent = `${size}%`;
    $('sizeSlider').style.setProperty('--range-fill', `${((size - 75) / 75) * 100}%`);
    $('sizeSlider').setAttribute('aria-valuetext', `${size}퍼센트`);

    $('weightSlider').value = String(weight);
    $('weightValue').textContent = String(weight);
    $('weightSlider').style.setProperty('--range-fill', `${((weight - 100) / 800) * 100}%`);
    $('weightSlider').setAttribute('aria-valuetext', `${weight}`);
    $('requestedWeight').textContent = String(weight);
    $('actualWeight').textContent = String(actualWeight);

    document.querySelectorAll('.quick-button').forEach((button) => {
        button.classList.toggle('active', Number(button.dataset.size) === size);
    });

    $('sizeContext').textContent = scope === 'global' ? '모든 사이트 기본 배율' : `${currentHost} 개별 배율`;
    $('weightContext').textContent = scope === 'global' ? '기존 굵기를 기준으로 보정' : `${currentHost} 개별 굵기`;
    $('inheritFont').hidden = scope !== 'site' || !('fontId' in own);
    $('inheritSize').hidden = scope !== 'site' || !('fontSize' in own);
    $('inheritWeight').hidden = scope !== 'site' || !('fontWeight' in own);
    $('inheritAll').hidden = scope !== 'site' || !Object.keys(own).length;

    const preview = $('livePreview');
    preview.dataset.font = style.fontId;
    preview.dataset.weight = String(actualWeight);
    preview.style.fontSize = `${Math.max(12, 15 * size / 100)}px`;
    $('app').dataset.previewFont = style.fontId;
    $('app').dataset.previewWeight = String(actualWeight);
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
    const thumb = document.createElement('span');
    thumb.className = 'switch-thumb';
    track.append(thumb);

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

        item.append(copy, makeSwitch(Boolean(rule?.enabled), `${preset.name} 명시 규칙`, (checked) => {
            const target = settings.sites.find((entry) => entry.id === preset.id);
            target.enabled = checked;
            renderHeader();
            markDirty(`${preset.name} 규칙 변경됨`, true);
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
        item.className = `rule-item${rule.enabled ? '' : ' rule-disabled'}`;

        const copy = document.createElement('div');
        copy.className = 'rule-copy';
        const title = document.createElement('strong');
        title.textContent = rule.includeSubdomains ? `*.${rule.domain}` : rule.domain;
        const meta = document.createElement('small');
        meta.className = 'rule-meta';
        meta.textContent = rule.enabled
            ? Object.keys(rule.overrides).length ? '개별 스타일 적용' : '전체 기본값 사용'
            : '이 사이트 제외';
        copy.append(title, meta);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'delete-button';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `${rule.domain} 규칙 삭제`);
        removeButton.addEventListener('click', () => {
            settings = API.removeRule(settings, rule.id);
            if (currentHost === rule.domain) scope = 'global';
            render();
            markDirty('규칙 삭제됨', true);
        });

        item.append(copy, makeSwitch(rule.enabled, `${rule.domain} 적용`, (checked) => {
            rule.enabled = checked;
            render();
            markDirty(checked ? '사이트 적용 켜짐' : '사이트 제외됨', true);
        }), removeButton);
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

    function selectTab(selected) {
        tabs.forEach((tab) => {
            const selectedNow = tab === selected;
            tab.classList.toggle('active', selectedNow);
            tab.setAttribute('aria-selected', String(selectedNow));
            tab.tabIndex = selectedNow ? 0 : -1;
            const panel = $(tab.getAttribute('aria-controls'));
            panel.hidden = !selectedNow;
            panel.classList.toggle('active', selectedNow);
            if (selectedNow) panel.scrollTop = 0;
        });
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const next = (index + direction + tabs.length) % tabs.length;
            tabs[next].focus();
            selectTab(tabs[next]);
        });
    });
}

function bindEvents() {
    bindTabs();

    $('scopeGlobal').addEventListener('click', () => setScope('global'));
    $('scopeSite').addEventListener('click', () => setScope('site'));

    $('masterToggle').addEventListener('change', (event) => {
        settings.globalEnabled = event.target.checked;
        renderHeader();
        markDirty(event.target.checked ? '전체 적용 켜짐' : '전체 적용 꺼짐', true);
    });

    $('siteToggle').addEventListener('change', (event) => {
        ensureRule(event.target.checked);
        scope = 'site';
        render();
        markDirty(event.target.checked ? '이 사이트 적용 켜짐' : '이 사이트 제외됨', true);
    });

    document.querySelectorAll('input[name="fontId"]').forEach((input) => {
        input.addEventListener('change', () => {
            updateStyle('fontId', API.canonicalFontId(input.value), true);
        });
    });

    $('sizeSlider').addEventListener('input', (event) => {
        updateStyle('fontSize', Number(event.target.value));
    });
    $('sizeSlider').addEventListener('change', () => void flushSave());

    $('weightSlider').addEventListener('input', (event) => {
        updateStyle('fontWeight', Number(event.target.value));
    });
    $('weightSlider').addEventListener('change', () => void flushSave());

    document.querySelectorAll('.quick-button').forEach((button) => {
        button.addEventListener('click', () => {
            updateStyle('fontSize', Number(button.dataset.size), true);
        });
    });

    $('inheritFont').addEventListener('click', () => inherit('fontId'));
    $('inheritSize').addEventListener('click', () => inherit('fontSize'));
    $('inheritWeight').addEventListener('click', () => inherit('fontWeight'));
    $('inheritAll').addEventListener('click', () => {
        const rule = exactRule();
        if (!rule) return;
        rule.overrides = {};
        renderStyle();
        markDirty('사이트별 스타일 초기화됨', true);
    });

    $('protectIcons').addEventListener('change', (event) => {
        settings.behavior.protectIcons = event.target.checked;
        markDirty('아이콘 보호 설정 변경됨', true);
    });

    $('protectCode').addEventListener('change', (event) => {
        settings.behavior.protectCode = event.target.checked;
        markDirty('코드 보호 설정 변경됨', true);
    });

    $('addCurrentSite').addEventListener('click', () => {
        ensureRule(true);
        scope = 'site';
        render();
        markDirty('현재 사이트 규칙 추가됨', true);
    });

    $('addSiteForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = $('siteInput');
        const message = $('siteInputMessage');
        const parsed = API.parseDomainInput(input.value);

        if (!parsed.domain) {
            input.setAttribute('aria-invalid', 'true');
            message.textContent = '올바른 URL 또는 도메인을 입력하세요.';
            message.classList.add('error');
            return;
        }

        input.removeAttribute('aria-invalid');
        message.classList.remove('error');
        message.textContent = '주소를 붙여 넣으면 호스트만 안전하게 정리합니다.';

        const duplicate = settings.sites.some((rule) =>
            rule.source === 'custom' &&
            rule.domain === parsed.domain &&
            rule.includeSubdomains === parsed.includeSubdomains
        );
        if (duplicate) {
            toast('이미 같은 규칙이 있습니다.', true);
            return;
        }

        settings.sites.push({
            id: API.createRuleId('custom'),
            domain: parsed.domain,
            enabled: true,
            includeSubdomains: parsed.includeSubdomains,
            source: 'custom',
            overrides: {}
        });
        input.value = '';
        render();
        markDirty('사이트 규칙 추가됨', true);
    });

    $('siteSearch').addEventListener('input', renderRules);

    $('resetSettings').addEventListener('click', async () => {
        if (!confirm('모든 CNT 설정을 초기화할까요?')) return;
        try {
            const response = await runtimeMessage({ type: 'CNT_RESET_SETTINGS' });
            settings = API.normalizeSettings(response.settings);
            revision += 1;
            dirty = false;
            scope = 'global';
            render();
            queuePreview();
            toast('설정 초기화 완료');
        } catch (error) {
            toast(error.message, true);
        }
    });

    window.addEventListener('pagehide', () => {
        if (dirty) void flushSave();
    });
}

async function initialize() {
    if (!API) {
        throw new Error('shared.js를 불러오지 못했습니다. 확장 프로그램을 다시 설치하세요.');
    }

    bindEvents();
    const [response, tab] = await Promise.all([
        runtimeMessage({ type: 'CNT_GET_SETTINGS' }),
        activeTab()
    ]);

    settings = API.normalizeSettings(response.settings);
    activeTabId = Number.isInteger(tab?.id) ? tab.id : null;

    try {
        const url = new URL(tab?.url || '');
        if (['http:', 'https:'].includes(url.protocol)) {
            currentHost = API.normalizeHostname(url.hostname);
        } else if (url.protocol === 'file:') {
            currentHost = 'local-file';
        }
    } catch (_) {
        currentHost = '';
    }

    $('addCurrentSite').disabled = !currentHost;
    $('addCurrentSiteText').textContent = currentHost ? `${currentHost} 규칙 추가` : '현재 사이트 추가';
    $('loadingState').hidden = true;
    $('workspace').hidden = false;
    $('app').dataset.loading = 'false';
    render();
}

document.addEventListener('DOMContentLoaded', () => {
    initialize().catch((error) => {
        $('loadingState').hidden = true;
        $('workspace').hidden = false;
        toast(error.message, true);
    });
}, { once: true });
