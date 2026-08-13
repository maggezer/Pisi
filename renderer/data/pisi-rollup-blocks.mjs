import { registerModule } from "../core/module-registry.mjs";
import {
    getPisiActiveBlock,
    getPisiActiveBlocksEditor,
    selectPisiBlock
} from "../editor/pisi-block-editor.mjs";
import {
    PISI_ROLLUP_AGGREGATES,
    collectPisiPropertyColumns,
    computePisiRollupValue,
    normalizePisiPropertyCollection,
    resolvePisiRelationDocuments
} from "./pisi-properties-core.mjs";
import { getPisiNodePropertyMapContext } from "./pisi-structured-views.mjs";

const PISI_ROLLUP_AGGREGATE_VALUES = new Set(
    PISI_ROLLUP_AGGREGATES.map((item) => item.value)
);
const pisiHydratedRollupBlocks = new WeakSet();
const pisiRollupRenderGenerations = new WeakMap();

const pisiRollupBlockState = {
    block: null,
    context: null,
    dialog: null,
    editor: null,
    generation: 0,
    initialized: false,
    isNew: false,
    overlay: null
};

function pisiRollupBlockTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function pisiRollupPathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

function getPisiRollupEditorNodePath(editor) {
    if (editor?.id === 'node-modal-content') return window.activeModalNode?.path || null;
    if (editor?.id === 'center-node-editor-content') return window.activeCenterNode?.path || null;
    return null;
}

function resolvePisiRollupRequestEditor(editorTarget = null) {
    const requested = editorTarget ? document.getElementById(editorTarget) : null;
    const editor = requested?.matches?.('.pisi-rich-editor')
        ? requested
        : getPisiActiveBlocksEditor();
    return getPisiRollupEditorNodePath(editor) ? editor : null;
}

function readPisiRollupBlockConfig(block) {
    const aggregate = block?.dataset?.pisiRollupAggregate;
    return {
        relationProperty: String(block?.dataset?.pisiRollupRelation || ''),
        targetProperty: String(block?.dataset?.pisiRollupTarget || ''),
        aggregate: PISI_ROLLUP_AGGREGATE_VALUES.has(aggregate) ? aggregate : 'count',
        separator: ', '
    };
}

function writePisiRollupBlockConfig(block, config = {}) {
    if (!block) return false;
    block.dataset.pisiRollupRelation = String(config.relationProperty || '').slice(0, 160);
    block.dataset.pisiRollupTarget = String(config.targetProperty || '').slice(0, 160);
    block.dataset.pisiRollupAggregate = PISI_ROLLUP_AGGREGATE_VALUES.has(config.aggregate)
        ? config.aggregate
        : 'count';
    return true;
}

function getPisiRollupNodeTitle(node) {
    return node?.metadata?.title ||
        String(node?.fileName || '').replace(/\.node$/i, '') ||
        node?.fullPath ||
        pisiRollupBlockTranslate('Node');
}

async function loadPisiRollupBlockContext(block) {
    const editor = block?.closest?.('.pisi-rich-editor');
    const nodePath = getPisiRollupEditorNodePath(editor);
    if (!nodePath) throw new Error(pisiRollupBlockTranslate('Rollup için açık bir node gerekli.'));

    const [documentResult, mapContext] = await Promise.all([
        window.pisiProject?.getPisiDocument?.(nodePath),
        getPisiNodePropertyMapContext(nodePath)
    ]);
    if (!documentResult?.ok) {
        throw new Error(documentResult?.error || pisiRollupBlockTranslate('Node okunamadı.'));
    }

    const targetKey = pisiRollupPathKey(nodePath);
    const documents = (mapContext.nodes || []).map((node) => ({
        ...node,
        path: node.fullPath || node.path,
        relativePath: node.fileName || node.relativePath || node.fullPath,
        title: getPisiRollupNodeTitle(node),
        properties: node.properties || node.data?.properties || {}
    }));
    const indexedRecord = documents.find((record) => {
        return pisiRollupPathKey(record.path) === targetKey;
    });
    const currentRecord = {
        ...(indexedRecord || {}),
        path: nodePath,
        relativePath: indexedRecord?.relativePath || nodePath,
        title: documentResult.metadata?.title || indexedRecord?.title || nodePath,
        metadata: documentResult.metadata || indexedRecord?.metadata || {},
        properties: documentResult.data?.properties || {}
    };
    const databaseDocuments = indexedRecord
        ? documents.map((record) => (
            pisiRollupPathKey(record.path) === targetKey ? currentRecord : record
        ))
        : [...documents, currentRecord];

    return {
        currentProperties: normalizePisiPropertyCollection(currentRecord.properties),
        currentRecord,
        documents: databaseDocuments,
        mapContext,
        nodePath
    };
}

function getPisiRollupRelationDefinitions(context) {
    return (context?.currentProperties || [])
        .filter((property) => property.type === 'relation')
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

function getPisiRollupRelationProperty(context, relationId) {
    const key = String(relationId || '').toLocaleLowerCase('tr-TR');
    return getPisiRollupRelationDefinitions(context).find((property) => {
        return [property.id, property.name]
            .some((value) => String(value || '').toLocaleLowerCase('tr-TR') === key);
    }) || null;
}

function getPisiRollupTargetDefinitions(context, relationId) {
    const relation = getPisiRollupRelationProperty(context, relationId);
    const related = relation
        ? resolvePisiRelationDocuments(relation, context?.documents || [])
        : [];
    const source = related.length ? related : (context?.documents || []);
    return collectPisiPropertyColumns(source)
        .filter((property) => property.type !== 'rollup')
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

function getPisiRollupAggregateLabel(aggregate) {
    const record = PISI_ROLLUP_AGGREGATES.find((item) => item.value === aggregate);
    return pisiRollupBlockTranslate(record?.label || 'Kayıt sayısı');
}

function formatPisiRollupBlockValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (typeof value === 'number') {
        const locale = window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-GB' : 'tr-TR';
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
    }
    return String(value);
}

function makePisiRollupBlockHeader(aggregate) {
    const header = document.createElement('div');
    header.className = 'pisi-rollup-block-header';
    const icon = document.createElement('span');
    icon.className = 'pisi-rollup-block-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('strong');
    label.textContent = pisiRollupBlockTranslate('Rollup');
    const badge = document.createElement('span');
    badge.className = 'pisi-rollup-block-badge';
    badge.textContent = getPisiRollupAggregateLabel(aggregate);
    header.append(icon, label, badge);
    return header;
}

function renderPisiRollupBlockMessage(block, message, className) {
    const config = readPisiRollupBlockConfig(block);
    const text = document.createElement('div');
    text.className = className;
    text.textContent = pisiRollupBlockTranslate(message);
    block.replaceChildren(makePisiRollupBlockHeader(config.aggregate), text);
}

async function renderPisiRollupBlock(block, providedContext = null) {
    if (!block?.isConnected || block.dataset.pisiBlockType !== 'rollup') return false;
    const generation = (pisiRollupRenderGenerations.get(block) || 0) + 1;
    pisiRollupRenderGenerations.set(block, generation);
    block.classList.add('pisi-rollup-block');
    block.contentEditable = 'false';
    block.tabIndex = 0;
    block.setAttribute('role', 'group');
    block.title = pisiRollupBlockTranslate('Düzenlemek için çift tıklayın');
    block.setAttribute('aria-label', pisiRollupBlockTranslate('Rollup bloğunu düzenle'));

    const config = readPisiRollupBlockConfig(block);
    if (!config.relationProperty) {
        renderPisiRollupBlockMessage(
            block,
            'Yapılandırılmamış Rollup',
            'pisi-rollup-block-empty'
        );
        return true;
    }

    renderPisiRollupBlockMessage(
        block,
        'Rollup hesaplanıyor…',
        'pisi-rollup-block-loading'
    );
    try {
        const context = providedContext || await loadPisiRollupBlockContext(block);
        if (!block.isConnected || pisiRollupRenderGenerations.get(block) !== generation) {
            return false;
        }
        const relation = getPisiRollupRelationProperty(context, config.relationProperty);
        const target = getPisiRollupTargetDefinitions(context, config.relationProperty)
            .find((property) => [property.id, property.name].includes(config.targetProperty));
        const rollupProperty = { type: 'rollup', value: config };
        const result = computePisiRollupValue(
            context.currentRecord,
            rollupProperty,
            context.documents
        );
        const value = document.createElement('div');
        value.className = 'pisi-rollup-block-value';
        value.textContent = formatPisiRollupBlockValue(result);
        const detail = document.createElement('div');
        detail.className = 'pisi-rollup-block-detail';
        const relationLabel = relation?.name || config.relationProperty;
        const targetLabel = target?.name || config.targetProperty;
        detail.textContent = targetLabel
            ? `${relationLabel} → ${targetLabel}`
            : relationLabel;
        block.replaceChildren(makePisiRollupBlockHeader(config.aggregate), value, detail);
        return true;
    } catch (error) {
        console.error('[PISI] Rollup block could not be rendered:', error);
        if (pisiRollupRenderGenerations.get(block) !== generation) return false;
        renderPisiRollupBlockMessage(
            block,
            'Rollup hesaplanamadı.',
            'pisi-rollup-block-error'
        );
        return false;
    }
}

function hydratePisiRollupBlock(block, options = {}) {
    if (!block || block.dataset.pisiBlockType !== 'rollup') return false;
    const firstHydration = !pisiHydratedRollupBlocks.has(block);
    if (firstHydration) {
        pisiHydratedRollupBlocks.add(block);
        block.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void openPisiRollupDialog(block);
        });
        block.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void openPisiRollupDialog(block);
        });
    }
    if (firstHydration || options.force === true) void renderPisiRollupBlock(block);
    return true;
}

function hydratePisiRollupBlocks(editor = getPisiActiveBlocksEditor(), options = {}) {
    if (!editor) return 0;
    const blocks = editor.querySelectorAll(
        '.pisi-editor-block[data-pisi-block-type="rollup"]'
    );
    blocks.forEach((block) => hydratePisiRollupBlock(block, options));
    return blocks.length;
}

function makePisiRollupEditorField(labelText, control) {
    const field = document.createElement('label');
    field.className = 'pisi-rollup-block-editor-field';
    const label = document.createElement('span');
    label.textContent = pisiRollupBlockTranslate(labelText);
    field.append(label, control);
    return field;
}

function closePisiRollupDialog(options = {}) {
    const { block, editor, isNew } = pisiRollupBlockState;
    if (isNew && !options.saved && block?.isConnected) {
        block.remove();
        window.ensurePisiEditorBlocks?.(editor);
    }
    if (pisiRollupBlockState.overlay) pisiRollupBlockState.overlay.hidden = true;
    pisiRollupBlockState.block = null;
    pisiRollupBlockState.context = null;
    pisiRollupBlockState.editor = null;
    pisiRollupBlockState.isNew = false;
    if (options.restoreFocus !== false) editor?.focus?.();
    return true;
}

function ensurePisiRollupBlockOverlay() {
    if (pisiRollupBlockState.overlay?.isConnected) {
        return pisiRollupBlockState.overlay;
    }
    const overlay = document.createElement('div');
    overlay.className = 'pisi-rollup-block-overlay';
    overlay.hidden = true;
    const dialog = document.createElement('section');
    dialog.className = 'pisi-rollup-block-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', pisiRollupBlockTranslate('Rollup bloğunu düzenle'));
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiRollupDialog();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !overlay.hidden) closePisiRollupDialog();
    });
    pisiRollupBlockState.overlay = overlay;
    pisiRollupBlockState.dialog = dialog;
    return overlay;
}

function renderPisiRollupDialog(context, config) {
    const dialog = pisiRollupBlockState.dialog;
    const header = document.createElement('header');
    const heading = document.createElement('div');
    const icon = document.createElement('span');
    icon.className = 'pisi-rollup-block-icon';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = pisiRollupBlockTranslate('Rollup bloğunu düzenle');
    heading.append(icon, title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pisi-rollup-block-dialog-close';
    close.textContent = '×';
    close.title = pisiRollupBlockTranslate('İptal');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => closePisiRollupDialog());
    header.append(heading, close);

    const form = document.createElement('form');
    form.className = 'pisi-rollup-block-editor-form';
    const relationSelect = document.createElement('select');
    const relationEmpty = document.createElement('option');
    relationEmpty.value = '';
    relationEmpty.textContent = pisiRollupBlockTranslate('Relation seçin');
    relationSelect.appendChild(relationEmpty);
    const relations = getPisiRollupRelationDefinitions(context);
    for (const relation of relations) {
        const option = document.createElement('option');
        option.value = relation.id;
        option.textContent = relation.name;
        option.selected = [relation.id, relation.name].includes(config.relationProperty);
        relationSelect.appendChild(option);
    }

    const targetSelect = document.createElement('select');
    const aggregateSelect = document.createElement('select');
    for (const record of PISI_ROLLUP_AGGREGATES) {
        const option = document.createElement('option');
        option.value = record.value;
        option.textContent = pisiRollupBlockTranslate(record.label);
        option.selected = record.value === config.aggregate;
        aggregateSelect.appendChild(option);
    }

    const status = document.createElement('div');
    status.className = 'pisi-rollup-block-editor-status';
    const actions = document.createElement('footer');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pisi-secondary-button';
    cancel.textContent = pisiRollupBlockTranslate('İptal');
    cancel.addEventListener('click', () => closePisiRollupDialog());
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'pisi-primary-button';
    save.textContent = pisiRollupBlockTranslate('Rollup bloğunu kaydet');
    actions.append(cancel, save);

    const syncValidity = () => {
        const needsTarget = aggregateSelect.value !== 'count';
        save.disabled = !relationSelect.value || (needsTarget && !targetSelect.value);
    };
    const populateTargets = (selectedValue = '') => {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = pisiRollupBlockTranslate(
            aggregateSelect.value === 'count'
                ? 'Kayıt sayısı için hedef gerekmez'
                : 'Hedef property seçin'
        );
        targetSelect.replaceChildren(placeholder);
        const targets = getPisiRollupTargetDefinitions(context, relationSelect.value);
        let selected = false;
        for (const target of targets) {
            const option = document.createElement('option');
            option.value = target.id;
            option.textContent = target.name;
            option.selected = [target.id, target.name].includes(selectedValue);
            selected = selected || option.selected;
            targetSelect.appendChild(option);
        }
        if (selectedValue && !selected) {
            const legacy = document.createElement('option');
            legacy.value = selectedValue;
            legacy.textContent = selectedValue;
            legacy.selected = true;
            targetSelect.appendChild(legacy);
        }
        syncValidity();
    };

    relationSelect.addEventListener('change', () => populateTargets(''));
    targetSelect.addEventListener('change', syncValidity);
    aggregateSelect.addEventListener('change', () => {
        populateTargets(targetSelect.value);
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        syncValidity();
        if (save.disabled) return;
        save.disabled = true;
        status.textContent = pisiRollupBlockTranslate('Rollup hesaplanıyor…');
        const block = pisiRollupBlockState.block;
        const editor = pisiRollupBlockState.editor;
        writePisiRollupBlockConfig(block, {
            relationProperty: relationSelect.value,
            targetProperty: targetSelect.value,
            aggregate: aggregateSelect.value
        });
        await renderPisiRollupBlock(block, context);
        editor?.dispatchEvent(new Event('input', { bubbles: true }));
        closePisiRollupDialog({ saved: true, restoreFocus: false });
        selectPisiBlock(editor, block);
        block?.focus?.();
    });

    if (!relations.length) {
        status.textContent = pisiRollupBlockTranslate(
            'Bu node’da Relation property yok. Önce property toolbarından Relation ekleyin.'
        );
    }
    populateTargets(config.targetProperty);
    form.append(
        makePisiRollupEditorField('Relation özelliği', relationSelect),
        makePisiRollupEditorField('Hedef property', targetSelect),
        makePisiRollupEditorField('Hesaplama', aggregateSelect),
        status,
        actions
    );
    dialog.replaceChildren(header, form);
    relationSelect.focus();
}

async function openPisiRollupDialog(block, options = {}) {
    if (!block?.isConnected || block.dataset.pisiBlockType !== 'rollup') return false;
    const editor = block.closest('.pisi-rich-editor');
    if (!getPisiRollupEditorNodePath(editor)) return false;
    ensurePisiRollupBlockOverlay();
    const generation = ++pisiRollupBlockState.generation;
    pisiRollupBlockState.block = block;
    pisiRollupBlockState.editor = editor;
    pisiRollupBlockState.isNew = options.isNew === true;
    pisiRollupBlockState.overlay.hidden = false;
    const loading = document.createElement('div');
    loading.className = 'pisi-rollup-block-dialog-loading';
    loading.textContent = pisiRollupBlockTranslate('Yükleniyor…');
    pisiRollupBlockState.dialog.replaceChildren(loading);
    try {
        const context = await loadPisiRollupBlockContext(block);
        if (generation !== pisiRollupBlockState.generation || pisiRollupBlockState.block !== block) {
            return false;
        }
        pisiRollupBlockState.context = context;
        renderPisiRollupDialog(context, readPisiRollupBlockConfig(block));
        return true;
    } catch (error) {
        console.error('[PISI] Rollup editor could not be opened:', error);
        if (generation !== pisiRollupBlockState.generation) return false;
        loading.className = 'pisi-rollup-block-dialog-error';
        loading.textContent = error?.message || pisiRollupBlockTranslate('Rollup hesaplanamadı.');
        return false;
    }
}

function insertPisiRollupBlock(editorTarget = null) {
    const editor = resolvePisiRollupRequestEditor(editorTarget);
    if (!editor) return false;
    const block = document.createElement('div');
    block.className = 'pisi-editor-block pisi-rollup-block';
    block.dataset.pisiBlockId = window.makePisiBlockId?.() ||
        `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    block.dataset.pisiBlockType = 'rollup';
    writePisiRollupBlockConfig(block, { aggregate: 'count' });
    block.contentEditable = 'false';
    const activeBlock = getPisiActiveBlock();
    if (activeBlock && editor.contains(activeBlock)) activeBlock.after(block);
    else editor.appendChild(block);
    hydratePisiRollupBlock(block);
    selectPisiBlock(editor, block);
    void openPisiRollupDialog(block, { isNew: true });
    return block;
}

function initializePisiRollupBlocks() {
    if (pisiRollupBlockState.initialized) return false;
    pisiRollupBlockState.initialized = true;
    document.addEventListener('pisi:rollup-block-request', (event) => {
        insertPisiRollupBlock(event.detail?.editorTarget || null);
    });
    document.addEventListener('pisi:active-node-changed', () => {
        hydratePisiRollupBlocks(getPisiActiveBlocksEditor(), { force: true });
    });
    document.addEventListener('pisi:block-selected', () => {
        hydratePisiRollupBlock(getPisiActiveBlock());
    });
    document.addEventListener('pisi:node-properties-changed', () => {
        hydratePisiRollupBlocks(getPisiActiveBlocksEditor(), { force: true });
    });
    document.addEventListener('input', (event) => {
        if (event.target?.matches?.('.pisi-rich-editor')) {
            hydratePisiRollupBlocks(event.target);
        }
    });
    hydratePisiRollupBlocks();
    return true;
}

const moduleApi = {
    pisiRollupBlockState,
    hydratePisiRollupBlocks,
    insertPisiRollupBlock,
    openPisiRollupDialog,
    renderPisiRollupBlock,
    initializePisiRollupBlocks
};

registerModule('data.rollupBlocks', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiRollupBlocks, { once: true });
} else {
    initializePisiRollupBlocks();
}

export {
    hydratePisiRollupBlocks,
    initializePisiRollupBlocks,
    insertPisiRollupBlock,
    openPisiRollupDialog,
    pisiRollupBlockState,
    renderPisiRollupBlock
};
