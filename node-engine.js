'use strict';

const boundBlocks = new WeakSet();

const NodeEngine = {
    createBlock(type = 'text', content = '') {
        const block = document.createElement('div');
        block.className = `kedi-block block-${type}`;
        block.setAttribute('data-type', type);
        
        const inner = document.createElement('div');
        inner.className = 'block-inner';
        inner.contentEditable = true;
        inner.innerHTML = window.sanitizeRichHtml ? window.sanitizeRichHtml(content || '') : '';
        if(!content) inner.setAttribute('placeholder', 'Bir şeyler yazın veya "/" ile komut verin...');
        
        const handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.textContent = '⠿';
        
        block.appendChild(handle);
        block.appendChild(inner);
        
        this.bindBlockEvents(block);
        return block;
    },

    bindBlockEvents(block) {
        if (!block || boundBlocks.has(block)) return;
        const inner = block.querySelector('.block-inner');
        if (!inner) return;
        boundBlocks.add(block);
        
        inner.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const newBlock = this.createBlock('text');
                block.parentNode.insertBefore(newBlock, block.nextSibling);
                newBlock.querySelector('.block-inner').focus();
            }
            
            if (e.key === 'Backspace' && inner.innerText.length === 0) {
                const prev = block.previousElementSibling;
                if (prev && prev.classList.contains('kedi-block')) {
                    e.preventDefault();
                    block.remove();
                    const prevInner = prev.querySelector('.block-inner');
                    prevInner.focus();
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(prevInner);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        });
    },

    bindContainer(container) {
        if (!container) return;
        container.querySelectorAll('.kedi-block').forEach((block) => this.bindBlockEvents(block));
    }
};

window.NodeEngine = NodeEngine;
