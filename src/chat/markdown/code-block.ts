import type {
  CodeBlockHeaderRenderContext,
  CodeBlockRenderContext,
} from "incremark-renderer";

const COLLAPSE_LINE_THRESHOLD = 40;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function renderCodeBlockHeader(
  context: CodeBlockHeaderRenderContext,
): string {
  const lang = context.declaredLanguage || context.language || "text";
  const langBadge = `<span class="md-code-block__lang">${escapeAttr(lang)}</span>`;
  const copyBtn = context.closed
    ? `<button type="button" class="md-code-block__copy" data-copy-code="${encodeURIComponent(context.code)}" title="Copy code">Copy</button>`
    : "";
  return `${langBadge}${copyBtn}`;
}

export function renderCodeBlock(context: CodeBlockRenderContext): string {
  if (context.declaredLanguage === "mermaid" || context.language === "mermaid") {
    return renderMermaidPlaceholder(context);
  }

  const lineCount = context.lineCount || context.code.split("\n").length;
  const collapsible =
    context.closed && lineCount > COLLAPSE_LINE_THRESHOLD;

  if (!collapsible) {
    return context.defaultHtml.replace(
      'class="incremark-code-block"',
      'class="incremark-code-block md-code-block"',
    );
  }

  const inner = context.defaultHtml
    .replace(/^<div class="incremark-code-block"[^>]*>/, "")
    .replace(/<\/div>\s*$/, "");
  const toggleBtn = `<button type="button" class="md-code-block__toggle" title="Expand code">Show ${lineCount} lines</button>`;
  return `<div class="incremark-code-block md-code-block md-code-block--collapsible" data-collapsed="true">${inner}${toggleBtn}</div>`;
}

function renderMermaidPlaceholder(context: CodeBlockRenderContext): string {
  const source = encodeURIComponent(context.code);
  const state = context.closed ? "ready" : "streaming";
  return `<div class="md-mermaid md-mermaid--${state}" data-mermaid-source="${source}"><div class="md-mermaid__loading">Rendering diagram…</div></div>`;
}

export async function copyCodeToClipboard(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const copyHandlers = new WeakMap<HTMLElement, (event: Event) => void>();

export function attachCopyDelegation(root: HTMLElement): void {
  if (copyHandlers.has(root)) {
    return;
  }

  const handler = async (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const copyBtn = target.closest<HTMLElement>("[data-copy-code]");
    if (copyBtn && root.contains(copyBtn)) {
      event.preventDefault();
      const encoded = copyBtn.getAttribute("data-copy-code");
      if (!encoded) {
        return;
      }
      const code = decodeURIComponent(encoded);
      const ok = await copyCodeToClipboard(code);
      if (ok) {
        const prev = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        window.setTimeout(() => {
          copyBtn.textContent = prev ?? "Copy";
        }, 1500);
      }
      return;
    }

    const toggleBtn = target.closest<HTMLElement>(".md-code-block__toggle");
    if (toggleBtn && root.contains(toggleBtn)) {
      event.preventDefault();
      const block = toggleBtn.closest<HTMLElement>(".md-code-block");
      if (!block) {
        return;
      }
      const collapsed = block.getAttribute("data-collapsed") === "true";
      block.setAttribute("data-collapsed", collapsed ? "false" : "true");
      toggleBtn.textContent = collapsed
        ? "Collapse"
        : `Show ${block.querySelector("code")?.textContent?.split("\n").length ?? ""} lines`;
    }
  };

  root.addEventListener("click", handler);
  copyHandlers.set(root, handler);
}

export function detachCopyDelegation(root: HTMLElement): void {
  const handler = copyHandlers.get(root);
  if (handler) {
    root.removeEventListener("click", handler);
    copyHandlers.delete(root);
  }
}
