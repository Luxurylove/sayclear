import { DEFAULT_SETTINGS, PRESETS } from '../lib/settings.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  provider: $('#provider'),
  baseUrl: $('#base-url'),
  model: $('#model'),
  apiKey: $('#api-key'),
  save: $('#save'),
  test: $('#test'),
  status: $('#status'),
  clearHistory: $('#clear-history'),
};

init();

async function init() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => null);
  const settings = response?.settings || DEFAULT_SETTINGS;
  ui.provider.value = settings.provider || 'openai';
  ui.baseUrl.value = settings.baseUrl || '';
  ui.model.value = settings.model || '';
  ui.apiKey.value = settings.apiKey || '';

  ui.provider.addEventListener('change', () => {
    const preset = PRESETS[ui.provider.value];
    if (preset) {
      ui.baseUrl.value = preset.baseUrl;
      ui.model.value = preset.model;
    }
    ui.apiKey.placeholder = ui.provider.value === 'ollama' ? '用 Ollama 可以留空' : 'sk-...';
  });

  ui.save.addEventListener('click', save);
  ui.test.addEventListener('click', test);
  ui.clearHistory.addEventListener('click', clearHistory);
}

function readForm() {
  return {
    provider: ui.provider.value,
    baseUrl: ui.baseUrl.value.trim().replace(/\/+$/, ''),
    model: ui.model.value.trim(),
    apiKey: ui.apiKey.value.trim(),
  };
}

function originOf(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

async function save() {
  const settings = readForm();
  const origin = originOf(settings.baseUrl);
  if (!origin) {
    setStatus('接口地址格式不对,要形如 https://api.openai.com/v1', 'error');
    return;
  }
  if (!settings.model) {
    setStatus('别忘了填模型名', 'error');
    return;
  }

  setBusy(true);
  try {
    // 注意:permissions.request 必须在点击手势的同一次执行里发起,
    // 所以它放在任何 await 之前,而不是保存完之后再补。
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    await chrome.storage.local.set({ settings });
    setStatus(
      granted ? '已保存,可以开始用了' : '设置已存,但没拿到该域名的访问权限,生成时会失败',
      granted ? 'ok' : 'error',
    );
  } finally {
    setBusy(false);
  }
}

async function test() {
  const settings = readForm();
  const origin = originOf(settings.baseUrl);
  if (!origin) {
    setStatus('先填一个合法的接口地址,再测试', 'error');
    return;
  }

  setBusy(true);
  setStatus('正在连接…', '');
  await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);

  const response = await chrome.runtime.sendMessage({ type: 'TEST', settings }).catch(() => null);
  setBusy(false);

  if (response?.ok) {
    setStatus(`通了。模型回复:${response.reply}`, 'ok');
  } else {
    setStatus(response?.error || '连接失败,检查地址、模型名和 key', 'error');
  }
}

async function clearHistory() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }).catch(() => null);
  setStatus('生成记录已清空', 'ok');
}

function setStatus(message, kind = '') {
  ui.status.textContent = message;
  ui.status.className = `status${kind ? ` ${kind}` : ''}`;
}

function setBusy(busy) {
  ui.save.disabled = busy;
  ui.test.disabled = busy;
}