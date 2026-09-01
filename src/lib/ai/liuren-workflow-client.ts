import type { AiRequestConfig } from './settings';
import { getAiApiEndpoint } from './stream-client';
import {
  LIUREN_WORKFLOW_STEP_IDS,
  LIUREN_WORKFLOW_VERSION,
  buildLiurenWorkflowUserPrompt,
  getLiurenWorkflowStep,
  isLiurenWorkflowStepId,
  type LiurenWorkflowReport,
  type LiurenWorkflowStepId,
} from './liuren-workflow';
import { isAndroidDirectCustomAi, streamAndroidDirectAi } from './android-custom-ai';

export type LiurenWorkflowEvent =
  | { type: 'step_start'; stepId: LiurenWorkflowStepId }
  | { type: 'step_delta'; stepId: LiurenWorkflowStepId; content: string }
  | { type: 'step_complete'; stepId: LiurenWorkflowStepId; content: string }
  | { type: 'workflow_complete' }
  | {
      type: 'workflow_error';
      stepId: LiurenWorkflowStepId;
      code: string;
      message: string;
      retryable: boolean;
    };

export type StreamLiurenWorkflowOptions = {
  context: string;
  completedReports: LiurenWorkflowReport[];
  aiConfig?: AiRequestConfig;
  signal?: AbortSignal;
  onEvent: (event: LiurenWorkflowEvent) => void;
};

export async function streamLiurenWorkflow(options: StreamLiurenWorkflowOptions) {
  if (isAndroidDirectCustomAi(options.aiConfig)) {
    return streamAndroidLiurenWorkflow(options);
  }
  const nextStepId = LIUREN_WORKFLOW_STEP_IDS[options.completedReports.length];
  const response = await fetch(getAiApiEndpoint('/api/v1/ai/liuren-workflow'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: LIUREN_WORKFLOW_VERSION,
      context: options.context,
      completedReports: options.completedReports,
      resumeFrom: nextStepId,
      aiConfig: options.aiConfig,
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await readWorkflowHttpError(response));
  if (!response.body) throw new Error('服务端未返回大六壬工作流数据。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let failed = false;

  const consumeEvent = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    try {
      const event = normalizeWorkflowEvent(JSON.parse(payload));
      if (!event) return;
      completed ||= event.type === 'workflow_complete';
      failed ||= event.type === 'workflow_error';
      options.onEvent(event);
    } catch {
      // 忽略不完整事件。
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    events.forEach(consumeEvent);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (!completed && !failed && !options.signal?.aborted) {
    throw new Error('大六壬工作流响应提前结束，请从当前步骤继续。');
  }
}

async function streamAndroidLiurenWorkflow(options: StreamLiurenWorkflowOptions) {
  const reports = [...options.completedReports];
  for (let index = reports.length; index < LIUREN_WORKFLOW_STEP_IDS.length; index += 1) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const stepId = LIUREN_WORKFLOW_STEP_IDS[index];
    const step = getLiurenWorkflowStep(stepId);
    options.onEvent({ type: 'step_start', stepId });
    let content = '';
    let errorMessage = '';
    await streamAndroidDirectAi(
      [{ role: 'user', content: buildLiurenWorkflowUserPrompt(stepId, options.context, reports) }],
      options.aiConfig!,
      {
        onChunk: (delta) => {
          content += delta;
          options.onEvent({ type: 'step_delta', stepId, content: delta });
        },
        onDone: () => undefined,
        onError: (message) => {
          errorMessage = message;
        },
      },
      options.signal,
      {
        systemPrompt: step.systemPrompt,
        temperature: 0.3,
        maxTokens: step.maxTokens,
      },
    );
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const normalized = content.trim();
    if (errorMessage || !normalized) {
      options.onEvent({
        type: 'workflow_error',
        stepId,
        code: 'ANDROID_AI_WORKFLOW_STEP_FAILED',
        message: errorMessage || '当前节点没有返回内容，请从此步继续。',
        retryable: true,
      });
      return;
    }
    reports.push({ stepId, content: normalized });
    options.onEvent({ type: 'step_complete', stepId, content: normalized });
  }
  options.onEvent({ type: 'workflow_complete' });
}

function normalizeWorkflowEvent(value: unknown): LiurenWorkflowEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type === 'workflow_complete') return { type: 'workflow_complete' };
  if (!isLiurenWorkflowStepId(event.stepId)) return null;
  if (event.type === 'step_start') return { type: 'step_start', stepId: event.stepId };
  if (
    (event.type === 'step_delta' || event.type === 'step_complete') &&
    typeof event.content === 'string'
  ) {
    return { type: event.type, stepId: event.stepId, content: event.content };
  }
  if (
    event.type === 'workflow_error' &&
    typeof event.code === 'string' &&
    typeof event.message === 'string'
  ) {
    return {
      type: 'workflow_error',
      stepId: event.stepId,
      code: event.code,
      message: event.message,
      retryable: event.retryable !== false,
    };
  }
  return null;
}

async function readWorkflowHttpError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: string | { message?: unknown; code?: unknown };
    };
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error.message === 'string') {
      const code = typeof payload.error.code === 'string' ? `（${payload.error.code}）` : '';
      return `${payload.error.message}${code}`;
    }
  } catch {
    // 使用状态码兜底。
  }
  return `大六壬工作流请求失败（${response.status}）。`;
}
