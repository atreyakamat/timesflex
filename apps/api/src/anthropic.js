import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude as the assistant's model (AI_PROVIDER=anthropic, or automatically when
 * ANTHROPIC_API_KEY is set). Every call asks for JSON shaped by the same schemas the local
 * model uses, so the rest of the API does not care which model answered.
 *
 * - Structured outputs (`output_config.format`) keep replies schema-valid.
 * - Server-side refusal fallback (`fallbacks: "default"`) retries a declined request on the
 *   model Anthropic recommends, so a false-positive refusal does not break a demo.
 * - Effort is "low": these are short extraction / classification calls.
 */

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let shared = null;
/** One client per process; the SDK reads ANTHROPIC_API_KEY itself. Tests can inject a fake. */
export const claudeClient = () => (shared ??= new Anthropic({ timeout: 60_000, maxRetries: 2 }));
export const setClaudeClient = (client) => {
  shared = client;
};

/**
 * Structured outputs want closed objects: every property listed in `required`, no extra
 * properties, and nullable values as `anyOf [T, null]`. Converts our looser schemas.
 */
export const toStrictSchema = (schema) => {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toStrictSchema(sub)]));
    } else if (key === 'items' || key === 'anyOf') {
      out[key] = toStrictSchema(value);
    } else {
      out[key] = value;
    }
  }
  if (Array.isArray(out.type)) {
    const { type, enum: allowed, ...rest } = out;
    return {
      anyOf: type.map((one) => (one === 'null' ? { type: 'null' } : { ...rest, type: one, ...(allowed ? { enum: allowed.filter((v) => v !== null) } : {}) })),
    };
  }
  if (out.type === 'object' && out.properties) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
};

const textOf = (response) =>
  response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

/** Ask Claude for one JSON object matching `schema`. Throws on refusal or unusable output. */
export const claudeJson = async ({ system, user, schema, model = process.env.AI_MODEL || DEFAULT_CLAUDE_MODEL, extractJson }) => {
  const client = claudeClient();
  const request = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  };

  let response;
  try {
    response = await client.beta.messages.create({
      ...request,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: toStrictSchema(schema) } },
    });
  } catch (error) {
    // A schema the structured-output validator rejects should not cost the user the feature:
    // ask again with the schema in the prompt and read the JSON out of the text.
    if (!(error instanceof Anthropic.BadRequestError)) throw error;
    response = await client.beta.messages.create({
      ...request,
      system: `${system}\n\nReply with one JSON object only, matching this JSON schema:\n${JSON.stringify(schema)}`,
      output_config: { effort: 'low' },
    });
  }

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}.`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room for the answer.');
  return extractJson(textOf(response));
};

/** Is a key configured, and does the model exist for it? Uses the free Models API, no tokens. */
export const claudeStatus = async (model = process.env.AI_MODEL || DEFAULT_CLAUDE_MODEL) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { reachable: false, modelAvailable: false, error: 'ANTHROPIC_API_KEY is not set. Add it to apps/api/.env.' };
  }
  try {
    await claudeClient().models.retrieve(model);
    return { reachable: true, modelAvailable: true, error: null };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { reachable: true, modelAvailable: false, error: 'The Anthropic API key was rejected. Check apps/api/.env.' };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return { reachable: true, modelAvailable: false, error: `Model "${model}" is not available for this key.` };
    }
    return { reachable: false, modelAvailable: false, error: `Cannot reach the Anthropic API: ${error.message}` };
  }
};
