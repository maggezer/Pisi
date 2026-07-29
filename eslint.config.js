'use strict';

const correctnessRules = {
    'no-constant-binary-expression': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error'
};

module.exports = [
    {
        ignores: [
            'dist/**',
            'node_modules/**'
        ]
    },
    {
        files: [
            'eslint.config.js',
            'main.js',
            'preload.js',
            'scripts/**/*.js',
            'tests/**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                Buffer: 'readonly',
                __dirname: 'readonly',
                clearTimeout: 'readonly',
                console: 'readonly',
                exports: 'readonly',
                globalThis: 'readonly',
                module: 'readonly',
                process: 'readonly',
                require: 'readonly',
                setTimeout: 'readonly',
                structuredClone: 'readonly'
            }
        },
        rules: {
            ...correctnessRules,
            'no-undef': 'error'
        }
    },
    {
        files: [
            'app.js',
            'renderer/**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script'
        },
        rules: correctnessRules
    }
];
