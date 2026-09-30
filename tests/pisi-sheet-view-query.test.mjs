import test from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluatePisiSheetFilterTree,
    getPisiSheetViewItemRecords,
    normalizePisiSheetFilterTree,
    normalizePisiSheetSorts
} from '../renderer/editor/pisi-editor-sheet-view-query-core.mjs';

const fields = [
    {
        id: 'status',
        name: 'Status',
        type: 'select',
        options: [
            {
                id: 'todo',
                label: 'Todo',
                color: '#e57373'
            },
            {
                id: 'done',
                label: 'Done',
                color: '#81c784'
            }
        ]
    },
    {
        id: 'deadline',
        name: 'Deadline',
        type: 'date'
    },
    {
        id: 'priority',
        name: 'Priority',
        type: 'number'
    },
    {
        id: 'title',
        name: 'Title',
        type: 'text'
    }
];

const items = [
    {
        id: 'a',
        values: {
            status: { value: 'done' },
            deadline: { value: '2026-09-29' },
            priority: { value: 2 },
            title: { value: 'Beta' }
        }
    },
    {
        id: 'b',
        values: {
            status: { value: 'done' },
            deadline: { value: '2026-10-02' },
            priority: { value: 5 },
            title: { value: 'Alpha' }
        }
    },
    {
        id: 'c',
        values: {
            status: { value: 'todo' },
            deadline: { value: '2026-09-28' },
            priority: { value: 5 },
            title: { value: 'Gamma' }
        }
    },
    {
        id: 'd',
        values: {
            status: { value: 'done' },
            deadline: { value: '2026-09-27' },
            priority: { value: 5 },
            title: { value: 'Delta' }
        }
    }
];

const database = {
    fields,
    items
};

test('nested filter tree supports AND and OR groups', () => {
    const tree = {
        type: 'group',
        id: 'root',
        logic: 'and',
        children: [
            {
                type: 'condition',
                id: 'status-done',
                fieldId: 'status',
                operator: 'is',
                value: 'done'
            },
            {
                type: 'group',
                id: 'date-or-priority',
                logic: 'or',
                children: [
                    {
                        type: 'condition',
                        id: 'deadline-before',
                        fieldId: 'deadline',
                        operator: 'before',
                        value: '@today'
                    },
                    {
                        type: 'condition',
                        id: 'priority-high',
                        fieldId: 'priority',
                        operator: 'gte',
                        value: 5
                    }
                ]
            }
        ]
    };

    const now = new Date('2026-09-30T12:00:00Z');

    assert.equal(
        evaluatePisiSheetFilterTree(
            database,
            items[0],
            tree,
            now
        ),
        true
    );
    assert.equal(
        evaluatePisiSheetFilterTree(
            database,
            items[1],
            tree,
            now
        ),
        true
    );
    assert.equal(
        evaluatePisiSheetFilterTree(
            database,
            items[2],
            tree,
            now
        ),
        false
    );
});

test('Status = Done AND Deadline < Today keeps only matching rows', () => {
    const view = {
        filters: {
            type: 'group',
            id: 'root',
            logic: 'and',
            children: [
                {
                    type: 'condition',
                    id: 'f1',
                    fieldId: 'status',
                    operator: 'is',
                    value: 'done'
                },
                {
                    type: 'condition',
                    id: 'f2',
                    fieldId: 'deadline',
                    operator: 'before',
                    value: '2026-09-30'
                }
            ]
        },
        sorts: []
    };

    assert.deepEqual(
        getPisiSheetViewItemRecords(
            database,
            view,
            new Date('2026-09-30T12:00:00Z')
        ).map((record) => record.item.id),
        ['a', 'd']
    );
});

test('multi-sort uses criteria priority without mutating database items', () => {
    const originalIds = database.items.map(
        (item) => item.id
    );
    const view = {
        filters: {
            type: 'group',
            id: 'root',
            logic: 'and',
            children: []
        },
        sorts: [
            {
                id: 's1',
                fieldId: 'priority',
                direction: 'desc'
            },
            {
                id: 's2',
                fieldId: 'deadline',
                direction: 'asc'
            }
        ]
    };

    assert.deepEqual(
        getPisiSheetViewItemRecords(
            database,
            view
        ).map((record) => record.item.id),
        ['d', 'c', 'b', 'a']
    );

    assert.deepEqual(
        database.items.map((item) => item.id),
        originalIds
    );
});

test('legacy filter arrays normalize into an AND tree and invalid sorts are removed', () => {
    const fieldIds = new Set(
        fields.map((field) => field.id)
    );
    const filters = normalizePisiSheetFilterTree(
        [
            {
                fieldId: 'status',
                operator: 'is',
                value: 'done'
            },
            {
                fieldId: 'missing',
                operator: 'is',
                value: 'x'
            }
        ],
        fieldIds
    );

    assert.equal(filters.type, 'group');
    assert.equal(filters.logic, 'and');
    assert.equal(filters.children.length, 1);
    assert.equal(
        filters.children[0].fieldId,
        'status'
    );

    assert.deepEqual(
        normalizePisiSheetSorts(
            [
                {
                    fieldId: 'priority',
                    direction: 'desc'
                },
                {
                    fieldId: 'priority',
                    direction: 'asc'
                },
                {
                    fieldId: 'missing',
                    direction: 'asc'
                }
            ],
            fieldIds
        ).map((sort) => [
            sort.fieldId,
            sort.direction
        ]),
        [['priority', 'desc']]
    );
});
