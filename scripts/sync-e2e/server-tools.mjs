// What a hosting account can do to the sync server behind the clients' backs, for
// scripts/sync-e2e-matrix.mjs (docs/sync-plan.md S7 scenarios 9, 12 and 13). Every
// helper works on one test server from scripts/start-sync-test-server.mjs.

import fs from 'node:fs';
import path from 'node:path';

const SNAPSHOT_TABLES = ['heads', 'changes', 'commits', 'blobs'];

/** The space the desktop opened (the test server holds only this one). */
export function onlySpaceId(server) {
    const rows = server.sql('SELECT space_id FROM spaces').rows;
    if (rows.length !== 1) throw new Error(`Bir alan bekleniyordu: ${rows.length}`);
    return String(rows[0].space_id);
}

export const headSeq = (server, spaceId) => Number(server.sql('SELECT head FROM spaces WHERE space_id = ?', [spaceId]).rows[0].head);

/**
 * A backup of the space's log as a hosting backup would hold it: the space row, heads,
 * changes, commits and blob rows are copied to `e2e_snap_*` tables in the same database.
 * The blob files stay on disk (a database restore does not touch them).
 */
export function snapshotSpace(server, spaceId) {
    server.sql('DROP TABLE IF EXISTS e2e_snap_spaces');
    server.sql('CREATE TABLE e2e_snap_spaces AS SELECT * FROM spaces WHERE space_id = ?', [spaceId]);
    for (const table of SNAPSHOT_TABLES) {
        server.sql(`DROP TABLE IF EXISTS e2e_snap_${table}`);
        server.sql(`CREATE TABLE e2e_snap_${table} AS SELECT * FROM ${table} WHERE space_id = ?`, [spaceId]);
    }
    return headSeq(server, spaceId);
}

/** The database goes back to the backup: the log, heads and head number of the space are the old ones. */
export function restoreSpace(server, spaceId) {
    for (const table of SNAPSHOT_TABLES) {
        server.sql(`DELETE FROM ${table} WHERE space_id = ?`, [spaceId]);
        server.sql(`INSERT INTO ${table} SELECT * FROM e2e_snap_${table}`);
    }
    server.sql(
        `UPDATE spaces s JOIN e2e_snap_spaces x ON x.space_id = s.space_id
         SET s.head = x.head, s.pruned_through = x.pruned_through, s.usage_bytes = x.usage_bytes WHERE s.space_id = ?`,
        [spaceId]
    );
    return headSeq(server, spaceId);
}

/**
 * Days pass: every change of the space is made 120 days older, then the real clean-up
 * (`app/bin/gc.php`, retention 90 days) prunes the log. Heads are never pruned.
 */
export function ageAndPrune(server, spaceId) {
    server.sql('UPDATE changes SET at = at - INTERVAL 120 DAY WHERE space_id = ?', [spaceId]);
    const result = server.runBin('gc.php');
    if (result.status !== 0) throw new Error(`gc.php: ${result.stderr || result.stdout}`);
    return Number(server.sql('SELECT pruned_through FROM spaces WHERE space_id = ?', [spaceId]).rows[0].pruned_through);
}

/** The current head row of every fid changed after `afterSeq`, newest first. */
export function headsAfter(server, spaceId, afterSeq) {
    return server.sql('SELECT fid, seq, op, blob_id, size, device_id FROM heads WHERE space_id = ? AND seq > ? ORDER BY seq DESC', [spaceId, afterSeq]).rows;
}

function blobFile(server, spaceId, blobId) {
    return path.join(server.dataDir, 'blobs', spaceId, blobId.slice(2, 4), blobId.slice(4, 6), blobId);
}

/** Flips one byte in the middle of a stored blob; returns a function that puts it back. */
export function corruptBlob(server, spaceId, blobId) {
    const file = blobFile(server, spaceId, blobId);
    const original = fs.readFileSync(file);
    const broken = Buffer.from(original);
    const at = Math.floor(broken.length / 2);
    broken[at] = broken[at] ^ 0xff;
    fs.writeFileSync(file, broken);
    return () => fs.writeFileSync(file, original);
}

/**
 * The server "moves" a blob to another file: the head and the change of `seq` point at
 * `blobId` (and its size) instead of their own. The meta envelope stays the original one.
 */
export function pointChangeAtBlob(server, spaceId, seq, blobId, size) {
    server.sql('UPDATE heads SET blob_id = ?, size = ? WHERE space_id = ? AND seq = ?', [blobId, size, spaceId, seq]);
    server.sql('UPDATE changes SET blob_id = ?, size = ? WHERE space_id = ? AND seq = ?', [blobId, size, spaceId, seq]);
}

/** Changes per fid since `afterSeq`: a file committed twice for one edit shows up here. */
export function changesPerFid(server, spaceId, afterSeq) {
    return server.sql('SELECT fid, COUNT(*) AS n FROM changes WHERE space_id = ? AND seq > ? GROUP BY fid', [spaceId, afterSeq]).rows.map((row) => ({
        fid: String(row.fid),
        n: Number(row.n)
    }));
}
