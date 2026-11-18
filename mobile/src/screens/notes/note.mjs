// The note screen (docs/mobile-plan.md M7): the blocks of one note, the
// editable ones as text fields, the rest as read-only cards, and the
// formatting bar. It is built once and shows one note at a time. Edits are
// saved a moment after the user stops typing and at once when the app asks
// (pause, leaving the screen, back). A save is a block patch through the note
// repo; a note nothing was changed in is never written (rule V4).
//
// The screen holds a lease on the open file (data/open-documents.mjs) that is
// dirty while an edit is not on disk, so a change from outside waits for it
// (SV4). A change from outside that did get written is taken in place, block
// by block (`handleExternal`); a note deleted on the desktop closes the screen.

import { normalizeKey } from '../../data/drivers/keys.mjs';
import { h } from '../../ui/dom.mjs';
import { renderEmptyState } from '../../ui/list.mjs';
import { renderTaskRow } from '../../ui/task-row.mjs';
import { getTaskRowMeta } from '../pisi/task-section.mjs';
import { whenVisible } from './attachment-views.mjs';
import { getBlockLabel, renderProtectedBlock } from './block-views.mjs';
import { createNoteEditor } from './note-editor.mjs';
import { createNoteToolbar } from './note-toolbar.mjs';

export const PISI_NOTE_SAVE_DELAY_MS = 600;

/**
 * `project` is the data layer; `tasks` the task controller (task blocks show
 * and change tasks through it). The app owns navigation: `onOpenTask(id)`
 * opens a task's sheet, `onOpenNote({ path, title })` another note.
 * `onSaved(key)` runs after a note was written. `attachments`
 * (sync/attachments.mjs) downloads and opens the images and files the phone
 * does not hold yet (docs/sync-plan.md S6).
 */
export function createNoteScreen({
    project = null,
    attachments = null,
    tasks,
    snackbar,
    setTimer,
    clearTimer,
    onOpenTask,
    onOpenNote,
    onSaved = () => {},
    onDeleted = () => {},
    onError = () => {}
}) {
    const element = h('section', { class: 'pisi-screen pisi-note', dataset: { screen: 'note' } });
    const document = element.ownerDocument;
    let context = null;
    let shown = null;
    // The open note: `{ key, data, content, readOnly }`; `content` is what the file holds.
    let session = null;
    let editor = null;
    let toolbar = null;
    let taskBlocks = [];
    let lease = null;
    let deferredNotice = null;
    let timer = null;
    let chain = Promise.resolve();
    let opening = Promise.resolve();
    let ticket = 0;
    let destroyed = false;
    // Image downloads that wait for the connection; they run again after the next good sync turn.
    const waiting = new Set();
    const stopReconnect = attachments?.onReconnect(() => {
        for (const retry of [...waiting]) void retry();
    });

    const say = (message) => !destroyed && snackbar.show({ message });

    /** The open note becomes `next` (or none): the lease on the file moves with it. */
    function setSession(next) {
        if (lease && lease.key !== next?.key) {
            lease.release();
            lease = null;
        }
        session = next;
        if (next && !lease && project) lease = project.documents.hold(next.key, { flush: () => save() });
    }

    /** The lease is dirty while a save waits or runs, or the editor holds something not saved yet. */
    function settle() {
        lease?.setDirty(timer !== null || Boolean(editor?.hasPending()));
    }

    function drawDeferred() {
        if (!deferredNotice) return;
        deferredNotice.hidden = !(session && project?.documents.isDeferred(session.key));
    }

    function drawState(status) {
        const { t } = context;
        editor = null;
        deferredNotice = null;
        taskBlocks = [];
        element.dataset.state = status;
        const title = { loading: t('note.loading'), missing: t('note.missing'), corrupt: t('note.unreadable') }[status];
        element.replaceChildren(
            status === 'loading' ? h('p', { class: 'pisi-note-loading', role: 'status' }, title) : renderEmptyState({ icon: 'notes', title })
        );
    }

    function drawTask({ host, segment }) {
        const { t, locale, today } = context;
        const key = session.key;
        const task =
            segment.blockType === 'diary-managed'
                ? tasks.find(segment.taskId)
                : tasks.getTasks().find((item) => item.source?.blockId === segment.blockId && normalizeKey(item.source?.nodePath ?? '') === key);
        if (!task) return false;
        host.replaceChildren(
            renderTaskRow({
                id: task.id,
                title: task.title,
                done: task.status === 'done',
                meta: getTaskRowMeta({ task, day: null }, { t, locale, today }).filter((item) => item.kind !== 'source'),
                checkLabel: task.status === 'done' ? t('task.reopen', { title: task.title }) : t('task.complete', { title: task.title }),
                onToggle: (id) => void tasks.toggle(id),
                onOpen: onOpenTask
            })
        );
        return true;
    }

    function openLink(node) {
        const id = node.attributes['data-pisi-node-id'];
        const target = id ? project.index.findNoteById(id) : null;
        if (target) onOpenNote({ path: target.key, title: target.title });
        else say(id ? context.t('note.linkMissing') : context.t('note.linkExternal'));
    }

    function runTool(id) {
        if (!editor) return;
        if (id === 'bold' || id === 'italic') editor.format(id);
        else if (id === 'heading') editor.cycleHeading();
        else editor.toggleList(id);
        toolbar.update(editor.getState());
    }

    function drawNote() {
        const { t, locale } = context;
        taskBlocks = [];
        waiting.clear();
        element.dataset.state = 'ready';
        const current = session;
        const assets = attachments
            ? {
                  keyOf: (reference) => project.notes.attachmentKey(current.key, current.data, reference),
                  status: attachments.status,
                  fetch: attachments.fetch,
                  open: attachments.open,
                  whenVisible,
                  waiting
              }
            : null;
        editor = createNoteEditor({
            document,
            content: current.content,
            readOnly: current.readOnly,
            placeholder: t('note.placeholder'),
            newBlockId: project.notes.newBlockId,
            getLabel: (type) => getBlockLabel(t, type),
            renderProtected: (segment) =>
                renderProtectedBlock(segment, {
                    t,
                    locale,
                    document,
                    assets,
                    loadAsset: (reference) => project.notes.readAsset(current.key, current.data, reference),
                    addTask(host, block) {
                        const entry = { host, segment: block };
                        if (!drawTask(entry)) return false;
                        taskBlocks.push(entry);
                        return true;
                    }
                }),
            onChange: schedule,
            onState: () => toolbar?.update(focusInside() ? editor.getState() : null),
            onLink: openLink
        });
        toolbar = createNoteToolbar({ t, onCommand: runTool });
        deferredNotice = h('p', { class: 'pisi-notice', role: 'status', dataset: { note: 'external-deferred' }, hidden: true }, t('note.externalDeferred'));
        const tail = h('button', {
            type: 'button',
            class: 'pisi-note-tail',
            'aria-label': t('note.writeAtEnd'),
            dataset: { action: 'write-at-end' },
            onClick: () => editor.focusEnd()
        });
        element.replaceChildren(
            h(
                'div',
                { class: 'pisi-note-scroll' },
                current.readOnly ? h('p', { class: 'pisi-notice', role: 'alert', dataset: { note: 'read-only' } }, t('note.readOnly')) : null,
                deferredNotice,
                editor.element,
                current.readOnly ? null : tail
            ),
            toolbar.element
        );
        drawDeferred();
    }

    const focusInside = () => Boolean(editor && (editor.element.contains(document.activeElement) || toolbar?.element.contains(document.activeElement)));

    async function load(note) {
        const mine = (ticket += 1);
        setSession(null);
        drawState('loading');
        if (!project) return drawState('missing');
        try {
            let key = note.path ? normalizeKey(note.path) : null;
            if (!key) {
                // A task may know only the title of the note it came from.
                await project.index.build();
                key = project.notes.list().find((entry) => entry.title === note.title)?.key ?? null;
            }
            const result = key ? await project.notes.read(key) : { ok: false, missing: true };
            if (mine !== ticket || destroyed) return undefined;
            if (!result.ok) return drawState(result.corrupt ? 'corrupt' : 'missing');
            setSession({ key: result.key, data: result.data, content: String(result.data.content ?? ''), readOnly: Boolean(result.readOnly) });
            return drawNote();
        } catch (error) {
            onError(error);
            if (mine === ticket && !destroyed) drawState('missing');
            return undefined;
        }
    }

    /** Writes what `ed` holds for the note of `current`. Runs inside the save chain, one write at a time. */
    async function write(ed, current) {
        if (!ed || !current || current.readOnly) return;
        const patch = ed.takePatch();
        if (!patch) return;
        try {
            const result = await project.notes.updateContent(current.key, patch.operations, { expectedContent: current.content });
            current.content = result.content;
            onSaved(current.key);
            // The blocks could not be matched to the file again: the note is read afresh.
            if (!ed.rebase(patch, result.content) && session === current) await load(shown);
        } catch (error) {
            ed.restore(patch);
            onError(error);
            if (error?.code === 'NOTE_CHANGED') {
                // The file changed under the edit: what it holds now is taken in, and the edit is kept and saved again.
                if (session === current && editor === ed) await absorb(current, ed);
            } else if (error?.name === 'PisiReadOnlyError') {
                current.readOnly = true;
                say(context.t('note.readOnly'));
                if (session === current) drawNote();
            } else say(context.t('note.saveFailed'));
        }
    }

    function save() {
        if (timer !== null) clearTimer(timer);
        timer = null;
        const ed = editor;
        const current = session;
        chain = chain.then(() => write(ed, current)).finally(settle);
        return chain;
    }

    function schedule() {
        if (timer !== null) clearTimer(timer);
        timer = setTimer(save, PISI_NOTE_SAVE_DELAY_MS);
        lease?.setDirty(true);
    }

    function closeDeleted(current) {
        if (session !== current) return;
        if (timer !== null) clearTimer(timer);
        timer = null;
        setSession(null);
        drawState('missing');
        say(context.t('note.deletedElsewhere'));
        onDeleted(current.key);
    }

    /**
     * The open note's file was changed by someone else: what it holds now is
     * shown in place. Runs in the save chain, so no save of this note is under way.
     */
    async function absorb(current, ed) {
        let result;
        try {
            result = await project.notes.read(current.key);
        } catch (error) {
            onError(error);
            return;
        }
        if (session !== current || editor !== ed) return;
        if (!result.ok) {
            if (result.missing) return closeDeleted(current);
            setSession(null);
            drawState('corrupt');
            return;
        }
        const content = String(result.data.content ?? '');
        if (content === current.content) return;
        const { conflicts } = ed.applyContent(content);
        current.content = content;
        current.data = result.data;
        taskBlocks = taskBlocks.filter((entry) => entry.host.isConnected);
        if (conflicts) say(context.t('note.changedElsewhere'));
        // An edit kept through the change (a save that failed on it, a block typed in meanwhile) is saved again.
        if (ed.hasPending()) schedule();
    }

    function handleExternal(key, info = {}) {
        const current = session;
        if (!current || current.key !== key) return chain;
        chain = chain
            .then(() => {
                if (session !== current) return undefined;
                if (info.removed) return closeDeleted(current);
                return editor ? absorb(current, editor) : undefined;
            })
            .catch(onError)
            .finally(settle);
        return chain;
    }

    const stopDeferred = project?.documents.subscribeDeferred((key) => session?.key === key && drawDeferred());
    const stopTasks = tasks.subscribe(() => {
        if (!session || !editor) return;
        for (const entry of taskBlocks) drawTask(entry);
    });
    const onSelection = () => editor && element.isConnected && toolbar?.update(focusInside() ? editor.getState() : null);
    document.addEventListener('selectionchange', onSelection);
    element.addEventListener('focusout', (event) => {
        // The bar goes away with the keyboard, when the focus leaves the note.
        if (!element.contains(event.relatedTarget)) toolbar?.update(null);
    });

    return {
        element,

        /**
         * Draws the screen for `{ t, locale, today, note }`. A note the router
         * opened anew is read from its file again, after what was being typed
         * in the previous one has been saved.
         */
        update(next) {
            const changed = !context || context.t !== next.t || shown !== next.note;
            context = next;
            if (!changed || !next.note) return;
            shown = next.note;
            const note = shown;
            const pending = save();
            setSession(null);
            drawState('loading');
            opening = pending.then(() => (shown === note && !destroyed ? load(note) : undefined));
        },

        /** Writes what is waiting now. Resolves when every save so far has finished. */
        flush: () => save(),

        /**
         * A file changed outside the app (`info.removed` when it was deleted).
         * Only the open note's file matters here. Resolves when it has been taken in.
         */
        handleExternal,

        /** Resolves when the note being opened has been read and drawn. */
        async whenReady() {
            let seen;
            do {
                seen = opening;
                await seen;
            } while (seen !== opening);
        },

        destroy() {
            destroyed = true;
            if (timer !== null) clearTimer(timer);
            timer = null;
            setSession(null);
            stopDeferred?.();
            stopReconnect?.();
            waiting.clear();
            stopTasks();
            document.removeEventListener('selectionchange', onSelection);
        }
    };
}
