import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isEventStream, parseChatCompletion, parseEventStream } from "@/lib/ai-response";
import { usageFromResponse } from "@/lib/ai-usage";

const json = JSON.stringify({
  id: "x",
  choices: [{ message: { content: '{"amount":25000}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const sse = [
  'data: {"id":"c1","model":"m","choices":[{"delta":{"role":"assistant","content":"{\\"amount\\""}}]}',
  "",
  'data: {"id":"c1","choices":[{"delta":{"content":":25000}"}}]}',
  "",
  'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

describe("parseChatCompletion", () => {
  it("keeps plain JSON responses unchanged", () => {
    expect(parseChatCompletion(json, "application/json")).toEqual(JSON.parse(json));
  });

  it("joins SSE deltas into one message and keeps usage", () => {
    const r: any = parseChatCompletion(sse, "text/event-stream");
    expect(r.choices[0].message.content).toBe('{"amount":25000}');
    expect(r.id).toBe("c1");
    expect(usageFromResponse(r)).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it("detects SSE even when mislabelled as JSON", () => {
    const r: any = parseChatCompletion(sse, "application/json");
    expect(r.choices[0].message.content).toBe('{"amount":25000}');
  });

  it("accepts SSE chunks carrying a full message and CRLF line endings", () => {
    const body = 'data: {"choices":[{"message":{"content":"{}"}}]}\r\n\r\ndata: [DONE]\r\n';
    expect((parseChatCompletion(body, null) as any).choices[0].message.content).toBe("{}");
  });

  it("returns null for unreadable bodies", () => {
    expect(parseChatCompletion("<html>502</html>", "text/html")).toBeNull();
    expect(parseEventStream("data: [DONE]\n")).toBeNull();
    expect(parseChatCompletion("", null)).toBeNull();
  });

  it("isEventStream uses header or body prefix", () => {
    expect(isEventStream("{}", "text/event-stream; charset=utf-8")).toBe(true);
    expect(isEventStream(": keep-alive\ndata: {}", null)).toBe(true);
    expect(isEventStream("{}", "application/json")).toBe(false);
  });
});
