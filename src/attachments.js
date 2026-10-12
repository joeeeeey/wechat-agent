import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_BYTES = 10 * 1024 * 1024;
export function attachmentRequest(text) {
  const match = /^读取附件\s+(A[1-9]\d*)(?:\s+([\s\S]+))?$/.exec(text);
  return match ? { id: match[1], instruction: match[2] || '请读取并概述这个附件。' } : null;
}

// Explicit relative selectors must identify attachment content, not avatars or QR UI.
// Disabled by default until selectors are verified in a separate login session.
export class AttachmentReader {
  constructor(page, config = {}) {
    this.page = page;
    this.config = config;
    this.items = new Map();
  }
  async scan() {
    if (!this.config.enabled) return [];
    const fresh = [];
    for (const [kind, selector] of [['image', this.config.imageSelector], ['file', this.config.fileSelector]]) {
      if (!selector) continue;
      const nodes = this.page.locator('.msg-item').locator(selector);
      const count = await nodes.count();
      for (let index = Math.max(0, count - 200); index < count; index++) {
        const node = nodes.nth(index);
        const info = await node.evaluate((element, kind) => {
          if (!element.closest('.msg-item') || (kind === 'image' ? element.tagName !== 'IMG' : element.tagName !== 'A')) return null;
          window.__wechatAttachmentNodes ??= new WeakMap();
          window.__wechatAttachmentCounter ??= 0;
          if (!window.__wechatAttachmentNodes.has(element)) window.__wechatAttachmentNodes.set(element, `A${++window.__wechatAttachmentCounter}`);
          return { id: window.__wechatAttachmentNodes.get(element), kind };
        }, kind);
        if (!info || this.items.has(info.id) || !(await node.isVisible())) continue;
        this.items.set(info.id, { ...info, seenAt: Date.now() });
        fresh.push(info);
      }
    }
    // Bounded metadata only; no URLs, names, contents, or browser auth persisted.
    while (this.items.size > 400) this.items.delete(this.items.keys().next().value);
    return fresh;
  }
  async capture(id, directory) {
    const item = this.items.get(id);
    if (!item || Date.now() - item.seenAt > 10 * 60 * 1000) throw new Error('Attachment unavailable or expired');
    const selector = item.kind === 'image' ? this.config.imageSelector : this.config.fileSelector;
    const nodes = this.page.locator('.msg-item').locator(selector);
    let node;
    const count = await nodes.count();
    for (let i = Math.max(0, count - 200); i < count; i++) {
      const candidate = nodes.nth(i);
      if (await candidate.evaluate((element, id) => window.__wechatAttachmentNodes?.get(element) === id, id)) { node = candidate; break; }
    }
    if (!node || !(await node.isVisible())) throw new Error('Attachment no longer visible');
    let bytes, extension;
    if (item.kind === 'image') {
      const box = await node.boundingBox();
      const loaded = await node.evaluate(n => n.complete && n.naturalWidth > 0);
      if (!loaded || !box || box.width * box.height > 4000000) throw new Error('Image unavailable or too large');
      bytes = await node.screenshot({ type: 'png', timeout: 5000 });
      extension = '.png'; // Rendered preview only, never claim original resolution.
    } else {
      const result = await node.evaluate(async (element, limit) => {
        // Only already-local browser blobs. No clicks, navigation, auth reads,
        // remote requests, redirects, or signed URL export.
        const url = new URL(element.href, location.href);
        if (url.protocol !== 'blob:' || url.origin !== location.origin) throw new Error('Local blob required');
        const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(5000) });
        if (!response.ok || !response.body) throw new Error('Blob unavailable');
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new Error('File too large');
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const blob = new Blob(chunks);
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
        });
        const suffix = /\.(txt|md|csv|json|pdf|png|jpe?g|webp|docx|xlsx)$/i.exec(element.download || '')?.[0]?.toLowerCase() || '.bin';
        return { encoded, suffix };
      }, MAX_BYTES);
      bytes = Buffer.from(result.encoded, 'base64'); extension = result.suffix;
    }
    if (bytes.length > MAX_BYTES) throw new Error('Attachment too large');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, randomUUID() + extension);
    await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    return { id, kind: item.kind, path: target, bytes: bytes.length, representation: item.kind === 'image' ? 'rendered preview, not original' : 'local blob file' };
  }
}
