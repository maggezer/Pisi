import { registerModule } from '../core/module-registry.mjs';
import { closePisiCommandCenter, registerPisiCommandCenterPage } from './pisi-command-center.mjs';

const PISI_TUTORIAL_COMPLETED_KEY = 'pisi.tutorial.v1.completed';

const tutorialState = {
    overlay: null,
    spotlight: null,
    card: null,
    stepIndex: 0,
    active: false,
    firstRunTimer: null,
    resizeHandler: null,
    keyHandler: null
};

const tutorialText = {
    tr: {
        page: 'Tutorial',
        pageDescription: 'Pisi arayüzünü kısa bir rehberle tanı ve temel çalışma akışını öğren.',
        replay: 'Tutorialı başlat',
        replayDescription: 'Rehber uygulama üzerinde ilgili alanları sırayla vurgular. Verilerinizi değiştirmez.',
        skip: 'Atla',
        back: 'Geri',
        next: 'İleri',
        finish: 'Bitir',
        step: 'Adım',
        of: '/',
        welcomeTitle: "Pisi'ye hoş geldin",
        welcomeBody:
            'Bu kısa rehber sana Pisi’nin temel alanlarını gösterecek. İstediğin zaman Workspace Center içindeki Tutorial sayfasından yeniden başlatabilirsin.',
        explorerTitle: 'Explorer',
        explorerBody: 'Projendeki map ve node dosyaları burada görünür. Dosyaları açabilir, yeniden adlandırabilir ve ağaç içinde taşıyabilirsin.',
        projectTitle: 'Proje araçları',
        projectBody: 'Yeni map veya node oluşturmak, proje klasörünü değiştirmek ve Workspace Center’ı açmak için bu araçları kullan.',
        workspaceTitle: 'Çalışma alanı',
        workspaceBody: 'Map’ler, node içerikleri ve açık sekmeler orta alanda çalışır. Map üzerinde node’ları düzenleyebilir ve bağlantılar kurabilirsin.',
        editorTitle: 'Editör araçları',
        editorBody: 'Bir node açtığında yazı biçimlendirme, tablo, rollup ve çizim araçları burada görünür.',
        todoTitle: 'To‑Do',
        todoBody: 'Node içindeki görevler sağdaki To‑Do alanında toplanır. Filtreleyebilir, durumlarını takip edebilir ve ilgili node’a gidebilirsin.',
        mindmapTitle: 'Mind Map',
        mindmapBody: 'Mind Map sekmesi açık map için odaklanma, filtreleme, görünüm ve kayıtlı layout araçlarını içerir.',
        centerTitle: 'Workspace Center',
        centerBody: 'Ayarlar ve Preferences burada. Tema, görünüm tercihleri ve uygulama düzeyindeki araçları bu merkezden yönetebilirsin.'
    },
    eng: {
        page: 'Tutorial',
        pageDescription: 'Learn the Pisi interface and the core workflow with a short guided tour.',
        replay: 'Start tutorial',
        replayDescription: 'The guide highlights relevant areas on top of the application. It does not modify your data.',
        skip: 'Skip',
        back: 'Back',
        next: 'Next',
        finish: 'Finish',
        step: 'Step',
        of: '/',
        welcomeTitle: 'Welcome to Pisi',
        welcomeBody: 'This short guide introduces the main areas of Pisi. You can replay it any time from the Tutorial page in Workspace Center.',
        explorerTitle: 'Explorer',
        explorerBody: 'Your project maps and nodes appear here. Open, rename and move files within the project tree.',
        projectTitle: 'Project tools',
        projectBody: 'Use these controls to create maps or nodes, change the project folder and open Workspace Center.',
        workspaceTitle: 'Workspace',
        workspaceBody: 'Maps, node content and open tabs live in the center. Arrange map nodes and create relationships here.',
        editorTitle: 'Editor tools',
        editorBody: 'When a node is open, text formatting, tables, rollups and drawing tools appear in this area.',
        todoTitle: 'To‑Do',
        todoBody: 'Tasks from nodes are collected in the To‑Do panel. Filter them, track status and navigate back to the source node.',
        mindmapTitle: 'Mind Map',
        mindmapBody: 'The Mind Map tab contains focus, filtering, display and saved-layout tools for the active map.',
        centerTitle: 'Workspace Center',
        centerBody: 'Settings and Preferences live here. Manage themes, appearance defaults and application-level tools from this center.'
    }
};

function getTutorialLanguage() {
    return window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
}

function tt(key) {
    const language = getTutorialLanguage();
    return tutorialText[language]?.[key] || tutorialText.tr[key] || key;
}

const tutorialSteps = Object.freeze([
    Object.freeze({ title: 'welcomeTitle', body: 'welcomeBody', selectors: [] }),
    Object.freeze({ title: 'explorerTitle', body: 'explorerBody', selectors: ['#left-panel'] }),
    Object.freeze({ title: 'projectTitle', body: 'projectBody', selectors: ['#project-actions'] }),
    Object.freeze({ title: 'workspaceTitle', body: 'workspaceBody', selectors: ['#workspace', '#center-panel'] }),
    Object.freeze({ title: 'editorTitle', body: 'editorBody', selectors: ['.pisi-editor-toolbar:not([hidden])', '#center-toolbar'] }),
    Object.freeze({ title: 'todoTitle', body: 'todoBody', selectors: ['[data-right-tab="missions"]', '#right-panel'] }),
    Object.freeze({ title: 'mindmapTitle', body: 'mindmapBody', selectors: ['[data-right-tab="mindmap"]', '#right-panel-tabs'] }),
    Object.freeze({ title: 'centerTitle', body: 'centerBody', selectors: ['#pisi-command-center-button', '#project-actions'] })
]);

function isTutorialCompleted() {
    try {
        return localStorage.getItem(PISI_TUTORIAL_COMPLETED_KEY) === '1';
    } catch {
        return false;
    }
}

function markTutorialCompleted() {
    try {
        localStorage.setItem(PISI_TUTORIAL_COMPLETED_KEY, '1');
    } catch {
        // Tutorial completion is a convenience preference only.
    }
}

function findTutorialTarget(step) {
    for (const selector of step?.selectors || []) {
        const element = document.querySelector(selector);
        if (!element) continue;
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        return element;
    }
    return null;
}

function makeTutorialButton(className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.addEventListener('click', onClick);
    return button;
}

function ensureTutorialOverlay() {
    if (tutorialState.overlay?.isConnected) return tutorialState.overlay;

    const overlay = document.createElement('div');
    overlay.id = 'pisi-tutorial-overlay';
    overlay.className = 'pisi-tutorial-overlay';
    overlay.hidden = true;

    const spotlight = document.createElement('div');
    spotlight.className = 'pisi-tutorial-spotlight';
    spotlight.setAttribute('aria-hidden', 'true');

    const card = document.createElement('section');
    card.className = 'pisi-tutorial-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-live', 'polite');

    overlay.append(spotlight, card);
    document.body.appendChild(overlay);

    tutorialState.overlay = overlay;
    tutorialState.spotlight = spotlight;
    tutorialState.card = card;
    return overlay;
}

function positionTutorialCard(target) {
    const overlay = tutorialState.overlay;
    const spotlight = tutorialState.spotlight;
    const card = tutorialState.card;
    if (!overlay || !spotlight || !card) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 16;
    const gap = 18;

    if (!target) {
        overlay.classList.add('pisi-tutorial-no-target');
        spotlight.hidden = true;
        card.style.left = '50%';
        card.style.top = '50%';
        card.style.transform = 'translate(-50%, -50%)';
        return;
    }

    overlay.classList.remove('pisi-tutorial-no-target');
    spotlight.hidden = false;
    card.style.transform = 'none';

    const rect = target.getBoundingClientRect();
    const pad = 7;
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.width = `${Math.min(viewportWidth, rect.width + pad * 2)}px`;
    spotlight.style.height = `${Math.min(viewportHeight, rect.height + pad * 2)}px`;

    const cardRect = card.getBoundingClientRect();
    const cardWidth = cardRect.width || Math.min(360, viewportWidth - margin * 2);
    const cardHeight = cardRect.height || 220;

    let left = rect.right + gap;
    if (left + cardWidth > viewportWidth - margin) {
        left = rect.left - cardWidth - gap;
    }
    if (left < margin) {
        left = Math.max(margin, Math.min(viewportWidth - cardWidth - margin, rect.left + rect.width / 2 - cardWidth / 2));
    }

    let top = rect.top;
    if (top + cardHeight > viewportHeight - margin) {
        top = viewportHeight - cardHeight - margin;
    }
    top = Math.max(margin, top);

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
}

function renderTutorialStep() {
    if (!tutorialState.active) return;
    const step = tutorialSteps[tutorialState.stepIndex];
    const card = tutorialState.card;
    if (!step || !card) return;

    card.replaceChildren();

    const progress = document.createElement('div');
    progress.className = 'pisi-tutorial-progress';
    progress.textContent = `${tt('step')} ${tutorialState.stepIndex + 1} ${tt('of')} ${tutorialSteps.length}`;

    const title = document.createElement('h2');
    title.className = 'pisi-tutorial-title';
    title.textContent = tt(step.title);

    const body = document.createElement('p');
    body.className = 'pisi-tutorial-body';
    body.textContent = tt(step.body);

    const actions = document.createElement('div');
    actions.className = 'pisi-tutorial-actions';

    const skip = makeTutorialButton('pisi-tutorial-button pisi-tutorial-skip', () => {
        finishPisiTutorial(true);
    });
    skip.textContent = tt('skip');

    const navigation = document.createElement('div');
    navigation.className = 'pisi-tutorial-navigation';

    const back = makeTutorialButton('pisi-tutorial-button', previousPisiTutorialStep);
    back.textContent = tt('back');
    back.disabled = tutorialState.stepIndex === 0;

    const isLast = tutorialState.stepIndex === tutorialSteps.length - 1;
    const next = makeTutorialButton('pisi-tutorial-button pisi-tutorial-primary', isLast ? () => finishPisiTutorial(true) : nextPisiTutorialStep);
    next.textContent = tt(isLast ? 'finish' : 'next');

    navigation.append(back, next);
    actions.append(skip, navigation);
    card.append(progress, title, body, actions);

    const target = findTutorialTarget(step);
    positionTutorialCard(target);
    if (!isPisiTutorialTypingTarget()) next.focus({ preventScroll: true });
}

function nextPisiTutorialStep() {
    if (!tutorialState.active) return;
    tutorialState.stepIndex = Math.min(tutorialSteps.length - 1, tutorialState.stepIndex + 1);
    renderTutorialStep();
}

function previousPisiTutorialStep() {
    if (!tutorialState.active) return;
    tutorialState.stepIndex = Math.max(0, tutorialState.stepIndex - 1);
    renderTutorialStep();
}

function unbindTutorialRuntimeHandlers() {
    if (tutorialState.resizeHandler) {
        window.removeEventListener('resize', tutorialState.resizeHandler);
        window.removeEventListener('scroll', tutorialState.resizeHandler, true);
        tutorialState.resizeHandler = null;
    }
    if (tutorialState.keyHandler) {
        document.removeEventListener('keydown', tutorialState.keyHandler, true);
        tutorialState.keyHandler = null;
    }
}

function finishPisiTutorial(markCompleted = true) {
    if (markCompleted) markTutorialCompleted();
    tutorialState.active = false;
    tutorialState.stepIndex = 0;
    if (tutorialState.overlay) tutorialState.overlay.hidden = true;
    document.body.classList.remove('pisi-tutorial-open');
    unbindTutorialRuntimeHandlers();
}

function bindTutorialRuntimeHandlers() {
    unbindTutorialRuntimeHandlers();

    tutorialState.resizeHandler = () => {
        if (!tutorialState.active) return;
        positionTutorialCard(findTutorialTarget(tutorialSteps[tutorialState.stepIndex]));
    };
    window.addEventListener('resize', tutorialState.resizeHandler);
    window.addEventListener('scroll', tutorialState.resizeHandler, true);

    tutorialState.keyHandler = (event) => {
        if (!tutorialState.active) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            finishPisiTutorial(true);
            return;
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            if (tutorialState.stepIndex === tutorialSteps.length - 1) {
                finishPisiTutorial(true);
            } else {
                nextPisiTutorialStep();
            }
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            previousPisiTutorialStep();
        }
    };
    document.addEventListener('keydown', tutorialState.keyHandler, true);
}

function startPisiTutorial({ fromBeginning = true } = {}) {
    closePisiCommandCenter();
    ensureTutorialOverlay();
    tutorialState.active = true;
    if (fromBeginning) tutorialState.stepIndex = 0;
    tutorialState.overlay.hidden = false;
    document.body.classList.add('pisi-tutorial-open');
    bindTutorialRuntimeHandlers();
    renderTutorialStep();
    return true;
}

function renderPisiTutorialPage(container) {
    const page = document.createElement('section');
    page.className = 'pisi-tutorial-page';

    const heading = document.createElement('div');
    heading.className = 'pisi-tutorial-page-heading';
    const title = document.createElement('h2');
    title.textContent = tt('page');
    const description = document.createElement('p');
    description.textContent = tt('pageDescription');
    heading.append(title, description);

    const card = document.createElement('div');
    card.className = 'pisi-tutorial-page-card';
    const detail = document.createElement('p');
    detail.textContent = tt('replayDescription');
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'pisi-tutorial-page-start';
    start.textContent = tt('replay');
    start.addEventListener('click', () => startPisiTutorial());
    card.append(detail, start);

    page.append(heading, card);
    container.appendChild(page);
}

function registerPisiTutorialPage() {
    registerPisiCommandCenterPage({
        id: 'tutorial',
        label: () => tt('page'),
        order: 920,
        requiresProject: false,
        render: async (container) => renderPisiTutorialPage(container)
    });
}

// The tutorial focuses its own buttons. Starting it while the user types would
// send the next keystrokes (Enter included) to the tutorial instead of the note,
// so the automatic first-run start waits until focus leaves editable fields.
function isPisiTutorialTypingTarget(element = document.activeElement) {
    return Boolean((element instanceof HTMLElement && element.isContentEditable) || element?.matches?.('input, textarea, select'));
}

function scheduleFirstRunTutorial() {
    if (isTutorialCompleted() || tutorialState.firstRunTimer) return;
    tutorialState.firstRunTimer = window.setInterval(() => {
        if (isTutorialCompleted()) {
            window.clearInterval(tutorialState.firstRunTimer);
            tutorialState.firstRunTimer = null;
            return;
        }
        if (!window.currentProjectFolder || isPisiTutorialTypingTarget()) return;
        const projectModal = document.getElementById('project-modal');
        if (projectModal && getComputedStyle(projectModal).display !== 'none') return;

        window.clearInterval(tutorialState.firstRunTimer);
        tutorialState.firstRunTimer = null;
        window.setTimeout(() => {
            if (isTutorialCompleted() || tutorialState.active) return;
            if (isPisiTutorialTypingTarget()) {
                scheduleFirstRunTutorial();
                return;
            }
            startPisiTutorial();
        }, 500);
    }, 500);
}

registerPisiTutorialPage();
scheduleFirstRunTutorial();

document.addEventListener('pisi:language-changed', () => {
    if (tutorialState.active) renderTutorialStep();
});

const moduleApi = {
    PISI_TUTORIAL_COMPLETED_KEY,
    finishPisiTutorial,
    isTutorialCompleted,
    nextPisiTutorialStep,
    previousPisiTutorialStep,
    renderPisiTutorialPage,
    startPisiTutorial,
    tutorialState,
    tutorialSteps
};

registerModule('shell.tutorial', moduleApi);

export {
    PISI_TUTORIAL_COMPLETED_KEY,
    finishPisiTutorial,
    isTutorialCompleted,
    nextPisiTutorialStep,
    previousPisiTutorialStep,
    renderPisiTutorialPage,
    startPisiTutorial,
    tutorialState,
    tutorialSteps
};
