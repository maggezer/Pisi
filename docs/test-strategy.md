# Test stratejisi

Bu belge testlerin nasıl yazılacağını ve kaynak kodu okuyan eski testlerin ne olacağını anlatır. Kural CLAUDE.md'deki "Definition of Done" ile aynıdır: yeni davranış için davranış testi yazılır, kaynak kodu regex ile okuyan yeni test yazılmaz.

## Katmanlar

| Katman               | Nerede                                             | Ne zaman                                                                                     |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Birim / saf modül    | `tests/*.test.mjs`, modülü doğrudan import eder    | `*-core.js`, `renderer/**/pisi-*-core.mjs` gibi Electron'suz modüller                        |
| Main store davranışı | `tests/*.test.js` + `tests/main-store-harness.cjs` | Kayıt, görev, ilişki, map ve Trash store'ları gerçek dosyalarla, geçici bir proje klasöründe |
| Electron E2E         | `scripts/electron-*-e2e.mjs` (CDP)                 | Kullanıcı akışları; Linux (xvfb) ve Windows'ta CI'da, macOS isteğe bağlı                     |
| Mimari kurallar      | `npm run check:*` ve aşağıdaki (a) grubu           | Kodun şekli gerçekten kural olduğunda                                                        |

`tests/main-store-harness.cjs`:

- main.mjs ile aynı sırayla depolama zincirini yükler: path security → dosya sistemi → document/task/relationship/map/Trash store'ları.
- Electron'u taklit eder.
- runtime.js'in sağladığı birkaç sabiti global olarak tanımlar.
- Yeni main davranış testleri bu yardımcıyı kullanmalıdır; `extractFunction` + `vm` ile fonksiyon kopyalamak yerine gerçek modül çağrılır.

## Kapsam

`npm run test:coverage`:

- Node'un yerleşik kapsam ölçümüyle birim testlerini koşar.
- `coverage/lcov.info` ve `coverage/summary.md` dosyalarını üretir.
- Coverage iş akışı özeti job summary'ye ve PR'daki tek bir yoruma yazar; yorum her push'ta güncellenir.
- Eşik yoktur.
- Yalnız testlerin yüklediği dosyalar ölçülür. E2E kapsamı dahil değildir.

## Kaynak okuyan testler

Envanter `node scripts/list-source-tests.mjs` ile alınır; `--json` ile makine okunur çıktı verir.

Bir test dosyası şu durumlarda kaynak okuyan sayılır:

- `readMainSource`, `readRendererSource`, `readCssSection` veya `extractFunction` kullanıyorsa;
- ya da depodaki bir kaynak dosyasını (`main/`, `renderer/`, `styles/`, `preload.js`, `index.html`, …) doğrudan okuyorsa.

2026-11-07 itibarıyla 208 test dosyasının 129'u kaynak okuyor (619 test, yaklaşık 2.870 regex doğrulaması). Bu sayılar envanter komutuyla yeniden üretilebilir.

### (a) Korunacak mimari kurallar (35 dosya)

Kodun şekli burada sözleşmenin kendisidir: güvenlik sınırları, sürüm ve paketleme yapılandırması, sözleşme kayıtları, yükleme sırası. Bu testler regex ile kalabilir. Yeni bir kural uygunsa `check:architecture`'a taşınır.

| Dosya                                         | Test | Regex | Yardımcı                           | Neden                                                   |
| --------------------------------------------- | ---: | ----: | ---------------------------------- | ------------------------------------------------------- |
| `atomic-mutation-contract.test.js`            |   10 |    29 | —                                  | atomik yazım sözleşmesi ve yükleme sırası               |
| `atomic-mutation.test.js`                     |   11 |    14 | —                                  | çoğu davranış; kaynak okuması yalnız sıra kuralı        |
| `atomic-recovery-hardening.test.js`           |    4 |     8 | —                                  | çoğu davranış; kaynak okuması yalnız bağlama kuralı     |
| `backup-directory.test.js`                    |    3 |     6 | —                                  | çoğu davranış; yol sınırı kuralı                        |
| `bundled-comic-neue-font.test.js`             |    1 |     6 | —                                  | paketlenen font ve lisans                               |
| `bundled-vincendo-font.test.js`               |    1 |     9 | —                                  | paketlenen font ve lisans                               |
| `canonical-only-projections.test.js`          |    5 |     3 | extractFunction                    | tek kaynak kuralı (projeksiyonlar otoriteye yazmaz)     |
| `core-storage-runtime-split.test.js`          |    2 |    17 | —                                  | modüller arası döngüsüz bağımlılık                      |
| `cross-platform-packaging-smoke.test.js`      |    2 |    15 | —                                  | paketleme yapılandırması                                |
| `css-consolidation.test.mjs`                  |    4 |     1 | —                                  | CSS giriş noktası ve bundle listesi                     |
| `dependency-audit-policy.test.js`             |    4 |     6 | —                                  | npm audit politikası                                    |
| `domain-command-query.test.js`                |   12 |    54 | extractFunction                    | sürümlü komut/sorgu sözleşmesi, bilinmeyen adlar kapalı |
| `electron-user-workflow-e2e-coverage.test.js` |    1 |     3 | —                                  | E2E kapsam listesi                                      |
| `formatter.test.js`                           |    3 |     4 | —                                  | Prettier ve CI biçim kapısı                             |
| `i18n.test.js`                                |    3 |    20 | —                                  | çeviri katmanının bağlanması                            |
| `macos-linux-release.test.js`                 |    5 |    25 | —                                  | sürüm iş akışı                                          |
| `map-state-semantic-separation.test.js`       |    7 |     6 | —                                  | map/ilişki otorite ayrımı                               |
| `portability-distribution.test.js`            |    4 |    22 | —                                  | dağıtım yapılandırması                                  |
| `project-integrity-contract.test.js`          |   14 |    56 | —                                  | bütünlük sözleşmesi                                     |
| `rebuildable-index-architecture.test.js`      |    3 |    17 | —                                  | yeniden kurulabilir indeks mimarisi                     |
| `search-document-delta-architecture.test.js`  |    4 |    19 | —                                  | arama delta mimarisi                                    |
| `security.test.js`                            |    3 |     0 | readMainSource, extractFunction    | Electron güvenlik sınırları                             |
| `source-invariants.test.js`                   |   11 |    43 | readMainSource, readRendererSource | güvenlik ve tekillik değişmezleri                       |
| `source-of-truth.test.js`                     |   10 |    74 | —                                  | tek kaynak mimarisi ve dokümanları                      |
| `storage-abstraction.test.js`                 |    4 |    12 | —                                  | depolama katmanı sınırı                                 |
| `storage-wave2-architecture.test.js`          |    4 |    13 | —                                  | depolama katmanı sınırı                                 |
| `system-fonts-license.test.js`                |    1 |    15 | —                                  | font lisansı                                            |
| `task-reference-integrity.test.js`            |    8 |    14 | —                                  | çoğu davranış; hook bağlama kuralı                      |
| `trash-domain-contract.test.js`               |    4 |    12 | —                                  | Trash komut sözleşmesi                                  |
| `version-history-cost.test.js`                |    8 |     8 | —                                  | çoğu davranış; saklama kuralı                           |
| `vincendo-default-font.test.js`               |    1 |     5 | —                                  | varsayılan font                                         |
| `windows-app-identity.test.js`                |    2 |     5 | —                                  | Windows uygulama kimliği                                |
| `windows-code-signing-release.test.js`        |    3 |    12 | —                                  | imzalama iş akışı                                       |
| `windows-rename-retry.test.js`                |    3 |     8 | —                                  | Windows kilit yeniden deneme kuralı                     |
| `windows-store-release.test.js`               |    4 |    29 | —                                  | Store iş akışı                                          |

### (b) Davranış testine çevrilecekler (94 dosya)

Bu testler arayüz veya iş mantığını kodun yazılış biçimi üzerinden doğruluyor. Bu yüzden yeniden düzenlemede bozuluyor ama gerçek hatayı kaçırıyor. Bir dosyaya dokunan PR, o dosyanın testini mümkünse davranış testine çevirir.

Öncelik sırası:

1. Veri kaybı riski: kayıt, görev, silme/geri yükleme.
2. Yarış durumları ve projeksiyonlar.
3. Görünüm ve stil.

| Dosya                                       | Test | Regex | Yardımcı                        | Öncelik                                                                      |
| ------------------------------------------- | ---: | ----: | ------------------------------- | ---------------------------------------------------------------------------- |
| `auto-update.test.js`                       |    5 |    25 | —                               | 3                                                                            |
| `bases-lite-dialog.test.js`                 |    4 |    30 | —                               | 3                                                                            |
| `bases-view-hardening.test.js`              |    6 |    28 | —                               | 3                                                                            |
| `calendar-light-dock-visibility.test.js`    |    3 |    11 | —                               | 3                                                                            |
| `calendar-links-layout.test.js`             |    3 |    20 | —                               | 3                                                                            |
| `calendar-task-indicators.test.js`          |    2 |    11 | —                               | 3                                                                            |
| `center-dynamic-divider.test.js`            |    0 |    11 | —                               | 3                                                                            |
| `composite-alignment-delete-race.test.js`   |    4 |    32 | —                               | 1 — ağaçtan silmeden önce bekleyen kayıt (E2E)                               |
| `data-integrity.test.js`                    |    9 |     5 | readMainSource, extractFunction | 1 — ilişki silme ve diary temizleyicileri `main-store-harness` ile           |
| `diary-task-integration.test.js`            |    7 |    36 | —                               | 2                                                                            |
| `document-ink.test.js`                      |    5 |    16 | —                               | 3                                                                            |
| `editor-autosave-race.test.mjs`             |    5 |     0 | extractFunction                 | 2 — extractFunction yerine modül importu                                     |
| `editor-command-authority.test.js`          |    9 |    46 | —                               | 3                                                                            |
| `editor-command-preference-scope.test.js`   |    4 |     4 | —                               | 3                                                                            |
| `editor-command-routing.test.js`            |    9 |    18 | —                               | 3                                                                            |
| `editor-history-restore.test.mjs`           |   11 |     3 | extractFunction                 | 2                                                                            |
| `editor-input-policy.test.mjs`              |    5 |     0 | extractFunction                 | 3                                                                            |
| `editor-navigation-race.test.mjs`           |   11 |     0 | extractFunction                 | 2 — extractFunction yerine modül importu                                     |
| `editor-recovery-departure.test.mjs`        |   11 |     0 | extractFunction                 | 2 — extractFunction yerine modül importu                                     |
| `editor-whitespace-internal-tree.test.mjs`  |    3 |     6 | —                               | 3                                                                            |
| `editor-word-behavior.test.js`              |   23 |   147 | —                               | 3                                                                            |
| `formula.test.js`                           |    3 |     0 | extractFunction                 | 3                                                                            |
| `interaction-regressions.test.js`           |    7 |    45 | —                               | 3                                                                            |
| `left-panel-interaction.test.js`            |    2 |     6 | —                               | 3                                                                            |
| `light-map-node-selection.test.js`          |    2 |     6 | readCssSection                  | 3                                                                            |
| `map-edge-menu.test.js`                     |    4 |    22 | —                               | 3                                                                            |
| `map-edge-selection-dismiss.test.js`        |    4 |     3 | —                               | 3                                                                            |
| `map-export.test.js`                        |    4 |    35 | —                               | 3                                                                            |
| `map-node-task-count-badge.test.js`         |    4 |    14 | —                               | 3                                                                            |
| `map-operational-layout-collapse.test.js`   |    2 |     5 | —                               | 3                                                                            |
| `map-operational.test.js`                   |   13 |    37 | —                               | 2                                                                            |
| `map-personalization.test.js`               |    5 |    44 | —                               | 3                                                                            |
| `map-preview.test.js`                       |    2 |     2 | —                               | 3                                                                            |
| `map-property-badge-portal.test.js`         |    3 |    17 | —                               | 3                                                                            |
| `map-property-badges.test.js`               |    8 |    41 | —                               | 3                                                                            |
| `map-scoped-filterable.test.js`             |   10 |    35 | —                               | 3                                                                            |
| `map-title-view-actions.test.js`            |    1 |     0 | —                               | 3                                                                            |
| `map-title-view-toggle.test.js`             |    1 |     0 | —                               | 3                                                                            |
| `markdown-source-toolbar.test.js`           |    2 |     5 | —                               | 3                                                                            |
| `mindmap-actions-single-row.test.js`        |    1 |     5 | —                               | 3                                                                            |
| `mindmap-filter-simplification.test.js`     |    3 |    20 | —                               | 3                                                                            |
| `mindmap-focus-menu.test.js`                |    4 |    26 | —                               | 3                                                                            |
| `mindmap-label-button.test.js`              |    3 |    15 | —                               | 3                                                                            |
| `mindmap-overlay-defaults-layout.test.js`   |    3 |    16 | —                               | 3                                                                            |
| `mindmap-relationship-menu.test.js`         |    4 |    11 | —                               | 3                                                                            |
| `mindmap-task-scope-retirement.test.js`     |    1 |    11 | —                               | 3                                                                            |
| `mindmap-toolbar-layout-source.test.js`     |    2 |     5 | —                               | 3                                                                            |
| `mindmap-tools-compact.test.js`             |    5 |    26 | —                               | 3                                                                            |
| `node-modal-close-style.test.js`            |    2 |     8 | —                               | 3                                                                            |
| `node-properties-surfaces.test.js`          |    3 |    31 | —                               | 3                                                                            |
| `node-task-block-navigation.test.js`        |    3 |    10 | —                               | 3                                                                            |
| `pisi-canvas-section-ui.test.mjs`           |    2 |    32 | —                               | 3                                                                            |
| `pisi-map-edge-delete-focus.test.js`        |    1 |     6 | —                               | 3                                                                            |
| `pisi-roadmap-integration.test.js`          |   13 |    79 | —                               | 3                                                                            |
| `pisi-search-integration.test.js`           |    8 |    48 | —                               | 3                                                                            |
| `pisi-sheet-bulk-clear.test.mjs`            |    4 |     0 | extractFunction                 | 3                                                                            |
| `pisi-sheet-view-selection.test.mjs`        |   11 |     0 | extractFunction                 | 3                                                                            |
| `pisi-todo-blocks.test.mjs`                 |    4 |    45 | —                               | 3                                                                            |
| `portability-canvas-export.test.js`         |   12 |    36 | extractFunction                 | 3                                                                            |
| `project-action-icons.test.js`              |    3 |    13 | —                               | 3                                                                            |
| `project-loading.test.js`                   |    6 |    16 | extractFunction                 | 1 — proje kilidi ve açılış; kısmen davranış                                  |
| `project-markdown-export.test.js`           |    4 |     0 | extractFunction                 | 3                                                                            |
| `property-map-context.test.js`              |    2 |    31 | —                               | 3                                                                            |
| `property-schema-stability.test.js`         |    7 |    29 | —                               | 3                                                                            |
| `property-templates-workspace.test.js`      |    3 |    27 | —                               | 3                                                                            |
| `property-types-simplification.test.js`     |    3 |    26 | —                               | 3                                                                            |
| `quick-add-repeat-policy.test.js`           |    1 |    16 | —                               | 3                                                                            |
| `right-panel-headings.test.js`              |    1 |     2 | —                               | 3                                                                            |
| `right-panel-icons.test.js`                 |    4 |    22 | —                               | 3                                                                            |
| `right-panel-inner-width.test.js`           |    1 |     2 | —                               | 3                                                                            |
| `right-panel-search.test.js`                |    6 |    37 | —                               | 3                                                                            |
| `right-panel-top-polish.test.js`            |    2 |     4 | —                               | 3                                                                            |
| `rollup-controls.test.js`                   |    5 |    27 | —                               | 3                                                                            |
| `run-electron-e2e.test.mjs`                 |    1 |     0 | —                               | 3                                                                            |
| `sheet-overhaul.test.js`                    |    5 |   378 | —                               | 3                                                                            |
| `task-projection-write-through.test.js`     |    5 |     0 | —                               | 2                                                                            |
| `task-reference-operation-hooks.test.js`    |    3 |    14 | —                               | 1 — yeniden adlandırma/taşıma sonrası görev referansları                     |
| `task-source-visibility.test.js`            |    5 |     0 | extractFunction                 | 3                                                                            |
| `theme-preferences.test.js`                 |    8 |    38 | —                               | 3                                                                            |
| `todo-dedicated-workspace.test.js`          |    8 |    57 | readCssSection                  | 3                                                                            |
| `todo-navigation-filter-regression.test.js` |    2 |     9 | —                               | 3                                                                            |
| `todo-panel-sync.test.js`                   |    6 |    32 | —                               | 2                                                                            |
| `todo-priority-card-display.test.js`        |    0 |    25 | —                               | 3                                                                            |
| `todo-quick-add-modal.test.js`              |    6 |    44 | —                               | 3                                                                            |
| `todo-second-release.test.js`               |    6 |    29 | —                               | 3                                                                            |
| `todo-tag.test.js`                          |    9 |    33 | —                               | 3                                                                            |
| `todo-third-release.test.js`                |    5 |    29 | —                               | 3                                                                            |
| `toolbar-icons.test.js`                     |    3 |    16 | —                               | 3                                                                            |
| `toolbar-popover-modal-layering.test.js`    |    2 |     1 | —                               | 3                                                                            |
| `toolbar-refinement.test.js`                |    5 |    36 | —                               | 3                                                                            |
| `trash-reversible.test.js`                  |   10 |    51 | —                               | 1 — kalan Trash kuralları (Windows kilidinde yeniden deneme, kısmi boşaltma) |
| `tree-toggle-isolation.test.js`             |    1 |     6 | —                               | 3                                                                            |
| `tutorial.test.js`                          |    4 |    23 | —                               | 3                                                                            |
| `unified-toolbar.test.js`                   |    3 |    14 | —                               | 3                                                                            |

### (c) Silinen tekrarlar

Bunlar başka bir CI kapısının birebir kontrol ettiği şeyi tekrarlıyordu ve bu PR'da silindi.

| Silinen                                                                                            | Aynı kontrolü yapan                                                                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `i18n.test.js` › Turkish and English catalogs have matching complete keys                          | `check:i18n`: dil kodları, TR/ENG anahtar eşliği, en az 350 anahtar, boş çeviri                 |
| `i18n.test.js` › ek katalog anahtar eşliği ve sayısı (testin geri kalanı duruyor)                  | `check:i18n`: UI translation patch keys                                                         |
| `source-invariants.test.js` › renderer yalnızca tek ES module bootstrap üzerinden yüklenir         | `check:architecture`: tek modül betiği, klasik betik yok                                        |
| `source-invariants.test.js` › renderer bootstrap yalnızca mevcut modülleri import eder             | `check:types`: tsc çözümlenemeyen importu hata sayar (TS2307); smoke E2E de yükler              |
| `core-storage-runtime-split.test.js` › split core files remain below focused architecture ceilings | `check:architecture`: aynı 650/300 satır sınırları                                              |
| 22 dosyada 24 satır `assert.match(style, /NN-*.css/)`                                              | `css-consolidation.test.mjs`: style.css içeriği tam import listesiyle birebir karşılaştırılıyor |

### (b)'den bu PR'da çevrilen 5 test

`tests/critical-store-behavior.test.js` gerçek store'ları geçici bir projede çalıştırır.

| Eski test (silindi)                                                                                               | Yeni davranış testi                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `data-integrity.test.js` › node document writer connectionTypes projectionını diske yazmaz (extractFunction + vm) | kayıt: not yazıldığında connectionTypes diske girmez, geçici dosya kalmaz                          |
| `source-of-truth.test.js` › task store tek semantik otoritedir… (regex)                                           | görev: izinsiz sync-index yazımı `.pisi/tasks.json` dosyasını değiştirmez, izinli yazım değiştirir |
| `trash-reversible.test.js` › deletion archives canonical tasks semantic relationships and external map references | Trash görevleri, ilişkileri ve map üyeliğini arşivler; geri yükleme hepsini döndürür               |
| `trash-reversible.test.js` › restore is a delta merge rather than a whole-project snapshot overwrite              | geri yükleme silmeden sonra eklenen görev, ilişki ve düzenlemeleri ezmez                           |
| `trash-reversible.test.js` › restore fails closed on path task and semantic conflicts                             | path-exists / task-id / parent-missing çakışmasında hiçbir dosya değişmez, Trash öğesi kalır       |

Yeni testlerin gerçekten hata yakaladığı kasıtlı bozmayla doğrulandı:

- `writePisiDocument` connectionTypes'ı silmeyince 1. test düşüyor.
- Trash geri yüklemesi mevcut görevleri atınca 3. ve 4. testler düşüyor.

## Platformlar

Electron E2E matrisi:

- **ubuntu-latest:** `xvfb-run -a npm run test:e2e`.
- **windows-latest:** `node scripts/run-electron-e2e.mjs`. Aynı betikleri koşar, ilk hatada durmaz ve sonuç tablosunu job summary'ye yazar.
- **macOS:** Actions'ta "Run workflow" ile `macos` girdisi açılınca eklenir.

Windows'a özgü kurallar:

- **Satır sonları:** `.gitattributes` her checkout'ta LF tutar.
- **Geçici klasörler:** `fs.realpath` ile çözülür, çünkü `os.tmpdir()` 8.3 kısa ad döndürebilir (`RUNNER~1`).
- **Dosya kilitleri (EBUSY/EPERM):** silmeler `maxRetries` ile yapılır.
- **Yerleşim:** yerleşime bağlı E2E betikleri görünüm alanını CDP ile 1400×900'e sabitler (`Emulation.setDeviceMetricsOverride`) ve odak öykünmesini açar, çünkü Windows runner'ı pencereyi küçük ekrana sığdırır ve arka planda tutar.
- **Yollar:** `path.join` ile kurulur. Karşılaştırmadan önce `/` biçimine çevrilir.
