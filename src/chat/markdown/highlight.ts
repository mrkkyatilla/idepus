import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

let registered = false;

export function registerHighlightLanguages(): void {
  if (registered) {
    return;
  }
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("javascript", typescript);
  hljs.registerLanguage("tsx", typescript);
  hljs.registerLanguage("jsx", typescript);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("sh", bash);
  hljs.registerLanguage("shell", bash);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("md", markdown);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("css", css);
  registered = true;
}

export const HIGHLIGHT_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "bash",
  "json",
  "markdown",
  "html",
  "css",
];
