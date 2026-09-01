import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateLiuren } from 'mingyu-core/divination/liuren';
import {
  LIUREN_WORKFLOW_STEP_IDS,
  buildLiurenManualPrompt,
  buildLiurenWorkflowContext,
  buildLiurenWorkflowUserPrompt,
  getLiurenWorkflowStep,
  type LiurenWorkflowReport,
} from '../src/lib/ai/liuren-workflow';
import { handleLiurenWorkflow } from '../src/lib/ai/proxy';
import { consumeBuiltinAiRateLimit } from '../src/lib/ai/rate-limit';
import { replaceLiurenWorkflowReport } from '../src/lib/ai/liuren-workflow-history';
import { LiurenWorkflowPanel } from '../src/components/DivinationPanel/LiurenWorkflowPanel';

const fixedDate = new Date('2026-04-10T08:26:00+08:00');

function createContext() {
  return buildLiurenWorkflowContext({
    data: generateLiuren(fixedDate),
    question: '这个工作机会是否值得争取？',
    gender: '男',
    birthYear: '1998',
    timeContextText: '北京时间起课。',
  });
}

test('大六壬工作流应固定为六个专家加 Master，并构建完整证据上下文', () => {
  assert.deepEqual(LIUREN_WORKFLOW_STEP_IDS, [
    'overview',
    'subject-object',
    'transmissions',
    'focus',
    'year-life',
    'timing',
    'master',
  ]);
  const context = createContext();
  assert.match(context, /【天地盘十二位】/);
  assert.equal((context.match(/地盘.+上见天盘/g) ?? []).length, 12);
  assert.match(context, /【四课】/);
  assert.match(context, /【三传】/);
  assert.match(context, /出生年份：1998（仅按用户填写年份，立春年界需另行核对）/);
  assert.match(context, /【类神焦点证据】/);
  assert.match(context, /【应期证据】/);
  assert.doesNotMatch(context, /undefined|null|<thinking>/);
});

test('串行节点提示词必须注入全部连续前序报告', () => {
  const context = createContext();
  const reports: LiurenWorkflowReport[] = [
    { stepId: 'overview', content: '大局报告' },
    { stepId: 'subject-object', content: '主客报告' },
  ];
  const prompt = buildLiurenWorkflowUserPrompt('transmissions', context, reports);
  assert.match(prompt, /Agent 1 · 审大局/);
  assert.match(prompt, /大局报告/);
  assert.match(prompt, /Agent 2 · 定主客/);
  assert.match(prompt, /主客报告/);
  assert.throws(
    () => buildLiurenWorkflowUserPrompt('focus', context, reports),
    /需要3份连续前序报告/,
  );
});

test('手动提示词应是无需 system role 的完整独立文本', () => {
  const prompt = buildLiurenManualPrompt('overview', createContext(), []);
  assert.match(prompt, /【角色与规则：Agent 1 · 审大局/);
  assert.match(prompt, /【本次大六壬课盘】/);
  assert.match(prompt, /【共同证据约束】/);
  assert.match(prompt, /不输出思维链/);
  assert.doesNotMatch(prompt, /<thinking>/);
  assert.match(getLiurenWorkflowStep('year-life').systemPrompt, /无法复核/);
  assert.match(getLiurenWorkflowStep('timing').systemPrompt, /不得伪造|只有课盘和问题期限/);
});

test('修改手动报告应清除所有后续结果', () => {
  const reports: LiurenWorkflowReport[] = [
    { stepId: 'overview', content: '旧大局' },
    { stepId: 'subject-object', content: '旧主客' },
    { stepId: 'transmissions', content: '旧三传' },
  ];
  assert.deepEqual(replaceLiurenWorkflowReport(reports, 1, '新主客'), [
    { stepId: 'overview', content: '旧大局' },
    { stepId: 'subject-object', content: '新主客' },
  ]);
});

test('内置 AI 限流应支持一次预扣七个节点额度', () => {
  const request = new Request('https://example.com/api/v1/ai/liuren-workflow', {
    headers: { 'x-mingyu-client-address': 'liuren-workflow-test-client' },
  });
  const env = { AI_RATE_LIMIT_MAX_REQUESTS: '12', AI_RATE_LIMIT_WINDOW_SECONDS: '600' };
  const first = consumeBuiltinAiRateLimit(request, env, 1_000, 7);
  assert.equal(first?.allowed, true);
  if (first?.allowed) assert.equal(first.remaining, 5);
  const second = consumeBuiltinAiRateLimit(request, env, 1_001, 6);
  assert.equal(second?.allowed, false);
});

test('服务端应严格串行执行七个节点并发送结构化 SSE', async (t) => {
  const originalFetch = globalThis.fetch;
  const upstreamBodies: Array<{
    temperature: number;
    max_tokens: number;
    messages: Array<{ role: string; content: string }>;
  }> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    upstreamBodies.push(body);
    const content = `第${upstreamBodies.length}步报告`;
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }) as typeof fetch;

  const response = await handleLiurenWorkflow(
    new Request('https://example.com/api/v1/ai/liuren-workflow', {
      method: 'POST',
      body: JSON.stringify({
        version: 1,
        context: createContext(),
        completedReports: [],
        resumeFrom: 'overview',
        aiConfig: {
          mode: 'custom',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.com/v1',
          model: 'test-model',
        },
      }),
    }),
  );
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(upstreamBodies.length, 7);
  assert.ok(upstreamBodies.every((body) => body.temperature === 0.3));
  assert.equal(upstreamBodies[0]?.messages[0]?.role, 'system');
  assert.match(upstreamBodies[1]?.messages[1]?.content ?? '', /第1步报告/);
  assert.match(upstreamBodies[6]?.messages[1]?.content ?? '', /第6步报告/);
  assert.match(text, /"type":"step_start","stepId":"overview"/);
  assert.match(text, /"type":"step_complete","stepId":"master"/);
  assert.match(text, /"type":"workflow_complete"/);
});

test('服务端节点失败时应停在该步，不让 Master 基于缺失报告继续', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 3) {
      return new Response(JSON.stringify({ error: { message: '第三步失败' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: `第${calls}步报告` } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200 },
    );
  }) as typeof fetch;

  const response = await handleLiurenWorkflow(
    new Request('https://example.com/api/v1/ai/liuren-workflow', {
      method: 'POST',
      body: JSON.stringify({
        version: 1,
        context: createContext(),
        completedReports: [],
        aiConfig: {
          mode: 'custom',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.com/v1',
          model: 'test-model',
        },
      }),
    }),
  );
  const text = await response.text();
  assert.equal(calls, 3);
  assert.match(text, /"type":"workflow_error","stepId":"transmissions"/);
  assert.doesNotMatch(text, /"stepId":"master"/);
});

test('服务端续跑应从第一份缺失报告开始并保留前序上下文', async (t) => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: `续跑${bodies.length}` } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200 },
    );
  }) as typeof fetch;
  const completedReports: LiurenWorkflowReport[] = [
    { stepId: 'overview', content: '已有大局' },
    { stepId: 'subject-object', content: '已有主客' },
  ];
  const response = await handleLiurenWorkflow(
    new Request('https://example.com/api/v1/ai/liuren-workflow', {
      method: 'POST',
      body: JSON.stringify({
        version: 1,
        context: createContext(),
        completedReports,
        resumeFrom: 'transmissions',
        aiConfig: {
          mode: 'custom',
          apiKey: 'test-key',
          baseUrl: 'https://api.example.com/v1',
          model: 'test-model',
        },
      }),
    }),
  );
  const text = await response.text();
  assert.equal(bodies.length, 5);
  assert.match(bodies[0]?.messages[1]?.content ?? '', /已有大局/);
  assert.match(bodies[0]?.messages[1]?.content ?? '', /已有主客/);
  assert.match(text, /"type":"step_start","stepId":"transmissions"/);
  assert.match(text, /"type":"workflow_complete"/);
});

test('大六壬面板首屏应提供自动研判与零网络提示词入口', () => {
  const html = renderToStaticMarkup(
    createElement(LiurenWorkflowPanel, {
      workflowContext: createContext(),
      contextPrompt: '【排盘信息】\n测试',
      aiEnabled: true,
      aiConfig: { mode: 'builtin' },
    }),
  );
  assert.match(html, /开始六步研判/);
  assert.match(html, /进入提示词向导/);
  assert.match(html, /真实调用 7 次模型/);
});
