export type ChangesHubFilter = {
  runId?: string;
  query?: string;
};

let changesHubOpener: ((filter?: ChangesHubFilter) => void) | null = null;

export function setChangesHubOpener(
  opener: ((filter?: ChangesHubFilter) => void) | null,
): void {
  changesHubOpener = opener;
}

export function openChangesHub(filter?: ChangesHubFilter): void {
  changesHubOpener?.(filter);
}
