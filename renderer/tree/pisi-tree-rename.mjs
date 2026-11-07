import { animateTreeRow } from './pisi-tree-dom.mjs';
import { updateTreeItemAfterRename, updateOpenMapNodeAfterRename } from './pisi-tree-mutations.mjs';

export function selectTreeFile(item, row) {
    document.querySelectorAll('.tree-row.selected').forEach((el) => {
        el.classList.remove('selected');
    });

    row.classList.add('selected');

    selectedTreeItem = {
        item,
        row
    };
}

export function startRenameSelectedTreeFile() {
    if (!selectedTreeItem) return;

    startRenameTreeFile(selectedTreeItem.item, selectedTreeItem.row);
}

export function startRenameTreeFile(item, row) {
    const treeNode = row?.closest('.tree-node');

    // Eğer bu satır daha önce rename ile güncellendiyse,
    // event listener içindeki eski item yerine DOM'a bağlı güncel item'ı kullan.
    if (treeNode?.__pisiItem) {
        item = treeNode.__pisiItem;
    }

    if (!item || item.isDirectory) return;

    const nameSpan = row.querySelector('.tree-name');
    if (!nameSpan) return;

    if (row.dataset.renaming === '1') return;
    row.dataset.renaming = '1';

    const oldPath = item.fullPath;
    console.log('[PISI] Rename input title:', getTreeItemDisplayName(item), item);
    const oldBaseName = getTreeItemDisplayName(item);
    const oldName = oldBaseName;

    const input = document.createElement('input');
    input.className = 'tree-rename-input pisi-rename-input';
    input.value = oldBaseName;

    nameSpan.replaceWith(input);

    input.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('dblclick', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('keydown', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('keyup', (event) => {
        event.stopPropagation();
    });

    focusPisiTextInput(input, true);

    let finished = false;

    function restoreName(text = oldName) {
        const span = document.createElement('span');
        span.className = 'tree-name';
        span.textContent = text;

        if (input.isConnected) {
            input.replaceWith(span);
        }

        row.dataset.renaming = '0';
    }

    async function finishRename(commit) {
        if (finished) return;
        finished = true;

        try {
            const newBaseName = input.value.trim();

            if (!commit || !newBaseName || newBaseName === oldBaseName) {
                restoreName(oldName);
                return;
            }

            if (typeof flushPisiPendingSaves === 'function') {
                const saved = await flushPisiPendingSaves();
                if (!saved) {
                    restoreName(oldName);
                    return;
                }
            }

            const renameSourcePath = item.fullPath || oldPath;
            suppressNextFileSystemRefresh(1500);

            const result = await renamePisiItemWithLinkReview(renameSourcePath, newBaseName);

            if (!result || !result.ok) {
                pisiNotifyError(result?.error || 'İsim değiştirilemedi.');
                restoreName(oldName);
                return;
            }

            item.name = result.fileName;
            item.displayName = result.metadata?.title || result.displayName || result.fileName;
            item.fullPath = result.fullPath;
            item.metadata = result.metadata || item.metadata;
            item.sidecarPath = result.sidecarPath || item.sidecarPath;

            const nodeEl = row.closest('.tree-node');
            if (nodeEl) {
                nodeEl.dataset.path = result.fullPath;
            }

            row.title = result.fullPath;

            restoreName(result.metadata?.title || result.displayName || result.fileName);

            updateTreeItemAfterRename(renameSourcePath, result);
            updateOpenMapNodeAfterRename(renameSourcePath, result);

            if (typeof updatePisiOpenTabAfterRename === 'function') {
                updatePisiOpenTabAfterRename(renameSourcePath, result);
            }

            animateTreeRow(row);
        } catch (error) {
            console.error('[PISI] Rename sırasında hata:', error);
            pisiNotifyError('İsim değiştirilemedi.', { detail: error?.message });
            restoreName(oldName);
        } finally {
            row.dataset.renaming = '0';
        }
    }

    input.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await finishRename(true);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            await finishRename(false);
        }
    });

    input.addEventListener('blur', async () => {
        await finishRename(true);
    });
}
