import type { TeamContext } from "../config/workspace-config";

function globMatch(pattern: string, path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  if (pat.endsWith("**")) {
    const prefix = pat.slice(0, -2);
    return normalized.startsWith(prefix);
  }
  if (pat.includes("*")) {
    const re = new RegExp(
      `^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")}$`,
    );
    return re.test(normalized);
  }
  return normalized === pat || normalized.startsWith(`${pat}/`);
}

export function findProtectedViolations(
  path: string,
  context: TeamContext,
): string[] {
  return context.protected_patterns.filter((pattern) => globMatch(pattern, path));
}
