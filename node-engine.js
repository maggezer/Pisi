// ==========================================
// KEDI NODE ENGINE (Blok Tabanlı Yapı)
// ==========================================

const NodeEngine = {
    // Yeni bir blok (paragraf, kod, başlık vb.) oluşturur
    createBlock(type = 'text', content = '') {
        const block = document.createElement('div');
        block.className = `kedi-block block-${type}`;
        block.setAttribute('data-type', type);
        
        // Blok içeriği (ContentEditable)
        const inner = document.createElement('div');
        inner.className = 'block-inner';
        inner.contentEditable = true;
        inner.innerHTML = content || '';
        if(!content) inner.setAttribute('placeholder', 'Bir şeyler yazın veya "/" ile komut verin...');
        
        // Sürükleme ve Blok Menüsü tutamacı (⠿)
        const handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.innerHTML = '⠿';
        
        block.appendChild(handle);
        block.appendChild(inner);
        
        this.bindBlockEvents(block);
        return block;
    },

    bindBlockEvents(block) {
        const inner = block.querySelector('.block-inner');
        
        inner.addEventListener('keydown', (e) => {
            // ENTER: Yeni blok oluştur
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const newBlock = this.createBlock('text');
                block.parentNode.insertBefore(newBlock, block.nextSibling);
                newBlock.querySelector('.block-inner').focus();
            }
            
            // BACKSPACE: Blok boşsa sil ve öncekine odaklan
            if (e.key === 'Backspace' && inner.innerText.length === 0) {
                const prev = block.previousSibling;
                if (prev && prev.classList.contains('kedi-block')) {
                    e.preventDefault();
                    block.remove();
                    const prevInner = prev.querySelector('.block-inner');
                    prevInner.focus();
                    // Cursor'ı metnin sonuna taşı
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(prevInner);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        });
    }
};

window.NodeEngine = NodeEngine;