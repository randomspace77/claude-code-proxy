import { describe, it, expect } from "vitest";
import { classifyOpenAIError, parseSSEChunk, OpenAIError } from "../src/client";

// ---- classifyOpenAIError ----

describe("classifyOpenAIError", () => {
  it("identifies region restriction errors", () => {
    const msg = classifyOpenAIError(
      '{"error": {"message": "unsupported_country_region_territory"}}',
    );
    expect(msg).toContain("not available in your region");
  });

  it("identifies region restriction (alternative wording)", () => {
    const msg = classifyOpenAIError(
      "Country, region, or territory not supported",
    );
    expect(msg).toContain("not available in your region");
  });

  it("identifies invalid API key errors", () => {
    const msg = classifyOpenAIError(
      '{"error": {"code": "invalid_api_key"}}',
    );
    expect(msg).toContain("Invalid API key");
  });

  it("identifies unauthorized errors", () => {
    const msg = classifyOpenAIError("Unauthorized access");
    expect(msg).toContain("Invalid API key");
  });

  it("identifies rate limit errors", () => {
    const msg = classifyOpenAIError("rate_limit_exceeded");
    expect(msg).toContain("Rate limit exceeded");
  });

  it("identifies quota errors", () => {
    const msg = classifyOpenAIError("You exceeded your current quota");
    expect(msg).toContain("Rate limit exceeded");
  });

  it("identifies model not found errors", () => {
    const msg = classifyOpenAIError(
      "The model `gpt-99` does not exist",
    );
    expect(msg).toContain("Model not found");
  });

  it("identifies model not found (alternative wording)", () => {
    const msg = classifyOpenAIError("Model glm-5.1 not found");
    expect(msg).toContain("Model not found");
  });

  it("identifies billing errors", () => {
    const msg = classifyOpenAIError("billing issue on your account");
    expect(msg).toContain("Billing issue");
  });

  it("identifies payment errors", () => {
    const msg = classifyOpenAIError("payment required for API access");
    expect(msg).toContain("Billing issue");
  });

  it("returns generic message for unknown errors", () => {
    const msg = classifyOpenAIError(
      "some completely unknown error string abc123",
    );
    expect(msg).toContain("error occurred");
    // Must NOT contain the raw error text
    expect(msg).not.toContain("abc123");
  });
});

// ---- parseSSEChunk ----

describe("parseSSEChunk", () => {
  it("parses a valid data line", () => {
    const line =
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}';
    const chunk = parseSSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.id).toBe("chatcmpl-1");
    expect(chunk!.choices[0].delta?.content).toBe("Hi");
  });

  it("returns null for [DONE] marker", () => {
    expect(parseSSEChunk("data: [DONE]")).toBeNull();
  });

  it("returns null for non-data lines", () => {
    expect(parseSSEChunk("")).toBeNull();
    expect(parseSSEChunk(": comment")).toBeNull();
    expect(parseSSEChunk("event: something")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSSEChunk("data: {invalid json}")).toBeNull();
  });

  it("parses chunks with reasoning_content in delta", () => {
    const line =
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","created":123,"model":"glm-5.1","choices":[{"index":0,"delta":{"reasoning_content":"thinking step"},"finish_reason":null}]}';
    const chunk = parseSSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.choices[0].delta?.reasoning_content).toBe("thinking step");
  });

  it("parses chunks with usage data", () => {
    const line =
      'data: {"id":"chatcmpl-3","object":"chat.completion.chunk","created":123,"model":"gpt-4o","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}';
    const chunk = parseSSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.usage?.prompt_tokens).toBe(10);
    expect(chunk!.usage?.completion_tokens).toBe(5);
  });

  it("parses chunks with cached tokens", () => {
    const line =
      'data: {"id":"chatcmpl-4","object":"chat.completion.chunk","created":123,"model":"gpt-4o","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":30}}}';
    const chunk = parseSSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.usage?.prompt_tokens_details?.cached_tokens).toBe(30);
  });
});

// ---- OpenAIError ----

describe("OpenAIError", () => {
  it("creates an error with status and message", () => {
    const error = new OpenAIError(429, "Rate limit exceeded");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OpenAIError);
    expect(error.status).toBe(429);
    expect(error.message).toBe("Rate limit exceeded");
    expect(error.name).toBe("OpenAIError");
  });

  it("can be caught as a regular Error", () => {
    const error = new OpenAIError(500, "Internal error");
    expect(error instanceof Error).toBe(true);
  });

  it("preserves different status codes", () => {
    expect(new OpenAIError(400, "Bad request").status).toBe(400);
    expect(new OpenAIError(401, "Unauthorized").status).toBe(401);
    expect(new OpenAIError(403, "Forbidden").status).toBe(403);
    expect(new OpenAIError(404, "Not found").status).toBe(404);
    expect(new OpenAIError(429, "Rate limited").status).toBe(429);
    expect(new OpenAIError(500, "Server error").status).toBe(500);
  });
});
