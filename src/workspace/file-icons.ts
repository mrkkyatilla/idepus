const FILE_COLORS: Record<string, string> = {
  rs: "#dea584",
  ts: "#519aba",
  tsx: "#519aba",
  js: "#cbcb41",
  jsx: "#cbcb41",
  py: "#4ec9b0",
  md: "#519aba",
  json: "#cbcb41",
  css: "#569cd6",
  html: "#e37933",
  toml: "#808080",
  yaml: "#808080",
  yml: "#808080",
  lock: "#808080",
  svg: "#ffb86c",
};

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

function svgEl(className: string, inner: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `tree-icon ${className}`;
  wrap.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${inner}</svg>`;
  return wrap;
}

function folderIcon(expanded: boolean): HTMLElement {
  const flap = expanded ? "M2 5.5 8 3l6 2.5v1H2z" : "M2 5.5 8 3l6 2.5";
  return svgEl(
    expanded ? "tree-icon--folder-open" : "tree-icon--folder",
    `<path fill="#c09553" d="M1 4a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z"/>
     <path fill="#e8c468" d="${flap}"/>`,
  );
}

function fileIconSvg(name: string): HTMLElement {
  const extension = ext(name);
  const color = FILE_COLORS[extension] ?? "#8b949e";
  const label =
    extension.length <= 3 ? extension.toUpperCase() : extension.slice(0, 3);
  const showLabel = extension.length > 0 && extension.length <= 4;
  const labelSvg = showLabel
    ? `<text x="8" y="11.5" text-anchor="middle" fill="#1e1e1e" font-size="4.5" font-family="var(--font-mono, monospace)" font-weight="700">${label}</text>`
    : "";
  return svgEl(
    `tree-icon--file tree-icon--${extension || "file"}`,
    `<path fill="${color}" d="M3 1.5h5.5L13 6v8.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/>
     <path fill="${color}" opacity="0.55" d="M8 1.5V6H13"/>
     ${labelSvg}`,
  );
}

export function renderTreeIcon(
  name: string,
  isDir: boolean,
  expanded: boolean,
): HTMLElement {
  if (isDir) {
    return folderIcon(expanded);
  }
  return fileIconSvg(name);
}
