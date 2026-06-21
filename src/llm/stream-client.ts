import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

import type { ChatMessage, GenerateOptions } from "./config";

export type StreamChunkPayload = {
  request_id: string;
  delta: string;
  done: boolean;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
  } | null;
};

export type StreamErrorPayload = {
  request_id: string;
  message: string;
};

export type StreamRequest = {
  request_id: string;
  messages: ChatMessage[];
  options?: GenerateOptions;
};

export type StreamCallbacks = {
  onDelta: (text: string, fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
  onStart?: () => void;
};

const BUFFER_CAP = 64 * 1024;

let activeRequestId: string | null = null;
let chunkUnlisten: UnlistenFn | null = null;
let errorUnlisten: UnlistenFn | null = null;

async function ensureListeners() {
  if (chunkUnlisten && errorUnlisten) {
    return;
  }

  chunkUnlisten = await listen<StreamChunkPayload>("stream_chunk", (event) => {
    handleChunk(event.payload);
  });

  errorUnlisten = await listen<StreamErrorPayload>("stream_error", (event) => {
    handleError(event.payload);
  });
}

type ActiveStream = {
  requestId: string;
  buffer: string;
  callbacks: StreamCallbacks;
  startedAt: number;
  firstTokenAt: number | null;
  rafPending: boolean;
  pendingDelta: string;
};

let activeStream: ActiveStream | null = null;

function handleChunk(payload: StreamChunkPayload) {
  if (!activeStream || payload.request_id !== activeStream.requestId) {
    return;
  }

  if (payload.delta) {
    if (activeStream.firstTokenAt === null) {
      activeStream.firstTokenAt = performance.now();
      const ttfb = activeStream.firstTokenAt - activeStream.startedAt;
      console.debug(`[stream] TTFB: ${ttfb.toFixed(0)}ms`);
    }

    activeStream.buffer += payload.delta;
    if (activeStream.buffer.length > BUFFER_CAP) {
      activeStream.buffer = activeStream.buffer.slice(-BUFFER_CAP);
    }
    activeStream.pendingDelta += payload.delta;
  }

  if (payload.done) {
    const total = performance.now() - activeStream.startedAt;
    console.debug(`[stream] complete in ${total.toFixed(0)}ms`);
    if (payload.usage) {
      console.debug("[stream] usage:", payload.usage);
    }
    flushPending(activeStream);
    activeStream.callbacks.onDone(activeStream.buffer);
    activeStream = null;
    activeRequestId = null;
    return;
  }

  scheduleFlush(activeStream);
}

function handleError(payload: StreamErrorPayload) {
  if (!activeStream || payload.request_id !== activeStream.requestId) {
    return;
  }

  activeStream.callbacks.onError(payload.message);
  activeStream = null;
  activeRequestId = null;
}

function scheduleFlush(stream: ActiveStream) {
  if (stream.rafPending) {
    return;
  }
  stream.rafPending = true;
  requestAnimationFrame(() => {
    stream.rafPending = false;
    flushPending(stream);
  });
}

function flushPending(stream: ActiveStream) {
  if (!stream.pendingDelta) {
    return;
  }
  const delta = stream.pendingDelta;
  stream.pendingDelta = "";
  stream.callbacks.onDelta(delta, stream.buffer);
}

export async function startStream(
  request: StreamRequest,
  callbacks: StreamCallbacks,
): Promise<void> {
  if (activeRequestId) {
    await cancelStream(activeRequestId);
  }

  await ensureListeners();

  activeRequestId = request.request_id;
  activeStream = {
    requestId: request.request_id,
    buffer: "",
    callbacks,
    startedAt: performance.now(),
    firstTokenAt: null,
    rafPending: false,
    pendingDelta: "",
  };

  callbacks.onStart?.();

  try {
    await invoke("llm_complete_stream", { request });
  } catch (err) {
    const message = String(err);
    callbacks.onError(message);
    activeStream = null;
    activeRequestId = null;
  }
}

export async function cancelStream(requestId?: string): Promise<void> {
  const id = requestId ?? activeRequestId;
  if (!id) {
    return;
  }

  try {
    await invoke("cancel_stream", { requestId: id });
  } catch {
    // ignore cancel errors
  }

  if (activeStream?.requestId === id) {
    activeStream = null;
  }
  if (activeRequestId === id) {
    activeRequestId = null;
  }
}

export function isStreaming(): boolean {
  return activeRequestId !== null;
}

export function currentRequestId(): string | null {
  return activeRequestId;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
