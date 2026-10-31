/**
 * 两段式管线。
 *
 *   1) intent  —— 把口语解析成结构化需求(目标 / 产出物 / 约束 / 缺失信息)
 *   2) compose —— 把结构化需求装配成两版提示词(精简 / 完整)
 *
 * 为什么分两次调用,而不是一次让它直接输出提示词:
 * 一次生成时模型会急着写提示词,把"理解"跳过去,追问就没了,而追问是这个
 * 工具和普通润色工具唯一实质的区别。代价是多一次往返。
 *
 * run() 把 loadPrompt 和 chat 作为参数注入,一是方便测试,二是让这个文件
 * 不依赖 chrome.*,可以直接在 node 里跑。
 */
import { extractJson, clip, list, str } from './json.js';
import { heuristicResult } from './heuristics.js';
import { isReady } from './settings.js';

const SYSTEM = {
  role: 'system',
  content: '你是一个只输出 JSON 的接口。不要输出解释、寒暄或 Markdown 代码围栏。',
};

export async function run({ text, context = '', answers = [], settings, loadPrompt, chat, onStage = () => {} }) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('先说点什么,再点生成');

  // 追问闭环:用户补答的内容以"问/答"对进入提示词。
  // 过滤掉空答案,避免把没回的问题也塞进上下文里污染判断。
  const picked = (Array.isArray(answers) ? answers : [])
    .map((item) => ({ question: str(item?.question), answer: str(item?.answer) }))
    .filter((item) => item.question && item.answer);
  const answersBlock = picked.length
    ? picked.map((item) => `- 问:${item.question}\n  答:${item.answer}`).join('\n')
    : '(暂无补充)';

  const configured = isReady(settings);
  if (!configured) {
    onStage('local');
    return { ...heuristicResult(raw, context, picked), raw, mode: 'local' };
  }

  onStage('intent');
  const intentPrompt = await loadPrompt('intent', {
    TEXT: raw,
    CONTEXT: context ? clip(context, 400) : '(无)',
    ANSWERS: answersBlock,
  });
  const intent = normalizeIntent(
    extractJson(await chat({ messages: [SYSTEM, { role: 'user', content: intentPrompt }], json: true })),
    raw,
  );

  onStage('compose');
  const composePrompt = await loadPrompt('compose', {
    INTENT: JSON.stringify(intent, null, 2),
    TEXT: raw,
    ANSWERS: answersBlock,
  });
  const composed = extractJson(
    await chat({ messages: [SYSTEM, { role: 'user', content: composePrompt }], json: true }),
  );

  const slim = str(composed.slim, intent.restated) || intent.restated;
  const full = str(composed.full, '') || slim;

  return { ...intent, slim, full, raw, mode: 'llm' };
}

function normalizeIntent(value, raw) {
  const data = value && typeof value === 'object' ? value : {};
  const restated = str(data.restated, clip(raw, 60));
  const missing = Array.isArray(data.missing)
    ? data.missing
        .map((item) =>
          typeof item === 'string'
            ? { question: str(item), why: '' }
            : { question: str(item?.question), why: str(item?.why) },
        )
        .filter((item) => item.question)
        .slice(0, 3)
    : [];

  return {
    goal: str(data.goal, restated),
    deliverable: str(data.deliverable, '一段可直接使用的提示词'),
    audience: data.audience == null ? null : str(data.audience) || null,
    constraints: list(data.constraints),
    missing,
    restated,
  };
}