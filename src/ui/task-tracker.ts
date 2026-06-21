import {
  cancelLauncherRun,
  launchAgentRun,
} from "../agent/run-launcher";
import {
  fetchSidecarStatus,
  loadAiceryConfig,
  type AicerySidecarStatus,
} from "../agent/config";
import { getActiveProvider } from "../llm/config";
import {
  getComposerDraft,
  setComposerDraft,
  subscribeChatSessions,
} from "../chat/session-store";
import {
  getAgentMode,
  modeAllowsPatch,
  subscribeAgentMode,
} from "../agent/mode";
import {
  getCurrentRun,
  getTaskSteps,
  hasPendingHitlStep,
  subscribeTaskTracker,
} from "../agent/task-tracker";
import {
  getDiffReviewSummary,
  subscribeDiffReview,
} from "../cmdk/diff-review";
import { rejectPatchFromUi } from "./diff-actions";
import { mountChatComposer } from "./agent/chat-composer";
import { mountChatTranscript } from "./agent/chat-transcript";
import { mountModePicker } from "./agent/mode-picker";
import { mountMemoryDebugStrip } from "./agent/memory-debug-strip";
import { openChangesHub } from "../memory/ui-bus";
import { showSettingsPanel } from "./settings-panel";
import { mountCurrentRunPanel } from "./agent/current-run-panel";
import { mountHitlCard } from "./agent/hitl-card";
import { applyAgentPatchFromCard } from "./agent/hitl-apply";
import { mountPatchQueuePanel } from "./agent/patch-queue-panel";
import { isAgentHitlActive, rejectPendingHitlFromUi } from "../agent/hitl";
import { hasStagedPatches } from "../agent/patch-queue";
import { retryPendingPatchReview } from "../agent/hitl-flow";
import { mountRunBannerStack } from "./agent/run-banner-stack";
import { mountMultitaskDrawer } from "./agent/multitask-drawer";

export type TaskTrackerHost = {
  getEditorView: () => import("@codemirror/view").EditorView | null;
  getActiveFilePath?: () => string | undefined;
  getWorkspaceRoot: () => string | undefined;
  getWorkspaceId: () => string | undefined;
  openFile: (path: string, fallbackContent?: string) => Promise<void>;
  onStatus: (message: string) => void;
  onAgentStateChange?: (state: "idle" | "running" | "hitl") => void;
  showAgentPanel?: () => void;
};

let host: TaskTrackerHost | null = null;
let sidecarStatus: AicerySidecarStatus | null = null;
let composerFocus: (() => void) | null = null;
let providerBannerEl: HTMLElement | null = null;

export function refreshProviderBanners(): void {
  if (providerBannerEl) {
    void refreshProviderBanner(providerBannerEl);
  }
}

export function initTaskTracker(taskHost: TaskTrackerHost): void {
  host = taskHost;
}

export function focusChatComposer(): void {
  composerFocus?.();
}

export async function refreshProviderBanner(
  bannerEl: HTMLElement,
): Promise<void> {
  try {
    const active = await getActiveProvider();
    if (!active.has_api_key) {
      bannerEl.hidden = false;
      bannerEl.textContent =
        "Agent LLM: Mock — add API key in Settings → LLM, then ./scripts/aicery-reload-provider.sh";
      return;
    }
    bannerEl.hidden = false;
    bannerEl.textContent = `Agent LLM: ${active.provider_id} (${active.model})`;
  } catch {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
  }
}

export async function refreshSidecarBanner(
  bannerEl: HTMLElement,
): Promise<void> {
  try {
    sidecarStatus = await fetchSidecarStatus();
    if (sidecarStatus.ok) {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
    } else {
      bannerEl.hidden = false;
      bannerEl.textContent =
        "Aicery offline — start idepus, then run ./scripts/aicery-up.sh";
    }
  } catch {
    bannerEl.hidden = false;
    bannerEl.textContent =
      "Aicery unreachable — check Settings → Test Aicery";
  }
}

function modeBannerText(mode: ReturnType<typeof getAgentMode>): string {
  if (mode === "multitask") {
    return "Multitask — up to 3 parallel runs. Use Runs to switch focus.";
  }
  return "";
}

export function mountTaskTracker(panelEl: HTMLElement): () => void {
  panelEl.innerHTML = "";
  panelEl.className = "agent-panel-body agent-panel-body--chat";

  const modeBanner = document.createElement("div");
  modeBanner.className = "agent-mode-banner";
  modeBanner.hidden = true;
  panelEl.appendChild(modeBanner);

  const banner = document.createElement("div");
  banner.className = "agent-sidecar-banner";
  banner.hidden = true;
  panelEl.appendChild(banner);
  void refreshSidecarBanner(banner);

  const providerBanner = document.createElement("div");
  providerBanner.className = "agent-provider-banner";
  providerBanner.hidden = true;
  panelEl.appendChild(providerBanner);
  providerBannerEl = providerBanner;
  void refreshProviderBanner(providerBanner);

  const runBannerHost = document.createElement("div");
  runBannerHost.className = "run-banner-stack-host";
  panelEl.appendChild(runBannerHost);

  const chatMain = document.createElement("div");
  chatMain.className = "chat-main";
  chatMain.style.position = "relative";
  panelEl.appendChild(chatMain);

  const transcriptHost = document.createElement("div");
  transcriptHost.className = "chat-transcript-host";
  chatMain.appendChild(transcriptHost);
  const transcript = mountChatTranscript(transcriptHost, {
    onCitation: (kind) => {
      if (kind === "memory") {
        void showSettingsPanel("Manage pinned memories", {
          workspaceId: host?.getWorkspaceId?.(),
          onOpenFile: (path) => host?.openFile(path) ?? Promise.resolve(),
        });
      } else {
        openChangesHub();
      }
    },
  });

  const queueHost = document.createElement("div");
  queueHost.className = "patch-queue-host";
  chatMain.appendChild(queueHost);
  const patchQueue = mountPatchQueuePanel(queueHost, {
    openFile: (path) => host?.openFile(path) ?? Promise.resolve(),
    onStatus: (msg) => host?.onStatus(msg),
    getEditorView: () => host?.getEditorView() ?? null,
    getWorkspaceRoot: () => host?.getWorkspaceRoot(),
    getActiveFilePath: () => host?.getActiveFilePath?.(),
  });

  const hitlHost = document.createElement("div");
  hitlHost.className = "agent-section";
  hitlHost.style.paddingTop = "0";
  chatMain.appendChild(hitlHost);

  const hitl = mountHitlCard(hitlHost, {
    getEditorView: () => host?.getEditorView() ?? null,
    onReview: () => {
      const taskHost = host;
      if (!taskHost) {
        return;
      }
      void retryPendingPatchReview({
        workspaceRoot: taskHost.getWorkspaceRoot(),
        getEditorView: () => taskHost.getEditorView(),
        getActiveFilePath: taskHost.getActiveFilePath,
        openFile: taskHost.openFile,
        onStatus: taskHost.onStatus,
      });
    },
    onApply: async () => {
      const taskHost = host;
      if (!taskHost) {
        return;
      }
      await applyAgentPatchFromCard({
        workspaceRoot: taskHost.getWorkspaceRoot(),
        getEditorView: () => taskHost.getEditorView(),
        getActiveFilePath: taskHost.getActiveFilePath,
        openFile: taskHost.openFile,
        onStatus: taskHost.onStatus,
      });
    },
    onReject: async () => {
      const taskHost = host;
      if (!taskHost) {
        return;
      }
      if (isAgentHitlActive()) {
        const view = taskHost.getEditorView();
        if (view) {
          await rejectPatchFromUi(view);
        }
        return;
      }
      if (hasPendingHitlStep()) {
        const rejected = await rejectPendingHitlFromUi();
        if (rejected) {
          taskHost.onStatus("Patch rejected — agent notified");
        }
      }
    },
  });

  const composerHost = document.createElement("div");
  composerHost.className = "chat-composer-host";
  panelEl.appendChild(composerHost);

  const modePickerHost = document.createElement("div");
  modePickerHost.className = "chat-composer-mode-host";
  composerHost.appendChild(modePickerHost);
  const modePicker = mountModePicker(modePickerHost, {
    onStatus: (message) => host?.onStatus(message) ?? undefined,
  });

  const runsBtn = document.createElement("button");
  runsBtn.type = "button";
  runsBtn.className = "btn btn-ghost btn-sm multitask-runs-btn";
  runsBtn.textContent = "Runs";
  runsBtn.title = "Active background runs";
  modePickerHost.appendChild(runsBtn);

  const multitaskDrawer = mountMultitaskDrawer(chatMain, {
    onStatus: (msg) => host?.onStatus(msg) ?? undefined,
  });
  runsBtn.addEventListener("click", () => {
    if (multitaskDrawer.isOpen()) {
      multitaskDrawer.close();
    } else {
      multitaskDrawer.open();
    }
  });

  const runBanners = mountRunBannerStack(runBannerHost, {
    onStatus: (msg) => host?.onStatus(msg) ?? undefined,
    onReview: () => {
      hitl.scrollIntoView();
    },
  });

  const teardownDebugStrip = mountMemoryDebugStrip(panelEl, composerHost);

  const currentRun = mountCurrentRunPanel(panelEl, composerHost);

  const composer = mountChatComposer(composerHost, {
    getWorkspaceRoot: () => host?.getWorkspaceRoot(),
    getWorkspaceId: () => host?.getWorkspaceId?.(),
    initialDraft: getComposerDraft(),
    onDraftChange: setComposerDraft,
    onStatus: (msg) => host?.onStatus(msg),
    onRun: (input) => {
      const taskHost = host;
      if (!taskHost) {
        return;
      }
      const trimmed = input.trim();
      if (!trimmed) {
        return;
      }
      void launchAgentRun(trimmed, {
        workspaceRoot: taskHost.getWorkspaceRoot(),
        workspaceId: taskHost.getWorkspaceId(),
        getEditorView: () => taskHost.getEditorView(),
        getActiveFilePath: taskHost.getActiveFilePath,
        openFile: taskHost.openFile,
        onStatus: taskHost.onStatus,
      }).then((started) => {
        if (started) {
          setComposerDraft("");
          composer.setInput("");
        }
      });
    },
    onStop: () => {
      if (!host) {
        return;
      }
      void cancelLauncherRun(host.onStatus);
    },
  });
  composerFocus = () => composer.focus();
  composer.setMode(getAgentMode());

  let hitlSeen = false;

  function emitAgentState(): void {
    if (!host?.onAgentStateChange) {
      return;
    }
    if (isAgentHitlActive() || hasPendingHitlStep() || hasStagedPatches()) {
      host.onAgentStateChange("hitl");
    } else if (getCurrentRun()) {
      host.onAgentStateChange("running");
    } else {
      host.onAgentStateChange("idle");
    }
  }

  function applyModeUi(): void {
    const mode = getAgentMode();
    const patchVisible = modeAllowsPatch(mode);

    queueHost.hidden = !patchVisible;
    hitlHost.hidden = !patchVisible;

    const bannerText = modeBannerText(mode);
    if (bannerText) {
      modeBanner.hidden = false;
      modeBanner.textContent = bannerText;
    } else {
      modeBanner.hidden = true;
      modeBanner.textContent = "";
    }

    composer.setMode(mode);
    runsBtn.hidden = mode !== "multitask";
  }

  function render(): void {
    const current = getCurrentRun();
    composer.setRunning(Boolean(current));

    const steps = getTaskSteps();
    currentRun.render(steps);
    patchQueue.render();

    if (isAgentHitlActive() || hasPendingHitlStep()) {
      const view = host?.getEditorView();
      hitl.update(view ? getDiffReviewSummary(view) : null);
      if (!hitlSeen) {
        hitlSeen = true;
        hitl.scrollIntoView();
      }
    } else if (hasStagedPatches()) {
      hitl.update(null);
      hitlSeen = false;
      queueHost.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      hitl.update(null);
      hitlSeen = false;
    }

    applyModeUi();
    transcript.scrollToBottom();
    emitAgentState();
  }

  const unsubscribeTracker = subscribeTaskTracker(render);
  const unsubscribeDiff = subscribeDiffReview((summary) => {
    hitl.update(summary);
    if (isAgentHitlActive() || hasPendingHitlStep()) {
      emitAgentState();
      render();
    }
  });
  const unsubscribeMode = subscribeAgentMode(() => {
    applyModeUi();
    render();
  });
  const unsubscribeSessions = subscribeChatSessions(() => {
    composer.setInput(getComposerDraft());
    composer.setMode(getAgentMode());
    render();
  });

  render();

  return () => {
    unsubscribeTracker();
    unsubscribeDiff();
    unsubscribeMode();
    unsubscribeSessions();
    currentRun.destroy();
    modePicker.destroy();
    runBanners.destroy();
    multitaskDrawer.destroy();
    teardownDebugStrip();
    composerFocus = null;
    panelEl.innerHTML = "";
  };
}

export function getSidecarStatus(): AicerySidecarStatus | null {
  return sidecarStatus;
}

export function getAiceryConfigForDisplay(): ReturnType<typeof loadAiceryConfig> {
  return loadAiceryConfig();
}
