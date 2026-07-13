// 확장 설치 시 기본값 세팅
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get('cnt', (data) => {
        if (!data.cnt) {
            chrome.storage.sync.set({
                cnt: {
                    globalEnabled: true,
                    fontSize: 100,
                    customSites: [],
                    presets: {
                        roblox:    { domain: 'roblox.com',    enabled: true  },
                        youtube:   { domain: 'youtube.com',   enabled: false },
                        twitter:   { domain: 'twitter.com',   enabled: false },
                        naver:     { domain: 'naver.com',     enabled: false },
                        github:    { domain: 'github.com',    enabled: false },
                        google:    { domain: 'google.com',    enabled: false },
                        discord:   { domain: 'discord.com',   enabled: false },
                        instagram: { domain: 'instagram.com', enabled: false },
                        notion:    { domain: 'notion.so',     enabled: false },
                        reddit:    { domain: 'reddit.com',    enabled: false }
                    },
                    siteFontSizes: {}
                }
            });
        }
    });
});

// 탭 업데이트 시 content script에 설정 전달
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
        chrome.storage.sync.get('cnt', (data) => {
            if (data.cnt) {
                chrome.tabs.sendMessage(tabId, {
                    type: 'CNT_UPDATE',
                    settings: data.cnt
                }).catch(() => {});
            }
        });
    }
});
