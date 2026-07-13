(function () {
    'use strict';

    const API = globalThis.CNT;
    if (!API || typeof API.resolveForHost !== 'function') return;

    const STYLE_ATTRIBUTE = 'data-cnt-engine-style';
    const SIZE_ATTRIBUTE = 'data-cnt-size-target';
    const WEIGHT_ATTRIBUTE = 'data-cnt-weight-target';
    const EXEMPT_ATTRIBUTE = 'data-cnt-font-exempt';
    const SIZE_PROPERTY = '--cnt-font-size';
    const WEIGHT_PROPERTY = '--cnt-font-weight';

    const MIN_FONT_SIZE = 8;
    const MAX_FONT_SIZE = 96;
    const WORK_BUDGET_MS = 7;
    const WORK_ITEM_LIMIT = 320;

    const ALWAYS_PROTECTED_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK',
        'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'MATH'
    ]);
    const CODE_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP']);
    const TEXT_CONTROL_TAGS = new Set(['TEXTAREA', 'SELECT', 'BUTTON', 'OPTION']);
    const NON_TEXT_INPUT_TYPES = new Set([
        'hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'image',
        'reset', 'submit', 'button'
    ]);
    const ICON_CLASS_PATTERN = /(^|[\s_-])(fa[brsld]?|fontawesome|material-icons?|material-symbols(?:-outlined|-rounded|-sharp)?|mdi|glyphicon|glyphicons|icomoon|ionicons?|octicon|codicon|bootstrap-icons?|remixicon|icon)(?=$|[\s_-])/i;
    const ACCESSIBILITY_CLASS_PATTERN = /(^|[\s_-])(sr-only|visually-hidden|screen-reader(?:-text)?|a11y-hidden)(?=$|[\s_-])/i;
    const PRIVATE_USE_ONLY_PATTERN = /^[\s\u200B-\u200D\uFEFF\uE000-\uF8FF]+$/u;

    const FONT_DEFINITIONS = Object.freeze({
        pretendard: Object.freeze({
            family: 'CNT Pretendard Variable',
            fallback: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
            files: Object.freeze([
                Object.freeze({ path: 'fonts/PretendardVariable.woff2', weight: '100 900' })
            ])
        }),
        mona: Object.freeze({
            family: 'CNT Mona12',
            fallback: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
            files: Object.freeze([
                Object.freeze({ path: 'fonts/Mona12.woff2', weight: '400' }),
                Object.freeze({ path: 'fonts/Mona12-Bold.woff2', weight: '700' })
            ]),
            koreanLocalization: true
        }),
        nanum: Object.freeze({
            family: 'CNT Nanum Myeongjo',
            fallback: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Malgun Gothic", serif',
            files: Object.freeze([
                Object.freeze({ path: 'fonts/NanumMyeongjo-Regular.woff2', weight: '400' }),
                Object.freeze({ path: 'fonts/NanumMyeongjo-Bold.woff2', weight: '700' }),
                Object.freeze({ path: 'fonts/NanumMyeongjo-ExtraBold.woff2', weight: '800' })
            ])
        })
    });

    let topHostname = '';
    let hostReady = false;
    let latestSettings = null;
    let currentResolved = null;
    let currentSignature = '';
    let active = false;
    let workGeneration = 0;

    const rootStates = new Set();
    const trackedElements = new Set();
    let elementStates = new WeakMap();

    let scanTasks = [];
    let candidateQueue = [];
    let candidateQueued = new Set();
    let workScheduled = false;

    const messageChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
    if (messageChannel) {
        messageChannel.port1.onmessage = () => processWork(workGeneration);
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function finiteNumber(value, fallback) {
        const number = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizeHostname(value) {
        try {
            return API.normalizeHostname(value);
        } catch (_) {
            return String(value || '').trim().toLowerCase().replace(/^www\./, '');
        }
    }

    function normalizeResolved(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            active: Boolean(source.active ?? source.enabled),
            fontId: API.canonicalFontId(source.fontId ?? source.font),
            scalePercent: clamp(finiteNumber(source.scalePercent ?? source.fontSize, 100), 75, 150),
            targetWeight: clamp(finiteNumber(source.targetWeight ?? source.fontWeight, 400), 100, 900),
            behavior: API.normalizeBehavior(source.behavior)
        };
    }

    function resolvedSignature(resolved) {
        return API.stableStringify({
            active: resolved.active,
            fontId: resolved.fontId,
            scalePercent: resolved.scalePercent,
            targetWeight: resolved.targetWeight,
            behavior: resolved.behavior
        });
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(null);
                        return;
                    }
                    resolve(response || null);
                });
            } catch (_) {
                resolve(null);
            }
        });
    }

    function storageGet(area, keys) {
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
        if (window.top === window) {
            if (location.protocol === 'file:') return 'local-file';
            return normalizeHostname(location.hostname);
        }

        const response = await sendRuntimeMessage({ type: 'CNT_GET_TOP_HOST' });
        const fromBackground = normalizeHostname(response?.topHostname || response?.hostname || '');
        if (fromBackground) return fromBackground;

        try {
            const origins = location.ancestorOrigins;
            if (origins?.length) return normalizeHostname(new URL(origins[origins.length - 1]).hostname);
        } catch (_) {
            // Cross-origin ancestry is best-effort only.
        }
        return normalizeHostname(location.hostname);
    }

    function fontUrl(path) {
        return JSON.stringify(chrome.runtime.getURL(path));
    }

    function buildFontFaces(fontId) {
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

    function protectedSelectors() {
        const selectors = [
            'script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title',
            'iframe', 'object', 'embed', 'svg', 'svg *', 'canvas', 'math', 'math *',
            `[${EXEMPT_ATTRIBUTE}="1"]`, `[${EXEMPT_ATTRIBUTE}="1"] *`
        ];

        const behavior = currentResolved?.behavior || API.DEFAULT_BEHAVIOR;

        if (behavior.protectCode) {
            selectors.push('code', 'code *', 'pre', 'pre *', 'kbd', 'kbd *', 'samp', 'samp *');
        }

        if (behavior.protectAriaHidden) {
            selectors.push('[aria-hidden="true"]', '[aria-hidden="true"] *');
        }

        if (behavior.protectAccessibilityText) {
            for (const selector of [
                '.sr-only', '.visually-hidden', '.screen-reader-text', '.screen-reader', '.a11y-hidden'
            ]) {
                selectors.push(selector, `${selector} *`);
            }
        }

        if (behavior.protectIcons) {
            for (const selector of [
                '[data-icon]', '[role="img"]',
                '.material-icons', '.material-symbols', '.material-symbols-outlined',
                '.material-symbols-rounded', '.material-symbols-sharp',
                '.glyphicon', '.octicon', '.codicon', '.bi',
                '[class~="icon"]', '[class^="icon-"]', '[class*=" icon-"]',
                '[class^="fa-"]', '[class*=" fa-"]', '[class^="fas "]', '[class^="far "]',
                '[class^="fab "]', '[class^="mdi-"]', '[class*=" mdi-"]',
                '[class^="ion-"]', '[class*=" ion-"]'
            ]) {
                selectors.push(selector, `${selector} *`);
            }
        }

        return selectors;
    }

    function buildEngineCss(isShadowRoot) {
        const definition = FONT_DEFINITIONS[currentResolved.fontId] || FONT_DEFINITIONS.pretendard;
        const baseSelector = isShadowRoot
            ? ':where(:host, :host *)'
            : ':where(body, body *, input, textarea, select, option, button)';
        const exclusions = protectedSelectors().join(',');
        const familySelector = `${baseSelector}:not(:where(${exclusions}))`;
        const localization = definition.koreanLocalization
            ? 'font-feature-settings:"locl" 1!important;font-language-override:"KOR "!important;'
            : '';

        return [
            isShadowRoot ? '' : buildFontFaces(currentResolved.fontId),
            `${familySelector}{`,
            `font-family:${JSON.stringify(definition.family)},${definition.fallback}!important;`,
            localization,
            '}',
            `[${SIZE_ATTRIBUTE}="1"]{font-size:var(${SIZE_PROPERTY})!important;}`,
            `[${WEIGHT_ATTRIBUTE}="1"]{font-weight:var(${WEIGHT_PROPERTY})!important;}`
        ].join('\n');
    }

    function styleHostForRoot(root) {
        if (root instanceof ShadowRoot) return root;
        return document.head || document.documentElement || null;
    }

    function ensureRootStyle(state) {
        if (!active || !currentResolved) return;
        const host = styleHostForRoot(state.root);
        if (!host) return;

        const cssText = buildEngineCss(state.root instanceof ShadowRoot);
        if (!state.style || !state.style.isConnected) {
            state.style?.remove();
            state.style = document.createElement('style');
            state.style.setAttribute(STYLE_ATTRIBUTE, '1');
            state.style.textContent = cssText;
            host.appendChild(state.style);
        } else if (state.style.textContent !== cssText) {
            state.style.textContent = cssText;
        }
    }

    function observeRoot(state) {
        state.observer.disconnect();
        const options = {
            childList: true,
            subtree: true
        };
        if (adjustmentsEnabled()) {
            options.characterData = true;
            options.attributes = true;
            options.attributeFilter = ['class', 'role', 'aria-hidden', 'contenteditable', 'type'];
        }
        state.observer.observe(state.root, options);
    }

    function attachRoot(root) {
        if (!active || !root) return null;
        for (const state of rootStates) {
            if (state.root === root) {
                ensureRootStyle(state);
                observeRoot(state);
                return state;
            }
        }

        const state = {
            root,
            style: null,
            observer: new MutationObserver(handleMutations)
        };
        rootStates.add(state);
        ensureRootStyle(state);
        observeRoot(state);

        if (adjustmentsEnabled()) enqueueScan(root);
        return state;
    }

    function discoverShadowRoots(node) {
        if (!active || !node) return;
        if (node instanceof Element && node.shadowRoot) attachRoot(node.shadowRoot);

        if (!(node instanceof Element || node instanceof Document || node instanceof DocumentFragment)) return;
        let descendants;
        try {
            descendants = node.querySelectorAll?.('*') || [];
        } catch (_) {
            descendants = [];
        }
        for (const element of descendants) {
            if (element.shadowRoot) attachRoot(element.shadowRoot);
        }
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

    function elementClassName(element) {
        return typeof element.className === 'string'
            ? element.className
            : element.getAttribute('class') || '';
    }

    function hasPrivateUseText(element) {
        let text = '';
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue || '';
        }
        return Boolean(text && PRIVATE_USE_ONLY_PATTERN.test(text));
    }

    function isProtectedElement(element) {
        const behavior = currentResolved.behavior;
        for (let current = element; current; current = current.parentElement || current.getRootNode?.()?.host || null) {
            if (ALWAYS_PROTECTED_TAGS.has(current.tagName)) return true;
            if (behavior.protectCode && CODE_TAGS.has(current.tagName)) return true;
            if (behavior.protectAriaHidden && current.getAttribute?.('aria-hidden') === 'true') return true;

            const className = elementClassName(current);
            if (behavior.protectAccessibilityText && ACCESSIBILITY_CLASS_PATTERN.test(className)) return true;
            if (behavior.protectIcons && (
                ICON_CLASS_PATTERN.test(className) ||
                current.hasAttribute?.('data-icon') ||
                current.getAttribute?.('role') === 'img'
            )) return true;
        }

        return Boolean(behavior.protectIcons && hasPrivateUseText(element));
    }

    function shouldTrack(element) {
        if (!(element instanceof Element) || !element.isConnected) return false;
        if (isProtectedElement(element)) return false;
        if (currentResolved.behavior.applyControls && isTextControl(element)) return true;
        if (currentResolved.behavior.applyEditable && isEditable(element)) return true;
        return true;
    }

    function parseWeight(value) {
        if (value === 'normal') return 400;
        if (value === 'bold') return 700;
        return clamp(finiteNumber(value, 400), 100, 900);
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

    function restoreAttribute(element, name, value) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }

    function nearestTrackedAncestor(element) {
        for (let current = element.parentElement || element.getRootNode?.()?.host || null;
            current;
            current = current.parentElement || current.getRootNode?.()?.host || null) {
            const state = elementStates.get(current);
            if (state) return state;
        }
        return null;
    }

    function captureState(element) {
        const computed = getComputedStyle(element);
        let originalSize = finiteNumber(computed.fontSize, 0);
        let originalWeight = parseWeight(computed.fontWeight);
        const ancestor = nearestTrackedAncestor(element);
        const scale = currentResolved.scalePercent / 100;
        const weightDelta = currentResolved.targetWeight - 400;

        if (ancestor?.sizeApplied && scale !== 1) {
            const inheritedAppliedSize = ancestor.originalSize * scale;
            if (Math.abs(originalSize - inheritedAppliedSize) < 0.25) {
                originalSize = ancestor.originalSize;
            }
        }
        if (ancestor?.weightApplied && weightDelta !== 0) {
            const inheritedAppliedWeight = API.snapWeight(
                currentResolved.fontId,
                ancestor.originalWeight + weightDelta
            );
            if (Math.abs(originalWeight - inheritedAppliedWeight) < 1) {
                originalWeight = ancestor.originalWeight;
            }
        }

        return {
            originalSize,
            originalWeight,
            originalSizeAttribute: element.getAttribute(SIZE_ATTRIBUTE),
            originalWeightAttribute: element.getAttribute(WEIGHT_ATTRIBUTE),
            originalSizeProperty: propertySnapshot(element, SIZE_PROPERTY),
            originalWeightProperty: propertySnapshot(element, WEIGHT_PROPERTY),
            sizeApplied: false,
            weightApplied: false
        };
    }

    function applyCandidate(element) {
        candidateQueued.delete(element);
        if (!active || !currentResolved || !element?.isConnected) {
            forgetDetached(element);
            return;
        }

        const useSize = currentResolved.scalePercent !== 100;
        const useWeight = currentResolved.targetWeight !== 400;
        if (!useSize && !useWeight) {
            releaseElement(element);
            return;
        }

        if (!shouldTrack(element)) {
            releaseElement(element);
            return;
        }

        let state = elementStates.get(element);
        if (!state) {
            state = captureState(element);
            if (!(state.originalSize > 0)) return;
            elementStates.set(element, state);
            trackedElements.add(element);
        }

        if (useSize) {
            const scaled = clamp(state.originalSize * (currentResolved.scalePercent / 100), MIN_FONT_SIZE, MAX_FONT_SIZE);
            element.setAttribute(SIZE_ATTRIBUTE, '1');
            element.style.setProperty(SIZE_PROPERTY, `${Math.round(scaled * 100) / 100}px`);
            state.sizeApplied = true;
        } else {
            restoreAttribute(element, SIZE_ATTRIBUTE, state.originalSizeAttribute);
            restoreProperty(element, SIZE_PROPERTY, state.originalSizeProperty);
            state.sizeApplied = false;
        }

        if (useWeight) {
            const shifted = state.originalWeight + (currentResolved.targetWeight - 400);
            element.setAttribute(WEIGHT_ATTRIBUTE, '1');
            element.style.setProperty(WEIGHT_PROPERTY, String(API.snapWeight(currentResolved.fontId, shifted)));
            state.weightApplied = true;
        } else {
            restoreAttribute(element, WEIGHT_ATTRIBUTE, state.originalWeightAttribute);
            restoreProperty(element, WEIGHT_PROPERTY, state.originalWeightProperty);
            state.weightApplied = false;
        }

        if (!state.sizeApplied && !state.weightApplied) releaseElement(element);
    }

    function releaseElement(element) {
        const state = elementStates.get(element);
        if (!state) return;

        restoreAttribute(element, SIZE_ATTRIBUTE, state.originalSizeAttribute);
        restoreAttribute(element, WEIGHT_ATTRIBUTE, state.originalWeightAttribute);
        restoreProperty(element, SIZE_PROPERTY, state.originalSizeProperty);
        restoreProperty(element, WEIGHT_PROPERTY, state.originalWeightProperty);

        trackedElements.delete(element);
        elementStates.delete(element);
        candidateQueued.delete(element);
    }

    function forgetDetached(element) {
        if (!(element instanceof Element)) return;
        trackedElements.delete(element);
        elementStates.delete(element);
        candidateQueued.delete(element);
    }

    function cleanupRemovedSubtree(node) {
        if (!(node instanceof Element)) return;
        if (trackedElements.has(node)) forgetDetached(node);
        let descendants;
        try {
            descendants = node.querySelectorAll(`[${SIZE_ATTRIBUTE}], [${WEIGHT_ATTRIBUTE}]`);
        } catch (_) {
            descendants = [];
        }
        for (const element of descendants) forgetDetached(element);
    }

    function enqueueCandidate(element) {
        if (!(element instanceof Element) || candidateQueued.has(element)) return;
        candidateQueued.add(element);
        candidateQueue.push(element);
        scheduleWork();
    }

    function createScanTask(root) {
        const ownerDocument = root.ownerDocument || document;
        let walker;
        try {
            walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    return node.nodeValue && /[^\s\u200B-\u200D\uFEFF]/u.test(node.nodeValue)
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                }
            });
        } catch (_) {
            return null;
        }

        return {
            walker,
            controls: null,
            controlIndex: 0,
            generation: workGeneration
        };
    }

    function enqueueScan(root) {
        if (!active || !adjustmentsEnabled() || !root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            enqueueCandidate(root.parentElement);
            return;
        }

        const task = createScanTask(root);
        if (!task) return;
        scanTasks.push(task);
        scheduleWork();
    }

    function adjustmentsEnabled() {
        return Boolean(currentResolved && (
            currentResolved.scalePercent !== 100 || currentResolved.targetWeight !== 400
        ));
    }

    function processScanTask(task) {
        if (task.generation !== workGeneration) return true;

        const textNode = task.walker.nextNode();
        if (textNode) {
            enqueueCandidate(textNode.parentElement);
            return false;
        }

        if (task.controls === null) {
            const root = task.walker.root;
            try {
                task.controls = [...root.querySelectorAll?.('input, textarea, select, option, button, [contenteditable]:not([contenteditable="false"])') || []];
            } catch (_) {
                task.controls = [];
            }
        }

        if (task.controlIndex < task.controls.length) {
            enqueueCandidate(task.controls[task.controlIndex]);
            task.controlIndex += 1;
            return false;
        }

        return true;
    }

    function scheduleWork() {
        if (!active || workScheduled) return;
        workScheduled = true;
        const generation = workGeneration;
        if (messageChannel) messageChannel.port2.postMessage(generation);
        else setTimeout(() => processWork(generation), 0);
    }

    function processWork(generation) {
        workScheduled = false;
        if (!active || generation !== workGeneration) return;

        const started = performance.now();
        let processed = 0;

        while (candidateQueue.length && processed < WORK_ITEM_LIMIT && performance.now() - started < WORK_BUDGET_MS) {
            applyCandidate(candidateQueue.pop());
            processed += 1;
        }

        while (scanTasks.length && processed < WORK_ITEM_LIMIT && performance.now() - started < WORK_BUDGET_MS) {
            const task = scanTasks[0];
            const done = processScanTask(task);
            if (done) scanTasks.shift();
            processed += 1;
        }

        sweepDetachedRoots();
        if (candidateQueue.length || scanTasks.length) scheduleWork();
    }

    function resetWork() {
        workGeneration += 1;
        scanTasks = [];
        candidateQueue = [];
        candidateQueued = new Set();
        workScheduled = false;
    }

    function sweepDetachedRoots() {
        for (const state of [...rootStates]) {
            if (state.root instanceof ShadowRoot && !state.root.host?.isConnected) {
                state.observer.disconnect();
                state.style?.remove();
                rootStates.delete(state);
            }
        }
    }

    function handleMutations(records) {
        if (!active) return;

        for (const state of rootStates) ensureRootStyle(state);

        for (const record of records) {
            if (record.type === 'characterData') {
                enqueueCandidate(record.target.parentElement);
                continue;
            }

            if (record.type === 'attributes') {
                enqueueCandidate(record.target);
                continue;
            }

            for (const node of record.addedNodes) {
                discoverShadowRoots(node);
                if (adjustmentsEnabled()) enqueueScan(node);
            }
            for (const node of record.removedNodes) cleanupRemovedSubtree(node);
        }
    }

    function refreshRootStylesAndObservers() {
        for (const state of rootStates) {
            ensureRootStyle(state);
            observeRoot(state);
        }
    }

    function refreshTrackedElements() {
        for (const element of trackedElements) enqueueCandidate(element);
    }

    function clearTrackedElements() {
        for (const element of [...trackedElements]) releaseElement(element);
        trackedElements.clear();
        elementStates = new WeakMap();
    }

    function activateOrUpdate(resolved) {
        const wasActive = active;
        const previous = currentResolved;
        active = true;
        currentResolved = resolved;

        if (!wasActive) {
            resetWork();
            attachRoot(document);
        } else {
            refreshRootStylesAndObservers();
        }

        const adjustmentsChanged = !previous ||
            previous.scalePercent !== resolved.scalePercent ||
            previous.targetWeight !== resolved.targetWeight ||
            previous.fontId !== resolved.fontId ||
            API.stableStringify(previous.behavior) !== API.stableStringify(resolved.behavior);

        if (!adjustmentsEnabled()) {
            clearTrackedElements();
            resetWork();
        } else if (!wasActive || !previous || (previous.scalePercent === 100 && previous.targetWeight === 400)) {
            resetWork();
            enqueueScan(document);
            for (const state of rootStates) {
                if (state.root instanceof ShadowRoot) enqueueScan(state.root);
            }
        } else if (adjustmentsChanged) {
            refreshTrackedElements();
        }

        setTimeout(() => {
            if (active) discoverShadowRoots(document);
        }, 0);
    }

    function deactivate() {
        active = false;
        resetWork();
        clearTrackedElements();

        for (const state of rootStates) {
            state.observer.disconnect();
            state.style?.remove();
        }
        rootStates.clear();
    }

    function applyResolved(value) {
        const resolved = normalizeResolved(value);
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

    function handleSettings(value) {
        if (!value || typeof value !== 'object') return;
        latestSettings = API.normalizeSettings(value);
        if (!hostReady) return;
        applyResolved(API.resolveForHost(latestSettings, topHostname));
    }

    async function refreshFromRuntime() {
        const response = await sendRuntimeMessage({ type: 'CNT_GET_SETTINGS' });
        if (response?.settings) handleSettings(response.settings);
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'CNT_PREVIEW' && message.resolved) {
            applyResolved(message.resolved);
            return;
        }
        if (message.type === 'CNT_SETTINGS' || message.type === 'CNT_UPDATE') {
            handleSettings(message.settings || message.cnt || message.payload);
        }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes[API.STORAGE_KEY]?.newValue) {
            handleSettings(changes[API.STORAGE_KEY].newValue);
        }
    });

    async function initialize() {
        topHostname = await resolveTopHostname();
        hostReady = true;

        const local = await storageGet(chrome.storage.local, [API.CACHE_KEY]);
        if (local[API.CACHE_KEY]) handleSettings(local[API.CACHE_KEY]);
        await refreshFromRuntime();
    }

    initialize().catch(() => {
        deactivate();
    });
})();
