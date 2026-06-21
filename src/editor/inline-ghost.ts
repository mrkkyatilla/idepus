import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  WidgetType,
} from "@codemirror/view";

export type InlineGhostState = {
  from: number;
  text: string;
} | null;

const setInlineGhostEffect = StateEffect.define<InlineGhostState>();
const setInlineGhostEnabledEffect = StateEffect.define<boolean>();

class InlineGhostWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  eq(other: InlineGhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "inline-ghost-text";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(
  state: EditorState,
  ghost: InlineGhostState,
  enabled: boolean,
): DecorationSet {
  if (!enabled || !ghost?.text) {
    return Decoration.none;
  }
  const pos = Math.min(Math.max(0, ghost.from), state.doc.length);
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(
    pos,
    pos,
    Decoration.widget({
      widget: new InlineGhostWidget(ghost.text),
      side: 1,
    }),
  );
  return builder.finish();
}

const inlineGhostField = StateField.define<{
  ghost: InlineGhostState;
  enabled: boolean;
  decorations: DecorationSet;
}>({
  create() {
    return { ghost: null, enabled: true, decorations: Decoration.none };
  },

  update(value, tr) {
    let ghost = value.ghost;
    let enabled = value.enabled;
    for (const effect of tr.effects) {
      if (effect.is(setInlineGhostEffect)) {
        ghost = effect.value;
      }
      if (effect.is(setInlineGhostEnabledEffect)) {
        enabled = effect.value;
      }
    }
    if (tr.docChanged && ghost) {
      const accepted =
        tr.annotation(Transaction.userEvent) === "input.accept.completion";
      if (!accepted) {
        ghost = null;
      }
    }
    if (!enabled) {
      ghost = null;
    }
    return {
      ghost,
      enabled,
      decorations: buildDecorations(tr.state, ghost, enabled),
    };
  },

  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

export function setInlineGhost(
  view: EditorView,
  ghost: InlineGhostState,
): void {
  view.dispatch({ effects: setInlineGhostEffect.of(ghost) });
}

export function clearInlineGhost(view: EditorView): void {
  setInlineGhost(view, null);
}

export function setInlineGhostEnabled(view: EditorView, enabled: boolean): void {
  view.dispatch({ effects: setInlineGhostEnabledEffect.of(enabled) });
}

export function acceptInlineGhost(view: EditorView): boolean {
  const ghost = view.state.field(inlineGhostField).ghost;
  if (!ghost?.text) {
    return false;
  }
  view.dispatch({
    changes: { from: ghost.from, insert: ghost.text },
    effects: setInlineGhostEffect.of(null),
    annotations: Transaction.userEvent.of("input.accept.completion"),
  });
  return true;
}

export function getInlineGhost(view: EditorView): InlineGhostState {
  return view.state.field(inlineGhostField).ghost;
}

export function inlineGhostKeymap() {
  return keymap.of([
    {
      key: "Tab",
      run: (view) => acceptInlineGhost(view),
    },
    {
      key: "Escape",
      run: (view) => {
        const ghost = view.state.field(inlineGhostField).ghost;
        if (ghost?.text) {
          clearInlineGhost(view);
          return true;
        }
        return false;
      },
    },
  ]);
}

export function inlineGhostExtension(): Extension[] {
  return [inlineGhostField, inlineGhostKeymap()];
}
