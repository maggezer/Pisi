'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('günlük not içinde oluşturulan yerel görevler Görevler başlığı altına taşınır ve tekrarlanmaz', async () => {
    const diaryModule = await import('../main/functions/document-store-diary.js');

    const sampleLocalTasks = [
        '<div class="pisi-editor-block" data-pisi-block-type="task"><span class="pisi-block-task-marker">☐</span> Bölüm dışı danışman atama mümkün mü, sor</div>',
        '<div class="pisi-editor-block" data-pisi-block-type="task"><span class="pisi-block-task-marker">☐</span> Gizli ağ açılmış mı sor</div>'
    ].join('\n');

    // 1. organizeDiaryManualTasks başlık yoksa oluşturur ve görevleri altına alır
    const organized = diaryModule.organizeDiaryManualTasks(sampleLocalTasks, '2026-10-22');
    assert.match(organized, /^<h3>Görevler · 2026-10-22<\/h3>/);
    assert.match(organized, /Bölüm dışı danışman atama mümkün mü, sor/);
    assert.match(organized, /Gizli ağ açılmış mı sor/);

    // 2. Başlığın üstüne yazılan görev başlığın altına taşınır
    const sampleWithTaskAbove = [
        '<div class="pisi-editor-block" data-pisi-block-type="task"><span class="pisi-block-task-marker">☐</span> Üstteki yeni görev</div>',
        '<h3>Görevler · 2026-10-22</h3>',
        '<div class="pisi-editor-block" data-pisi-block-type="task"><span class="pisi-block-task-marker">☐</span> Alttaki eski görev</div>'
    ].join('\n');

    const reorganized = diaryModule.organizeDiaryManualTasks(sampleWithTaskAbove, '2026-10-22');
    const headingIndex = reorganized.indexOf('<h3>Görevler · 2026-10-22</h3>');
    const upperTaskIndex = reorganized.indexOf('Üstteki yeni görev');
    const lowerTaskIndex = reorganized.indexOf('Alttaki eski görev');

    assert.ok(headingIndex !== -1);
    assert.ok(upperTaskIndex > headingIndex, 'Üstteki görev başlığın altına geçmiş olmalı');
    assert.ok(lowerTaskIndex > headingIndex, 'Alttaki görev başlığın altında kalmalı');

    // 3. Normal notlar (journal metinleri) başlığın üstünde kalır
    const sampleWithNotes = [
        '<div>Bugün çok verimli bir gündü.</div>',
        '<div class="pisi-editor-block" data-pisi-block-type="task"><span class="pisi-block-task-marker">☐</span> Görev 1</div>'
    ].join('\n');

    const withNotes = diaryModule.organizeDiaryManualTasks(sampleWithNotes, '2026-10-22');
    const notePos = withNotes.indexOf('Bugün çok verimli bir gündü.');
    const noteHeadingPos = withNotes.indexOf('<h3>Görevler · 2026-10-22</h3>');
    const taskPos = withNotes.indexOf('Görev 1');

    assert.ok(notePos < noteHeadingPos, 'Günlük notlar Görevler başlığından önce gelmeli');
    assert.ok(taskPos > noteHeadingPos, 'Görev Görevler başlığından sonra gelmeli');
});

test('dışarıdan gelen görevler tek satır kompakt yapıda, checkbox ile oluşturulur ve nota yönlendirme özniteliklerini içerir', async () => {
    const diaryModule = await import('../main/functions/document-store-diary.js');

    const externalEntries = [
        {
            date: '2026-10-22',
            sourceKey: 'nodePath::blk_123::todo.1.22-10-2026',
            nodePath: 'c:/project/Ahenk.node',
            blockId: 'blk_123',
            nodeTitle: 'Ahenk',
            tag: 'todo.1.22-10-2026',
            text: 'Dış nottan gelen görev',
            status: 'todo',
            repeat: 'none',
            priority: 1
        }
    ];

    const managedHtml = diaryModule.buildPisiDiaryManagedSection('2026-10-22', externalEntries, {
        includeHeading: true
    });

    // Checkbox marker
    assert.match(managedHtml, /class=["'][^"']*pisi-block-task-marker[^"']*["']/);
    assert.match(managedHtml, /role=["']checkbox["']/);
    assert.match(managedHtml, /☐/);

    // Kompakt metin ve kaynak başlığı
    assert.match(managedHtml, /class=["'][^"']*pisi-diary-task-text[^"']*["']/);
    assert.match(managedHtml, /Dış nottan gelen görev/);
    assert.match(managedHtml, /class=["'][^"']*pisi-diary-managed-meta[^"']*["']/);
    assert.match(managedHtml, /· Ahenk/);

    // Nota yönlendirme için gerekli data öznitelikleri
    assert.match(managedHtml, /data-pisi-diary-node-path=["']c:\/project\/Ahenk\.node["']/);
    assert.match(managedHtml, /data-pisi-diary-block-id=["']blk_123["']/);
    assert.match(managedHtml, /title=["']Nota git: Ahenk["']/);
});

test('günlük notta zaten başlık varsa managed section mükerrer başlık eklemez', async () => {
    const diaryModule = await import('../main/functions/document-store-diary.js');

    const externalEntries = [
        {
            date: '2026-10-22',
            sourceKey: 'nodePath::blk_123::todo.1.22-10-2026',
            nodePath: 'c:/project/Ahenk.node',
            blockId: 'blk_123',
            nodeTitle: 'Ahenk',
            tag: 'todo.1.22-10-2026',
            text: 'Dış nottan gelen görev',
            status: 'todo',
            repeat: 'none',
            priority: 1
        }
    ];

    const managedWithoutHeading = diaryModule.buildPisiDiaryManagedSection('2026-10-22', externalEntries, {
        includeHeading: false
    });

    assert.doesNotMatch(managedWithoutHeading, /<h3>Görevler/);
    assert.match(managedWithoutHeading, /Dış nottan gelen görev/);
});

test('CSS kuralları ve tıklama dinleyicileri kompakt satır ve nota gitme desteğini sağlar', () => {
    const prodCss = read('styles/50-productivity.css');
    const calendarDiary = read('renderer/calendar/pisi-calendar-diary.mjs');
    const editor = read('renderer/editor/pisi-node-editor.mjs');

    // CSS: display flex, gap, tek satır
    assert.match(prodCss, /\.pisi-diary-managed-block \{[\s\S]*?display:\s*flex;/);
    assert.match(prodCss, /\.pisi-diary-managed-block \{[\s\S]*?align-items:\s*center;/);
    assert.match(prodCss, /\.pisi-diary-managed-block \.pisi-diary-task-text \{[\s\S]*?text-overflow:\s*ellipsis;/);

    // Calendar Diary: tıklama ile openPisiTagBlockResult çağrımı
    assert.match(calendarDiary, /openPisiTagBlockResult/);
    assert.match(calendarDiary, /pisi-diary-managed-block/);

    // Editor: data-pisi-diary-* korunan öznitelikler
    assert.match(editor, /'data-pisi-diary-node-path'/);
    assert.match(editor, /'data-pisi-diary-block-id'/);
});
test('günlükte listelenen dış görevlerin checkboxları korunur ve hem açık hem koyu temada stillendirilir', () => {
    const prodCss = read('styles/50-productivity.css');
    const todoBlocksJs = read('renderer/tags/pisi-todo-blocks.mjs');
    const editorBlocksJs = read('renderer/tags/pisi-editor-blocks.mjs');

    // 1. Managed bloklar editor-block olarak işaretlenmez, böylece orphan temizliğine girmez
    assert.match(editorBlocksJs, /.pisi-diary-managed-block/);
    assert.match(editorBlocksJs, /data-pisi-diary-source/);

    // 2. Todo marker temizleme fonksiyonları pisi-diary-managed-block içindeki markerları silmez
    assert.match(todoBlocksJs, /cleanupOrphanPisiTodoBlock[\s\S]*?\.pisi-diary-managed-block/);
    assert.match(todoBlocksJs, /syncPisiTodoBlockMarkers[\s\S]*?\.pisi-diary-managed-block/);
    assert.match(todoBlocksJs, /removePisiTodoFromBlock[\s\S]*?\.pisi-diary-managed-block/);

    // 3. CSS kuralları marker görünürlüğünü, kutu boyutunu ve işaretli durumunu garanti eder
    assert.match(prodCss, /\.pisi-diary-managed-block \.pisi-diary-task-marker \{[\s\S]*?display:\s*inline-grid;/);
    assert.match(prodCss, /\.pisi-diary-managed-block \.pisi-diary-task-marker \{[\s\S]*?border:\s*1\.5px solid/);
    assert.match(prodCss, /\.pisi-diary-managed-block \.pisi-diary-task-marker\[aria-checked=['"]true['"]\]::after \{[\s\S]*?content:\s*['"]✓['"]/);
    assert.match(prodCss, /html\[data-pisi-theme=['"]light['"]\][\s\S]*?\.pisi-diary-managed-block \.pisi-diary-task-marker/);
});
