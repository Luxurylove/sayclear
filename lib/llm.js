/**
 * 一个极简的 OpenAI 兼容客户端。
 *
 * 刻意不加 SDK:目标接口只有 /chat/completions 一个,而 OpenAI、DeepSeek、
 * Kimi、Ollama、vLLM、OneAPI 全都实现了它。少一个依赖,扩展就少一个构建步骤。
 */

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
}

export function endpointOf(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('还没有配置模型地址');
  return `${base}/chat/completions`;
}

export async function chat({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.3,
  json = true,
  provider = 'openai',
  signal,
}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('还没有配置模型,请点右上角设置');
  if (!model) throw new Error('还没有填写模型名');

  const body = { model, messages, temperature, stream: false };
  // Ollama 的兼容层对 response_format 支持不稳定,交给提示词约束即可。
  if (json && provider !== 'ollama') body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const endpoint = endpointOf(base);
  const send = (payload) =>
    fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal });

  let res;
  try {
    res = await send(body);
  } catch {
    throw new Error(`连不上 ${base}。请检查网络,以及是否在设置里为本地址授权访问。`);
  }

  let text = await res.text();

  // 中转站、国产模型、部分兼容层不认 response_format,会直接回 400。
  // 这时去掉它重试一次——比让用户以为自己 key 填错了要好。
  if (!res.ok && body.response_format && (res.status === 400 || res.status === 422)) {
    const fallback = { ...body };
    delete fallback.response_format;
    try {
      const retry = await send(fallback);
      const retryText = await retry.text();
      if (retry.ok) {
        res = retry;
        text = retryText;
      }
    } catch {
      /* 重试失败就保留第一次的报错,它更有指向性 */
    }
  }

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON 响应,下面统一报错 */
  }

  if (!res.ok) {
    const detail = data?.error?.message || data?.message || text.slice(0, 160);
    throw new Error(`模型接口返回 ${res.status}:${detail}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回内容');
  return String(content);
}