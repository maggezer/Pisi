import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommandCenterPage } from '../shell/pisi-command-center.mjs';
import { getPisiSearchCurrentNodePath } from '../search/pisi-search-index.mjs';
import { normalizePisiPropertyCollection } from './pisi-properties-core.mjs';

function pisiPropertyTemplatesTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiPropertyTemplateNodeTitle(nodePath, documentResult) {
    return (
        documentResult?.metadata?.title ||
        documentResult?.data?.pisi?.title ||
        String(nodePath || '')
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.node$/i, '') ||
        pisiPropertyTemplatesTranslate('Node')
    );
}

function makePisiPropertyTemplateField(labelText, control) {
    const field = document.createElement('label');
    field.className = 'pisi-property-template-field';
    const label = document.createElement('span');
    label.textContent = pisiPropertyTemplatesTranslate(labelText);
    field.append(label, control);
    return field;
}

function makePisiPropertyTemplateEmpty(message) {
    const empty = document.createElement('div');
    empty.className = 'pisi-property-template-empty';
    empty.textContent = pisiPropertyTemplatesTranslate(message);
    return empty;
}

async function renderPisiPropertyTemplateList(host, status) {
    host.replaceChildren();
    host.setAttribute('aria-busy', 'true');
    const result = await window.pisiProject?.listDatabaseTemplates?.(window.currentProjectFolder);
    host.removeAttribute('aria-busy');
    if (!result?.ok) {
        host.appendChild(makePisiPropertyTemplateEmpty(result?.error || 'Şablonlar yüklenemedi.'));
        return;
    }
    const templates = Array.isArray(result.templates) ? result.templates : [];
    if (!templates.length) {
        host.appendChild(makePisiPropertyTemplateEmpty('Henüz property şablonu yok.'));
        return;
    }
    for (const template of templates) {
        const properties = normalizePisiPropertyCollection(template.properties);
        const card = document.createElement('article');
        card.className = 'pisi-property-template-card';
        const copy = document.createElement('div');
        copy.className = 'pisi-property-template-card-copy';
        const title = document.createElement('strong');
        title.textContent = template.name;
        const detail = document.createElement('span');
        detail.textContent =
            template.description ||
            properties
                .slice(0, 5)
                .map((property) => property.name)
                .join(' · ') ||
            pisiPropertyTemplatesTranslate('Boş property şablonu');
        copy.append(title, detail);
        const meta = document.createElement('div');
        meta.className = 'pisi-property-template-card-meta';
        const count = document.createElement('span');
        count.textContent = `${properties.length} ${pisiPropertyTemplatesTranslate('özellik')}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pisi-property-template-delete';
        remove.textContent = '×';
        remove.title = pisiPropertyTemplatesTranslate('Şablonu sil');
        remove.setAttribute('aria-label', `${pisiPropertyTemplatesTranslate('Şablonu sil')}: ${template.name}`);
        remove.addEventListener('click', async () => {
            if (!confirm(pisiPropertyTemplatesTranslate('Bu property şablonu silinsin mi?'))) return;
            remove.disabled = true;
            status.textContent = pisiPropertyTemplatesTranslate('Şablon siliniyor…');
            const deleteResult = await window.pisiProject?.deleteDatabaseTemplate?.(window.currentProjectFolder, template.id);
            if (!deleteResult?.ok) {
                status.textContent = deleteResult?.error || pisiPropertyTemplatesTranslate('Şablon silinemedi.');
                remove.disabled = false;
                return;
            }
            status.textContent = pisiPropertyTemplatesTranslate('Şablon silindi.');
            await renderPisiPropertyTemplateList(host, status);
        });
        meta.append(count, remove);
        card.append(copy, meta);
        host.appendChild(card);
    }
}

async function renderPisiPropertyTemplatesPage(container) {
    const page = document.createElement('section');
    page.className = 'pisi-property-templates-page';
    const heading = document.createElement('header');
    heading.className = 'pisi-property-templates-heading';
    const title = document.createElement('h2');
    title.textContent = pisiPropertyTemplatesTranslate('Templates');
    const intro = document.createElement('p');
    intro.textContent = pisiPropertyTemplatesTranslate('Tekrar kullanacağınız property yapılarını açık node üzerinden yönetin.');
    heading.append(title, intro);

    const section = document.createElement('article');
    section.className = 'pisi-property-template-section';
    const sectionHeading = document.createElement('header');
    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = pisiPropertyTemplatesTranslate('Property şablonları');
    const sectionDescription = document.createElement('p');
    sectionDescription.textContent = pisiPropertyTemplatesTranslate('Açık node’un kaydedilmiş propertylerini yeni node’larda kullanmak üzere saklayın.');
    sectionHeading.append(sectionTitle, sectionDescription);

    const workspace = document.createElement('div');
    workspace.className = 'pisi-property-template-workspace';
    const form = document.createElement('form');
    form.className = 'pisi-property-template-form';
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 120;
    name.required = true;
    name.placeholder = pisiPropertyTemplatesTranslate('Şablon adı');
    const description = document.createElement('textarea');
    description.maxLength = 500;
    description.rows = 3;
    description.placeholder = pisiPropertyTemplatesTranslate('Şablon açıklaması');

    const nodePath = getPisiSearchCurrentNodePath();
    const documentResult = nodePath ? await window.pisiProject?.getPisiDocument?.(nodePath) : null;
    const properties = documentResult?.ok ? normalizePisiPropertyCollection(documentResult.data?.properties) : [];
    const source = document.createElement('div');
    source.className = 'pisi-property-template-source';
    const sourceLabel = document.createElement('span');
    sourceLabel.textContent = pisiPropertyTemplatesTranslate('Kaynak node');
    const sourceValue = document.createElement('strong');
    sourceValue.textContent = documentResult?.ok
        ? getPisiPropertyTemplateNodeTitle(nodePath, documentResult)
        : pisiPropertyTemplatesTranslate('Node açık değil');
    const sourceCount = document.createElement('small');
    sourceCount.textContent = `${properties.length} ${pisiPropertyTemplatesTranslate('özellik')}`;
    source.append(sourceLabel, sourceValue, sourceCount);

    const create = document.createElement('button');
    create.type = 'submit';
    create.className = 'pisi-primary-button pisi-property-template-create';
    create.textContent = pisiPropertyTemplatesTranslate('Aktif node’dan şablon oluştur');
    create.disabled = !documentResult?.ok || properties.length === 0;
    const status = document.createElement('span');
    status.className = 'pisi-command-inline-status pisi-property-template-status';
    if (!nodePath) {
        status.textContent = pisiPropertyTemplatesTranslate('Property template oluşturmak için bir node açın.');
    } else if (documentResult?.ok && !properties.length) {
        status.textContent = pisiPropertyTemplatesTranslate('Açık node’da kaydedilmiş property yok.');
    } else if (!documentResult?.ok) {
        status.textContent = documentResult?.error || pisiPropertyTemplatesTranslate('Node okunamadı.');
    }

    form.append(makePisiPropertyTemplateField('Şablon adı', name), makePisiPropertyTemplateField('Şablon açıklaması', description), source, create, status);
    const list = document.createElement('div');
    list.className = 'pisi-property-template-list';
    workspace.append(form, list);
    section.append(sectionHeading, workspace);
    page.append(heading, section);
    container.appendChild(page);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const cleanName = name.value.trim();
        if (!cleanName || !documentResult?.ok || !properties.length) return;
        create.disabled = true;
        status.textContent = pisiPropertyTemplatesTranslate('Şablon kaydediliyor…');
        const result = await window.pisiProject?.saveDatabaseTemplate?.(window.currentProjectFolder, {
            name: cleanName,
            description: description.value.trim(),
            nodeType: documentResult.data?.pisi?.nodeType || 'note',
            properties
        });
        create.disabled = false;
        if (!result?.ok) {
            status.textContent = result?.error || pisiPropertyTemplatesTranslate('Şablon kaydedilemedi.');
            return;
        }
        name.value = '';
        description.value = '';
        status.textContent = pisiPropertyTemplatesTranslate('Şablon kaydedildi.');
        await renderPisiPropertyTemplateList(list, status);
    });
    await renderPisiPropertyTemplateList(list, status);
}

function initializePisiPropertyTemplates() {
    registerPisiCommandCenterPage({
        id: 'templates',
        label: 'Templates',
        order: 30,
        render: renderPisiPropertyTemplatesPage
    });
}

const moduleApi = {
    renderPisiPropertyTemplatesPage,
    initializePisiPropertyTemplates
};

registerModule('data.propertyTemplates', moduleApi);
initializePisiPropertyTemplates();

export { initializePisiPropertyTemplates, renderPisiPropertyTemplatesPage };
