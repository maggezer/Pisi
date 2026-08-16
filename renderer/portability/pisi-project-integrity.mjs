import { registerModule } from '../core/module-registry.mjs';

const PISI_INTEGRITY_UI = {
    tr: {
        title: 'Proje bütünlüğü',
        description: 'Canonical task ve relationship store’ları, node/map kimliklerini, map state ve referanslarını, property/ek hedeflerini, Trash kayıtlarını ve atomic recovery kalıntılarını birlikte denetler.',
        audit: 'Projeyi denetle',
        auditing: 'Denetleniyor…',
        healthy: 'Kritik bütünlük hatası yok.',
        unhealthy: 'Proje bütünlüğünde müdahale gerektiren hata var.',
        clean: 'Hiç sorun bulunmadı.',
        files: 'dosya',
        nodes: 'node',
        maps: 'map',
        tasks: 'görev',
        relationships: 'ilişki',
        trash: 'Trash kaydı',
        journals: 'mutation journal',
        issues: 'sorun',
        critical: 'kritik',
        errors: 'hata',
        warnings: 'uyarı',
        safeRepairs: 'güvenli onarım',
        repairPlan: 'Onarım planı',
        safe: 'Güvenli',
        review: 'İncele',
        manual: 'Manuel',
        applySafe: 'Güvenli onarımları uygula',
        applying: 'Onarılıyor…',
        rebuild: 'Türetilmiş durumu yeniden oluştur',
        rebuildDescription: 'Node connectionTypes cache’i ile map-local operational/presentation state yeniden normalize edilir. .pisi/tasks.json ve .pisi/relationships.json authority dosyaları değiştirilmez.',
        confirmRepairs: 'Aşağıdaki güvenli onarımlar atomik transaction içinde uygulanacak:',
        confirmRebuild: 'Türetilmiş state yeniden oluşturulsun mu? Canonical task ve relationship authority değişmeyecek.',
        auditFailed: 'Project Integrity denetimi başarısız.',
        repairFailed: 'Project Integrity onarımı başarısız.',
        rebuildFailed: 'Türetilmiş state yeniden oluşturulamadı.',
        noProject: 'Project Integrity için bir proje açın.',
        applied: 'uygulandı',
        rebuilt: 'Türetilmiş state yeniden oluşturuldu.',
        authority: 'Authority',
        path: 'Yol'
    },
    eng: {
        title: 'Project Integrity',
        description: 'Audits canonical task and relationship stores together with node/map identities, map state and references, property/attachment targets, Trash records, and atomic recovery artifacts.',
        audit: 'Audit project',
        auditing: 'Auditing…',
        healthy: 'No critical integrity errors.',
        unhealthy: 'Project integrity has errors that require attention.',
        clean: 'No issues found.',
        files: 'files',
        nodes: 'nodes',
        maps: 'maps',
        tasks: 'tasks',
        relationships: 'relationships',
        trash: 'Trash items',
        journals: 'mutation journals',
        issues: 'issues',
        critical: 'critical',
        errors: 'errors',
        warnings: 'warnings',
        safeRepairs: 'safe repairs',
        repairPlan: 'Repair plan',
        safe: 'Safe',
        review: 'Review',
        manual: 'Manual',
        applySafe: 'Apply safe repairs',
        applying: 'Repairing…',
        rebuild: 'Rebuild derived state',
        rebuildDescription: 'Rebuilds node connectionTypes cache and normalizes map-local operational/presentation state. It does not modify .pisi/tasks.json or .pisi/relationships.json authorities.',
        confirmRepairs: 'The following safe repairs will run inside one atomic transaction:',
        confirmRebuild: 'Rebuild derived state? Canonical task and relationship authorities will remain unchanged.',
        auditFailed: 'Project Integrity audit failed.',
        repairFailed: 'Project Integrity repair failed.',
        rebuildFailed: 'Derived state could not be rebuilt.',
        noProject: 'Open a project to use Project Integrity.',
        applied: 'applied',
        rebuilt: 'Derived state rebuilt.',
        authority: 'Authority',
        path: 'Path'
    }
};

function integrityLanguage() {
    return window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
}

function integrityText(key) {
    return PISI_INTEGRITY_UI[integrityLanguage()]?.[key]
        || PISI_INTEGRITY_UI.tr[key]
        || key;
}

function makeIntegrityButton(label, className = 'pisi-secondary-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}

function makeIntegrityMetric(label, value, severity = '') {
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

function getRepairSafetyLabel(safety) {
    return integrityText(['safe', 'review', 'manual'].includes(safety) ? safety : 'manual');
}

function makeIntegrityIssueRow(issue) {
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

    const pathLine = document.createElement('div');
    pathLine.className = 'pisi-integrity-issue-path';
    pathLine.textContent = `${integrityText('path')}: ${issue.path || '—'}${issue.entityId ? ` · ${issue.entityId}` : ''}`;

    row.append(head, message, pathLine);

    if (issue.repair) {
        const repair = document.createElement('div');
        repair.className = 'pisi-integrity-repair-note';
        repair.dataset.safety = issue.repair.safety || 'manual';
        const badge = document.createElement('span');
        badge.textContent = getRepairSafetyLabel(issue.repair.safety);
        const description = document.createElement('span');
        description.textContent = issue.repair.description || issue.repair.action;
        repair.append(badge, description);
        row.appendChild(repair);
    }
    return row;
}

function makeRepairPlan(report) {
    const plan = document.createElement('section');
    plan.className = 'pisi-integrity-plan';
    const heading = document.createElement('h3');
    heading.textContent = integrityText('repairPlan');
    plan.appendChild(heading);

    const repairs = [
        ...(report.repairPlan?.safe || []),
        ...(report.repairPlan?.review || []),
        ...(report.repairPlan?.manual || [])
    ];
    if (!repairs.length) {
        const empty = document.createElement('p');
        empty.textContent = integrityText('clean');
        plan.appendChild(empty);
        return plan;
    }

    const list = document.createElement('div');
    list.className = 'pisi-integrity-plan-list';
    for (const repair of repairs.slice(0, 200)) {
        const item = document.createElement('div');
        item.className = 'pisi-integrity-plan-item';
        item.dataset.safety = repair.safety || 'manual';
        const badge = document.createElement('span');
        badge.textContent = getRepairSafetyLabel(repair.safety);
        const copy = document.createElement('span');
        copy.textContent = `${repair.description}${repair.path ? ` · ${repair.path}` : ''}`;
        item.append(badge, copy);
        list.appendChild(item);
    }
    plan.appendChild(list);
    return plan;
}

function renderIntegrityReport(reportRoot, report) {
    reportRoot.replaceChildren();
    const status = document.createElement('div');
    status.className = 'pisi-integrity-status';
    status.dataset.healthy = report.healthy ? '1' : '0';
    const statusTitle = document.createElement('strong');
    statusTitle.textContent = report.clean
        ? integrityText('clean')
        : report.healthy
            ? integrityText('healthy')
            : integrityText('unhealthy');
    const audited = document.createElement('span');
    audited.textContent = report.auditedAt
        ? new Date(report.auditedAt).toLocaleString()
        : '';
    status.append(statusTitle, audited);

    const summary = document.createElement('div');
    summary.className = 'pisi-integrity-metrics';
    const metrics = [
        [integrityText('files'), report.summary?.files],
        [integrityText('nodes'), report.summary?.nodes],
        [integrityText('maps'), report.summary?.maps],
        [integrityText('tasks'), report.summary?.tasks],
        [integrityText('relationships'), report.summary?.relationships],
        [integrityText('trash'), report.summary?.trashItems],
        [integrityText('journals'), report.summary?.mutationJournals],
        [integrityText('critical'), report.summary?.critical, 'critical'],
        [integrityText('errors'), report.summary?.errors, 'error'],
        [integrityText('warnings'), report.summary?.warnings, 'warning'],
        [integrityText('safeRepairs'), report.summary?.safeRepairs, 'safe']
    ];
    for (const metric of metrics) summary.appendChild(makeIntegrityMetric(...metric));

    const authorities = document.createElement('div');
    authorities.className = 'pisi-integrity-authorities';
    const authorityTitle = document.createElement('strong');
    authorityTitle.textContent = integrityText('authority');
    const authorityText = document.createElement('span');
    authorityText.textContent = [
        report.authorities?.tasks,
        report.authorities?.relationships,
        report.authorities?.mapState
    ].filter(Boolean).join(' · ');
    authorities.append(authorityTitle, authorityText);

    const issues = document.createElement('div');
    issues.className = 'pisi-integrity-issues expanded';
    for (const issue of report.issues || []) {
        issues.appendChild(makeIntegrityIssueRow(issue));
    }

    reportRoot.append(status, summary, authorities, makeRepairPlan(report), issues);
}

async function confirmSafeRepairs(report) {
    const safe = report.repairPlan?.safe || [];
    if (!safe.length) return false;
    const preview = safe.slice(0, 12)
        .map((repair) => `• ${repair.description}${repair.path ? ` (${repair.path})` : ''}`)
        .join('\n');
    const overflow = safe.length > 12 ? `\n… +${safe.length - 12}` : '';
    return window.pisiConfirm?.(
        `${integrityText('confirmRepairs')}\n\n${preview}${overflow}`,
        {
            title: integrityText('title'),
            confirmText: integrityText('applySafe'),
            cancelText: window.pisiT?.('Vazgeç') || 'Vazgeç'
        }
    );
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
    const audit = makeIntegrityButton(integrityText('audit'), 'pisi-primary-button');
    const repair = makeIntegrityButton(integrityText('applySafe'));
    const rebuild = makeIntegrityButton(integrityText('rebuild'));
    repair.disabled = true;
    rebuild.disabled = !window.currentProjectFolder;
    actions.append(audit, repair, rebuild);

    const rebuildHelp = document.createElement('p');
    rebuildHelp.className = 'pisi-integrity-rebuild-help';
    rebuildHelp.textContent = integrityText('rebuildDescription');

    const reportRoot = document.createElement('div');
    reportRoot.className = 'pisi-integrity-report pisi-integrity-report-v2';
    let currentReport = null;

    if (!window.currentProjectFolder) {
        audit.disabled = true;
        reportRoot.textContent = integrityText('noProject');
    }

    const runAudit = async () => {
        if (!window.currentProjectFolder) return null;
        audit.disabled = true;
        repair.disabled = true;
        reportRoot.textContent = integrityText('auditing');
        try {
            const result = await window.pisiProject?.auditIntegrity?.(
                window.currentProjectFolder
            );
            if (!result?.ok) {
                throw new Error(result?.error || integrityText('auditFailed'));
            }
            currentReport = result;
            renderIntegrityReport(reportRoot, result);
            repair.disabled = !(result.repairPlan?.safe || []).length;
            return result;
        } catch (error) {
            currentReport = null;
            reportRoot.textContent = error?.message || integrityText('auditFailed');
            return null;
        } finally {
            audit.disabled = !window.currentProjectFolder;
        }
    };

    audit.addEventListener('click', () => {
        void runAudit();
    });

    repair.addEventListener('click', async () => {
        if (!currentReport || !window.currentProjectFolder) return;
        const safe = currentReport.repairPlan?.safe || [];
        if (!safe.length || !(await confirmSafeRepairs(currentReport))) return;
        audit.disabled = true;
        repair.disabled = true;
        rebuild.disabled = true;
        try {
            reportRoot.textContent = integrityText('applying');
            const result = await window.pisiProject?.repairIntegrity?.(
                window.currentProjectFolder,
                safe.map((item) => item.id)
            );
            if (!result?.ok) throw new Error(result?.error || integrityText('repairFailed'));
            currentReport = result.after || await runAudit();
            if (result.after) renderIntegrityReport(reportRoot, result.after);
            await window.reloadPisiWorkspaceAfterExternalChange?.();
        } catch (error) {
            reportRoot.textContent = error?.message || integrityText('repairFailed');
        } finally {
            audit.disabled = !window.currentProjectFolder;
            rebuild.disabled = !window.currentProjectFolder;
            repair.disabled = !(currentReport?.repairPlan?.safe || []).length;
        }
    });

    rebuild.addEventListener('click', async () => {
        if (!window.currentProjectFolder) return;
        const confirmed = await window.pisiConfirm?.(
            integrityText('confirmRebuild'),
            {
                title: integrityText('rebuild'),
                confirmText: integrityText('rebuild'),
                cancelText: window.pisiT?.('Vazgeç') || 'Vazgeç'
            }
        );
        if (!confirmed) return;
        audit.disabled = true;
        repair.disabled = true;
        rebuild.disabled = true;
        try {
            const result = await window.pisiProject?.rebuildIntegrityDerived?.(
                window.currentProjectFolder
            );
            if (!result?.ok) throw new Error(result?.error || integrityText('rebuildFailed'));
            currentReport = result.report;
            if (currentReport) renderIntegrityReport(reportRoot, currentReport);
            await window.reloadPisiWorkspaceAfterExternalChange?.();
        } catch (error) {
            reportRoot.textContent = error?.message || integrityText('rebuildFailed');
        } finally {
            audit.disabled = !window.currentProjectFolder;
            rebuild.disabled = !window.currentProjectFolder;
            repair.disabled = !(currentReport?.repairPlan?.safe || []).length;
        }
    });

    section.append(title, description, actions, rebuildHelp, reportRoot);
    container.appendChild(section);
    return section;
}

function initializePisiExpandedIntegrity() {
    if (initializePisiExpandedIntegrity.bound) return;
    initializePisiExpandedIntegrity.bound = true;
    document.addEventListener('pisi:render-settings-sections', (event) => {
        const container = event.detail?.container;
        if (container) buildPisiExpandedIntegritySection(container);
    });
    document.addEventListener('pisi:language-changed', () => {
        const section = document.querySelector('.pisi-integrity-expanded');
        const container = section?.parentElement;
        if (container) buildPisiExpandedIntegritySection(container);
    });
}

const moduleApi = {
    PISI_INTEGRITY_UI,
    integrityText,
    makeIntegrityIssueRow,
    makeRepairPlan,
    renderIntegrityReport,
    buildPisiExpandedIntegritySection,
    initializePisiExpandedIntegrity
};

registerModule('portability.integrity', moduleApi);
initializePisiExpandedIntegrity();

export {
    PISI_INTEGRITY_UI,
    buildPisiExpandedIntegritySection,
    integrityText,
    makeIntegrityIssueRow,
    makeRepairPlan,
    renderIntegrityReport
};