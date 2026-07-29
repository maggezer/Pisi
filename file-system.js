'use strict';

const classicEditorContainer = document.getElementById('classic-editor-container');
const myEditor = document.getElementById('myEditor');
const tabsDivLeft = document.getElementById('tabs-left');
let openTabs = [];
let nodeToRename = null;

function blankCanvasDocument() {
    return {
        schemaVersion: 2,
        board: '',
        connections: [],
        camera: { x: 0, y: 0, zoom: 1 },
        counter: 1
    };
}

function hideWelcome() {
    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';
}

function showClassicEditor() {
    if (window.currentCanvasFile && window.flushCanvasSave?.() === false) return false;
    window.closeNodeEditor?.({ save: false });
    window.cancelCanvasSave?.();
    window.currentCanvasFile = null;
    hideWelcome();
    const canvasViewport = document.getElementById('canvas-viewport');
    if (canvasViewport) canvasViewport.style.display = 'none';
    if (classicEditorContainer) classicEditorContainer.style.display = 'flex';
    const saveStatus = document.getElementById('save-status');
    if (saveStatus) {
        saveStatus.textContent = 'Klasik Düzenleyici';
        saveStatus.style.color = '#888';
    }
    return true;
}

function showCanvasView() {
    hideWelcome();
    if (classicEditorContainer) classicEditorContainer.style.display = 'none';
    const canvasViewport = document.getElementById('canvas-viewport');
    if (canvasViewport) canvasViewport.style.display = 'block';
    const saveStatus = document.getElementById('save-status');
    if (saveStatus) {
        saveStatus.textContent = 'Tuval Modu';
        saveStatus.style.color = '#888';
    }
}

function loadFileToEditor(fullPath, fileName) {
    if (!showClassicEditor()) return;
    try {
        const cleanHtml = window.sanitizeRichHtml(window.kedi.fs.readText(fullPath));
        if (!openTabs.some((tab) => tab.fullPath === fullPath)) {
            openTabs.push({ fullPath, fileName });
        }
        if (myEditor) {
            myEditor.innerHTML = cleanHtml;
            myEditor.setAttribute('contenteditable', 'true');
            myEditor.setAttribute('data-path', fullPath);
        }
        renderClassicTabs();
    } catch (error) {
        console.error('Not yüklenemedi:', error);
        window.alert(`Not yüklenemedi: ${error.message}`);
    }
}

function parseCanvasDocument(content) {
    if (content.trim() === '') {
        return { data: blankCanvasDocument(), migrated: true };
    }

    const parsed = JSON.parse(content);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Tuvalin kök verisi bir nesne olmalı.');
    }

    const camera = parsed.camera && typeof parsed.camera === 'object' ? parsed.camera : {};
    const normalized = {
        schemaVersion: 2,
        board: typeof parsed.board === 'string' ? parsed.board : '',
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        camera: {
            x: Number.isFinite(camera.x) ? camera.x : 0,
            y: Number.isFinite(camera.y) ? camera.y : 0,
            zoom: Number.isFinite(camera.zoom) ? Math.min(3, Math.max(0.2, camera.zoom)) : 1
        },
        counter: Number.isInteger(parsed.counter) && parsed.counter >= 1 ? parsed.counter : 1
    };
    return { data: normalized, migrated: parsed.schemaVersion !== 2 };
}

function normalizeLoadedConnections(connections, boxIds) {
    const positions = new Set(['top', 'right', 'bottom', 'left']);
    return connections
        .filter((connection) => connection
            && boxIds.has(connection.sourceBox)
            && boxIds.has(connection.targetBox)
            && positions.has(connection.sourcePos)
            && positions.has(connection.targetPos))
        .map((connection, index) => ({
            id: typeof connection.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(connection.id)
                ? connection.id
                : `connection-loaded-${index}`,
            sourceBox: connection.sourceBox,
            sourcePos: connection.sourcePos,
            targetBox: connection.targetBox,
            targetPos: connection.targetPos
        }));
}

function applyCanvasDocument(fullPath, data) {
    const canvasBoard = document.getElementById('canvas-board');
    if (!canvasBoard) throw new Error('Tuval alanı bulunamadı.');

    window.closeNodeEditor?.({ save: false });
    window.cancelCanvasSave?.();
    window.resetConnectionEngine?.();
    canvasBoard.replaceChildren();
    canvasBoard.innerHTML = window.sanitizeBoardHtml(data.board);

    const seenIds = new Set();
    let highestBoxNumber = 1;
    canvasBoard.querySelectorAll('.canvas-box').forEach((box, index) => {
        if (!box.id || seenIds.has(box.id)) box.id = `box-recovered-${index + 1}`;
        seenIds.add(box.id);
        const numericId = /^box-(\d+)$/.exec(box.id);
        if (numericId) highestBoxNumber = Math.max(highestBoxNumber, Number(numericId[1]));
        window.bindBoxEvents?.(box);
    });

    window.connections = normalizeLoadedConnections(data.connections, seenIds);
    window.camera = data.camera;
    window.boxIdCounter = Math.max(data.counter, highestBoxNumber);
    window.currentCanvasFile = fullPath;
    showCanvasView();
    window.updateCanvas?.();
    window.drawAllConnections?.();
}

function loadFileToCanvas(fullPath) {
    if (window.currentCanvasFile && window.flushCanvasSave?.() === false) return;

    let parsedDocument;
    try {
        const content = window.kedi.fs.readText(fullPath);
        parsedDocument = parseCanvasDocument(content);
    } catch (error) {
        console.error('Tuval yükleme hatası:', error);
        const saveStatus = document.getElementById('save-status');
        if (saveStatus) {
            saveStatus.textContent = 'Bozuk tuval açılmadı';
            saveStatus.style.color = '#e74c3c';
        }
        window.alert(`Tuval açılamadı ve dosyaya dokunulmadı:\n${error.message}`);
        return;
    }

    try {
        applyCanvasDocument(fullPath, parsedDocument.data);
        if (parsedDocument.migrated) window.triggerCanvasSave?.(true);
    } catch (error) {
        console.error('Tuval uygulanamadı:', error);
        window.alert(`Tuval görüntülenemedi: ${error.message}`);
    }
}

function renderClassicTabs() {
    if (!tabsDivLeft) return;
    tabsDivLeft.replaceChildren();
    openTabs.forEach((tabData) => {
        const tab = document.createElement('div');
        tab.className = 'tab';
        if (myEditor?.getAttribute('data-path') === tabData.fullPath) tab.classList.add('active');

        const title = document.createElement('span');
        title.textContent = tabData.fileName.replace(/\.md$/i, '');
        title.addEventListener('click', () => loadFileToEditor(tabData.fullPath, tabData.fileName));

        const closeButton = document.createElement('button');
        closeButton.className = 'tab-close';
        closeButton.type = 'button';
        closeButton.textContent = '✖';
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            closeClassicTab(tabData.fullPath);
        });

        tab.append(title, closeButton);
        tabsDivLeft.appendChild(tab);
    });
}

function closeClassicTab(fullPath) {
    openTabs = openTabs.filter((tab) => tab.fullPath !== fullPath);
    if (myEditor?.getAttribute('data-path') === fullPath) {
        myEditor.replaceChildren();
        myEditor.removeAttribute('data-path');
        myEditor.setAttribute('contenteditable', 'false');
    }
    renderClassicTabs();
}

function refreshFileList() {
    const fileList = document.getElementById('file-list');
    if (!fileList || !window.currentHivePath) return;
    fileList.replaceChildren();
    const sidebarControls = document.getElementById('sidebar-controls');
    if (sidebarControls) sidebarControls.style.display = 'flex';
    buildFileTree(window.currentHivePath, fileList);
}

function createInstantFile(dirPath, extension = '.md') {
    if (!dirPath || !['.md', '.canvas'].includes(extension)) return;
    let fileName = `New Note${extension}`;
    let counter = 1;
    while (window.kedi.fs.exists(window.kedi.path.join(dirPath, fileName))) {
        fileName = `New Note (${counter})${extension}`;
        counter += 1;
    }

    const fullPath = window.kedi.path.join(dirPath, fileName);
    const content = extension === '.md'
        ? '<h1>Yeni Not</h1><br>'
        : JSON.stringify(blankCanvasDocument(), null, 2);
    try {
        window.kedi.fs.writeText(fullPath, content);
        nodeToRename = fullPath;
        refreshFileList();
    } catch (error) {
        window.alert(`Dosya oluşturulamadı: ${error.message}`);
    }
}

function handleRename(oldPath, newName, isDirectory) {
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName.includes('/') || trimmedName.includes('\\')) {
        nodeToRename = null;
        refreshFileList();
        return;
    }

    const directory = window.kedi.path.dirname(oldPath);
    const extension = isDirectory ? '' : window.kedi.path.extname(oldPath);
    const finalName = extension && !trimmedName.toLowerCase().endsWith(extension.toLowerCase())
        ? `${trimmedName}${extension}`
        : trimmedName;
    const newPath = window.kedi.path.join(directory, finalName);

    try {
        if (oldPath !== newPath && !window.kedi.fs.exists(newPath)) {
            window.kedi.fs.rename(oldPath, newPath);
        }
    } catch (error) {
        window.alert(`Yeniden adlandırma başarısız: ${error.message}`);
    }
    nodeToRename = null;
    refreshFileList();
}

function buildFileTree(dirPath, container) {
    let items;
    try {
        items = window.kedi.fs.listDirectory(dirPath);
    } catch (error) {
        console.error('Klasör listelenemedi:', error);
        return;
    }

    const folders = items
        .filter((item) => item.type === 'directory' && !['images', 'Journals'].includes(item.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const files = items
        .filter((item) => item.type === 'file' && /\.(?:md|canvas)$/i.test(item.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

    folders.forEach((item) => renderItem(item, dirPath, container, true));
    files.forEach((item) => renderItem(item, dirPath, container, false));
}

function renderItem(item, dirPath, container, isDirectory) {
    const fullPath = window.kedi.path.join(dirPath, item.name);
    const isCanvas = !isDirectory && /\.canvas$/i.test(item.name);
    const baseName = isDirectory ? item.name : item.name.replace(/\.(?:canvas|md)$/i, '');
    const listItem = document.createElement('li');
    listItem.className = 'tree-node';
    const itemRow = document.createElement('div');
    itemRow.className = 'file-item';

    if (nodeToRename === fullPath) {
        const input = document.createElement('input');
        input.className = 'rename-input';
        input.value = baseName;
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') input.blur();
            if (event.key === 'Escape') {
                nodeToRename = null;
                refreshFileList();
            }
        });
        input.addEventListener('blur', () => handleRename(fullPath, input.value, isDirectory));
        itemRow.appendChild(input);
        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    } else {
        const left = document.createElement('div');
        left.className = 'file-item-left';
        const icon = document.createElement('span');
        icon.textContent = isDirectory ? '▶' : (isCanvas ? '🌌' : '📄');
        const label = document.createElement('span');
        label.textContent = baseName;
        left.append(icon, label);
        itemRow.appendChild(left);

        if (isDirectory) {
            const children = document.createElement('ul');
            children.className = 'file-list-nested';
            children.style.display = 'none';
            listItem.append(itemRow, children);
            let loaded = false;
            itemRow.addEventListener('click', () => {
                if (!loaded) {
                    buildFileTree(fullPath, children);
                    loaded = true;
                }
                const opening = children.style.display === 'none';
                children.style.display = opening ? 'block' : 'none';
                icon.textContent = opening ? '▼' : '▶';
            });
            container.appendChild(listItem);
            return;
        }

        itemRow.addEventListener('click', () => {
            if (isCanvas) loadFileToCanvas(fullPath);
            else loadFileToEditor(fullPath, item.name);
        });
    }

    listItem.appendChild(itemRow);
    container.appendChild(listItem);
}

window.showClassicEditor = showClassicEditor;
window.showCanvasView = showCanvasView;
window.loadFileToEditor = loadFileToEditor;
window.loadFileToCanvas = loadFileToCanvas;
window.refreshFileList = refreshFileList;
window.createInstantFile = createInstantFile;
