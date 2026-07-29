'use strict';

let activeSuperNode = null;
let activeContent = null;
let originalContentParent = null;
let originalContentNextSibling = null;
let originalContentStyle = null;

function syncFormState(sourceRoot, cloneRoot) {
    const sourceFields = sourceRoot.querySelectorAll('textarea, input');
    const cloneFields = cloneRoot.querySelectorAll('textarea, input');
    sourceFields.forEach((source, index) => {
        const clone = cloneFields[index];
        if (!clone) return;
        if (source.tagName === 'TEXTAREA') {
            clone.textContent = source.value;
        } else if (source.type !== 'file') {
            clone.setAttribute('value', source.value);
        } else {
            clone.removeAttribute('value');
        }
    });
}

function getOpenNodeSnapshot() {
    if (!activeSuperNode || !activeContent) return null;
    const clone = activeContent.cloneNode(true);
    syncFormState(activeContent, clone);
    return {
        boxId: activeSuperNode.id,
        contentHtml: clone.outerHTML
    };
}

function openNodeEditor(boxElement) {
    if (!boxElement) return;
    if (activeSuperNode && activeSuperNode !== boxElement) closeNodeEditor();
    if (activeSuperNode === boxElement) return;

    const overlay = document.getElementById('super-node-modal-overlay');
    const modalBody = document.getElementById('super-node-modal-body');
    const titleInput = document.getElementById('super-modal-title');
    const content = boxElement.querySelector(':scope > .box-content');
    const title = boxElement.querySelector('.box-title');
    if (!overlay || !modalBody || !titleInput || !content || !title) {
        console.error('Düğüm editörü bileşenleri eksik.');
        return;
    }

    activeSuperNode = boxElement;
    activeContent = content;
    originalContentParent = content.parentNode;
    originalContentNextSibling = content.nextSibling;
    originalContentStyle = content.getAttribute('style');
    titleInput.value = title.textContent || '';

    const noteContent = content.querySelector('.text-content');
    if (noteContent && noteContent.children.length === 0 && noteContent.textContent.trim() === '') {
        noteContent.replaceChildren();
        if (window.NodeEngine) noteContent.appendChild(window.NodeEngine.createBlock('text'));
    }
    window.NodeEngine?.bindContainer?.(content);

    modalBody.replaceChildren();
    modalBody.appendChild(content);
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    window.focusedBox = boxElement;
    titleInput.focus();
    titleInput.select();
}

function closeNodeEditor(options = {}) {
    if (!activeSuperNode || !activeContent) return;
    const shouldSave = options.save !== false;
    const overlay = document.getElementById('super-node-modal-overlay');
    const titleInput = document.getElementById('super-modal-title');
    const title = activeSuperNode.querySelector('.box-title');
    if (title && titleInput) title.textContent = titleInput.value.trim() || 'İsimsiz Düğüm';

    if (originalContentParent?.isConnected) {
        if (originalContentNextSibling?.parentNode === originalContentParent) {
            originalContentParent.insertBefore(activeContent, originalContentNextSibling);
        } else {
            originalContentParent.appendChild(activeContent);
        }
    }
    if (originalContentStyle === null) activeContent.removeAttribute('style');
    else activeContent.setAttribute('style', originalContentStyle);

    if (overlay) {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    }

    activeSuperNode = null;
    activeContent = null;
    originalContentParent = null;
    originalContentNextSibling = null;
    originalContentStyle = null;
    window.focusedBox = null;
    if (shouldSave) window.triggerCanvasSave?.();
}

document.getElementById('super-modal-close')?.addEventListener('click', () => closeNodeEditor());
document.getElementById('super-node-modal-overlay')?.addEventListener('mousedown', (event) => {
    if (event.target === event.currentTarget) closeNodeEditor();
});
document.getElementById('super-modal-title')?.addEventListener('input', (event) => {
    const title = activeSuperNode?.querySelector('.box-title');
    if (title) title.textContent = event.target.value;
    window.triggerCanvasSave?.();
});
document.getElementById('super-node-modal-body')?.addEventListener('input', () => {
    window.triggerCanvasSave?.();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeSuperNode) {
        event.preventDefault();
        closeNodeEditor();
    }
});

window.openNodeEditor = openNodeEditor;
window.closeNodeEditor = closeNodeEditor;
window.getOpenNodeSnapshot = getOpenNodeSnapshot;
