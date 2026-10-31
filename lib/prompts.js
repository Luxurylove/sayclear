/**
 * 提示词不硬编码在 JS 里,而是放在 prompts/*.md。
 *
 * 原因很实际:这套提示词就是产品本身,改一句话的效果比改一百行 UI 代码大。
 * 放在 .md 里,它们可读、可以单独拿去用、diff 起来也像人话。
 */

const cache = new Map();

async function readTemplate(name) {
  if (cache.has(name)) return cache.get(name);
  const url = chrome.runtime.getURL(`prompts/${name}.md`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`找不到提示词文件 prompts/${name}.md`);
  const text = await res.text();
  cache.set(name, text);
  return text;
}

/** 把 {{KEY}} 替换成变量值;未定义的占位符原样保留,方便调试。 */
export function fill(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : match,
  );
}

export async function loadPrompt(name, vars) {
  return fill(await readTemplate(name), vars);
}