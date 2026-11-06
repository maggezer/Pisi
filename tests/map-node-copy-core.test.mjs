import test from 'node:test';
import assert from 'node:assert/strict';
import { makePisiCopyTitle, stripPisiCopiedTaskIdentity } from '../main/functions/map-node-copy-core.js';

test('copied notes lose canonical task ids but keep task text and status', () => {
    const html =
        '<div class="pisi-editor-block" data-pisi-block-type="task" data-pisi-task-id="task_abc123"><span data-pisi-todo-status="done">Rapor</span></div>' +
        "<span data-pisi-task-id='task_x9'>Diğer</span><p data-pisi-task-id=task_y1>Üçüncü</p>";
    const stripped = stripPisiCopiedTaskIdentity(html);
    assert.doesNotMatch(stripped, /data-pisi-task-id/);
    assert.match(stripped, /data-pisi-block-type="task"/);
    assert.match(stripped, /data-pisi-todo-status="done">Rapor/);
    assert.match(stripped, /Diğer/);
    assert.equal(stripPisiCopiedTaskIdentity(null), '');
});

test('copy titles get one "(kopya)" suffix', () => {
    assert.equal(makePisiCopyTitle('Plan'), 'Plan (kopya)');
    assert.equal(makePisiCopyTitle('Plan (kopya)'), 'Plan (kopya)');
    assert.equal(makePisiCopyTitle('  '), 'Node (kopya)');
});
