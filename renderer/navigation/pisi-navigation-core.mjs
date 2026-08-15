function normalizePisiNavigationPath(value = '', caseInsensitive = false) {
    const normalized = String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
    return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function normalizePisiNavigationText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getPisiTaskNavigationTaskId(value = {}) {
    const candidates = [value?.taskId, value?.missionId, value?.id];
    for (const candidate of candidates) {
        const id = String(candidate || '').trim();
        if (/^task_[A-Za-z0-9._:-]{4,180}$/.test(id)) return id;
    }
    return '';
}

function scorePisiTaskNavigationCandidate(candidate = {}, target = {}, options = {}) {
    const caseInsensitive = options.caseInsensitive === true;
    const targetTaskId = getPisiTaskNavigationTaskId(target);
    const candidateTaskId = getPisiTaskNavigationTaskId(candidate);
    const targetBlockId = String(target.blockId || '').trim();
    const candidateBlockId = String(candidate.blockId || '').trim();
    const targetPath = normalizePisiNavigationPath(target.nodePath, caseInsensitive);
    const candidatePath = normalizePisiNavigationPath(candidate.nodePath, caseInsensitive);
    const targetTodo = normalizePisiNavigationText(target.todoTag).toLowerCase();
    const candidateTodo = normalizePisiNavigationText(candidate.todoTag).toLowerCase();
    const targetText = normalizePisiNavigationText(
        target.sourceText || target.title || target.text
    );
    const candidateText = normalizePisiNavigationText(
        candidate.sourceText || candidate.title || candidate.text
    );

    let score = 0;
    if (targetTaskId && candidateTaskId === targetTaskId) score += 100000;
    if (targetBlockId && candidateBlockId === targetBlockId) score += 10000;
    if (targetPath && candidatePath === targetPath) score += 1000;
    if (targetTodo && candidateTodo === targetTodo) score += 100;
    if (targetText && candidateText === targetText) score += 10;
    if (!candidate.nodePath) score -= 1000000;
    return score;
}

function selectPisiTaskNavigationCandidate(candidates = [], target = {}, options = {}) {
    let best = null;
    let bestScore = 0;

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const score = scorePisiTaskNavigationCandidate(candidate, target, options);
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }

    return best ? { candidate: best, score: bestScore } : null;
}

export {
    getPisiTaskNavigationTaskId,
    normalizePisiNavigationPath,
    normalizePisiNavigationText,
    scorePisiTaskNavigationCandidate,
    selectPisiTaskNavigationCandidate
};
