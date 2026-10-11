// Unhydrated sidecar references must never be silently replaced by empty editor state.
export function getUnresolvedPisiEditorAssets(content = '') {
    const missing = [];
    const source = String(content || '');
    for (const tag of source.match(/<canvas\b[^>]*>/gi) || []) {
        if (!/\sdata-pisi-canvas(?:\s|=|\/?>)/i.test(tag)) continue;
        const ref = tag.match(/\sdata-pisi-asset\s*=\s*["'](paint\/[a-f0-9]{64}\.png)["']/i);
        if (ref && !/\sdata-image\s*=\s*["']data:image\/png;base64,/i.test(tag)) missing.push(ref[1]);
    }
    for (const tag of source.match(/<table\b[^>]*>/gi) || []) {
        if (!/\sdata-pisi-sheet(?:\s|=|\/?>)/i.test(tag)) continue;
        const ref = tag.match(/\sdata-pisi-sheet-asset\s*=\s*["'](sheet\/[a-f0-9]{64}\.json)["']/i);
        if (ref && !/\sdata-pisi-sheet-model\s*=/i.test(tag)) missing.push(ref[1]);
    }
    return [...new Set(missing)].sort();
}

export function getPisiEditorAssetRecoveryWarning(content = '') {
    const references = getUnresolvedPisiEditorAssets(content);
    if (!references.length) return '';
    return (
        'Bu nottaki ' +
        references.length +
        ' Sheet/Canvas dosyası eksik veya bozuk. Veri kaybını önlemek için bu not kaydedilmeyecek. ' +
        'Dosyaları yedekten, Version History üzerinden veya senkronizasyon klasöründen kurtarın.\n\n' +
        references.join('\n')
    );
}
