import test from 'node:test';
import assert from 'node:assert/strict';
import { taskText, setup, runHarness, promptFor } from '../src/core.js';
test('only explicit commands; replies cannot loop', () => {
  assert.equal(taskText('[AI] /ai do it'), null);
  assert.equal(taskText('ordinary note'), null);
  assert.equal(taskText('/ai check'), 'check');
});
test('conversational setup requires execution opt-in', () => {
  const s = {}; setup(s, '工作咪'); setup(s, '中文');
  setup(s, 'no'); assert.equal(s.stage, 'permission');
  setup(s, '开启'); assert.equal(s.stage, 'ready');
  assert.match(promptFor(s, 'test'), /CURRENT REQUEST: test/);
});
test('harness receives literal input with no shell interpretation', async () => {
  const input = '$(touch /tmp/DO_NOT_CREATE) `echo secret` \n中文';
  const result = await runHarness({ command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: process.cwd() }, input);
  assert.equal(result, input);
});
test('nonzero exit rejects without exposing stderr', async () => {
  await assert.rejects(runHarness({ command: process.execPath, args: ['-e', 'console.error("private"); process.exit(2)'] }, 'x'), /code 2/);
});
test('timeout stops a hanging harness', async () => {
  await assert.rejects(runHarness({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 }, 'x'), /timed out/);
});
test('output flood bounded', async () => {
  await assert.rejects(runHarness({ command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(1100000))'] }, 'x'), /limit/);
});
