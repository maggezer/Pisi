from pathlib import Path
import re

runtime_path = Path('main/runtime.js')
runtime = runtime_path.read_text(encoding='utf-8')
block_pattern = re.compile(
    r'const moduleApi = \{\};\n'
    r'Object\.defineProperties\(moduleApi, \{.*?\n\}\);\n'
    r'registerMainModule\("main\.runtime", moduleApi\);',
    re.S
)
blocks = list(block_pattern.finditer(runtime))
if not blocks:
    raise SystemExit('No main.runtime registration blocks were generated.')

pieces = []
cursor = 0
for index, match in enumerate(blocks, 1):
    pieces.append(runtime[cursor:match.start()])
    pieces.append(match.group(0).replace('moduleApi', f'moduleApi{index}'))
    cursor = match.end()
pieces.append(runtime[cursor:])
runtime_path.write_text(''.join(pieces), encoding='utf-8')

repairs = {
    'scripts/check-architecture.js': [
        ("errors.join('" + "\n" + "')", r"errors.join('\n')"),
    ],
    'tests/source-bundle.js': [
        (".join('" + "\n\n" + "')", r".join('\n\n')"),
    ],
    'tests/source-invariants.test.js': [
        (".join('" + "\n" + "');", r".join('\n');"),
    ],
}
for file_name, file_replacements in repairs.items():
    file_path = Path(file_name)
    text = file_path.read_text(encoding='utf-8')
    for old, new in file_replacements:
        if old not in text:
            raise SystemExit(f'Generated newline fragment not found in {file_name}.')
        text = text.replace(old, new)
    file_path.write_text(text, encoding='utf-8')

eslint_template = Path('scripts/eslint-config-template.txt')
if not eslint_template.exists():
    raise SystemExit('ESLint template is missing.')
Path('eslint.config.js').write_text(
    eslint_template.read_text(encoding='utf-8'),
    encoding='utf-8'
)
