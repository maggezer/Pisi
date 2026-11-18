import { registerModule } from '../core/module-registry.mjs';

// Settings → Senkron (docs/sync-plan.md S3 step 3). Not bound: open a new space
// with the server address and setup key, or join another desktop's project with
// a pairing code (an empty project only). Bound: status (last sync, offline,
// error), "Şimdi eşitle", pairing, devices and revoking them, the conflict log
// and the files that are not synced. While a large turn runs (the first upload,
// S6) a progress line shows files and bytes, and "Durdur" stops the turn and
// pauses automatic syncing until "Sürdür" (or "Şimdi eşitle"). After SERVER_ROLLBACK
// "Sunucuyla yeniden eşleş" starts over from the server's heads. Remote changes that
// failed verification (SV9) are listed with the files that are not synced. The last
// desktop leaving a space is asked whether to delete it (the phones on it stop).
// Everything goes through window.pisiSyncClient; the renderer never sees the token or the project key.

const pisiSyncPanelState = { initialized: false, joinTimer: null, section: null };

// Messages for the codes of docs/sync-protocol.md §9 and the client's own codes.
const PISI_SYNC_CODE_MESSAGES = Object.freeze({
    OFFLINE: 'Sunucuya ulaşılamıyor; senkron sonra yeniden denenecek.',
    BAD_SERVER_URL: 'Sunucu adresi https:// ile başlamalı.',
    SETUP_KEY_INVALID: 'Kurulum anahtarı yanlış.',
    RATE_LIMITED: 'Çok fazla istek; biraz sonra yeniden deneyin.',
    DEVICE_REVOKED: 'Bu cihazın bağlantısı iptal edildi. Proje dosyaları yerinde duruyor; yeniden eşleşebilirsiniz.',
    TOKEN_INVALID: 'Sunucu bu cihazı tanımıyor. Bağlantıyı kaldırıp yeniden eşleşin.',
    SERVER_ROLLBACK:
        'Sunucu daha eski bir duruma dönmüş görünüyor; senkron durduruldu ve hiçbir şey yazılmadı. "Sunucuyla yeniden eşleş" ile devam edebilirsiniz.',
    NOT_STOPPED: 'Senkron durmamış; yeniden eşleşmeye gerek yok.',
    STATE_UNREADABLE: 'Senkron durumu okunamadı; bağlantıyı kaldırıp yeniden eşleşin.',
    SECRETS_UNREADABLE: 'Senkron anahtarı açılamadı; bağlantıyı kaldırıp yeniden eşleşin.',
    SECRET_STORAGE_UNAVAILABLE: 'Bu sistemde güvenli anahtar deposu yok; senkron kurulamaz.',
    SYNC_FOLDER_NOT_EMPTY: 'Var olan bir projeye yalnız boş bir proje klasöründen katılabilirsiniz.',
    ALREADY_CONFIGURED: 'Bu proje zaten bir senkron alanına bağlı.',
    PAIRING_NOT_FOUND: 'Kod bulunamadı ya da süresi doldu.',
    PAIRING_CODE_INVALID: 'Kod geçersiz.',
    PAIRING_EXPIRED: 'Eşleştirmenin süresi doldu.',
    PAIRING_REJECTED: 'Öbür masaüstü isteği reddetti.',
    PAIRING_LIMIT: 'Aynı anda en çok üç eşleştirme açık olabilir.',
    PAIRING_KEY_MISMATCH: 'Eşleştirme anahtarı tutmadı; işlem durduruldu.',
    FORBIDDEN_ROLE: 'Bu cihaz bu işlemi yapamaz.',
    QUOTA_EXCEEDED: 'Sunucudaki alan doldu.',
    PROTOCOL_UNSUPPORTED: 'Sunucunun protokol sürümü bu uygulamayla uyumlu değil.',
    MAINTENANCE: 'Sunucu bakımda; biraz sonra yeniden deneyin.',
    DB_UNAVAILABLE: 'Sunucunun veritabanına ulaşılamıyor.',
    FLUSH_TIMEOUT: 'Açık belgeler kaydedilemedi; tur ertelendi.',
    FLUSH_FAILED: 'Açık belgeler kaydedilemedi; tur ertelendi.',
    LAST_ADMIN: 'Son masaüstü kendini iptal edemez.',
    CANCELLED: 'Senkron durduruldu; "Sürdür" ile kaldığı yerden devam eder.',
    PAUSED: 'Senkron duraklatıldı; "Sürdür" ile devam eder.',
    NOT_CONFIGURED: 'Proje senkrona bağlı değil.'
});

function pisiSyncPanelTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

/** The user's text for a sync code. */
function describePisiSyncCode(code) {
    return pisiSyncPanelTranslate(PISI_SYNC_CODE_MESSAGES[code] || 'Senkron başarısız oldu.');
}

const PISI_SYNC_ISSUE_LABELS = Object.freeze({
    FILE_TOO_LARGE: 'çok büyük',
    PATH_UNSAFE: 'adı ya da yeri senkron edilemez',
    PATH_COLLISION: 'yalnız büyük-küçük harfle ayrılan başka bir dosya var',
    LOCAL_CORRUPT: 'JSON bozuk; ne gönderildi ne değiştirildi',
    DEFERRED_DIRTY: 'kaydedilmemiş değişiklik var; sonra eşitlenecek',
    // Remote changes that were not applied (SV9).
    DECRYPT_FAILED: 'sunucudaki sürüm çözülemedi; uygulanmadı',
    HASH_MISMATCH_LOCAL: 'sunucudaki sürüm özetiyle tutmuyor; uygulanmadı',
    META_INVALID: 'sunucudaki kayıt geçersiz; uygulanmadı',
    PROTOCOL_UNSUPPORTED: 'daha yeni bir Pisi sürümü gerekiyor; uygulanmadı',
    SERVER_REPLAY: 'sunucu eski bir değişikliği yeniden gönderdi; uygulanmadı',
    BLOB_NOT_FOUND: 'sunucuda içeriği bulunamadı; uygulanmadı'
});

function formatPisiSyncClientTime(value) {
    if (!value) return pisiSyncPanelTranslate('Henüz eşitlenmedi');
    return new Date(value).toLocaleString(window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-US' : 'tr-TR');
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = pisiSyncPanelTranslate(text);
    return node;
}

function button(label, action) {
    const node = element('button', 'pisi-secondary-button', label);
    node.type = 'button';
    node.dataset.pisiSyncAction = action;
    return node;
}

function field(label, name, type = 'text') {
    const wrapper = element('label', 'pisi-sync-field');
    const caption = element('span', '', label);
    const input = element('input');
    input.type = type;
    input.name = name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.pisiSyncField = name;
    wrapper.append(caption, input);
    return wrapper;
}

function renderPisiSyncSetup(body, status) {
    const intro = element(
        'p',
        'pisi-sync-muted',
        'Projeyi kendi Pisi senkron sunucunuz üzerinden telefonunuz ve öteki bilgisayarlarınızla eşitleyin. İçerik uçtan uca şifrelenir; sunucu dosya adlarını ve içeriği görmez.'
    );
    body.append(intro);
    if (status.weakSecrets) body.append(element('p', 'pisi-sync-warning', 'Bu sistemde anahtarlık yok; senkron anahtarı yalnız zayıf biçimde korunabilir.'));
    const create = element('form', 'pisi-sync-form');
    create.dataset.pisiSyncForm = 'create';
    create.append(
        element('h3', '', 'Yeni senkron alanı aç'),
        field('Sunucu adresi', 'serverUrl', 'url'),
        field('Kurulum anahtarı', 'setupKey', 'password'),
        button('Alan aç ve projeyi yükle', 'create')
    );
    const join = element('form', 'pisi-sync-form');
    join.dataset.pisiSyncForm = 'join';
    const joinSas = element('p', 'pisi-sync-sas');
    joinSas.dataset.pisiSyncJoinSas = '';
    joinSas.hidden = true;
    join.append(
        element('h3', '', 'Başka bir masaüstündeki projeye katıl'),
        element('p', 'pisi-sync-muted', 'Yalnız boş bir proje klasöründe. Öbür masaüstünde Ayarlar → Senkron → "Cihaz eşleştir" ile kodu alın.'),
        field('Sunucu adresi', 'serverUrl', 'url'),
        field('Eşleştirme kodu', 'code'),
        button('Katıl', 'join'),
        joinSas
    );
    body.append(create, join);
    for (const form of [create, join]) form.addEventListener('submit', (event) => event.preventDefault());
    create.querySelector('[data-pisi-sync-action="create"]').addEventListener('click', async (event) => {
        const trigger = event.currentTarget;
        const values = Object.fromEntries(new FormData(create));
        trigger.disabled = true;
        const result = await window.pisiSyncClient.createSpace(values);
        trigger.disabled = false;
        if (!result?.ok) return pisiNotifyError(describePisiSyncCode(result?.code), { detail: result?.code || '' });
        pisiNotifySuccess(pisiSyncPanelTranslate('Senkron alanı açıldı; proje yükleniyor.'));
        void refreshPisiSyncPanel();
    });
    join.querySelector('[data-pisi-sync-action="join"]').addEventListener('click', async (event) => {
        const trigger = event.currentTarget;
        const values = Object.fromEntries(new FormData(join));
        trigger.disabled = true;
        const result = await window.pisiSyncClient.joinSpace(values);
        if (!result?.ok) {
            trigger.disabled = false;
            return pisiNotifyError(describePisiSyncCode(result?.code), { detail: result?.code || '' });
        }
        joinSas.hidden = false;
        joinSas.textContent = `${pisiSyncPanelTranslate('Doğrulama numarası')}: ${result.sas} — ${pisiSyncPanelTranslate('öbür masaüstünde de bu sayı görünüyorsa orada "Aynı" deyin.')}`;
        pollPisiSyncJoin(result.joinId, trigger);
    });
}

function pollPisiSyncJoin(joinId, trigger) {
    clearTimeout(pisiSyncPanelState.joinTimer);
    pisiSyncPanelState.joinTimer = setTimeout(async () => {
        const result = await window.pisiSyncClient.joinStatus(joinId);
        if (result?.ok && result.state === 'granted') {
            pisiNotifySuccess(pisiSyncPanelTranslate('Projeye katıldınız; dosyalar iniyor.'));
            void refreshPisiSyncPanel();
            return;
        }
        if (!result?.ok) {
            if (trigger) trigger.disabled = false;
            pisiNotifyError(describePisiSyncCode(result?.code), { detail: result?.code || '' });
            void refreshPisiSyncPanel();
            return;
        }
        pollPisiSyncJoin(joinId, trigger);
    }, 2000);
}

/** "1.234 / 2.400 dosya · 85,2 / 210,0 MB" for a turn's progress (S6). */
function formatPisiSyncProgress(progress) {
    const locale = window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-US' : 'tr-TR';
    const number = (value) => new Intl.NumberFormat(locale).format(value);
    const megabytes = (value) => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / (1024 * 1024));
    const phase = pisiSyncPanelTranslate(progress.phase === 'upload' ? 'Yükleniyor' : 'İniyor');
    const files = `${number(progress.files.done)} / ${number(progress.files.total)} ${pisiSyncPanelTranslate('dosya')}`;
    const bytes = progress.bytes.total ? ` · ${megabytes(progress.bytes.done)} / ${megabytes(progress.bytes.total)} MB` : '';
    return `${phase}: ${files}${bytes}`;
}

/** The progress line and "Durdur" follow the running turn without drawing the panel again. */
function updatePisiSyncProgress(payload) {
    const section = pisiSyncPanelState.section;
    const line = section?.querySelector('[data-pisi-sync-progress]');
    const stop = section?.querySelector('[data-pisi-sync-action="cancel"]');
    if (!line) return;
    const progress = payload.running ? payload.progress : null;
    line.hidden = !progress;
    if (progress) {
        line.textContent = formatPisiSyncProgress(progress);
        const bar = section.querySelector('[data-pisi-sync-progress-bar]');
        if (bar) {
            bar.hidden = false;
            bar.max = progress.files.total || 1;
            bar.value = progress.files.done;
        }
    }
    if (stop) stop.hidden = !payload.running;
}

function describePisiSyncState(status) {
    if (status.stopped) return describePisiSyncCode(status.stopped);
    if (status.paused && !status.running) return describePisiSyncCode('PAUSED');
    if (status.running) return pisiSyncPanelTranslate('Eşitleniyor…');
    const last = status.lastResult;
    if (last && !last.ok) return last.code === 'OFFLINE' ? pisiSyncPanelTranslate('Çevrimdışı') : describePisiSyncCode(last.code);
    return `${pisiSyncPanelTranslate('Son senkron')}: ${formatPisiSyncClientTime(status.lastRun?.at)}`;
}

async function renderPisiSyncDevices(list) {
    const result = await window.pisiSyncClient.devices();
    list.replaceChildren();
    for (const device of result?.devices || []) {
        const item = element('li', 'pisi-sync-row');
        const text = element('span', '');
        const role = device.role === 'admin' ? 'masaüstü' : 'telefon';
        const parts = [device.name || pisiSyncPanelTranslate('Adsız cihaz'), pisiSyncPanelTranslate(role)];
        if (device.self) parts.push(pisiSyncPanelTranslate('bu cihaz'));
        if (device.revokedAt) parts.push(pisiSyncPanelTranslate('iptal edildi'));
        else if (device.lastSeenAt) parts.push(`${pisiSyncPanelTranslate('son görülme')} ${formatPisiSyncClientTime(device.lastSeenAt)}`);
        text.textContent = parts.join(' · ');
        item.append(text);
        if (!device.self && !device.revokedAt) {
            const revoke = button('İptal et', 'revoke');
            revoke.addEventListener('click', async () => {
                const confirmed = await pisiConfirm(pisiSyncPanelTranslate('Bu cihazın senkron bağlantısı iptal edilsin mi? Cihazdaki dosyalar silinmez.'), {
                    title: pisiSyncPanelTranslate('Cihazı iptal et'),
                    confirmText: pisiSyncPanelTranslate('İptal et'),
                    danger: true
                });
                if (!confirmed) return;
                const revoked = await window.pisiSyncClient.revokeDevice(device.deviceId);
                if (!revoked?.ok) pisiNotifyError(describePisiSyncCode(revoked?.code));
                void renderPisiSyncDevices(list);
            });
            item.append(revoke);
        }
        list.append(item);
    }
    if (!list.children.length) list.append(element('li', 'pisi-sync-muted', 'Cihaz listesi yalnız masaüstünde görünür.'));
}

async function renderPisiSyncLogs(conflictList, unsyncedList) {
    const [conflicts, unsynced] = await Promise.all([window.pisiSyncClient.conflicts(), window.pisiSyncClient.unsynced()]);
    conflictList.replaceChildren();
    for (const entry of (conflicts?.conflicts || []).slice(0, 30)) {
        const what =
            entry.kind === 'copy'
                ? `${pisiSyncPanelTranslate('çakışma kopyası')}: ${entry.copyPath}`
                : `${pisiSyncPanelTranslate('alan')}: ${entry.field || entry.recordId || '—'}`;
        conflictList.append(element('li', 'pisi-sync-row', `${formatPisiSyncClientTime(entry.at)} · ${entry.path} · ${what}`));
    }
    if (!conflictList.children.length) conflictList.append(element('li', 'pisi-sync-muted', 'Çakışma yok.'));
    unsyncedList.replaceChildren();
    for (const entry of unsynced?.files || []) {
        const name = entry.path || pisiSyncPanelTranslate('Adı okunamayan dosya');
        const row = element('li', 'pisi-sync-row', `${name} · ${pisiSyncPanelTranslate(PISI_SYNC_ISSUE_LABELS[entry.code] || entry.code)}`);
        if (entry.unapplied) row.dataset.pisiSyncUnapplied = entry.code;
        unsyncedList.append(row);
    }
    if (!unsyncedList.children.length) unsyncedList.append(element('li', 'pisi-sync-muted', 'Bütün dosyalar eşitleniyor.'));
}

function renderPisiSyncBound(body, status) {
    const summary = element('p', 'pisi-sync-summary');
    summary.textContent = `${pisiSyncPanelTranslate('Bağlı alan')}: ${status.spaceName || '—'} · ${pisiSyncPanelTranslate('Bu cihaz')}: ${status.deviceName || '—'}`;
    const state = element('p', status.stopped || status.lastResult?.ok === false ? 'pisi-sync-warning' : 'pisi-sync-muted');
    state.dataset.pisiSyncState = '';
    state.textContent = describePisiSyncState(status);
    const progress = element('p', 'pisi-sync-muted');
    progress.dataset.pisiSyncProgress = '';
    progress.hidden = true;
    const bar = element('progress', 'pisi-sync-progress');
    bar.dataset.pisiSyncProgressBar = '';
    bar.hidden = true;
    const actions = element('div', 'pisi-portable-actions');
    const run = button(status.paused ? 'Sürdür' : 'Şimdi eşitle', status.paused ? 'resume' : 'run');
    run.disabled = Boolean(status.stopped);
    const stop = button('Durdur', 'cancel');
    stop.hidden = !status.running;
    actions.append(run, stop);
    if (status.stopped === 'SERVER_ROLLBACK') actions.append(button('Sunucuyla yeniden eşleş', 'rejoin'));
    if (status.role === 'admin') actions.append(button('Cihaz eşleştir', 'pair'));
    actions.append(button('Bu cihazın bağlantısını kaldır', 'disconnect'));
    body.append(summary, state, progress, bar, actions);
    if (status.unapplied) {
        const notice = element('p', 'pisi-sync-warning');
        notice.dataset.pisiSyncUnappliedNotice = String(status.unapplied);
        notice.textContent = `${pisiSyncPanelTranslate('Sunucudan gelen ve doğrulanamayan değişiklikler uygulanmadı')}: ${status.unapplied}. ${pisiSyncPanelTranslate('Senkron bunları yeniden dener; "Şimdi eşitle" hemen dener.')}`;
        body.append(notice);
    }
    updatePisiSyncProgress(status);
    if (status.weakSecrets) body.append(element('p', 'pisi-sync-warning', 'Bu sistemde anahtarlık yok; senkron anahtarı yalnız zayıf biçimde korunabilir.'));

    const devices = element('ul', 'pisi-sync-list');
    const conflicts = element('ul', 'pisi-sync-list');
    const unsynced = element('ul', 'pisi-sync-list');
    if (status.role === 'admin') body.append(element('h3', '', 'Cihazlar'), devices);
    body.append(element('h3', '', 'Çakışma günlüğü'), conflicts, element('h3', '', 'Senkron edilmeyen dosyalar'), unsynced);
    if (status.role === 'admin') void renderPisiSyncDevices(devices);
    void renderPisiSyncLogs(conflicts, unsynced);

    stop.addEventListener('click', async () => {
        stop.disabled = true;
        await window.pisiSyncClient.cancel();
        void refreshPisiSyncPanel();
    });
    run.addEventListener('click', async () => {
        run.disabled = true;
        const result = await (status.paused ? window.pisiSyncClient.resume() : window.pisiSyncClient.run('manual'));
        run.disabled = false;
        if (!result?.ok && result?.code !== 'CANCELLED') pisiNotifyError(describePisiSyncCode(result?.code), { detail: result?.code || '' });
        void refreshPisiSyncPanel();
    });
    actions.querySelector('[data-pisi-sync-action="pair"]')?.addEventListener('click', () => void window.openPisiSyncPairingDialog?.());
    actions.querySelector('[data-pisi-sync-action="rejoin"]')?.addEventListener('click', () => void rejoinPisiSyncFromPanel());
    actions.querySelector('[data-pisi-sync-action="disconnect"]').addEventListener('click', async () => {
        const confirmed = await pisiConfirm(pisiSyncPanelTranslate('Bu proje senkrondan ayrılsın mı? Proje dosyaları yerinde kalır.'), {
            title: pisiSyncPanelTranslate('Bağlantıyı kaldır'),
            confirmText: pisiSyncPanelTranslate('Bağlantıyı kaldır'),
            danger: true
        });
        if (!confirmed) return;
        await disconnectPisiSyncFromPanel();
        void refreshPisiSyncPanel();
    });
}

/** "Sunucuyla yeniden eşleş" after SERVER_ROLLBACK, once the user agreed to what it does. */
async function rejoinPisiSyncFromPanel() {
    const confirmed = await pisiConfirm(
        pisiSyncPanelTranslate(
            'Bu proje sunucudaki bütün dosyalarla yeniden karşılaştırılır. Buradaki değişiklikler kaybolmaz; iki tarafta farklı değişen notlar çakışma kopyası olur. Sunucunun döndüğü yedekten sonra silinen dosyalar geri gelebilir. Öbür cihazlarda da "Sunucuyla yeniden eşleş" seçilmelidir.'
        ),
        { title: pisiSyncPanelTranslate('Sunucuyla yeniden eşleş'), confirmText: pisiSyncPanelTranslate('Yeniden eşleş') }
    );
    if (!confirmed) return;
    const result = await window.pisiSyncClient.rejoin();
    if (!result?.ok) pisiNotifyError(describePisiSyncCode(result?.code), { detail: result?.code || '' });
    else pisiNotifySuccess(pisiSyncPanelTranslate('Senkron sunucuyla yeniden eşleşti.'));
    void refreshPisiSyncPanel();
}

/**
 * Leaves sync. The last desktop of the space is asked again: leaving deletes the
 * space on the server and the phones on it stop syncing. When the server cannot
 * be reached, the binding is removed here only if the user says so.
 */
async function disconnectPisiSyncFromPanel() {
    let result = await window.pisiSyncClient.disconnect();
    if (result?.code === 'LAST_ADMIN') {
        const remove = await pisiConfirm(
            pisiSyncPanelTranslate(
                'Bu bilgisayar bu projenin senkron alanındaki son masaüstü. Ayrılırsa sunucudaki alan ve şifreli kopyası silinir; bağlı telefonlar senkronu bırakır ve bunu kullanıcıya söyler. Proje dosyaları bütün cihazlarda kalır.'
            ),
            {
                title: pisiSyncPanelTranslate('Senkron alanı silinsin mi?'),
                confirmText: pisiSyncPanelTranslate('Alanı sil ve ayrıl'),
                danger: true
            }
        );
        if (!remove) return;
        result = await window.pisiSyncClient.disconnect({ deleteSpace: true });
    }
    if (result && !result.ok) {
        const force = await pisiConfirm(
            `${describePisiSyncCode(result.code)} ${pisiSyncPanelTranslate('Bağlantı yalnız bu bilgisayarda kaldırılsın mı? Sunucudaki alan ve bağlı cihazlar olduğu gibi kalır.')}`,
            {
                title: pisiSyncPanelTranslate('Bağlantıyı kaldır'),
                confirmText: pisiSyncPanelTranslate('Yalnız burada kaldır'),
                danger: true
            }
        );
        if (!force) return;
        result = await window.pisiSyncClient.disconnect({ force: true });
    }
    if (result?.spaceDeleted) pisiNotifySuccess(pisiSyncPanelTranslate('Senkron alanı sunucudan silindi.'));
}

async function refreshPisiSyncPanel() {
    const section = pisiSyncPanelState.section;
    if (!section?.isConnected) return;
    const status = await window.pisiSyncClient.status();
    const body = section.querySelector('[data-pisi-sync-body]');
    body.replaceChildren();
    section.dataset.configured = status?.configured ? 'true' : 'false';
    if (!status?.ok || status.project === false) {
        body.append(element('p', 'pisi-sync-muted', 'Senkron için önce bir proje açın.'));
        return;
    }
    if (status.configured) renderPisiSyncBound(body, status);
    else renderPisiSyncSetup(body, status);
}

function renderPisiSyncPanel(container) {
    if (!container || !window.pisiSyncClient || container.querySelector('.pisi-sync-client-settings')) return;
    window.ensurePisiSyncStyles?.();
    const section = element('section', 'pisi-portable-section pisi-sync-client-settings');
    const body = element('div', 'pisi-sync-body');
    body.dataset.pisiSyncBody = '';
    section.append(element('h2', '', 'Senkron'), body);
    container.append(section);
    pisiSyncPanelState.section = section;
    void refreshPisiSyncPanel();
}

function initializePisiSyncPanel() {
    if (pisiSyncPanelState.initialized || !window.pisiSyncClient) return false;
    pisiSyncPanelState.initialized = true;
    document.addEventListener('pisi:render-settings-sections', (event) => renderPisiSyncPanel(event.detail?.container));
    document.addEventListener('pisi:sync-devices-changed', () => void refreshPisiSyncPanel());
    window.pisiSyncClient.onStatus((payload) => {
        const state = pisiSyncPanelState.section?.querySelector('[data-pisi-sync-state]');
        if (state && payload.running) state.textContent = pisiSyncPanelTranslate('Eşitleniyor…');
        updatePisiSyncProgress(payload);
        if (!payload.running) void refreshPisiSyncPanel();
    });
    return true;
}

const moduleApi = {
    pisiSyncPanelState,
    describePisiSyncCode,
    formatPisiSyncProgress,
    refreshPisiSyncPanel,
    rejoinPisiSyncFromPanel,
    disconnectPisiSyncFromPanel,
    renderPisiSyncPanel,
    initializePisiSyncPanel
};

registerModule('sync.panel', moduleApi);

initializePisiSyncPanel();
