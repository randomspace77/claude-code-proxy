import type { AppConfig, ClaudeMessagesRequest, ClaudeTokenCountRequest, ClaudeSystemContent } from "./types";
import { loadConfig, validateClientApiKey, extractApiKey } from "./config";
import { convertClaudeToOpenAI } from "./conversion/request";
import {
  convertOpenAIToClaude,
  convertOpenAIStreamToClaude,
} from "./conversion/response";
import {
  createChatCompletion,
  createChatCompletionStream,
  classifyOpenAIError,
  OpenAIError,
} from "./client";

// ---- Handlers ----

/**
 * POST /v1/messages – Main proxy endpoint.
 */
export async function handleMessages(
  request: Request,
  config: AppConfig,
): Promise<Response> {
  // Validate API key is configured
  if (!config.openaiApiKey) {
    return errorResponse(500, "OPENAI_API_KEY is not configured on the server");
  }

  // Parse body
  let body: ClaudeMessagesRequest;
  try {
    body = (await request.json()) as ClaudeMessagesRequest;
  } catch {
    return errorResponse(400, "Invalid JSON in request body");
  }

  // Basic validation
  if (!body.model || !body.messages || !Array.isArray(body.messages)) {
    return errorResponse(400, "Missing required fields: model, messages");
  }

  try {
    const openaiRequest = convertClaudeToOpenAI(body, config);

    if (body.stream) {
      // Streaming
      const openaiStream = await createChatCompletionStream(
        config,
        openaiRequest,
      );
      const claudeStream = convertOpenAIStreamToClaude(openaiStream, body);

      // Encode string chunks into bytes for the response
      const encoder = new TextEncoder();
      const byteStream = claudeStream.pipeThrough(
        new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk));
          },
        }),
      );

      return new Response(byteStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
        },
      });
    } else {
      // Non-streaming
      const openaiResponse = await createChatCompletion(config, openaiRequest);
      const claudeResponse = convertOpenAIToClaude(openaiResponse, body);
      return Response.json(claudeResponse);
    }
  } catch (err) {
    if (err instanceof OpenAIError) {
      return errorResponse(err.status, err.message);
    }
    // Log internal errors but don't expose raw details to client
    console.error("Unexpected error processing request:", err);
    const message =
      err instanceof Error ? err.message : String(err);
    const classified = classifyOpenAIError(message);
    // If classifyOpenAIError returned the raw message, replace with generic
    const safeMessage = classified === message
      ? "An unexpected error occurred while processing the request"
      : classified;
    return errorResponse(500, safeMessage);
  }
}

/**
 * POST /v1/messages/count_tokens – Token counting endpoint.
 */
export async function handleCountTokens(
  request: Request,
): Promise<Response> {
  let body: ClaudeTokenCountRequest;
  try {
    body = (await request.json()) as ClaudeTokenCountRequest;
  } catch {
    return errorResponse(400, "Invalid JSON in request body");
  }

  let totalChars = 0;

  // System message
  if (body.system) {
    if (typeof body.system === "string") {
      totalChars += body.system.length;
    } else if (Array.isArray(body.system)) {
      for (const block of body.system as ClaudeSystemContent[]) {
        if (block.text) totalChars += block.text.length;
      }
    }
  }

  // Messages
  for (const msg of body.messages ?? []) {
    if (msg.content === null || msg.content === undefined) continue;
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ("text" in block && typeof block.text === "string") {
          totalChars += block.text.length;
        }
      }
    }
  }

  // Rough estimation: ~4 characters per token
  const estimatedTokens = Math.max(1, Math.floor(totalChars / 4));

  return Response.json({ input_tokens: estimatedTokens });
}

/**
 * GET /health – Health check endpoint.
 */
export function handleHealth(config: AppConfig): Response {
  return Response.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    openai_api_configured: Boolean(config.openaiApiKey),
    client_api_key_validation: Boolean(config.anthropicApiKey),
  });
}

/**
 * GET / – Root endpoint.
 */
export function handleRoot(config: AppConfig): Response {
  return Response.json({
    message: "Claude-to-OpenAI API Proxy v1.0.0",
    status: "running",
    config: {
      openai_base_url: config.openaiBaseUrl,
      max_tokens_limit: config.maxTokensLimit,
      api_key_configured: Boolean(config.openaiApiKey),
      client_api_key_validation: Boolean(config.anthropicApiKey),
      big_model: config.bigModel,
      middle_model: config.middleModel,
      small_model: config.smallModel,
    },
    endpoints: {
      messages: "/v1/messages",
      count_tokens: "/v1/messages/count_tokens",
      health: "/health",
    },
  });
}

// ---- Auth middleware ----

/**
 * Validate the client API key. Returns a Response (error) if invalid, or null
 * if the request is authorized.
 */
export function authenticate(
  request: Request,
  config: AppConfig,
): Response | null {
  const clientKey = extractApiKey(request.headers);
  if (!validateClientApiKey(config, clientKey)) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "authentication_error",
          message:
            "Invalid API key. Please provide a valid Anthropic API key.",
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  return null;
}

// ---- Helpers ----

function errorResponse(
  status: number,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "api_error", message },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}
