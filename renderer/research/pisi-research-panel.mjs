import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommandCenterPage } from "../shell/pisi-command-center.mjs";
import {
    ensurePisiSearchIndex,
    getPisiSearchCurrentNodePath,
    invalidatePisiSearchIndex
} from "../search/pisi-search-index.mjs";
import { openPisiSearchResult } from "../search/pisi-global-search.mjs";

function pisiResearchTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function makePisiResearchInput(name, type = 'text', placeholder = '') {
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    if (placeholder) input.placeholder = pisiResearchTranslate(placeholder);
    return input;
}

function makePisiResearchField(labelText, control) {
    const label = document.createElement('label');
    label.className = 'pisi-research-field';
    const caption = document.createElement('span');
    caption.textContent = pisiResearchTranslate(labelText);
    label.append(caption, control);
    return label;
}

function getPisiResearchProperty(documentRecord, id) {
    return Object.values(documentRecord?.properties || {})
        .find((property) => property?.id === id)?.value;
}

function getPisiResearchSourceDocuments(index) {
    return Array.from(index?.documents?.values?.() || []).filter((record) => {
        return record.metadata?.systemRole === 'source' ||
            getPisiResearchProperty(record, 'systemType') === 'source';
    });
}

function readPisiScreenshotFile(file) {
    if (!file) return Promise.resolve('');
    if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
        return Promise.reject(new Error(pisiResearchTranslate('Ekran görüntüsü PNG, JPEG veya WebP ve en fazla 5 MB olmalı.')));
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result || '')));
        reader.addEventListener('error', () => reject(reader.error || new Error('Dosya okunamadı.')));
        reader.readAsDataURL(file);
    });
}

function makePisiResearchTextarea(name, placeholder = '') {
    const textarea = document.createElement('textarea');
    textarea.name = name;
    textarea.rows = 3;
    if (placeholder) textarea.placeholder = pisiResearchTranslate(placeholder);
    return textarea;
}

function buildPisiWebCaptureForm(container) {
    const section = document.createElement('section');
    section.className = 'pisi-research-section';
    const title = document.createElement('h2');
    title.textContent = pisiResearchTranslate('Web yakalama ve Kaynak node’u');
    const form = document.createElement('form');
    form.className = 'pisi-web-capture-form';
    const url = makePisiResearchInput('url', 'url', 'https://…');
    url.required = true;
    const pageTitle = makePisiResearchInput('title', 'text', 'Boşsa sayfadan alınır');
    const selectedText = makePisiResearchTextarea('selectedText', 'Tarayıcıda seçtiğiniz metin');
    const accessedAt = makePisiResearchInput('accessedAt', 'date');
    accessedAt.value = new Date().toISOString().slice(0, 10);
    const author = makePisiResearchInput('author');
    const publicationDate = makePisiResearchInput('publicationDate', 'date');
    const doi = makePisiResearchInput('doi', 'text', '10.xxxx/…');
    const bibliography = makePisiResearchTextarea('bibliography', 'Boşsa otomatik oluşturulur');
    const screenshot = makePisiResearchInput('screenshot', 'file');
    screenshot.accept = 'image/png,image/jpeg,image/webp';
    const fetchPage = makePisiResearchInput('fetchPage', 'checkbox');
    fetchPage.checked = true;
    const grid = document.createElement('div');
    grid.className = 'pisi-research-grid';
    grid.append(
        makePisiResearchField('URL', url),
        makePisiResearchField('Sayfa başlığı', pageTitle),
        makePisiResearchField('Seçili metin', selectedText),
        makePisiResearchField('Erişim tarihi', accessedAt),
        makePisiResearchField('Yazar', author),
        makePisiResearchField('Yayın tarihi', publicationDate),
        makePisiResearchField('DOI', doi),
        makePisiResearchField('Bibliyografya', bibliography),
        makePisiResearchField('Ekran görüntüsü', screenshot),
        makePisiResearchField('Sayfa metadata’sını al', fetchPage)
    );
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'pisi-primary-button';
    submit.textContent = pisiResearchTranslate('Kaynak node’u oluştur');
    const status = document.createElement('div');
    status.className = 'pisi-command-inline-status';
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = pisiResearchTranslate('Web kaynağı yakalanıyor…');
        try {
            const data = new FormData(form);
            const screenshotDataUrl = await readPisiScreenshotFile(screenshot.files?.[0]);
            const result = await window.pisiProject?.captureWebSource?.(
                window.currentProjectFolder,
                {
                    url: data.get('url'),
                    title: data.get('title'),
                    selectedText: data.get('selectedText'),
                    accessedAt: data.get('accessedAt'),
                    author: data.get('author'),
                    publicationDate: data.get('publicationDate'),
                    doi: data.get('doi'),
                    bibliography: data.get('bibliography'),
                    fetchPage: fetchPage.checked,
                    screenshotDataUrl
                }
            );
            if (!result?.ok) throw new Error(result?.error || pisiResearchTranslate('Kaynak oluşturulamadı.'));
            invalidatePisiSearchIndex();
            await window.refreshCurrentProjectTree?.();
            await ensurePisiSearchIndex({ force: true });
            status.textContent = result.fetchWarning
                ? `${pisiResearchTranslate('Kaynak oluşturuldu')}. ${result.fetchWarning}`
                : pisiResearchTranslate('Kaynak oluşturuldu.');
            form.reset();
            accessedAt.value = new Date().toISOString().slice(0, 10);
            fetchPage.checked = true;
            submit.disabled = false;
            await window.renderPisiCommandCenterPage?.();
        } catch (error) {
            status.textContent = error.message;
            submit.disabled = false;
        }
    });
    form.append(grid, submit, status);
    section.append(title, form);
    container.appendChild(section);
}

function getPisiActiveResearchEditor() {
    if (window.activeModalNode) return document.getElementById('node-modal-content');
    if (window.activeCenterNode) return document.getElementById('center-node-editor-content');
    return null;
}

function getPisiSelectedBlockReference(index) {
    const editor = getPisiActiveResearchEditor();
    const nodePath = getPisiSearchCurrentNodePath();
    if (!editor || !nodePath) return null;
    window.ensurePisiEditorBlocks?.(editor);
    const selection = window.getSelection?.();
    const anchor = selection?.anchorNode;
    let block = anchor && editor.contains(anchor)
        ? window.getPisiCurrentEditorBlock?.(editor, anchor)
        : null;
    if (!block || block === editor) block = editor.querySelector('[data-pisi-block-id]');
    if (!block?.dataset.pisiBlockId) return null;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    const documentRecord = Array.from(index?.documents?.values?.() || [])
        .find((record) => record.path === nodePath);
    const nodeTitle = documentRecord?.title ||
        String(nodePath).split(/[\\/]/).pop()?.replace(/\.node$/i, '') ||
        'Node';
    const blockText = String(block.textContent || '').replace(/\s+/g, ' ').trim();
    return {
        nodePath,
        blockId: block.dataset.pisiBlockId,
        reference: `[[${nodeTitle}#^${block.dataset.pisiBlockId}]]`,
        label: `${nodeTitle} · ${blockText || pisiResearchTranslate('(boş blok)')}`,
        text: blockText
    };
}

function insertPisiResearchHtml(html) {
    const editor = getPisiActiveResearchEditor();
    if (!editor) return false;
    window.insertHtmlIntoPisiEditor?.(editor, html);
    window.ensurePisiEditorBlocks?.(editor);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function escapePisiResearchHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildPisiReferenceAndCitationTools(container, index) {
    const section = document.createElement('section');
    section.className = 'pisi-research-section';
    const title = document.createElement('h2');
    title.textContent = pisiResearchTranslate('Blok referansları ve alıntılama');

    const current = document.createElement('div');
    current.className = 'pisi-block-reference-tool';
    const referenceOutput = document.createElement('input');
    referenceOutput.type = 'text';
    referenceOutput.readOnly = true;
    referenceOutput.placeholder = pisiResearchTranslate('Editörde bir blok seçin');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'pisi-secondary-button';
    copy.textContent = pisiResearchTranslate('Blok referansını kopyala');
    copy.addEventListener('click', () => {
        const reference = getPisiSelectedBlockReference(index);
        if (!reference) return alert(pisiResearchTranslate('Referans için açık bir node ve blok gerekli.'));
        referenceOutput.value = reference.label;
        window.pisiClipboard?.writeText?.(reference.reference);
    });
    current.append(referenceOutput, copy);

    const insertRow = document.createElement('div');
    insertRow.className = 'pisi-block-reference-tool';
    const insertReference = document.createElement('button');
    insertReference.type = 'button';
    insertReference.className = 'pisi-secondary-button pisi-block-reference-picker-trigger';
    insertReference.textContent = pisiResearchTranslate('Blok seçerek referans ekle');
    insertReference.addEventListener('click', () => {
        const block = window.getPisiActiveBlock?.();
        if (!block) {
            return alert(pisiResearchTranslate('Referans için açık bir node ve blok gerekli.'));
        }
        window.openPisiBlockReferencePicker?.(block);
    });
    insertRow.append(insertReference);

    const sources = getPisiResearchSourceDocuments(index);
    const citationForm = document.createElement('form');
    citationForm.className = 'pisi-citation-form';
    const sourceSelect = document.createElement('select');
    for (const source of sources) {
        const option = document.createElement('option');
        option.value = source.path;
        option.textContent = `${source.title} · ${getPisiResearchProperty(source, 'citationKey') || ''}`;
        sourceSelect.appendChild(option);
    }
    const quote = makePisiResearchTextarea('quote', 'Alıntılanacak içerik');
    const blockReference = document.createElement('select');
    const syncCitationBlocks = () => {
        const source = sources.find((item) => item.path === sourceSelect.value);
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = pisiResearchTranslate('Node geneli');
        const options = [blank];
        for (const block of source?.contentBlocks || []) {
            if (!block.blockId) continue;
            const option = document.createElement('option');
            option.value = `${source.path}#${block.blockId}`;
            option.textContent = String(
                block.text || pisiResearchTranslate('(boş blok)')
            ).slice(0, 90);
            options.push(option);
        }
        blockReference.replaceChildren(...options);
    };
    sourceSelect.addEventListener('change', syncCitationBlocks);
    syncCitationBlocks();
    const insertCitation = document.createElement('button');
    insertCitation.type = 'submit';
    insertCitation.className = 'pisi-primary-button';
    insertCitation.textContent = pisiResearchTranslate('İçerik alıntısı ekle');
    insertCitation.disabled = !sources.length;
    citationForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const source = sources.find((item) => item.path === sourceSelect.value);
        if (!source || !quote.value.trim()) return;
        const key = getPisiResearchProperty(source, 'citationKey') || source.title;
        const reference = blockReference.value.trim();
        const attrs = [
            `data-pisi-citation-source="${escapePisiResearchHtml(source.path)}"`,
            `data-pisi-citation-key="${escapePisiResearchHtml(key)}"`,
            ...(reference ? [`data-pisi-block-ref="${escapePisiResearchHtml(reference)}"`] : [])
        ].join(' ');
        const html = `<blockquote class="pisi-citation" ${attrs}>${escapePisiResearchHtml(quote.value.trim())}<br><strong>— ${escapePisiResearchHtml(key)}</strong></blockquote>`;
        if (!insertPisiResearchHtml(html)) return alert(pisiResearchTranslate('Alıntı eklemek için bir node açın.'));
        quote.value = '';
    });
    citationForm.append(
        makePisiResearchField('Kaynak node’u', sourceSelect),
        makePisiResearchField('Alıntı', quote),
        makePisiResearchField('Kaynak blok referansı', blockReference),
        insertCitation
    );

    section.append(title, current, insertRow, citationForm);
    container.appendChild(section);
}

function renderPisiSourceLibrary(container, index) {
    const section = document.createElement('section');
    section.className = 'pisi-research-section';
    const title = document.createElement('h2');
    title.textContent = pisiResearchTranslate('Kaynak kitaplığı');
    const list = document.createElement('div');
    list.className = 'pisi-source-library';
    for (const source of getPisiResearchSourceDocuments(index)) {
        const button = document.createElement('button');
        button.type = 'button';
        const heading = document.createElement('strong');
        heading.textContent = source.title;
        const meta = document.createElement('span');
        meta.textContent = [
            getPisiResearchProperty(source, 'author'),
            getPisiResearchProperty(source, 'doi'),
            getPisiResearchProperty(source, 'citationKey')
        ].filter(Boolean).join(' · ');
        button.append(heading, meta);
        button.addEventListener('click', () => openPisiSearchResult({
            kind: 'node',
            nodePath: source.path,
            nodeTitle: source.title,
            nodeItem: source.nodeItem,
            mapPath: source.memberships?.[0]?.mapPath || null
        }));
        list.appendChild(button);
    }
    if (!list.childElementCount) list.textContent = pisiResearchTranslate('Henüz Kaynak node’u yok.');
    section.append(title, list);
    container.appendChild(section);
}

async function renderPisiResearchPage(container) {
    const index = await ensurePisiSearchIndex();
    buildPisiWebCaptureForm(container);
    buildPisiReferenceAndCitationTools(container, index);
    renderPisiSourceLibrary(container, index);
}

function initializePisiResearchPanel() {
    registerPisiCommandCenterPage({
        id: 'research',
        label: 'Araştırma',
        order: 40,
        render: renderPisiResearchPage
    });
}

const moduleApi = {
    getPisiResearchSourceDocuments,
    getPisiSelectedBlockReference,
    insertPisiResearchHtml,
    renderPisiResearchPage,
    initializePisiResearchPanel
};

registerModule('research.panel', moduleApi);
initializePisiResearchPanel();

export {
    getPisiResearchSourceDocuments,
    getPisiSelectedBlockReference,
    insertPisiResearchHtml,
    renderPisiResearchPage
};
