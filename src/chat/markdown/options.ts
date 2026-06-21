import type { StreamMarkdownOptions } from "incremark-renderer";
import {
  renderCodeBlock,
  renderCodeBlockHeader,
} from "./code-block";
import { HIGHLIGHT_LANGUAGES, registerHighlightLanguages } from "./highlight";
import { sanitizeHtml } from "./sanitize-config";

let cachedOptions: StreamMarkdownOptions | null = null;

export function buildStreamOptions(): StreamMarkdownOptions {
  if (cachedOptions) {
    return cachedOptions;
  }

  registerHighlightLanguages();

  cachedOptions = {
    marked: {
      gfm: true,
      breaks: true,
    },
    sanitizeHtml: {
      sanitizer: (html) => sanitizeHtml(html),
    },
    highlight: {
      autoDetect: true,
      languages: HIGHLIGHT_LANGUAGES,
      showLineNumbers: false,
      renderHeader: renderCodeBlockHeader,
      renderBlock: renderCodeBlock,
      languageRenderers: {
        mermaid: renderCodeBlock,
      },
    },
    math: {
      katex: {
        throwOnError: false,
        strict: "ignore",
      },
    },
  };

  return cachedOptions;
}
