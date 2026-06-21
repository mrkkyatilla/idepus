export function isValidPatchText(raw: string): boolean {
  return raw.includes("<<<<<<< SEARCH") && raw.includes(">>>>>>> REPLACE");
}

/** Pull quoted or hash-prefixed insert text from the user's task (mirrors agent graph). */
export function extractInsertFromTask(task: string): string | undefined {
  const trimmed = task.trim();
  if (!trimmed) {
    return undefined;
  }
  const quotePatterns = [
    /"([^"]{1,500})"/,
    /'([^']{1,500})'/,
    /"([^"]{1,500})"/,
    /"([^"]{1,500})"/,
    /«([^»]{1,500})»/,
  ];
  for (const pattern of quotePatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  const hashMatch = trimmed.match(/(#[^\s"']{2,200})/);
  if (hashMatch?.[1]) {
    return hashMatch[1].trim();
  }
  const yazMatch = trimmed.match(
    /(?:yaz(?:ar)?\s*mısın|yaz(?:dır)?|write|add|insert|ekle)[:\s]+(.+)$/i,
  );
  if (yazMatch?.[1]) {
    const text = yazMatch[1].trim().replace(/^["'«»""]|["'«»""]$/g, "");
    if (text) {
      return text;
    }
  }
  return undefined;
}

/** Build a minimal SEARCH/REPLACE block anchored on real file content (mock / dev). */
export function synthesizeMockPatch(content: string, task?: string): string {
  const insert = task ? extractInsertFromTask(task) : undefined;
  const lines = content.split(/\r?\n/);
  let anchor = "";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line?.trim()) {
      anchor = line;
      break;
    }
  }

  const newLine = insert ?? "# agent: mock edit";

  if (!anchor) {
    return [
      "<<<<<<< SEARCH",
      "=======",
      newLine,
      ">>>>>>> REPLACE",
    ].join("\n");
  }

  const replacement = insert ? `${anchor}\n${insert}` : `${anchor}\n# agent: mock edit`;
  return [
    "<<<<<<< SEARCH",
    anchor,
    "=======",
    replacement,
    ">>>>>>> REPLACE",
  ].join("\n");
}

export function patchTextForReview(rawPatch: string, fileContent: string, task?: string): string {
  if (isValidPatchText(rawPatch)) {
    const insert = task ? extractInsertFromTask(task) : undefined;
    if (insert && rawPatch.includes("# agent: mock edit")) {
      return rawPatch.replace(/# agent: mock edit/g, insert);
    }
    return rawPatch;
  }
  return synthesizeMockPatch(fileContent, task);
}
