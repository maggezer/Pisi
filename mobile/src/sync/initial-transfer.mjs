// The first pairing of a phone that already holds a project (docs/sync-plan.md
// §1.3, S6 step 3). A project that is only its skeleton (empty `.pisi/` files,
// `diary/.pisi-diary`) takes the server's project without a question. Any
// other project is either added to the server's (`merge`: a merge with an
// empty base, §3.4) or set aside (`aside`): its files are copied to
// `projects/default-oncesi-<date>/`, checked, and only then removed from the
// project through the writer (`removeExternal`), so the screens and the index
// follow as for any remote delete and nothing is reopened (SV5). The folder
// set aside is never written again; undoing this is out of scope.

import { getPisiSyncFileClass } from '../../../shared/sync-paths.mjs';
import { isPisiSyncSkeletonFile, isPisiSyncSkeletonProject } from '../../../shared/sync-initial.mjs';
import { joinKey } from '../data/drivers/keys.mjs';
import { readTextOrNull } from '../data/json-file.mjs';

export const PISI_ASIDE_PREFIX = 'default-oncesi-';
const ASIDE_NAME = /^default-oncesi-\d{4}-\d{2}-\d{2}(?:-\d+)?$/;
const TEXT_CLASSES = new Set(['node', 'map', 'authority', 'json', 'marker']);

export class PisiSetAsideError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PisiSetAsideError';
        this.code = code;
    }
}

/** True when the phone's project holds nothing of the user: pairing needs no question (S6 step 3). */
export async function isSkeletonProject(files) {
    const listed = await files.list();
    return isPisiSyncSkeletonProject(listed, (path) => files.read(path));
}

/**
 * Removes the skeleton files of a project that is only its skeleton, so the
 * first download writes the server's own files instead of merging an empty
 * property schema into them. A file that holds anything stays.
 */
export async function clearSkeleton(project, files) {
    const listed = await files.list();
    files.reset();
    for (const file of listed) {
        const bytes = await files.read(file.path);
        if (isPisiSyncSkeletonFile(file.path, bytes)) await project.writer.removeExternal(file.path);
    }
}

/** Every file of a tree as keys, the project's own temporary files left out. */
async function listTree(driver, folder = '', out = []) {
    const entries = await driver.list(folder).catch(() => []);
    for (const entry of entries) {
        const key = joinKey(folder, entry.name);
        if (entry.type === 'directory') await listTree(driver, key, out);
        else if (!/\.mobile-[A-Za-z0-9-]+\.tmp$/.test(entry.name)) out.push(key);
    }
    return out;
}

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** `default-oncesi-YYYY-MM-DD`, with `-2`, `-3` … when that folder is taken. */
async function freeAsideName(projectsDriver, now) {
    const base = `${PISI_ASIDE_PREFIX}${localDate(now)}`;
    for (let number = 1; ; number += 1) {
        const name = number === 1 ? base : `${base}-${number}`;
        if (!(await projectsDriver.exists(name))) return name;
    }
}

/** The project folders set aside so far, newest name last. */
export async function listAsideProjects(projectsDriver) {
    if (!projectsDriver) return [];
    const entries = await projectsDriver.list('').catch(() => []);
    return entries
        .filter((entry) => entry.type === 'directory' && ASIDE_NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}

/**
 * Copies every file of the project to a new folder next to it and checks the
 * copy, then removes the files from the project. Resolves `{ name, copied, left }`;
 * `left` lists the files the writer would not remove (read-only, held dirty):
 * they stay and are merged like files added to the project. Rejects with
 * SET_ASIDE_FAILED before anything was removed when the copy fails.
 */
export async function setProjectAside({ project, projectsDriver, now = new Date() }) {
    const { driver, writer } = project;
    await writer.flush();
    const keys = await listTree(driver);
    const name = await freeAsideName(projectsDriver, now);
    try {
        await projectsDriver.mkdir(name);
        for (const key of keys) {
            const target = joinKey(name, key);
            const parent = target.slice(0, target.lastIndexOf('/'));
            await projectsDriver.mkdir(parent);
            if (TEXT_CLASSES.has(getPisiSyncFileClass(key))) {
                const text = await driver.readText(key);
                await projectsDriver.writeText(target, text);
                if ((await readTextOrNull(projectsDriver, target)) !== text) throw new Error(`copy differs: ${key}`);
            } else {
                await projectsDriver.writeBase64(target, await driver.readBase64(key));
                const [source, copy] = await Promise.all([driver.stat(key), projectsDriver.stat(target)]);
                if (copy?.type !== 'file' || copy.size !== source?.size) throw new Error(`copy differs: ${key}`);
            }
        }
    } catch (error) {
        throw new PisiSetAsideError('SET_ASIDE_FAILED', error?.message);
    }
    const left = [];
    for (const key of keys) {
        const result = await writer.removeExternal(key);
        if (!result.written && result.reason !== 'unchanged') left.push(key);
    }
    return { name, copied: keys.length, left };
}
