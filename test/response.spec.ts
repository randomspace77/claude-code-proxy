import { describe, it, expect } from "vitest";
import { convertOpenAIToClaude } from "../src/conversion/response";
import type { OpenAIResponse, ClaudeMessagesRequest } from "../src/types";

describe("Response Conversion", () => {
  const originalRequest: ClaudeMessagesRequest = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    messages: [{ role: "user", content: "Hello" }],
  };

  it("converts a basic text response", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello! How can I help you?",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 7,
        total_tokens: 17,
      },
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("claude-3-5-sonnet-20241022");
    expect(result.stop_reason).toBe("end_turn");

    const content = result.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Hello! How can I help you?");

    const usage = result.usage as Record<string, number>;
    expect(usage.input_tokens).toBe(10);
    expect(usage.output_tokens).toBe(7);
  });

  it("converts tool call response", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-456",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"location":"New York"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 15,
        total_tokens: 35,
      },
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);

    expect(result.stop_reason).toBe("tool_use");

    const content = result.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("tool_use");
    expect(content[0].name).toBe("get_weather");
    expect(content[0].id).toBe("call_abc123");
    expect(content[0].input).toEqual({ location: "New York" });
  });

  it("maps max_tokens finish reason", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-789",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Truncated text...",
          },
          finish_reason: "length",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    expect(result.stop_reason).toBe("max_tokens");
  });

  it("throws error when choices array is empty", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-empty",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [],
    };

    expect(() =>
      convertOpenAIToClaude(openaiResponse, originalRequest),
    ).toThrow("No choices in OpenAI response");
  });

  it("handles invalid JSON in tool call arguments", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-bad-json",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: {
                  name: "some_tool",
                  arguments: "{invalid json}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    const content = result.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("tool_use");
    expect(content[0].input).toEqual({ raw_arguments: "{invalid json}" });
  });

  it("handles response with no usage data", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-no-usage",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Response without usage",
          },
          finish_reason: "stop",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    const usage = result.usage as Record<string, number>;
    expect(usage.input_tokens).toBe(0);
    expect(usage.output_tokens).toBe(0);
  });

  it("handles response with null content and no tool calls", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-null",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
          },
          finish_reason: "stop",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    const content = result.content as Array<Record<string, unknown>>;
    // Should have at least one empty text block
    expect(content.length).toBeGreaterThanOrEqual(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("");
  });

  it("maps function_call finish reason to tool_use", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-fn",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_fn",
                type: "function",
                function: { name: "test", arguments: "{}" },
              },
            ],
          },
          finish_reason: "function_call",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("maps unknown finish reason to end_turn", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-unknown",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hi",
          },
          finish_reason: "content_filter",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    expect(result.stop_reason).toBe("end_turn");
  });

  it("handles multiple tool calls in one response", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-multi-tool",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "tool_a",
                  arguments: '{"key":"val1"}',
                },
              },
              {
                id: "call_2",
                type: "function",
                function: {
                  name: "tool_b",
                  arguments: '{"key":"val2"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    const content = result.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0].name).toBe("tool_a");
    expect(content[1].name).toBe("tool_b");
  });

  it("includes both text and tool calls in content", () => {
    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-mixed",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me check that for you.",
            tool_calls: [
              {
                id: "call_mix",
                type: "function",
                function: {
                  name: "search",
                  arguments: '{"query":"test"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, originalRequest);
    const content = result.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Let me check that for you.");
    expect(content[1].type).toBe("tool_use");
    expect(content[1].name).toBe("search");
  });

  it("preserves original request model in response", () => {
    const glmRequest: ClaudeMessagesRequest = {
      model: "glm-5.1",
      max_tokens: 1000,
      messages: [{ role: "user", content: "Hi" }],
    };

    const openaiResponse: OpenAIResponse = {
      id: "chatcmpl-glm",
      object: "chat.completion",
      created: 1234567890,
      model: "glm-5.1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello!",
          },
          finish_reason: "stop",
        },
      ],
    };

    const result = convertOpenAIToClaude(openaiResponse, glmRequest);
    expect(result.model).toBe("glm-5.1");
  });
});
