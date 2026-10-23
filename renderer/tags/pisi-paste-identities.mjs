export function rekeyPisiPastedBlocks(blocks, makeId) {
    const blockIds = new Map();
    const taskIds = new Map();
    const nodes = blocks.flatMap((block) => [block, ...block.querySelectorAll('*')]);
    for (const node of nodes) {
        const id = node.dataset.pisiBlockId;
        if (id && !blockIds.has(id)) blockIds.set(id, makeId());
        const taskId = node.dataset.pisiTaskId;
        if (taskId && !taskIds.has(taskId)) taskIds.set(taskId, 'task_' + makeId());
    }
    for (const node of nodes) {
        if (node.dataset.pisiBlockId) node.dataset.pisiBlockId = blockIds.get(node.dataset.pisiBlockId);
        if (node.dataset.pisiTaskId) node.dataset.pisiTaskId = taskIds.get(node.dataset.pisiTaskId);
        for (const key of ['pisiHeadingParent', 'pisiBlockRef', 'pisiTodoParent']) {
            let value = node.dataset[key];
            if (!value) continue;
            for (const [oldId, newId] of [...blockIds, ...taskIds]) value = value.split(oldId).join(newId);
            node.dataset[key] = value;
        }
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
