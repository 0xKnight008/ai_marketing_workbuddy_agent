/**
 * Mastra 1.23.0 resolves `openai/<alias>` string models to its built-in
 * openai provider, which defaults to POST /v1/responses. The routing
 * gateway (one-api) and the upstream supplier only implement
 * /v1/chat/completions.
 *
 * When `model` is an object with { id, url, apiKey }, Mastra takes the
 * OpenAICompatible path and calls /v1/chat/completions instead.
 */
export type ChatCompletionsModel =
  | string
  | {
      id: `${string}/${string}`;
      url: string;
      apiKey: string;
    };

export function chatCompletionsModel(model: string): ChatCompletionsModel {
  if (!model.startsWith('openai/')) return model;

  const url = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!url || !apiKey) {
    throw new Error(
      'OPENAI_BASE_URL and OPENAI_API_KEY are required to build a chat-completions model',
    );
  }

  return { id: model as `${string}/${string}`, url, apiKey };
}
