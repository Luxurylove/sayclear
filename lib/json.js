/**
 * 模型输出解析工具。
 *
 * 即使提示词里写了"只输出 JSON",模型依然会偶尔加代码围栏或一句客套话。
 * 这里做一次宽容解析:先剥围栏,失败再按首尾大括号截取。不追求万能,只追求
 * 常见情况不炸。
 */

export function extractJson(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('模型返回了空内容');

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('模型返回的不是 JSON 对象');
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      throw new Error('模型返回的 JSON 不合法');
    }
  }
}

export function str(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function list(value) {
  if (Array.isArray(value)) return value.map((item) => str(item)).filter(Boolean);
  const single = str(value);
  return single ? [single] : [];
}

/** 按字符截断,给 UI 和兜底文案用,避免把一长段话塞进标题。 */
export function clip(value, max = 40) {
  const text = str(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}