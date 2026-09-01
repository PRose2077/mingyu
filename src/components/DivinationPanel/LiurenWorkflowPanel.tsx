import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from '@/lib/marked-init';
import { AiChatPanel } from '@/components/AiChatPanel';
import { WorkspaceButton } from '@/components/workspace/WorkspaceUI';
import type { AiRequestConfig } from '@/lib/ai/settings';
import {
  LIUREN_WORKFLOW_STEP_IDS,
  LIUREN_WORKFLOW_STEPS,
  buildLiurenManualPrompt,
  getLiurenWorkflowStep,
  type LiurenWorkflowReport,
  type LiurenWorkflowStepId,
} from '@/lib/ai/liuren-workflow';
import { streamLiurenWorkflow, type LiurenWorkflowEvent } from '@/lib/ai/liuren-workflow-client';
import {
  createLiurenWorkflowSession,
  getLiurenWorkflowStorageKey,
  loadLiurenWorkflowHistory,
  replaceLiurenWorkflowReport,
  saveLiurenWorkflowHistory,
  upsertLiurenWorkflowSession,
  type LiurenWorkflowSession,
} from '@/lib/ai/liuren-workflow-history';
import { usePromptCopyShare } from '@/hooks/usePromptCopyShare';

type LiurenWorkflowPanelProps = {
  workflowContext: string;
  contextPrompt: string;
  aiEnabled: boolean;
  aiConfig?: AiRequestConfig;
};

function renderMarkdown(content: string) {
  try {
    return marked.parse(content) as string;
  } catch {
    return content;
  }
}

function formatSessionLabel(session: LiurenWorkflowSession) {
  const mode = session.mode === 'automatic' ? '自动研判' : '提示词向导';
  const time = new Date(session.updatedAt);
  const label = Number.isNaN(time.getTime())
    ? ''
    : time.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  return `${mode}${label ? ` · ${label}` : ''}`;
}

export function LiurenWorkflowPanel({
  workflowContext,
  contextPrompt,
  aiEnabled,
  aiConfig,
}: LiurenWorkflowPanelProps) {
  const storageKey = useMemo(() => getLiurenWorkflowStorageKey(workflowContext), [workflowContext]);
  const initialHistory = useMemo(() => loadLiurenWorkflowHistory(storageKey), [storageKey]);
  const [sessions, setSessions] = useState(initialHistory.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialHistory.activeSessionId);
  const [streamingStepId, setStreamingStepId] = useState<LiurenWorkflowStepId | ''>('');
  const [streamingContent, setStreamingContent] = useState('');
  const [manualOutput, setManualOutput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingOutput, setEditingOutput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const sessionsRef = useRef(sessions);
  const activeSessionIdRef = useRef(activeSessionId);
  const reportsRef = useRef<LiurenWorkflowReport[]>([]);

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const nextStepId = activeSession
    ? LIUREN_WORKFLOW_STEP_IDS[activeSession.reports.length]
    : undefined;
  const manualPrompt = useMemo(() => {
    if (!activeSession || activeSession.mode !== 'manual' || !nextStepId) return '';
    return buildLiurenManualPrompt(nextStepId, workflowContext, activeSession.reports);
  }, [activeSession, nextStepId, workflowContext]);
  const { copyState, handleCopy } = usePromptCopyShare(manualPrompt);

  const persist = useCallback(
    (nextSessions: LiurenWorkflowSession[], nextActiveId: string) => {
      sessionsRef.current = nextSessions;
      activeSessionIdRef.current = nextActiveId;
      setSessions(nextSessions);
      setActiveSessionId(nextActiveId);
      saveLiurenWorkflowHistory(storageKey, {
        sessions: nextSessions,
        activeSessionId: nextActiveId,
      });
    },
    [storageKey],
  );

  const persistSession = useCallback(
    (session: LiurenWorkflowSession) => {
      persist(upsertLiurenWorkflowSession(sessionsRef.current, session), session.id);
    },
    [persist],
  );

  useEffect(() => {
    abortRef.current?.abort();
    const history = loadLiurenWorkflowHistory(storageKey);
    sessionsRef.current = history.sessions;
    activeSessionIdRef.current = history.activeSessionId;
    setSessions(history.sessions);
    setActiveSessionId(history.activeSessionId);
    setStreamingStepId('');
    setStreamingContent('');
    setManualOutput('');
    setEditingIndex(null);
  }, [storageKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runAutomatic = useCallback(
    async (session: LiurenWorkflowSession) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      reportsRef.current = [...session.reports];
      const runningSession: LiurenWorkflowSession = {
        ...session,
        status: 'running',
        error: undefined,
        currentStepId: LIUREN_WORKFLOW_STEP_IDS[session.reports.length],
        updatedAt: new Date().toISOString(),
      };
      persistSession(runningSession);
      setStreamingStepId('');
      setStreamingContent('');

      const handleEvent = (event: LiurenWorkflowEvent) => {
        if (controller !== abortRef.current) return;
        if (event.type === 'step_start') {
          setStreamingStepId(event.stepId);
          setStreamingContent('');
          return;
        }
        if (event.type === 'step_delta') {
          setStreamingContent((current) => current + event.content);
          return;
        }
        if (event.type === 'step_complete') {
          const reports = [...reportsRef.current, { stepId: event.stepId, content: event.content }];
          reportsRef.current = reports;
          const complete = reports.length === LIUREN_WORKFLOW_STEP_IDS.length;
          persistSession({
            ...runningSession,
            reports,
            status: complete ? 'complete' : 'running',
            currentStepId: LIUREN_WORKFLOW_STEP_IDS[reports.length],
            updatedAt: new Date().toISOString(),
          });
          setStreamingContent('');
          return;
        }
        if (event.type === 'workflow_error') {
          persistSession({
            ...runningSession,
            reports: reportsRef.current,
            status: 'error',
            currentStepId: event.stepId,
            error: event.message,
            updatedAt: new Date().toISOString(),
          });
          setStreamingStepId(event.stepId);
          setStreamingContent('');
          return;
        }
        persistSession({
          ...runningSession,
          reports: reportsRef.current,
          status: 'complete',
          currentStepId: undefined,
          error: undefined,
          updatedAt: new Date().toISOString(),
        });
        setStreamingStepId('');
      };

      try {
        await streamLiurenWorkflow({
          context: workflowContext,
          completedReports: session.reports,
          aiConfig,
          signal: controller.signal,
          onEvent: handleEvent,
        });
      } catch (error) {
        if (controller !== abortRef.current) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const stepId = LIUREN_WORKFLOW_STEP_IDS[reportsRef.current.length] ?? 'master';
        persistSession({
          ...runningSession,
          reports: reportsRef.current,
          status: 'error',
          currentStepId: stepId,
          error: error instanceof Error ? error.message : '工作流执行失败，请从此步继续。',
          updatedAt: new Date().toISOString(),
        });
        setStreamingStepId(stepId);
        setStreamingContent('');
      } finally {
        if (controller === abortRef.current) abortRef.current = null;
      }
    },
    [aiConfig, persistSession, workflowContext],
  );

  function start(mode: 'automatic' | 'manual') {
    const session = createLiurenWorkflowSession(mode);
    persistSession(session);
    setManualOutput('');
    setEditingIndex(null);
    if (mode === 'automatic') void runAutomatic(session);
  }

  function stopAutomatic() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingContent('');
    if (!activeSession) return;
    persistSession({
      ...activeSession,
      reports: reportsRef.current,
      status: 'paused',
      currentStepId: LIUREN_WORKFLOW_STEP_IDS[reportsRef.current.length],
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  function confirmManualOutput() {
    if (!activeSession || activeSession.mode !== 'manual' || !nextStepId) return;
    const content = manualOutput.trim();
    const maxLength = nextStepId === 'master' ? 16_000 : 8_000;
    if (!content || content.length > maxLength) return;
    const reports = [...activeSession.reports, { stepId: nextStepId, content }];
    persistSession({
      ...activeSession,
      reports,
      status: reports.length === LIUREN_WORKFLOW_STEP_IDS.length ? 'complete' : 'manual',
      currentStepId: LIUREN_WORKFLOW_STEP_IDS[reports.length],
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    setManualOutput('');
  }

  function saveEditedReport() {
    if (!activeSession || editingIndex === null) return;
    const content = editingOutput.trim();
    const stepId = LIUREN_WORKFLOW_STEP_IDS[editingIndex];
    const maxLength = stepId === 'master' ? 16_000 : 8_000;
    if (!content || content.length > maxLength) return;
    const reports = replaceLiurenWorkflowReport(activeSession.reports, editingIndex, content);
    persistSession({
      ...activeSession,
      reports,
      status: reports.length === LIUREN_WORKFLOW_STEP_IDS.length ? 'complete' : 'manual',
      currentStepId: LIUREN_WORKFLOW_STEP_IDS[reports.length],
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    setEditingIndex(null);
    setEditingOutput('');
    setManualOutput('');
  }

  const masterReport = activeSession?.reports.find((report) => report.stepId === 'master')?.content;
  const completedCount = activeSession?.reports.length ?? 0;

  return (
    <section className="workspace-ui-surface liuren-workflow-panel">
      <div className="liuren-workflow-head">
        <div>
          <h2>大六壬六步研判</h2>
          <p>六位专家严格串行，最后由 Master 综合裁决；也可只复制提示词到外部 AI。</p>
        </div>
        {activeSession ? (
          <div className="liuren-workflow-new-actions">
            <WorkspaceButton
              size="small"
              variant="primary"
              disabled={!aiEnabled || activeSession.status === 'running'}
              onClick={() => start('automatic')}
            >
              重新自动研判
            </WorkspaceButton>
            <WorkspaceButton
              size="small"
              disabled={activeSession.status === 'running'}
              onClick={() => start('manual')}
            >
              新提示词向导
            </WorkspaceButton>
          </div>
        ) : null}
      </div>

      {sessions.length ? (
        <div className="liuren-workflow-history" aria-label="研判历史">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={session.id === activeSessionId ? 'is-active' : ''}
              disabled={activeSession?.status === 'running'}
              onClick={() => {
                setActiveSessionId(session.id);
                activeSessionIdRef.current = session.id;
                saveLiurenWorkflowHistory(storageKey, {
                  sessions: sessionsRef.current,
                  activeSessionId: session.id,
                });
                setManualOutput('');
                setEditingIndex(null);
              }}
            >
              {formatSessionLabel(session)}
            </button>
          ))}
        </div>
      ) : null}

      {!activeSession ? (
        <div className="liuren-workflow-landing">
          <div className="liuren-workflow-choice">
            <strong>自动 6+1 研判</strong>
            <p>真实调用 7 次模型，按 Agent 1 至 Master 严格推进。内置 AI 会计入 7 次额度。</p>
            <WorkspaceButton
              variant="primary"
              size="large"
              disabled={!aiEnabled}
              onClick={() => start('automatic')}
            >
              {aiEnabled ? '开始六步研判' : '请先启用 AI'}
            </WorkspaceButton>
          </div>
          <div className="liuren-workflow-choice is-manual">
            <strong>仅生成提示词</strong>
            <p>本站不发起 AI 请求。复制当前提示词，粘贴外部回答后解锁下一步。</p>
            <WorkspaceButton
              variant={aiEnabled ? 'secondary' : 'primary'}
              size="large"
              onClick={() => start('manual')}
            >
              进入提示词向导
            </WorkspaceButton>
          </div>
        </div>
      ) : (
        <>
          <div className="liuren-workflow-progress">
            <span>已完成 {completedCount}/7</span>
            <div>
              {activeSession.status === 'running' ? (
                <WorkspaceButton size="small" onClick={stopAutomatic}>
                  停止
                </WorkspaceButton>
              ) : activeSession.mode === 'automatic' && activeSession.status !== 'complete' ? (
                <WorkspaceButton
                  size="small"
                  variant="primary"
                  disabled={!aiEnabled}
                  onClick={() => void runAutomatic(activeSession)}
                >
                  从{getLiurenWorkflowStep(nextStepId ?? 'master').shortTitle}继续
                </WorkspaceButton>
              ) : null}
            </div>
          </div>

          {activeSession.error ? (
            <div className="liuren-workflow-error" role="alert">
              {activeSession.error}
            </div>
          ) : null}

          <div className="liuren-workflow-steps">
            {LIUREN_WORKFLOW_STEPS.map((step, index) => {
              const report = activeSession.reports[index];
              const isStreaming = streamingStepId === step.id && activeSession.status === 'running';
              const isLocked = !report && !isStreaming && nextStepId !== step.id;
              return (
                <details key={step.id} open={step.id === 'master' && Boolean(report)}>
                  <summary>
                    <span>{step.agentLabel}</span>
                    <strong>{step.title}</strong>
                    <em>
                      {report
                        ? '已完成'
                        : isStreaming
                          ? '研判中'
                          : isLocked
                            ? '待前序'
                            : '当前步骤'}
                    </em>
                  </summary>
                  {report ? (
                    <div className="liuren-workflow-report">
                      {activeSession.mode === 'manual' && editingIndex === index ? (
                        <>
                          <textarea
                            value={editingOutput}
                            onChange={(event) => setEditingOutput(event.target.value)}
                            rows={8}
                            aria-label={`修改${step.shortTitle}报告`}
                          />
                          <div className="liuren-workflow-inline-actions">
                            <WorkspaceButton
                              size="small"
                              variant="primary"
                              onClick={saveEditedReport}
                            >
                              保存并清除后续
                            </WorkspaceButton>
                            <WorkspaceButton size="small" onClick={() => setEditingIndex(null)}>
                              取消
                            </WorkspaceButton>
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            className="markdown-body"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
                          />
                          {activeSession.mode === 'manual' ? (
                            <WorkspaceButton
                              size="small"
                              onClick={() => {
                                setEditingIndex(index);
                                setEditingOutput(report.content);
                              }}
                            >
                              修改本步回答
                            </WorkspaceButton>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : isStreaming ? (
                    <div className="liuren-workflow-report is-streaming">
                      {streamingContent ? (
                        <div
                          className="markdown-body"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }}
                        />
                      ) : (
                        <p>AI 正在研判本步骤…</p>
                      )}
                    </div>
                  ) : (
                    <p className="liuren-workflow-step-placeholder">
                      {isLocked ? '完成前序步骤后解锁。' : '本步骤已就绪。'}
                    </p>
                  )}
                </details>
              );
            })}
          </div>

          {activeSession.mode === 'manual' && nextStepId ? (
            <div className="liuren-manual-guide">
              <h3>当前：{getLiurenWorkflowStep(nextStepId).title}</h3>
              <p>复制完整提示词到任意 AI；得到回答后粘贴到下方，确认后生成下一步。</p>
              <textarea className="liuren-manual-prompt" value={manualPrompt} readOnly rows={12} />
              <WorkspaceButton variant="primary" onClick={() => void handleCopy()}>
                {copyState}
              </WorkspaceButton>
              <label htmlFor="liuren-manual-output">
                {nextStepId === 'master'
                  ? '粘贴 Master 最终报告（可选保存）'
                  : '粘贴本步骤的 AI 回答'}
              </label>
              <textarea
                id="liuren-manual-output"
                value={manualOutput}
                onChange={(event) => setManualOutput(event.target.value)}
                rows={8}
                placeholder="将外部 AI 的回答粘贴到这里…"
              />
              <WorkspaceButton onClick={confirmManualOutput} disabled={!manualOutput.trim()}>
                {nextStepId === 'master' ? '保存最终报告' : '确认并进入下一步'}
              </WorkspaceButton>
            </div>
          ) : null}

          {masterReport && aiEnabled ? (
            <div className="liuren-workflow-followup">
              <h3>继续追问</h3>
              <AiChatPanel
                contextPrompt={`${contextPrompt}\n\n【六步研判最终报告】\n${masterReport}`}
                resetKey={`${contextPrompt}\n${activeSession.id}`}
                historyKey={`liuren-workflow-followup:${activeSession.id}`}
                aiConfig={aiConfig}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
