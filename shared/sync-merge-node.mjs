// Three-way merge of a .node document (docs/sync-plan.md §3.4, rules SV3 and
// SV6). `content` is cut into units by block id (shared/note-blocks.mjs): a
// unit is a top-level block with its `data-pisi-block-id` (a Sheet without one
// is keyed by its database id) and every segment up to the next unit, so all
// the characters of the content belong to exactly one unit and joining the
// units gives the content back. A unit only one side changed, added or
// deleted is taken from that side; both changing it differently, or one
// changing and the other deleting it, is a conflict. `pisi` and `properties`
// merge key by key (`pisi.updatedAt` is the later time).
//
// On a conflict the result is the merge in which the remote side wins every
// conflicting part, and the caller writes the full local document as a
// conflict copy (shared/sync-conflict.mjs), so no text is lost.

import { splitNoteBlocks } from './note-blocks.mjs';
import {
    PISI_SYNC_ABSENT,
    clonePisiSyncJson,
    isPisiSyncPlainObject,
    laterPisiSyncTimestamp,
    mergePisiSyncJson,
    mergePisiSyncOrder,
    pisiSyncJsonEqual
} from './sync-merge-json.mjs';

const HEAD = '\u0000head';
const MANAGED_START = 'PISI_DIARY_MANAGED_START';

/**
 * Units of note content: `{ ok, order, html: Map(key → html) }`. `ok` is false
 * when a key repeats; the content is then one unit, so it merges as a whole.
 */
export function splitPisiSyncNoteUnits(content) {
    const text = typeof content === 'string' ? content : '';
    const units = [];
    let head = '';
    const keys = new Set();
    let ok = true;
    for (const segment of splitNoteBlocks(text)) {
        const key = segment.kind === 'element' ? segment.blockId || sheetKey(segment) : null;
        if (key && !keys.has(key)) {
            keys.add(key);
            units.push({ key, html: segment.html });
        } else {
            if (key) ok = false;
            if (units.length) units.at(-1).html += segment.html;
            else head += segment.html;
        }
    }
    if (!ok) return { ok: false, order: text ? [HEAD] : [], html: new Map(text ? [[HEAD, text]] : []) };
    const order = units.map((unit) => unit.key);
    const html = new Map(units.map((unit) => [unit.key, unit.html]));
    if (head) {
        order.unshift(HEAD);
        html.set(HEAD, head);
    }
    return { ok: true, order, html };
}

function sheetKey(segment) {
    if (segment.blockType !== 'sheet') return null;
    const id = /\sdata-pisi-database-id="([^"]+)"/.exec(segment.inner || '')?.[1];
    return id ? `sheet:${id}` : null;
}

/**
 * Whether two unit texts are the same. The whitespace after a block only
 * separates it from the next one (the last block has none), so it is not a change.
 */
function sameUnit(left, right) {
    if (left === right) return true;
    return left !== undefined && right !== undefined && left.trimEnd() === right.trimEnd();
}

/** The unit keys whose text a side added or changed against the base, with that text. */
export function getPisiSyncChangedUnits(baseContent, sideContent) {
    const base = splitPisiSyncNoteUnits(baseContent);
    const side = splitPisiSyncNoteUnits(sideContent);
    return side.order.filter((key) => !sameUnit(base.html.get(key), side.html.get(key))).map((key) => ({ key, html: side.html.get(key) }));
}

/**
 * Merges note content. Returns `{ content, conflicts }`; each conflict is
 * `{ unit, reason }` (reason: 'both-changed', 'changed-deleted', 'both-added',
 * 'unidentified') and the content takes the remote side in each of them.
 */
export function mergePisiSyncNoteContent(baseContent, localContent, remoteContent) {
    const conflicts = [];
    const local = splitPisiSyncNoteUnits(localContent);
    const remote = splitPisiSyncNoteUnits(remoteContent);
    const base = splitPisiSyncNoteUnits(baseContent ?? '');
    if (localContent === remoteContent) return { content: localContent, conflicts };
    if (localContent === (baseContent ?? '')) return { content: remoteContent, conflicts };
    if (remoteContent === (baseContent ?? '')) return { content: localContent, conflicts };
    if (!local.ok || !remote.ok || !base.ok) {
        return { content: remoteContent, conflicts: [{ unit: null, reason: 'unidentified' }] };
    }

    const merged = new Map();
    for (const key of new Set([...remote.order, ...local.order, ...base.order])) {
        const [b, l, r] = [base.html.get(key), local.html.get(key), remote.html.get(key)];
        if (sameUnit(l, r)) {
            if (r !== undefined) merged.set(key, r);
        } else if (sameUnit(l, b)) {
            if (r !== undefined) merged.set(key, r);
        } else if (sameUnit(r, b)) {
            if (l !== undefined) merged.set(key, l);
        } else {
            const reason =
                key === HEAD ? 'unidentified' : b === undefined ? 'both-added' : l === undefined || r === undefined ? 'changed-deleted' : 'both-changed';
            conflicts.push({ unit: key === HEAD ? null : key, reason });
            if (r !== undefined) merged.set(key, r);
        }
    }
    const order = mergePisiSyncOrder(local.order, remote.order, new Set(merged.keys()));
    // The head (text before the first block) stays first.
    const sorted = order.includes(HEAD) ? [HEAD, ...order.filter((key) => key !== HEAD)] : order;
    return { content: sorted.map((key) => merged.get(key)).join(''), conflicts };
}

const read = (object, key) => (isPisiSyncPlainObject(object) && Object.hasOwn(object, key) ? object[key] : PISI_SYNC_ABSENT);

/** Key-level merge of `pisi` or `properties`; conflicting keys are reported (except pisi.updatedAt). */
function mergeKeyed(name, base, local, remote, conflicts) {
    const result = mergePisiSyncJson(base, local, remote, {
        resolve: (path, values) =>
            name === 'pisi' && path === 'updatedAt' && laterPisiSyncTimestamp(values.local, values.remote) === values.local ? 'local' : 'remote'
    });
    for (const conflict of result.conflicts) {
        if (name === 'pisi' && conflict.path === 'updatedAt') continue;
        conflicts.push({ unit: null, field: `${name}.${conflict.path}`, reason: 'both-changed' });
    }
    return result.value;
}

/**
 * Merges three parsed .node documents. `base` is null when both sides created
 * the file; `diary` says the path is `diary/YYYY-MM-DD.node`. Returns
 * `{ status, value, conflicts }` with status 'unchanged' (local = remote),
 * 'remote' (take the remote file), 'local' (keep the local file), 'merged' or
 * 'conflict' (write `value`, keep the local document as a conflict copy).
 */
export function mergePisiSyncNode({ base = null, local, remote, diary = false }) {
    if (pisiSyncJsonEqual(local, remote)) return { status: 'unchanged', value: clonePisiSyncJson(local), conflicts: [] };
    if (base && pisiSyncJsonEqual(local, base)) return { status: 'remote', value: clonePisiSyncJson(remote), conflicts: [] };
    if (base && pisiSyncJsonEqual(remote, base)) return { status: 'local', value: clonePisiSyncJson(local), conflicts: [] };
    if (!base) {
        if (diary) return mergeNewDiary(local, remote);
        if (read(read(local, 'pisi'), 'id') !== read(read(remote, 'pisi'), 'id')) {
            return { status: 'conflict', value: clonePisiSyncJson(remote), conflicts: [{ unit: null, field: 'pisi.id', reason: 'different-documents' }] };
        }
    }

    const conflicts = [];
    const baseDoc = base || {};
    const out = {};
    const keys = mergePisiSyncOrder(Object.keys(local), Object.keys(remote), new Set([...Object.keys(local), ...Object.keys(remote)]));
    for (const key of keys) {
        const [b, l, r] = [base ? read(baseDoc, key) : PISI_SYNC_ABSENT, read(local, key), read(remote, key)];
        let value;
        if (key === 'content' && typeof l === 'string' && typeof r === 'string' && (b === PISI_SYNC_ABSENT || typeof b === 'string')) {
            const merged = mergePisiSyncNoteContent(b === PISI_SYNC_ABSENT ? '' : b, l, r);
            conflicts.push(...merged.conflicts);
            value = merged.content;
        } else {
            value = mergeKeyed(key, b, l, r, conflicts);
        }
        if (value !== PISI_SYNC_ABSENT) out[key] = value;
    }
    return { status: conflicts.length ? 'conflict' : 'merged', value: out, conflicts };
}

/**
 * A diary day written on both devices before either synced: the remote file
 * (and its id) is kept and the local blocks are added after the remote ones.
 * A block id on both sides with different text, or two task sections, is a conflict.
 */
function mergeNewDiary(local, remote) {
    const conflicts = [];
    const localContent = typeof local?.content === 'string' ? local.content : '';
    const remoteContent = typeof remote?.content === 'string' ? remote.content : '';
    const localUnits = splitPisiSyncNoteUnits(localContent);
    const remoteUnits = splitPisiSyncNoteUnits(remoteContent);
    let content = remoteContent;
    if (!localUnits.ok || !remoteUnits.ok || (localContent.includes(MANAGED_START) && remoteContent.includes(MANAGED_START))) {
        conflicts.push({ unit: null, reason: 'unidentified' });
    } else {
        for (const key of localUnits.order) {
            const html = localUnits.html.get(key);
            if (key === HEAD) {
                if (html.trim()) conflicts.push({ unit: null, reason: 'unidentified' });
                continue;
            }
            if (!remoteUnits.html.has(key)) content += html;
            else if (remoteUnits.html.get(key) !== html) conflicts.push({ unit: key, reason: 'both-added' });
        }
    }
    const value = clonePisiSyncJson(remote);
    if (isPisiSyncPlainObject(value.pisi) && isPisiSyncPlainObject(local?.pisi))
        value.pisi.updatedAt = laterPisiSyncTimestamp(local.pisi.updatedAt, remote.pisi.updatedAt);
    value.content = conflicts.length ? remoteContent : content;
    return { status: conflicts.length ? 'conflict' : 'merged', value, conflicts };
}
