import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommandCenterPage } from "../shell/pisi-command-center.mjs";
import { getPisiSearchCurrentNodePath, invalidatePisiSearchIndex } from "../search/pisi-search-index.mjs";

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
    return String(template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function makePisiSimpleDiff(previousText, currentText) {
    const previous = String(previousText || '').split(/\n|(?<=[.!?])\s+/).filter(Boolean);
    const current = String(currentText || '').split(/\n|(?<=[.!?])\s+/).filter(Boolean);
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
    const diff = makePisiSimpleDiff(
        version.text,
        pisiRendererPlainText(currentDocument?.data?.content || '')
    );
    const summary = document.createElement('div');
    summary.className = 'pisi-history-diff-summary';
    summary.textContent = `${pisiPortableTranslate('Eklenen')}: ${diff.added.length} · ${pisiPortableTranslate('Kaldırılan')}: ${diff.removed.length}`;
    const details = document.createElement('details');
    const detailsTitle = document.createElement('summary');
    detailsTitle.textContent = pisiPortableTranslate('Değişiklikleri göster');
    const diffList = document.createElement('pre');
    diffList.textContent = [
        ...diff.removed.map((line) => `− ${line}`),
        ...diff.added.map((line) => `+ ${line}`)
    ].join('\n') || pisiPortableTranslate('Metin farkı yok.');
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
    const [history, currentDocument] = await Promise.all([
        window.pisiProject?.listNodeHistory?.(nodePath),
        window.pisiProject?.getPisiDocument?.(nodePath)
    ]);
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
            const result = await window.pisiProject?.getNodeHistoryVersion?.(
                nodePath,
                version.historyId
            );
            if (!result?.ok) return alert(result?.error || pisiPortableTranslate('Sürüm okunamadı.'));
            const existing = row.querySelector('.pisi-history-preview');
            if (existing) existing.remove();
            else row.appendChild(showPisiHistoryPreview(result, currentDocument));
        });
        const restore = makePisiPortableButton('Bu sürümü geri yükle', 'pisi-danger-outline-button');
        restore.addEventListener('click', async () => {
            const confirmed = await window.pisiConfirm?.(
                pisiPortableTranslate('Bu sürüm geri yüklensin mi? Mevcut sürüm önce geçmişe kaydedilecek.'),
                {
                    title: pisiPortableTranslate('Sürümü geri yükle'),
                    confirmText: pisiPortableTranslate('Geri yükle'),
                    cancelText: pisiPortableTranslate('Vazgeç')
                }
            );
            if (!confirmed) return;
            const result = await window.pisiProject?.restoreNodeHistory?.(
                nodePath,
                version.historyId
            );
            if (!result?.ok) return alert(result?.error || pisiPortableTranslate('Sürüm geri yüklenemedi.'));
            invalidatePisiSearchIndex();
            await window.reloadPisiWorkspaceAfterExternalChange?.();
            await window.renderPisiCommandCenterPage?.();
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

function renderPisiExportActions(section, nodePath) {
    const projectActions = document.createElement('div');
    projectActions.className = 'pisi-portable-actions';
    const importMarkdown = makePisiPortableButton('Markdown klasörü içe aktar');
    importMarkdown.addEventListener('click', async () => {
        importMarkdown.disabled = true;
        const result = await window.pisiProject?.importMarkdownFolder?.(window.currentProjectFolder);
        importMarkdown.disabled = false;
        if (!result?.ok) return alert(result?.error || pisiPortableTranslate('İçe aktarma başarısız.'));
        if (result.canceled) return;
        invalidatePisiSearchIndex();
        await window.refreshCurrentProjectTree?.();
        alert(`${pisiPortableTranslate('İçe aktarılan node')}: ${result.imported}`);
    });
    const exportMarkdown = makePisiPortableButton('Projeyi Markdown dışa aktar');
    exportMarkdown.addEventListener('click', async () => {
        exportMarkdown.disabled = true;
        const result = await window.pisiProject?.exportProjectMarkdown?.(window.currentProjectFolder);
        exportMarkdown.disabled = false;
        if (!result?.ok) return alert(result?.error || pisiPortableTranslate('Dışa aktarma başarısız.'));
        if (!result.canceled) alert(`${pisiPortableTranslate('Dışa aktarılan belge')}: ${result.exported}`);
    });
    projectActions.append(importMarkdown, exportMarkdown);

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
            const result = await window.pisiProject?.exportNode?.(nodePath, format[1]);
            button.disabled = !nodePath;
            if (!result?.ok) alert(result?.error || pisiPortableTranslate('Dışa aktarma başarısız.'));
        });
        nodeActions.appendChild(button);
    }
    section.append(projectActions, nodeActions);
}

function renderPisiIntegrityReport(section) {
    const run = makePisiPortableButton('Proje bütünlüğünü denetle', 'pisi-primary-button');
    const report = document.createElement('div');
    report.className = 'pisi-integrity-report';
    run.addEventListener('click', async () => {
        run.disabled = true;
        report.textContent = pisiPortableTranslate('Denetleniyor…');
        const result = await window.pisiProject?.auditIntegrity?.(window.currentProjectFolder);
        run.disabled = false;
        if (!result?.ok) {
            report.textContent = result?.error || pisiPortableTranslate('Denetim başarısız.');
            return;
        }
        const summary = document.createElement('strong');
        summary.textContent = result.healthy
            ? pisiPortableTranslate('Proje bütünlüğü sağlıklı.')
            : pisiPortableTranslate('Proje bütünlüğünde hata bulundu.');
        const counts = document.createElement('span');
        counts.textContent = `${result.summary.nodes} node · ${result.summary.maps} map · ${result.summary.issues} ${pisiPortableTranslate('sorun')}`;
        const list = document.createElement('div');
        list.className = 'pisi-integrity-issues';
        for (const issue of result.issues.slice(0, 200)) {
            const row = document.createElement('div');
            row.dataset.severity = issue.severity;
            row.textContent = `${issue.path} · ${issue.message}`;
            list.appendChild(row);
        }
        report.replaceChildren(summary, counts, list);
    });
    section.append(run, report);
}

async function renderPisiBackups(section, nodePath) {
    const result = await window.pisiProject?.listBackups?.(
        window.currentProjectFolder,
        nodePath
    );
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
            const confirmed = await window.pisiConfirm?.(
                pisiPortableTranslate('Atomik yedek geri yüklensin mi?'),
                {
                    title: pisiPortableTranslate('Yedekten geri yükle'),
                    confirmText: pisiPortableTranslate('Geri yükle'),
                    cancelText: pisiPortableTranslate('Vazgeç')
                }
            );
            if (!confirmed) return;
            const restored = await window.pisiProject?.restoreBackup?.(
                window.currentProjectFolder,
                backup.backupId
            );
            if (!restored?.ok) return alert(restored?.error || pisiPortableTranslate('Yedek geri yüklenemedi.'));
            invalidatePisiSearchIndex();
            await window.reloadPisiWorkspaceAfterExternalChange?.();
        });
        row.append(info, restore);
        list.appendChild(row);
    }
    if (!result.backups?.length) list.textContent = pisiPortableTranslate('Bu belge için atomik yedek yok.');
    section.appendChild(list);
}

async function renderPisiPortabilityPage(container) {
    const nodePath = getPisiSearchCurrentNodePath();
    const transfer = makePisiPortableSection('İçe / dışa aktarma');
    renderPisiExportActions(transfer, nodePath);
    const history = makePisiPortableSection('Yerel sürüm geçmişi');
    const integrity = makePisiPortableSection('Proje bütünlüğü');
    renderPisiIntegrityReport(integrity);
    const backups = makePisiPortableSection('Yedekten geri yükleme');
    container.append(transfer, history, integrity, backups);
    await renderPisiHistory(history, nodePath);
    await renderPisiBackups(backups, nodePath);
}

function initializePisiPortabilityPanel() {
    registerPisiCommandCenterPage({
        id: 'portability',
        label: 'Taşınabilirlik',
        order: 30,
        render: renderPisiPortabilityPage
    });
}

const moduleApi = {
    makePisiSimpleDiff,
    showPisiHistoryPreview,
    renderPisiHistory,
    renderPisiPortabilityPage,
    initializePisiPortabilityPanel
};

registerModule('portability.panel', moduleApi);
initializePisiPortabilityPanel();

export {
    makePisiSimpleDiff,
    renderPisiHistory,
    renderPisiPortabilityPage,
    showPisiHistoryPreview
};
