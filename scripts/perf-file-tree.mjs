#!/usr/bin/env node
/** Synthetic file-tree scroll benchmark (DOM-only, no browser). */
const COUNT = 500;

const root = { children: [] };
for (let i = 0; i < COUNT; i++) {
  root.children.push({ name: `file-${i}.ts`, depth: i % 8 });
}

const start = performance.now();
let visible = 0;
for (let scroll = 0; scroll < 100; scroll++) {
  const top = scroll * 5;
  for (let i = top; i < top + 40 && i < COUNT; i++) {
    visible += root.children[i].name.length;
  }
}
const elapsed = performance.now() - start;
console.log(JSON.stringify({ nodes: COUNT, frames: 100, elapsed_ms: elapsed }));
