import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('install_policy', Path(__file__).with_name('install_policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def test_preserves_unrelated_and_idempotent(self):
        old = '# User rules\n\nKeep private notes.\n\n<!-- gemini-writing:begin -->\nWrite with Gemini\n<!-- gemini-writing:end -->\n'
        once = policy.render(old, 'policy {{SKILL_PATH}}', '/canonical/relay/SKILL.md')
        self.assertIn(old.rstrip(), once)
        self.assertEqual(once, policy.render(once, 'policy {{SKILL_PATH}}', '/canonical/relay/SKILL.md'))
        self.assertEqual(once.count(policy.BEGIN), 1)

    def test_managed_update_does_not_touch_outside_block(self):
        original = 'before\n' + policy.BEGIN + '\nold\n' + policy.END + '\nafter'
        result = policy.render(original, 'new', '/skill')
        self.assertEqual(result, 'before\n' + policy.BEGIN + '\nnew\n' + policy.END + '\nafter')

    def test_migrates_legacy_codex_only(self):
        old = 'Keep before\n\n## Claude Codeとの相互レビュー\n\n2026-10-19の本人指定。claude-opus-5-5 独立レビューを依頼\n\n逆方向（Claude→Codex）はGPT 6.1 Sol Mediumの cli\n\n## Other\nKeep after\n'
        with patch.dict(policy.LEGACY, {p.strip(): '' for p in old.split('\n\n') if p.startswith(('## Claude Codeとの相互レビュー','2026-10-19の本人指定','逆方向（Claude'))}):
            result = policy.render(old, 'new', '/skill')
        self.assertNotIn('claude-opus-5-5', result)
        self.assertIn('Keep before', result)
        self.assertIn('## Other\nKeep after', result)

    def test_claude_audio_manual_and_custom_are_preserved(self):
        old = '### Codex連携ルール\n\n**自動レビュー発動条件**（old）:\n1. old trigger\n\n**Codexの呼び出し方**:\n- old auto command\n- git差分のレビューは manual plugin\n- 接続確認は setup\n\n**Codex呼び出し時のお作法**:\n- old direct adoption\n\n**音声通知**: keep notification rules\n\nMy custom instruction\n'
        fixtures = {p.strip(): '\n'.join(line for line in p.splitlines() if line.startswith(('- git差分','- 接続確認'))) for p in old.split('\n\n') if p.startswith('**') and not p.startswith('**音声通知**')}
        with patch.dict(policy.LEGACY, fixtures):
            result = policy.render(old, 'new', '/skill')
        for value in ['manual plugin', 'setup', 'keep notification rules', 'My custom instruction']:
            self.assertIn(value, result)
        self.assertNotIn('old auto command', result)
        self.assertNotIn('old direct adoption', result)

    def test_unknown_mixed_rule_stops_without_deleting(self):
        for text in ['**Codex呼び出し時のお作法**:\n- Custom language rule',
                     '**自動レビュー発動条件** changed variant']:
            with self.assertRaises(ValueError):
                policy.render(text, 'new', '/skill')

    def test_crlf_and_unrelated_whitespace_preserved(self):
        original = 'Before  \r\n\r\n**Codexの呼び出し方**:\r\n- reviewed\r\n\r\nAfter\r\n'
        with patch.dict(policy.LEGACY, {'**Codexの呼び出し方**:\n- reviewed': ''}):
            result = policy.render(original, 'new', '/skill')
        self.assertIn('Before  \r\n\r\n', result)
        self.assertIn('After', result)
        self.assertNotIn('reviewed', result)

    def test_bad_markers_fail_closed(self):
        for text in [policy.BEGIN, policy.END, policy.END+'\n'+policy.BEGIN,
                     policy.BEGIN+policy.END+policy.BEGIN+policy.END]:
            with self.assertRaises(ValueError):
                policy.render(text, 'new', '/skill')

    def test_invalid_second_file_does_not_change_first(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / '.codex/AGENTS.md'
            second = root / '.claude/CLAUDE.md'
            first.parent.mkdir()
            second.parent.mkdir()
            first.write_text('Keep original')
            second.write_text(policy.BEGIN)
            with self.assertRaises(ValueError):
                policy.install(root, apply=True)
            self.assertEqual(first.read_text(), 'Keep original')

    def test_real_crlf_install_and_backup_are_byte_preserving(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = 'Keep original\r\n\r\n'.encode()
            for relative in ['.codex/AGENTS.md', '.claude/CLAUDE.md']:
                target = root / relative
                target.parent.mkdir()
                target.write_bytes(original)
            policy.install(root, apply=True)
            for backup in (root/'.local/state/glass-relay/instruction-backups').glob('*.md'):
                self.assertEqual(backup.read_bytes(), original)
            for relative in ['.codex/AGENTS.md', '.claude/CLAUDE.md']:
                raw = (root/relative).read_bytes()
                self.assertNotIn(b'\n', raw.replace(b'\r\n', b''))
            self.assertTrue(all(not r['changed'] for r in policy.install(root)))

    def test_real_install_backups_dry_run_and_two_agent_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ['.codex/AGENTS.md', '.claude/CLAUDE.md']:
                p = root / relative
                p.parent.mkdir()
                p.write_text('Original user instructions\n')
                p.chmod(0o640)
            self.assertTrue(all(r['changed'] for r in policy.install(root)))
            self.assertNotIn(policy.BEGIN, (root/'.codex/AGENTS.md').read_text())
            policy.install(root, apply=True)
            self.assertTrue(all(not r['changed'] for r in policy.install(root, apply=True)))
            backups = list((root/'.local/state/glass-relay/instruction-backups').glob('*.md'))
            self.assertEqual(len(backups), 2)
            self.assertEqual((root/'.codex/AGENTS.md').stat().st_mode & 0o777, 0o640)
            self.assertTrue(all(p.read_text() == 'Original user instructions\n' for p in backups))
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in backups))


if __name__ == '__main__':
    unittest.main()
