import { safePisiPasteHref } from '../tags/pisi-paste-sanitize.mjs';

export function sanitizePisiEditorHtml(html = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');

    wrapper
        .querySelectorAll(
            '.pisi-sheet-section-header, ' +
                '.pisi-sheet-search-row, ' +
                '.pisi-sheet-search, ' +
                '.pisi-sheet-pagination, ' +
                '.pisi-sheet-drag-fill-handle, ' +
                '.pisi-canvas-section-header'
        )
        .forEach((element) => element.remove());

    wrapper.querySelectorAll('.pisi-composite-alignment-active').forEach((element) => {
        element.classList.remove('pisi-composite-alignment-active');
    });

    const allowedTags = new Set([
        'A',
        'B',
        'BLOCKQUOTE',
        'BR',
        'CANVAS',
        'CODE',
        'DIV',
        'EM',
        'FONT',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'I',
        'IMG',
        'LI',
        'OL',
        'P',
        'PRE',
        'S',
        'SPAN',
        'STRONG',
        'SUB',
        'SUP',
        'TABLE',
        'TBODY',
        'TD',
        'TH',
        'THEAD',
        'TR',
        'U',
        'UL'
    ]);
    const globallyAllowedAttributes = new Set([
        'class',
        'title',
        'contenteditable',
        'role',
        'tabindex',
        'aria-checked',
        'aria-hidden',
        'aria-label',
        'data-pisi-block-id',
        'data-pisi-block-type',
        'data-pisi-task-id',
        'data-pisi-todo-checkbox',
        'data-pisi-tag',
        'data-pisi-done-for',
        'data-pisi-diary-source',
        'data-pisi-diary-status',
        'data-pisi-diary-parent',
        'data-pisi-diary-node-path',
        'data-pisi-diary-block-id',
        'data-pisi-todo-status',
        'data-pisi-todo-for',
        'data-pisi-todo-parent',
        'data-pisi-todo-repeat',
        'data-pisi-todo-order',
        'data-pisi-todo-scheduled-at',
        'data-pisi-todo-deadline',
        'data-pisi-todo-reminder-at',
        'data-pisi-todo-duration-minutes',
        'data-pisi-todo-actual-minutes',
        'data-pisi-todo-completion-offset-days',
        'data-pisi-node-title',
        'data-pisi-rollup-relation',
        'data-pisi-rollup-target',
        'data-pisi-rollup-aggregate',
        'data-pisi-bullet-indent',
        'data-pisi-bullet-collapsed',
        'data-pisi-bullet-has-children',
        'data-pisi-section-break',
        'data-pisi-section-exit',
        'data-pisi-section-level',
        'data-pisi-heading-parent'
    ]);
    const allowedStyleProperties = new Set([
        'background-color',
        'color',
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'text-align',
        'text-decoration',
        '--pisi-bullet-indent'
    ]);

    wrapper.querySelectorAll('script, style, iframe, object, embed, link, meta, base, form, input, button').forEach((element) => element.remove());

    Array.from(wrapper.querySelectorAll('*')).forEach((element) => {
        if (!allowedTags.has(element.tagName)) {
            element.replaceWith(...Array.from(element.childNodes));
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = String(attribute.value || '');
            let allowed = globallyAllowedAttributes.has(name);

            if (name === 'style') {
                const safeDeclarations = value
                    .split(';')
                    .map((declaration) => declaration.trim())
                    .filter(Boolean)
                    .map((declaration) => {
                        const separatorIndex = declaration.indexOf(':');
                        if (separatorIndex < 1) return '';

                        const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
                        const propertyValue = declaration.slice(separatorIndex + 1).trim();

                        if (!allowedStyleProperties.has(property) || /url\s*\(|expression\s*\(|@import/i.test(propertyValue)) {
                            return '';
                        }

                        return `${property}: ${propertyValue}`;
                    })
                    .filter(Boolean);

                if (safeDeclarations.length) {
                    element.setAttribute('style', safeDeclarations.join('; '));
                } else {
                    element.removeAttribute('style');
                }
                return;
            }

            if (element.tagName === 'A' && name === 'href') {
                allowed = Boolean(safePisiPasteHref(value));
            }

            if (['TD', 'TH'].includes(element.tagName) && ['colspan', 'rowspan'].includes(name)) {
                allowed = /^\d{1,3}$/.test(value) && Number(value) > 0;
            }

            if (element.tagName === 'IMG') {
                if (name === 'src') {
                    allowed = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,|\.{0,2}\/?assets\/)/i.test(value);
                } else if (['alt', 'width', 'height'].includes(name)) {
                    allowed = true;
                }
            }

            if (element.tagName === 'FONT') {
                allowed = ['color', 'face', 'size'].includes(name);
            }

            if (element.tagName === 'DIV') {
                if (name === 'data-pisi-canvas-block') {
                    allowed = value === '1';
                } else if (name === 'data-pisi-canvas-title') {
                    allowed = value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
                } else if (name === 'data-pisi-canvas-collapsed') {
                    allowed = /^(?:0|1)$/.test(value);
                } else if (name === 'data-pisi-composite-align') {
                    allowed = /^(?:left|center|right)$/.test(value);
                }
            }

            if (element.tagName === 'CANVAS') {
                allowed = ['width', 'height', 'data-pisi-canvas', 'data-pisi-document-ink', 'data-pisi-asset', 'data-image'].includes(name);

                if (name === 'data-image') {
                    allowed = /^data:image\/png;base64,/i.test(value);
                }

                if (name === 'data-pisi-asset') {
                    allowed = /^paint\/[a-f0-9]{64}\.png$/i.test(value);
                }
            }

            if (['TABLE', 'TD'].includes(element.tagName)) {
                allowed = allowed || ['data-pisi-sheet', 'data-formula', 'data-cell', 'data-row', 'data-col'].includes(name);
            }

            if (element.tagName === 'TABLE') {
                if (name === 'data-pisi-database-id') {
                    allowed = /^database-[A-Za-z0-9_-]{8,160}$/.test(value);
                }

                if (name === 'data-pisi-sheet-asset') {
                    allowed = /^sheet\/[a-f0-9]{64}\.json$/i.test(value);
                }

                if (name === 'data-pisi-sheet-model') {
                    allowed = false;

                    if (value.length <= 64 * 1024 * 1024) {
                        try {
                            const snapshot = JSON.parse(value);
                            const validSnapshot = Boolean(
                                snapshot &&
                                typeof snapshot === 'object' &&
                                !Array.isArray(snapshot) &&
                                typeof snapshot.databaseId === 'string' &&
                                Array.isArray(snapshot.fields) &&
                                Array.isArray(snapshot.items) &&
                                Array.isArray(snapshot.views)
                            );

                            if (validSnapshot) {
                                element.setAttribute(attribute.name, JSON.stringify(snapshot));
                                allowed = true;
                            }
                        } catch {
                            allowed = false;
                        }
                    }
                }
            }

            if (['data-pisi-rollup-relation', 'data-pisi-rollup-target'].includes(name)) {
                allowed = allowed && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
            }

            if (name === 'data-pisi-rollup-aggregate') {
                allowed = /^(?:count|sum|average|min|max|unique|join)$/.test(value);
            }

            if (!allowed || name.startsWith('on')) {
                element.removeAttribute(attribute.name);
            }
        });

        if (element.hasAttribute('class')) {
            const safeClasses = Array.from(element.classList).filter((name) => {
                return /^pisi-[A-Za-z0-9_-]+$/.test(name);
            });
            element.className = safeClasses.join(' ');
        }

        if (element.tagName === 'CANVAS') {
            const isDocumentInk = element.hasAttribute('data-pisi-document-ink');
            const maxWidth = isDocumentInk ? 4096 : 1600;
            const maxHeight = isDocumentInk ? 4096 : 1200;
            const fallbackWidth = isDocumentInk ? 1 : 520;
            const fallbackHeight = isDocumentInk ? 1 : 320;
            const width = Math.min(maxWidth, Math.max(1, Number(element.getAttribute('width')) || fallbackWidth));
            const height = Math.min(maxHeight, Math.max(1, Number(element.getAttribute('height')) || fallbackHeight));

            element.setAttribute('width', String(width));
            element.setAttribute('height', String(height));

            if (isDocumentInk) {
                element.setAttribute('data-pisi-document-ink', '1');
                element.removeAttribute('data-pisi-canvas');
            } else {
                element.setAttribute('data-pisi-canvas', '1');
                element.removeAttribute('data-pisi-document-ink');
            }

            element.removeAttribute('data-pisi-canvas-bound');
            element.removeAttribute('data-image-loaded');
        }

        if (element.hasAttribute('contenteditable')) {
            const value = element.getAttribute('contenteditable');
            element.setAttribute('contenteditable', value === 'false' ? 'false' : 'true');
        }
    });

    return wrapper.innerHTML;
}
