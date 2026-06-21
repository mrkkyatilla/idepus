import { getLastRetrieval, isMemoryDebugEnabled, subscribeMemoryStore } from "../../memory/store";

export function mountMemoryDebugStrip(
  panelEl: HTMLElement,
  insertBefore: HTMLElement,
): () => void {
  const strip = document.createElement("div");
  strip.className = "memory-debug-strip";
  strip.hidden = true;

  const label = document.createElement("span");
  label.className = "memory-debug-label";
  strip.appendChild(label);
  panelEl.insertBefore(strip, insertBefore);

  function sync(): void {
    if (!isMemoryDebugEnabled()) {
      strip.hidden = true;
      return;
    }
    const hits = getLastRetrieval();
    const mem = hits?.memories?.length ?? 0;
    const ch = hits?.changes?.length ?? 0;
    if (mem === 0 && ch === 0) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    label.textContent = `Context: ${mem} memor${mem === 1 ? "y" : "ies"}, ${ch} change${ch === 1 ? "" : "s"}`;
  }

  const unsubscribe = subscribeMemoryStore(sync);
  sync();

  return () => {
    unsubscribe();
    strip.remove();
  };
}
