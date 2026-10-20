import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('mobile review: subscription auth, exact replies, isolation and timeout cleanup', () => {
  execFileSync('python3', ['tests/mobile_review_test.py'], { stdio: 'pipe' })
})
