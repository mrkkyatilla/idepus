export type ComposerHost = {
  onRun: (input: string) => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onStatus?: (message: string) => void;
};

export type HitlCardHost = {
  getEditorView: () => import("@codemirror/view").EditorView | null;
  onReview: () => void;
  onApply: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
};
