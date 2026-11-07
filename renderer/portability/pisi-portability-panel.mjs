import { restorePisiEditorDocument } from '../editor/pisi-editor-restore.mjs';
import { registerModule } from '../core/module-registry.mjs';
import { getPisiSearchCurrentNodePath, invalidatePisiSearchIndex } from '../search/pisi-search-index.mjs';

function pisiPortableTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function makePisiPortableButton(label, className = 'pisi-secondary-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiPortableTranslate(label);
    return button;
}

function makePisiPortableSection(titleText) {
    const section = document.createElement('section');
    section.className = 'pisi-portable-section';
    const title = document.createElement('h2');
    title.textContent = pisiPortableTranslate(titleText);
    section.appendChild(title);
    return section;
}

function pisiRendererPlainText(html = '') {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    template.content.querySelectorAll('script, style').forEach((element) => element.remove());
    return String(template.content.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function makePisiSimpleDiff(previousText, currentText) {
    const previous = String(previousText || '')
        .split(/\n|(?<=[.!?])\s+/)
        .filter(Boolean);
    const current = String(currentText || '')
        .split(/\n|(?<=[.!?])\s+/)
        .filter(Boolean);
    const previousSet = new Set(previous);
    const currentSet = new Set(current);
    return {
        removed: previous.filter((line) => !currentSet.has(line)).slice(0, 100),
        added: current.filter((line) => !previousSet.has(line)).slice(0, 100)
    };
}

function showPisiHistoryPreview(version, currentDocument) {
    const root = document.createElement('div');
    root.className = 'pisi-history-preview';
    const heading = document.createElement('strong');
    heading.textContent = `${new Date(version.capturedAt).toLocaleString()} · ${version.reason || 'save'}`;
    const preview = document.createElement('p');
    preview.textContent = version.text || pisiPortableTranslate('Boş sürüm');
    const diff = makePisiSimpleDiff(version.text, pisiRendererPlainText(currentDocument?.data?.content || ''));
    const summary = document.createElement('div');
    summary.className = 'pisi-history-diff-summary';
    summary.textContent = `${pisiPortableTranslate('Eklenen')}: ${diff.added.length} · ${pisiPortableTranslate('Kaldırılan')}: ${diff.removed.length}`;
    const details = document.createElement('details');
    const detailsTitle = document.createElement('summary');
    detailsTitle.textContent = pisiPortableTranslate('Değişiklikleri göster');
    const diffList = document.createElement('pre');
    diffList.textContent =
        [...diff.removed.map((line) => `− ${line}`), ...diff.added.map((line) => `+ ${line}`)].join('\n') || pisiPortableTranslate('Metin farkı yok.');
    details.append(detailsTitle, diffList);
    root.append(heading, preview, summary, details);
    return root;
}

async function renderPisiHistory(section, nodePath) {
    const list = document.createElement('div');
    list.className = 'pisi-history-list';
    if (!nodePath) {
        list.textContent = pisiPortableTranslate('Geçmiş için bir node açın.');
        section.appendChild(list);
        return;
    }
    const [history, currentDocument] = await Promise.all([window.pisiProject?.listNodeHistory?.(nodePath), window.pisiProject?.getPisiDocument?.(nodePath)]);
    if (!history?.ok) throw new Error(history?.error || 'Geçmiş okunamadı.');
    for (const version of history.versions || []) {
        const row = document.createElement('article');
        row.className = 'pisi-history-row';
        const info = document.createElement('div');
        const date = document.createElement('strong');
        date.textContent = new Date(version.capturedAt).toLocaleString();
        const reason = document.createElement('span');
        reason.textContent = `${version.reason} · ${version.preview || pisiPortableTranslate('Boş sürüm')}`;
        info.append(date, reason);
        const actions = document.createElement('div');
        const preview = makePisiPortableButton('Önizle / karşılaştır');
        preview.addEventListener('click', async () => {
            const result = await window.pisiProject?.getNodeHistoryVersion?.(nodePath, version.historyId);
            if (!result?.ok) return void pisiNotifyError(result?.error || pisiPortableTranslate('Sürüm okunamadı.'));
            const existing = row.querySelector('.pisi-history-preview');
            if (existing) existing.remove();
            else row.appendChild(showPisiHistoryPreview(result, currentDocument));
        });
        const restore = makePisiPortableButton('Bu sürümü geri yükle', 'pisi-danger-outline-button');
        restore.addEventListener('click', async () => {
            const confirmed = await window.pisiConfirm?.(pisiPortableTranslate('Bu sürüm geri yüklensin mi? Mevcut sürüm önce geçmişe kaydedilecek.'), {
                title: pisiPortableTranslate('Sürümü geri yükle'),
                confirmText: pisiPortableTranslate('Geri yükle'),
                cancelText: pisiPortableTranslate('Vazgeç')
            });
            if (!confirmed) return;
            const result = await restorePisiEditorDocument(nodePath, () => window.pisiProject?.restoreNodeHistory?.(nodePath, version.historyId));
            if (!result?.ok) return void pisiNotifyError(result?.error || pisiPortableTranslate('Sürüm geri yüklenemedi.'));
            invalidatePisiSearchIndex();
            await openPisiHistoryDialog();
        });
        actions.append(preview, restore);
        row.append(info, actions);
        list.appendChild(row);
    }
    if (!history.versions?.length) {
        list.textContent = pisiPortableTranslate('Henüz yerel sürüm yok. İlk değişiklikten sonra oluşur.');
    }
    section.appendChild(list);
}

async function runPisiImportAction(trigger = null) {
    if (!window.currentProjectFolder) {
        pisiNotifyWarning(pisiPortableTranslate('Önce bir proje açın.'));
        return false;
    }
    if (trigger) trigger.disabled = true;
    try {
        const result = await window.pisiProject?.importMarkdownFolder?.(window.currentProjectFolder);
        if (!result?.ok) {
            pisiNotifyError(result?.error || pisiPortableTranslate('İçe aktarma başarısız.'));
            return false;
        }
        if (result.canceled) return false;
        invalidatePisiSearchIndex();
        await window.refreshCurrentProjectTree?.();
        pisiNotifySuccess(`${pisiPortableTranslate('İçe aktarılan not')}: ${result.imported}`);
        return true;
    } catch (error) {
        pisiNotifyError(error?.message || pisiPortableTranslate('İçe aktarma başarısız.'));
        return false;
    } finally {
        if (trigger) trigger.disabled = false;
    }
}

async function runPisiProjectMarkdownExport(trigger = null) {
    if (!window.currentProjectFolder) {
        pisiNotifyWarning(pisiPortableTranslate('Önce bir proje açın.'));
        return false;
    }
    if (trigger) trigger.disabled = true;
    try {
        const result = await window.pisiProject?.exportProjectMarkdown?.(window.currentProjectFolder);
        if (!result?.ok) {
            pisiNotifyError(result?.error || pisiPortableTranslate('Dışa aktarma başarısız.'));
            return false;
        }
        if (!result.canceled) {
            pisiNotifySuccess(`${pisiPortableTranslate('Dışa aktarılan belge')}: ${result.exported}`);
        }
        return !result.canceled;
    } catch (error) {
        pisiNotifyError(error?.message || pisiPortableTranslate('Dışa aktarma başarısız.'));
        return false;
    } finally {
        if (trigger) trigger.disabled = false;
    }
}

function renderPisiExportActions(section, nodePath) {
    const projectActions = document.createElement('div');
    projectActions.className = 'pisi-portable-actions';
    const exportMarkdown = makePisiPortableButton('Projeyi Markdown dışa aktar');
    exportMarkdown.addEventListener('click', () => {
        void runPisiProjectMarkdownExport(exportMarkdown);
    });
    projectActions.appendChild(exportMarkdown);

    const nodeActions = document.createElement('div');
    nodeActions.className = 'pisi-portable-actions';
    for (const format of [
        ['Markdown', 'markdown'],
        ['HTML', 'html'],
        ['PDF', 'pdf'],
        ['DOCX', 'docx']
    ]) {
        const button = makePisiPortableButton(`${format[0]} dışa aktar`);
        button.disabled = !nodePath;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const result = await window.pisiProject?.exportNode?.(nodePath, format[1]);
                if (!result?.ok) {
                    pisiNotifyError(result?.error || pisiPortableTranslate('Dışa aktarma başarısız.'));
                }
            } catch (error) {
                pisiNotifyError(error?.message || pisiPortableTranslate('Dışa aktarma başarısız.'));
            } finally {
                button.disabled = !nodePath;
            }
        });
        nodeActions.appendChild(button);
    }
    const print = makePisiPortableButton('Yazdır');
    print.dataset.pisiPrintNote = '1';
    print.disabled = !nodePath;
    print.addEventListener('click', async () => {
        print.disabled = true;
        try {
            await printPisiNote(nodePath);
        } finally {
            print.disabled = !nodePath;
        }
    });
    nodeActions.appendChild(print);
    section.append(projectActions, nodeActions);
}

function renderPisiIntegrityReport(section) {
    const run = makePisiPortableButton('Proje bütünlüğünü denetle', 'pisi-primary-button');
    const report = document.createElement('div');
    report.className = 'pisi-integrity-report';

    if (!window.currentProjectFolder) {
        run.disabled = true;
        report.textContent = pisiPortableTranslate('Proje bütünlüğü için bir proje açın.');
    }

    run.addEventListener('click', async () => {
        run.disabled = true;
        report.textContent = pisiPortableTranslate('Denetleniyor…');
        try {
            const result = await window.pisiProject?.auditIntegrity?.(window.currentProjectFolder);
            if (!result?.ok) {
                report.textContent = result?.error || pisiPortableTranslate('Denetim başarısız.');
                return;
            }
            const summary = document.createElement('strong');
            summary.textContent = result.healthy
                ? pisiPortableTranslate('Proje bütünlüğü sağlıklı.')
                : pisiPortableTranslate('Proje bütünlüğünde hata bulundu.');
            const counts = document.createElement('span');
            counts.textContent = `${result.summary.nodes} node · ${result.summary.maps} map · ` + `${result.summary.issues} ${pisiPortableTranslate('sorun')}`;
            const list = document.createElement('div');
            list.className = 'pisi-integrity-issues';
            for (const issue of result.issues.slice(0, 200)) {
                const row = document.createElement('div');
                row.dataset.severity = issue.severity;
                row.textContent = `${issue.path} · ${issue.message}`;
                list.appendChild(row);
            }
            report.replaceChildren(summary, counts, list);
        } catch (error) {
            report.textContent = error?.message || pisiPortableTranslate('Denetim başarısız.');
        } finally {
            run.disabled = !window.currentProjectFolder;
        }
    });
    section.append(run, report);
}

async function renderPisiBackups(section, nodePath) {
    const result = await window.pisiProject?.listBackups?.(window.currentProjectFolder, nodePath);
    if (!result?.ok) throw new Error(result?.error || 'Yedekler okunamadı.');
    const list = document.createElement('div');
    list.className = 'pisi-backup-list';
    for (const backup of result.backups || []) {
        const row = document.createElement('div');
        row.className = 'pisi-backup-row';
        const info = document.createElement('span');
        info.textContent = `${new Date(backup.updatedAt).toLocaleString()} · ${Math.ceil(backup.size / 1024)} KB`;
        const restore = makePisiPortableButton('Yedeği geri yükle', 'pisi-danger-outline-button');
        restore.addEventListener('click', async () => {
            const confirmed = await window.pisiConfirm?.(pisiPortableTranslate('Atomik yedek geri yüklensin mi?'), {
                title: pisiPortableTranslate('Yedekten geri yükle'),
                confirmText: pisiPortableTranslate('Geri yükle'),
                cancelText: pisiPortableTranslate('Vazgeç'),
                danger: true
            });
            if (!confirmed) return;
            const projectFolder = window.currentProjectFolder;
            const restored = await restorePisiEditorDocument(backup.targetPath, () => window.pisiProject?.restoreBackup?.(projectFolder, backup.backupId));
            if (!restored?.ok) return void pisiNotifyError(restored?.error || pisiPortableTranslate('Yedek geri yüklenemedi.'));
            invalidatePisiSearchIndex();
            await openPisiHistoryDialog();
        });
        row.append(info, restore);
        list.appendChild(row);
    }
    if (!result.backups?.length) list.textContent = pisiPortableTranslate('Bu belge için atomik yedek yok.');
    section.appendChild(list);
}

const pisiPortabilityDialogState = {
    overlay: null,
    dialog: null,
    title: null,
    body: null,
    opener: null
};

function closePisiPortabilityDialog() {
    const { overlay, opener } = pisiPortabilityDialogState;
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('pisi-portability-dialog-open');
    if (opener?.isConnected) opener.focus();
    pisiPortabilityDialogState.opener = null;
}

function ensurePisiPortabilityDialog() {
    if (pisiPortabilityDialogState.overlay?.isConnected) {
        return pisiPortabilityDialogState.overlay;
    }

    const overlay = document.createElement('div');
    overlay.className = 'pisi-portability-overlay';
    overlay.hidden = true;

    const dialog = document.createElement('section');
    dialog.className = 'pisi-portability-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = document.createElement('header');
    header.className = 'pisi-portability-dialog-header';
    const title = document.createElement('strong');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pisi-portability-dialog-close';
    close.textContent = '×';
    close.title = pisiPortableTranslate('Kapat');
    close.setAttribute('aria-label', pisiPortableTranslate('Kapat'));
    close.addEventListener('click', closePisiPortabilityDialog);
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'pisi-portability-dialog-body';
    dialog.append(header, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiPortabilityDialog();
    });
    document.body.appendChild(overlay);

    Object.assign(pisiPortabilityDialogState, {
        overlay,
        dialog,
        title,
        body
    });
    return overlay;
}

async function openPisiPortabilityDialog(titleText, render, opener = null) {
    const overlay = ensurePisiPortabilityDialog();
    const state = pisiPortabilityDialogState;
    const wasHidden = overlay.hidden;
    if (opener) state.opener = opener;
    else if (wasHidden) state.opener = document.activeElement;
    state.title.textContent = pisiPortableTranslate(titleText);
    state.dialog.setAttribute('aria-label', pisiPortableTranslate(titleText));
    state.body.replaceChildren();
    state.body.setAttribute('aria-busy', 'true');
    overlay.hidden = false;
    document.body.classList.add('pisi-portability-dialog-open');

    try {
        await render(state.body);
    } catch (error) {
        const message = document.createElement('div');
        message.className = 'pisi-command-center-error';
        message.textContent = error?.message || pisiPortableTranslate('Sayfa yüklenemedi.');
        state.body.replaceChildren(message);
    } finally {
        state.body.removeAttribute('aria-busy');
    }
    state.dialog.querySelector('button:not(:disabled)')?.focus();
    return true;
}

/** Version history and backups of `nodePath` (default: the open note). */
async function openPisiHistoryDialog(opener = null, nodePath = getPisiSearchCurrentNodePath()) {
    if (!window.currentProjectFolder) {
        pisiNotifyWarning(pisiPortableTranslate('Önce bir proje açın.'));
        return false;
    }
    return openPisiPortabilityDialog(
        'Yerel sürüm geçmişi',
        async (body) => {
            const history = makePisiPortableSection('Yerel sürüm geçmişi');
            const backups = makePisiPortableSection('Yedekten geri yükleme');
            body.append(history, backups);
            await Promise.all([renderPisiHistory(history, nodePath), renderPisiBackups(backups, nodePath)]);
        },
        opener
    );
}

async function openPisiExportDialog(opener = null) {
    if (!window.currentProjectFolder) {
        pisiNotifyWarning(pisiPortableTranslate('Önce bir proje açın.'));
        return false;
    }
    const nodePath = getPisiSearchCurrentNodePath();
    return openPisiPortabilityDialog(
        'Dışa aktar',
        (body) => {
            const section = makePisiPortableSection('Dışa aktar');
            renderPisiExportActions(section, nodePath);
            body.appendChild(section);
        },
        opener
    );
}

function renderPisiIntegritySettings(container) {
    if (!container) return;
    const section = makePisiPortableSection('Proje bütünlüğü');
    section.classList.add('pisi-integrity-settings');
    const description = document.createElement('p');
    description.className = 'pisi-portable-description';
    description.textContent = pisiPortableTranslate('Geçerli proje klasöründeki node, map, bağlantı ve yan dosya tutarlılığını denetler.');
    section.appendChild(description);
    renderPisiIntegrityReport(section);
    container.appendChild(section);
}

async function handlePisiPortabilityAction(action, trigger = null) {
    if (action === 'history') return openPisiHistoryDialog(trigger);
    if (action === 'export') return openPisiExportDialog(trigger);
    if (action === 'import') return runPisiImportAction(trigger);
    return false;
}

function initializePisiPortabilityActions() {
    if (initializePisiPortabilityActions.bound) return;
    initializePisiPortabilityActions.bound = true;

    document.addEventListener('pisi:portability-action', (event) => {
        void handlePisiPortabilityAction(event.detail?.action, event.detail?.trigger || null);
    });
    document.addEventListener('pisi:render-settings-sections', (event) => {
        renderPisiIntegritySettings(event.detail?.container);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && pisiPortabilityDialogState.overlay?.hidden === false) {
            event.preventDefault();
            closePisiPortabilityDialog();
        }
    });
}

const moduleApi = {
    makePisiSimpleDiff,
    showPisiHistoryPreview,
    renderPisiHistory,
    renderPisiBackups,
    renderPisiExportActions,
    renderPisiIntegrityReport,
    renderPisiIntegritySettings,
    openPisiHistoryDialog,
    openPisiExportDialog,
    runPisiImportAction,
    handlePisiPortabilityAction,
    initializePisiPortabilityActions
};

registerModule('portability.panel', moduleApi);
initializePisiPortabilityActions();

export {
    handlePisiPortabilityAction,
    makePisiSimpleDiff,
    openPisiExportDialog,
    openPisiHistoryDialog,
    renderPisiHistory,
    renderPisiIntegritySettings,
    runPisiImportAction,
    showPisiHistoryPreview
};
