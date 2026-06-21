import { IncrementalDomRenderer } from "incremark-renderer";
import { attachCopyDelegation, detachCopyDelegation } from "./code-block";
import { hydrateMermaidBlocks } from "./extensions/mermaid";
import { buildStreamOptions } from "./options";

export class StreamHost {
  private readonly root: HTMLElement;
  private renderer: IncrementalDomRenderer;
  private pending = "";
  private rafId = 0;
  private lastContent = "";
  private destroyed = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderer = new IncrementalDomRenderer(root, buildStreamOptions());
    attachCopyDelegation(root);
  }

  setContent(text: string): void {
    this.flushPending();
    this.lastContent = text;
    this.renderer.reset();
    if (text) {
      this.renderer.setMarkdown(text);
    }
    void this.afterRender();
  }

  appendChunk(chunk: string): void {
    if (!chunk || this.destroyed) {
      return;
    }
    this.pending += chunk;
    this.lastContent += chunk;
    if (this.rafId) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const batch = this.pending;
      this.pending = "";
      if (batch) {
        this.renderer.append(batch);
        void this.afterRender();
      }
    });
  }

  finishStream(): void {
    this.flushPending();
    this.renderer.finalize();
    void this.afterRender(true);
  }

  getContent(): string {
    return this.lastContent;
  }

  destroy(): void {
    this.destroyed = true;
    this.flushPending();
    detachCopyDelegation(this.root);
    this.renderer.reset();
    this.root.replaceChildren();
  }

  private flushPending(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.pending) {
      this.renderer.append(this.pending);
      this.pending = "";
    }
  }

  private async afterRender(final = false): Promise<void> {
    if (final) {
      await hydrateMermaidBlocks(this.root);
      return;
    }
    void hydrateMermaidBlocks(this.root);
  }
}
