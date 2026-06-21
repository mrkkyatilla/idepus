const IGNORED_SUFFIXES = [".md", ".json", ".lock"];

const IGNORED_SEGMENTS = [
  "node_modules",
  "dist",
  "target",
  ".git",
  ".idepus",
];

export function shouldSuggestForPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (!normalized || normalized === "untitled") {
    return false;
  }
  for (const suffix of IGNORED_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return false;
    }
  }
  for (const segment of IGNORED_SEGMENTS) {
    if (
      normalized.includes(`/${segment}/`) ||
      normalized.startsWith(`${segment}/`)
    ) {
      return false;
    }
  }
  return true;
}

export function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "rs":
      return "rust";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    default:
      return ext || "text";
  }
}
