import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const editableCompartment = new Compartment();

export function setEditorReadOnly(view: EditorView, readOnly: boolean): void {
  view.dispatch({
    effects: editableCompartment.reconfigure(
      EditorView.editable.of(!readOnly),
    ),
  });
}
