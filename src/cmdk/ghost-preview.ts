import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

export type GhostPreviewState = {
  anchor: number;
  text: string;
};

const setGhostPreviewEffect = StateEffect.define<GhostPreviewState | null>();

class GhostTextWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "ghost-preview-block";
    el.textContent = this.text;
    return el;
  }
}

const ghostPreviewField = StateField.define<{
  preview: GhostPreviewState | null;
  decorations: DecorationSet;
}>({
  create() {
    return { preview: null, decorations: Decoration.none };
  },

  update(value, tr) {
    let preview = value.preview;
    for (const effect of tr.effects) {
      if (effect.is(setGhostPreviewEffect)) {
        preview = effect.value;
      }
    }

    if (preview === value.preview && !tr.docChanged) {
      return value;
    }

    return {
      preview,
      decorations: buildDecorations(tr.state, preview),
    };
  },

  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

function buildDecorations(
  state: EditorState,
  preview: GhostPreviewState | null,
): DecorationSet {
  if (!preview || !preview.text) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const pos = Math.min(preview.anchor, state.doc.length);
  builder.add(
    pos,
    pos,
    Decoration.widget({
      widget: new GhostTextWidget(preview.text),
      side: 1,
      block: true,
    }),
  );
  return builder.finish();
}

export function setGhostPreview(
  view: EditorView,
  preview: GhostPreviewState | null,
): void {
  view.dispatch({
    effects: setGhostPreviewEffect.of(preview),
  });
}

export function clearGhostPreview(view: EditorView): void {
  setGhostPreview(view, null);
}

export function ghostPreviewExtension() {
  return ghostPreviewField;
}
