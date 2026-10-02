import { registerModule } from '../core/module-registry.mjs';

const PISI_INTEGRITY_UI = {
    tr: {
        title: 'Proje bütünlüğü',
        description:
            'Canonical task/relationship store’ları, node/map kimlikleri, map state, property/ek hedefleri, Trash ve atomic recovery kayıtlarını birlikte denetler.',
        audit: 'Projeyi denetle',
        auditing: 'Denetleniyor…',
        healthy: 'Kritik bütünlük hatası yok.',
        unhealthy: 'Proje bütünlüğünde müdahale gerektiren hata var.',
        clean: 'Hiç sorun bulunmadı.',
        applySafe: 'Güvenli onarımları uygula',
        applying: 'Onarılıyor…',
        rebuild: 'Türetilmiş durumu yeniden oluştur',
        rebuildDescription:
            'Node connectionTypes cache’i ile map-local operational/presentation state yeniden oluşturulur. .pisi/tasks.json ve .pisi/relationships.json değiştirilmez.',
        confirmRepairs: 'Aşağıdaki güvenli onarımlar tek atomic transaction içinde uygulanacak:',
        confirmRebuild: 'Türetilmiş state yeniden oluşturulsun mu? Canonical task ve relationship authority değişmeyecek.',
        repairPlan: 'Onarım planı',
        safe: 'Güvenli',
        review: 'İncele',
        manual: 'Manuel',
        authority: 'Authority',
        path: 'Yol',
        noProject: 'Project Integrity için bir proje açın.',
        auditFailed: 'Project Integrity denetimi başarısız.',
        repairFailed: 'Project Integrity onarımı başarısız.',
        rebuildFailed: 'Türetilmiş state yeniden oluşturulamadı.',
        files: 'dosya',
        nodes: 'node',
        maps: 'map',
        tasks: 'görev',
        relationships: 'ilişki',
        trash: 'Trash',
        journals: 'journal',
        critical: 'kritik',
        errors: 'hata',
        warnings: 'uyarı',
        safeRepairs: 'güvenli onarım'
    },
    eng: {
        title: 'Project Integrity',
        description:
            'Audits canonical task/relationship stores together with node/map identities, map state, property/attachment targets, Trash, and atomic recovery records.',
        audit: 'Audit project',
        auditing: 'Auditing…',
        healthy: 'No critical integrity errors.',
        unhealthy: 'Project integrity has errors that require attention.',
        clean: 'No issues found.',
        applySafe: 'Apply safe repairs',
        applying: 'Repairing…',
        rebuild: 'Rebuild derived state',
        rebuildDescription:
            'Rebuilds node connectionTypes cache and map-local operational/presentation state. It does not modify .pisi/tasks.json or .pisi/relationships.json.',
        confirmRepairs: 'The following safe repairs will run inside one atomic transaction:',
        confirmRebuild: 'Rebuild derived state? Canonical task and relationship authorities will remain unchanged.',
        repairPlan: 'Repair plan',
        safe: 'Safe',
        review: 'Review',
        manual: 'Manual',
        authority: 'Authority',
        path: 'Path',
        noProject: 'Open a project to use Project Integrity.',
        auditFailed: 'Project Integrity audit failed.',
        repairFailed: 'Project Integrity repair failed.',
        rebuildFailed: 'Derived state could not be rebuilt.',
        files: 'files',
        nodes: 'nodes',
        maps: 'maps',
        tasks: 'tasks',
        relationships: 'relationships',
        trash: 'Trash',
        journals: 'journals',
        critical: 'critical',
        errors: 'errors',
        warnings: 'warnings',
        safeRepairs: 'safe repairs'
    }
};

function integrityText(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return PISI_INTEGRITY_UI[language]?.[key] || PISI_INTEGRITY_UI.tr[key] || key;
}

async function runIntegrityTransport(action, repairIds = []) {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder) return { ok: false, error: integrityText('noProject') };
    if (action === 'audit') {
        return window.pisiProject?.auditIntegrity?.(projectFolder);
    }
    return window.pisiProject?.auditIntegrity?.({
        action,
        projectFolder,
        repairIds
    });
}

function makeButton(label, className = 'pisi-secondary-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}

function makeMetric(label, value, severity = '') {
    const metric = document.createElement('div');
    metric.className = 'pisi-integrity-metric';
    if (severity) metric.dataset.severity = severity;
    const count = document.createElement('strong');
    count.textContent = String(value ?? 0);
    const caption = document.createElement('span');
    caption.textContent = label;
    metric.append(count, caption);
    return metric;
}

function repairSafetyLabel(safety) {
    return integrityText(['safe', 'review', 'manual'].includes(safety) ? safety : 'manual');
}

function makeIssueRow(issue) {
    const row = document.createElement('article');
    row.className = 'pisi-integrity-issue-row';
    row.dataset.severity = issue.severity || 'warning';

    const head = document.createElement('div');
    head.className = 'pisi-integrity-issue-head';
    const severity = document.createElement('span');
    severity.className = 'pisi-integrity-severity';
    severity.textContent = String(issue.severity || 'warning').toUpperCase();
    const code = document.createElement('code');
    code.textContent = `${issue.domain || 'project'} · ${issue.code || 'unknown'}`;
    head.append(severity, code);

    const message = document.createElement('div');
    message.className = 'pisi-integrity-issue-message';
    message.textContent = issue.message || issue.code || 'Issue';
    const issuePath = document.createElement('div');
    issuePath.className = 'pisi-integrity-issue-path';
    issuePath.textContent = `${integrityText('path')}: ${issue.path || '—'}${issue.entityId ? ` · ${issue.entityId}` : ''}`;
    row.append(head, message, issuePath);

    if (issue.repair) {
        const repair = document.createElement('div');
        repair.className = 'pisi-integrity-repair-note';
        repair.dataset.safety = issue.repair.safety || 'manual';
        const badge = document.createElement('span');
        badge.textContent = repairSafetyLabel(issue.repair.safety);
        const copy = document.createElement('span');
        copy.textContent = issue.repair.description || issue.repair.action;
        repair.append(badge, copy);
        row.appendChild(repair);
    }
    return row;
}

function makeRepairPlan(report) {
    const section = document.createElement('section');
    section.className = 'pisi-integrity-plan';
    const title = document.createElement('h3');
    title.textContent = integrityText('repairPlan');
    section.appendChild(title);
    const repairs = [...(report.repairPlan?.safe || []), ...(report.repairPlan?.review || []), ...(report.repairPlan?.manual || [])];
    if (!repairs.length) {
        const empty = document.createElement('p');
        empty.textContent = integrityText('clean');
        section.appendChild(empty);
        return section;
    }
    const list = document.createElement('div');
    list.className = 'pisi-integrity-plan-list';
    for (const repair of repairs.slice(0, 200)) {
        const row = document.createElement('div');
        row.className = 'pisi-integrity-plan-item';
        row.dataset.safety = repair.safety || 'manual';
        const badge = document.createElement('span');
        badge.textContent = repairSafetyLabel(repair.safety);
        const copy = document.createElement('span');
        copy.textContent = `${repair.description}${repair.path ? ` · ${repair.path}` : ''}`;
        row.append(badge, copy);
        list.appendChild(row);
    }
    section.appendChild(list);
    return section;
}

function renderIntegrityReport(root, report) {
    root.replaceChildren();
    const status = document.createElement('div');
    status.className = 'pisi-integrity-status';
    status.dataset.healthy = report.healthy ? '1' : '0';
    const label = document.createElement('strong');
    label.textContent = report.clean ? integrityText('clean') : report.healthy ? integrityText('healthy') : integrityText('unhealthy');
    const timestamp = document.createElement('span');
    timestamp.textContent = report.auditedAt ? new Date(report.auditedAt).toLocaleString() : '';
    status.append(label, timestamp);

    const metrics = document.createElement('div');
    metrics.className = 'pisi-integrity-metrics';
    for (const item of [
        ['files', report.summary?.files],
        ['nodes', report.summary?.nodes],
        ['maps', report.summary?.maps],
        ['tasks', report.summary?.tasks],
        ['relationships', report.summary?.relationships],
        ['trash', report.summary?.trashItems],
        ['journals', report.summary?.mutationJournals],
        ['critical', report.summary?.critical, 'critical'],
        ['errors', report.summary?.errors, 'error'],
        ['warnings', report.summary?.warnings, 'warning'],
        ['safeRepairs', report.summary?.safeRepairs, 'safe']
    ]) {
        metrics.appendChild(makeMetric(integrityText(item[0]), item[1], item[2]));
    }

    const authorities = document.createElement('div');
    authorities.className = 'pisi-integrity-authorities';
    const authorityLabel = document.createElement('strong');
    authorityLabel.textContent = integrityText('authority');
    const authorityValue = document.createElement('span');
    authorityValue.textContent = [report.authorities?.tasks, report.authorities?.relationships, report.authorities?.mapState].filter(Boolean).join(' · ');
    authorities.append(authorityLabel, authorityValue);

    const issues = document.createElement('div');
    issues.className = 'pisi-integrity-issues expanded';
    for (const issue of report.issues || []) issues.appendChild(makeIssueRow(issue));
    root.append(status, metrics, authorities, makeRepairPlan(report), issues);
}

async function confirmSafeRepairs(report) {
    const safe = report.repairPlan?.safe || [];
    if (!safe.length) return false;
    const preview = safe
        .slice(0, 12)
        .map((repair) => `• ${repair.description}${repair.path ? ` (${repair.path})` : ''}`)
        .join('\n');
    return window.pisiConfirm?.(`${integrityText('confirmRepairs')}\n\n${preview}${safe.length > 12 ? `\n… +${safe.length - 12}` : ''}`, {
        title: integrityText('title'),
        confirmText: integrityText('applySafe'),
        cancelText: window.pisiT?.('Vazgeç') || 'Vazgeç'
    });
}

function buildPisiExpandedIntegritySection(container) {
    container.querySelectorAll('.pisi-integrity-settings').forEach((node) => node.remove());
    const section = document.createElement('section');
    section.className = 'pisi-portable-section pisi-integrity-settings pisi-integrity-expanded';
    const title = document.createElement('h2');
    title.textContent = integrityText('title');
    const description = document.createElement('p');
    description.className = 'pisi-portable-description';
    description.textContent = integrityText('description');
    const actions = document.createElement('div');
    actions.className = 'pisi-portable-actions pisi-integrity-actions';
    const audit = makeButton(integrityText('audit'), 'pisi-primary-button');
    const repair = makeButton(integrityText('applySafe'));
    const rebuild = makeButton(integrityText('rebuild'));
    repair.disabled = true;
    rebuild.disabled = !window.currentProjectFolder;
    actions.append(audit, repair, rebuild);
    const help = document.createElement('p');
    help.className = 'pisi-integrity-rebuild-help';
    help.textContent = integrityText('rebuildDescription');
    const reportRoot = document.createElement('div');
    reportRoot.className = 'pisi-integrity-report pisi-integrity-report-v2';
    let currentReport = null;

    const setButtons = () => {
        audit.disabled = !window.currentProjectFolder;
        rebuild.disabled = !window.currentProjectFolder;
        repair.disabled = !(currentReport?.repairPlan?.safe || []).length;
    };

    const auditProject = async () => {
        if (!window.currentProjectFolder) return null;
        audit.disabled = true;
        repair.disabled = true;
        reportRoot.textContent = integrityText('auditing');
        try {
            const result = await runIntegrityTransport('audit');
            if (!result?.ok) throw new Error(result?.error || integrityText('auditFailed'));
            currentReport = result;
            renderIntegrityReport(reportRoot, result);
            return result;
        } catch (error) {
            currentReport = null;
            reportRoot.textContent = error?.message || integrityText('auditFailed');
            return null;
        } finally {
            setButtons();
        }
    };

    audit.addEventListener('click', () => void auditProject());
    repair.addEventListener('click', async () => {
        const safe = currentReport?.repairPlan?.safe || [];
        if (!safe.length || !(await confirmSafeRepairs(currentReport))) return;
        audit.disabled = repair.disabled = rebuild.disabled = true;
        reportRoot.textContent = integrityText('applying');
        try {
            const result = await runIntegrityTransport(
                'repair',
                safe.map((item) => item.id)
            );
            if (!result?.ok) throw new Error(result?.error || integrityText('repairFailed'));
            currentReport = result.after || null;
            if (currentReport) renderIntegrityReport(reportRoot, currentReport);
            else await auditProject();
            await window.reloadPisiWorkspaceAfterExternalChange?.();
        } catch (error) {
            reportRoot.textContent = error?.message || integrityText('repairFailed');
        } finally {
            setButtons();
        }
    });
    rebuild.addEventListener('click', async () => {
        const confirmed = await window.pisiConfirm?.(integrityText('confirmRebuild'), {
            title: integrityText('rebuild'),
            confirmText: integrityText('rebuild'),
            cancelText: window.pisiT?.('Vazgeç') || 'Vazgeç'
        });
        if (!confirmed) return;
        audit.disabled = repair.disabled = rebuild.disabled = true;
        try {
            const result = await runIntegrityTransport('rebuild-derived');
            if (!result?.ok) throw new Error(result?.error || integrityText('rebuildFailed'));
            currentReport = result.report || null;
            if (currentReport) renderIntegrityReport(reportRoot, currentReport);
            await window.reloadPisiWorkspaceAfterExternalChange?.();
        } catch (error) {
            reportRoot.textContent = error?.message || integrityText('rebuildFailed');
        } finally {
            setButtons();
        }
    });

    if (!window.currentProjectFolder) reportRoot.textContent = integrityText('noProject');
    section.append(title, description, actions, help, reportRoot);
    container.appendChild(section);
    return section;
}

function initializePisiExpandedIntegrity() {
    if (initializePisiExpandedIntegrity.bound) return;
    initializePisiExpandedIntegrity.bound = true;
    document.addEventListener('pisi:render-settings-sections', (event) => {
        if (event.detail?.container) buildPisiExpandedIntegritySection(event.detail.container);
    });
    document.addEventListener('pisi:language-changed', () => {
        const section = document.querySelector('.pisi-integrity-expanded');
        if (section?.parentElement) buildPisiExpandedIntegritySection(section.parentElement);
    });
}

const moduleApi = {
    PISI_INTEGRITY_UI,
    integrityText,
    runIntegrityTransport,
    makeIssueRow,
    makeRepairPlan,
    renderIntegrityReport,
    buildPisiExpandedIntegritySection,
    initializePisiExpandedIntegrity
};

registerModule('portability.integrity', moduleApi);
initializePisiExpandedIntegrity();

export { PISI_INTEGRITY_UI, buildPisiExpandedIntegritySection, integrityText, makeIssueRow, makeRepairPlan, renderIntegrityReport, runIntegrityTransport };
