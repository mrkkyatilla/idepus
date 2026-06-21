import { initApp } from "./app";

function initNativeContextMenuGuard(): void {
  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      event.preventDefault();
      return;
    }
    if (
      target.closest(".xterm") ||
      target.closest(".chat-composer") ||
      target.closest(".context-menu") ||
      target.closest("input, textarea, [contenteditable='true']")
    ) {
      return;
    }
    event.preventDefault();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initNativeContextMenuGuard();
  void initApp();
});
