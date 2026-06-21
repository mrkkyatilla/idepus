import { renderMarkdownToString } from "incremark-renderer";
import { buildStreamOptions } from "./options";
import { sanitizeHtml } from "./sanitize-config";

export function renderStaticHtml(text: string): string {
  if (!text) {
    return "";
  }
  const html = renderMarkdownToString(text, buildStreamOptions());
  return sanitizeHtml(html);
}
