(function () {
    'use strict';

    const API = globalThis.CNT;
    if (!API || typeof API.resolveForHost !== 'function') {
        console.warn('[CNT] shared.js was not loaded before content.js.');
        return;
    }

    const FONT_STYLE_ID = 'cnt-local-font-faces';
    const OVERRIDE_STYLE_ID = 'cnt-dynamic-font-override';
    const SHADOW_STYLE_ATTRIBUTE = 'data-cnt-shadow-style';
    const TARGET_ATTRIBUTE = 'data-cnt-font-target';
    const SIZE_PROPERTY = '--cnt-target-font-size';
    const WEIGHT_PROPERTY = '--cnt-target-font-weight';

    const MIN_FONT_SIZE = 8;
    const MAX_FONT_SIZE = 96;
    const WORK_BUDGET_MS = 7;
    const WORK_ITEM_BUDGET = 240;
    const DISCONNECTED_SWEEP_BUDGET = 80;

    const ALWAYS_PROTECTED_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK',
        'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'MATH'
    ]);
    const CODE_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP']);
    const TEXT_CONTROL_TAGS = new Set(['TEXTAREA', 'SELECT', 'BUTTON']);
    const NON_TEXT_INPUT_TYPES = new Set([
        'hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'image',
        'reset', 'submit', 'button'
    ]);
    const ICON_CLASS_PATTERN = /(^|[\s_-])(fa[brsld]?|fontawesome|material-icons?|material-symbols(?:-outlined|-rounded|-sharp)?|mdi|glyphicon|glyphicons|icomoon|ionicons?|octicon|codicon|bootstrap-icons?|remixicon|icon)(?=$|[\s_-])/i;
    const ICON_FONT_PATTERN = /font\s*awesome|material\s*(?:icons?|symbols)|glyphicons?|icomoon|ionicons?|octicons?|codicons?|bootstrap\s*icons?|remixicon/i;
    const ACCESSIBILITY_CLASS_PATTERN = /(^|[\s_-])(sr-only|visually-hidden|screen-reader(?:-text)?|a11y-hidden)(?=$|[\s_-])/i;
    const PRIVATE_USE_ONLY_PATTERN = /^[\s\u200B-\u200D\uFEFF\uE000-\uF8FF]+$/u;

    const FONT_DEFINITIONS = {
        pretendard: {
            family: 'CNT Pretendard Variable',
            fallback: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
            files: [
                { path: 'fonts/PretendardVariable.woff2', weight: '100 900' }
            ],
            fallbackWeights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
        },
        mona: {
            family: 'CNT Mona12',
            fallback: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
            files: [
                { path: 'fonts/Mona12.woff2', weight: '400' },
                { path: 'fonts/Mona12-Bold.woff2', weight: '700' }
            ],
            fallbackWeights: [400, 700],
            koreanLocalization: true
        },
        nanum: {
            family: 'CNT Nanum Myeongjo',
            fallback: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Malgun Gothic", serif',
            files: [
                { path: 'fonts/NanumMyeongjo-Regular.woff2', weight: '400' },
                { path: 'fonts/NanumMyeongjo-Bold.woff2', weight: '700' },
                { path: 'fonts/NanumMyeongjo-ExtraBold.woff2', weight: '800' }
            ],
            fallbackWeights: [400, 700, 800]
        }
    };

    const FONT_ALIASES = new Map([
        ['pretendard', 'pretendard'],
        ['pretendard-variable', 'pretendard'],
        ['pretendardvariable', 'pretendard'],
        ['mona', 'mona'],
        ['mona12', 'mona'],
        ['pixel', 'mona'],
        ['pixel-font', 'mona'],
        ['nanum', 'nanum'],
        ['nanum-myeongjo', 'nanum'],
        ['nanummyeongjo', 'nanum'],
        ['myeongjo', 'nanum'],
        ['serif', 'nanum']
    ]);

    let topHostname = '';
    let hostReady = false;
    let latestRawSettings = null;
    let currentResolved = null;
    let currentSignature = '';
    let active = false;

    let fontFaceStyle = null;
    let overrideStyle = null;
    let documentObserver = null;
    let documentElementWaiter = null;

    let scanQueue = [];
    let scanQueued = new Set();
    let singleQueue = [];
    let singleQueued = new Set();
    let scheduledFrame = 0;
    let scheduledIdle = 0;
    let scheduledTimer = 0;
    let workGeneration = 0;

    let elementStates = new WeakMap();
    const styledElements = new Set();
    const shadowStates = new Set();
    let disconnectedIterator = null;
    let shadowSweepIterator = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function finiteNumber(value, fallback) {
        const number = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizeHostname(value) {
        if (!value) return '';
        if (typeof API.normalizeDomain === 'function') {
            try {
                const normalized = API.normalizeDomain(value);
                if (normalized) return String(normalized);
            } catch (_) {
                // Fall through to the conservative local normalization.
            }
        }
        return String(value).trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    }

    function canonicalFontId(value) {
        const raw = value && typeof value === 'object'
            ? value.id || value.key || value.value || value.family
            : value;
        const key = String(raw || 'pretendard').trim().toLowerCase().replace(/[\s_]+/g, '-');
        return FONT_ALIASES.get(key) || 'pretendard';
    }

    function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        const keys = Object.keys(value).sort();
        return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
    }

    function unwrapSettings(value, depth = 0) {
        if (!value || depth > 4) return null;
        if (typeof value !== 'object') return null;

        const looksLikeSettings =
            'schemaVersion' in value || 'globalEnabled' in value || 'defaults' in value ||
            'sites' in value || 'customSites' in value || 'presets' in value;
        if (looksLikeSettings) return value;

        for (const key of ['settings', 'cnt', 'cntCache', 'value', 'data']) {
            if (value[key] && value[key] !== value) {
                const nested = unwrapSettings(value[key], depth + 1);
                if (nested) return nested;
            }
        }
        return null;
    }

    function extractMessageHostname(response) {
        if (typeof response === 'string') return normalizeHostname(response);
        if (!response || typeof response !== 'object') return '';
        return normalizeHostname(
            response.topHostname || response.topHost || response.hostname || response.host || response.domain
        );
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(null);
                        return;
                    }
                    resolve(response ?? null);
                });
            } catch (_) {
                resolve(null);
            }
        });
    }

    function getStorage(area, keys) {
        return new Promise((resolve) => {
            try {
                area.get(keys, (result) => {
                    if (chrome.runtime.lastError) {
                        resolve({});
                        return;
                    }
                    resolve(result || {});
                });
            } catch (_) {
                resolve({});
            }
        });
    }

    async function resolveTopHostname() {
        if (window.top === window) return normalizeHostname(location.hostname);

        const response = await sendRuntimeMessage({ type: 'CNT_GET_TOP_HOST' });
        const fromBackground = extractMessageHostname(response);
        if (fromBackground) return fromBackground;

        try {
            const origins = location.ancestorOrigins;
            if (origins && origins.length) {
                return normalizeHostname(new URL(origins[origins.length - 1]).hostname);
            }
        } catch (_) {
            // Cross-origin ancestry is best-effort only.
        }
        return normalizeHostname(location.hostname);
    }

    function behaviorFlag(behavior, names, fallback) {
        if (!behavior || typeof behavior !== 'object') return fallback;
        for (const name of names) {
            if (name in behavior) return Boolean(behavior[name]);
        }
        return fallback;
    }

    function normalizeBehavior(value) {
        const source = value && typeof value === 'object' ? value : {};
        const mode = typeof value === 'string' ? value : String(source.mode || source.preset || '').toLowerCase();
        const force = mode === 'force' || mode === 'aggressive';
        return {
            protectCode: behaviorFlag(source, ['protectCode', 'preserveCode', 'excludeCode'], !force) && source.applyCode !== true,
            protectIcons: behaviorFlag(source, ['protectIcons', 'preserveIcons', 'excludeIcons'], true) && source.applyIcons !== true,
            protectAriaHidden: behaviorFlag(source, ['protectAriaHidden', 'preserveAriaHidden'], true),
            protectAccessibilityText: behaviorFlag(source, ['protectAccessibilityText', 'preserveAccessibilityText'], true),
            applyControls: behaviorFlag(source, ['applyControls', 'includeControls'], true),
            applyEditable: behaviorFlag(source, ['applyEditable', 'includeEditable'], true)
        };
    }

    function normalizeResolved(value) {
        if (!value || typeof value !== 'object') {
            return {
                active: false,
                fontId: 'pretendard',
                scalePercent: 100,
                targetWeight: 400,
                behavior: normalizeBehavior(null)
            };
        }

        const explicitScale = value.scalePercent ?? value.fontSize ?? value.sizePercent ?? value.scale ?? value.size;
        let scalePercent = finiteNumber(explicitScale, 100);
        if (scalePercent > 0 && scalePercent <= 3) scalePercent *= 100;

        const explicitWeight = value.targetWeight ?? value.fontWeight ?? value.weight;
        const activeValue = value.active ?? value.enabled ?? value.isActive ?? value.shouldApply;
        const fontValue = value.fontId ?? value.selectedFont ?? value.fontKey ?? value.font;

        return {
            active: Boolean(activeValue),
            fontId: canonicalFontId(fontValue),
            scalePercent: clamp(scalePercent, 25, 400),
            targetWeight: clamp(finiteNumber(explicitWeight, 400), 100, 900),
            behavior: normalizeBehavior(value.behavior ?? value.behaviors ?? value.options)
        };
    }

    function resolveSettingsForCurrentHost(settings) {
        try {
            return normalizeResolved(API.resolveForHost(settings, topHostname));
        } catch (error) {
            console.warn('[CNT] Failed to resolve settings for host:', error);
            return normalizeResolved(null);
        }
    }

    function resolvedSignature(resolved) {
        return stableStringify({
            active: resolved.active,
            fontId: resolved.fontId,
            scalePercent: resolved.scalePercent,
            targetWeight: resolved.targetWeight,
            behavior: resolved.behavior
        });
    }

    function handleRawSettings(value) {
        const settings = unwrapSettings(value) || value;
        if (!settings || typeof settings !== 'object') return;
        latestRawSettings = settings;
        if (!hostReady) return;
        applyResolved(resolveSettingsForCurrentHost(settings));
    }

    function findPreviewPayload(message) {
        if (!message || typeof message !== 'object') return null;
        return message.resolved || message.preview?.resolved || message.preview || message.payload || null;
    }

    function handlePreviewMessage(message) {
        const fullSettings = unwrapSettings(message.settings || message.cnt || message.preview);
        if (fullSettings) {
            handleRawSettings(fullSettings);
            return;
        }

        const payload = findPreviewPayload(message);
        if (!payload || typeof payload !== 'object') return;
        const merged = Object.assign({}, currentResolved || normalizeResolved(null), payload);
        if ('font' in payload && !('fontId' in payload)) merged.fontId = payload.font;
        if ('fontSize' in payload && !('scalePercent' in payload)) merged.scalePercent = payload.fontSize;
        if ('weight' in payload && !('targetWeight' in payload)) merged.targetWeight = payload.weight;
        if (!('active' in payload) && currentResolved) merged.active = currentResolved.active;
        applyResolved(normalizeResolved(merged));
    }

    function fontUrl(path) {
        return JSON.stringify(chrome.runtime.getURL(path));
    }

    function buildFontFaceCss(fontId) {
        const definition = FONT_DEFINITIONS[fontId] || FONT_DEFINITIONS.pretendard;
        return definition.files.map((file) => [
            '@font-face{',
            `font-family:${JSON.stringify(definition.family)};`,
            `src:url(${fontUrl(file.path)}) format("woff2");`,
            `font-weight:${file.weight};`,
            'font-style:normal;',
            'font-display:swap;',
            '}'
        ].join('')).join('\n');
    }

    function buildOverrideCss(resolved) {
        const definition = FONT_DEFINITIONS[resolved.fontId] || FONT_DEFINITIONS.pretendard;
        const localization = definition.koreanLocalization
            ? 'font-feature-settings:"locl" 1!important;font-language-override:"KOR "!important;'
            : '';
        return [
            `[${TARGET_ATTRIBUTE}="1"]{`,
            `font-family:${JSON.stringify(definition.family)},${definition.fallback}!important;`,
            `font-size:var(${SIZE_PROPERTY})!important;`,
            `font-weight:var(${WEIGHT_PROPERTY})!important;`,
            localization,
            '}'
        ].join('');
    }

    function createOwnedStyle(id, cssText) {
        const style = document.createElement('style');
        style.id = id;
        style.setAttribute('data-cnt-owned', '1');
        style.textContent = cssText;
        return style;
    }

    function styleHost() {
        return document.head || document.documentElement || null;
    }

    function ensureDocumentElement(callback) {
        if (document.documentElement) {
            callback();
            return;
        }
        if (documentElementWaiter) return;
        documentElementWaiter = new MutationObserver(() => {
            if (!document.documentElement) return;
            documentElementWaiter.disconnect();
            documentElementWaiter = null;
            if (active) callback();
        });
        documentElementWaiter.observe(document, { childList: true });
    }

    function ensureDocumentStyles() {
        if (!active || !currentResolved) return false;
        const host = styleHost();
        if (!host) {
            ensureDocumentElement(() => {
                ensureDocumentStyles();
                startDocumentObserver();
                enqueueScan(document.documentElement);
            });
            return false;
        }

        const faceCss = buildFontFaceCss(currentResolved.fontId);
        if (!fontFaceStyle || !fontFaceStyle.isConnected) {
            fontFaceStyle?.remove();
            fontFaceStyle = createOwnedStyle(FONT_STYLE_ID, faceCss);
            host.appendChild(fontFaceStyle);
        } else if (fontFaceStyle.textContent !== faceCss) {
            fontFaceStyle.textContent = faceCss;
        }

        const dynamicCss = buildOverrideCss(currentResolved);
        if (!overrideStyle || !overrideStyle.isConnected) {
            overrideStyle?.remove();
            overrideStyle = createOwnedStyle(OVERRIDE_STYLE_ID, dynamicCss);
            host.appendChild(overrideStyle);
        } else if (overrideStyle.textContent !== dynamicCss) {
            overrideStyle.textContent = dynamicCss;
        }

        for (const state of shadowStates) ensureShadowStyle(state, dynamicCss);
        return true;
    }

    function ensureShadowStyle(state, cssText = null) {
        if (!active || !state.root.host?.isConnected) return;
        const text = cssText ?? buildOverrideCss(currentResolved);
        if (!state.style || !state.style.isConnected) {
            state.style?.remove();
            state.style = document.createElement('style');
            state.style.setAttribute(SHADOW_STYLE_ATTRIBUTE, '1');
            state.style.textContent = text;
            state.root.appendChild(state.style);
        } else if (state.style.textContent !== text) {
            state.style.textContent = text;
        }
    }

    function parseComputedWeight(value) {
        if (value === 'normal') return 400;
        if (value === 'bold') return 700;
        return clamp(finiteNumber(value, 400), 1, 1000);
    }

    function fallbackSnapWeight(fontId, value) {
        const weights = (FONT_DEFINITIONS[fontId] || FONT_DEFINITIONS.pretendard).fallbackWeights;
        let best = weights[0];
        let distance = Math.abs(value - best);
        for (let index = 1; index < weights.length; index += 1) {
            const nextDistance = Math.abs(value - weights[index]);
            if (nextDistance < distance || (nextDistance === distance && weights[index] > best)) {
                best = weights[index];
                distance = nextDistance;
            }
        }
        return best;
    }

    function snapWeight(fontId, value) {
        if (typeof API.snapWeight === 'function') {
            try {
                const result = Number(API.snapWeight(fontId, value));
                if (Number.isFinite(result)) return clamp(result, 1, 1000);
            } catch (_) {
                // Try the alternate legacy argument order below.
            }
            try {
                const result = Number(API.snapWeight(value, fontId));
                if (Number.isFinite(result)) return clamp(result, 1, 1000);
            } catch (_) {
                // Use the local compatibility table.
            }
        }
        return fallbackSnapWeight(fontId, value);
    }

    function directTextContent(element) {
        let result = '';
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) result += node.nodeValue || '';
        }
        return result;
    }

    function hasMeaningfulDirectText(element) {
        return directTextContent(element).replace(/[\s\u200B-\u200D\uFEFF]/gu, '').length > 0;
    }

    function isTextControl(element) {
        if (TEXT_CONTROL_TAGS.has(element.tagName)) return true;
        if (element.tagName !== 'INPUT') return false;
        return !NON_TEXT_INPUT_TYPES.has(String(element.type || 'text').toLowerCase());
    }

    function isEditable(element) {
        const attribute = element.getAttribute('contenteditable');
        return element.isContentEditable || (attribute !== null && attribute.toLowerCase() !== 'false');
    }

    function parentElementAcrossShadow(element) {
        if (element.parentElement) return element.parentElement;
        const root = element.getRootNode?.();
        return root instanceof ShadowRoot ? root.host : null;
    }

    function hasProtectedAncestor(element) {
        const behavior = currentResolved.behavior;
        for (let current = element; current; current = parentElementAcrossShadow(current)) {
            if (ALWAYS_PROTECTED_TAGS.has(current.tagName)) return true;
            if (behavior.protectCode && CODE_TAGS.has(current.tagName)) return true;
            if (behavior.protectAriaHidden && current.getAttribute('aria-hidden') === 'true') return true;
            if (behavior.protectAccessibilityText && ACCESSIBILITY_CLASS_PATTERN.test(current.className || '')) return true;
        }
        return false;
    }

    function isIconElement(element, computedStyle) {
        if (!currentResolved.behavior.protectIcons) return false;
        const className = typeof element.className === 'string' ? element.className : element.getAttribute('class') || '';
        if (ICON_CLASS_PATTERN.test(className)) return true;
        if (element.hasAttribute('data-icon') || element.getAttribute('role') === 'img') return true;
        if (computedStyle && ICON_FONT_PATTERN.test(computedStyle.fontFamily || '')) return true;
        const text = directTextContent(element);
        return Boolean(text && PRIVATE_USE_ONLY_PATTERN.test(text));
    }

    function shouldPruneSubtree(element) {
        if (ALWAYS_PROTECTED_TAGS.has(element.tagName)) return true;
        if (currentResolved.behavior.protectCode && CODE_TAGS.has(element.tagName)) return true;
        if (currentResolved.behavior.protectAriaHidden && element.getAttribute('aria-hidden') === 'true') return true;
        return false;
    }

    function shouldTarget(element) {
        if (!(element instanceof Element) || !element.isConnected) return false;
        if (hasProtectedAncestor(element)) return false;
        if (currentResolved.behavior.applyControls && isTextControl(element)) return true;
        if (currentResolved.behavior.applyEditable && isEditable(element)) return true;
        return hasMeaningfulDirectText(element);
    }

    function propertySnapshot(element, name) {
        return {
            value: element.style.getPropertyValue(name),
            priority: element.style.getPropertyPriority(name)
        };
    }

    function restoreProperty(element, name, snapshot) {
        if (snapshot.value) element.style.setProperty(name, snapshot.value, snapshot.priority);
        else element.style.removeProperty(name);
    }

    function nearestStyledAncestor(element) {
        for (let current = parentElementAcrossShadow(element); current; current = parentElementAcrossShadow(current)) {
            const state = elementStates.get(current);
            if (state) return state;
        }
        return null;
    }

    function captureElementState(element, computedStyle) {
        let originalSize = finiteNumber(computedStyle.fontSize, 0);
        let originalWeight = parseComputedWeight(computedStyle.fontWeight);

        const ancestorState = nearestStyledAncestor(element);
        if (ancestorState && currentResolved) {
            const ancestorAppliedSize = clamp(
                ancestorState.originalSize * (currentResolved.scalePercent / 100),
                MIN_FONT_SIZE,
                MAX_FONT_SIZE
            );
            if (Math.abs(originalSize - ancestorAppliedSize) < 0.25) {
                originalSize = ancestorState.originalSize;
            }

            const ancestorAppliedWeight = snapWeight(
                currentResolved.fontId,
                ancestorState.originalWeight + (currentResolved.targetWeight - 400)
            );
            if (Math.abs(originalWeight - ancestorAppliedWeight) < 1) {
                originalWeight = ancestorState.originalWeight;
            }
        }

        return {
            originalSize,
            originalWeight,
            originalAttribute: element.getAttribute(TARGET_ATTRIBUTE),
            sizeProperty: propertySnapshot(element, SIZE_PROPERTY),
            weightProperty: propertySnapshot(element, WEIGHT_PROPERTY)
        };
    }

    function applyElement(element) {
        if (!active || !currentResolved) return;
        if (!shouldTarget(element)) {
            releaseElement(element);
            return;
        }

        let state = elementStates.get(element);
        let computedStyle = null;
        if (!state) {
            computedStyle = getComputedStyle(element);
            if (isIconElement(element, computedStyle)) return;
            state = captureElementState(element, computedStyle);
            if (!(state.originalSize > 0)) return;
            elementStates.set(element, state);
            styledElements.add(element);
        }

        const scaledSize = clamp(
            state.originalSize * (currentResolved.scalePercent / 100),
            MIN_FONT_SIZE,
            MAX_FONT_SIZE
        );
        const shiftedWeight = state.originalWeight + (currentResolved.targetWeight - 400);
        const finalWeight = snapWeight(currentResolved.fontId, shiftedWeight);

        element.setAttribute(TARGET_ATTRIBUTE, '1');
        element.style.setProperty(SIZE_PROPERTY, `${Math.round(scaledSize * 100) / 100}px`);
        element.style.setProperty(WEIGHT_PROPERTY, String(finalWeight));
    }

    function releaseElement(element) {
        const state = elementStates.get(element);
        if (!state) return;

        if (state.originalAttribute === null) element.removeAttribute(TARGET_ATTRIBUTE);
        else element.setAttribute(TARGET_ATTRIBUTE, state.originalAttribute);
        restoreProperty(element, SIZE_PROPERTY, state.sizeProperty);
        restoreProperty(element, WEIGHT_PROPERTY, state.weightProperty);

        styledElements.delete(element);
        elementStates.delete(element);
        singleQueued.delete(element);
    }

    function attachShadowRoot(root) {
        if (!active || !(root instanceof ShadowRoot)) return;
        for (const state of shadowStates) {
            if (state.root === root) {
                ensureShadowStyle(state);
                return;
            }
        }

        const state = { root, observer: null, style: null };
        state.observer = new MutationObserver((records) => handleMutations(records, root));
        state.observer.observe(root, { childList: true, subtree: true });
        shadowStates.add(state);
        ensureShadowStyle(state);
        enqueueScan(root);
    }

    function enqueueScan(node) {
        if (!active || !node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            enqueueSingle(node.parentElement);
            return;
        }
        if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(node.nodeType)) return;
        if (scanQueued.has(node)) return;

        for (let parent = node.parentNode; parent; parent = parent.parentNode) {
            if (scanQueued.has(parent)) return;
        }
        scanQueued.add(node);
        scanQueue.push(node);
        scheduleWork();
    }

    function enqueueSingle(element) {
        if (!active || !(element instanceof Element) || singleQueued.has(element)) return;
        singleQueued.add(element);
        singleQueue.push(element);
        scheduleWork();
    }

    function processScanNode(node) {
        scanQueued.delete(node);
        if (!node) return;

        if (node instanceof ShadowRoot || node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            for (const child of node.children || []) enqueueScan(child);
            return;
        }
        if (!(node instanceof Element) || !node.isConnected) return;

        applyElement(node);
        if (node.shadowRoot) attachShadowRoot(node.shadowRoot);
        if (shouldPruneSubtree(node)) return;
        for (const child of node.children) enqueueScan(child);
    }

    function sweepDisconnectedElements(limit) {
        if (!disconnectedIterator) disconnectedIterator = styledElements.values();
        let count = 0;
        while (count < limit) {
            const next = disconnectedIterator.next();
            if (next.done) {
                disconnectedIterator = null;
                break;
            }
            if (!next.value.isConnected) releaseElement(next.value);
            count += 1;
        }
    }

    function sweepDetachedShadows(limit) {
        if (!shadowSweepIterator) shadowSweepIterator = shadowStates.values();
        let count = 0;
        while (count < limit) {
            const next = shadowSweepIterator.next();
            if (next.done) {
                shadowSweepIterator = null;
                break;
            }
            const state = next.value;
            if (!state.root.host?.isConnected) {
                state.observer.disconnect();
                state.style?.remove();
                shadowStates.delete(state);
            }
            count += 1;
        }
    }

    function hasPendingWork() {
        return scanQueue.length > 0 || singleQueue.length > 0 || disconnectedIterator || shadowSweepIterator;
    }

    function processWork(deadline, generation) {
        scheduledIdle = 0;
        scheduledTimer = 0;
        if (!active || generation !== workGeneration) return;

        const startedAt = performance.now();
        let processed = 0;
        const hasTime = () => {
            if (processed >= WORK_ITEM_BUDGET || performance.now() - startedAt >= WORK_BUDGET_MS) return false;
            if (!deadline || deadline.didTimeout) return true;
            return deadline.timeRemaining() > 1;
        };

        while (hasTime() && singleQueue.length) {
            const element = singleQueue.shift();
            singleQueued.delete(element);
            if (element?.isConnected) applyElement(element);
            else if (element) releaseElement(element);
            processed += 1;
        }

        while (hasTime() && scanQueue.length) {
            processScanNode(scanQueue.shift());
            processed += 1;
        }

        sweepDisconnectedElements(DISCONNECTED_SWEEP_BUDGET);
        sweepDetachedShadows(16);

        if (hasPendingWork()) scheduleWork();
    }

    function scheduleWork() {
        if (!active || scheduledFrame || scheduledIdle || scheduledTimer) return;
        const generation = workGeneration;
        scheduledFrame = requestAnimationFrame(() => {
            scheduledFrame = 0;
            if (!active || generation !== workGeneration) return;
            if (typeof requestIdleCallback === 'function') {
                scheduledIdle = requestIdleCallback(
                    (deadline) => processWork(deadline, generation),
                    { timeout: 80 }
                );
            } else {
                scheduledTimer = window.setTimeout(() => processWork(null, generation), 0);
            }
        });
    }

    function cancelScheduledWork() {
        if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
        if (scheduledIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(scheduledIdle);
        if (scheduledTimer) clearTimeout(scheduledTimer);
        scheduledFrame = 0;
        scheduledIdle = 0;
        scheduledTimer = 0;
    }

    function resetQueues() {
        cancelScheduledWork();
        scanQueue = [];
        scanQueued = new Set();
        singleQueue = [];
        singleQueued = new Set();
        disconnectedIterator = null;
        shadowSweepIterator = null;
    }

    function handleMutations(records) {
        if (!active) return;
        if (!fontFaceStyle?.isConnected || !overrideStyle?.isConnected) ensureDocumentStyles();

        for (const record of records) {
            if (record.target instanceof Element) enqueueSingle(record.target);
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.TEXT_NODE) enqueueSingle(node.parentElement);
                else enqueueScan(node);
            }
        }

        if (!disconnectedIterator) disconnectedIterator = styledElements.values();
        if (!shadowSweepIterator) shadowSweepIterator = shadowStates.values();
        scheduleWork();
    }

    function startDocumentObserver() {
        if (!active || documentObserver || !document.documentElement) return;
        documentObserver = new MutationObserver(handleMutations);
        documentObserver.observe(document, { childList: true, subtree: true });
    }

    function stopObservers() {
        documentObserver?.disconnect();
        documentObserver = null;
        documentElementWaiter?.disconnect();
        documentElementWaiter = null;
        for (const state of shadowStates) {
            state.observer.disconnect();
            state.style?.remove();
        }
        shadowStates.clear();
    }

    function deactivate() {
        active = false;
        workGeneration += 1;
        resetQueues();
        stopObservers();

        for (const element of Array.from(styledElements)) releaseElement(element);
        styledElements.clear();
        elementStates = new WeakMap();

        fontFaceStyle?.remove();
        overrideStyle?.remove();
        fontFaceStyle = null;
        overrideStyle = null;
    }

    function activateOrUpdate(resolved) {
        const wasActive = active;
        active = true;
        currentResolved = resolved;
        workGeneration += 1;
        resetQueues();

        ensureDocumentElement(() => {
            if (!active) return;
            ensureDocumentStyles();
            startDocumentObserver();

            if (wasActive) {
                for (const element of styledElements) enqueueSingle(element);
            }
            enqueueScan(document.documentElement);
        });
    }

    function applyResolved(resolved) {
        const signature = resolvedSignature(resolved);
        if (signature === currentSignature) return;
        currentSignature = signature;

        if (!resolved.active) {
            currentResolved = resolved;
            deactivate();
            return;
        }
        activateOrUpdate(resolved);
    }

    async function refreshFromRuntime() {
        const response = await sendRuntimeMessage({ type: 'CNT_GET_SETTINGS' });
        const settings = unwrapSettings(response);
        if (settings) handleRawSettings(settings);
        else applyResolved(normalizeResolved(null));
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'CNT_PREVIEW') {
            handlePreviewMessage(message);
        } else if (message.type === 'CNT_UPDATE' || message.type === 'CNT_SETTINGS') {
            handleRawSettings(message.settings || message.cnt || message.payload);
        }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.cnt) {
            if (changes.cnt.newValue) handleRawSettings(changes.cnt.newValue);
            else refreshFromRuntime();
        }
        if (areaName === 'local' && changes.cntCache) {
            if (changes.cntCache.newValue) handleRawSettings(changes.cntCache.newValue);
            else refreshFromRuntime();
        }
    });

    async function initialize() {
        topHostname = await resolveTopHostname();
        hostReady = true;

        const local = await getStorage(chrome.storage.local, ['cntCache']);
        const cached = unwrapSettings(local.cntCache);
        if (cached) {
            handleRawSettings(cached);
            return;
        }
        await refreshFromRuntime();
    }

    initialize().catch((error) => {
        console.warn('[CNT] Failed to initialize content font engine:', error);
        deactivate();
    });
})();
