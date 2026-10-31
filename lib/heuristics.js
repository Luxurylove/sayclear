/**
 * 没有配置模型时的兜底:纯规则,不联网、不要 key、零延迟。
 *
 * 质量当然不如大模型,但它让这个扩展在「刚装好、还没配 key」的第一分钟
 * 就能给出结果,也让整个仓库可以离线演示。README 里要如实标注它不是 AI。
 */
import { clip, str } from './json.js';

const DELIVERABLES = [
  { test: /表格|excel|csv|清单|台账/i, label: '一份表格', role: '数据整理助手' },
  { test: /代码|脚本|程序|函数|报错|bug|python|javascript/i, label: '可运行的代码', role: '资深软件工程师' },
  { test: /ppt|幻灯片|演示|演讲稿|汇报材料/i, label: '一份演示大纲', role: '演示顾问' },
  { test: /邮件|回复|通知|请假|申请|沟通/i, label: '一段可发送的文字', role: '职场写作顾问' },
  { test: /文案|标题|小红书|公众号|广告|宣传|种草/i, label: '一组文案', role: '文案策划' },
  { test: /周报|日报|总结|复盘|汇报/i, label: '一份总结文档', role: '擅长结构化表达的职场顾问' },
  { test: /海报|图片|封面|插图|logo|头像/i, label: '一张图片(或可直接用于生成的图片描述)', role: '视觉设计师' },
  { test: /翻译|英文|英语|日文|日语/i, label: '一段译文', role: '双语译审' },
  { test: /分析|对比|调研|评估|方案|建议/i, label: '一份分析结论', role: '行业分析师' },
];

const AUDIENCES = [
  { test: /给老板|给领导|汇报给|上级/, label: '老板/上级' },
  { test: /给客户|对方客户|甲方/, label: '客户' },
  { test: /给面试官|面试/, label: '面试官' },
  { test: /给同事|团队内部/, label: '同事' },
  { test: /小白|外行|不懂技术/, label: '非技术读者' },
];

const CN_DIGITS = {
  零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000,
};

const LENGTH_RE =
  /(?:不超过|最多|少于|控制在|限制在|大概)\s*([0-9]+|[零一两二三四五六七八九十百千]+)\s*(?:个)?(字|词|行|页|条)/;
const TONE_RE = /(正式|简洁|简短|口语|轻松|幽默|专业|严肃)/;

function toNumber(token) {
  if (/^[0-9]+$/.test(token)) return Number(token);
  // 只处理"十""二十""一百"这类简单组合,兜底场景够用了。
  let total = 0;
  let section = 0;
  for (const char of token) {
    const value = CN_DIGITS[char];
    if (value === undefined) return NaN;
    if (value >= 10) {
      section = (section || 1) * value;
      total += section;
      section = 0;
    } else {
      section = value;
    }
  }
  return total + section;
}

export function heuristicResult(raw, context = '', answers = []) {
  const text = str(raw);
  const deliverable = DELIVERABLES.find((item) => item.test.test(text)) ?? {
    label: '一段可以直接使用的文字',
    role: '通用助理',
  };

  const audience = AUDIENCES.find((item) => item.test.test(text))?.label ?? null;
  const constraints = [];

  // 用户补答过的信息,直接变成已知条件;对应的问题不再问第二遍
  const answered = new Set(answers.map((item) => str(item?.question)));
  const facts = answers
    .map((item) => ({
      question: str(item?.question).replace(/[?？:：]$/, ''),
      answer: str(item?.answer),
    }))
    .filter((item) => item.question && item.answer);
  for (const fact of facts) constraints.push(`${fact.question}:${fact.answer}`);

  const length = text.match(LENGTH_RE);
  if (length) {
    const value = toNumber(length[1]);
    if (Number.isFinite(value) && value > 0) constraints.push(`长度不超过 ${value} ${length[2]}`);
  }

  const tone = text.match(TONE_RE);
  if (tone) constraints.push(`语气${tone[1]}`);

  if (/中文|用中文/.test(text)) constraints.push('用中文回答');
  if (/英文|用英语/.test(text)) constraints.push('用英文回答');

  const gaps = [];
  if (!audience) {
    gaps.push({
      question: '这份东西给谁看?',
      why: '受众决定详略和语气,不问就只能给一个四平八稳的版本。',
    });
  }
  if (!length) {
    gaps.push({
      question: '大概要多长?几行、几百字,还是一页?',
      why: '不设上限,模型通常会写得很长,反而不好用。',
    });
  }
  gaps.push({
    question: '做到什么程度算完成?',
    why: '没有验收标准,很容易拿到一个"看起来对但没用"的结果。',
  });

  const missing = gaps.filter((item) => !answered.has(item.question)).slice(0, 3);

  const restated = `围绕"${clip(text, 40)}"产出${deliverable.label}`;
  const constraintLine = constraints.length ? `要求:${constraints.join(';')}。` : '';

  const slim =
    `你是${deliverable.role}。任务:${clip(text, 50)}。` +
    `${constraintLine}直接给出${deliverable.label},不要复述需求;信息不足时先提出 3 个关键问题。`;

  const full = [
    '## 角色',
    `你是一名${deliverable.role},擅长把模糊诉求收敛成可直接落地的结果。`,
    '',
    '## 任务',
    clip(text, 240),
    '',
    '## 背景',
    `原始表述:"${clip(text, 200)}"`,
    context ? `当前上下文:${clip(context, 120)}` : '',
    '',
    '## 约束',
    ...constraints.map((item) => `- ${item}`),
    '- 原文没有交代的信息不要编造,先向我确认',
    '',
    '## 输出格式',
    `直接输出${deliverable.label},不要复述我的需求,不要加开场白。`,
    '',
    '## 验收标准',
    '- 结果能直接使用,不需要我再返工一遍',
    '- 缺信息时你主动提问,而不是自己假设',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    goal: `把"${clip(text, 24)}"变成 AI 能直接执行的任务`,
    deliverable: deliverable.label,
    audience,
    constraints,
    missing,
    restated,
    slim,
    full,
  };
}