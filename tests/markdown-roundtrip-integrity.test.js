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
    if (!selector || !element || element.nodeType !== 1) return false;
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

function parseHtmlIntoMockElement(html) {
    const root = createMockElement('div');
    const stack = [root];
    const tagRegex = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9_-]+)((?:\s+[^>]*?)?)\/?>|([^<]+)/g;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
        const [full, tagName, rawAttrs, text] = match;
        if (full.startsWith('<!--')) continue;
        if (text) {
            if (text) {
                const parent = stack[stack.length - 1];
                parent.appendChild({
                    nodeType: 3,
                    nodeValue: text,
                    get textContent() {
                        return this.nodeValue;
                    }
                });
            }
            continue;
        }
        if (full.startsWith('</')) {
            if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName.toLowerCase()) {
                stack.pop();
            }
            continue;
        }
        const el = createMockElement(tagName);
        if (rawAttrs) {
            const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
            let am;
            while ((am = attrRegex.exec(rawAttrs)) !== null) {
                const name = am[1];
                const val = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
                el.setAttribute(name, val);
            }
        }
        const parent = stack[stack.length - 1];
        parent.appendChild(el);
        const isSelfClosing = full.endsWith('/>') || ['br', 'hr', 'img', 'input', 'textarea'].includes(tagName.toLowerCase());
        if (!isSelfClosing) {
            stack.push(el);
        }
    }
    return root;
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
        style: {},
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
        _textContent: '',
        get textContent() {
            if (children.length) {
                return children.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
            }
            return this._textContent || '';
        },
        set textContent(val) {
            this._textContent = String(val || '');
            children.length = 0;
            if (this._textContent) {
                children.push({
                    nodeType: 3,
                    nodeValue: this._textContent,
                    get textContent() {
                        return this.nodeValue;
                    }
                });
            }
        },
        _innerHTML: '',
        get innerHTML() {
            return this._innerHTML;
        },
        set innerHTML(val) {
            this._innerHTML = String(val || '');
            children.length = 0;
            if (this._innerHTML) {
                const parsed = parseHtmlIntoMockElement(this._innerHTML);
                while (parsed.firstChild) {
                    this.appendChild(parsed.firstChild);
                }
            }
        },
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
        matches(selector) {
            return matchesSelector(this, selector);
        },
        querySelector(selector) {
            for (const child of children) {
                if (matchesSelector(child, selector)) return child;
                const found = child.querySelector?.(selector);
                if (found) return found;
            }
            return null;
        },
        querySelectorAll(selector) {
            const results = [];
            for (const child of children) {
                if (matchesSelector(child, selector)) results.push(child);
                if (child.querySelectorAll) results.push(...child.querySelectorAll(selector));
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

let loadedEditor = null;

async function getBlockEditor() {
    if (loadedEditor) return loadedEditor;
    globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 };
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.document = {
        readyState: 'complete',
        createElement: createMockElement,
        getElementById: () => null,
        addEventListener: () => {},
        dispatchEvent: () => true,
        body: createMockElement('body')
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

    loadedEditor = await import('../renderer/editor/pisi-block-editor.mjs');
    return loadedEditor;
}

test('Acceptance test B2: lossless round-trip of heading, task, rollup, bullet and reference metadata', async () => {
    const { pisiBlockHtmlToMarkdown, pisiBlockMarkdownToHtml } = await getBlockEditor();

    const editor = createMockElement('div');
    editor.className = 'pisi-rich-editor';

    // 1. Heading block
    const heading = createMockElement('h1');
    heading.className = 'pisi-editor-block';
    heading.dataset.pisiBlockId = 'blk_h1';
    heading.dataset.pisiBlockType = 'heading1';
    heading.textContent = 'Proje Planı';

    // 2. Child paragraph block
    const paragraph = createMockElement('div');
    paragraph.className = 'pisi-editor-block';
    paragraph.dataset.pisiBlockId = 'blk_p1';
    paragraph.dataset.pisiBlockType = 'paragraph';
    paragraph.dataset.pisiHeadingParent = 'blk_h1';
    paragraph.textContent = 'Proje detayları burada yer almaktadır.';

    // 3. Task 1: pending with user tag
    const task1 = createMockElement('div');
    task1.className = 'pisi-editor-block';
    task1.dataset.pisiBlockId = 'blk_t1';
    task1.dataset.pisiBlockType = 'task';
    task1.dataset.pisiTaskId = 'task_1';
    task1.dataset.pisiHeadingParent = 'blk_h1';

    const marker1 = createMockElement('span');
    marker1.className = 'pisi-block-task-marker';
    marker1.textContent = '☐';
    task1.appendChild(marker1);

    const tag1 = createMockElement('span');
    tag1.className = 'pisi-user-tag';
    tag1.dataset.pisiTag = 'todo.1.none';
    tag1.dataset.pisiTaskId = 'task_1';
    task1.appendChild(tag1);

    const task1Text = createMockElement('span');
    task1Text.textContent = 'İlk görev';
    task1.appendChild(task1Text);

    // 4. Task 2: completed with dependencies
    const task2 = createMockElement('div');
    task2.className = 'pisi-editor-block';
    task2.dataset.pisiBlockId = 'blk_t2';
    task2.dataset.pisiBlockType = 'task';
    task2.dataset.pisiTaskId = 'task_2';
    task2.dataset.pisiTodoParent = 'dep:task_1|ext_99';

    const marker2 = createMockElement('span');
    marker2.className = 'pisi-block-task-marker';
    marker2.textContent = '☑';
    task2.appendChild(marker2);

    const task2Text = createMockElement('span');
    task2Text.textContent = 'İkinci görev (tamamlandı)';
    task2.appendChild(task2Text);

    // 5. Rollup block
    const rollup = createMockElement('div');
    rollup.className = 'pisi-editor-block pisi-rollup-block';
    rollup.dataset.pisiBlockId = 'blk_r1';
    rollup.dataset.pisiBlockType = 'rollup';
    rollup.dataset.pisiRollupRelation = 'rel_tasks';
    rollup.dataset.pisiRollupTarget = 'blk_t1';
    rollup.dataset.pisiRollupAggregate = 'count';
    rollup.dataset.pisiHeadingParent = 'blk_h1';

    // 6. Bullet block with indentation and collapsed state
    const bullet = createMockElement('div');
    bullet.className = 'pisi-editor-block';
    bullet.dataset.pisiBlockId = 'blk_b1';
    bullet.dataset.pisiBlockType = 'bullet';
    bullet.dataset.pisiBulletIndent = '2';
    bullet.dataset.pisiBulletCollapsed = 'true';
    bullet.textContent = 'İç içe madde';

    // 7. Reference block with anchor link and external relative link
    const refBlock = createMockElement('div');
    refBlock.className = 'pisi-editor-block';
    refBlock.dataset.pisiBlockId = 'blk_ref1';
    refBlock.dataset.pisiBlockType = 'paragraph';
    refBlock.dataset.pisiBlockRef = 'blk_h1';

    const linkAnchor = createMockElement('a');
    linkAnchor.setAttribute('href', '#blk_h1');
    linkAnchor.textContent = 'Başlığa git';
    refBlock.appendChild(linkAnchor);

    const linkRelative = createMockElement('a');
    linkRelative.setAttribute('href', '/notes/outside.node#blk_outside_xyz');
    linkRelative.textContent = 'Dış not referansı';
    refBlock.appendChild(linkRelative);

    // 8. Code block
    const codeBlock = createMockElement('pre');
    codeBlock.className = 'pisi-editor-block';
    codeBlock.dataset.pisiBlockId = 'blk_c1';
    codeBlock.dataset.pisiBlockType = 'code';
    codeBlock.textContent = 'const a = 42;\nconsole.log(a);';

    editor.append(heading, paragraph, task1, task2, rollup, bullet, refBlock, codeBlock);

    // Step A: Convert HTML to Markdown
    const markdown = pisiBlockHtmlToMarkdown(editor);
    assert.ok(markdown, 'Markdown must be generated');

    // Verify metadata serialized in markdown comments
    assert.match(markdown, /# Proje Planı <!-- pisi:meta \{.*"id":"blk_h1".*\} -->/);
    assert.match(markdown, /<!-- pisi:meta \{.*"id":"blk_p1".*"headingParent":"blk_h1".*\} -->/);
    assert.match(markdown, /- \[ \] İlk görev <!-- pisi:meta \{.*"id":"blk_t1".*"taskId":"task_1".*"tag":"todo.1.none".*\} -->/);
    assert.match(
        markdown,
        /- \[x\] İkinci görev \(tamamlandı\) <!-- pisi:meta \{.*"id":"blk_t2".*"taskId":"task_2".*"todoParent":"dep:task_1\|ext_99".*\} -->/
    );
    assert.match(markdown, /\{\{pisi-rollup:rel_tasks:blk_t1:count\}\} <!-- pisi:meta \{.*"id":"blk_r1".*"headingParent":"blk_h1".*\} -->/);
    assert.match(markdown, /- İç içe madde <!-- pisi:meta \{.*"id":"blk_b1".*"indent":2.*"collapsed":true.*\} -->/);
    assert.match(markdown, /\[Başlığa git\]\(#blk_h1\)/, 'Anchor link must be preserved in markdown');
    assert.match(markdown, /\[Dış not referansı\]\(\/notes\/outside\.node#blk_outside_xyz\)/, 'Relative link must be preserved in markdown');

    // Step B: Convert Markdown back to HTML
    const restoredHtml = pisiBlockMarkdownToHtml(markdown);
    assert.ok(restoredHtml, 'Restored HTML must not be empty');

    const restoredEditor = createMockElement('div');
    restoredEditor.className = 'pisi-rich-editor';
    restoredEditor.innerHTML = restoredHtml;

    // Step C: Verify exact metadata preservation on all restored blocks
    const restoredHeading = restoredEditor.querySelector('h1[data-pisi-block-id="blk_h1"]');
    assert.ok(restoredHeading, 'Heading block ID blk_h1 must be preserved');
    assert.strictEqual(restoredHeading.dataset.pisiBlockType, 'heading1');
    assert.strictEqual(restoredHeading.textContent.trim(), 'Proje Planı');

    const restoredParagraph = restoredEditor.querySelector('[data-pisi-block-id="blk_p1"]');
    assert.ok(restoredParagraph, 'Paragraph block ID blk_p1 must be preserved');
    assert.strictEqual(restoredParagraph.dataset.pisiHeadingParent, 'blk_h1', 'Heading parent must be preserved');

    const restoredTask1 = restoredEditor.querySelector('[data-pisi-block-id="blk_t1"]');
    assert.ok(restoredTask1, 'Task 1 block ID blk_t1 must be preserved');
    assert.strictEqual(restoredTask1.dataset.pisiTaskId, 'task_1', 'Task ID task_1 must be preserved');
    assert.strictEqual(restoredTask1.dataset.pisiHeadingParent, 'blk_h1', 'Heading parent must be preserved');
    const restoredTag1 = restoredTask1.querySelector('.pisi-user-tag');
    assert.ok(restoredTag1, 'Task 1 user tag must be preserved');
    assert.strictEqual(restoredTag1.dataset.pisiTag, 'todo.1.none');
    assert.strictEqual(restoredTag1.dataset.pisiTaskId, 'task_1');

    const restoredTask2 = restoredEditor.querySelector('[data-pisi-block-id="blk_t2"]');
    assert.ok(restoredTask2, 'Task 2 block ID blk_t2 must be preserved');
    assert.strictEqual(restoredTask2.dataset.pisiTaskId, 'task_2', 'Task ID task_2 must be preserved');
    assert.strictEqual(restoredTask2.dataset.pisiTodoParent, 'dep:task_1|ext_99', 'Task todoParent dependency must be preserved');
    const restoredMarker2 = restoredTask2.querySelector('.pisi-block-task-marker');
    assert.ok(restoredMarker2);
    assert.strictEqual(restoredMarker2.textContent, '☑', 'Checked task marker state must be preserved');

    const restoredRollup = restoredEditor.querySelector('[data-pisi-block-id="blk_r1"]');
    assert.ok(restoredRollup, 'Rollup block ID blk_r1 must be preserved');
    assert.strictEqual(restoredRollup.dataset.pisiRollupRelation, 'rel_tasks');
    assert.strictEqual(restoredRollup.dataset.pisiRollupTarget, 'blk_t1');
    assert.strictEqual(restoredRollup.dataset.pisiRollupAggregate, 'count');
    assert.strictEqual(restoredRollup.dataset.pisiHeadingParent, 'blk_h1');

    const restoredBullet = restoredEditor.querySelector('[data-pisi-block-id="blk_b1"]');
    assert.ok(restoredBullet, 'Bullet block ID blk_b1 must be preserved');
    assert.strictEqual(restoredBullet.dataset.pisiBulletIndent, '2');
    assert.strictEqual(restoredBullet.dataset.pisiBulletCollapsed, 'true');

    const restoredRef = restoredEditor.querySelector('[data-pisi-block-id="blk_ref1"]');
    assert.ok(restoredRef, 'Reference block ID blk_ref1 must be preserved');
    assert.strictEqual(restoredRef.dataset.pisiBlockRef, 'blk_h1', 'Block ref attribute must be preserved');
    const links = restoredRef.querySelectorAll('a');
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].getAttribute('href'), '#blk_h1', 'Anchor link must be preserved in HTML');
    assert.strictEqual(links[1].getAttribute('href'), '/notes/outside.node#blk_outside_xyz', 'Relative link must be preserved in HTML');
});

test('Acceptance test B2: sanitizePisiBlockUrl allows anchor and relative links while blocking dangerous schemes', async () => {
    const { pisiBlockMarkdownToHtml } = await getBlockEditor();

    const md = [
        '[Link Anchor](#blk_anchor_123)',
        '[Link Root](/notes/root.node)',
        '[Link Relative](./sibling.node)',
        '[Link Web](https://antigravity.google.com)',
        '[Link Mail](mailto:team@example.com)',
        '[Link XSS](javascript:alert(1))',
        '[Link Data](data:text/html,<script>alert(1)</script>)'
    ].join('\n');

    const html = pisiBlockMarkdownToHtml(md);
    assert.match(html, /href="#blk_anchor_123"/, 'Anchor link must be allowed');
    assert.match(html, /href="\/notes\/root\.node"/, 'Root relative link must be allowed');
    assert.match(html, /href="\.\/sibling\.node"/, 'Relative sibling link must be allowed');
    assert.match(html, /href="https:\/\/antigravity\.google\.com"/, 'Https link must be allowed');
    assert.match(html, /href="mailto:team@example\.com"/, 'Mailto link must be allowed');
    assert.doesNotMatch(html, /href="javascript:/, 'JavaScript pseudo-protocol must be blocked');
    assert.doesNotMatch(html, /href="data:/, 'Data URI scheme must be blocked');
});

test('E3: Markdown source cannot overwrite Sheet or Canvas data', async () => {
    const { openPisiMarkdownSource, closePisiMarkdownSource, pisiBlocksEditorState } = await getBlockEditor();
    const editorWithSheet = createMockElement('div');
    editorWithSheet.className = 'pisi-rich-editor';
    const sheetBlock = createMockElement('div');
    sheetBlock.className = 'pisi-editor-block pisi-sheet-block';
    sheetBlock.dataset.pisiBlockId = 'blk_sheet_1';
    editorWithSheet.appendChild(sheetBlock);

    openPisiMarkdownSource(editorWithSheet);
    assert.strictEqual(pisiBlocksEditorState.sourceWarning.style.display, 'block');

    const applyBtn = pisiBlocksEditorState.sourceOverlay.querySelector('.pisi-apply-md');
    pisiBlocksEditorState.sourceTextarea.value = 'Yeni Markdown Metni';
    globalThis.window.confirm = () => true;
    applyBtn.dispatchEvent(new globalThis.Event('click'));
    assert.strictEqual(editorWithSheet.innerHTML, '', 'Special blocks must never be overwritten by Markdown');
    closePisiMarkdownSource();
});

test('E3: code fence metadata and section break block identities survive Markdown parsing', async () => {
    const { pisiBlockMarkdownToHtml } = await getBlockEditor();
    const source = [
        '```',
        'some code',
        '``` <!-- pisi:meta {"id":"blk_code_1"} -->',
        '<!-- pisi:section-end --> <!-- pisi:meta {"id":"blk_section_1"} -->'
    ].join('\\n');
    const html = pisiBlockMarkdownToHtml(source);
    assert.match(html, /data-pisi-block-id="blk_code_1"/);
    assert.match(html, /data-pisi-block-id="blk_section_1"/);
});
