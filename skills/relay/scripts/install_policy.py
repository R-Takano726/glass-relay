#!/usr/bin/env python3
"""Install the shared Relay review rule without replacing unrelated instructions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

BEGIN = '<!-- relay-review:begin -->'
END = '<!-- relay-review:end -->'


LEGACY = json.loads((Path(__file__).resolve().parents[1] / 'references/legacy-review-policy.json').read_text(encoding='utf-8'))


def remove_legacy(text):
    # Match only reviewed complete paragraphs. Unknown variants fail closed.
    parts = re.split(r'(\r?\n[ \t]*\r?\n)', text)
    suspicious = ('## Claude Codeとの相互レビュー', '2026-10-19の本人指定。',
                  '逆方向（Claude→Codex）はGPT 6.1 Sol Mediumの',
                  '**自動レビュー発動条件**', '**Codexの呼び出し方**', '**Codex呼び出し時のお作法**')
    for index in range(0, len(parts), 2):
        key = parts[index].replace('\r\n', '\n').strip()
        if key in LEGACY:
            newline = '\r\n' if '\r\n' in parts[index] else '\n'
            parts[index] = LEGACY[key].replace('\n', newline)
        elif key.startswith(suspicious):
            raise ValueError('Unrecognized legacy review paragraph; inspect the diff before migrating. Original preserved.')
    return ''.join(parts)


def render(old, template, skill_path):
    if old.count(BEGIN) != old.count(END) or old.count(BEGIN) > 1:
        raise ValueError('Malformed Relay review markers; original file preserved')
    newline = '\r\n' if '\r\n' in old else '\n'
    body = template.replace('{{SKILL_PATH}}', str(skill_path)).strip().replace('\r\n', '\n').replace('\n', newline)
    policy = BEGIN + newline + body + newline + END
    if BEGIN in old:
        if old.index(BEGIN) > old.index(END):
            raise ValueError('Reversed Relay review markers; original file preserved')
        # Managed block is the sole source after the initial migration.
        return re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), lambda _: policy, old, flags=re.S)
    cleaned = remove_legacy(old)
    return cleaned.rstrip() + newline * 2 + policy + newline


def install(root, apply=False):
    skill = Path(__file__).resolve().parents[1]
    template = (skill / 'references/global-policy.md').read_text(encoding='utf-8')
    results = []
    plans = []
    for agent, relative in [('codex', '.codex/AGENTS.md'), ('claude', '.claude/CLAUDE.md')]:
        target = root / relative
        if target.is_symlink():
            raise ValueError(f'{target} is a symlink; original preserved')
        old = target.read_bytes().decode('utf-8') if target.exists() else ''
        updated = render(old, template, skill / 'SKILL.md')
        plans.append((agent, target, old, updated))
    # Validate both instruction files before writing either one.
    for agent, target, old, updated in plans:
        changed = updated != old
        backup = None
        if changed and apply:
            backup_dir = root / '.local/state/glass-relay/instruction-backups'
            backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            if target.exists():
                fd, backup = tempfile.mkstemp(prefix=agent + '-', suffix='.md', dir=backup_dir)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(old.encode('utf-8'))
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temp = tempfile.mkstemp(prefix='.relay-policy-', dir=target.parent)
            try:
                if target.exists():
                    os.fchmod(fd, target.stat().st_mode & 0o777)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(updated.encode('utf-8'))
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp, target)
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
        results.append({'agent': agent, 'path': str(target), 'changed': changed,
                        'applied': bool(changed and apply), 'backup': backup,
                        'sha256': hashlib.sha256(updated.encode()).hexdigest()})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write after backing up the originals')
    parser.add_argument('--home', type=Path, default=Path.home(), help='Override only for isolated installation tests')
    args = parser.parse_args()
    print(json.dumps(install(args.home, args.apply), ensure_ascii=False))


if __name__ == '__main__':
    main()
