# Repository formatting

Pisi uses Prettier as its repository-wide source formatter.

## Version

Prettier is pinned exactly in `devDependencies` so local development and CI produce the same output. Do not replace the exact version with a range.

## Commands

Format supported repository files in place:

```bash
npm run format
```

Check formatting without modifying files:

```bash
npm run format:check
```

Run the complete local validation pipeline, including formatting:

```bash
npm run validate
```

`npm run validate:source` contains the previous syntax, architecture, branding, i18n, typecheck, ESLint, and test pipeline without the formatter gate. CI invokes the formatting gate explicitly and then runs `validate:source` so failures remain easy to diagnose.

## Scope

Prettier runs from the repository root and formats all supported source and configuration formats unless excluded by `.prettierignore`.

Generated outputs, dependency trees, Android build caches, release artifacts, generated checkJs declarations, and binary/design assets are excluded.

## CI contract

Both the normal CI workflow and tagged release validation run `npm run format:check`. A formatting difference therefore blocks merge/release instead of being silently rewritten in CI.

Developers should run `npm run format` before committing when their editor is not configured to run Prettier automatically.
