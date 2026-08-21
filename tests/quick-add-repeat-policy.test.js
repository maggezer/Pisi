'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Quick Add owns repeat, native date, and friendly map-node labels', () => {
    const policy = read('renderer/productivity/pisi-quick-add-repeat-policy.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');

    assert.match(policy, /PISI_TODO_REPEAT_OPTIONS/);
    assert.match(policy, /select\.name = 'pisiRepeat'/);
    assert.match(policy, /date\.type = 'date'/);
    assert.match(policy, /date\.name = 'pisiDate'/);
    assert.match(policy, /input\[name="dateExpression"\][\s\S]*?\.remove\(\)/);
    assert.match(policy, /\.pisi-date-parse-preview'\)\?\.remove\(\)/);
    assert.match(policy, /input\[name="durationMinutes"\][\s\S]*?\.remove\(\)/);
    assert.match(policy, /input\[name="actualMinutes"\][\s\S]*?\.remove\(\)/);

    assert.match(policy, /record\.memberships/);
    assert.match(policy, /membership\?\.mapTitle/);
    assert.match(policy, /mapNames\.join\(' \/ '\)/);
    assert.match(policy, /`\$\{mapLabel\} — \$\{nodeLabel\}`/);
    assert.match(policy, /pisiQuickAddRepeatTranslate\('Inbox'\)/);

    assert.match(policy, /\.pisi-mission-repeat/);
    assert.match(policy, /control\.remove\(\)/);
    assert.match(
        policy,
        /name !== 'task\.capture\.v1'[\s\S]*?scheduledAt,[\s\S]*?deadline: null,[\s\S]*?reminderAt: null,[\s\S]*?repeat,[\s\S]*?durationMinutes: 0,[\s\S]*?actualMinutes: 0/
    );

    const quickCaptureIndex = bootstrap.indexOf('./productivity/pisi-quick-capture.mjs');
    const policyIndex = bootstrap.indexOf('./productivity/pisi-quick-add-repeat-policy.mjs');
    assert.ok(quickCaptureIndex >= 0 && policyIndex > quickCaptureIndex);
});
