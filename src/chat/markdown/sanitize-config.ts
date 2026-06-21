import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel", "data-copy-code", "data-mermaid-source", "data-collapsed"],
    ADD_TAGS: ["svg", "path", "g", "defs", "marker", "foreignobject"],
  });
}
