import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('review', Path(__file__).resolve().parents[1] / 'skills/relay/scripts/review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class MobileReviewTests(unittest.TestCase):
    def test_wsl_nvm_binary_without_interactive_path(self):
        with tempfile.TemporaryDirectory() as root:
            binary = Path(root) / '.nvm/versions/node/v24.16.0/bin/claude'
            binary.parent.mkdir(parents=True)
            binary.touch()
            (binary.parent / 'node').touch()
            with patch.object(review.Path, 'home', return_value=Path(root)), patch.object(review.shutil, 'which', return_value=None):
                self.assertEqual(review.executable('claude'), str(binary))

    def test_subscription_only_environment(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'private', 'ANTHROPIC_AUTH_TOKEN': 'private',
                                     'OPENAI_API_KEY': 'private', 'CODEX_API_KEY': 'private',
                                     'CLAUDE_CODE_USE_BEDROCK': '1', 'CLAUDECODE': '1', 'PATH': '/bin'}):
            env = review.environment()
        self.assertNotIn('ANTHROPIC_API_KEY', env)
        self.assertNotIn('ANTHROPIC_AUTH_TOKEN', env)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('CLAUDECODE', env)
        self.assertNotIn('CODEX_API_KEY', env)
        self.assertNotIn('CLAUDE_CODE_USE_BEDROCK', env)
        self.assertEqual(env['PATH'], '/bin')

    def test_exact_models_and_isolation(self):
        claude = review.command('claude', '/bin/claude')
        codex = review.command('codex', '/bin/codex')
        for flag in ['claude-opus-5-5', '--safe-mode', '--no-session-persistence', 'Read,Glob,Grep', '--strict-mcp-config']:
            self.assertIn(flag, claude)
        for flag in ['gpt-6.1-sol', 'read-only', '--ephemeral', '--ignore-user-config']:
            self.assertIn(flag, codex)

    def test_claude_reply_exact_and_fail_closed(self):
        raw = 'レビュー\n`$()`\n原文'
        self.assertEqual(review.parse_reply('claude', json.dumps({'subtype': 'success', 'result': raw})), raw)
        for data in [{'subtype': 'error', 'result': 'old'}, {'subtype': 'success', 'is_error': True}, {'subtype': 'success', 'result': ''}]:
            with self.assertRaises(ValueError):
                review.parse_reply('claude', json.dumps(data))

    def test_codex_reply_requires_completion(self):
        item = {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '原文'}}
        self.assertEqual(review.parse_reply('codex', json.dumps(item)+'\n'+json.dumps({'type': 'turn.completed'})), '原文')
        with self.assertRaises(ValueError):
            review.parse_reply('codex', json.dumps(item))
        with self.assertRaises(ValueError):
            review.parse_reply('codex', json.dumps(item)+'\n'+json.dumps({'type': 'turn.failed'}))

    def test_api_auth_stops_before_model_execution(self):
        auth = subprocess.CompletedProcess([], 0, '{"loggedIn":true,"authMethod":"api_key"}', '')
        with patch.object(review, 'executable', return_value='/fake'), patch.object(review.subprocess, 'run', return_value=auth), patch.object(review, 'invoke') as invoke:
            with self.assertRaisesRegex(ValueError, 'subscription login'):
                review.run('claude', 'source', Path('/tmp'), 30)
            invoke.assert_not_called()

    def test_private_cwd_cleanup_and_literal_prompt(self):
        auth = subprocess.CompletedProcess([], 0, '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}', '')
        seen = []
        def invoke(argv, payload, cwd, env, timeout, provider):
            seen.append(cwd)
            self.assertEqual(Path(cwd).stat().st_mode & 0o777, 0o700)
            self.assertIn('literal $(touch do-not-run)', payload)
            return 'reply'
        with patch.object(review, 'executable', return_value='/fake'), patch.object(review.subprocess, 'run', return_value=auth), patch.object(review, 'invoke', side_effect=invoke):
            self.assertEqual(review.run('claude', 'literal $(touch do-not-run)', Path('/tmp'), 30), 'reply')
        self.assertFalse(Path(seen[0]).exists())

    def test_timeout_terminates_child(self):
        with tempfile.TemporaryDirectory() as root:
            pidfile = Path(root) / 'pid'
            code = 'import os,time;open('+repr(str(pidfile))+',"w").write(str(os.getpid()));time.sleep(20)'
            with self.assertRaises(subprocess.TimeoutExpired):
                review.invoke([sys.executable, '-c', code], 'source', root, review.environment(), .3, 'claude')
            pid = int(pidfile.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def test_nonzero_does_not_echo_private_stderr(self):
        with self.assertRaises(ValueError) as exc:
            review.invoke([sys.executable, '-c', 'import sys;sys.stderr.write("secret");sys.exit(2)'], 'source', '/tmp', review.environment(), 5, 'claude')
        self.assertNotIn('secret', str(exc.exception))

    def test_sigterm_cleans_up_review_process(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            binary = base / '.local/bin/claude'
            binary.parent.mkdir(parents=True)
            binary.write_text('#!' + sys.executable + '\nimport sys,json,os,time\n'
                              'if "status" in sys.argv:\n print(json.dumps({"loggedIn":True,"authMethod":"claude.ai","apiProvider":"firstParty"}))\n'
                              'else:\n open(os.environ["RELAY_TEST_PID"],"w").write(str(os.getpid()))\n time.sleep(30)\n')
            binary.chmod(0o700)
            prompt = base / 'prompt'
            prompt.write_text('fixture')
            pidfile = base / 'pid'
            env = {**os.environ, 'HOME': root, 'RELAY_TEST_PID': str(pidfile)}
            process = subprocess.Popen([sys.executable, str(Path(review.__file__)), '--provider', 'claude', '--cwd', root, '--prompt-file', str(prompt)], env=env, stdout=subprocess.PIPE, text=True)
            try:
                for _ in range(100):
                    if pidfile.exists() and pidfile.read_text().strip():
                        break
                    time.sleep(.02)
                self.assertTrue(pidfile.exists())
                child = int(pidfile.read_text())
                process.terminate()
                output, _ = process.communicate(timeout=5)
                self.assertEqual(json.loads(output)['status'], 'failed')
                self.assertIn('unknown', json.loads(output)['error'])
                with self.assertRaises(ProcessLookupError):
                    os.kill(child, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    unittest.main()
