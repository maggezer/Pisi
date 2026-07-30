import { registerModule } from "../core/module-registry.mjs";

const PISI_CUSTOMIZATION_STORAGE_KEY = 'pisi.customization.v1';

const PISI_DEFAULT_CUSTOMIZATION = {
    mapDownHubColor: '#f39c12',
    mapCoLevelColor: '#34ace0',
    mapStreamColor: '#2ecc71',
    mapNodeBoxColor: '#252526',
    mapNodeTitleColor: '#f39c12',

    mapNodeTitleSize: 13,
    mapNodeTextSize: 12,

    nodeHeaderColor: '#f39c12'
};

const PISI_CUSTOMIZATION_CSS_VARIABLES = {
    mapDownHubColor: '--pisi-map-downhub-color',
    mapCoLevelColor: '--pisi-map-colevel-color',
    mapStreamColor: '--pisi-map-stream-color',
    mapNodeBoxColor: '--pisi-map-node-box-color',
    mapNodeTitleColor: '--pisi-map-node-title-color',

    mapNodeTitleSize: '--pisi-map-node-title-size',
    mapNodeTextSize: '--pisi-map-node-text-size',

    nodeHeaderColor: '--pisi-node-header-color'
};

function loadPisiCustomizationSettings() {
    try {
        const raw = localStorage.getItem(PISI_CUSTOMIZATION_STORAGE_KEY);

        if (!raw) {
            return { ...PISI_DEFAULT_CUSTOMIZATION };
        }

const parsed = JSON.parse(raw) || {};

if (parsed.mapConnectionColor && !parsed.mapDownHubColor) {
    parsed.mapDownHubColor = parsed.mapConnectionColor;
}

delete parsed.mapConnectionColor;

return {
    ...PISI_DEFAULT_CUSTOMIZATION,
    ...parsed
};
    } catch (error) {
        console.warn('[PISI] Customize ayarları okunamadı:', error);
        return { ...PISI_DEFAULT_CUSTOMIZATION };
    }
}

function savePisiCustomizationSettings(settings) {
    try {
        localStorage.setItem(
            PISI_CUSTOMIZATION_STORAGE_KEY,
            JSON.stringify(settings)
        );
    } catch (error) {
        console.warn('[PISI] Customize ayarları kaydedilemedi:', error);
    }
}

function isValidPisiHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function normalizePisiSizeValue(value, fallback, min = 8, max = 32) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function applyPisiCustomizationSettings(settings) {
    const root = document.documentElement;

    for (const [key, cssVariable] of Object.entries(PISI_CUSTOMIZATION_CSS_VARIABLES)) {
        const fallback = PISI_DEFAULT_CUSTOMIZATION[key];

        if (key === 'mapNodeTitleSize' || key === 'mapNodeTextSize') {
            const value = normalizePisiSizeValue(settings?.[key], fallback, 8, 32);
            root.style.setProperty(cssVariable, `${value}px`);
            continue;
        }

        const value = isValidPisiHexColor(settings?.[key])
            ? settings[key]
            : fallback;

        root.style.setProperty(cssVariable, value);
    }
}

function syncPisiCustomizationInputs(settings) {
    document.querySelectorAll('[data-pisi-custom-color]').forEach((input) => {
        const key = input.dataset.pisiCustomColor;
        const value = settings[key] || PISI_DEFAULT_CUSTOMIZATION[key];

        if (isValidPisiHexColor(value)) {
            input.value = value;
        }
    });

    document.querySelectorAll('[data-pisi-custom-size]').forEach((input) => {
        const key = input.dataset.pisiCustomSize;
        const fallback = PISI_DEFAULT_CUSTOMIZATION[key];

        input.value = normalizePisiSizeValue(settings?.[key], fallback, 8, 32);
    });
}

function setupPisiCustomizations() {
    const panel = document.getElementById('pisi-customize-panel');

    if (!panel) return;

    let settings = loadPisiCustomizationSettings();

    applyPisiCustomizationSettings(settings);
    syncPisiCustomizationInputs(settings);

    panel.querySelectorAll('[data-pisi-custom-color]').forEach((input) => {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    input.addEventListener('input', () => {
        const key = input.dataset.pisiCustomColor;
        const value = input.value;

        if (!PISI_DEFAULT_CUSTOMIZATION[key]) return;
        if (!isValidPisiHexColor(value)) return;

        settings = {
            ...settings,
            [key]: value
        };

        applyPisiCustomizationSettings(settings);
        savePisiCustomizationSettings(settings);
    });
});

    panel.querySelectorAll('[data-pisi-custom-size]').forEach((input) => {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    input.addEventListener('input', () => {
        const key = input.dataset.pisiCustomSize;

        if (!Object.prototype.hasOwnProperty.call(PISI_DEFAULT_CUSTOMIZATION, key)) return;

        const fallback = PISI_DEFAULT_CUSTOMIZATION[key];
        const value = normalizePisiSizeValue(input.value, fallback, 8, 32);

        settings = {
            ...settings,
            [key]: value
        };

        input.value = value;

        applyPisiCustomizationSettings(settings);
        savePisiCustomizationSettings(settings);
    });
    });

    const resetBtn = document.getElementById('pisi-customize-reset');

    if (resetBtn && resetBtn.dataset.bound !== '1') {
        resetBtn.dataset.bound = '1';

        resetBtn.addEventListener('click', () => {
            settings = { ...PISI_DEFAULT_CUSTOMIZATION };

            savePisiCustomizationSettings(settings);
            applyPisiCustomizationSettings(settings);
            syncPisiCustomizationInputs(settings);
        });
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "PISI_CUSTOMIZATION_STORAGE_KEY": {
        enumerable: true,
        get() { return PISI_CUSTOMIZATION_STORAGE_KEY; }
    },
    "PISI_DEFAULT_CUSTOMIZATION": {
        enumerable: true,
        get() { return PISI_DEFAULT_CUSTOMIZATION; }
    },
    "PISI_CUSTOMIZATION_CSS_VARIABLES": {
        enumerable: true,
        get() { return PISI_CUSTOMIZATION_CSS_VARIABLES; }
    },
    "loadPisiCustomizationSettings": {
        enumerable: true,
        get() { return loadPisiCustomizationSettings; }
    },
    "savePisiCustomizationSettings": {
        enumerable: true,
        get() { return savePisiCustomizationSettings; }
    },
    "isValidPisiHexColor": {
        enumerable: true,
        get() { return isValidPisiHexColor; }
    },
    "normalizePisiSizeValue": {
        enumerable: true,
        get() { return normalizePisiSizeValue; }
    },
    "applyPisiCustomizationSettings": {
        enumerable: true,
        get() { return applyPisiCustomizationSettings; }
    },
    "syncPisiCustomizationInputs": {
        enumerable: true,
        get() { return syncPisiCustomizationInputs; }
    },
    "setupPisiCustomizations": {
        enumerable: true,
        get() { return setupPisiCustomizations; }
    }
});
registerModule("shell.customizations", moduleApi);
