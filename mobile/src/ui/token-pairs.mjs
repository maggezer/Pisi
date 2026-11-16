// Which colour tokens are drawn on which, and the contrast each pair must
// reach (docs/mobile-plan.md M3): text 4.5:1, interface elements 3:1.
// A component may only combine colours that are listed here.

export const PISI_TEXT_CONTRAST = 4.5;
export const PISI_UI_CONTRAST = 3;

const SURFACES = ['--pisi-bg', '--pisi-surface', '--pisi-surface-2'];
const on = (foreground, backgrounds, kind) => backgrounds.map((background) => ({ foreground, background, kind }));

export const PISI_TOKEN_PAIRS = Object.freeze([
    // Text and icons that carry meaning.
    ...on('--pisi-text', [...SURFACES, '--pisi-surface-3', '--pisi-accent-soft'], 'text'),
    ...on('--pisi-muted', SURFACES, 'text'),
    ...on('--pisi-accent-text', [...SURFACES, '--pisi-accent-soft'], 'text'),
    ...on('--pisi-danger-text', SURFACES, 'text'),
    ...on('--pisi-success-text', SURFACES, 'text'),
    ...on('--pisi-on-accent', ['--pisi-accent'], 'text'),
    ...on('--pisi-on-danger', ['--pisi-danger'], 'text'),
    ...on('--pisi-inverse-text', ['--pisi-inverse-surface'], 'text'),
    ...on('--pisi-inverse-accent', ['--pisi-inverse-surface'], 'text'),
    // Control outlines, state marks and focus rings.
    ...on('--pisi-border', SURFACES, 'ui'),
    ...on('--pisi-accent-text', SURFACES, 'ui'),
    ...on('--pisi-danger', SURFACES, 'ui'),
    // The Calendar tab's dot for a day whose tasks are all done.
    ...on('--pisi-success-text', SURFACES, 'ui'),
    ...on('--pisi-inverse-surface', ['--pisi-bg', '--pisi-surface'], 'ui'),
    // Marks on the selected day of the date wheel, and the task priority marks.
    ...on('--pisi-on-accent', ['--pisi-accent'], 'ui'),
    ...[1, 2, 3, 4, 5].flatMap((level) => on(`--pisi-priority-${level}`, SURFACES, 'ui'))
]);
