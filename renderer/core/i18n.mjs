const nativeAlert = window.alert.bind(window);
const nativeConfirm = window.confirm.bind(window);
const nativePrompt = window.prompt.bind(window);

function translatePisiUiText(value) {
    const source = String(value ?? '');
    return window.pisiI18n?.translate?.(source) ?? source;
}

window.pisiT = translatePisiUiText;
window.alert = (message) => nativeAlert(translatePisiUiText(message));
window.confirm = (message) => nativeConfirm(translatePisiUiText(message));
window.prompt = (message, defaultValue = '') => {
    return nativePrompt(translatePisiUiText(message), defaultValue);
};

window.pisiI18n?.ready?.().catch((error) => {
    console.error('[Pisi] Renderer localization bridge could not initialize:', error);
});

export { translatePisiUiText };
