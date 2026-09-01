import { safeStorage } from '@/lib/safe-storage';
import { createSecureId } from '@/lib/secure-id';
import {
  LIUREN_WORKFLOW_STEP_IDS,
  isLiurenWorkflowStepId,
  type LiurenWorkflowReport,
  type LiurenWorkflowStepId,
} from './liuren-workflow';

export type LiurenWorkflowMode = 'automatic' | 'manual';
export type LiurenWorkflowStatus = 'running' | 'paused' | 'error' | 'manual' | 'complete';

export type LiurenWorkflowSession = {
  id: string;
  mode: LiurenWorkflowMode;
  status: LiurenWorkflowStatus;
  reports: LiurenWorkflowReport[];
  currentStepId?: LiurenWorkflowStepId;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type LiurenWorkflowHistory = {
  sessions: LiurenWorkflowSession[];
  activeSessionId: string;
};

const STORAGE_PREFIX = 'mingyu:liuren-workflow-history:v1:';
const MAX_SESSIONS = 12;

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getLiurenWorkflowStorageKey(value: string) {
  const normalized = value.trim();
  return normalized ? `${STORAGE_PREFIX}${hashText(normalized)}:${normalized.length}` : '';
}

function normalizeReports(value: unknown) {
  if (!Array.isArray(value)) return [];
  const reports: LiurenWorkflowReport[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== 'object') break;
    const raw = item as { stepId?: unknown; content?: unknown };
    if (
      !isLiurenWorkflowStepId(raw.stepId) ||
      raw.stepId !== LIUREN_WORKFLOW_STEP_IDS[index] ||
      typeof raw.content !== 'string' ||
      !raw.content.trim()
    ) {
      break;
    }
    reports.push({ stepId: raw.stepId, content: raw.content.trim() });
  }
  return reports;
}

function normalizeSession(value: unknown): LiurenWorkflowSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const mode: LiurenWorkflowMode = raw.mode === 'manual' ? 'manual' : 'automatic';
  const reports = normalizeReports(raw.reports);
  const validStatuses: LiurenWorkflowStatus[] = [
    'running',
    'paused',
    'error',
    'manual',
    'complete',
  ];
  let status = validStatuses.includes(raw.status as LiurenWorkflowStatus)
    ? (raw.status as LiurenWorkflowStatus)
    : mode === 'manual'
      ? 'manual'
      : 'paused';
  // 刷新页面后不会自动恢复网络请求，统一变为可续跑状态。
  if (status === 'running') status = 'paused';
  const expectedStep = LIUREN_WORKFLOW_STEP_IDS[reports.length];
  if (!expectedStep && reports.length === LIUREN_WORKFLOW_STEP_IDS.length) status = 'complete';
  return {
    id: raw.id,
    mode,
    status,
    reports,
    ...(expectedStep ? { currentStepId: expectedStep } : {}),
    ...(typeof raw.error === 'string' && raw.error.trim() ? { error: raw.error.trim() } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export function loadLiurenWorkflowHistory(storageKey: string): LiurenWorkflowHistory {
  const raw = safeStorage.getJSON<unknown>(storageKey, null);
  if (!raw || typeof raw !== 'object') return { sessions: [], activeSessionId: '' };
  const record = raw as Record<string, unknown>;
  const sessions = Array.isArray(record.sessions)
    ? record.sessions
        .map(normalizeSession)
        .filter((session): session is LiurenWorkflowSession => Boolean(session))
        .slice(0, MAX_SESSIONS)
    : [];
  const requestedId = typeof record.activeSessionId === 'string' ? record.activeSessionId : '';
  return {
    sessions,
    activeSessionId: sessions.some((session) => session.id === requestedId)
      ? requestedId
      : (sessions[0]?.id ?? ''),
  };
}

export function saveLiurenWorkflowHistory(storageKey: string, history: LiurenWorkflowHistory) {
  if (!storageKey) return false;
  if (!history.sessions.length) {
    safeStorage.remove(storageKey);
    return true;
  }
  return safeStorage.setJSON(storageKey, {
    version: 1,
    sessions: history.sessions.slice(0, MAX_SESSIONS),
    activeSessionId: history.activeSessionId,
  });
}

export function createLiurenWorkflowSession(mode: LiurenWorkflowMode): LiurenWorkflowSession {
  const now = new Date().toISOString();
  return {
    id: createSecureId(),
    mode,
    status: mode === 'manual' ? 'manual' : 'running',
    reports: [],
    currentStepId: 'overview',
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertLiurenWorkflowSession(
  sessions: LiurenWorkflowSession[],
  next: LiurenWorkflowSession,
) {
  return [next, ...sessions.filter((session) => session.id !== next.id)].slice(0, MAX_SESSIONS);
}

/** 修改任一手动报告时只保留该步及其以前的内容，强制后续重新生成。 */
export function replaceLiurenWorkflowReport(
  reports: LiurenWorkflowReport[],
  index: number,
  content: string,
) {
  const stepId = LIUREN_WORKFLOW_STEP_IDS[index];
  const normalized = content.trim();
  if (!stepId || !normalized || index < 0 || index >= reports.length) {
    throw new Error('要修改的大六壬报告无效。');
  }
  return [...reports.slice(0, index), { stepId, content: normalized }];
}
