/**
 * 设置项的唯一真相来源。
 *
 * 这里最要紧的是 isReady():它决定走模型还是走本地规则。
 * 判断标准不是"填了地址",而是"地址加凭据真的能发出请求"——
 * 本地 Ollama 不需要 key,所以按 host 区分。
 */

export const PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  custom: { baseUrl: '', model: '' },
};

export const DEFAULT_SETTINGS = {
  provider: 'openai',
  baseUrl: PRESETS.openai.baseUrl,
  model: PRESETS.openai.model,
  apiKey: '',
};

export function isLocalEndpoint(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  } catch {
    return false;
  }
}

export function isReady(settings) {
  if (!settings?.baseUrl || !settings?.model) return false;
  return Boolean(settings.apiKey) || isLocalEndpoint(settings.baseUrl);
}