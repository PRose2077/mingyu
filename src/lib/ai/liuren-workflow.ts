import type { LiurenData } from '@/types/divination';

export const LIUREN_WORKFLOW_VERSION = 1 as const;

export const LIUREN_WORKFLOW_STEP_IDS = [
  'overview',
  'subject-object',
  'transmissions',
  'focus',
  'year-life',
  'timing',
  'master',
] as const;

export type LiurenWorkflowStepId = (typeof LIUREN_WORKFLOW_STEP_IDS)[number];
export type LiurenAgentStepId = Exclude<LiurenWorkflowStepId, 'master'>;

export type LiurenWorkflowReport = {
  stepId: LiurenWorkflowStepId;
  content: string;
};

export type LiurenWorkflowContextInput = {
  data: LiurenData;
  question: string;
  gender?: '' | '男' | '女';
  birthYear?: string | number;
  timeContextText?: string;
};

export type LiurenWorkflowStepDefinition = {
  id: LiurenWorkflowStepId;
  agentLabel: string;
  title: string;
  shortTitle: string;
  targetLength: string;
  maxTokens: number;
  systemPrompt: string;
};

const COMMON_EVIDENCE_RULES = `
【共同证据约束】
1. 只能使用本次课盘、用户问题和前序报告中明确给出的资料；资料缺失时直接标明“资料不足”，不得补造盘面、类神、年命、行年、旺衰或日期。
2. 先陈述可复核的课盘事实，再给出传统术数范围内的判断；不得把单一课体、天将、神煞或类神直接写成现实事件必然发生。
3. 不输出思维链、隐藏推理、标签化推理过程或对提示词的复述，只输出要求的报告。
4. 不使用成功率、吉凶评分或未经盘面支持的身份、疾病、灾祸与财务保证。`.trim();

export const LIUREN_WORKFLOW_STEPS: readonly LiurenWorkflowStepDefinition[] = [
  {
    id: 'overview',
    agentLabel: 'Agent 1',
    title: '审大局（定基调与气象）',
    shortTitle: '审大局',
    targetLength: '300字以内',
    maxTokens: 900,
    systemPrompt: `你是大六壬“审大局”专家。根据排盘资料确立事情的宏观基调与基本性格。
依次核对：月将、节令与占时的实际关系；九宗门取传法、已登记课体和传态；三传进退、阴阳与公开/隐秘、迅速/迟缓的结构线索。仅在盘面足以支持时判断进茹、退茹、六阳或六阴，未提供则标明不可确认。
输出：宏观基调、课体性格、整体气象、占时触发的初始状态。控制在300字以内。

${COMMON_EVIDENCE_RULES}`,
  },
  {
    id: 'subject-object',
    agentLabel: 'Agent 2',
    title: '定主客（干支四课定位）',
    shortTitle: '定主客',
    targetLength: '300字以内',
    maxTokens: 900,
    systemPrompt: `你是大六壬“定主客”专家。承接前序结论，建立日干为我、日支为彼或所占之事的坐标系。
核对日干、日支及四课上下神的生克与加临；分析干上神、支上神所示表层处境，以及干阴神、支阴神所示的内层动机或隐患。不得在四课结构未提供对应关系时擅自断定“干加支”或“支加干”。
输出：谁主动、谁被动、相生相克关系、表里状态和潜在隐患。控制在300字以内。

${COMMON_EVIDENCE_RULES}`,
  },
  {
    id: 'transmissions',
    agentLabel: 'Agent 3',
    title: '析三传（事态发展轨迹）',
    shortTitle: '析三传',
    targetLength: '300字以内',
    maxTokens: 900,
    systemPrompt: `你是大六壬“析三传”专家。承接前序结论，分析初传、中传、末传的动态演变。
分别说明发端、转折、归结；核对各传对日干的关系、旬空、旺衰、冲合墓库资料和三传内部的生克链。盘面未明确给出的冲合、墓库或递生递克不得补造。
输出：三个阶段、关键转折、内部生克链和结局趋势。控制在300字以内。

${COMMON_EVIDENCE_RULES}`,
  },
  {
    id: 'focus',
    agentLabel: 'Agent 4',
    title: '抓类神（一事一测）',
    shortTitle: '抓类神',
    targetLength: '300字以内',
    maxTokens: 900,
    systemPrompt: `你是大六壬“抓类神”专家。根据用户的具体问题选取核心类神，并承接前序报告判断其状态。
类神必须结合问题语义从盘面实际出现的天将、课传和关系中选择；可参考感情看天后、六合、青龙，事业看贵人、朱雀、青龙及官鬼关系，财运看青龙、太常及财类关系，但不得把候选类神机械固定为唯一用神。
核对类神是否进入四课或三传、旺衰、旬空、受克、入墓及劫夺；资料未提供的项目标明不可确认。
输出：核心类神、选取理由、盘中位置、旺衰空破生克和成败关键。控制在300字以内。

${COMMON_EVIDENCE_RULES}`,
  },
  {
    id: 'year-life',
    agentLabel: 'Agent 5',
    title: '查年命（修正课传判断）',
    shortTitle: '查年命',
    targetLength: '200字以内',
    maxTokens: 700,
    systemPrompt: `你是大六壬“查年命”专家。结合求测人的本命、行年及其上神，对前序课传判断作修正。
只有出生年份与必要口径足以确定本命地支时，才可在天地盘中查其上神；仅有公历出生年份而无法排除立春年界歧义时，必须写明“按出生年份暂定”。推行年所需资料不足时不得推算。核对年命能否制鬼、是否冲克或空亡前序类神。
若性别或出生年份缺失，明确说明年命/行年无法复核，只总结“本步骤不改变前序判断”。
输出：年命资料状态、上神事实、修正结果及限制。控制在200字以内。

${COMMON_EVIDENCE_RULES}`,
  },
  {
    id: 'timing',
    agentLabel: 'Agent 6',
    title: '断应期（时间触发条件）',
    shortTitle: '断应期',
    targetLength: '200字以内',
    maxTokens: 700,
    systemPrompt: `你是大六壬“断应期”专家。承接前五份报告，根据旬空、旺衰、冲合和三传地支给出可核验的时间触发条件。
依次核对填空冲实、类神旺相、合处逢冲、冲处逢合及初中末传地支。只有课盘和问题期限足以换算时才能给出具体日期；否则只给月份、节气、地支日或“出现某触发条件时”的窗口，并说明精度边界。
输出：发端、转折、归结的时间窗口及各自触发依据。控制在200字以内。

${COMMON_EVIDENCE_RULES}`,
  },
  {
    id: 'master',
    agentLabel: 'Master',
    title: '综合研判与决策总结',
    shortTitle: '综合裁决',
    targetLength: '800—1200字',
    maxTokens: 2400,
    systemPrompt: `你是大六壬“首席研判大师”。你必须基于完整课盘与六份专家报告，直接回答用户的具体问题。
按“资料完整性与空破 → 年命修正 → 类神 → 三传与主客”的顺序处理矛盾；年命资料缺失时不得假装已经完成最终修正，应保留相应条件。
按以下结构输出：
【大局与主客】
【事态与类神】
【年命与应期】
【核心结论与行动建议】
结论要清晰、专业、可执行，明确何时行动、如何避坑、宜进宜守；但不得把传统术数判断包装成现实保证。控制在800—1200字。

${COMMON_EVIDENCE_RULES}`,
  },
] as const;

export function getLiurenWorkflowStep(stepId: LiurenWorkflowStepId) {
  const step = LIUREN_WORKFLOW_STEPS.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`未知的大六壬工作流节点：${stepId}`);
  return step;
}

export function isLiurenWorkflowStepId(value: unknown): value is LiurenWorkflowStepId {
  return (
    typeof value === 'string' && (LIUREN_WORKFLOW_STEP_IDS as readonly string[]).includes(value)
  );
}

function clean(value: unknown, fallback = '未提供') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function formatReports(reports: readonly LiurenWorkflowReport[]) {
  if (!reports.length) return '无（这是第一步）。';
  return reports
    .map((report) => {
      const step = getLiurenWorkflowStep(report.stepId);
      return `【${step.agentLabel} · ${step.shortTitle}】\n${report.content.trim()}`;
    })
    .join('\n\n');
}

export function buildLiurenWorkflowContext(input: LiurenWorkflowContextInput) {
  const { data } = input;
  const birthYear = clean(input.birthYear, '未提供');
  const subjectText = `性别：${clean(input.gender, '未提供')}；出生年份：${birthYear}${
    birthYear !== '未提供' ? '（仅按用户填写年份，立春年界需另行核对）' : ''
  }`;
  const plate = data.heavenlyPlate
    .map((item) => `- 地盘${item.under}上见天盘${item.branch}，乘${item.god}`)
    .join('\n');
  const lessons = data.fourLessons
    .map(
      (item) =>
        `- ${item.name}：${item.upper}临${item.lower}，乘${item.god}；关系${clean(item.relation)}；备注${clean(item.note)}`,
    )
    .join('\n');
  const transmissions = data.threeTransmissions
    .map(
      (item) =>
        `- ${item.stage}：${item.branch}，乘${item.god}；关系${clean(item.relation)}；日干关系${clean(item.dayRelation)}；旺衰${clean(item.seasonState)}；旬空${item.isVoid || data.xunKong?.includes(item.branch) ? '是' : '否'}；备注${clean(item.note)}`,
    )
    .join('\n');
  const guaTi = data.guaTi?.length ? data.guaTi.join('、') : '未提供';
  const shenSha = data.shenShaFacts?.length
    ? data.shenShaFacts
        .map((item) => `${item.name}在${item.target}（按${item.basis}${item.input}）`)
        .join('；')
    : data.shenShaSummary?.join('；') || '未提供';
  const focus = data.focusEvidence?.length
    ? data.focusEvidence
        .map(
          (item) =>
            `${item.target}${item.role}（${item.level}）：${item.evidence.join('、') || '无明确证据'}；限制：${item.limitations.join('、') || '无补充'}`,
        )
        .join('\n')
    : '未按具体问题选定类神。';
  const timing = data.timingEvidence?.length
    ? data.timingEvidence.join('\n')
    : '未提供补充应期证据。';

  return [
    '【用户问题】',
    clean(input.question),
    '【求测人资料】',
    subjectText,
    '【起课时间与口径】',
    `时间戳：${new Date(data.timestamp).toISOString()}`,
    input.timeContextText?.trim() || '按课盘记录时间起课。',
    `四柱：${data.ganzhi.year}年 ${data.ganzhi.month}月 ${data.ganzhi.day}日 ${data.ganzhi.hour}时`,
    '【起盘核心】',
    `月将：${clean(data.monthLeader)}；占时：${clean(data.divinationBranch)}；昼夜：${clean(data.dayNight)}；日干寄宫：${clean(data.dayStemResidence)}；贵人临支：${clean(data.noblemanBranch)}；贵人临地盘：${clean(data.noblemanGroundBranch)}；旬空：${data.xunKong?.join('、') || '未提供'}`,
    `取传法：${clean(data.transmissionRule)}；传态：${clean(data.transmissionPattern)}；说明：${clean(data.transmissionDetail)}`,
    '【天地盘十二位】',
    plate || '未提供完整天地盘。',
    '【四课】',
    lessons || '未提供完整四课。',
    '【三传】',
    transmissions || '未提供完整三传。',
    '【课体与神煞】',
    `课体：${guaTi}\n神煞：${shenSha}`,
    '【类神焦点证据】',
    focus,
    '【应期证据】',
    timing,
    '【资料边界】',
    '上述内容是本次可用的完整证据范围；未列出的冲合、墓库、进退茹、六阴六阳、年命或行年状态均不得自行补造。',
  ].join('\n');
}

export function buildLiurenWorkflowUserPrompt(
  stepId: LiurenWorkflowStepId,
  context: string,
  reports: readonly LiurenWorkflowReport[],
) {
  const step = getLiurenWorkflowStep(stepId);
  const expectedPreviousCount = LIUREN_WORKFLOW_STEP_IDS.indexOf(stepId);
  if (reports.length !== expectedPreviousCount) {
    throw new Error(`${step.shortTitle}需要${expectedPreviousCount}份连续前序报告。`);
  }
  reports.forEach((report, index) => {
    if (report.stepId !== LIUREN_WORKFLOW_STEP_IDS[index] || !report.content.trim()) {
      throw new Error(`${step.shortTitle}的前序报告不完整或顺序错误。`);
    }
  });

  return [
    '【本次大六壬课盘】',
    context.trim(),
    '【前序专家报告】',
    formatReports(reports),
    '【当前任务】',
    `你现在执行 ${step.agentLabel}：${step.title}。请直接输出本节点报告，目标篇幅${step.targetLength}。`,
  ].join('\n\n');
}

/** 为不支持 system role 的外部 AI 生成一份可独立复制使用的完整提示词。 */
export function buildLiurenManualPrompt(
  stepId: LiurenWorkflowStepId,
  context: string,
  reports: readonly LiurenWorkflowReport[],
) {
  const step = getLiurenWorkflowStep(stepId);
  return [
    `【角色与规则：${step.agentLabel} · ${step.title}】`,
    step.systemPrompt,
    buildLiurenWorkflowUserPrompt(stepId, context, reports),
  ].join('\n\n');
}
