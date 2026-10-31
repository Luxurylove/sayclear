/**
 * 页面内改写:在 AI 对话页选中一段糙话,浮出一个按钮,就地生成提示词。
 *
 * 三条硬约束:
 *   1. 不能污染宿主页面样式 —— 整个 UI 关在 Shadow DOM 里,并用 pointer-events
 *      让覆盖层不吃掉页面的点击。
 *   2. 不能偷看别的东西 —— 只读选中文本和页面标题,且只在 AI 站点上运行。
 *   3. 不能把 API key 带进页面 —— 生成请求一律转交 background 处理。
 */
(() => {
  'use strict';

  if (window.__sayclearInjected) return;
  window.__sayclearInjected = true;

  const MIN_SELECTION = 2;
  const STAGE_TEXT = {
    intent: '正在理解你的意思…',
    compose: '正在组织提示词…',
    local: '正在用本地规则整理…',
  };

  const STYLE = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }

    .sc-trigger {
      position: fixed; pointer-events: auto; margin: 0; padding: 6px 12px;
      font-size: 12px; line-height: 1.4; color: #fff; background: #111827;
      border: 0; border-radius: 999px; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .28); white-space: nowrap;
    }
    .sc-trigger:hover { background: #1f2937; }

    .sc-panel {
      position: fixed; right: 20px; bottom: 20px; width: 384px; max-height: 76vh;
      display: flex; flex-direction: column; pointer-events: auto;
      background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 14px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, .22); overflow: hidden;
      font-size: 13px; line-height: 1.6; text-align: left;
    }

    .sc-head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid #f1f5f9; background: #fafbfc;
    }
    .sc-title { font-size: 12px; font-weight: 600; letter-spacing: .04em; color: #475569; }
    .sc-badge {
      font-size: 10px; padding: 1px 6px; border-radius: 999px;
      background: #eef2ff; color: #4338ca; border: 1px solid #e0e7ff;
    }
    .sc-close {
      margin-left: auto; border: 0; background: transparent; cursor: pointer;
      font-size: 16px; line-height: 1; color: #94a3b8; padding: 2px 4px; border-radius: 6px;
    }
    .sc-close:hover { background: #f1f5f9; color: #334155; }

    .sc-body { padding: 12px; overflow: auto; }
    .sc-stage { color: #64748b; font-size: 12px; }

    .sc-block { margin-bottom: 12px; }
    .sc-label {
      font-size: 10px; font-weight: 600; letter-spacing: .08em; color: #94a3b8;
      text-transform: uppercase; margin-bottom: 3px;
    }
    .sc-goal { font-weight: 600; color: #0f172a; }
    .sc-meta { color: #64748b; font-size: 12px; }

    .sc-gaps { margin: 0; padding-left: 16px; color: #334155; }
    .sc-gaps li { margin-bottom: 6px; }
    .sc-gaps b { font-weight: 600; color: #0f172a; display: block; }
    .sc-gaps span { color: #94a3b8; font-size: 12px; }

    .sc-answer {
      margin-top: 4px; padding: 1px 8px; font: inherit; font-size: 11px; line-height: 1.6;
      border: 1px solid #e2e8f0; border-radius: 999px; background: #fff;
      color: #64748b; cursor: pointer;
    }
    .sc-answer:hover { border-color: #2563eb; color: #2563eb; }

    .sc-editor { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .sc-editor input {
      flex: 1; min-width: 0; padding: 5px 8px; font: inherit; font-size: 12px;
      border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; color: #111827; outline: none;
    }
    .sc-editor input:focus { border-color: #2563eb; }
    .sc-editor .sc-go { flex: 0 0 auto; padding: 5px 10px; }

    .sc-answered { list-style: none; margin-top: 6px; font-size: 11px; color: #94a3b8; }

    .sc-tabs { display: flex; gap: 4px; margin: 4px 0 8px; }
    .sc-tab {
      border: 1px solid #e2e8f0; background: #fff; color: #64748b;
      font-size: 12px; padding: 3px 10px; border-radius: 8px; cursor: pointer;
    }
    .sc-tab[aria-selected="true"] { background: #111827; border-color: #111827; color: #fff; }

    .sc-output {
      margin: 0; padding: 10px; max-height: 32vh; overflow: auto;
      background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px; line-height: 1.65; white-space: pre-wrap; word-break: break-word;
      color: #1e293b;
    }

    .sc-foot {
      display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f1f5f9; background: #fafbfc;
    }
    .sc-btn {
      flex: 1; padding: 7px 10px; font-size: 12px; border-radius: 8px; cursor: pointer;
      border: 1px solid #dbe2ea; background: #fff; color: #334155;
    }
    .sc-btn:hover { background: #f8fafc; }
    .sc-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .sc-btn.primary:hover { background: #1d4ed8; }
    .sc-btn:disabled { opacity: .55; cursor: default; }

    .sc-error { color: #b91c1c; font-size: 12px; }
    .sc-note { margin-top: 8px; font-size: 11px; color: #94a3b8; }

    @media (prefers-color-scheme: dark) {
      .sc-panel { background: #0f172a; color: #e2e8f0; border-color: #1e293b; }
      .sc-head, .sc-foot { background: #111c33; border-color: #1e293b; }
      .sc-title { color: #94a3b8; }
      .sc-goal, .sc-gaps b { color: #f8fafc; }
      .sc-output { background: #131f36; border-color: #1e293b; color: #dbe4f0; }
      .sc-tab { background: #0f172a; border-color: #1e293b; color: #94a3b8; }
      .sc-btn { background: #0f172a; border-color: #1e293b; color: #cbd5e1; }
      .sc-close:hover { background: #1e293b; color: #e2e8f0; }
      .sc-badge { background: #1e1b4b; border-color: #312e81; color: #c7d2fe; }
      .sc-answer, .sc-editor input { background: #0f172a; border-color: #1e293b; color: #cbd5e1; }
      .sc-answer:hover { border-color: #3b82f6; color: #93c5fd; }
      .sc-editor input:focus { border-color: #3b82f6; }
    }
  `;

  let host = null;
  let shadow = null;
  let trigger = null;
  let panel = null;
  let lastEditable = null;
  let activeResult = null;
  let activeView = 'slim';
  let currentStage = '';
  let runToken = 0;
  /** 记录"这句话是从哪段选区里长出来的",填回时才能原位替换而不是追加 */
  let pendingTarget = null;
  /** 追问闭环:用户补答的「问/答」对,重跑时并入提示词 */
  let activeAnswers = [];

  /* ---------------- 基础工具 ---------------- */

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  function mount() {
    if (host && host.isConnected) return shadow;
    host = document.createElement('div');
    host.setAttribute('data-sayclear', '');
    host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.append(el('style', { text: STYLE }));
    (document.body || document.documentElement).append(host);
    return shadow;
  }

  function isTextControl(node) {
    if (!node) return false;
    if (node.tagName === 'TEXTAREA') return true;
    return node.tagName === 'INPUT' && ['text', 'search', 'url', ''].includes(node.type);
  }

  function isEditable(node) {
    if (!node || node.nodeType !== 1) return false;
    return isTextControl(node) || node.isContentEditable;
  }

  /**
   * 扩展被重载后,老页面里的脚本会变成"僵尸":chrome.runtime 还在,
   * 但已经连不上后台。这时一律报 "Extension context invalidated"。
   * 唯一解法是刷新页面,所以这里只负责把它翻译成人话。
   *
   * (content script 不能用 ES module,这段在 popup.js 里有一份相同的。)
   */
  function isContextInvalid(error) {
    const message = String(error?.message || error || '');
    return /extension context invalidated|message port closed|receiving end does not exist/i.test(
      message,
    );
  }

  function isAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  /**
   * 取当前选中的文字,有两条完全不同的路:
   *   - 普通文本 / contenteditable:走 window.getSelection()
   *   - textarea / input:浏览器不会把框内选中的文字放进 getSelection,
   *     只能读 selectionStart/selectionEnd。DeepSeek、豆包这类输入框正是
   *     textarea,漏掉这条就会出现"明明选了,按钮不弹"。
   */
  function readSelection() {
    const active = document.activeElement;
    if (isTextControl(active) && typeof active.selectionStart === 'number') {
      const text = active.value.slice(active.selectionStart, active.selectionEnd).trim();
      if (text) return text;
    }
    const selection = window.getSelection();
    return selection ? String(selection).trim() : '';
  }

  function clearSelection() {
    const active = document.activeElement;
    if (isTextControl(active) && typeof active.setSelectionRange === 'function') {
      active.setSelectionRange(active.selectionEnd, active.selectionEnd);
    }
    window.getSelection()?.removeAllRanges();
  }

  /**
   * 在清掉选区之前,把"改写对象"记下来:哪个框、从第几个字到第几个字、
   * 原文是什么。填回时据此原位替换。记录原文是为了在用户于等待期间
   * 又改了内容时能发现对不上,老实退化成追加。
   */
  function captureTarget() {
    const active = document.activeElement;
    if (
      isTextControl(active) &&
      typeof active.selectionStart === 'number' &&
      active.selectionEnd > active.selectionStart
    ) {
      return {
        kind: 'control',
        el: active,
        start: active.selectionStart,
        end: active.selectionEnd,
        snapshot: active.value.slice(active.selectionStart, active.selectionEnd),
      };
    }
    const selection = window.getSelection();
    if (selection?.rangeCount && String(selection).trim()) {
      return { kind: 'editable', range: selection.getRangeAt(0).cloneRange() };
    }
    return null;
  }

  /* ---------------- 浮出按钮 ---------------- */

  function anchorPoint() {
    const active = document.activeElement;
    if (isTextControl(active)) {
      const rect = active.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    }
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height) return { x: rect.right, y: rect.bottom };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  function showTrigger(point) {
    const root = mount();
    if (!trigger) {
      trigger = el('button', {
        class: 'sc-trigger',
        type: 'button',
        text: '✦ 说清楚',
        onmousedown: (event) => event.preventDefault(),
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          const selected = readSelection();
          if (!selected) return;
          hideTrigger();
          pendingTarget = captureTarget();
          clearSelection();
          activeAnswers = [];
          startRun(selected, document.title);
        },
      });
      root.append(trigger);
    }

    // 贴着鼠标松手的位置;太靠下就翻到上面,免得被窗口边缘吃掉
    const below = point.y + 12;
    const top = below > window.innerHeight - 52 ? Math.max(8, point.y - 44) : below;
    const left = Math.min(window.innerWidth - 116, Math.max(8, point.x - 46));
    trigger.style.top = `${top}px`;
    trigger.style.left = `${left}px`;
    trigger.hidden = false;
  }

  function hideTrigger() {
    if (trigger) trigger.hidden = true;
  }

  function onSelectionEnd(point) {
    if (readSelection().length < MIN_SELECTION) {
      hideTrigger();
      return;
    }
    showTrigger(point || anchorPoint());
  }

  /* ---------------- 面板 ---------------- */

  function ensurePanel() {
    if (panel && panel.isConnected) return panel;
    panel = el('section', { class: 'sc-panel', 'aria-live': 'polite' });
    mount().append(panel);
    return panel;
  }

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
    activeResult = null;
  }

  function renderHead(badge) {
    return el('div', { class: 'sc-head' }, [
      el('span', { class: 'sc-title', text: '说清楚' }),
      badge ? el('span', { class: 'sc-badge', text: badge }) : null,
      el('button', { class: 'sc-close', type: 'button', text: '×', title: '关闭', onclick: closePanel }),
    ]);
  }

  function renderLoading() {
    const node = ensurePanel();
    node.replaceChildren(
      renderHead(null),
      el('div', { class: 'sc-body' }, [
        el('div', { class: 'sc-stage', text: STAGE_TEXT[currentStage] || '正在处理…' }),
      ]),
    );
  }

  /** 扩展刚重载过:给一个说得清、点得动的恢复入口,而不是抛英文错 */
  function renderStale() {
    const node = ensurePanel();
    node.replaceChildren(
      renderHead(null),
      el('div', { class: 'sc-body' }, [
        el('div', { class: 'sc-error', text: '扩展刚更新过,这个页面还在跑旧脚本。' }),
        el('div', { class: 'sc-note', text: '刷新一次页面就好,之后不用再刷。' }),
      ]),
      el('div', { class: 'sc-foot' }, [
        el('button', { class: 'sc-btn', type: 'button', text: '关闭', onclick: closePanel }),
        el('button', {
          class: 'sc-btn primary',
          type: 'button',
          text: '刷新页面',
          onclick: () => location.reload(),
        }),
      ]),
    );
  }

  function renderError(message, retryText) {
    const node = ensurePanel();
    node.replaceChildren(
      renderHead(null),
      el('div', { class: 'sc-body' }, [
        el('div', { class: 'sc-error', text: message }),
        el('div', { class: 'sc-note', text: '如果不能连接,请点扩展图标 → 设置,检查模型地址和授权。' }),
      ]),
      el('div', { class: 'sc-foot' }, [
        el('button', {
          class: 'sc-btn',
          type: 'button',
          text: '关闭',
          onclick: closePanel,
        }),
        el('button', {
          class: 'sc-btn primary',
          type: 'button',
          text: '重试',
          onclick: () => startRun(retryText, document.title),
        }),
      ]),
    );
  }

  function renderResult(record) {
    const result = record.result;
    const node = ensurePanel();
    const isLocal = result.mode === 'local';
    const body = el('div', { class: 'sc-body' });

    body.append(
      el('div', { class: 'sc-block' }, [
        el('div', { class: 'sc-label', text: '你的真实需求' }),
        el('div', { class: 'sc-goal', text: result.goal }),
      ]),
    );

    const meta = [];
    if (result.deliverable) meta.push(`产出:${result.deliverable}`);
    if (result.audience) meta.push(`给:${result.audience}`);
    if (meta.length) body.append(el('div', { class: 'sc-block sc-meta', text: meta.join(' · ') }));

    if (result.constraints?.length) {
      body.append(
        el('div', { class: 'sc-block sc-meta', text: `已知条件:${result.constraints.join(';')}` }),
      );
    }

    const gapsBlock = renderGapsBlock(result);
    if (gapsBlock) body.append(gapsBlock);

    const output = el('pre', { class: 'sc-output', text: activeView === 'slim' ? result.slim : result.full });
    const tabBar = el('div', { class: 'sc-tabs' });
    const tabButtons = [];
    const setView = (view) => {
      activeView = view;
      output.textContent = view === 'slim' ? result.slim : result.full;
      tabButtons.forEach((button, index) =>
        button.setAttribute('aria-selected', String(['slim', 'full'][index] === view)),
      );
    };
    [
      ['slim', '精简版'],
      ['full', '完整版'],
    ].forEach(([view, label]) => {
      const button = el('button', {
        class: 'sc-tab',
        type: 'button',
        text: label,
        'aria-selected': String(activeView === view),
        onclick: () => setView(view),
      });
      tabButtons.push(button);
      tabBar.append(button);
    });

    body.append(el('div', { class: 'sc-block' }, [el('div', { class: 'sc-label', text: '提示词' }), tabBar, output]));

    if (isLocal) {
      body.append(
        el('div', { class: 'sc-note' }, [
          document.createTextNode('当前是本地规则,效果有限。'),
          el('a', {
            href: '#',
            text: '配置模型 →',
            onclick: (event) => {
              event.preventDefault();
              chrome.runtime.openOptionsPage();
            },
          }),
        ]),
      );
    }

    const copyButton = el('button', { class: 'sc-btn', type: 'button', text: '复制' });
    copyButton.addEventListener('click', async () => {
      const text = activeView === 'slim' ? result.slim : result.full;
      if (await copyText(text)) {
        copyButton.textContent = '已复制';
        setTimeout(() => {
          copyButton.textContent = '复制';
        }, 1400);
      }
    });

    const fillButton = el('button', { class: 'sc-btn primary', type: 'button', text: '填回输入框' });
    fillButton.addEventListener('click', () => {
      const text = activeView === 'slim' ? result.slim : result.full;
      if (replacePending(text) || insertToComposer(text)) {
        fillButton.textContent = '已填入';
        setTimeout(closePanel, 600);
      } else {
        copyText(text);
        fillButton.textContent = '没找到输入框,已复制';
      }
    });

    node.replaceChildren(renderHead(isLocal ? '本地规则' : record.model), body, el('div', { class: 'sc-foot' }, [copyButton, fillButton]));
  }

  /* ---------------- 运行 ---------------- */

  /**
   * 缺口列表,每条都能就地补答。答完带着答案重跑,
   * 那句话就从"要问的"变成"已知的",这是整个工具唯一闭环的环。
   */
  function renderGapsBlock(result) {
    const gaps = result.missing || [];
    if (!gaps.length && !activeAnswers.length) return null;

    const list = el('ul', { class: 'sc-gaps' }, gaps.map((item) => gapItem(item, result)));
    if (activeAnswers.length) {
      list.append(
        el('li', {
          class: 'sc-answered',
          text: `已补答 ${activeAnswers.length} 条,已并入这次生成`,
        }),
      );
    }

    return el('div', { class: 'sc-block' }, [
      el('div', { class: 'sc-label', text: '还缺这几个信息' }),
      list,
    ]);
  }

  function gapItem(item, result) {
    const li = el('li', {}, [
      el('b', { text: item.question }),
      item.why ? el('span', { text: item.why }) : null,
    ]);

    const button = el('button', { class: 'sc-answer', type: 'button', text: '回答' });
    button.addEventListener('click', () => {
      if (li.querySelector('.sc-editor')) return;

      const input = el('input', { type: 'text', placeholder: '一句话就行', spellcheck: 'false' });
      const commit = () => {
        const value = String(input.value || '').trim();
        if (!value) {
          input.focus();
          return;
        }
        activeAnswers = [
          ...activeAnswers.filter((entry) => entry.question !== item.question),
          { question: item.question, answer: value },
        ];
        startRun(result.raw, document.title);
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          // 别让 Esc 冒到 document 把整个面板关掉
          event.preventDefault();
          event.stopPropagation();
          input.parentElement?.remove();
        }
      });

      li.append(
        el('div', { class: 'sc-editor' }, [
          input,
          el('button', { class: 'sc-btn primary sc-go', type: 'button', text: '并入', onclick: commit }),
        ]),
      );
      input.focus();
    });

    li.append(button);
    return li;
  }

  async function startRun(text, context) {
    currentStage = '';
    activeResult = null;
    activeView = 'slim';
    runToken += 1;
    const token = runToken;

    renderLoading();
    if (!isAlive()) {
      renderStale();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RUN',
        id: `content-${token}-${Date.now()}`,
        text,
        context,
        answers: activeAnswers,
      });
      if (token !== runToken) return;
      if (!response?.ok) throw new Error(response?.error || '生成失败');
      activeResult = response.record;
      renderResult(activeResult);
    } catch (error) {
      if (token !== runToken) return;
      if (isContextInvalid(error)) {
        renderStale();
        return;
      }
      renderError(error?.message || String(error), text);
    }
  }

  /* ---------------- 回填 ---------------- */

  function findComposer() {
    if (lastEditable && lastEditable.isConnected) return lastEditable;
    const nodes = Array.from(
      document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'),
    );
    const visible = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 80 && rect.height > 16 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    // 聊天应用的输入框基本都在最下方,取最靠下的那个最稳
    return visible.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] ?? null;
  }

  function setControlValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    // React 这类框架必须走原生 setter,否则它内部的 state 不会更新
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * 原位替换当初选中的那一段,这是"改写"应有的语义。
   * 任何一步对不上(元素被移除、用户中途改了内容)就返回 false,
   * 交给调用方退化成追加,而不是猜着改。
   */
  function replacePending(text) {
    const target = pendingTarget;
    if (!target) return false;

    if (target.kind === 'control') {
      const el = target.el;
      if (!el?.isConnected) return false;
      const value = String(el.value ?? '');
      const start = Math.min(target.start, value.length);
      const end = Math.min(target.end, value.length);
      if (value.slice(start, end) !== target.snapshot) return false;

      setControlValue(el, `${value.slice(0, start)}${text}${value.slice(end)}`);
      const caret = start + text.length;
      if (typeof el.setSelectionRange === 'function') el.setSelectionRange(caret, caret);
      el.focus();
      pendingTarget = null;
      return true;
    }

    if (target.kind === 'editable') {
      const range = target.range;
      if (!range.startContainer?.isConnected) return false;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const ok = document.execCommand('insertText', false, text);
      if (ok) pendingTarget = null;
      return ok;
    }

    return false;
  }

  function insertToComposer(text) {
    const target = findComposer();
    if (!target) return false;
    target.focus();

    if (target.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('insertText', false, text);
    }

    const existing = String(target.value || '').trim();
    setControlValue(target, existing ? `${existing}\n\n${text}` : text);
    return true;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position: fixed; opacity: 0; pointer-events: none;';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  /* ---------------- 事件 ---------------- */

  document.addEventListener(
    'focusin',
    (event) => {
      if (isEditable(event.target)) lastEditable = event.target;
    },
    true,
  );

  document.addEventListener(
    'mouseup',
    (event) => {
      // 点在自己弹出的面板上,不算在选东西
      if (host && event.composedPath().includes(host)) return;
      const point = { x: event.clientX, y: event.clientY };
      // 等浏览器把选区算完再读
      setTimeout(() => onSelectionEnd(point), 0);
    },
    true,
  );
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Shift' || event.key.startsWith('Arrow')) onSelectionEnd(null);
  });

  document.addEventListener(
    'mousedown',
    (event) => {
      if (host && !event.composedPath().includes(host)) hideTrigger();
    },
    true,
  );

  window.addEventListener('scroll', hideTrigger, { passive: true });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideTrigger();
      closePanel();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_SELECTION') {
      sendResponse({
        text: String(window.getSelection() || '').trim().slice(0, 2000),
        title: document.title,
      });
      return false;
    }
    if (message?.type === 'INSERT_TEXT') {
      sendResponse({ ok: insertToComposer(String(message.text ?? '')) });
      return false;
    }
    if (message?.type === 'PROGRESS') {
      currentStage = message.stage;
      const stage = panel?.querySelector?.('.sc-stage');
      if (stage) stage.textContent = STAGE_TEXT[message.stage] || '正在处理…';
    }
    return false;
  });
})();