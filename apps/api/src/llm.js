/**
 * Thin client for a locally hosted open-weight model.
 *
 * - provider "ollama": native /api/chat with `format` = JSON schema (grammar-constrained
 *   decoding) and `think: false`, which keeps tiny reasoning models (Qwen3 0.6B/1.7B) fast.
 * - provider "openai": any OpenAI-compatible server (LM Studio, llama.cpp llama-server, vLLM)
 *   using `response_format: { type: "json_schema" }`.
 * - provider "off": skip the model and use the rule-based parser only.
 */
export const aiConfig = () => {
  const provider = (process.env.AI_PROVIDER ?? 'ollama').toLowerCase();
  const defaults = {
    ollama: 'http://127.0.0.1:11434',
    openai: 'http://127.0.0.1:1234/v1',
  };
  return {
    provider,
    baseUrl: (process.env.AI_BASE_URL ?? defaults[provider] ?? '').replace(/\/$/, ''),
    model: process.env.AI_MODEL ?? 'qwen3:0.6b',
    apiKey: process.env.AI_API_KEY ?? 'local',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 120000),
    numCtx: Number(process.env.AI_NUM_CTX ?? 4096),
  };
};

const fetchJson = async (url, { timeoutMs, ...options } = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs ?? 5000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
};

/** Pull the first JSON object out of a model reply, tolerating think tags and code fences. */
export const extractJson = (content) => {
  const cleaned = String(content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Model reply contained no JSON object');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
};

export const aiStatus = async () => {
  const config = aiConfig();
  const base = { provider: config.provider, model: config.model, baseUrl: config.baseUrl };
  if (config.provider === 'off') {
    return { ...base, reachable: false, modelAvailable: false, error: 'AI disabled (AI_PROVIDER=off)' };
  }
  try {
    let names = [];
    if (config.provider === 'ollama') {
      const tags = await fetchJson(`${config.baseUrl}/api/tags`, { timeoutMs: 3000 });
      names = (tags.models ?? []).map((model) => model.name);
    } else {
      const models = await fetchJson(`${config.baseUrl}/models`, {
        timeoutMs: 3000,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      names = (models.data ?? []).map((model) => model.id);
    }
    // OpenAI-compatible servers (llama.cpp especially) often serve one model whatever name is sent.
    const modelAvailable =
      config.provider !== 'ollama' || names.includes(config.model) || names.includes(`${config.model}:latest`);
    return {
      ...base,
      reachable: true,
      modelAvailable,
      installedModels: names,
      error: modelAvailable ? null : `Model "${config.model}" is not installed. Run: ollama pull ${config.model}`,
    };
  } catch (error) {
    return { ...base, reachable: false, modelAvailable: false, error: `Cannot reach ${config.baseUrl}: ${error.message}` };
  }
};

/** Ask the local model for JSON matching `schema`. Returns the parsed object. */
export const completeJson = async ({ system, user, schema }) => {
  const config = aiConfig();
  if (config.provider === 'off') throw new Error('AI disabled');

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  if (config.provider === 'ollama') {
    const body = {
      model: config.model,
      messages,
      stream: false,
      format: schema,
      think: false,
      keep_alive: '15m',
      options: { temperature: 0, num_ctx: config.numCtx },
    };
    let reply;
    try {
      reply = await fetchJson(`${config.baseUrl}/api/chat`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: config.timeoutMs,
      });
    } catch (error) {
      // Older Ollama builds or non-thinking models may reject the `think` flag.
      if (!/think/i.test(error.message)) throw error;
      delete body.think;
      reply = await fetchJson(`${config.baseUrl}/api/chat`, {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: config.timeoutMs,
      });
    }
    return extractJson(reply.message?.content);
  }

  const reply = await fetchJson(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeoutMs: config.timeoutMs,
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'timetable_draft', strict: true, schema },
      },
    }),
  });
  return extractJson(reply.choices?.[0]?.message?.content);
};
