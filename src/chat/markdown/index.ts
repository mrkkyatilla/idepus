import { IncrementalDomRenderer } from "incremark-renderer";
import {
  attachCopyDelegation,
  detachCopyDelegation,
} from "./code-block";
import { hydrateMermaidBlocks } from "./extensions/mermaid";
import { buildStreamOptions } from "./options";
import { renderStaticHtml } from "./static-renderer";
import { StreamHost } from "./stream-host";

export type MarkdownMount = {
  setContent(text: string): void;
  appendChunk?(chunk: string): void;
  finishStream?(): void;
  destroy(): void;
};

export type MountMarkdownOptions = {
  mode: "static" | "stream";
  className?: string;
  compact?: boolean;
};

export function mountMarkdown(
  host: HTMLElement,
  opts: MountMarkdownOptions,
): MarkdownMount {
  host.classList.add("md-body");
  if (opts.compact) {
    host.classList.add("md-body--compact");
  }
  if (opts.className) {
    host.classList.add(opts.className);
  }

  if (opts.mode === "stream") {
    const stream = new StreamHost(host);
    return {
      setContent(text: string) {
        stream.setContent(text);
      },
      appendChunk(chunk: string) {
        stream.appendChunk(chunk);
      },
      finishStream() {
        stream.finishStream();
      },
      destroy() {
        stream.destroy();
      },
    };
  }

  let renderer: IncrementalDomRenderer | null = null;
  let lastText = "";
  attachCopyDelegation(host);

  function renderStatic(text: string): void {
    lastText = text;
    if (!renderer) {
      renderer = new IncrementalDomRenderer(host, buildStreamOptions());
    } else {
      renderer.reset();
    }
    if (text) {
      renderer.setMarkdown(text);
      renderer.finalize();
    }
    void hydrateMermaidBlocks(host);
  }

  return {
    setContent(text: string) {
      if (text === lastText) {
        return;
      }
      renderStatic(text);
    },
    destroy() {
      detachCopyDelegation(host);
      renderer?.reset();
      renderer = null;
      host.replaceChildren();
      host.classList.remove("md-body", "md-body--compact");
      if (opts.className) {
        host.classList.remove(opts.className);
      }
    },
  };
}

/** One-shot helper for surfaces that re-render frequently. */
export function renderAiText(
  host: HTMLElement,
  text: string,
  opts?: { compact?: boolean; className?: string },
): MarkdownMount {
  host.replaceChildren();
  const mount = mountMarkdown(host, {
    mode: "static",
    compact: opts?.compact,
    className: opts?.className,
  });
  mount.setContent(text);
  return mount;
}

/** Backward-compatible HTML string API for tests and legacy callers. */
export function renderMarkdown(text: string): string {
  return renderStaticHtml(text);
}

export { sanitizeHtml } from "./sanitize-config";
