from pathlib import Path
import re

path = Path('scripts/refactor-architecture.js')
source = path.read_text(encoding='utf-8')

replacements = {
    "throw new Error(`[PISI] Renderer module already registered: ${moduleName}`);":
        "throw new Error('[PISI] Renderer module already registered: ' + moduleName);",
    "`[PISI] Renderer binding collision: ${key} (${previousOwner} / ${moduleName})`":
        "'[PISI] Renderer binding collision: ' + key + ' (' + previousOwner + ' / ' + moduleName + ')'",
    "throw new Error(`[PISI] Renderer global already exists: ${key}`);":
        "throw new Error('[PISI] Renderer global already exists: ' + key);",
    "throw new TypeError(`[PISI] Read-only renderer binding: ${key}`);":
        "throw new TypeError('[PISI] Read-only renderer binding: ' + key);",
    "`[PISI] Main binding collision: ${key} (${previousOwner} / ${moduleName})`":
        "'[PISI] Main binding collision: ' + key + ' (' + previousOwner + ' / ' + moduleName + ')'",
    "throw new Error(`[PISI] Main binding registered twice: ${moduleName}.${key}`);":
        "throw new Error('[PISI] Main binding registered twice: ' + moduleName + '.' + key);",
    "throw new Error(`[PISI] Main global already exists: ${key}`);":
        "throw new Error('[PISI] Main global already exists: ' + key);",
    "throw new TypeError(`[PISI] Read-only main binding: ${key}`);":
        "throw new TypeError('[PISI] Read-only main binding: ' + key);",
    "else console.log(`${files.length} JavaScript/ES module dosyası sözdizimi kontrolünden geçti.`);":
        "else console.log(files.length + ' JavaScript/ES module dosyası sözdizimi kontrolünden geçti.');",
    "errors.push(`Expected one renderer module bootstrap, found: ${moduleScripts.join(', ')}`);":
        "errors.push('Expected one renderer module bootstrap, found: ' + moduleScripts.join(', '));",
    "errors.push(`Legacy renderer file remains: ${oldFile}`);":
        "errors.push('Legacy renderer file remains: ' + oldFile);",
    "errors.push(`Duplicate module binding ${binding}: ${owners.get(binding)} / ${module.module}`);":
        "errors.push('Duplicate module binding ' + binding + ': ' + owners.get(binding) + ' / ' + module.module);",
    "errors.push(`Renderer module too large (${lines}): ${file}`);":
        "errors.push('Renderer module too large (' + lines + '): ' + file);",
    "if (lines > 1100) errors.push(`Main domain module too large (${lines}): ${file}`);":
        "if (lines > 1100) errors.push('Main domain module too large (' + lines + '): ' + file);",
    r"if (/!important\\b/.test(css)) errors.push(`!important remains in ${file}`);":
        r"if (/!important\\b/.test(css)) errors.push('!important remains in ' + file);",
    "errors.push(`Duplicate CSS selector ${selector}: ${selectorOwners.get(selector)} / ${file}`);":
        "errors.push('Duplicate CSS selector ' + selector + ': ' + selectorOwners.get(selector) + ' / ' + file);",
}

missing = [old for old in replacements if old not in source]
if missing:
    raise SystemExit('Expected codemod fragments were not found:\n' + '\n'.join(missing))
for old, new in replacements.items():
    source = source.replace(old, new)

structural_replacements = {
    "if (line <= 2407) return ['renderer/shell/pisi-tabs.mjs', 'shell.tabs'];":
        "if (line <= 2250) return ['renderer/shell/pisi-tabs.mjs', 'shell.tabs'];",
    "if (line <= 900) return ['main/functions/filesystem-core.js', 'main.filesystemCore'];":
        "if (line <= 450) return ['main/functions/path-security.js', 'main.pathSecurity'];\n    if (line <= 900) return ['main/functions/filesystem-core.js', 'main.filesystemCore'];",
    "    const requires = [\n        './main/functions/filesystem-core',":
        "    const requires = [\n        './main/functions/path-security',\n        './main/functions/filesystem-core',",
}
missing_structural = [old for old in structural_replacements if old not in source]
if missing_structural:
    raise SystemExit('Expected structural fragments were not found:\n' + '\n'.join(missing_structural))
for old, new in structural_replacements.items():
    source = source.replace(old, new)

pattern = re.compile(
    r"const mainSource = `\$\{read\('main\.js'\)\}(?:\\n|\n)"
    r"\$\{readMainSource\(\)\}(?:\\n|\n)"
    r"\$\{read\('main/runtime\.js'\)\}`;"
)
source, count = pattern.subn(
    "const mainSource = [read('main.js'), readMainSource(), read('main/runtime.js')].join('\\\\n');",
    source
)
if count != 1:
    raise SystemExit(f'Expected one multiline test template, replaced {count}.')

duplicate_guard = """    const duplicates = [...remainingDuplicates.entries()].filter(([, count]) => count > 1);
    if (duplicates.length) {
        throw new Error(`CSS duplicate selectors remain: ${JSON.stringify(duplicates)}`);
    }
"""
duplicate_merge = """    const duplicates = [...remainingDuplicates.entries()].filter(([, count]) => count > 1);
    if (duplicates.length) {
        css = mergeCssSelectors(css, duplicates.map(([selector]) => selector));
    }

    const unresolvedDuplicates = new Map();
    for (const block of scanRootBlocks(css)) {
        if (!block.selector || block.selector.startsWith('@')) continue;
        unresolvedDuplicates.set(
            block.selector,
            (unresolvedDuplicates.get(block.selector) || 0) + 1
        );
    }
    const unresolved = [...unresolvedDuplicates.entries()].filter(([, count]) => count > 1);
    if (unresolved.length) {
        throw new Error('CSS duplicate selectors remain: ' + JSON.stringify(unresolved));
    }
"""
if duplicate_guard not in source:
    raise SystemExit('CSS duplicate guard fragment was not found.')
source = source.replace(duplicate_guard, duplicate_merge)

path.write_text(source, encoding='utf-8')
