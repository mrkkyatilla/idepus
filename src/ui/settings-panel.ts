import {
  getActiveProvider,
  getProviders,
  setActiveProvider,
  syncAiceryProviderEnv,
  testLlmConnection,
  type ProviderId,
  type ProviderInfo,
} from "../llm/config";
import {
  fetchSidecarStatus,
  loadAiceryConfig,
  saveAiceryConfig,
} from "../agent/config";
import { loadShadowTestConfig, saveShadowTestConfig } from "../shadow";
import {
  loadTelemetryConfig,
  saveTelemetryConfig,
} from "../telemetry";
import { mountSettingsMemoriesView } from "./settings-memories";
import {
  getResearchConfig,
  saveResearchApiKey,
  saveResearchConfig,
  testResearchConnection,
  type ResearchProvider,
} from "../research/config";
import {
  getAutocompleteConfig,
  ollamaHealthCheck,
  ollamaPullModel,
  saveAutocompleteConfig,
  type AutocompleteProvider,
} from "../autocomplete/config";
import { refreshAutocompleteConfig } from "../autocomplete/controller";

type PanelResult = "saved" | "dismissed";

let overlayEl: HTMLElement | null = null;

function requiresApiKey(
  providers: ProviderInfo[],
  providerId: string,
): boolean {
  return (
    providers.find((p) => p.id === providerId)?.requires_api_key ?? true
  );
}

function defaultModel(
  providers: ProviderInfo[],
  providerId: string,
): string {
  return (
    providers.find((p) => p.id === providerId)?.default_model ?? ""
  );
}

export async function showSettingsPanel(
  reason?: string,
  options?: { workspaceId?: string; onOpenFile?: (path: string) => void },
): Promise<PanelResult> {
  if (overlayEl) {
    return "dismissed";
  }

  const [providers, active, researchConfig, autocompleteConfig] = await Promise.all([
    getProviders(),
    getActiveProvider(),
    getResearchConfig(),
    getAutocompleteConfig(),
  ]);

  return new Promise((resolve) => {
    if (options?.workspaceId) {
      (window as unknown as { __idepusWorkspaceId?: string }).__idepusWorkspaceId =
        options.workspaceId;
    }
    overlayEl = document.createElement("div");
    overlayEl.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal";

    const title = document.createElement("h2");
    title.textContent = "Settings";
    modal.appendChild(title);

    if (reason) {
      const hint = document.createElement("p");
      hint.className = "modal-hint";
      hint.textContent = reason;
      modal.appendChild(hint);
    }

    const llmSection = document.createElement("div");
    llmSection.className = "modal-section";

    const llmTitle = document.createElement("p");
    llmTitle.className = "modal-section-title";
    llmTitle.textContent = "LLM Provider";
    llmSection.appendChild(llmTitle);

    const llmCard = document.createElement("div");
    llmCard.className = "modal-card";

    const providerLabel = document.createElement("label");
    providerLabel.textContent = "Provider";
    const providerSelect = document.createElement("select");
    for (const p of providers) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      providerSelect.appendChild(opt);
    }
    providerSelect.value = active.provider_id;
    providerLabel.appendChild(providerSelect);
    llmCard.appendChild(providerLabel);

    const apiKeyLabel = document.createElement("label");
    apiKeyLabel.textContent = "API Key";
    const apiKeyInput = document.createElement("input");
    apiKeyInput.type = "password";
    apiKeyInput.placeholder = active.has_api_key
      ? "Key saved — enter to replace"
      : "Enter API key";
    apiKeyLabel.appendChild(apiKeyInput);
    llmCard.appendChild(apiKeyLabel);

    const modelLabel = document.createElement("label");
    modelLabel.textContent = "Model";
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.value = active.model;
    modelLabel.appendChild(modelInput);
    llmCard.appendChild(modelLabel);

    const llmHint = document.createElement("p");
    llmHint.className = "modal-hint";
    llmHint.textContent =
      "Used for Cmd+K and agent chat. After saving, run ./scripts/aicery-reload-provider.sh (or aicery-up.sh) so the Docker runtime picks up your key.";
    llmCard.appendChild(llmHint);

    llmSection.appendChild(llmCard);
    modal.appendChild(llmSection);

    const aicerySection = document.createElement("div");
    aicerySection.className = "modal-section";

    const aiceryTitle = document.createElement("p");
    aiceryTitle.className = "modal-section-title";
    aiceryTitle.textContent = "Aicery Agent Runtime";
    aicerySection.appendChild(aiceryTitle);

    const aiceryCard = document.createElement("div");
    aiceryCard.className = "modal-card";

    const aiceryConfig = loadAiceryConfig();

    const aiceryUrlLabel = document.createElement("label");
    aiceryUrlLabel.textContent = "Runtime URL";
    const aiceryUrlInput = document.createElement("input");
    aiceryUrlInput.type = "text";
    aiceryUrlInput.value = aiceryConfig.runtime_url;
    aiceryUrlLabel.appendChild(aiceryUrlInput);
    aiceryCard.appendChild(aiceryUrlLabel);

    const aiceryKeyLabel = document.createElement("label");
    aiceryKeyLabel.textContent = "Sidecar auth key";
    const aiceryKeyInput = document.createElement("input");
    aiceryKeyInput.type = "password";
    aiceryKeyInput.placeholder = "dev (default)";
    aiceryKeyInput.value = aiceryConfig.api_key === "dev" ? "" : aiceryConfig.api_key;
    aiceryKeyLabel.appendChild(aiceryKeyInput);
    aiceryCard.appendChild(aiceryKeyLabel);

    const aiceryHint = document.createElement("p");
    aiceryHint.className = "modal-hint";
    aiceryHint.textContent =
      "Auth for the local Aicery HTTP API (not your OpenAI/Anthropic key). Leave blank for dev.";
    aiceryCard.appendChild(aiceryHint);

    aicerySection.appendChild(aiceryCard);
    modal.appendChild(aicerySection);

    const shadowConfig = loadShadowTestConfig();
    const shadowSection = document.createElement("div");
    shadowSection.className = "modal-section";

    const shadowTitle = document.createElement("p");
    shadowTitle.className = "modal-section-title";
    shadowTitle.textContent = "Shadow workspace test";
    shadowSection.appendChild(shadowTitle);

    const shadowCard = document.createElement("div");
    shadowCard.className = "modal-card";

    const shadowHint = document.createElement("p");
    shadowHint.className = "modal-hint";
    shadowHint.textContent =
      "Command run in shadow copy before patch review. Leave blank for auto (cargo check / npm test).";
    shadowCard.appendChild(shadowHint);

    const shadowCmdLabel = document.createElement("label");
    shadowCmdLabel.textContent = "Command (optional)";
    const shadowCmdInput = document.createElement("input");
    shadowCmdInput.type = "text";
    shadowCmdInput.placeholder = "cargo";
    shadowCmdInput.value = shadowConfig.command ?? "";
    shadowCmdLabel.appendChild(shadowCmdInput);
    shadowCard.appendChild(shadowCmdLabel);

    const shadowArgsLabel = document.createElement("label");
    shadowArgsLabel.textContent = "Args (space-separated, optional)";
    const shadowArgsInput = document.createElement("input");
    shadowArgsInput.type = "text";
    shadowArgsInput.placeholder = "check";
    shadowArgsInput.value = shadowConfig.args?.join(" ") ?? "";
    shadowArgsLabel.appendChild(shadowArgsInput);
    shadowCard.appendChild(shadowArgsLabel);

    const shadowTimeoutLabel = document.createElement("label");
    shadowTimeoutLabel.textContent = "Timeout (seconds)";
    const shadowTimeoutInput = document.createElement("input");
    shadowTimeoutInput.type = "number";
    shadowTimeoutInput.min = "10";
    shadowTimeoutInput.max = "600";
    shadowTimeoutInput.value = String(shadowConfig.timeoutSecs ?? 120);
    shadowTimeoutLabel.appendChild(shadowTimeoutInput);
    shadowCard.appendChild(shadowTimeoutLabel);

    shadowSection.appendChild(shadowCard);
    modal.appendChild(shadowSection);

    const teamSection = document.createElement("div");
    teamSection.className = "modal-section";
    const teamTitle = document.createElement("p");
    teamTitle.className = "modal-section-title";
    teamTitle.textContent = "Team & workflow";
    teamSection.appendChild(teamTitle);
    const teamHint = document.createElement("p");
    teamHint.className = "modal-hint";
    teamHint.textContent =
      "Optional project files at workspace root: .idepus-context (team rules) and ai-workflow.yaml (routing overrides).";
    teamSection.appendChild(teamHint);
    modal.appendChild(teamSection);

    const researchSection = document.createElement("div");
    researchSection.className = "modal-section";
    const researchTitle = document.createElement("p");
    researchTitle.className = "modal-section-title";
    researchTitle.textContent = "Web research";
    researchSection.appendChild(researchTitle);

    const researchCard = document.createElement("div");
    researchCard.className = "modal-card";

    const researchEnableLabel = document.createElement("label");
    const researchEnableToggle = document.createElement("input");
    researchEnableToggle.type = "checkbox";
    researchEnableToggle.checked = researchConfig.enabled;
    researchEnableLabel.append(
      researchEnableToggle,
      " Enable web research (queries are sent to the search provider)",
    );
    researchCard.appendChild(researchEnableLabel);

    const researchProviderLabel = document.createElement("label");
    researchProviderLabel.textContent = "Search provider";
    const researchProviderSelect = document.createElement("select");
    for (const id of ["mock", "tavily"] as ResearchProvider[]) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id === "mock" ? "Mock (offline)" : "Tavily";
      researchProviderSelect.appendChild(opt);
    }
    researchProviderSelect.value = researchConfig.provider;
    researchProviderLabel.appendChild(researchProviderSelect);
    researchCard.appendChild(researchProviderLabel);

    const researchKeyLabel = document.createElement("label");
    researchKeyLabel.textContent = "Tavily API key";
    const researchKeyInput = document.createElement("input");
    researchKeyInput.type = "password";
    researchKeyInput.placeholder = researchConfig.has_api_key
      ? "Key saved — enter to replace"
      : "Required for Tavily";
    researchKeyLabel.appendChild(researchKeyInput);
    researchCard.appendChild(researchKeyLabel);

    const parallelLabel = document.createElement("label");
    parallelLabel.textContent = "Max parallel agent runs (multitask)";
    const parallelInput = document.createElement("input");
    parallelInput.type = "number";
    parallelInput.min = "1";
    parallelInput.max = "3";
    parallelInput.value = String(researchConfig.max_parallel_runs ?? 3);
    parallelLabel.appendChild(parallelInput);
    researchCard.appendChild(parallelLabel);

    const researchHint = document.createElement("p");
    researchHint.className = "modal-hint";
    researchHint.textContent =
      "Web research is off by default. Search queries leave your machine when enabled.";
    researchCard.appendChild(researchHint);

    const testResearchBtn = document.createElement("button");
    testResearchBtn.type = "button";
    testResearchBtn.className = "btn btn-ghost btn-sm";
    testResearchBtn.textContent = "Test web search";
    testResearchBtn.addEventListener("click", async () => {
      statusLine.hidden = false;
      statusLine.textContent = "Testing web search…";
      testResearchBtn.disabled = true;
      try {
        await saveResearchConfig({
          enabled: researchEnableToggle.checked,
          provider: researchProviderSelect.value as ResearchProvider,
          max_parallel_runs: Number(parallelInput.value) || 3,
        });
        if (researchKeyInput.value.trim()) {
          await saveResearchApiKey(researchKeyInput.value.trim());
        }
        const result = await testResearchConnection();
        statusLine.textContent = result.message;
      } catch (err) {
        statusLine.textContent = `Web search test failed: ${String(err)}`;
      } finally {
        testResearchBtn.disabled = false;
      }
    });
    researchCard.appendChild(testResearchBtn);
    researchSection.appendChild(researchCard);
    modal.appendChild(researchSection);

    const autocompleteSection = document.createElement("div");
    autocompleteSection.className = "modal-section";
    const autocompleteTitle = document.createElement("p");
    autocompleteTitle.className = "modal-section-title";
    autocompleteTitle.textContent = "Autocomplete";
    autocompleteSection.appendChild(autocompleteTitle);

    const autocompleteCard = document.createElement("div");
    autocompleteCard.className = "modal-card";

    const autocompleteEnableLabel = document.createElement("label");
    const autocompleteEnableToggle = document.createElement("input");
    autocompleteEnableToggle.type = "checkbox";
    autocompleteEnableToggle.checked = autocompleteConfig.enabled;
    autocompleteEnableLabel.append(
      autocompleteEnableToggle,
      " Enable inline suggestions (Tab to accept, Esc to dismiss)",
    );
    autocompleteCard.appendChild(autocompleteEnableLabel);

    const autocompleteProviderLabel = document.createElement("label");
    autocompleteProviderLabel.textContent = "Provider";
    const autocompleteProviderSelect = document.createElement("select");
    for (const id of ["mock", "ollama"] as AutocompleteProvider[]) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id === "mock" ? "Mock (dev)" : "Ollama (local only)";
      autocompleteProviderSelect.appendChild(opt);
    }
    autocompleteProviderSelect.value = autocompleteConfig.provider;
    autocompleteProviderLabel.appendChild(autocompleteProviderSelect);
    autocompleteCard.appendChild(autocompleteProviderLabel);

    const debounceLabel = document.createElement("label");
    debounceLabel.textContent = "Debounce (ms)";
    const debounceInput = document.createElement("input");
    debounceInput.type = "number";
    debounceInput.min = "200";
    debounceInput.max = "500";
    debounceInput.value = String(autocompleteConfig.debounce_ms ?? 250);
    debounceLabel.appendChild(debounceInput);
    autocompleteCard.appendChild(debounceLabel);

    const acModelLabel = document.createElement("label");
    acModelLabel.textContent = "Ollama model";
    const modelInputAutocomplete = document.createElement("input");
    modelInputAutocomplete.type = "text";
    modelInputAutocomplete.placeholder = "qwen2.5-coder:1.5b";
    modelInputAutocomplete.value = autocompleteConfig.model ?? "qwen2.5-coder:1.5b";
    acModelLabel.appendChild(modelInputAutocomplete);
    autocompleteCard.appendChild(acModelLabel);

    const autocompleteHint = document.createElement("p");
    autocompleteHint.className = "modal-hint";
    autocompleteHint.textContent =
      "Autocomplete uses local Ollama only when that provider is selected; nothing is sent to cloud LLMs.";
    autocompleteCard.appendChild(autocompleteHint);

    const ollamaHealthLine = document.createElement("p");
    ollamaHealthLine.className = "modal-hint";
    ollamaHealthLine.textContent = "Ollama status: checking…";
    autocompleteCard.appendChild(ollamaHealthLine);

    void ollamaHealthCheck()
      .then((health) => {
        ollamaHealthLine.textContent = health.available
          ? `Ollama: ${health.message}`
          : `Ollama: ${health.message}`;
      })
      .catch(() => {
        ollamaHealthLine.textContent = "Ollama: unavailable";
      });

    const pullModelBtn = document.createElement("button");
    pullModelBtn.type = "button";
    pullModelBtn.className = "btn btn-ghost btn-sm";
    pullModelBtn.textContent = "Pull default model (1.5b)";
    pullModelBtn.addEventListener("click", async () => {
      statusLine.hidden = false;
      statusLine.textContent = "Pulling Ollama model…";
      pullModelBtn.disabled = true;
      try {
        const msg = await ollamaPullModel(
          modelInputAutocomplete.value.trim() || "qwen2.5-coder:1.5b",
        );
        statusLine.textContent = msg;
      } catch (err) {
        statusLine.textContent = `Pull failed: ${String(err)}`;
      } finally {
        pullModelBtn.disabled = false;
      }
    });
    autocompleteCard.appendChild(pullModelBtn);

    function syncAutocompleteFields(): void {
      const isOllama = autocompleteProviderSelect.value === "ollama";
      acModelLabel.hidden = !isOllama;
      pullModelBtn.hidden = !isOllama;
    }
    autocompleteProviderSelect.addEventListener("change", syncAutocompleteFields);
    syncAutocompleteFields();

    autocompleteSection.appendChild(autocompleteCard);
    modal.appendChild(autocompleteSection);

    function syncResearchFields(): void {
      const isTavily = researchProviderSelect.value === "tavily";
      researchKeyLabel.hidden = !isTavily;
    }
    researchProviderSelect.addEventListener("change", syncResearchFields);
    syncResearchFields();

    const privacySection = document.createElement("div");
    privacySection.className = "modal-section";
    const privacyTitle = document.createElement("p");
    privacyTitle.className = "modal-section-title";
    privacyTitle.textContent = "Privacy";
    privacySection.appendChild(privacyTitle);
    const telemetryLabel = document.createElement("label");
    const telemetryToggle = document.createElement("input");
    telemetryToggle.type = "checkbox";
    telemetryToggle.checked = loadTelemetryConfig().enabled;
    telemetryLabel.append(telemetryToggle, " Send anonymous usage telemetry (opt-in)");
    privacySection.appendChild(telemetryLabel);
    const privacyHint = document.createElement("p");
    privacyHint.className = "modal-hint";
    privacyHint.textContent =
      "Telemetry never includes source code or API keys. Events are written to ~/.config/idepus/telemetry.log.";
    privacySection.appendChild(privacyHint);

    const dataPaths = document.createElement("p");
    dataPaths.className = "modal-hint";
    dataPaths.textContent = "Chat and run history are stored locally under ~/.config/idepus/chats and ~/.config/idepus/runs.";
    privacySection.appendChild(dataPaths);

    const clearHistoryBtn = document.createElement("button");
    clearHistoryBtn.type = "button";
    clearHistoryBtn.className = "btn btn-ghost btn-sm";
    clearHistoryBtn.textContent = "Clear workspace chat & run history";
    clearHistoryBtn.addEventListener("click", async () => {
      const ws = (window as unknown as { __idepusWorkspaceId?: string }).__idepusWorkspaceId;
      if (!ws) {
        statusLine.hidden = false;
        statusLine.textContent = "Open a workspace first.";
        return;
      }
      if (!confirm("Delete all chat sessions and run archives for this workspace?")) {
        return;
      }
      try {
        const { clearWorkspaceHistory } = await import("../chat/persist");
        await clearWorkspaceHistory(ws);
        statusLine.hidden = false;
        statusLine.textContent = "Workspace history cleared. Reload the app to refresh tabs.";
      } catch (err) {
        statusLine.hidden = false;
        statusLine.textContent = `Clear failed: ${String(err)}`;
      }
    });
    privacySection.appendChild(clearHistoryBtn);

    const statusLine = document.createElement("p");
    statusLine.className = "modal-hint";
    statusLine.hidden = true;

    const memoriesSection = document.createElement("div");
    memoriesSection.className = "modal-section";
    const memoriesTitle = document.createElement("p");
    memoriesTitle.className = "modal-section-title";
    memoriesTitle.textContent = "Memories";
    memoriesSection.appendChild(memoriesTitle);
    const memoriesHint = document.createElement("p");
    memoriesHint.className = "modal-hint";
    memoriesHint.textContent =
      "Pinned facts and decisions from chat. Used to recall context without resending full transcripts.";
    memoriesSection.appendChild(memoriesHint);
    const manageMemoriesBtn = document.createElement("button");
    manageMemoriesBtn.type = "button";
    manageMemoriesBtn.className = "btn btn-secondary btn-sm";
    manageMemoriesBtn.textContent = "Manage memories";
    memoriesSection.appendChild(manageMemoriesBtn);
    modal.appendChild(memoriesSection);

    const memoriesView = mountSettingsMemoriesView(modal, {
      workspaceId: options?.workspaceId,
      onStatus: (message) => {
        statusLine.hidden = false;
        statusLine.textContent = message;
      },
      onOpenFile: options?.onOpenFile,
    });
    manageMemoriesBtn.addEventListener("click", () => memoriesView.show());

    modal.appendChild(privacySection);

    modal.appendChild(statusLine);

    function syncFields() {
      const id = providerSelect.value as ProviderId;
      const needsKey = requiresApiKey(providers, id);
      apiKeyLabel.hidden = !needsKey;

      if (!modelInput.dataset.userEdited) {
        modelInput.value =
          id === active.provider_id
            ? active.model
            : defaultModel(providers, id);
      }
    }

    providerSelect.addEventListener("change", () => {
      delete modelInput.dataset.userEdited;
      syncFields();
    });

    modelInput.addEventListener("input", () => {
      modelInput.dataset.userEdited = "1";
    });

    syncFields();

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn btn-ghost";
    testBtn.textContent = "Test LLM";
    testBtn.addEventListener("click", async () => {
      statusLine.hidden = false;
      statusLine.textContent = "Testing connection…";
      testBtn.disabled = true;
      try {
        const id = providerSelect.value;
        await setActiveProvider({
          provider_id: id,
          model: modelInput.value.trim() || undefined,
          api_key: apiKeyInput.value || undefined,
        });
        await testLlmConnection();
        statusLine.textContent = "Connection successful.";
      } catch (err) {
        statusLine.textContent = `Connection failed: ${String(err)}`;
      } finally {
        testBtn.disabled = false;
      }
    });

    const testAiceryBtn = document.createElement("button");
    testAiceryBtn.type = "button";
    testAiceryBtn.className = "btn btn-ghost";
    testAiceryBtn.textContent = "Test Aicery";
    testAiceryBtn.addEventListener("click", async () => {
      statusLine.hidden = false;
      statusLine.textContent = "Testing Aicery sidecar…";
      testAiceryBtn.disabled = true;
      try {
        saveAiceryConfig({
          runtime_url: aiceryUrlInput.value.trim(),
          api_key: aiceryKeyInput.value.trim() || "dev",
        });
        const status = await fetchSidecarStatus();
        statusLine.textContent = status.ok
          ? `Aicery OK (${status.agents.length} agents)`
          : status.message;
      } catch (err) {
        statusLine.textContent = `Aicery failed: ${String(err)}`;
      } finally {
        testAiceryBtn.disabled = false;
      }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => close("dismissed"));

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      try {
        const id = providerSelect.value;
        await setActiveProvider({
          provider_id: id,
          model: modelInput.value.trim() || undefined,
          api_key: apiKeyInput.value || undefined,
        });
        const sync = await syncAiceryProviderEnv();
        saveAiceryConfig({
          runtime_url: aiceryUrlInput.value.trim(),
          api_key: aiceryKeyInput.value.trim() || "dev",
        });
        const argsText = shadowArgsInput.value.trim();
        saveShadowTestConfig({
          command: shadowCmdInput.value.trim() || undefined,
          args: argsText ? argsText.split(/\s+/) : undefined,
          timeoutSecs: Number(shadowTimeoutInput.value) || 120,
        });
        saveTelemetryConfig({ enabled: telemetryToggle.checked });
        await saveResearchConfig({
          enabled: researchEnableToggle.checked,
          provider: researchProviderSelect.value as ResearchProvider,
          max_parallel_runs: Number(parallelInput.value) || 3,
        });
        if (researchKeyInput.value.trim()) {
          await saveResearchApiKey(researchKeyInput.value.trim());
        }
        await saveAutocompleteConfig({
          enabled: autocompleteEnableToggle.checked,
          provider: autocompleteProviderSelect.value as AutocompleteProvider,
          debounce_ms: Number(debounceInput.value) || 250,
          model: modelInputAutocomplete.value.trim() || undefined,
        });
        await refreshAutocompleteConfig();
        if (sync.needs_aicery_reload) {
          statusLine.hidden = false;
          statusLine.textContent =
            "Saved. Run ./scripts/aicery-reload-provider.sh so agent chat uses your LLM key.";
          const { refreshProviderBanners } = await import("./task-tracker");
          refreshProviderBanners();
          setTimeout(() => close("saved"), 2500);
          return;
        }
        const { refreshProviderBanners } = await import("./task-tracker");
        refreshProviderBanners();
        close("saved");
      } catch (err) {
        alert(String(err));
      }
    });

    actions.append(testBtn, testAiceryBtn, cancelBtn, saveBtn);
    modal.appendChild(actions);
    overlayEl.appendChild(modal);
    document.body.appendChild(overlayEl);

    overlayEl.addEventListener("click", (event) => {
      if (event.target === overlayEl) {
        close("dismissed");
      }
    });

    function close(result: PanelResult) {
      overlayEl?.remove();
      overlayEl = null;
      resolve(result);
    }

    apiKeyInput.focus();
  });
}

export function isSettingsPanelOpen(): boolean {
  return overlayEl !== null;
}
