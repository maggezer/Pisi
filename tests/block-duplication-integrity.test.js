'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const util = require('node:util');

function createMockClassList(initial = '') {
    const classes = new Set(
        String(initial || '')
            .split(/\s+/)
            .filter(Boolean)
    );
    return {
        add(...names) {
            names.forEach((n) => n && classes.add(n));
        },
        remove(...names) {
            names.forEach((n) => classes.delete(n));
        },
        contains(name) {
            return classes.has(name);
        },
        toggle(name, force) {
            if (force === true) {
                classes.add(name);
                return true;
            }
            if (force === false) {
                classes.delete(name);
                return false;
            }
            if (classes.has(name)) {
                classes.delete(name);
                return false;
            }
            classes.add(name);
            return true;
        },
        toString() {
            return Array.from(classes).join(' ');
        }
    };
}

function matchesSelector(element, selector) {
    if (!selector || !element) return false;
    const parts = selector
        .trim()
        .split(',')
        .map((s) => s.trim());
    for (const part of parts) {
        if (part === '*') return true;
        let p = part;
        let match = true;
        const tagMatch = p.match(/^([a-zA-Z0-9_-]+)/);
        if (tagMatch) {
            if (element.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) match = false;
            p = p.slice(tagMatch[0].length);
        }
        const classMatches = p.match(/\.([a-zA-Z0-9_-]+)/g);
        if (classMatches) {
            for (const cm of classMatches) {
                if (!element.classList.contains(cm.slice(1))) match = false;
            }
            p = p.replace(/\.([a-zA-Z0-9_-]+)/g, '');
        }
        const attrRegex = /\[([a-zA-Z0-9_-]+)(?:([*^$]?=)(["']?)(.*?)\3)?\]/g;
        let am;
        while ((am = attrRegex.exec(p)) !== null) {
            const [, attrName, op, , attrVal] = am;
            const actualVal = element.getAttribute(attrName);
            if (actualVal === null) {
                match = false;
                break;
            }
            if (op === '=' && actualVal !== attrVal) {
                match = false;
                break;
            }
            if (op === '^=' && !actualVal.startsWith(attrVal)) {
                match = false;
                break;
            }
            if (op === '*=' && !actualVal.includes(attrVal)) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }
    return false;
}

function createMockElement(tagName = 'div') {
    const tag = String(tagName || 'div').toUpperCase();
    const attributes = new Map();
    const eventListeners = new Map();
    const children = [];

    const datasetProxy = new Proxy(
        {},
        {
            get(target, prop) {
                const attr =
                    'data-' +
                    String(prop)
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase();
                return attributes.has(attr) ? attributes.get(attr) : undefined;
            },
            set(target, prop, value) {
                const attr =
                    'data-' +
                    String(prop)
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase();
                attributes.set(attr, String(value));
                return true;
            },
            deleteProperty(target, prop) {
                const attr =
                    'data-' +
                    String(prop)
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase();
                attributes.delete(attr);
                return true;
            },
            has(target, prop) {
                const attr =
                    'data-' +
                    String(prop)
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase();
                return attributes.has(attr);
            }
        }
    );

    const classList = createMockClassList();

    const element = {
        nodeType: 1,
        tagName: tag,
        dataset: datasetProxy,
        classList,
        parentNode: null,
        get parentElement() {
            return this.parentNode;
        },
        get children() {
            return children;
        },
        get childNodes() {
            return children;
        },
        get firstChild() {
            return children[0] || null;
        },
        get lastChild() {
            return children[children.length - 1] || null;
        },
        get previousElementSibling() {
            if (!this.parentNode) return null;
            const siblings = this.parentNode.children;
            const idx = siblings.indexOf(this);
            return idx > 0 ? siblings[idx - 1] : null;
        },
        get nextElementSibling() {
            if (!this.parentNode) return null;
            const siblings = this.parentNode.children;
            const idx = siblings.indexOf(this);
            return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
        },
        get nextSibling() {
            return this.nextElementSibling;
        },
        get className() {
            return classList.toString();
        },
        set className(val) {
            classList.remove(...Array.from(classList.toString().split(' ')));
            classList.add(
                ...String(val || '')
                    .split(/\s+/)
                    .filter(Boolean)
            );
        },
        get id() {
            return attributes.get('id') || '';
        },
        set id(val) {
            if (val) attributes.set('id', String(val));
            else attributes.delete('id');
        },
        textContent: '',
        innerHTML: '',
        getAttribute(name) {
            return attributes.has(name) ? attributes.get(name) : null;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
            if (name === 'class') this.className = value;
            if (name === 'id') this.id = value;
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        hasAttribute(name) {
            return attributes.has(name);
        },
        appendChild(child) {
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = this;
            children.push(child);
            return child;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx >= 0) {
                children.splice(idx, 1);
                child.parentNode = null;
            }
            return child;
        },
        append(...nodes) {
            nodes.forEach((n) => this.appendChild(n));
        },
        after(...nodes) {
            if (!this.parentNode) return;
            const siblings = this.parentNode.children;
            let idx = siblings.indexOf(this);
            if (idx === -1) return;
            for (const node of nodes) {
                if (node.parentNode) node.parentNode.removeChild(node);
                node.parentNode = this.parentNode;
                siblings.splice(idx + 1, 0, node);
                idx += 1;
            }
        },
        before(...nodes) {
            if (!this.parentNode) return;
            const siblings = this.parentNode.children;
            let idx = siblings.indexOf(this);
            if (idx === -1) return;
            for (const node of nodes) {
                if (node.parentNode) node.parentNode.removeChild(node);
                node.parentNode = this.parentNode;
                siblings.splice(idx, 0, node);
                idx += 1;
            }
        },
        remove() {
            if (this.parentNode) this.parentNode.removeChild(this);
        },
        contains(node) {
            if (node === this) return true;
            for (const child of children) {
                if (child.contains(node)) return true;
            }
            return false;
        },
        closest(selector) {
            let curr = this;
            while (curr) {
                if (matchesSelector(curr, selector)) return curr;
                curr = curr.parentElement;
            }
            return null;
        },
        querySelector(selector) {
            for (const child of children) {
                if (matchesSelector(child, selector)) return child;
                const found = child.querySelector(selector);
                if (found) return found;
            }
            return null;
        },
        querySelectorAll(selector) {
            const results = [];
            for (const child of children) {
                if (matchesSelector(child, selector)) results.push(child);
                results.push(...child.querySelectorAll(selector));
            }
            return results;
        },
        addEventListener(type, handler) {
            if (!eventListeners.has(type)) eventListeners.set(type, []);
            eventListeners.get(type).push(handler);
        },
        dispatchEvent(event) {
            const list = eventListeners.get(event?.type || '') || [];
            list.forEach((fn) => fn.call(this, event));
            if (this.parentNode && event?.bubbles) {
                this.parentNode.dispatchEvent(event);
            }
            return true;
        },
        cloneNode(deep = false) {
            const clone = createMockElement(this.tagName);
            clone.className = this.className;
            attributes.forEach((val, key) => clone.setAttribute(key, val));
            clone.textContent = this.textContent;
            clone.innerHTML = this.innerHTML;
            if (deep) {
                for (const child of children) {
                    clone.appendChild(child.cloneNode(true));
                }
            }
            return clone;
        },
        [util.inspect.custom]() {
            return `<${this.tagName} id="${this.dataset.pisiBlockId || ''}" class="${this.className}">`;
        }
    };

    return element;
}

let loadedModule = null;

async function getBlockEditor() {
    if (loadedModule) return loadedModule;
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.document = {
        readyState: 'complete',
        createElement: createMockElement,
        getElementById: () => null,
        addEventListener: () => {},
        dispatchEvent: () => true
    };
    globalThis.Event = class Event {
        constructor(type, init = {}) {
            this.type = type;
            this.bubbles = Boolean(init.bubbles);
        }
        preventDefault() {}
        stopPropagation() {}
        stopImmediatePropagation() {}
    };
    globalThis.CustomEvent = class CustomEvent extends globalThis.Event {
        constructor(type, init = {}) {
            super(type, init);
            this.detail = init.detail;
        }
    };
    let blockCounter = 1;
    let taskCounter = 1;
    globalThis.makePisiBlockId = () => `blk_gen_${blockCounter++}`;
    globalThis.makePisiFirstClassTaskId = () => `task_gen_${taskCounter++}`;

    loadedModule = await import('../renderer/editor/pisi-block-editor.mjs');
    return loadedModule;
}

test('Acceptance test B1: duplicating section with nested blocks and tasks regenerates all IDs with zero collision', async () => {
    const { duplicatePisiBlock } = await getBlockEditor();

    const editor = createMockElement('div');
    editor.className = 'pisi-rich-editor';

    // 1. Heading block
    const heading = createMockElement('h2');
    heading.className = 'pisi-editor-block';
    heading.dataset.pisiBlockId = 'blk_orig_h2';
    heading.dataset.pisiBlockType = 'heading2';
    heading.textContent = 'Bölüm 1';

    // 2. Child paragraph block
    const paragraph = createMockElement('div');
    paragraph.className = 'pisi-editor-block';
    paragraph.dataset.pisiBlockId = 'blk_orig_p1';
    paragraph.dataset.pisiBlockType = 'paragraph';
    paragraph.dataset.pisiHeadingParent = 'blk_orig_h2';
    paragraph.textContent = 'Paragraf metni';

    // 3. Child task block 1
    const task1 = createMockElement('div');
    task1.className = 'pisi-editor-block';
    task1.dataset.pisiBlockId = 'blk_orig_t1';
    task1.dataset.pisiBlockType = 'task';
    task1.dataset.pisiTaskId = 'task_orig_1';
    task1.dataset.pisiHeadingParent = 'blk_orig_h2';

    const marker1 = createMockElement('span');
    marker1.className = 'pisi-block-task-marker';
    marker1.textContent = '☐';
    marker1.setAttribute('aria-checked', 'false');
    task1.appendChild(marker1);

    const tag1 = createMockElement('span');
    tag1.className = 'pisi-user-tag';
    tag1.dataset.pisiTag = 'todo.1.none';
    tag1.dataset.pisiTaskId = 'task_orig_1';
    task1.appendChild(tag1);

    // 4. Child task block 2 (depends on task 1 + external task)
    const task2 = createMockElement('div');
    task2.className = 'pisi-editor-block';
    task2.dataset.pisiBlockId = 'blk_orig_t2';
    task2.dataset.pisiBlockType = 'task';
    task2.dataset.pisiTaskId = 'task_orig_2';
    task2.dataset.pisiTodoParent = 'dep:task_orig_1|task_external_999';

    const marker2 = createMockElement('span');
    marker2.className = 'pisi-block-task-marker';
    marker2.textContent = '☑';
    marker2.setAttribute('aria-checked', 'true');
    task2.appendChild(marker2);

    // 5. Rollup block targeting task 1
    const rollup = createMockElement('div');
    rollup.className = 'pisi-editor-block pisi-rollup-block';
    rollup.dataset.pisiBlockId = 'blk_orig_rollup';
    rollup.dataset.pisiBlockType = 'rollup';
    rollup.dataset.pisiRollupTarget = 'blk_orig_t1';
    rollup.dataset.pisiRollupRelation = 'rel_tasks';

    // 6. Cross-reference paragraph with internal and external links
    const refBlock = createMockElement('div');
    refBlock.className = 'pisi-editor-block';
    refBlock.dataset.pisiBlockId = 'blk_orig_ref';
    refBlock.dataset.pisiBlockRef = 'blk_orig_h2';

    const linkInternal = createMockElement('a');
    linkInternal.setAttribute('href', '#blk_orig_t1');
    refBlock.appendChild(linkInternal);

    const linkExternal = createMockElement('a');
    linkExternal.setAttribute('href', '/notes/outside.node#blk_outside_xyz');
    refBlock.appendChild(linkExternal);

    // Sibling outside the section
    const outsideBlock = createMockElement('h2');
    outsideBlock.className = 'pisi-editor-block';
    outsideBlock.dataset.pisiBlockId = 'blk_outside_h2';
    outsideBlock.dataset.pisiBlockType = 'heading2';

    editor.append(heading, paragraph, task1, task2, rollup, refBlock, outsideBlock);

    // Setup heading section helper
    globalThis.getPisiHeadingSectionBlocks = (ed, h) => {
        if (h === heading) return [paragraph, task1, task2, rollup, refBlock];
        return [];
    };

    // Original IDs for intersection checking
    const originalBlockIds = new Set(['blk_orig_h2', 'blk_orig_p1', 'blk_orig_t1', 'blk_orig_t2', 'blk_orig_rollup', 'blk_orig_ref']);
    const originalTaskIds = new Set(['task_orig_1', 'task_orig_2']);

    // Execute duplicate
    const clonedHeading = duplicatePisiBlock(heading);
    assert.ok(clonedHeading, 'cloned heading must be returned');

    // Cloned blocks should be right after the last section block (refBlock) and before outsideBlock
    assert.ok(refBlock.nextElementSibling === clonedHeading, 'refBlock.nextElementSibling should be clonedHeading');

    const clonedParagraph = clonedHeading.nextElementSibling;
    const clonedTask1 = clonedParagraph.nextElementSibling;
    const clonedTask2 = clonedTask1.nextElementSibling;
    const clonedRollup = clonedTask2.nextElementSibling;
    const clonedRefBlock = clonedRollup.nextElementSibling;

    assert.ok(clonedParagraph && clonedTask1 && clonedTask2 && clonedRollup && clonedRefBlock);
    assert.ok(clonedRefBlock.nextElementSibling === outsideBlock, 'clonedRefBlock.nextElementSibling should be outsideBlock');

    const clonedBlockIds = new Set([
        clonedHeading.dataset.pisiBlockId,
        clonedParagraph.dataset.pisiBlockId,
        clonedTask1.dataset.pisiBlockId,
        clonedTask2.dataset.pisiBlockId,
        clonedRollup.dataset.pisiBlockId,
        clonedRefBlock.dataset.pisiBlockId
    ]);

    const clonedTaskIds = new Set([clonedTask1.dataset.pisiTaskId, clonedTask2.dataset.pisiTaskId]);

    // 1. Acceptance requirement: ZERO overlapping block IDs
    for (const id of clonedBlockIds) {
        assert.ok(!originalBlockIds.has(id), `Cloned block ID ${id} must not collide with original block IDs`);
    }
    assert.strictEqual(clonedBlockIds.size, 6, 'All cloned blocks must have distinct unique IDs');

    // 2. Acceptance requirement: ZERO overlapping task IDs
    for (const taskId of clonedTaskIds) {
        assert.ok(!originalTaskIds.has(taskId), `Cloned task ID ${taskId} must not collide with original task IDs`);
    }
    assert.strictEqual(clonedTaskIds.size, 2, 'All cloned tasks must have distinct unique task IDs');

    // 3. Child user tag shares the new task ID
    const clonedTag1 = clonedTask1.querySelector('.pisi-user-tag');
    assert.ok(clonedTag1);
    assert.strictEqual(clonedTag1.dataset.pisiTaskId, clonedTask1.dataset.pisiTaskId);

    // 4. Heading parent remapped to new cloned heading ID
    assert.strictEqual(clonedParagraph.dataset.pisiHeadingParent, clonedHeading.dataset.pisiBlockId);
    assert.strictEqual(clonedTask1.dataset.pisiHeadingParent, clonedHeading.dataset.pisiBlockId);

    // 5. Task dependency remapped internally, external preserved
    const expectedDependency = `dep:${clonedTask1.dataset.pisiTaskId}|task_external_999`;
    assert.strictEqual(clonedTask2.dataset.pisiTodoParent, expectedDependency);

    // 6. Rollup target remapped to new cloned task 1 block ID
    assert.strictEqual(clonedRollup.dataset.pisiRollupTarget, clonedTask1.dataset.pisiBlockId);

    // 7. Block ref attribute remapped
    assert.strictEqual(clonedRefBlock.dataset.pisiBlockRef, clonedHeading.dataset.pisiBlockId);

    // 8. Internal link remapped, external link preserved
    const links = clonedRefBlock.querySelectorAll('a');
    const clonedInternalLink = links[0];
    const clonedExternalLink = links[1];
    assert.ok(clonedInternalLink);
    assert.strictEqual(clonedInternalLink.getAttribute('href'), `#${clonedTask1.dataset.pisiBlockId}`);
    assert.ok(clonedExternalLink);
    assert.strictEqual(clonedExternalLink.getAttribute('href'), '/notes/outside.node#blk_outside_xyz');

    // 9. Task markers hydrated and interactive
    const clonedMarker1 = clonedTask1.querySelector('.pisi-block-task-marker');
    assert.ok(clonedMarker1);
    clonedMarker1.dispatchEvent(new globalThis.Event('click'));
    assert.strictEqual(clonedMarker1.getAttribute('aria-checked'), 'true');
    assert.strictEqual(clonedMarker1.textContent, '☑');

    // 10. Original section blocks remained completely unmodified
    assert.strictEqual(heading.dataset.pisiBlockId, 'blk_orig_h2');
    assert.strictEqual(task1.dataset.pisiTaskId, 'task_orig_1');
    assert.strictEqual(task2.dataset.pisiTodoParent, 'dep:task_orig_1|task_external_999');
    assert.strictEqual(rollup.dataset.pisiRollupTarget, 'blk_orig_t1');
});

test('Acceptance test B1: duplicating container with deeply nested blocks and tasks regenerates nested IDs and remaps rollup targets', async () => {
    const { duplicatePisiBlock } = await getBlockEditor();

    const editor = createMockElement('div');
    editor.className = 'pisi-rich-editor';

    // Container block with nested child blocks
    const container = createMockElement('div');
    container.className = 'pisi-editor-block pisi-column-block';
    container.dataset.pisiBlockId = 'blk_container_orig';

    const child1 = createMockElement('div');
    child1.className = 'pisi-editor-block';
    child1.dataset.pisiBlockId = 'blk_child_nested_1';
    child1.dataset.pisiTaskId = 'task_nested_orig_1';

    const child2 = createMockElement('div');
    child2.className = 'pisi-editor-block pisi-rollup-block';
    child2.dataset.pisiBlockId = 'blk_child_nested_2';
    child2.dataset.pisiRollupTarget = 'blk_child_nested_1';
    child2.dataset.pisiTodoParent = 'dep:task_nested_orig_1';

    container.append(child1, child2);
    editor.append(container);

    globalThis.getPisiHeadingSectionBlocks = () => [];
    globalThis.getPisiBulletDescendants = () => [];

    const clonedContainer = duplicatePisiBlock(container);
    assert.ok(clonedContainer);
    assert.notStrictEqual(clonedContainer.dataset.pisiBlockId, container.dataset.pisiBlockId);

    const clonedChild1 = clonedContainer.querySelector('[data-pisi-block-type], .pisi-editor-block');
    assert.ok(clonedChild1);
    const clonedChild2 = clonedChild1.nextElementSibling;
    assert.ok(clonedChild2);

    // Distinct block IDs
    assert.notStrictEqual(clonedChild1.dataset.pisiBlockId, child1.dataset.pisiBlockId);
    assert.notStrictEqual(clonedChild2.dataset.pisiBlockId, child2.dataset.pisiBlockId);

    // Distinct task IDs
    assert.notStrictEqual(clonedChild1.dataset.pisiTaskId, child1.dataset.pisiTaskId);

    // Rollup target remapped to new child 1 ID
    assert.strictEqual(clonedChild2.dataset.pisiRollupTarget, clonedChild1.dataset.pisiBlockId);

    // Task parent dependency remapped to new task ID
    assert.strictEqual(clonedChild2.dataset.pisiTodoParent, `dep:${clonedChild1.dataset.pisiTaskId}`);
});

test('Acceptance test B1: duplicating single paragraph block works smoothly without children or section', async () => {
    const { duplicatePisiBlock } = await getBlockEditor();

    const editor = createMockElement('div');
    editor.className = 'pisi-rich-editor';

    const p = createMockElement('div');
    p.className = 'pisi-editor-block';
    p.dataset.pisiBlockId = 'blk_single_p';
    p.dataset.pisiBlockType = 'paragraph';
    p.textContent = 'Tekil paragraf';

    editor.append(p);

    globalThis.getPisiHeadingSectionBlocks = () => [];
    globalThis.getPisiBulletDescendants = () => [];

    const cloned = duplicatePisiBlock(p);
    assert.ok(cloned);
    assert.notStrictEqual(cloned.dataset.pisiBlockId, p.dataset.pisiBlockId);
    assert.ok(p.nextElementSibling === cloned, 'p.nextElementSibling should be cloned');
    assert.strictEqual(cloned.textContent, 'Tekil paragraf');
});
