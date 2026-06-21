import { describe, expect, it } from "vitest";
import { renderMarkdown, sanitizeHtml } from "./index";

describe("sanitizeHtml", () => {
  it("strips script tags from rendered markdown", () => {
    const dirty = '<p>ok</p><script>alert("x")</script>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).toContain("ok");
  });

  it("blocks javascript: links in markdown output", () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain("javascript:");
  });
});
