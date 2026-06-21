import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";

import { cmdkExtensions, handleCmdK, handleEscape } from "./cmdk";
import { diffReviewKeymapExtension } from "./cmdk/diff-review";
import { editableCompartment } from "./editor-editable";
import {
  inlineGhostExtension,
  setInlineGhostEnabled,
} from "./editor/inline-ghost";

/** Faz 01 (cmdk), Faz 05 (diff-review), v2 Faz 14 (autocomplete) ghost-text modes. */
export type EditorMode = "default" | "cmdk" | "diff-review" | "autocomplete";

export { setEditorReadOnly } from "./editor-editable";

export function languageForPath(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs":
      return rust();
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return javascript();
    case "py":
      return python();
    case "md":
    case "markdown":
      return markdown();
    default:
      return [];
  }
}

export function createEditor(
  parent: HTMLElement,
  options: {
    doc?: string;
    path?: string;
    onChange?: () => void;
    mode?: EditorMode;
    extensions?: Extension[];
  },
): EditorView {
  const mode = options.mode ?? "default";
  const ghostEnabled = mode === "default";

  const extensions: Extension[] = [
    basicSetup,
    ...inlineGhostExtension(),
    keymap.of([
      ...defaultKeymap,
      indentWithTab,
      {
        key: "Mod-k",
        run: (view) => {
          if (mode === "cmdk") {
            return true;
          }
          return handleCmdK(view);
        },
      },
      {
        key: "Escape",
        run: (view) => handleEscape(view),
      },
    ]),
    EditorView.lineWrapping,
    editableCompartment.of(
      EditorView.editable.of(mode !== "cmdk" && mode !== "diff-review"),
    ),
    ...cmdkExtensions(),
    diffReviewKeymapExtension(),
  ];

  if (options.path) {
    extensions.push(languageForPath(options.path));
  }

  if (options.onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          options.onChange?.();
        }
      }),
    );
  }

  if (options.extensions?.length) {
    extensions.push(...options.extensions);
  }

  const view = new EditorView({
    parent,
    doc: options.doc ?? "",
    extensions,
  });

  setInlineGhostEnabled(view, ghostEnabled);
  return view;
}
