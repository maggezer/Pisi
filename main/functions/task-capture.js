'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');

function escapePisiTaskHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizePisiTaskIso(value, allowTime = true) {
    const raw = String(value || '').trim();
    const expression = allowTime
        ? /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/
        : /^(\d{4})-(\d{2})-(\d{2})$/;
    const match = raw.match(expression);
    if (!match) return '';
    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0)
    );
    if (
        date.getFullYear() !== Number(match[1]) ||
        date.getMonth() !== Number(match[2]) - 1 ||
        date.getDate() !== Number(match[3])
    ) return '';
    return raw;
}

function pisiTodoTagFromCapture(priorityValue, dateValue) {
    const priority = Math.max(1, Math.min(5, Number(priorityValue) || 3));
    const date = normalizePisiTaskIso(dateValue).slice(0, 10);
    if (!date) return `todo.${priority}.none`;
    const [year, month, day] = date.split('-');
    return `todo.${priority}.${day}-${month}-${year}`;
}

function findPisiInboxNode(projectFolder) {
    for (const entry of fs.readdirSync(projectFolder, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) continue;
        const fullPath = path.join(projectFolder, entry.name);
        const result = readJsonFileResult(fullPath);
        if (!result.ok) continue;
        if (result.data?.pisi?.systemRole === 'inbox') {
            return getPisiDocument(fullPath);
        }
    }
    return null;
}

function getOrCreatePisiInboxNode(projectFolder) {
    const existing = findPisiInboxNode(projectFolder);
    if (existing?.ok) return existing;

    const created = createUniquePisiFile(projectFolder, '.node');
    if (!created.ok) return created;
    const renamed = renamePisiFile(created.fullPath, 'Inbox');
    const inboxPath = renamed.ok ? renamed.fullPath : created.fullPath;
    const inbox = getPisiDocument(inboxPath);
    if (!inbox.ok) return inbox;
    inbox.data.pisi.systemRole = 'inbox';
    inbox.data.properties = {
        ...(inbox.data.properties || {}),
        systemRole: {
            id: 'systemRole',
            name: 'Sistem rolü',
            type: 'text',
            value: 'inbox',
            system: true
        }
    };
    inbox.data.pisi.updatedAt = new Date().toISOString();
    writePisiDocument(inboxPath, inbox.data);
    return getPisiDocument(inboxPath);
}

function normalizePisiCaptureRepeat(value) {
    const repeat = String(value || '').toLowerCase();
    return [
        'none', 'daily', 'weekdays', 'weekly', 'biweekly',
        'monthly', 'after-completion'
    ].includes(repeat) ? repeat : 'none';
}

function makePisiTaskCaptureBlock(payload = {}) {
    const text = String(payload.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Görev metni boş olamaz.');
    const scheduledAt = normalizePisiTaskIso(payload.scheduledAt);
    const deadline = normalizePisiTaskIso(payload.deadline);
    const reminderAt = normalizePisiTaskIso(payload.reminderAt);
    const repeat = normalizePisiCaptureRepeat(payload.repeat);
    const tag = pisiTodoTagFromCapture(
        payload.priority,
        scheduledAt || deadline
    );
    const duration = Math.max(0, Math.min(1440, Number(payload.durationMinutes) || 0));
    const actual = Math.max(0, Math.min(100000, Number(payload.actualMinutes) || 0));
    const completionOffset = Math.max(
        0,
        Math.min(3650, Number(payload.completionOffsetDays) || 0)
    );
    const attrs = [
        `data-pisi-tag="${tag}"`,
        'data-pisi-todo-status="todo"',
        `data-pisi-todo-repeat="${repeat}"`,
        `data-pisi-todo-order="${Date.now()}"`
    ];
    if (scheduledAt) attrs.push(`data-pisi-todo-scheduled-at="${scheduledAt}"`);
    if (deadline) attrs.push(`data-pisi-todo-deadline="${deadline}"`);
    if (reminderAt) attrs.push(`data-pisi-todo-reminder-at="${reminderAt}"`);
    if (duration) attrs.push(`data-pisi-todo-duration-minutes="${duration}"`);
    if (actual) attrs.push(`data-pisi-todo-actual-minutes="${actual}"`);
    if (completionOffset) {
        attrs.push(`data-pisi-todo-completion-offset-days="${completionOffset}"`);
    }
    const blockId = `blk_${crypto.randomUUID()}`;
    const html = [
        `<div class="pisi-editor-block" data-pisi-block-id="${blockId}">`,
        `<span class="pisi-todo-source" data-pisi-todo-for="${tag}">${escapePisiTaskHtml(text)}</span> `,
        `<span class="pisi-user-tag" ${attrs.join(' ')} contenteditable="false">${tag}</span>`,
        '</div>'
    ].join('');
    return { html, blockId, tag, scheduledAt, deadline, duration };
}

function quickAddPisiTask(projectFolder, payload = {}) {
    try {
        let nodeInfo = null;
        if (payload.nodePath) {
            const nodePath = path.resolve(String(payload.nodePath));
            if (
                path.extname(nodePath).toLowerCase() !== '.node' ||
                !fs.existsSync(nodePath)
            ) throw new Error('Seçilen hedef node bulunamadı.');
            nodeInfo = getPisiDocument(nodePath);
        } else {
            nodeInfo = getOrCreatePisiInboxNode(projectFolder);
        }
        if (!nodeInfo?.ok) return nodeInfo;

        const block = makePisiTaskCaptureBlock(payload);
        const previous = String(nodeInfo.data.content || '').trim();
        const content = previous ? `${previous}\n${block.html}` : block.html;
        const saver = globalThis.saveNodeContentWithHistory || saveNodeContent;
        const saved = saver(nodeInfo.fullPath, content, { reason: 'quick-add' });
        if (!saved?.ok) return saved;

        return {
            ...saved,
            inbox: nodeInfo.data.pisi.systemRole === 'inbox',
            task: {
                blockId: block.blockId,
                todoTag: block.tag,
                scheduledAt: block.scheduledAt,
                deadline: block.deadline,
                durationMinutes: block.duration,
                nodePath: nodeInfo.fullPath,
                nodeTitle: nodeInfo.data.pisi.title
            }
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

const moduleApi = {
    escapePisiTaskHtml,
    normalizePisiTaskIso,
    pisiTodoTagFromCapture,
    findPisiInboxNode,
    getOrCreatePisiInboxNode,
    makePisiTaskCaptureBlock,
    quickAddPisiTask
};

registerMainModule('main.taskCapture', moduleApi);
