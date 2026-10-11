export const SELECTORS = {
  editor: 'textarea.chat-panel__input-container',
  send: '.chat-send__button',
  message: '.msg-item .msg-text',
};
export class FileHelper {
  constructor(page, selectors = {}) { this.page = page; this.selectors = { ...SELECTORS, ...selectors }; }
  async loggedIn() { return this.page.locator(this.selectors.editor).isVisible(); }
  async messages() {
    // DOM text only. Never read framework state, cookies, storage or network auth.
    return this.page.locator(this.selectors.message).evaluateAll(nodes => {
      window.__wechatAgentNodes ??= new WeakMap();
      window.__wechatAgentCounter ??= 0;
      return nodes.map(node => {
        if (!window.__wechatAgentNodes.has(node)) window.__wechatAgentNodes.set(node, String(++window.__wechatAgentCounter));
        return { id: window.__wechatAgentNodes.get(node), text: node.innerText };
      });
    });
  }
  async send(body) {
    const text = `[AI] ${body}`;
    const before = (await this.messages()).filter(m => m.text === text).length;
    await this.page.locator(this.selectors.editor).fill(text);
    await this.page.locator(this.selectors.send).click();
    // Confirmation is local UI visibility, not delivery/read confirmation on phone.
    await this.page.waitForFunction(({ selector, text, before }) =>
      [...document.querySelectorAll(selector)].filter(n => n.innerText === text).length > before,
      { selector: this.selectors.message, text, before }, { timeout: 10000 });
  }
}
