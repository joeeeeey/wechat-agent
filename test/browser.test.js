import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FileHelper } from '../src/browser.js';
test('isolated DOM fixture: login, identity, reply confirmation, logout', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="login">scan locally</div>');
    const bridge = new FileHelper(page);
    assert.equal(await bridge.loggedIn(), false);
    await page.setContent(`<div id="messages"><div class="msg-item"><div class="msg-text">/ai hello</div></div></div><textarea class="chat-panel__input-container"></textarea><button class="chat-send__button">发送</button><script>document.querySelector('button').onclick=()=>{const row=document.createElement('div');row.className='msg-item';const text=document.createElement('div');text.className='msg-text';text.innerText=document.querySelector('textarea').value;row.append(text);document.querySelector('#messages').append(row)}</script>`);
    assert.equal(await bridge.loggedIn(), true);
    const before = await bridge.messages();
    assert.deepEqual(await bridge.messages(), before);
    await bridge.send('hello');
    const after = await bridge.messages();
    assert.equal(after[1].text, '[AI] hello');
    assert.notEqual(after[0].id, after[1].id);
    await page.locator('textarea').evaluate(n => n.remove());
    assert.equal(await bridge.loggedIn(), false);
  } finally { await browser.close(); }
});
