/**
 * 后台 service worker:唯一的出网口和唯一的数据入口。
 *
 * 所有模型调用都留在这里,而不是放在 popup 或 content script 里,有两个原因:
 *   1. API key 不必进入页面上下文(content script 跑在别人家的网页里);
 *   2. service worker 有扩展的源,配合 host 权限可以直连任意 OpenAI 兼容接口。
 */
import { chat } from './lib/llm.js';
import { loadPrompt } from './lib/prompts.js';
import { run } from './lib/pipeline.js';
import { DEFAULT_SETTINGS } from './lib/settings.js';

const HISTORY_LIMIT = 40;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/** 向所有扩展页面广播进度;popup 没开着的时候会 reject,忽略即可。 */
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function saveHistory(record) {
  const { history = [] } = await chrome.storage.local.get('history');
  const next = [record, ...history.filter((item) => item.raw !== record.raw)].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ history: next });
}

async function handleRun(payload) {
  const settings = await getSettings();
  const startedAt = Date.now();

  const result = await run({
    text: payload.text,
    context: payload.context || '',
    answers: payload.answers || [],
    settings,
    loadPrompt,
    chat: (options) =>
      chat({
        ...options,
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
      }),
    onStage: (stage) => broadcast({ type: 'PROGRESS', stage, id: payload.id }),
  });

  const record = {
    id: payload.id || crypto.randomUUID(),
    raw: result.raw,
    result,
    answers: payload.answers || [],
    ms: Date.now() - startedAt,
    ts: Date.now(),
    model: result.mode === 'llm' ? settings.model : '本地规则',
  };

  await saveHistory(record);
  return { ok: true, record };
}

async function handleTest(overrides) {
  const settings = { ...(await getSettings()), ...(overrides || {}) };
  const reply = await chat({
    ...settings,
    json: false,
    temperature: 0,
    messages: [{ role: 'user', content: '只回复两个字:pong' }],
  });
  return { ok: true, reply: reply.slice(0, 80) };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, history: [] });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === 'RUN') {
    handleRun(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (type === 'TEST') {
    handleTest(message.settings)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (type === 'GET_SETTINGS') {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (type === 'GET_HISTORY') {
    chrome.storage.local.get('history').then(({ history = [] }) => sendResponse({ ok: true, history }));
    return true;
  }

  if (type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ history: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});