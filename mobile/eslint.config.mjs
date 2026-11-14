// Lint rules for the mobile package. Formatting is Prettier's job (root .prettierrc.json).

const correctness = {
    'no-constant-binary-expression': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error',
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }]
};

const browserGlobals = {
    console: 'readonly',
    document: 'readonly',
    getComputedStyle: 'readonly',
    navigator: 'readonly',
    window: 'readonly',
    Intl: 'readonly',
    Node: 'readonly'
};

const nodeGlobals = { console: 'readonly', process: 'readonly' };

export default [
    { ignores: ['node_modules/**', 'dist/**', 'android/**', 'test-results/**', 'playwright-report/**', 'e2e/screenshots/**'] },
    {
        files: ['src/**/*.mjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: browserGlobals },
        rules: {
            ...correctness,
            // Native dialogs block the WebView and ignore the theme.
            'no-restricted-globals': ['error', 'alert', 'confirm', 'prompt']
        }
    },
    {
        files: ['tests/**/*.mjs', 'e2e/**/*.mjs', 'scripts/**/*.mjs', '*.mjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...browserGlobals, ...nodeGlobals } },
        rules: correctness
    }
];
