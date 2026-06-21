type MermaidApi = {
  initialize: (config: object) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidInitialized = false;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid =
        (mod as { default?: MermaidApi }).default ??
        (mod as unknown as MermaidApi);
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
        });
        mermaidInitialized = true;
      }
      return mermaid;
    });
  }
  return mermaidPromise;
}

const renderedSources = new WeakSet<HTMLElement>();

export async function hydrateMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>(
    '.md-mermaid[data-mermaid-source]:not([data-mermaid-rendered="true"])',
  );

  if (blocks.length === 0) {
    return;
  }

  let mermaid: MermaidApi;
  try {
    mermaid = await loadMermaid();
  } catch {
    for (const block of blocks) {
      showMermaidError(block, "Could not load Mermaid renderer");
    }
    return;
  }

  for (const block of blocks) {
    if (block.classList.contains("md-mermaid--streaming")) {
      continue;
    }
    if (renderedSources.has(block)) {
      continue;
    }

    const encoded = block.getAttribute("data-mermaid-source");
    if (!encoded) {
      continue;
    }

    const source = decodeURIComponent(encoded);
    renderedSources.add(block);
    block.setAttribute("data-mermaid-rendered", "true");

    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const { svg } = await mermaid.render(id, source);
      block.innerHTML = svg;
      block.classList.add("md-mermaid--done");
    } catch (err) {
      showMermaidError(block, source, String(err));
    }
  }
}

function showMermaidError(
  block: HTMLElement,
  source: string,
  err?: string,
): void {
  block.classList.add("md-mermaid--error");
  block.innerHTML = "";
  if (err && err !== source) {
    const msg = document.createElement("p");
    msg.className = "md-mermaid__error";
    msg.textContent = `Diagram error: ${err}`;
    block.appendChild(msg);
  }
  const pre = document.createElement("pre");
  pre.className = "md-mermaid__fallback";
  pre.textContent = source;
  block.appendChild(pre);
}
