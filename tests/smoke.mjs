import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { clip, extractJson, list, str } from '../lib/json.js';
import { heuristicResult } from '../lib/heuristics.js';
import { run } from '../lib/pipeline.js';
import { fill } from '../lib/prompts.js';
import { isLocalEndpoint, isReady } from '../lib/settings.js';
import { chat } from '../lib/llm.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const passed = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => passed.push(name))
    .catch((error) => {
      console.error(`✗ ${name}`);
      throw error;
    });
}

/* ---------- JSON 解析 ---------- */

await test('extractJson 解析裸 JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

await test('extractJson 剥离代码围栏', () => {
  assert.deepEqual(extractJson('```json\n{"a":"b"}\n```'), { a: 'b' });
});

await test('extractJson 容忍前后废话', () => {
  assert.deepEqual(extractJson('好的,结果如下:{"a":[1,2]} 需要我继续吗?'), { a: [1, 2] });
});

await test('extractJson 对非 JSON 抛错', () => {
  assert.throws(() => extractJson('抱歉,我无法完成'), /JSON/);
});

/* ---------- 小工具 ---------- */

await test('clip 超长才截断', () => {
  assert.equal(clip('abc', 10), 'abc');
  assert.equal(clip('abcdef', 3), 'abc…');
});

await test('list / str 做类型收敛', () => {
  assert.deepEqual(list(['a', '', null, 'b']), ['a', 'b']);
  assert.deepEqual(list('a'), ['a']);
  assert.deepEqual(list(undefined), []);
  assert.equal(str(null, 'x'), 'x');
  assert.equal(str('  hi  '), 'hi');
});

await test('fill 替换占位符,未定义的保留', () => {
  assert.equal(fill('A{{X}}B{{Y}}', { X: '1' }), 'A1B{{Y}}');
});

/* ---------- 本地兜底 ---------- */

await test('heuristicResult 产出完整结构', () => {
  const result = heuristicResult('帮我写个脚本,把每天花的钱整理成表格,不超过 300 字');
  assert.equal(result.deliverable, '一份表格');
  assert.ok(result.constraints.some((item) => item.includes('300')));
  assert.ok(result.slim.length > 0);
  assert.ok(result.full.includes('## 验收标准'));
  // 已经写了长度和格式,缺口应当只剩受众和验收标准这两条
  assert.ok(result.missing.length >= 2 && result.missing.length <= 3);
});

await test('heuristicResult 识别受众', () => {
  const result = heuristicResult('给老板写一段周报,语气正式');
  assert.equal(result.audience, '老板/上级');
  assert.ok(result.constraints.some((item) => item.includes('正式')));
});

/* ---------- 管线 ---------- */

await test('未配置模型时退回本地规则', async () => {
  const result = await run({ text: '帮我写一封请假邮件', settings: {}, chat: () => assert.fail('不该调用模型') });
  assert.equal(result.mode, 'local');
  assert.ok(result.slim.includes('请假') || result.full.includes('请假'));
});

await test('填了地址但没填 key 也算未就绪', async () => {
  const settings = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' };
  assert.equal(isReady(settings), false);
  const result = await run({ text: '帮我写个周报', settings, chat: () => assert.fail('不该调用模型') });
  assert.equal(result.mode, 'local');
});

await test('本地地址不需要 key 就算就绪', () => {
  assert.equal(isReady({ baseUrl: 'http://localhost:11434/v1', model: 'qwen' }), true);
  assert.equal(isReady({ baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen' }), true);
  assert.equal(isReady({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-x' }), true);
  assert.equal(isLocalEndpoint('https://api.openai.com/v1'), false);
});

await test('空输入直接报错', async () => {
  await assert.rejects(() => run({ text: '   ', settings: {} }), /先说点什么/);
});

await test('两段式管线:先解析意图,再组装提示词', async () => {
  const stages = [];
  const calls = [];
  const chat = async ({ messages }) => {
    calls.push(messages[1].content);
    if (calls.length === 1) {
      return '```json\n{"goal":"统计每日开销","deliverable":"一份表格","audience":null,"constraints":["不超过 200 字"],"missing":[{"question":"数据从哪来?","why":"决定方案"}],"restated":"统计每日开销并输出表格"}\n```';
    }
    return '{"slim":"你是数据助手……","full":"## 角色\\n数据助手"}';
  };
  const loadPrompt = async (name, vars) => {
    assert.ok(['intent', 'compose'].includes(name));
    if (name === 'compose') assert.ok(JSON.parse(vars.INTENT).goal, 'compose 应收到上一步的意图');
    return `${name}:${vars.TEXT}`;
  };

  const result = await run({
    text: '我想看看每天花了多少钱',
    settings: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen' },
    loadPrompt,
    chat,
    onStage: (stage) => stages.push(stage),
  });

  assert.equal(result.mode, 'llm');
  assert.equal(result.goal, '统计每日开销');
  assert.equal(result.slim, '你是数据助手……');
  assert.equal(result.full, '## 角色\n数据助手');
  assert.deepEqual(result.missing, [{ question: '数据从哪来?', why: '决定方案' }]);
  assert.deepEqual(stages, ['intent', 'compose']);
  assert.equal(calls.length, 2);
});

/* ---------- 扩展清单 ---------- */

await test('manifest 合法且引用的文件都存在', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background?.service_worker);

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((item) => item.js),
    'popup/popup.js',
    'popup/popup.css',
    'options/options.js',
    'options/options.css',
    'prompts/intent.md',
    'prompts/compose.md',
    'lib/llm.js',
    'lib/pipeline.js',
    'lib/prompts.js',
    'lib/json.js',
    'lib/heuristics.js',
    'lib/settings.js',
  ];

  for (const path of referenced) {
    assert.ok(existsSync(join(ROOT, path)), `缺少文件:${path}`);
  }
});

await test('提示词里的占位符与管线一致', () => {
  const intent = readFileSync(join(ROOT, 'prompts/intent.md'), 'utf8');
  const compose = readFileSync(join(ROOT, 'prompts/compose.md'), 'utf8');
  assert.ok(intent.includes('{{TEXT}}') && intent.includes('{{CONTEXT}}'));
  assert.ok(compose.includes('{{INTENT}}') && compose.includes('{{TEXT}}'));
  assert.ok(intent.includes('{{ANSWERS}}') && compose.includes('{{ANSWERS}}'));
});

/* ---------- 追问闭环 ---------- */

await test('补答的信息成为已知条件,对应的问题不再问', async () => {
  const result = await run({
    text: '帮我写个周报',
    answers: [{ question: '这份东西给谁看?', answer: '老板' }],
    settings: {},
  });
  assert.ok(result.constraints.some((item) => item.includes('老板')));
  assert.ok(!result.missing.some((item) => item.question === '这份东西给谁看?'));
});

await test('补答以问/答对进入两段提示词', async () => {
  const seen = {};
  const chat = async () =>
    JSON.stringify({
      goal: '统计开销',
      deliverable: '表格',
      restated: '统计每日开销',
      constraints: [],
      missing: [],
      slim: 's',
      full: 'f',
    });
  const loadPrompt = async (name, vars) => {
    seen[name] = vars;
    return `${name}:${vars.TEXT}`;
  };

  await run({
    text: '统计开销',
    answers: [{ question: '数据从哪来?', answer: '支付宝账单' }],
    settings: { baseUrl: 'http://localhost:11434/v1', model: 'qwen' },
    loadPrompt,
    chat,
  });

  assert.ok(seen.intent.ANSWERS.includes('支付宝账单'));
  assert.ok(seen.intent.ANSWERS.includes('数据从哪来?'));
  assert.ok(seen.compose.ANSWERS.includes('支付宝账单'));
});

await test('没有补答时占位符填成"暂无补充"', async () => {
  const seen = {};
  await run({
    text: '统计开销',
    settings: { baseUrl: 'http://localhost:11434/v1', model: 'qwen' },
    loadPrompt: async (name, vars) => {
      seen[name] = vars;
      return 'x';
    },
    chat: async () => '{"goal":"a","deliverable":"b","restated":"c","slim":"d","full":"e"}',
  });
  assert.equal(seen.intent.ANSWERS, '(暂无补充)');
});

/* ---------- 中转站兼容 ---------- */

await test('接口不认 response_format 时自动重试一次', async () => {
  const bodies = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const json = (payload, status) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (body.response_format) {
      return json({ error: { message: 'response_format is not supported' } }, 400);
    }
    return json({ choices: [{ message: { content: '{"ok":1}' } }] }, 200);
  };

  try {
    const content = await chat({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(content, '{"ok":1}');
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0].response_format, '第一次应带上 response_format');
    assert.ok(!bodies[1].response_format, '重试时应去掉 response_format');
  } finally {
    globalThis.fetch = original;
  }
});

await test('401 这类错误不重试,直接报出来', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await assert.rejects(
      () =>
        chat({
          baseUrl: 'https://relay.example.com/v1',
          apiKey: 'bad',
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      /401.*invalid api key/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

await test('页面里引用的 id 和文件都存在', () => {
  for (const page of ['popup/popup', 'options/options']) {
    const html = readFileSync(join(ROOT, `${page}.html`), 'utf8');
    const script = readFileSync(join(ROOT, `${page}.js`), 'utf8');

    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    const used = [...script.matchAll(/\$\('#([^']+)'\)/g)].map((match) => match[1]);
    assert.ok(used.length > 3, `${page}.js 里没有找到 DOM 选择器`);
    for (const id of used) assert.ok(ids.has(id), `${page}.html 缺少 #${id}`);

    // <script src> / <link href> 指向的本地文件必须存在
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !path.startsWith('http') && !path.startsWith('#'));
    for (const asset of assets) {
      const target = asset.startsWith('/') ? asset.slice(1) : join(dirname(page), asset);
      assert.ok(existsSync(join(ROOT, target)), `${page}.html 引用了不存在的 ${asset}`);
    }
  }
});

console.log(`\n${passed.length} 项通过`);
for (const name of passed) console.log(`  ✓ ${name}`);