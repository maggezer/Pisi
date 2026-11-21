// Block ids are always new. Task ids are not changed here: a pasted task block
// is copied or brought back by renderer/tasks/pisi-task-clipboard.mjs (§3.3).
export function rekeyPisiPastedBlocks(blocks, makeId) {
    const blockIds = new Map();
    const nodes = blocks.flatMap((block) => [block, ...block.querySelectorAll('*')]);
    for (const node of nodes) {
        const id = node.dataset.pisiBlockId;
        if (id && !blockIds.has(id)) blockIds.set(id, makeId());
    }
    for (const node of nodes) {
        if (node.dataset.pisiBlockId) node.dataset.pisiBlockId = blockIds.get(node.dataset.pisiBlockId);
        const parent = node.dataset.pisiHeadingParent;
        if (parent && blockIds.has(parent)) node.dataset.pisiHeadingParent = blockIds.get(parent);
        if (node.tagName === 'A' && node.getAttribute('href')?.startsWith('#')) {
            const target = node.getAttribute('href').slice(1);
            if (blockIds.has(target)) node.setAttribute('href', '#' + blockIds.get(target));
        }
        if (node.matches('table[data-pisi-sheet-model]')) {
            const model = JSON.parse(node.dataset.pisiSheetModel);
            model.databaseId = 'database-' + makeId();
            node.dataset.pisiDatabaseId = model.databaseId;
            node.dataset.pisiSheetModel = JSON.stringify(model);
            node.removeAttribute('data-pisi-sheet-asset');
        }
    }
}
