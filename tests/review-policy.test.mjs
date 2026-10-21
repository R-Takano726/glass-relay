import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('review policy migration preserves settings, rejects unknown legacy rules and is idempotent', () => {
  execFileSync('python3', ['skills/relay/scripts/test_install_policy.py'], { stdio: 'pipe' })
})
