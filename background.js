'use strict';

importScripts('shared.js');

const API = globalThis.CNT;
const STORAGE_KEY = API.STORAGE_KEY;
const CACHE_KEY = API.CACHE_KEY;

function getFromStorage(area, keys) {
    return new Promise((resolve) => {
        area.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                resolve({});
                return;
            }
            resolve(result || {});
        });
    });
}

function setInStorage(area, values) {
    return new Promise((resolve, reject) => {
        area.set(values, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function queryTabs(queryInfo) {
    return new Promise((resolve) => {
        chrome.tabs.query(queryInfo, (tabs) => {
            if (chrome.runtime.lastError) {
                resolve([]);
                return;
            }
            resolve(Array.isArray(tabs) ? tabs : []);
        });
    });
}

function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, () => {
            void chrome.runtime.lastError;
            resolve();
        });
    });
}

function getTab(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                resolve(null);
                return;
            }
            resolve(tab || null);
        });
    });
}

async function readSettings() {
    const synced = await getFromStorage(chrome.storage.sync, [STORAGE_KEY]);
    if (synced[STORAGE_KEY]) {
        return API.normalizeSettings(synced[STORAGE_KEY]);
    }

    const cached = await getFromStorage(chrome.storage.local, [CACHE_KEY]);
    if (cached[CACHE_KEY]) {
        return API.normalizeSettings(cached[CACHE_KEY]);
    }

    return API.createDefaultSettings();
}

async function persistSettings(input, options = {}) {
    const settings = API.normalizeSettings(input);
    await setInStorage(chrome.storage.sync, { [STORAGE_KEY]: settings });
    await setInStorage(chrome.storage.local, { [CACHE_KEY]: settings });

    if (options.broadcast !== false) {
        await broadcastSettings(settings);
    }
    return settings;
}

async function ensureSettings() {
    const settings = await readSettings();
    await persistSettings(settings, { broadcast: false });
    return settings;
}

async function broadcastSettings(settings) {
    const tabs = await queryTabs({});
    await Promise.all(
        tabs
            .filter((tab) => Number.isInteger(tab.id))
            .map((tab) => sendTabMessage(tab.id, {
                type: 'CNT_SETTINGS',
                settings
            }))
    );
}

function hostnameFromUrl(url) {
    try {
        return API.normalizeHostname(new URL(url).hostname);
    } catch (_) {
        return '';
    }
}

async function topHostnameForSender(sender) {
    if (sender?.tab?.url) {
        const fromSender = hostnameFromUrl(sender.tab.url);
        if (fromSender) return fromSender;
    }

    if (Number.isInteger(sender?.tab?.id)) {
        const tab = await getTab(sender.tab.id);
        const fromTab = hostnameFromUrl(tab?.url || '');
        if (fromTab) return fromTab;
    }

    return '';
}

chrome.runtime.onInstalled.addListener(() => {
    ensureSettings().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
    ensureSettings().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;

    const nextValue = changes[STORAGE_KEY].newValue;
    const settings = nextValue
        ? API.normalizeSettings(nextValue)
        : API.createDefaultSettings();

    setInStorage(chrome.storage.local, { [CACHE_KEY]: settings })
        .then(() => broadcastSettings(settings))
        .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    const respond = (promise) => {
        Promise.resolve(promise)
            .then((value) => sendResponse({ ok: true, ...value }))
            .catch((error) => sendResponse({
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            }));
        return true;
    };

    switch (message.type) {
        case 'CNT_GET_SETTINGS':
            return respond(readSettings().then((settings) => ({ settings })));

        case 'CNT_SAVE_SETTINGS':
            return respond(persistSettings(message.settings).then((settings) => ({ settings })));

        case 'CNT_RESET_SETTINGS':
            return respond(persistSettings(API.createDefaultSettings()).then((settings) => ({ settings })));

        case 'CNT_GET_TOP_HOST':
            return respond(topHostnameForSender(sender).then((topHostname) => ({ topHostname })));

        case 'CNT_BROADCAST_SETTINGS':
            return respond(readSettings().then(async (settings) => {
                await broadcastSettings(settings);
                return { settings };
            }));

        default:
            return false;
    }
});
