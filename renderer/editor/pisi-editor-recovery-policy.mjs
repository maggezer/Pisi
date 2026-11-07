import { getPisiEditorAssetRecoveryWarning } from './pisi-editor-asset-recovery.mjs';

const recoveryControls = new WeakMap();
const t = (text) => window.pisiT?.(text) || text;

export function getPisiNodeRecoveryWarning(node) {
    if (node?.restoreReloadRequired) return t('Geri yüklenen not yeniden okunamadı. Notu kapatıp yeniden açın veya sürüm geçmişinden kurtarın.');
    return node?.assetRecoveryWarning || '';
}

export function applyPisiEditorRecoveryState(node, editor, title) {
    if (!editor) return;
    const warning = getPisiNodeRecoveryWarning(node);
    const previous = recoveryControls.get(editor);
    if (!warning) {
        if (!previous) return;
        editor.inert = previous.inert;
        editor.setAttribute('contenteditable', previous.contentEditable || 'true');
        editor.removeAttribute('aria-readonly');
        if (title) title.readOnly = previous.titleReadOnly;
        if (previous.toolbar) previous.toolbar.inert = previous.toolbarInert;
        previous.notice?.remove();
        recoveryControls.delete(editor);
        return;
    }
    if (previous) {
        previous.message.textContent = warning;
        editor.inert = true;
        return;
    }
    const toolbar = /** @type {HTMLElement | null} */ (document.querySelector('.pisi-editor-toolbar[data-editor-target="' + editor.id + '"]'));
    const notice = document.createElement('div');
    notice.className = 'pisi-command-center-error pisi-editor-recovery-notice';
    notice.setAttribute('role', 'status');
    const message = document.createElement('p');
    message.textContent = warning;
    const explanation = document.createElement('p');
    explanation.textContent = t('Bu not salt okunur açıldı. Kurtarmak için sürüm geçmişini kullanabilirsiniz.');
    const history = document.createElement('button');
    history.type = 'button';
    history.textContent = t('Yerel sürüm geçmişi');
    history.addEventListener('click', () => window.openPisiHistoryDialog?.(history));
    notice.append(message, explanation, history);
    recoveryControls.set(editor, {
        inert: editor.inert,
        contentEditable: editor.getAttribute('contenteditable'),
        titleReadOnly: Boolean(title?.readOnly),
        toolbar,
        toolbarInert: Boolean(toolbar?.inert),
        notice,
        message
    });
    editor.before(notice);
    editor.inert = true;
    editor.setAttribute('contenteditable', 'false');
    editor.setAttribute('aria-readonly', 'true');
    if (title) title.readOnly = true;
    if (toolbar) toolbar.inert = true;
}

export function protectPisiEditorRecovery(node, editor, title, content) {
    node.assetRecoveryWarning ||= getPisiEditorAssetRecoveryWarning(content);
    applyPisiEditorRecoveryState(node, editor, title);
    return getPisiNodeRecoveryWarning(node);
}

export async function allowPisiRecoveryDeparture(node, allowDiscard = false) {
    if (!node?.dirty) return true;
    if (!allowDiscard) return false;
    const revision = Number(node.revision || 0);
    const confirmed = await window.pisiConfirm?.(t('Bu not güvenle kaydedilemiyor. Kaydedilmemiş değişikliklerden vazgeçip devam edilsin mi?'), {
        title: t('Kaydedilmemiş değişiklikler'),
        confirmText: t('Değişikliklerden vazgeç'),
        cancelText: t('Notta kal'),
        danger: true
    });
    if (!confirmed || Number(node.revision || 0) !== revision || (window.activeCenterNode !== node && window.activeModalNode !== node)) return false;
    node.dirty = false;
    return true;
}
