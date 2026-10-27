/** Official channels support JSON output, not necessarily OpenAI json_schema.
 * Mastra injects the schema into the prompt and still validates the result.
 * Preserve the legacy proxy contract (including Flagship) unchanged.
 */
export function structuredOutputForBand<T>(schema: T, band: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    schema,
    ...(['three-channel', 'litellm'].includes(env.AI_MODEL_ROUTING_MODE?.trim() ?? '') && (band === 'eco' || band === 'standard')
      ? { jsonPromptInjection: true } : {}),
  };
}
