// popup.js — CNT Paperozi Font Changer
// CSP 규정 준수: 모든 JS는 이 외부 파일에서만 실행

'use strict';

// ── 프리셋 메타데이터 ──
const PRESET_META = {
    roblox:    { icon: '🎮', name: 'Roblox',     domain: 'roblox.com' },
    youtube:   { icon: '▶',  name: 'YouTube',     domain: 'youtube.com' },
    twitter:   { icon: '✕',  name: 'X / Twitter', domain: 'twitter.com' },
    naver:     { icon: '🟢', name: 'Naver',       domain: 'naver.com' },
    github:    { icon: '🐙', name: 'GitHub',      domain: 'github.com' },
    google:    { icon: '🔍', name: 'Google',      domain: 'google.com' },
    discord:   { icon: '💬', name: 'Discord',     domain: 'discord.com' },
    instagram: { icon: '📷', name: 'Instagram',   domain: 'instagram.com' },
    notion:    { icon: '📝', name: 'Notion',      domain: 'notion.so' },
    reddit:    { icon: '🔴', name: 'Reddit',      domain: 'reddit.com' },
};

// 굵기 샘플
const WEIGHTS = [
    { w: 100, label: 'Thin 100' },
    { w: 200, label: 'ExtraLight 200' },
    { w: 300, label: 'Light 300' },
    { w: 400, label: 'Regular 400' },
    { w: 500, label: 'Medium 500' },
    { w: 600, label: 'SemiBold 600' },
    { w: 700, label: 'Bold 700' },
    { w: 800, label: 'ExtraBold 800' },
    { w: 900, label: 'Black 900' },
];

// ── 상태 ──
let settings = null;
let currentDomain = '';

// ── DOM 참조 ──
const $ = (id) => document.getElementById(id);

// ── 유틸 ──
function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function save(callback) {
    chrome.storage.sync.set({ cnt: settings }, () => {
        // 현재 탭 content script에 즉시 반영
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'CNT_UPDATE',
                    settings
                }).catch(() => {});
            }
        });
        if (callback) callback();
    });
}

function cleanDomain(input) {
    return input.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0];
}

function matchDomain(hostname, target) {
    const h = hostname.replace(/^www\./, '');
    return h === target || h.endsWith('.' + target);
}

function isSiteActive(domain) {
    if (!settings) return false;
    const presets = settings.presets || {};
    for (const k of Object.keys(presets)) {
        if (presets[k].enabled && matchDomain(domain, presets[k].domain)) return true;
    }
    for (const s of (settings.customSites || [])) {
        if (s.enabled && matchDomain(domain, s.domain)) return true;
    }
    return false;
}

// ── 탭 전환 ──
function initTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            const panelId = 'panel-' + tab.dataset.tab;
            const panel = document.getElementById(panelId);
            if (panel) panel.classList.add('active');
        });
    });
}

// ── 마스터 토글 ──
function initMasterToggle() {
    const el = $('masterToggle');
    const txt = $('masterText');
    el.addEventListener('change', () => {
        settings.globalEnabled = el.checked;
        txt.textContent = el.checked ? 'ON' : 'OFF';
        save();
        toast(el.checked ? '폰트 적용 ON' : '폰트 적용 OFF');
    });
}

// ── 현재 사이트 바 ──
function initSiteBar() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].url) return;
        let url;
        try { url = new URL(tabs[0].url); } catch (_) { return; }
        if (url.protocol.startsWith('chrome')) return;

        currentDomain = url.hostname.replace(/^www\./, '');
        $('siteDomain').textContent = currentDomain;

        const active = isSiteActive(currentDomain);
        const indicator = $('siteIndicator');
        const toggle = $('siteToggle');
        toggle.checked = active;
        if (active) indicator.classList.add('active');

        // 사이트 크기 슬라이더 초기값
        const sizes = settings.siteFontSizes || {};
        const siteSize = sizes[currentDomain] != null ? sizes[currentDomain] : settings.fontSize;
        $('siteSlider').value = siteSize;
        $('siteVal').textContent = siteSize + '%';
        $('siteSliderName').textContent = currentDomain || '이 사이트만 적용';

        toggle.addEventListener('change', () => {
            // 이미 프리셋이나 커스텀에 있으면 그 쪽에서 토글,
            // 없으면 customSites에 추가해서 켜줌
            let found = false;

            const presets = settings.presets || {};
            for (const k of Object.keys(presets)) {
                if (matchDomain(currentDomain, presets[k].domain)) {
                    presets[k].enabled = toggle.checked;
                    found = true;
                    break;
                }
            }

            if (!found) {
                const customs = settings.customSites || [];
                const ci = customs.findIndex((s) => matchDomain(currentDomain, s.domain));
                if (ci >= 0) {
                    customs[ci].enabled = toggle.checked;
                    found = true;
                }
            }

            if (!found && toggle.checked) {
                if (!settings.customSites) settings.customSites = [];
                settings.customSites.push({ domain: currentDomain, enabled: true });
            }

            if (toggle.checked) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }

            save();
            renderCustomList();
            toast(toggle.checked ? `${currentDomain} ON` : `${currentDomain} OFF`);
        });
    });
}

// ── 프리셋 렌더 ──
function renderPresets() {
    const grid = $('presetGrid');
    grid.innerHTML = '';

    Object.keys(PRESET_META).forEach((key) => {
        const meta = PRESET_META[key];
        const preset = settings.presets[key] || { domain: meta.domain, enabled: false };
        const on = !!preset.enabled;

        const card = document.createElement('div');
        card.className = 'preset-card' + (on ? ' on' : '');

        // 왼쪽 정보
        const left = document.createElement('div');
        left.className = 'preset-card-left';

        const icon = document.createElement('span');
        icon.className = 'preset-icon';
        icon.textContent = meta.icon;

        const info = document.createElement('div');
        info.style.minWidth = '0';
        const name = document.createElement('div');
        name.className = 'preset-name';
        name.textContent = meta.name;
        const domain = document.createElement('div');
        domain.className = 'preset-domain';
        domain.textContent = meta.domain;
        info.appendChild(name);
        info.appendChild(domain);

        left.appendChild(icon);
        left.appendChild(info);

        // 미니 토글
        const label = document.createElement('label');
        label.className = 'mini-toggle';

        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = on;

        const track = document.createElement('span');
        track.className = 'mini-track';
        const thumb = document.createElement('span');
        thumb.className = 'mini-thumb';
        track.appendChild(thumb);

        label.appendChild(inp);
        label.appendChild(track);

        inp.addEventListener('change', () => {
            if (!settings.presets[key]) settings.presets[key] = { ...meta };
            settings.presets[key].enabled = inp.checked;
            card.className = 'preset-card' + (inp.checked ? ' on' : '');
            save();
            toast(`${meta.name} ${inp.checked ? 'ON' : 'OFF'}`);
            // 사이트 바 인디케이터도 갱신
            if (currentDomain && matchDomain(currentDomain, meta.domain)) {
                const ind = $('siteIndicator');
                const sToggle = $('siteToggle');
                if (inp.checked) { ind.classList.add('active'); sToggle.checked = true; }
                else { ind.classList.remove('active'); sToggle.checked = false; }
            }
        });

        card.appendChild(left);
        card.appendChild(label);
        grid.appendChild(card);
    });
}

// ── 커스텀 사이트 렌더 ──
function renderCustomList() {
    const list = $('customList');
    const empty = $('customEmpty');
    const customs = settings.customSites || [];

    // 기존 custom-item만 제거
    list.querySelectorAll('.custom-item').forEach((el) => el.remove());

    if (!customs.length) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    customs.forEach((site, i) => {
        const item = document.createElement('div');
        item.className = 'custom-item' + (site.enabled ? ' on' : '');

        const domainSpan = document.createElement('span');
        domainSpan.className = 'custom-domain';
        domainSpan.textContent = site.domain;

        const label = document.createElement('label');
        label.className = 'mini-toggle';
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = !!site.enabled;
        const track = document.createElement('span');
        track.className = 'mini-track';
        const thumb = document.createElement('span');
        thumb.className = 'mini-thumb';
        track.appendChild(thumb);
        label.appendChild(inp);
        label.appendChild(track);

        inp.addEventListener('change', () => {
            settings.customSites[i].enabled = inp.checked;
            item.className = 'custom-item' + (inp.checked ? ' on' : '');
            save();
            toast(`${site.domain} ${inp.checked ? 'ON' : 'OFF'}`);
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'del-btn';
        delBtn.textContent = '✕';
        delBtn.title = '삭제';
        delBtn.addEventListener('click', () => {
            settings.customSites.splice(i, 1);
            save();
            renderCustomList();
            toast(`${site.domain} 삭제됨`);
        });

        item.appendChild(domainSpan);
        item.appendChild(label);
        item.appendChild(delBtn);
        list.appendChild(item);
    });
}

// ── 사이트 추가 ──
function initAddSite() {
    const btn = $('addBtn');
    const input = $('addInput');

    function doAdd() {
        const domain = cleanDomain(input.value);
        if (!domain) return;
        if (!settings.customSites) settings.customSites = [];
        if (settings.customSites.some((s) => s.domain === domain)) {
            toast('이미 추가된 사이트입니다');
            return;
        }
        settings.customSites.push({ domain, enabled: true });
        save();
        renderCustomList();
        input.value = '';
        toast(`${domain} 추가됨`);
    }

    btn.addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doAdd();
    });
}

// ── 슬라이더 ──
function initSliders() {
    const gSlider = $('globalSlider');
    const gVal = $('globalVal');
    const sSlider = $('siteSlider');
    const sVal = $('siteVal');

    gSlider.addEventListener('input', () => {
        const v = parseInt(gSlider.value);
        gVal.textContent = v + '%';
        settings.fontSize = v;
        save();
    });

    sSlider.addEventListener('input', () => {
        const v = parseInt(sSlider.value);
        sVal.textContent = v + '%';
        if (!currentDomain) return;
        if (!settings.siteFontSizes) settings.siteFontSizes = {};
        settings.siteFontSizes[currentDomain] = v;
        save();
    });
}

// ── 굵기 미리보기 렌더 ──
function renderWeights() {
    const list = $('weightList');
    list.innerHTML = '';
    WEIGHTS.forEach((w) => {
        const item = document.createElement('div');
        item.className = 'weight-item';

        const sample = document.createElement('span');
        sample.className = 'weight-sample';
        sample.style.fontWeight = w.w;
        sample.textContent = 'Paperozi — ' + w.label.split(' ')[0];

        const tag = document.createElement('span');
        tag.className = 'weight-tag';
        tag.textContent = w.w;

        item.appendChild(sample);
        item.appendChild(tag);
        list.appendChild(item);
    });
}

// ── 초기화 버튼 ──
function initReset() {
    $('resetBtn').addEventListener('click', () => {
        if (!confirm('모든 설정을 초기화할까요?')) return;
        chrome.storage.sync.remove('cnt', () => {
            toast('초기화 완료');
            setTimeout(() => location.reload(), 800);
        });
    });
}

// ── 초기 설정 로드 후 전체 UI 렌더 ──
function initUI() {
    // 마스터 토글 반영
    $('masterToggle').checked = settings.globalEnabled;
    $('masterText').textContent = settings.globalEnabled ? 'ON' : 'OFF';

    // 전체 글자 크기 슬라이더
    const gSize = settings.fontSize || 100;
    $('globalSlider').value = gSize;
    $('globalVal').textContent = gSize + '%';

    // presets 보완
    if (!settings.presets) settings.presets = {};
    Object.keys(PRESET_META).forEach((key) => {
        if (!settings.presets[key]) {
            settings.presets[key] = {
                domain: PRESET_META[key].domain,
                enabled: key === 'roblox'
            };
        }
    });

    if (!settings.customSites) settings.customSites = [];
    if (!settings.siteFontSizes) settings.siteFontSizes = {};

    renderPresets();
    renderCustomList();
    renderWeights();
}

// ── 엔트리포인트 ──
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initMasterToggle();
    initAddSite();
    initSliders();
    initReset();

    chrome.storage.sync.get('cnt', (data) => {
        settings = data.cnt || {
            globalEnabled: true,
            fontSize: 100,
            customSites: [],
            presets: {},
            siteFontSizes: {}
        };
        initUI();
        initSiteBar(); // settings 로드 후에 실행해야 isSiteActive가 올바르게 동작
    });
});
