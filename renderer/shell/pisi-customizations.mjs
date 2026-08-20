import { registerModule } from "../core/module-registry.mjs";

const PISI_CUSTOMIZATION_STORAGE_KEY = 'pisi.customization.v1';
const PISI_THEME_STORAGE_KEY = 'pisi.theme.v1';
const PISI_THEME_VALUES = new Set(['dark', 'light']);
const PISI_EXPLICIT_THEME_COLOR_KEYS = '_explicitThemeColorKeys';
const PISI_THEME_MAP_NODE_BOX_COLORS = {
    dark: '#252526',
    light: '#ffffff'
};
const PISI_LEGACY_MAP_NODE_DEFAULT_FONT = '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif';
const PISI_MAP_NODE_FONT_OPTIONS = [
    ['"Vincendo", "Segoe UI", Tahoma, sans-serif', 'Vincendo'],
    [PISI_LEGACY_MAP_NODE_DEFAULT_FONT, 'Segoe UI Variable'],
    ['"Segoe UI", Tahoma, sans-serif', 'Segoe UI'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['"Trebuchet MS", Arial, sans-serif', 'Trebuchet MS'],
    ['Georgia, "Times New Roman", serif', 'Georgia']
];

const PISI_DEFAULT_CUSTOMIZATION = {
    mapDownHubColor: '#f39c12',
    mapCoLevelColor: '#34ace0',
    mapStreamColor: '#2ecc71',
    mapNodeBoxColor: PISI_THEME_MAP_NODE_BOX_COLORS.dark,
    mapNodeTitleColor: '#f39c12',
    mapNodeFontFamily: PISI_MAP_NODE_FONT_OPTIONS[0][0],
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
    mapNodeFontFamily: '--pisi-map-node-font-family',
    mapNodeTitleSize: '--pisi-map-node-title-size',
    mapNodeTextSize: '--pisi-map-node-text-size',
    nodeHeaderColor: '--pisi-node-header-color'
};

const PISI_GLOBAL_COLOR_FIELDS = [
    ['custom-map-downhub-color', 'Hub bağlantı', 'mapDownHubColor'],
    ['custom-map-colevel-color', 'Co-level bağlantı', 'mapCoLevelColor'],
    ['custom-map-stream-color', 'Stream bağlantı', 'mapStreamColor'],
    ['custom-map-node-box-color', 'Node box', 'mapNodeBoxColor'],
    ['custom-map-node-title-color', 'Node box title', 'mapNodeTitleColor']
];

const PISI_GLOBAL_SIZE_FIELDS = [
    ['custom-map-node-title-size', 'Nodebox title size', 'mapNodeTitleSize', 9, 28],
    ['custom-map-node-text-size', 'Nodebox text size', 'mapNodeTextSize', 9, 24]
];

function pisiCustomizeTranslate(value) {
    return window.pisiI18n?.translate?.(value) || String(value || '');
}

function makePisiCustomizeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) {
        element.textContent = pisiCustomizeTranslate(text);
    }
    return element;
}

function normalizePisiTheme(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PISI_THEME_VALUES.has(normalized) ? normalized : 'dark';
}

function getPisiThemePreference() {
    try {
        return normalizePisiTheme(localStorage.getItem(PISI_THEME_STORAGE_KEY));
    } catch {
        return 'dark';
    }
}

function applyPisiTheme(theme) {
    const normalized = normalizePisiTheme(theme);
    const root = document.documentElement;
    root.dataset.pisiTheme = normalized;
    root.style.colorScheme = normalized;
    return normalized;
}

function getPisiAppliedTheme() {
    return normalizePisiTheme(
        document.documentElement?.dataset?.pisiTheme ||
        getPisiThemePreference()
    );
}

function setPisiThemePreference(theme) {
    const normalized = applyPisiTheme(theme);
    try {
        localStorage.setItem(PISI_THEME_STORAGE_KEY, normalized);
    } catch (error) {
        console.warn('[PISI] Tema tercihi kaydedilemedi:', error);
    }
    const settings = loadPisiCustomizationSettings();
    applyPisiCustomizationSettings(settings);
    syncPisiCustomizationInputs(settings);
    document.dispatchEvent(new CustomEvent('pisi:theme-changed', {
        detail: { theme: normalized }
    }));
    return normalized;
}

function loadPisiCustomizationSettings() {
    try {
        const raw = localStorage.getItem(PISI_CUSTOMIZATION_STORAGE_KEY);
        if (!raw) {
            return {
                ...PISI_DEFAULT_CUSTOMIZATION,
                [PISI_EXPLICIT_THEME_COLOR_KEYS]: []
            };
        }

        const parsed = JSON.parse(raw) || {};

        // Migrate only the former built-in default. Other explicit font choices
        // remain untouched.
        if (parsed.mapNodeFontFamily === PISI_LEGACY_MAP_NODE_DEFAULT_FONT) {
            parsed.mapNodeFontFamily = PISI_DEFAULT_CUSTOMIZATION.mapNodeFontFamily;
        }

        if (parsed.mapConnectionColor && !parsed.mapDownHubColor) {
            parsed.mapDownHubColor = parsed.mapConnectionColor;
        }
        delete parsed.mapConnectionColor;

        const explicitThemeColorKeys = new Set(
            normalizePisiExplicitThemeColorKeys(
                parsed[PISI_EXPLICIT_THEME_COLOR_KEYS]
            )
        );
        const storedNodeBoxColor = String(
            parsed.mapNodeBoxColor || ''
        ).toLowerCase();
        const themeNodeBoxColors = Object.values(
            PISI_THEME_MAP_NODE_BOX_COLORS
        );

        // Eski sürümler açık temadaki beyazı kalıcı bir özelleştirme gibi
        // saklayabiliyordu. Tema renklerinden farklı eski değerler gerçek
        // kullanıcı tercihi sayılır; beyaz/koyu palet değerleri temayı izler.
        if (
            !Array.isArray(parsed[PISI_EXPLICIT_THEME_COLOR_KEYS]) &&
            isValidPisiHexColor(storedNodeBoxColor) &&
            !themeNodeBoxColors.includes(storedNodeBoxColor)
        ) {
            explicitThemeColorKeys.add('mapNodeBoxColor');
        }

        return {
            ...PISI_DEFAULT_CUSTOMIZATION,
            ...parsed,
            [PISI_EXPLICIT_THEME_COLOR_KEYS]: Array.from(
                explicitThemeColorKeys
            )
        };
    } catch (error) {
        console.warn('[PISI] Customize ayarları okunamadı:', error);
        return {
            ...PISI_DEFAULT_CUSTOMIZATION,
            [PISI_EXPLICIT_THEME_COLOR_KEYS]: []
        };
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

function normalizePisiExplicitThemeColorKeys(value) {
    return Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .filter((key) => key === 'mapNodeBoxColor')
    ));
}

function normalizePisiSizeValue(value, fallback, min = 8, max = 32) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function normalizePisiMapNodeFontFamily(value) {
    const font = String(value || '');
    return PISI_MAP_NODE_FONT_OPTIONS.some(([candidate]) => candidate === font)
        ? font
        : PISI_DEFAULT_CUSTOMIZATION.mapNodeFontFamily;
}

function resolvePisiCustomizationValue(
    key,
    settings = loadPisiCustomizationSettings()
) {
    const fallback = PISI_DEFAULT_CUSTOMIZATION[key];

    if (key === 'mapNodeFontFamily') {
        return normalizePisiMapNodeFontFamily(settings?.[key]);
    }

    if (key === 'mapNodeTitleSize' || key === 'mapNodeTextSize') {
        return normalizePisiSizeValue(settings?.[key], fallback, 8, 32);
    }

    const value = isValidPisiHexColor(settings?.[key])
        ? settings[key]
        : fallback;

    if (key === 'mapNodeBoxColor') {
        const normalizedValue = value.toLowerCase();
        const explicitThemeColorKeys = normalizePisiExplicitThemeColorKeys(
            settings?.[PISI_EXPLICIT_THEME_COLOR_KEYS]
        );
        const isThemePaletteColor = Object.values(
            PISI_THEME_MAP_NODE_BOX_COLORS
        ).includes(normalizedValue);
        const isExplicit = explicitThemeColorKeys.includes(key) ||
            !isThemePaletteColor;

        if (!isExplicit) {
            return PISI_THEME_MAP_NODE_BOX_COLORS[getPisiAppliedTheme()];
        }
    }
    return value;
}

function applyPisiCustomizationSettings(settings) {
    const root = document.documentElement;

    for (const [key, cssVariable] of Object.entries(
        PISI_CUSTOMIZATION_CSS_VARIABLES
    )) {
        const value = resolvePisiCustomizationValue(key, settings);
        if (typeof value === 'number') {
            root.style.setProperty(cssVariable, `${value}px`);
            continue;
        }
        root.style.setProperty(cssVariable, value);
    }
}

function syncPisiCustomizationInputs(
    settings,
    root = document
) {
    root.querySelectorAll('[data-pisi-custom-color]').forEach((input) => {
        const key = input.dataset.pisiCustomColor;
        const value = resolvePisiCustomizationValue(key, settings);
        if (isValidPisiHexColor(value)) input.value = value;
    });

    root.querySelectorAll('[data-pisi-custom-size]').forEach((input) => {
        const key = input.dataset.pisiCustomSize;
        input.value = resolvePisiCustomizationValue(key, settings);
    });

    root.querySelectorAll('[data-pisi-custom-font]').forEach((select) => {
        select.value = resolvePisiCustomizationValue(
            select.dataset.pisiCustomFont,
            settings
        );
    });
}

function makePisiPreferenceGroup(titleText, open = true) {
    const group = makePisiCustomizeElement(
        'details',
        'pisi-customize-group pisi-preference-group'
    );
    group.open = open;
    group.appendChild(makePisiCustomizeElement('summary', '', titleText));
    return group;
}

function appendPisiColorPreference(group, id, labelText, key) {
    const row = makePisiCustomizeElement('div', 'pisi-customize-row');
    const label = makePisiCustomizeElement('label', '', labelText);
    label.htmlFor = id;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'pisi-color-input';
    input.type = 'color';
    input.dataset.pisiCustomColor = key;
    row.append(label, input);
    group.appendChild(row);
}

function appendPisiSizePreference(group, field) {
    const [id, labelText, key, min, max] = field;
    const row = makePisiCustomizeElement('div', 'pisi-customize-row');
    const label = makePisiCustomizeElement('label', '', labelText);
    label.htmlFor = id;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'pisi-number-input';
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.dataset.pisiCustomSize = key;
    row.append(label, input);
    group.appendChild(row);
}

function appendPisiFontPreference(group) {
    const row = makePisiCustomizeElement('div', 'pisi-customize-row');
    const label = makePisiCustomizeElement('label', '', 'Nodebox font');
    label.htmlFor = 'custom-map-node-font';
    const select = document.createElement('select');
    select.id = 'custom-map-node-font';
    select.className = 'pisi-map-font-select';
    select.dataset.pisiCustomFont = 'mapNodeFontFamily';
    for (const [value, text] of PISI_MAP_NODE_FONT_OPTIONS) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    }
    row.append(label, select);
    group.appendChild(row);
}

function bindPisiCustomizationPreferenceControls(panel) {
    let settings = loadPisiCustomizationSettings();
    syncPisiCustomizationInputs(settings, panel);

    panel.querySelectorAll('[data-pisi-custom-color]').forEach((input) => {
        input.addEventListener('input', () => {
            const key = input.dataset.pisiCustomColor;
            if (!PISI_DEFAULT_CUSTOMIZATION[key]) return;
            if (!isValidPisiHexColor(input.value)) return;

            if (key === 'mapNodeBoxColor') {
                const explicitThemeColorKeys = new Set(
                    normalizePisiExplicitThemeColorKeys(
                        settings[PISI_EXPLICIT_THEME_COLOR_KEYS]
                    )
                );
                explicitThemeColorKeys.add(key);
                settings = {
                    ...settings,
                    [key]: input.value,
                    [PISI_EXPLICIT_THEME_COLOR_KEYS]: Array.from(
                        explicitThemeColorKeys
                    )
                };
            } else {
                settings = { ...settings, [key]: input.value };
            }
            applyPisiCustomizationSettings(settings);
            savePisiCustomizationSettings(settings);
            document.dispatchEvent(new CustomEvent(
                'pisi:customization-defaults-changed'
            ));
        });
    });

    panel.querySelectorAll('[data-pisi-custom-size]').forEach((input) => {
        input.addEventListener('input', () => {
            const key = input.dataset.pisiCustomSize;
            if (!Object.prototype.hasOwnProperty.call(
                PISI_DEFAULT_CUSTOMIZATION,
                key
            )) {
                return;
            }

            const value = normalizePisiSizeValue(
                input.value,
                PISI_DEFAULT_CUSTOMIZATION[key],
                Number(input.min || 8),
                Number(input.max || 32)
            );
            settings = { ...settings, [key]: value };
            input.value = value;
            applyPisiCustomizationSettings(settings);
            savePisiCustomizationSettings(settings);
            document.dispatchEvent(new CustomEvent(
                'pisi:customization-defaults-changed'
            ));
        });
    });

    panel.querySelectorAll('[data-pisi-custom-font]').forEach((select) => {
        select.addEventListener('change', () => {
            const key = select.dataset.pisiCustomFont;
            settings = {
                ...settings,
                [key]: normalizePisiMapNodeFontFamily(select.value)
            };
            applyPisiCustomizationSettings(settings);
            savePisiCustomizationSettings(settings);
            document.dispatchEvent(new CustomEvent(
                'pisi:customization-defaults-changed'
            ));
        });
    });

    const language = panel.querySelector('#pisi-language-select');
    if (language) {
        language.value = window.pisiI18n?.getLanguage?.() || 'tr';
        language.addEventListener('change', () => {
            void window.pisiI18n?.setLanguage?.(language.value);
        });
    }

    panel.querySelector('#pisi-customize-reset')?.addEventListener(
        'click',
        () => {
            settings = {
                ...PISI_DEFAULT_CUSTOMIZATION,
                [PISI_EXPLICIT_THEME_COLOR_KEYS]: []
            };
            savePisiCustomizationSettings(settings);
            applyPisiCustomizationSettings(settings);
            syncPisiCustomizationInputs(settings, panel);
            document.dispatchEvent(new CustomEvent(
                'pisi:customization-defaults-changed'
            ));
        }
    );
}

function renderPisiCustomizationPreferences(container) {
    const panel = makePisiCustomizeElement(
        'section',
        'pisi-preferences-customization'
    );
    panel.id = 'pisi-customize-preferences';

    const heading = makePisiCustomizeElement(
        'div',
        'pisi-preferences-subheading'
    );
    heading.append(
        makePisiCustomizeElement('h3', '', 'Uygulama ve varsayılanlar'),
        makePisiCustomizeElement(
            'p',
            '',
            'Bu değerler tüm map ve not kartları için varsayılan görünümü belirler.'
        )
    );

    const application = makePisiPreferenceGroup('Uygulama');
    const languageRow = makePisiCustomizeElement(
        'div',
        'pisi-customize-row'
    );
    const languageLabel = makePisiCustomizeElement('label', '', 'Dil');
    languageLabel.htmlFor = 'pisi-language-select';
    const language = document.createElement('select');
    language.id = 'pisi-language-select';
    language.className = 'pisi-language-select';
    const turkish = document.createElement('option');
    turkish.value = 'tr';
    turkish.textContent = 'Türkçe';
    const english = document.createElement('option');
    english.value = 'eng';
    english.textContent = 'English';
    language.append(turkish, english);
    languageRow.append(languageLabel, language);
    application.append(
        languageRow,
        makePisiCustomizeElement(
            'div',
            'pisi-customize-note',
            'Dil değişikliği anında uygulanır.'
        )
    );

    const map = makePisiPreferenceGroup('Map');
    for (const field of PISI_GLOBAL_COLOR_FIELDS) {
        appendPisiColorPreference(map, ...field);
    }
    appendPisiFontPreference(map);
    for (const field of PISI_GLOBAL_SIZE_FIELDS) {
        appendPisiSizePreference(map, field);
    }
    map.appendChild(makePisiCustomizeElement(
        'div',
        'pisi-customize-note',
        'Yazı tipi ve boyut ayarları haritadaki tüm not kartlarına uygulanır.'
    ));

    const node = makePisiPreferenceGroup('Node');
    appendPisiColorPreference(
        node,
        'custom-node-header-color',
        'Headerlar',
        'nodeHeaderColor'
    );

    const reset = makePisiCustomizeElement(
        'button',
        'pisi-customize-reset',
        'Varsayılanlara dön'
    );
    reset.id = 'pisi-customize-reset';
    reset.type = 'button';

    panel.append(heading, application, map, node, reset);
    container.appendChild(panel);
    bindPisiCustomizationPreferenceControls(panel);
    return panel;
}

function applyPisiMapNodeCustomization(box, node) {
    if (!box) return;
    const cardColor = node?.customization?.cardColor;
    const titleColor = node?.customization?.titleColor;

    if (isValidPisiHexColor(cardColor)) {
        box.style.setProperty('--pisi-map-node-box-color', cardColor);
    } else {
        box.style.removeProperty('--pisi-map-node-box-color');
    }

    if (isValidPisiHexColor(titleColor)) {
        box.style.setProperty('--pisi-map-node-title-color', titleColor);
    } else {
        box.style.removeProperty('--pisi-map-node-title-color');
    }

    box.dataset.pisiCustomized = (
        isValidPisiHexColor(cardColor) ||
        isValidPisiHexColor(titleColor)
    ) ? 'true' : 'false';
}

function getPisiMapEdgeCustomizationColor(edge) {
    return isValidPisiHexColor(edge?.customization?.color)
        ? edge.customization.color
        : '';
}

function getPisiMapEdgeDefaultColor(edge) {
    const key = edge?.type === 'co-level'
        ? 'mapCoLevelColor'
        : edge?.type === 'stream'
            ? 'mapStreamColor'
            : 'mapDownHubColor';
    return resolvePisiCustomizationValue(key);
}

function getPisiMapCustomizationContext() {
    const canvas = document.getElementById('map-canvas');
    const mapOpen = Boolean(
        window.activeMapPath &&
        canvas &&
        !canvas.hidden &&
        canvas.style.display !== 'none'
    );

    if (!mapOpen) return { mapOpen: false, kind: 'none' };

    const edge = Array.isArray(window.activeMapEdges)
        ? window.activeMapEdges.find((item) => (
            item?.id === window.selectedMapEdgeId
        ))
        : null;
    if (edge) return { mapOpen: true, kind: 'edge', edge };

    const selectedBoxes = Array.from(document.querySelectorAll(
        '.map-node-box.selected[data-node-id]'
    ));
    if (selectedBoxes.length === 1) {
        const box = selectedBoxes[0];
        const node = Array.isArray(window.activeMapNodes)
            ? window.activeMapNodes.find((item) => (
                item?.id === box.dataset.nodeId
            ))
            : null;
        if (node) return { mapOpen: true, kind: 'node', node, box };
    }

    return {
        mapOpen: true,
        kind: selectedBoxes.length > 1 ? 'multiple' : 'empty'
    };
}

function getPisiMapNodeTitle(node) {
    return (
        node?.metadata?.title ||
        String(node?.fileName || '').replace(/\.node$/i, '') ||
        pisiCustomizeTranslate('Node')
    );
}

function makePisiSelectionColorRow(id, labelText, value) {
    const row = makePisiCustomizeElement(
        'label',
        'pisi-selection-customize-row'
    );
    row.htmlFor = id;
    const copy = makePisiCustomizeElement('span', '', labelText);
    const input = document.createElement('input');
    input.id = id;
    input.className = 'pisi-color-input';
    input.type = 'color';
    input.value = value;
    row.append(copy, input);
    return { row, input };
}

function setPisiMapNodeCustomization(node, key, value) {
    if (!node || !['cardColor', 'titleColor'].includes(key)) return false;
    if (!isValidPisiHexColor(value)) return false;

    node.customization = {
        ...(node.customization || {}),
        [key]: value
    };
    const box = document.querySelector(
        `.map-node-box[data-node-id="${CSS.escape(node.id)}"]`
    );
    applyPisiMapNodeCustomization(box, node);
    return true;
}

async function persistPisiMapEdgeCustomization(edgeId, fallbackCustomization) {
    const edge = Array.isArray(window.activeMapEdges)
        ? window.activeMapEdges.find((item) => item?.id === edgeId)
        : null;
    if (!edge || !window.activeMapPath) return false;
    const mapPath = window.activeMapPath;

    try {
        if (typeof window.suppressNextFileSystemRefresh === 'function') {
            window.suppressNextFileSystemRefresh(2000);
        }
        const result = await window.pisiProject?.upsertMapConnection?.(
            mapPath,
            edge
        );
        if (!result?.ok) {
            edge.customization = { ...(fallbackCustomization || {}) };
            if (!Object.keys(edge.customization).length) {
                delete edge.customization;
            }
            if (window.activeMapPath === mapPath) {
                window.drawMapConnections?.();
            }
            alert(result?.error || pisiCustomizeTranslate(
                'Bağlantı rengi kaydedilemedi.'
            ));
            if (window.activeMapPath === mapPath) {
                renderPisiMapCustomizationPanel();
            }
            return false;
        }
        if (window.activeMapPath === mapPath) {
            window.activeMapEdges = result.edges || window.activeMapEdges;
            window.drawMapConnections?.();
            renderPisiMapCustomizationPanel();
        }
        return true;
    } catch (error) {
        edge.customization = { ...(fallbackCustomization || {}) };
        if (!Object.keys(edge.customization).length) {
            delete edge.customization;
        }
        if (window.activeMapPath === mapPath) {
            window.drawMapConnections?.();
        }
        console.error('[PISI] Bağlantı rengi kaydedilemedi:', error);
        alert(pisiCustomizeTranslate('Bağlantı rengi kaydedilemedi.'));
        if (window.activeMapPath === mapPath) {
            renderPisiMapCustomizationPanel();
        }
        return false;
    }
}

function makePisiSelectionHeader(labelText, titleText) {
    const header = makePisiCustomizeElement(
        'div',
        'pisi-selection-customize-header'
    );
    const title = document.createElement('strong');
    title.className = 'pisi-selection-customize-title';
    title.dataset.pisiUserContent = 'true';
    title.textContent = String(titleText || '');
    header.append(
        makePisiCustomizeElement(
            'span',
            'pisi-selection-customize-eyebrow',
            labelText
        ),
        title
    );
    return header;
}

function renderPisiNodeCustomization(panel, context) {
    const { node, box } = context;
    const cardColor = isValidPisiHexColor(node.customization?.cardColor)
        ? node.customization.cardColor
        : resolvePisiCustomizationValue('mapNodeBoxColor');
    const titleColor = isValidPisiHexColor(node.customization?.titleColor)
        ? node.customization.titleColor
        : resolvePisiCustomizationValue('mapNodeTitleColor');

    const card = makePisiSelectionColorRow(
        'pisi-selected-node-card-color',
        'Node box',
        cardColor
    );
    const title = makePisiSelectionColorRow(
        'pisi-selected-node-title-color',
        'Node box title',
        titleColor
    );
    card.input.addEventListener('input', () => {
        if (setPisiMapNodeCustomization(node, 'cardColor', card.input.value)) {
            window.scheduleMapLayoutSave?.();
        }
    });
    title.input.addEventListener('input', () => {
        if (setPisiMapNodeCustomization(node, 'titleColor', title.input.value)) {
            window.scheduleMapLayoutSave?.();
        }
    });

    const reset = makePisiCustomizeElement(
        'button',
        'pisi-selection-customize-reset',
        'Bu öğenin özelleştirmesini kaldır'
    );
    reset.type = 'button';
    reset.disabled = !Object.keys(node.customization || {}).length;
    reset.addEventListener('click', async () => {
        node.customization = {};
        applyPisiMapNodeCustomization(box, node);
        await window.saveCurrentMapLayout?.();
        renderPisiMapCustomizationPanel();
    });

    panel.append(
        makePisiSelectionHeader('Seçili not kartı', getPisiMapNodeTitle(node)),
        card.row,
        title.row,
        makePisiCustomizeElement(
            'p',
            'pisi-selection-customize-note',
            'Bu renkler yalnızca seçili not kartına uygulanır ve varsayılanların önüne geçer.'
        ),
        reset
    );
}

function renderPisiEdgeCustomization(panel, context) {
    const { edge } = context;
    const originalCustomization = { ...(edge.customization || {}) };
    const color = getPisiMapEdgeCustomizationColor(edge) ||
        getPisiMapEdgeDefaultColor(edge);
    const row = makePisiSelectionColorRow(
        'pisi-selected-edge-color',
        'Bağlantı rengi',
        color
    );
    row.input.addEventListener('input', () => {
        if (!isValidPisiHexColor(row.input.value)) return;
        edge.customization = {
            ...(edge.customization || {}),
            color: row.input.value
        };
        window.drawMapConnections?.();
    });
    row.input.addEventListener('change', async () => {
        row.input.disabled = true;
        await persistPisiMapEdgeCustomization(
            edge.id,
            originalCustomization
        );
    });

    const reset = makePisiCustomizeElement(
        'button',
        'pisi-selection-customize-reset',
        'Bu öğenin özelleştirmesini kaldır'
    );
    reset.type = 'button';
    reset.disabled = !getPisiMapEdgeCustomizationColor(edge);
    reset.addEventListener('click', async () => {
        const fallback = { ...(edge.customization || {}) };
        delete edge.customization;
        window.drawMapConnections?.();
        await persistPisiMapEdgeCustomization(edge.id, fallback);
        renderPisiMapCustomizationPanel();
    });

    panel.append(
        makePisiSelectionHeader(
            'Seçili bağlantı',
            pisiCustomizeTranslate('Bağlantı')
        ),
        row.row,
        makePisiCustomizeElement(
            'p',
            'pisi-selection-customize-note',
            'Bu renk yalnızca seçili bağlantıya uygulanır ve varsayılan rengin önüne geçer.'
        ),
        reset
    );
}

function renderPisiMapCustomizationPanel() {
    const panel = document.getElementById('pisi-map-customize-panel');
    if (!panel) return;
    panel.replaceChildren();

    const context = getPisiMapCustomizationContext();
    if (!context.mapOpen) {
        panel.appendChild(makePisiCustomizeElement(
            'div',
            'pisi-selection-customize-empty',
            'Özelleştirmek için orta alanda bir map aç.'
        ));
        return;
    }
    if (context.kind === 'node') {
        renderPisiNodeCustomization(panel, context);
        return;
    }
    if (context.kind === 'edge') {
        renderPisiEdgeCustomization(panel, context);
        return;
    }

    panel.appendChild(makePisiCustomizeElement(
        'div',
        'pisi-selection-customize-empty',
        context.kind === 'multiple'
            ? 'Tek bir not kartı seç.'
            : 'Bir not kartı veya bağlantı seç.'
    ));
}

function syncPisiMapCustomizationTab() {
    const button = document.querySelector(
        '.right-panel-tab[data-right-tab="customizations"]'
    );
    const context = getPisiMapCustomizationContext();
    const enabled = context.mapOpen;

    if (button) {
        if (button.parentElement?.lastElementChild !== button) {
            button.parentElement?.appendChild(button);
        }
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        button.title = pisiCustomizeTranslate(
            enabled ? 'Customize' : 'Özelleştirmek için orta alanda bir map aç.'
        );
        button.setAttribute('aria-label', button.title);

        if (!enabled && button.classList.contains('active')) {
            document.querySelector(
                '.right-panel-tab[data-right-tab="missions"]'
            )?.click();
        }
    }
    renderPisiMapCustomizationPanel();
}

function setupPisiCustomizations() {
    const settings = loadPisiCustomizationSettings();
    applyPisiCustomizationSettings(settings);

    if (document.body?.dataset.pisiCustomizationBound !== '1') {
        document.body.dataset.pisiCustomizationBound = '1';
        document.addEventListener(
            'pisi:map-customization-context-changed',
            syncPisiMapCustomizationTab
        );
        document.addEventListener(
            'pisi:theme-changed',
            syncPisiMapCustomizationTab
        );
        document.addEventListener(
            'pisi:customization-defaults-changed',
            syncPisiMapCustomizationTab
        );
        document.addEventListener(
            'pisi:language-changed',
            syncPisiMapCustomizationTab
        );
    }
    syncPisiMapCustomizationTab();
}

applyPisiTheme(getPisiThemePreference());
applyPisiCustomizationSettings(loadPisiCustomizationSettings());

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
    "resolvePisiCustomizationValue": {
        enumerable: true,
        get() { return resolvePisiCustomizationValue; }
    },
    "applyPisiCustomizationSettings": {
        enumerable: true,
        get() { return applyPisiCustomizationSettings; }
    },
    "syncPisiCustomizationInputs": {
        enumerable: true,
        get() { return syncPisiCustomizationInputs; }
    },
    "renderPisiCustomizationPreferences": {
        enumerable: true,
        get() { return renderPisiCustomizationPreferences; }
    },
    "applyPisiMapNodeCustomization": {
        enumerable: true,
        get() { return applyPisiMapNodeCustomization; }
    },
    "getPisiMapEdgeCustomizationColor": {
        enumerable: true,
        get() { return getPisiMapEdgeCustomizationColor; }
    },
    "getPisiMapCustomizationContext": {
        enumerable: true,
        get() { return getPisiMapCustomizationContext; }
    },
    "renderPisiMapCustomizationPanel": {
        enumerable: true,
        get() { return renderPisiMapCustomizationPanel; }
    },
    "syncPisiMapCustomizationTab": {
        enumerable: true,
        get() { return syncPisiMapCustomizationTab; }
    },
    "setupPisiCustomizations": {
        enumerable: true,
        get() { return setupPisiCustomizations; }
    }
});
registerModule("shell.customizations", moduleApi);

export {
    applyPisiTheme,
    getPisiThemePreference,
    normalizePisiTheme,
    renderPisiCustomizationPreferences,
    setPisiThemePreference
};
