// ==========================================
// KEDI TAKVİM MOTORU VE DOCK SİSTEMİ
// ==========================================

const calWidget = document.getElementById('calendar-widget');
let calNavData = { gregorian: moment(), hijri: moment(), lunar: { y: Lunar.fromDate(new Date()).getYear(), m: Lunar.fromDate(new Date()).getMonth() } };
let isDocked = false;

function saveCalendarState() {
    if (!calWidget) return;
    const state = {
        isOpen: calWidget.style.display === 'flex',
        left: calWidget.style.left,
        top: calWidget.style.top,
        docked: isDocked
    };
    localStorage.setItem('kedi_cal_state', JSON.stringify(state));
}

function applyDockState(dockStatus) {
    isDocked = dockStatus;
    const rightSidebar = document.getElementById('right-sidebar');
    const rightPlaceholder = document.getElementById('right-placeholder');
    const calDockBtn = document.getElementById('cal-dock');

    if (isDocked && rightSidebar) {
        calWidget.classList.add('docked');
        rightSidebar.appendChild(calWidget);
        if(rightPlaceholder) rightPlaceholder.style.display = 'none';
        if(calDockBtn) { calDockBtn.innerText = '📍'; calDockBtn.title = "Serbest Bırak"; }
        calWidget.style.display = 'flex'; // Sabitlendiğinde hep açık kalır
    } else {
        calWidget.classList.remove('docked');
        document.body.appendChild(calWidget);
        if(rightPlaceholder) rightPlaceholder.style.display = 'block';
        if(calDockBtn) { calDockBtn.innerText = '📌'; calDockBtn.title = "Sağ Panele Sabitle"; }
    }
}

function restoreCalendarState() {
    if (!calWidget) return;
    const savedStr = localStorage.getItem('kedi_cal_state');
    if (savedStr) {
        const state = JSON.parse(savedStr);
        if (state.left && state.top) {
            calWidget.style.left = state.left;
            calWidget.style.top = state.top;
            calWidget.style.right = 'auto';
        }
        
        if (state.docked) {
            applyDockState(true);
        } else if (state.isOpen) {
            calWidget.style.display = 'flex';
            try { renderCalendar(); } catch(e) { console.error(e); }
        } else {
            calWidget.style.display = 'none';
        }
    }
}

// TAKVİM OLUŞTURMA (RENDER)
function renderCalendar() {
    const calDays = document.getElementById('cal-days');
    if(!calDays) return;
    calDays.innerHTML = ''; 
    if (!currentHivePath) return; 
    
    const journalFolder = path.join(currentHivePath, 'Journals');
    let year, month, daysInMonth, firstDay, titleText, filePrefix; const today = new Date();

    if (currentCustomPlugin) {
        const state = customStates[currentCustomPlugin.id]; const pluginData = currentCustomPlugin.getRenderData(state);
        daysInMonth = pluginData.daysInMonth; firstDay = pluginData.firstDay; titleText = pluginData.title; year = pluginData.currentYear; month = pluginData.currentMonth; filePrefix = currentCustomPlugin.id;
    } else if (currentCalendarType === 'gregorian') {
        year = calNavData.gregorian.year(); month = calNavData.gregorian.month(); daysInMonth = calNavData.gregorian.daysInMonth();
        let fd = calNavData.gregorian.clone().startOf('month').day(); firstDay = fd === 0 ? 6 : fd - 1; 
        titleText = `${monthNames[month]} ${year}`; filePrefix = 'Miladi';
    } else if (currentCalendarType === 'hijri') {
        year = calNavData.hijri.iYear(); month = calNavData.hijri.iMonth(); daysInMonth = moment.iDaysInMonth(year, month);
        let fd = moment(`${year}/${month+1}/1`, 'iYYYY/iM/iD').day(); firstDay = fd === 0 ? 6 : fd - 1; 
        titleText = `${hijriMonthNames[month]} ${year}`; filePrefix = 'Hicri';
    } else if (currentCalendarType === 'lunar') {
        year = calNavData.lunar.y; month = calNavData.lunar.m; daysInMonth = LunarMonth.fromYm(year, month).getDayCount();
        let fd = Lunar.fromYmd(year, month, 1).getSolar().getWeek(); firstDay = fd === 0 ? 6 : fd - 1;
        let mText = month < 0 ? `Artık ${Math.abs(month)}. Ay` : `${month}. Ay`; titleText = `(Çin) ${mText} ${year}`; filePrefix = 'Cin';
    }

    const calTitle = document.getElementById('cal-title');
    if(calTitle) calTitle.innerText = titleText;
    
    for (let i = 0; i < firstDay; i++) { calDays.appendChild(Object.assign(document.createElement('div'), {className: 'cal-day empty'})); }

    for (let i = 1; i <= daysInMonth; i++) {
        const dayDiv = document.createElement('div'); dayDiv.className = 'cal-day'; dayDiv.innerText = i;
        if (currentCustomPlugin) { if (currentCustomPlugin.getRenderData(customStates[currentCustomPlugin.id]).isToday(i)) dayDiv.classList.add('today'); 
        } else if (currentCalendarType === 'gregorian') { if (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) dayDiv.classList.add('today'); 
        } else if (currentCalendarType === 'hijri') { const tH = moment(); if (i === tH.iDate() && month === tH.iMonth() && year === tH.iYear()) dayDiv.classList.add('today'); 
        } else if (currentCalendarType === 'lunar') { const tL = Lunar.fromDate(today); if (i === tL.getDay() && month === tL.getMonth() && year === tL.getYear()) dayDiv.classList.add('today'); }

        const mStr = String(Math.abs(month) + 1).padStart(2, '0'); const dStr = String(i).padStart(2, '0');
        const checkFileName = `${year}-${mStr}-${dStr}_${filePrefix}.md`; const checkFilePath = path.join(journalFolder, checkFileName);
        if (fs.existsSync(checkFilePath)) dayDiv.classList.add('has-note');

        dayDiv.addEventListener('click', () => {
            if (!fs.existsSync(journalFolder)) fs.mkdirSync(journalFolder);
            if (!fs.existsSync(checkFilePath)) { fs.writeFileSync(checkFilePath, `<h1>${i} ${titleText.split(' ')[0]} ${year} Günlüğü</h1>\n<br>`); }
            refreshFileList(); loadFileToEditor(checkFilePath, checkFileName); renderCalendar();
        });
        calDays.appendChild(dayDiv);
    }
}

// BAĞLAMALAR (EVENTS)
document.addEventListener('DOMContentLoaded', () => {
    restoreCalendarState();

    // Dock (Sabitle) Butonu
    const calDockBtn = document.getElementById('cal-dock');
    if (calDockBtn) {
        calDockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyDockState(!isDocked);
            saveCalendarState();
        });
    }

    // Aç/Kapat
    const toggleCalBtn = document.getElementById('toggleCalendarBtn');
    if (toggleCalBtn && calWidget) {
        toggleCalBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            if (isDocked) return; // Sabitliyken bu buton işlevsizdir
            if (calWidget.style.display === 'flex') {
                calWidget.style.display = 'none';
            } else {
                calWidget.style.display = 'flex';
                try { renderCalendar(); } catch (err) {}
            }
            saveCalendarState(); 
        });
    }

    // Kapatma Çarpısı
    const calCloseBtn = document.getElementById('cal-close');
    if(calCloseBtn && calWidget) {
        calCloseBtn.addEventListener('click', () => { 
            if (isDocked) applyDockState(false); // Sabitliyse önce serbest bırak
            calWidget.style.display = 'none'; 
            saveCalendarState(); 
        });
    }

    // Sürükle Bırak (Drag)
    let isDraggingCal = false; 
    let calOffsetX = 0, calOffsetY = 0;
    const calHeader = document.getElementById('cal-header');

    if (calHeader && calWidget) {
        calHeader.addEventListener('mousedown', (e) => {
            if (isDocked) return; // Sabitliyken sürüklenemez
            if(e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') return;
            isDraggingCal = true;
            const rect = calWidget.getBoundingClientRect();
            calOffsetX = e.clientX - rect.left;
            calOffsetY = e.clientY - rect.top;
            calWidget.style.right = 'auto'; 
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingCal || !calWidget) return;
        calWidget.style.left = (e.clientX - calOffsetX) + 'px';
        calWidget.style.top = (e.clientY - calOffsetY) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingCal) {
            isDraggingCal = false;
            saveCalendarState(); 
        }
    });

    // İleri / Geri Ay Geçişleri
    const calPrev = document.getElementById('cal-prev');
    if(calPrev) {
        calPrev.addEventListener('click', () => { 
            if (currentCustomPlugin) customStates[currentCustomPlugin.id] = currentCustomPlugin.prevMonth(customStates[currentCustomPlugin.id]);
            else if (currentCalendarType === 'gregorian') calNavData.gregorian.subtract(1, 'months');
            else if (currentCalendarType === 'hijri') calNavData.hijri.subtract(1, 'iMonth');
            else { let lm = LunarMonth.fromYm(calNavData.lunar.y, calNavData.lunar.m).next(-1); calNavData.lunar.y = lm.getYear(); calNavData.lunar.m = lm.getMonth(); }
            renderCalendar(); 
        });
    }

    const calNext = document.getElementById('cal-next');
    if(calNext) {
        calNext.addEventListener('click', () => { 
            if (currentCustomPlugin) customStates[currentCustomPlugin.id] = currentCustomPlugin.nextMonth(customStates[currentCustomPlugin.id]);
            else if (currentCalendarType === 'gregorian') calNavData.gregorian.add(1, 'months');
            else if (currentCalendarType === 'hijri') calNavData.hijri.add(1, 'iMonth');
            else { let lm = LunarMonth.fromYm(calNavData.lunar.y, calNavData.lunar.m).next(1); calNavData.lunar.y = lm.getYear(); calNavData.lunar.m = lm.getMonth(); }
            renderCalendar(); 
        });
    }
});

// Ayarlar değiştirildiğinde takvimi güncellemesi için bunu globale açıyoruz
window.renderCalendar = renderCalendar;