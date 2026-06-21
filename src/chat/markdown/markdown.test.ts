import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./index";

describe("renderMarkdown", () => {
  it("renders bold and inline code", () => {
    const html = renderMarkdown("Hello **world** and `code`");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("code");
  });

  it("renders fenced code blocks with language header", () => {
    const html = renderMarkdown("```typescript\nconst x = 1;\n```");
    expect(html).toContain("md-code-block");
    expect(html).toContain("typescript");
    expect(html).toContain("const");
  });

  it("renders unordered lists", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("wraps mermaid blocks in placeholder", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\n  A-->B\n```");
    expect(html).toContain("md-mermaid");
    expect(html).toContain("data-mermaid-source");
  });
});
