/** Official channels support JSON output, not necessarily OpenAI json_schema.
 * Mastra injects the schema into the prompt and still validates the result.
 * The 1Token Opus and Kimi proxy profiles also use JSON mode; legacy Flagship retains JSON schema.
 */
export function structuredOutputForBand<T>(schema: T, band: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  const mode = env.AI_MODEL_ROUTING_MODE?.trim() ?? '';
  const officialJsonBands = band === 'eco' || band === 'standard' || band === 'flagship';
  const officialDirectProfile = mode === 'three-channel' && officialJsonBands;
  const litellmOfficialBands = mode === 'litellm' && (band === 'eco' || band === 'standard');
  const litellmJsonFlagship = mode === 'litellm' && ['onetoken','kimi'].includes(env.AI_PROXY_MODEL_PROFILE ?? '') && band === 'flagship';
  return {
    schema,
    ...(officialDirectProfile || litellmOfficialBands || litellmJsonFlagship ? { jsonPromptInjection: true } : {}),
  };
}
