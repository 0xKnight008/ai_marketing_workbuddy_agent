/** Official channels support JSON output, not necessarily OpenAI json_schema.
 * Mastra injects the schema into the prompt and still validates the result.
 * The 1Token Opus profile also uses JSON mode; legacy Flagship retains JSON schema.
 */
export function structuredOutputForBand<T>(schema: T, band: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    schema,
    ...(['three-channel', 'litellm'].includes(env.AI_MODEL_ROUTING_MODE?.trim() ?? '') && (band === 'eco' || band === 'standard' || (env.AI_MODEL_ROUTING_MODE === 'litellm' && env.AI_PROXY_MODEL_PROFILE === 'onetoken' && band === 'flagship'))
      ? { jsonPromptInjection: true } : {}),
  };
}
