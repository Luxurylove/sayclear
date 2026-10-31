import { clip } from '../lib/json.js';
import { isLocalEndpoint, isReady } from '../lib/settings.js';

const $ = (selector) => document.querySelector(selector);

/**
 * 扩展被重载后,还开着的页面/弹窗会变成"僵尸",一律报
 * "Extension context invalidated"。翻译成人话即可。
 * (content script 用不了 ES module,那边有一份相同的实现。)
 */
function isContextInvalid(error) {
  const message = String(error?.message || error || '');
  return /extension context invalidated|message port closed|receiving end does not exist/i.test(message);
}

const STAGE_TEXT = {
  intent: '正在理解你的意思…',
  compose: '正在组织提示词…',
  local: '正在用本地规则整理…',
};

const state = {
  record: null,
  view: 'slim',
  busy: false,
  recognition: null,
  /** 追问闭环:用户补答的「问/答」对,下一次生成会并入提示词 */
  answers: [],
};

const ui = {
  input: $('#input'),
  run: $('#run'),
  voice: $('#voice'),
  hint: $('#hint'),
  progress: $('#progress'),
  stage: $('#stage'),
  error: $('#error'),
  result: $('#result'),
  goal: $('#goal'),
  meta: $('#meta'),
  constraints: $('#constraints'),
  gapsBlock: $('#gaps-block'),
  gaps: $('#gaps'),
  tabs: $('#tabs'),
  output: $('#output'),
  copy: $('#copy'),
  insert: $('#insert'),
  mode: $('#mode'),
  historyWrap: $('#history-wrap'),
  history: $('#history'),
};

/* ---------------- 启动 ---------------- */

init();

async function init() {
  bindEvents();
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'PROGRESS') {
      const text = STAGE_TEXT[message.stage];
      if (text) ui.stage.textContent = text;
    }
  });
  await Promise.all([prefillFromTab(), loadHistory(), showModelStatus()]);
}

function bindEvents() {
  ui.run.addEventListener('click', () => run());
  ui.voice.addEventListener('click', toggleVoice);
  ui.copy.addEventListener('click', copyPrompt);
  ui.insert.addEventListener('click', insertPrompt);
  $('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#clear-history').addEventListener('click', clearHistory);

  ui.tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    state.view = tab.dataset.view;
    render();
  });

  ui.input.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });
}

/* ---------------- 主流程 ---------------- */

async function run({ followUp = false } = {}) {
  const text = ui.input.value.trim();
  if (!text) {
    setHint('先说点什么,再点生成');
    ui.input.focus();
    return;
  }
  if (state.busy) return;

  // 换了新的一句话就清空旧答案;点「回答」触发的重跑要保留
  if (!followUp) state.answers = [];

  state.busy = true;
  ui.run.disabled = true;
  ui.progress.hidden = false;
  ui.stage.textContent = STAGE_TEXT.intent;
  ui.result.hidden = true;
  setError('');
  setHint('');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'RUN',
      id: crypto.randomUUID(),
      text,
      answers: state.answers,
    });
    if (!response?.ok) throw new Error(response?.error || '生成失败');
    state.record = response.record;
    state.view = 'slim';
    render();
    loadHistory();
  } catch (error) {
    setError(
      isContextInvalid(error)
        ? '扩展刚更新过,关掉这个弹窗重开一次就好。'
        : error?.message || String(error),
    );
  } finally {
    state.busy = false;
    ui.run.disabled = false;
    ui.progress.hidden = true;
  }
}

/* ---------------- 渲染 ---------------- */

function render() {
  const record = state.record;
  if (!record) return;
  const result = record.result;

  ui.result.hidden = false;
  ui.goal.textContent = result.goal;

  const meta = [];
  if (result.deliverable) meta.push(`产出:${result.deliverable}`);
  if (result.audience) meta.push(`给:${result.audience}`);
  ui.meta.textContent = meta.join(' · ');

  ui.constraints.replaceChildren(
    ...(result.constraints || []).map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    }),
  );

  renderGaps(result.missing || []);

  ui.output.textContent = currentText();
  ui.tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
  });

  renderMode(record);
}

/**
 * 缺口列表。每条都能就地补答 —— 这就是"追问闭环":
 * 答一句 → 带着答案重跑 → 新提示词里那句话变成已知条件。
 */
function renderGaps(gaps) {
  const items = gaps.map((item) => {
    const li = document.createElement('li');

    const question = document.createElement('b');
    question.textContent = item.question;
    li.append(question);

    if (item.why) {
      const why = document.createElement('span');
      why.textContent = item.why;
      li.append(why);
    }

    const answer = document.createElement('button');
    answer.type = 'button';
    answer.className = 'gap-answer';
    answer.textContent = '回答';
    answer.addEventListener('click', () => openGapEditor(li, item));
    li.append(answer);

    return li;
  });

  if (state.answers.length) items.push(buildAnsweredNote());

  ui.gapsBlock.hidden = items.length === 0;
  ui.gaps.replaceChildren(...items);
}

function buildAnsweredNote() {
  const note = document.createElement('li');
  note.className = 'gap-answered';
  note.textContent = `已补答 ${state.answers.length} 条,已并入这次生成`;
  return note;
}

function openGapEditor(li, item) {
  if (li.querySelector('.gap-editor')) return;

  const editor = document.createElement('div');
  editor.className = 'gap-editor';

  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.placeholder = '一句话就行,不用讲究';

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'chip';
  submit.textContent = '并入';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'link';
  cancel.textContent = '取消';

  const commit = () => {
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    state.answers = [
      ...state.answers.filter((entry) => entry.question !== item.question),
      { question: item.question, answer: value },
    ];
    run({ followUp: true });
  };

  submit.addEventListener('click', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') editor.remove();
  });
  cancel.addEventListener('click', () => editor.remove());

  editor.append(input, submit, cancel);
  li.append(editor);
  input.focus();
}

function renderMode(record) {
  ui.mode.replaceChildren();
  if (record.result.mode === 'local') {
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = '本地规则 · 去配置模型';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    ui.mode.append(link);
    return;
  }
  ui.mode.textContent = `${record.model} · ${(record.ms / 1000).toFixed(1)}s`;
}

function currentText() {
  if (!state.record) return '';
  return state.view === 'slim' ? state.record.result.slim : state.record.result.full;
}

/* ---------------- 复制与回填 ---------------- */

async function copyPrompt() {
  const text = currentText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    setHint('复制失败,请手动选中');
    return;
  }
  flash(ui.copy, '已复制');
}

async function insertPrompt() {
  const text = currentText();
  if (!text) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'INSERT_TEXT', text }) : null;
    if (response?.ok) {
      flash(ui.insert, '已填入');
      setTimeout(() => window.close(), 500);
      return;
    }
  } catch {
    /* 当前页面没有注入脚本,走复制 */
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 忽略 */
  }
  flash(ui.insert, '已复制,请手动粘贴');
}

function flash(button, label) {
  const original = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

/* ---------------- 语音 ---------------- */

function toggleVoice() {
  if (state.recognition) {
    stopVoice();
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setHint('这个浏览器不支持语音输入,请直接打字');
    return;
  }

  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;

  const base = ui.input.value.trim();

  recognition.onresult = (event) => {
    let text = '';
    for (const result of event.results) text += result[0].transcript;
    ui.input.value = base ? `${base} ${text}` : text;
  };
  recognition.onerror = (event) => {
    setHint(
      event.error === 'not-allowed' ? '麦克风被拒绝,请在地址栏右侧允许后再试' : `语音不可用(${event.error})`,
    );
    stopVoice();
  };
  recognition.onend = stopVoice;

  try {
    recognition.start();
  } catch {
    setHint('无法启动语音识别');
    return;
  }

  state.recognition = recognition;
  ui.voice.setAttribute('aria-pressed', 'true');
  ui.voice.textContent = '● 正在听…';
  setHint('再点一次结束');
}

function stopVoice() {
  const recognition = state.recognition;
  state.recognition = null;
  if (recognition) {
    try {
      recognition.abort();
    } catch {
      /* 忽略 */
    }
  }
  ui.voice.setAttribute('aria-pressed', 'false');
  ui.voice.textContent = '🎤 语音';
}

/* ---------------- 历史 ---------------- */

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' }).catch(() => null);
  const items = (response?.history || []).slice(0, 5);

  ui.historyWrap.hidden = items.length === 0;
  ui.history.replaceChildren(
    ...items.map((record) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';

      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatTime(record.ts);

      button.append(time, document.createTextNode(clip(record.raw, 30)));
      button.addEventListener('click', () => {
        state.record = record;
        state.view = 'slim';
        state.answers = record.answers || [];
        ui.input.value = record.raw;
        setError('');
        render();
      });

      li.append(button);
      return li;
    }),
  );
}

async function clearHistory() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }).catch(() => null);
  ui.historyWrap.hidden = true;
  ui.history.replaceChildren();
}

function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/* ---------------- 其它 ---------------- */

async function prefillFromTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' });
    if (response?.text && !ui.input.value.trim()) {
      ui.input.value = response.text.slice(0, 2000);
      setHint('已带入页面上选中的文字');
    } else if (response && !ui.hint.textContent) {
      // 能收到回包 = content script 已经在这个页面里跑起来了
      setHint('已连接本页,选中文字即可就地改写');
    }
  } catch {
    /* 当前页面不是 AI 站点,没有注入脚本 */
  }
}

async function showModelStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => null);
  const settings = response?.settings;
  if (!settings || ui.hint.textContent) return;

  if (!isReady(settings)) {
    setHint('还没配置模型,先用本地规则');
  } else if (isLocalEndpoint(settings.baseUrl)) {
    setHint(`本地模型:${settings.model}`);
  }
}

function setError(message) {
  ui.error.hidden = !message;
  ui.error.textContent = message || '';
}

function setHint(message) {
  ui.hint.textContent = message || '';
}