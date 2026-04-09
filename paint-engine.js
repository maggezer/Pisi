// ==========================================
// KEDI PAINT ENGINE (Kusursuz Sürüm)
// ==========================================

function initPaintEngine(boxEl) {
    const wrapper = boxEl.querySelector('.image-box-wrapper');
    if (!wrapper) return;

    // Eğer içerde zaten bir canvas varsa (dosyadan yüklendiyse) fırçaları bağla
    const existingCanvas = wrapper.querySelector('.draw-layer');
    if (existingCanvas) {
        setupImageTools(boxEl);
        return;
    }

    // Butonları bul
    const imgInput = boxEl.querySelector('.image-file-input');
    const blankBtn = boxEl.querySelector('.blank-canvas-btn');

    // 1. "Boş Tahta Aç" İşlemi
    if (blankBtn) {
        blankBtn.onclick = (e) => {
            e.stopPropagation();
            const w = wrapper.clientWidth > 50 ? wrapper.clientWidth : 600;
            const h = wrapper.clientHeight > 50 ? wrapper.clientHeight : 400;
            
            wrapper.innerHTML = `<canvas class="draw-layer" width="${w}" height="${h}" style="width:100%; height:100%; background:#fff;"></canvas>`;
            const canvas = wrapper.querySelector('.draw-layer');
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            
            setupImageTools(boxEl);
            if(window.triggerCanvasSave) window.triggerCanvasSave();
        };
    }

    // 2. "Resim Yükle" İşlemi
    if (imgInput) {
        imgInput.onchange = (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        wrapper.innerHTML = `<canvas class="draw-layer" width="${img.width}" height="${img.height}" style="width:100%; height:100%; background:#fff;"></canvas>`;
                        const canvas = wrapper.querySelector('.draw-layer');
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        
                        setupImageTools(boxEl);
                        if(window.triggerCanvasSave) window.triggerCanvasSave();
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        };
    }
}

function setupImageTools(boxEl) {
    const canvas = boxEl.querySelector('.draw-layer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Kayıtlı resmi yükleme (fs ve path window üzerinden)
    const savedFile = canvas.getAttribute('data-file');
    if (savedFile && !canvas.dataset.loaded) {
        canvas.dataset.loaded = "true";
        const filePath = window.path.join(window.currentHivePath, 'images', savedFile);
        if (window.fs.existsSync(filePath)) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            img.src = `data:image/png;base64,${window.fs.readFileSync(filePath, 'base64')}`;
        }
    }

    let isDrawing = false;
    let drawMode = false;
    const drawBtn = boxEl.querySelector('.draw-btn');
    const colorPicker = boxEl.querySelector('.color-picker');
    const brushSize = boxEl.querySelector('.brush-size');

    if (drawBtn) {
        drawBtn.onclick = (e) => {
            e.stopPropagation();
            drawMode = !drawMode;
            drawBtn.style.background = drawMode ? "#f39c12" : "transparent";
            drawBtn.style.color = drawMode ? "#000" : "#d4d4d4";
            canvas.style.cursor = drawMode ? "crosshair" : "default";
            canvas.style.pointerEvents = drawMode ? "auto" : "none";
        };
    }

    // Çizim Olayları
    canvas.onmousedown = (e) => {
        if (!drawMode) return;
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        ctx.beginPath();
        ctx.moveTo((e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height));
    };

    canvas.onmousemove = (e) => {
        if (!isDrawing || !drawMode) return;
        const rect = canvas.getBoundingClientRect();
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = brushSize.value;
        ctx.lineCap = "round";
        ctx.lineTo((e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height));
        ctx.stroke();
        canvas.setAttribute('data-modified', 'true');
    };

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            if(window.triggerCanvasSave) window.triggerCanvasSave();
        }
    });
}

// Global'e aç
window.initPaintEngine = initPaintEngine;