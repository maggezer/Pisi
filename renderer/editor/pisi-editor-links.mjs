import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { preparePisiLinkUrl, validatePisiExternalUrl } from './pisi-external-url-policy.mjs';

// External links in notes. In an editable surface Ctrl+click (Cmd+click on
// macOS) opens the link and a plain click only places the caret; in read-only
// surfaces (history preview, diary task sections, locked editors) a plain click
// opens it. Every open goes through window.pisiShell, which main re-validates.
// The hover hint and the link editor live outside note content and are never saved.

const PISI_LINK_SELECTOR = 'a[href]';
const pisiLinkState = {
    tooltip: null,
    editor: null,
    popover: null,
    pendingRange: null,
    initialized: false
};

function pisiLinkTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function isPisiMacPlatform() {
    const platform = String(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');
    return /mac|iphone|ipad|ipod/i.test(platform);
}

function isPisiLinkOpenModifier(event) {
    return isPisiMacPlatform() ? event.metaKey : event.ctrlKey;
}

function getPisiExternalAnchor(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    const anchor = element?.closest?.(PISI_LINK_SELECTOR);
    if (!anchor || anchor.closest('.pisi-link-editor, .pisi-link-tooltip')) return null;
    return validatePisiExternalUrl(anchor.getAttribute('href') || '').ok ? anchor : null;
}

async function openPisiExternalLink(href) {
    const result = await window.pisiShell?.openExternal?.(href);
    if (!result?.ok) pisiNotifyError(pisiLinkTranslate(result?.error || 'Bağlantı açılamadı.'));
    return result;
}

function handlePisiLinkClick(event) {
    if (event.button !== 0) return;
    const element = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
    const rawAnchor = element?.closest?.(PISI_LINK_SELECTOR);
    if (!rawAnchor || rawAnchor.hasAttribute('download') || rawAnchor.closest('.pisi-link-editor')) return;
    // The application window never follows a link itself.
    event.preventDefault();
    const anchor = getPisiExternalAnchor(rawAnchor);
    if (!anchor) return;
    if (anchor.isContentEditable && !isPisiLinkOpenModifier(event)) return;
    event.stopImmediatePropagation();
    hidePisiLinkTooltip();
    void openPisiExternalLink(anchor.getAttribute('href'));
}

function ensurePisiLinkTooltip() {
    if (pisiLinkState.tooltip?.isConnected) return pisiLinkState.tooltip;
    const tooltip = document.createElement('div');
    tooltip.className = 'pisi-link-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    const url = document.createElement('div');
    url.className = 'pisi-link-tooltip-url';
    const hint = document.createElement('div');
    hint.className = 'pisi-link-tooltip-hint';
    tooltip.append(url, hint);
    document.body.appendChild(tooltip);
    pisiLinkState.tooltip = tooltip;
    return tooltip;
}

function showPisiLinkTooltip(anchor) {
    const tooltip = ensurePisiLinkTooltip();
    tooltip.querySelector('.pisi-link-tooltip-url').textContent = anchor.getAttribute('href');
    tooltip.querySelector('.pisi-link-tooltip-hint').textContent = anchor.isContentEditable
        ? pisiLinkTranslate(isPisiMacPlatform() ? '⌘+tıkla açılır' : 'Ctrl+tıkla açılır')
        : pisiLinkTranslate('Tıkla açılır');
    const rect = anchor.getBoundingClientRect();
    tooltip.hidden = false;
    const top = rect.bottom + 6 + tooltip.offsetHeight > window.innerHeight ? rect.top - tooltip.offsetHeight - 6 : rect.bottom + 6;
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
}

function hidePisiLinkTooltip() {
    if (pisiLinkState.tooltip) pisiLinkState.tooltip.hidden = true;
}

function handlePisiLinkPointerOver(event) {
    const anchor = getPisiExternalAnchor(event.target);
    if (anchor) showPisiLinkTooltip(anchor);
    else if (!event.target?.closest?.('.pisi-link-tooltip')) hidePisiLinkTooltip();
}

function getPisiLinkTargetEditor(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    return element?.closest?.('.pisi-rich-editor') || null;
}

function getPisiEditorRange(editor) {
    const selection = window.getSelection?.();
    if (!editor || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range.cloneRange() : null;
}

function getPisiRangeBlock(editor, node) {
    let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (element && element.parentElement !== editor) element = element.parentElement;
    return element && element !== editor ? element : null;
}

function getPisiAnchorAtRange(editor, range) {
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const anchor = element?.closest?.('a');
    return anchor && editor.contains(anchor) ? anchor : null;
}

function makePisiLinkField(label, type) {
    const wrapper = document.createElement('label');
    wrapper.className = 'pisi-link-editor-field';
    const text = document.createElement('span');
    text.textContent = pisiLinkTranslate(label);
    const input = document.createElement('input');
    input.type = type;
    input.spellcheck = false;
    wrapper.append(text, input);
    return { wrapper, input };
}

function makePisiLinkButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pisiLinkAction = action;
    button.textContent = pisiLinkTranslate(label);
    return button;
}

function ensurePisiLinkDialog() {
    if (pisiLinkState.popover?.isConnected) return pisiLinkState.popover;
    const popover = document.createElement('div');
    popover.className = 'pisi-link-editor';
    popover.setAttribute('role', 'dialog');
    popover.hidden = true;
    const url = makePisiLinkField('Bağlantı adresi', 'text');
    url.input.dataset.pisiLinkUrl = '';
    url.input.placeholder = 'https://';
    const text = makePisiLinkField('Metin', 'text');
    text.input.dataset.pisiLinkText = '';
    const error = document.createElement('div');
    error.className = 'pisi-link-editor-error';
    error.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'pisi-link-editor-actions';
    actions.append(makePisiLinkButton('Uygula', 'apply'), makePisiLinkButton('Kaldır', 'remove'), makePisiLinkButton('İptal', 'cancel'));
    popover.append(url.wrapper, text.wrapper, error, actions);
    document.body.appendChild(popover);
    popover.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            applyPisiLinkDialog();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePisiLinkDialog(true);
        }
    });
    actions.addEventListener('click', (event) => {
        const action = event.target.closest('[data-pisi-link-action]')?.dataset.pisiLinkAction;
        if (action === 'apply') applyPisiLinkDialog();
        else if (action === 'remove') removePisiLinkFromEditor();
        else if (action === 'cancel') closePisiLinkDialog(true);
    });
    pisiLinkState.popover = popover;
    return popover;
}

function openPisiLinkDialog(editor, range = null) {
    const targetRange = range || pisiLinkState.pendingRange || getPisiEditorRange(editor);
    pisiLinkState.pendingRange = null;
    if (!editor || editor.getAttribute('contenteditable') === 'false' || !targetRange || !editor.contains(targetRange.startContainer)) return false;
    const anchor = getPisiAnchorAtRange(editor, targetRange);
    const startBlock = getPisiRangeBlock(editor, targetRange.startContainer);
    if (!anchor && startBlock !== getPisiRangeBlock(editor, targetRange.endContainer)) {
        pisiNotifyWarning(pisiLinkTranslate('Bağlantı tek bir blok içindeki metne eklenebilir.'));
        return false;
    }
    const popover = ensurePisiLinkDialog();
    pisiLinkState.editor = { editor, range: targetRange, anchor };
    const urlInput = popover.querySelector('[data-pisi-link-url]');
    const textField = popover.querySelector('[data-pisi-link-text]').closest('label');
    urlInput.value = anchor?.getAttribute('href') || '';
    popover.querySelector('[data-pisi-link-text]').value = '';
    textField.hidden = Boolean(anchor) || !targetRange.collapsed;
    popover.querySelector('[data-pisi-link-action="remove"]').hidden = !anchor;
    popover.querySelector('.pisi-link-editor-error').textContent = '';
    const rect = (anchor || targetRange).getBoundingClientRect();
    popover.hidden = false;
    popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - popover.offsetHeight - 8))}px`;
    hidePisiLinkTooltip();
    urlInput.focus();
    urlInput.select();
    return true;
}

function closePisiLinkDialog(restoreCaret = false) {
    const state = pisiLinkState.editor;
    pisiLinkState.editor = null;
    if (pisiLinkState.popover) pisiLinkState.popover.hidden = true;
    if (restoreCaret && state?.editor?.isConnected) {
        state.editor.focus({ preventScroll: true });
        if (state.range && state.editor.contains(state.range.startContainer)) {
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(state.range);
        }
    }
}

function finishPisiLinkMutation(editor, caretNode) {
    editor.focus({ preventScroll: true });
    if (caretNode?.isConnected) {
        const caret = document.createRange();
        caret.setStartAfter(caretNode);
        caret.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(caret);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLink' }));
}

function applyPisiLinkDialog() {
    const state = pisiLinkState.editor;
    const popover = pisiLinkState.popover;
    if (!state?.editor?.isConnected || !popover) return closePisiLinkDialog();
    const prepared = preparePisiLinkUrl(popover.querySelector('[data-pisi-link-url]').value);
    if (!prepared.ok) {
        popover.querySelector('.pisi-link-editor-error').textContent = pisiLinkTranslate(prepared.error);
        popover.querySelector('[data-pisi-link-url]').focus();
        return false;
    }
    const { editor, range, anchor } = state;
    closePisiLinkDialog();
    if (anchor?.isConnected) {
        anchor.setAttribute('href', prepared.url);
        finishPisiLinkMutation(editor, anchor);
        return true;
    }
    const link = document.createElement('a');
    link.setAttribute('href', prepared.url);
    if (range.collapsed) {
        link.textContent = String(popover.querySelector('[data-pisi-link-text]').value || '').trim() || prepared.url;
        range.insertNode(link);
    } else {
        link.append(range.extractContents());
        // Nested anchors are invalid; the new link replaces any inside the selection.
        link.querySelectorAll('a').forEach((inner) => inner.replaceWith(...inner.childNodes));
        range.insertNode(link);
    }
    finishPisiLinkMutation(editor, link);
    return true;
}

function removePisiLinkFromEditor() {
    const state = pisiLinkState.editor;
    closePisiLinkDialog();
    const anchor = state?.anchor;
    if (!anchor?.isConnected) return false;
    const last = anchor.lastChild;
    anchor.replaceWith(...anchor.childNodes);
    finishPisiLinkMutation(state.editor, last);
    return true;
}

function handlePisiLinkDialogOutsidePointer(event) {
    if (!pisiLinkState.editor || event.target?.closest?.('.pisi-link-editor')) return;
    closePisiLinkDialog();
}

function rememberPisiLinkTriggerSelection(event) {
    // Toolbar buttons can take focus on click; keep the editor range from pointerdown.
    const trigger = event.target?.closest?.('[data-pisi-link-trigger]');
    if (!trigger) return;
    const editor = document.getElementById(trigger.closest('[data-editor-target]')?.dataset.editorTarget || '') || window.getPisiActiveBlocksEditor?.();
    pisiLinkState.pendingRange = getPisiEditorRange(editor);
}

function getPisiLinkRequestEditor(detail = {}) {
    if (detail.editor?.isConnected) return detail.editor;
    if (detail.editorTarget) return document.getElementById(detail.editorTarget);
    return getPisiLinkTargetEditor(window.getSelection?.()?.anchorNode) || window.getPisiActiveBlocksEditor?.() || null;
}

function initializePisiEditorLinks() {
    if (pisiLinkState.initialized) return false;
    pisiLinkState.initialized = true;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'renderer/editor/pisi-editor-links.css';
    document.head.appendChild(style);
    document.addEventListener('click', handlePisiLinkClick, true);
    document.addEventListener('auxclick', (event) => {
        if (event.target?.closest?.(PISI_LINK_SELECTOR)) event.preventDefault();
    });
    document.addEventListener('pointerover', handlePisiLinkPointerOver);
    document.addEventListener('scroll', hidePisiLinkTooltip, true);
    document.addEventListener('pointerdown', rememberPisiLinkTriggerSelection, true);
    document.addEventListener('pointerdown', handlePisiLinkDialogOutsidePointer, true);
    document.addEventListener('pisi:link-edit-request', (event) => openPisiLinkDialog(getPisiLinkRequestEditor(event.detail)));
    registerPisiCommand({
        id: 'editor.link.edit',
        label: 'Bağlantı ekle veya düzenle',
        category: 'Düzenleme',
        defaultShortcut: 'Mod+Shift+K',
        allowInInput: true,
        when: () => Boolean(getPisiLinkTargetEditor(window.getSelection?.()?.anchorNode)),
        handler: () => openPisiLinkDialog(getPisiLinkTargetEditor(window.getSelection?.()?.anchorNode))
    });
    return true;
}

const moduleApi = {
    pisiLinkState,
    openPisiExternalLink,
    openPisiLinkDialog,
    closePisiLinkDialog,
    initializePisiEditorLinks
};

registerModule('editor.links', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiEditorLinks, { once: true });
} else {
    initializePisiEditorLinks();
}

export { closePisiLinkDialog, initializePisiEditorLinks, openPisiExternalLink, openPisiLinkDialog, pisiLinkState };
