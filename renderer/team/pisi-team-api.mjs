import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommandCenterPage } from "../shell/pisi-command-center.mjs";

const PISI_TEAM_API_VERSION = '1.0.0';
const pisiTeamProviders = new Map();
const pisiTeamSubscribers = new Set();
let pisiActiveTeamProviderId = 'local';

function pisiTeamTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function normalizePisiTeamProviderId(value = '') {
    const id = String(value || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id)) {
        throw new TypeError('Team provider kimliği geçersiz.');
    }
    return id;
}

function registerPisiTeamProvider(provider = {}) {
    const id = normalizePisiTeamProviderId(provider.id);
    if (pisiTeamProviders.has(id)) throw new Error(`Team provider zaten kayıtlı: ${id}`);
    for (const method of ['getConfig', 'saveConfig', 'listEvents', 'appendEvent']) {
        if (typeof provider[method] !== 'function') {
            throw new TypeError(`Team provider ${method} fonksiyonunu sağlamalı.`);
        }
    }
    const record = Object.freeze({
        ...provider,
        id,
        label: String(provider.label || id).slice(0, 120),
        apiVersion: PISI_TEAM_API_VERSION,
        capabilities: Object.freeze({ ...(provider.capabilities || {}) })
    });
    pisiTeamProviders.set(id, record);
    document.dispatchEvent(new CustomEvent('pisi:team-provider-changed', {
        detail: { action: 'registered', provider: record }
    }));
    return () => {
        if (id === 'local' || pisiTeamProviders.get(id) !== record) return false;
        pisiTeamProviders.delete(id);
        if (pisiActiveTeamProviderId === id) pisiActiveTeamProviderId = 'local';
        return true;
    };
}

function listPisiTeamProviders() {
    return Array.from(pisiTeamProviders.values()).map((provider) => ({
        id: provider.id,
        label: provider.label,
        apiVersion: provider.apiVersion,
        capabilities: provider.capabilities
    }));
}

function setPisiTeamProvider(id) {
    const providerId = normalizePisiTeamProviderId(id);
    if (!pisiTeamProviders.has(providerId)) throw new Error('Team provider bulunamadı.');
    pisiActiveTeamProviderId = providerId;
    document.dispatchEvent(new CustomEvent('pisi:team-provider-changed', {
        detail: { action: 'selected', provider: pisiTeamProviders.get(providerId) }
    }));
    return providerId;
}

function getPisiTeamProvider() {
    return pisiTeamProviders.get(pisiActiveTeamProviderId) || pisiTeamProviders.get('local');
}

function getPisiTeamProjectFolder(projectFolder = window.currentProjectFolder) {
    if (!projectFolder) throw new Error('Önce bir proje açın.');
    return projectFolder;
}

async function getPisiTeamConfig(projectFolder) {
    return getPisiTeamProvider().getConfig(getPisiTeamProjectFolder(projectFolder));
}

async function savePisiTeamConfig(config, options = {}, projectFolder) {
    const result = await getPisiTeamProvider().saveConfig(
        getPisiTeamProjectFolder(projectFolder),
        config,
        options
    );
    if (result?.ok) notifyPisiTeamSubscribers({ type: 'config', config: result.config });
    return result;
}

async function listPisiTeamEvents(options = {}, projectFolder) {
    return getPisiTeamProvider().listEvents(
        getPisiTeamProjectFolder(projectFolder),
        options
    );
}

async function appendPisiTeamEvent(event, projectFolder) {
    const result = await getPisiTeamProvider().appendEvent(
        getPisiTeamProjectFolder(projectFolder),
        event
    );
    if (result?.ok) notifyPisiTeamSubscribers({ type: 'event', event: result.event });
    return result;
}

function subscribePisiTeam(listener) {
    if (typeof listener !== 'function') throw new TypeError('Team listener fonksiyon olmalı.');
    pisiTeamSubscribers.add(listener);
    return () => pisiTeamSubscribers.delete(listener);
}

function notifyPisiTeamSubscribers(message) {
    for (const listener of pisiTeamSubscribers) {
        try {
            listener(message);
        } catch (error) {
            console.error('[PISI] Team listener hatası:', error);
        }
    }
    document.dispatchEvent(new CustomEvent('pisi:team-changed', { detail: message }));
}

function makePisiTeamButton(label, className = 'pisi-secondary-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiTeamTranslate(label);
    return button;
}

function makePisiTeamMemberRow(member = {}) {
    const row = document.createElement('div');
    row.className = 'pisi-team-member-row';
    row.dataset.memberId = member.id || '';
    const name = document.createElement('input');
    name.type = 'text';
    name.dataset.teamMemberName = 'true';
    name.placeholder = pisiTeamTranslate('Üye adı');
    name.value = member.name || '';
    const role = document.createElement('input');
    role.type = 'text';
    role.dataset.teamMemberRole = 'true';
    role.placeholder = pisiTeamTranslate('Rol');
    role.value = member.role || 'member';
    const remove = makePisiTeamButton('×');
    remove.title = pisiTeamTranslate('Üyeyi kaldır');
    remove.addEventListener('click', () => row.remove());
    row.append(name, role, remove);
    return row;
}

function collectPisiTeamMembers(host) {
    return Array.from(host.querySelectorAll('.pisi-team-member-row')).map((row) => ({
        id: row.dataset.memberId || undefined,
        name: row.querySelector('[data-team-member-name]')?.value.trim() || '',
        role: row.querySelector('[data-team-member-role]')?.value.trim() || 'member'
    })).filter((member) => member.name);
}

function renderPisiTeamEvent(event) {
    const row = document.createElement('article');
    row.className = 'pisi-team-event';
    const heading = document.createElement('strong');
    heading.textContent = `${event.type} · ${event.actorId || pisiTeamTranslate('yerel')}`;
    const body = document.createElement('span');
    body.textContent = String(
        event.payload?.text || event.payload?.summary || event.target || ''
    ).slice(0, 500);
    const time = document.createElement('time');
    time.dateTime = event.createdAt;
    time.textContent = new Date(event.createdAt).toLocaleString();
    row.append(heading, body, time);
    return row;
}

async function renderPisiTeamPage(container) {
    const [configResult, eventsResult] = await Promise.all([
        getPisiTeamConfig(),
        listPisiTeamEvents({ limit: 100 })
    ]);
    if (!configResult?.ok) throw new Error(configResult?.error || 'Team ayarları okunamadı.');
    const config = configResult.config;
    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = pisiTeamTranslate('Team API');
    const badge = document.createElement('span');
    badge.className = 'pisi-api-version-badge';
    badge.textContent = `API ${PISI_TEAM_API_VERSION}`;
    heading.append(title, badge);

    const capability = document.createElement('div');
    capability.className = 'pisi-team-capability-note';
    capability.textContent = pisiTeamTranslate(
        'Yerel üye ayarları, iyimser revision kontrolü ve değişiklik günlüğü hazırdır; gerçek zamanlı taşıma bir provider eklentisi gerektirir.'
    );

    const form = document.createElement('section');
    form.className = 'pisi-team-form';
    const teamName = document.createElement('input');
    teamName.type = 'text';
    teamName.value = config.name || '';
    teamName.placeholder = pisiTeamTranslate('Team adı');
    const provider = document.createElement('select');
    for (const item of listPisiTeamProviders()) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === pisiActiveTeamProviderId;
        provider.appendChild(option);
    }
    provider.addEventListener('change', () => setPisiTeamProvider(provider.value));
    const members = document.createElement('div');
    members.className = 'pisi-team-members';
    config.members.forEach((member) => members.appendChild(makePisiTeamMemberRow(member)));
    const actions = document.createElement('div');
    actions.className = 'pisi-team-actions';
    const addMember = makePisiTeamButton('Üye ekle');
    addMember.addEventListener('click', () => {
        const row = makePisiTeamMemberRow();
        members.appendChild(row);
        row.querySelector('input')?.focus();
    });
    const save = makePisiTeamButton('Team ayarlarını kaydet', 'pisi-primary-button');
    const status = document.createElement('span');
    status.className = 'pisi-command-inline-status';
    save.addEventListener('click', async () => {
        save.disabled = true;
        const result = await savePisiTeamConfig({
            ...config,
            name: teamName.value,
            provider: provider.value,
            members: collectPisiTeamMembers(members)
        }, { expectedRevision: config.revision });
        status.textContent = result?.ok
            ? pisiTeamTranslate('Team ayarları kaydedildi.')
            : (result?.error || pisiTeamTranslate('Team ayarları kaydedilemedi.'));
        save.disabled = false;
        if (result?.ok) await window.renderPisiCommandCenterPage?.();
    });
    actions.append(addMember, save, status);
    form.append(teamName, provider, members, actions);

    const journal = document.createElement('section');
    journal.className = 'pisi-team-journal';
    const journalTitle = document.createElement('h3');
    journalTitle.textContent = pisiTeamTranslate('Team değişiklik günlüğü');
    const commentForm = document.createElement('form');
    commentForm.className = 'pisi-team-comment-form';
    const comment = document.createElement('input');
    comment.type = 'text';
    comment.placeholder = pisiTeamTranslate('Yerel team notu ekle');
    const submit = makePisiTeamButton('Ekle', 'pisi-primary-button');
    commentForm.append(comment, submit);
    commentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!comment.value.trim()) return;
        const result = await appendPisiTeamEvent({
            type: 'comment',
            target: getPisiTeamProjectFolder(),
            payload: { text: comment.value.trim() }
        });
        if (!result?.ok) return alert(result?.error || pisiTeamTranslate('Team olayı kaydedilemedi.'));
        await window.renderPisiCommandCenterPage?.();
    });
    const events = document.createElement('div');
    events.className = 'pisi-team-events';
    (eventsResult?.events || []).forEach((event) => events.appendChild(renderPisiTeamEvent(event)));
    if (!events.childElementCount) {
        const empty = document.createElement('div');
        empty.className = 'pisi-command-empty';
        empty.textContent = pisiTeamTranslate('Henüz team olayı yok.');
        events.appendChild(empty);
    }
    journal.append(journalTitle, commentForm, events);
    container.append(heading, capability, form, journal);
}

function initializePisiTeamApi() {
    registerPisiTeamProvider({
        id: 'local',
        label: 'Yerel provider',
        capabilities: {
            localJournal: true,
            optimisticRevision: true,
            realtimeSync: false,
            presenceTransport: false
        },
        getConfig: (projectFolder) => window.pisiTeamTransport?.getConfig?.(projectFolder),
        saveConfig: (projectFolder, config, options) => window.pisiTeamTransport?.saveConfig?.(
            projectFolder,
            config,
            options
        ),
        listEvents: (projectFolder, options) => window.pisiTeamTransport?.listEvents?.(
            projectFolder,
            options
        ),
        appendEvent: (projectFolder, event) => window.pisiTeamTransport?.appendEvent?.(
            projectFolder,
            event
        )
    });
    const root = window.Pisi || (window.Pisi = {});
    if (!Object.prototype.hasOwnProperty.call(root, 'team')) {
        Object.defineProperty(root, 'team', {
            configurable: false,
            enumerable: true,
            writable: false,
            value: Object.freeze({
                apiVersion: PISI_TEAM_API_VERSION,
                registerProvider: registerPisiTeamProvider,
                listProviders: listPisiTeamProviders,
                setProvider: setPisiTeamProvider,
                getConfig: getPisiTeamConfig,
                saveConfig: savePisiTeamConfig,
                listEvents: listPisiTeamEvents,
                appendEvent: appendPisiTeamEvent,
                subscribe: subscribePisiTeam
            })
        });
    }
    registerPisiCommandCenterPage({
        id: 'team',
        label: 'Team',
        order: 75,
        render: renderPisiTeamPage
    });
}

const moduleApi = {
    PISI_TEAM_API_VERSION,
    registerPisiTeamProvider,
    listPisiTeamProviders,
    setPisiTeamProvider,
    getPisiTeamProvider,
    getPisiTeamConfig,
    savePisiTeamConfig,
    listPisiTeamEvents,
    appendPisiTeamEvent,
    subscribePisiTeam,
    renderPisiTeamPage,
    initializePisiTeamApi
};

registerModule('team.api', moduleApi);
initializePisiTeamApi();

export {
    PISI_TEAM_API_VERSION,
    appendPisiTeamEvent,
    getPisiTeamConfig,
    getPisiTeamProvider,
    listPisiTeamEvents,
    listPisiTeamProviders,
    registerPisiTeamProvider,
    renderPisiTeamPage,
    savePisiTeamConfig,
    setPisiTeamProvider,
    subscribePisiTeam
};
