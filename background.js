'use strict';

importScripts('shared.js');

const API = globalThis.CNT;
const STORAGE_KEY = API.STORAGE_KEY;
const CACHE_KEY = API.CACHE_KEY;

let lastBroadcastSignature = '';
let settingsPromise = null;

function chromeCall(executor, fallback) {
    return new Promise((resolve, reject) => {
        try {
            executor((value) => {
                const error = chrome.runtime.lastError;
                if (error) {
                    if (fallback !== undefined) resolve(fallback);
                    else reject(new Error(error.message));
                    return;
                }
                resolve(value);
            });
        } catch (error) {
            if (fallback !== undefined) resolve(fallback);
            else reject(error);
        }
    });
}

function storageGet(area, keys) {
    return chromeCall((done) => area.get(keys, done), {});
}

function storageSet(area, values) {
    return chromeCall((done) => area.set(values, () => done(undefined)));
}

function queryTabs(queryInfo = {}) {
    return chromeCall((done) => chrome.tabs.query(queryInfo, done), []);
}

function getTab(tabId) {
    return chromeCall((done) => chrome.tabs.get(tabId, done), null);
}

function sendTabMessage(tabId, message) {
    return chromeCall((done) => chrome.tabs.sendMessage(tabId, message, () => done(undefined)), undefined)
        .catch(() => undefined);
}

async function readSettingsUncached() {
    const synced = await storageGet(chrome.storage.sync, [STORAGE_KEY]);
    if (synced[STORAGE_KEY]) return API.normalizeSettings(synced[STORAGE_KEY]);

    const cached = await storageGet(chrome.storage.local, [CACHE_KEY]);
    if (cached[CACHE_KEY]) return API.normalizeSettings(cached[CACHE_KEY]);

    return API.createDefaultSettings();
}

function readSettings() {
    if (!settingsPromise) {
        settingsPromise = readSettingsUncached().finally(() => {
            settingsPromise = null;
        });
    }
    return settingsPromise;
}

async function broadcastSettings(settings) {
    const signature = API.stableStringify(settings);
    if (signature === lastBroadcastSignature) return;
    lastBroadcastSignature = signature;

    const tabs = await queryTabs({});
    const messages = [];
    for (const tab of tabs) {
        if (!Number.isInteger(tab.id)) continue;
        messages.push(sendTabMessage(tab.id, {
            type: 'CNT_SETTINGS',
            settings
        }));
    }
    await Promise.allSettled(messages);
}

async function persistSettings(input) {
    const settings = API.normalizeSettings(input);

    await Promise.all([
        storageSet(chrome.storage.sync, { [STORAGE_KEY]: settings }),
        storageSet(chrome.storage.local, { [CACHE_KEY]: settings })
    ]);

    await broadcastSettings(settings);
    return settings;
}

async function ensureSettings() {
    const settings = await readSettings();
    await Promise.all([
        storageSet(chrome.storage.sync, { [STORAGE_KEY]: settings }),
        storageSet(chrome.storage.local, { [CACHE_KEY]: settings })
    ]);
    return settings;
}

function hostnameFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:') return 'local-file';
        return API.normalizeHostname(parsed.hostname);
    } catch (_) {
        return '';
    }
}

async function topHostnameForSender(sender) {
    const direct = hostnameFromUrl(sender?.tab?.url || '');
    if (direct) return direct;

    if (Number.isInteger(sender?.tab?.id)) {
        const tab = await getTab(sender.tab.id);
        return hostnameFromUrl(tab?.url || '');
    }

    return '';
}

chrome.runtime.onInstalled.addListener(() => {
    ensureSettings().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
    ensureSettings().catch(() => undefined);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;

    const settings = changes[STORAGE_KEY].newValue
        ? API.normalizeSettings(changes[STORAGE_KEY].newValue)
        : API.createDefaultSettings();

    storageSet(chrome.storage.local, { [CACHE_KEY]: settings })
        .then(() => broadcastSettings(settings))
        .catch(() => undefined);
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
