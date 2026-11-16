// Shared helpers for the Electron E2E scripts that drive the renderer over CDP.

/**
 * Wraps a `Runtime.evaluate` expression so that a promise it returns stays
 * strongly referenced in the page until it settles.
 *
 * With `awaitPromise: true` the V8 inspector holds the returned promise only
 * weakly. While an async renderer function waits on IPC (a contextBridge
 * promise), a garbage collection can collect that promise even though the
 * function later finishes, and CDP then rejects with "Promise was collected".
 * Keeping the promise in a page-level set until it settles prevents that.
 * Values that are not promises are returned unchanged.
 *
 * The expression is placed on its own lines so a trailing `//` comment cannot
 * swallow the closing parenthesis. A statement list such as
 * `window.close(); true` cannot be wrapped as an expression; it is sent
 * unchanged (it is only compiled here to check, never run).
 *
 * @param {string} expression
 * @returns {string}
 */
export function keepPagePromise(expression) {
    const wrapped = [
        '(() => {',
        'const value = (',
        String(expression),
        ');',
        "if (!value || typeof value.then !== 'function') return value;",
        'const keep = (globalThis.__pisiE2EPendingPromises ||= new Set());',
        'keep.add(value);',
        'const release = () => keep.delete(value);',
        'value.then(release, release);',
        'return value;',
        '})()'
    ].join('\n');
    try {
        new Function(wrapped);
    } catch {
        return String(expression);
    }
    return wrapped;
}
