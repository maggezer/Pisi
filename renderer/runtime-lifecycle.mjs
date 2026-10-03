// From app.js:143
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[PISI] Temiz arayüz yüklendi.');

    setupWindowControls();
    setupCenterFileTabs();
    bindRightPanelTabs();
    setupPisiCustomizations();
    setupPisiRichToolbars();

    bindPisiTagControls();
    bindPisiBlockIndexControls();

    await setupProjectStartup();

    if (typeof refreshPisiCalendarDates === 'function') {
        await refreshPisiCalendarDates();
    }
});
