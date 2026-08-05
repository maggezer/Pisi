'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

const editorPath = 'renderer/tags/pisi-tag-editor.mjs';
let editor = read(editorPath);
const navigationMatch = editor.match(
    /let pisiMissionHighlightAnimation = null;[\s\S]*?(?=const PISI_SYSTEM_TAGS)/
);

if (!navigationMatch) {
    throw new Error('Todo navigation implementation block was not found.');
}

const navigationImplementation = navigationMatch[0].trimEnd();
editor = editor.replace(navigationMatch[0], '');

for (const binding of [
    'openPisiTagBlockResult',
    'highlightPisiEditorBlock'
]) {
    const descriptorPattern = new RegExp(
        `    "${binding}": \\{\\n` +
        `        enumerable: true,\\n` +
        `        get\\(\\) \\{ return ${binding}; \\}\\n` +
        `    \\},\\n`
    );

    if (!descriptorPattern.test(editor)) {
        throw new Error(`Tag editor descriptor was not found: ${binding}`);
    }

    editor = editor.replace(descriptorPattern, '');
}

write(editorPath, editor);

const navigationPath = 'renderer/tags/pisi-todo-navigation.mjs';
const navigationModule = `import { registerModule } from "../core/module-registry.mjs";

${navigationImplementation}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "openPisiTagBlockResult": {
        enumerable: true,
        get() { return openPisiTagBlockResult; }
    },
    "highlightPisiEditorBlock": {
        enumerable: true,
        get() { return highlightPisiEditorBlock; }
    },
    "bindPisiMissionHighlightSanitizer": {
        enumerable: true,
        get() { return bindPisiMissionHighlightSanitizer; }
    }
});

registerModule("tags.todoNavigation", moduleApi);

export {
    openPisiTagBlockResult,
    highlightPisiEditorBlock,
    bindPisiMissionHighlightSanitizer
};
`;
write(navigationPath, navigationModule);

const bootstrapPath = 'renderer/bootstrap.mjs';
let bootstrap = read(bootstrapPath);
const editorImport = 'import "./tags/pisi-tag-editor.mjs";';
const navigationImport = 'import "./tags/pisi-todo-navigation.mjs";';

if (!bootstrap.includes(editorImport)) {
    throw new Error('Tag editor bootstrap import was not found.');
}

if (!bootstrap.includes(navigationImport)) {
    bootstrap = bootstrap.replace(
        editorImport,
        `${navigationImport}\n${editorImport}`
    );
}
write(bootstrapPath, bootstrap);

const manifestPath = 'renderer/module-manifest.json';
const manifest = JSON.parse(read(manifestPath));
const editorEntry = manifest.find((entry) => entry.module === 'tags.editor');
if (!editorEntry) throw new Error('tags.editor manifest entry was not found.');

editorEntry.bindings = editorEntry.bindings.filter((binding) => {
    return binding !== 'openPisiTagBlockResult' &&
        binding !== 'highlightPisiEditorBlock';
});

const existingNavigationIndex = manifest.findIndex((entry) => {
    return entry.module === 'tags.todoNavigation';
});
if (existingNavigationIndex >= 0) manifest.splice(existingNavigationIndex, 1);

const editorIndex = manifest.findIndex((entry) => entry.module === 'tags.editor');
manifest.splice(editorIndex, 0, {
    module: 'tags.todoNavigation',
    path: navigationPath,
    bindings: [
        'openPisiTagBlockResult',
        'highlightPisiEditorBlock',
        'bindPisiMissionHighlightSanitizer'
    ]
});
write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const regressionTestPath = 'tests/todo-navigation-filter-regression.test.js';
let regressionTest = read(regressionTestPath);
regressionTest = regressionTest.replace(
    "const source = read('renderer/tags/pisi-tag-editor.mjs');",
    "const source = read('renderer/tags/pisi-todo-navigation.mjs');"
);
regressionTest = regressionTest.replace(
    "    assert.match(source, /target\\.animate\\(/);",
    "    assert.match(source, /target\\.animate\\(/);\n" +
    "    assert.match(read('renderer/bootstrap.mjs'), /pisi-todo-navigation\\.mjs/);"
);
write(regressionTestPath, regressionTest);

const existingTodoTestPath = 'tests/todo-tag.test.js';
let existingTodoTest = read(existingTodoTestPath);
const oldTestSetup =
    "    const firstRelease = read('renderer/tags/pisi-todo-first-release.mjs');\n" +
    "    const editor = read('renderer/tags/pisi-tag-editor.mjs');\n" +
    "    const css = read('styles/50-tags-and-missions.css');";
const newTestSetup =
    "    const firstRelease = read('renderer/tags/pisi-todo-first-release.mjs');\n" +
    "    const navigation = read('renderer/tags/pisi-todo-navigation.mjs');\n" +
    "    const css = read('styles/50-tags-and-missions.css');";

if (!existingTodoTest.includes(oldTestSetup)) {
    throw new Error('Existing Todo navigation test setup was not found.');
}

existingTodoTest = existingTodoTest.replace(oldTestSetup, newTestSetup);
existingTodoTest = existingTodoTest.replace(
    "    assert.match(editor, /highlightPisiEditorBlock\\(block\\.blockId, block\\.todoTag\\)/);",
    "    assert.match(navigation, /await highlightPisiEditorBlock\\(block\\)/);\n" +
    "    assert.match(navigation, /samePisiPathForTags\\(activeModalNode\\?\\.path, mission\\?\\.nodePath\\)/);\n" +
    "    assert.match(navigation, /pisiMissionBlockContainsTodo/);"
);
write(existingTodoTestPath, existingTodoTest);

console.log('Moved Todo navigation into a dedicated renderer module.');
