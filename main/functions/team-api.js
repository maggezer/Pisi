'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');

const PISI_TEAM_EVENT_TYPES = new Set([
    'change', 'comment', 'presence', 'review', 'sync', 'system'
]);

function normalizePisiTeamMember(member = {}) {
    const name = String(member.name || '').trim().slice(0, 120);
    if (!name) return null;
    return {
        id: /^[A-Za-z0-9_-]{3,120}$/.test(String(member.id || ''))
            ? String(member.id)
            : `member_${crypto.randomUUID()}`,
        name,
        role: String(member.role || 'member').trim().slice(0, 80),
        ...(String(member.email || '').trim()
            ? { email: String(member.email).trim().slice(0, 240) }
            : {})
    };
}

function normalizePisiTeamConfig(config = {}, previous = {}) {
    const members = (Array.isArray(config.members) ? config.members : [])
        .map(normalizePisiTeamMember)
        .filter(Boolean)
        .slice(0, 200);
    return {
        version: 1,
        id: /^[A-Za-z0-9_-]{3,120}$/.test(String(config.id || ''))
            ? String(config.id)
            : (previous.id || `team_${crypto.randomUUID()}`),
        name: String(config.name || previous.name || 'Pisi Team').trim().slice(0, 120),
        members,
        provider: String(config.provider || previous.provider || 'local').trim().slice(0, 80),
        revision: Math.max(0, Number(previous.revision) || 0) + 1,
        updatedAt: new Date().toISOString()
    };
}

function getPisiTeamConfigPath(projectFolder) {
    return path.join(projectFolder, '.pisi-team.json');
}

function getPisiTeamEventsPath(projectFolder) {
    return path.join(projectFolder, '.pisi-team-events.json');
}

function readPisiTeamConfig(projectFolder) {
    try {
        const filePath = getPisiTeamConfigPath(projectFolder);
        if (!fs.existsSync(filePath)) {
            return {
                ok: true,
                config: {
                    version: 1,
                    id: null,
                    name: 'Pisi Team',
                    members: [],
                    provider: 'local',
                    revision: 0,
                    updatedAt: null
                },
                capabilities: getPisiTeamCapabilities()
            };
        }
        const result = readJsonFileResult(filePath);
        if (!result.ok) return { ok: false, error: result.error };
        const raw = result.data || {};
        return {
            ok: true,
            config: {
                version: 1,
                id: String(raw.id || ''),
                name: String(raw.name || 'Pisi Team'),
                members: (Array.isArray(raw.members) ? raw.members : [])
                    .map(normalizePisiTeamMember).filter(Boolean),
                provider: String(raw.provider || 'local'),
                revision: Math.max(0, Number(raw.revision) || 0),
                updatedAt: raw.updatedAt || null
            },
            capabilities: getPisiTeamCapabilities()
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function savePisiTeamConfig(projectFolder, config = {}, options = {}) {
    try {
        const current = readPisiTeamConfig(projectFolder);
        if (!current.ok) return current;
        if (
            Number.isFinite(Number(options.expectedRevision)) &&
            Number(options.expectedRevision) !== Number(current.config.revision)
        ) {
            return {
                ok: false,
                conflict: true,
                error: 'Team ayarları başka bir işlem tarafından değiştirildi.',
                config: current.config
            };
        }
        const next = normalizePisiTeamConfig(config, current.config);
        writeFileAtomic(
            getPisiTeamConfigPath(projectFolder),
            JSON.stringify(next, null, 2)
        );
        return { ok: true, config: next, capabilities: getPisiTeamCapabilities() };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function readPisiTeamEvents(projectFolder, options = {}) {
    try {
        const filePath = getPisiTeamEventsPath(projectFolder);
        if (!fs.existsSync(filePath)) return { ok: true, events: [] };
        const result = readJsonFileResult(filePath);
        if (!result.ok) return { ok: false, error: result.error, events: [] };
        const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
        const events = (Array.isArray(result.data?.events) ? result.data.events : [])
            .filter((event) => event?.id && event?.type && event?.createdAt)
            .slice(-limit)
            .reverse();
        return { ok: true, events };
    } catch (error) {
        return { ok: false, error: error.message, events: [] };
    }
}

function appendPisiTeamEvent(projectFolder, event = {}) {
    try {
        const type = PISI_TEAM_EVENT_TYPES.has(String(event.type || ''))
            ? String(event.type)
            : 'change';
        const payloadText = JSON.stringify(event.payload ?? {});
        if (Buffer.byteLength(payloadText, 'utf8') > 32768) {
            return { ok: false, error: 'Team olayı 32 KB sınırını aşıyor.' };
        }
        const current = readPisiTeamEvents(projectFolder, { limit: 1000 });
        if (!current.ok) return current;
        const clean = {
            id: `event_${crypto.randomUUID()}`,
            type,
            actorId: String(event.actorId || '').slice(0, 120),
            target: String(event.target || '').slice(0, 2048),
            payload: JSON.parse(payloadText),
            createdAt: new Date().toISOString()
        };
        const events = [...current.events.slice().reverse(), clean].slice(-1000);
        writeFileAtomic(
            getPisiTeamEventsPath(projectFolder),
            JSON.stringify({ version: 1, events }, null, 2)
        );
        return { ok: true, event: clean };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function getPisiTeamCapabilities() {
    return {
        apiVersion: '1.0.0',
        localJournal: true,
        optimisticRevision: true,
        providerRegistration: true,
        realtimeSync: false,
        presenceTransport: false
    };
}

const moduleApi = {
    normalizePisiTeamMember,
    normalizePisiTeamConfig,
    readPisiTeamConfig,
    savePisiTeamConfig,
    readPisiTeamEvents,
    appendPisiTeamEvent,
    getPisiTeamCapabilities
};

registerMainModule('main.teamApi', moduleApi);
