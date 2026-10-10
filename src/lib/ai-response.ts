/**
 * Pure parsing of OpenAI-compatible chat-completions response bodies. Most providers return one
 * JSON object, but some proxies/routers (e.g. 9router) answer with Server-Sent Events
 * (`data: {chunk}` lines ending in `data: [DONE]`) even for non-streaming requests. Both shapes
 * are folded into the same `{ choices:[{message:{content}}], usage }` object so callers and
 * `usageFromResponse()` need no changes.
 */

export type ChatCompletion = {
  choices: { message: { content: string } }[];
  usage?: Record<string, unknown>;
  [k: string]: unknown;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/** True when the body looks like an SSE stream rather than a JSON document. */
export function isEventStream(body: string, contentType?: string | null): boolean {
  if (contentType && /text\/event-stream/i.test(contentType)) return true;
  return /^\s*(data|event|id|retry)\s*:/.test(body) || /^\s*:/.test(body);
}

/** Joins SSE chunk deltas (or full messages) into one completion; null when nothing usable. */
export function parseEventStream(body: string): ChatCompletion | null {
  let content = "";
  let usage: Record<string, unknown> | undefined;
  let base: Record<string, unknown> | null = null;
  let chunks = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (!j || typeof j !== "object") continue;
    chunks++;
    base ??= j;
    const choice = Array.isArray(j.choices) ? j.choices[0] : undefined;
    const piece = choice?.delta?.content ?? choice?.message?.content;
    if (typeof piece === "string") content += piece;
    if (j.usage && typeof j.usage === "object") usage = j.usage;
  }
  if (!chunks) return null;
  const { choices: _c, usage: _u, object: _o, ...rest } = base ?? {};
  return {
    ...rest,
    object: "chat.completion",
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  };
}

/** Parses a JSON or SSE completion body; null when neither shape can be read. */
export function parseChatCompletion(body: string, contentType?: string | null): unknown {
  if (!isEventStream(body, contentType)) {
    try {
      return JSON.parse(body);
    } catch {
      // Some proxies mislabel streams; fall through to the SSE reader.
    }
  }
  return parseEventStream(body);
}
