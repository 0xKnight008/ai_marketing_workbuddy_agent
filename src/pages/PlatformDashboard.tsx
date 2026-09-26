import { ReferralLedger } from '../components/ReferralLedger';
import { useWorkspaceLanguage } from '../workspace/useWorkspaceLanguage';
import { sections, type Section } from '../workspace/routes';
import { t } from '../workspace/translate';
import { previewImport } from '../workspace/import-preview';
import { WorkspaceShell, WorkspaceDialog } from '../workspace/Shell';
import { WorkspaceLanguage, WorkspaceLanguageSelect } from '../workspace/i18n';
import { Overview, ApprovalQueue, ReportLibrary } from '../workspace/Overview';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearSessionAccessToken, readSessionAccessToken, storeSessionAccessToken } from '../lib/auth-session';
import { safeNextPath } from '../lib/auth-navigation';
import BillingDashboard from './BillingDashboard';
import { ReportDatasetStats } from '../components/ReportDatasetStats';
import { ReportActionFeedback } from '../components/ReportActionFeedback';
import { WeeklyInsightReview } from '../components/WeeklyInsightReview';
import { WeeklyHistory } from '../components/WeeklyHistory';
import { NotificationCenter } from '../components/NotificationCenter';
import { reportDrafts } from '../../platform/src/contracts/report-drafts';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL?.trim().replace(/\/+$/, '') || (import.meta.env.DEV ? 'http://localhost:4100' : '');

type WizardStep = 'start' | 'configure' | 'accounts' | 'review' | 'saved';
type TemplateId = 'repurpose' | 'weekly_report' | 'comment_lead';
type ModelBand = 'eco' | 'standard' | 'flagship';

interface PipelineTemplate { id: TemplateId; name: string; description: string; steps: string[]; available: boolean; }
interface PipelineDefinition {
  source: { type: 'template'; templateId: TemplateId } | { type: 'description'; description: string };
  brief: string;
  targetAccountIds: string[];
  approvalPolicy: 'required' | 'auto_approve';
  tone: string;
  language: string;
  modelBand?: ModelBand;
  steps: Array<{ type: string }>;
}
interface PipelineView { id: string; name: string; status: 'draft' | 'published' | 'archived'; version: number; updatedAt: string; definition: PipelineDefinition; lastRunStatus?: string; run?: RunView; }
interface ImportBatchView { id: string; label: string; sourceType: 'csv' | 'paste' | 'link' | 'file' | 'discord' | 'google_sheets'; status: 'pending' | 'classifying' | 'classified' | 'failed'; modelBand: ModelBand; itemCount: number; createdAt: string; tagDistribution: Record<string, number>; }
interface ImportItemTagView { tag: string; confidence: number; evidence: string; }
interface ImportItemView { id: string; platform: string; author: string | null; text: string; metrics: Record<string, number>; tags: ImportItemTagView[]; }
interface ImportDetailView { batch: ImportBatchView; items: ImportItemView[]; }
type InsightTemplate = 'content_recap' | 'comment_insights' | 'product_opportunities' | 'review_attribution' | 'community_digest' | 'daily_ops';
interface ReportCitation { ref: string; snippet: string }
interface ReportDeliveryView { status: 'awaiting_approval' | 'approved' | 'delivered' | 'rejected' | 'failed'; channel: 'email' | 'discord'; targetLabel: string; requestedAt: string; deliveredAt?: string; error?: string }
interface InsightReportView { id: string; template: InsightTemplate; title: string; status: 'pending' | 'generating' | 'generated' | 'failed'; modelBand: string; batchIds: string[]; itemCount: number; droppedCitations: number; error: string | null; createdAt: string; generatedAt: string | null; report: Record<string, unknown> | null; delivery: ReportDeliveryView | null; }
interface TopicRunView { id: string; status: 'pending' | 'proposing' | 'assigning' | 'completed' | 'failed'; modelBand: string; itemCount: number; topicCount: number; error: string | null; createdAt: string; completedAt: string | null; }
interface TopicView { id: string; runId: string; key: string; label: string; description: string; itemCount: number; }
interface TopicListView { run: TopicRunView | null; topics: TopicView[]; }
interface TopicItemView { itemId: string; platform: string; author: string | null; text: string; evidence: string; confidence: number; createdAt: string; }
interface TopicItemListView { topic: TopicView; total: number; items: TopicItemView[]; }

const INSIGHT_TEMPLATES: { id: InsightTemplate; name: string; tagline: string }[] = [
  { id: 'content_recap', name: 'Content recap', tagline: 'What went viral, why, and what to post next' },
  { id: 'comment_insights', name: 'Comment insights', tagline: 'What your fans actually want, from their own words' },
  { id: 'product_opportunities', name: 'Product opportunities', tagline: 'Merch your audience is already asking for' },
  { id: 'review_attribution', name: 'Review attribution', tagline: 'Why negative reviews happen and what to fix first' },
  { id: 'community_digest', name: 'Community digest', tagline: 'Hot topics, open questions, and members worth recognizing' },
  { id: 'daily_ops', name: 'Daily ops tasks', tagline: "Today's 3-5 most important tasks, decided from your insights" },
];
interface ConnectedAccount { id: string; externalAccountId: string; displayName: string; platform: string; capabilities: string[]; status: 'connected' | 'expired' | 'disconnected' | 'syncing'; lastSyncedAt?: string; }
interface PipelineCheck { id: string; label: string; passed: boolean; detail: string; }
interface PipelineReadiness { ready: boolean; checks: PipelineCheck[]; }
interface RunView { id: string; status: string; workflowId: string; createdAt: string; }
interface ApprovalView { id: string; runId: string | null; requestedAction: { summary?: string; parameters?: { content?: string; subject?: string } }; requestedAt: string; }
interface TaskEventView { id: string; runId: string | null; actionType: string; billableUnits: string; aiCredits: string; status: string; createdAt: string; }
interface AuditEventView { id: string; runId?: string; eventType: string; createdAt: string; }
interface UsageView { status: string; taskUsed: number; taskQuota: number; aiCreditsUsed: number; aiCreditsAvailable: number; subscriptionStatus: string; plan: string; }
interface MeView {
  user: { email: string; displayName: string; passwordSet: boolean };
  workspace: { id: string; name: string };
  role: string;
  plan: string;
  subscriptionStatus: string;
}
interface SessionResponse { accessToken?: string; expiresAt?: string; }

interface PipelineDraft {
  sourceType: 'template' | 'description';
  templateId: TemplateId;
  description: string;
  name: string;
  brief: string;
  targetAccountIds: string[];
  approvalPolicy: 'required' | 'auto_approve';
  tone: string;
  language: string;
  modelBand: ModelBand;
}

const fallbackTemplates: PipelineTemplate[] = [
  { id: 'repurpose', name: 'Repurpose and publish', description: 'Turn one brief into channel-ready posts with approval before publishing.', steps: ['Brief', 'AI drafts', 'Review', 'Publish'], available: true },
  { id: 'weekly_report', name: 'Weekly growth report', description: 'Collect performance and prepare an approval-ready weekly summary.', steps: ['Weekly trigger', 'Pull analytics', 'AI summary', 'Review'], available: false },
  { id: 'comment_lead', name: 'Comment-to-lead review', description: 'Classify high-intent comments and hand qualified leads to your team.', steps: ['Watch comments', 'AI classify', 'Review', 'Hand off'], available: false },
];

const ACTIVE_SUBSCRIPTIONS = new Set(['active', 'trialing', 'manual']);

const socialPlatforms = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
  ['pinterest', 'Pinterest'], ['googlebusiness', 'Google Business'],
  ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['twitter', 'X / Twitter'],
  ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['reddit', 'Reddit'],
  ['discord', 'Discord'], ['slack', 'Slack'], ['telegram', 'Telegram'],
] as const;

function freshDraft(): PipelineDraft {
  return { sourceType: 'template', templateId: 'repurpose', description: '', name: '', brief: '', targetAccountIds: [], approvalPolicy: 'required', tone: 'clear, helpful', language: 'en', modelBand: 'eco' };
}

const MODEL_BAND_OPTIONS: { value: ModelBand; label: string; hint: string }[] = [
  { value: 'eco', label: 'Eco', hint: '1 credit/run · fastest, cheapest' },
  { value: 'standard', label: 'Standard', hint: '6 credits/run · balanced quality' },
  { value: 'flagship', label: 'Flagship', hint: '20 credits/run · strongest model' },
];

function ModelBandPicker({ value, onChange }: { value: ModelBand; onChange: (band: ModelBand) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {MODEL_BAND_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          title={t(option.hint)}
          className={`rounded-lg border px-3 py-2 text-left transition ${value === option.value ? "border-sky-deep bg-sky-pale" : "border-ink/20 bg-paper-card hover:bg-sky-pale/60"}`}
        >
          <span className={`block text-sm font-semibold ${value === option.value ? 'text-sky-deep' : ''}`}>{t(option.label)}</span>
          <span className="mt-0.5 block text-[11px] leading-tight text-ink-soft">{t(option.hint)}</span>
        </button>
      ))}
    </div>
  );
}

const TAG_LABELS: Record<string, string> = {
  purchase_intent: 'Purchase intent',
  product_demand: 'Product demand',
  complaint: 'Complaint',
  suggestion: 'Suggestion',
  content_idea: 'Content idea',
  urging_update: 'Urging update',
  co_creation: 'Co-creation',
  koc_kol_lead: 'KOC/KOL lead',
  meme_material: 'Meme material',
  risk_event: 'Risk event',
  needs_reply: 'Needs reply',
};

export default function PlatformDashboard() { return <WorkspaceLanguage><PlatformWorkspace /></WorkspaceLanguage>; }
function PlatformWorkspace() {
  const { w } = useWorkspaceLanguage();
  const [token, setToken] = useState(readSessionAccessToken);
  const [me, setMe] = useState<MeView | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [section, updateSection] = useState<Section>(() => { if (new URLSearchParams(location.search).has('topup_session')) return 'billing'; const route = location.hash.slice(1).split('/')[0] as Section; return sections.includes(route) ? route : 'dashboard'; });
  const setSection = (next: Section) => { setInsightDetail(null); updateSection(next); history.pushState(null, '', `#${next}`); };
  useEffect(() => { const restore = () => { const route = location.hash.slice(1).split('/')[0] as Section; updateSection(sections.includes(route) ? route : 'dashboard'); }; window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, []);
  const [templates, setTemplates] = useState<PipelineTemplate[]>(fallbackTemplates);
  const [pipelines, setPipelines] = useState<PipelineView[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [wizardStep, setWizardStep] = useState<WizardStep | null>(null);
  const [draft, setDraft] = useState<PipelineDraft>(freshDraft);
  const [savedPipeline, setSavedPipeline] = useState<PipelineView | null>(null);
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null);
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEventView[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [message, setMessage] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState('');
  const [telegram, setTelegram] = useState<{ code: string; expiresAt: string; instructions: string[] } | null>(null);
  useEffect(() => { setTelegram(null); }, [token]);
  const [feedbackCategory, setFeedbackCategory] = useState('other');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [referralUrl, setReferralUrl] = useState('');
  const [referralStatus, setReferralStatus] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [recoveringCheckout, setRecoveringCheckout] = useState(false);
  const [importBatches, setImportBatches] = useState<ImportBatchView[]>([]);
  const [importLabel, setImportLabel] = useState('');
  const [importBand, setImportBand] = useState<ModelBand>('eco');
  const [importContent, setImportContent] = useState('');
  const [importDetail, setImportDetail] = useState<ImportDetailView | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [googleConnection, setGoogleConnection] = useState<{ connected: boolean; email?: string; connectedAt?: string } | null>(null);
  const [googleSheetId, setGoogleSheetId] = useState('');
  const [googleSheetName, setGoogleSheetName] = useState('');
  const [insights, setInsights] = useState<InsightReportView[]>([]);
  const [insightTemplate, setInsightTemplate] = useState<InsightTemplate>('content_recap');
  const [insightBand, setInsightBand] = useState<ModelBand>('standard');
  const [outputLanguage, setOutputLanguage] = useState<'en'|'es'|'zh'>('en');
  const [insightBatchIds, setInsightBatchIds] = useState<string[]>([]);
  const [insightDetail, setInsightDetail] = useState<InsightReportView | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [topicData, setTopicData] = useState<TopicListView>({ run: null, topics: [] });
  const [topicBand, setTopicBand] = useState<ModelBand>('eco');
  const [topicDetail, setTopicDetail] = useState<TopicItemListView | null>(null);
  const [topicBusy, setTopicBusy] = useState(false);
  const applyBillingUsage = useCallback((next: UsageView) => {
    setUsage(next);
    setMe((current) => current ? { ...current, plan: next.plan, subscriptionStatus: next.subscriptionStatus } : current);
  }, []);

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === draft.templateId), [draft.templateId, templates]);
  const healthyAccounts = accounts.filter((account) => account.status === 'connected');

  const signOut = useCallback(() => {
    clearSessionAccessToken();
    setToken('');
    setMe(null);
    setSessionError('');
    setPipelines([]); setAccounts([]); setApprovals([]); setTaskEvents([]); setAuditEvents([]); setUsage(null);
    setSavedPipeline(null); setWizardStep(null); setRun(null); setReferralUrl('');
    setWorkspaceError(''); setMessage(''); setInsights([]); setInsightDetail(null); setImportBatches([]); setImportDetail(null); setImportContent(''); setImportLabel(''); setTopicData({run:null,topics:[]}); setTopicDetail(null);
  }, []);

  const loadMe = useCallback(async (currentToken: string) => {
    setSessionError('');
    try {
      const response = await fetch(`${gatewayUrl}/api/auth/me`, { headers: { authorization: `Bearer ${currentToken}` } });
      const currentSession = readSessionAccessToken();
      if (currentSession !== currentToken) { if (!currentSession) signOut(); return false; }
      if (response.status === 401 || response.status === 403) { signOut(); return false; }
      if (!response.ok) throw new Error('Session check failed');
      setMe(await response.json() as MeView);
      return true;
    } catch {
      setMe(null);
      setSessionError('Your session could not be verified. Please retry or sign in again.');
      return false;
    }
  }, [signOut]);

  const headers = useCallback((json = false): HeadersInit => {
    return { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}) };
  }, [token]);

  const loadWorkspace = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const requests = await Promise.all([
      fetch(`${gatewayUrl}/api/pipeline-templates`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/pipelines`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/zernio/accounts`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/approval-requests`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/billing/usage`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/billing/task-events`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/audit-events`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/imports`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/imports/google/connection`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/insights`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/topics`, { headers: headers() }),
    ]);
      if (requests.some(response => response.status === 401)) { signOut(); return; }
      if (readSessionAccessToken() !== token) return;
      const [templatesResponse, pipelinesResponse, accountsResponse, approvalsResponse, usageResponse, tasksResponse, auditResponse, importsResponse, googleConnectionResponse, insightsResponse, topicsResponse] = requests;
      if (templatesResponse.ok) setTemplates(await templatesResponse.json() as PipelineTemplate[]);
      if (pipelinesResponse.ok) setPipelines(await pipelinesResponse.json() as PipelineView[]);
      if (accountsResponse.ok) setAccounts(await accountsResponse.json() as ConnectedAccount[]);
      if (approvalsResponse.ok) setApprovals(await approvalsResponse.json() as ApprovalView[]);
      if (usageResponse.ok) {
        const latest = await usageResponse.json() as UsageView;
        setUsage(latest);
        setMe((previous) => previous ? { ...previous, subscriptionStatus: latest.subscriptionStatus, plan: latest.plan } : previous);
      }
      if (tasksResponse.ok) setTaskEvents(await tasksResponse.json() as TaskEventView[]);
      if (auditResponse.ok) setAuditEvents(await auditResponse.json() as AuditEventView[]);
      if (importsResponse.ok) setImportBatches(await importsResponse.json() as ImportBatchView[]);
      if (googleConnectionResponse.ok) setGoogleConnection(await googleConnectionResponse.json() as { connected: boolean; email?: string; connectedAt?: string });
      if (insightsResponse.ok) setInsights(await insightsResponse.json() as InsightReportView[]);
      if (topicsResponse.ok) {
        // 防御性解析：非预期负载（如旧代理/兜底桩返回数组）不得破坏渲染。
        const data = await topicsResponse.json() as TopicListView;
        if (data && Array.isArray(data.topics)) setTopicData({ run: data.run ?? null, topics: data.topics });
      }
      setWorkspaceError(requests.some((response) => !response.ok) ? 'Some workspace data could not be loaded. Refresh to retry; missing results may be incomplete.' : '');
    } catch {
      setWorkspaceError('Piggybot could not reach the workspace service. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [headers, token, signOut]);

  const refreshAccounts = useCallback(async (sync = false) => {
    if (!token) return;
    if (sync) await fetch(`${gatewayUrl}/api/zernio/sync`, { method: 'POST', headers: headers() });
    const response = await fetch(`${gatewayUrl}/api/zernio/accounts`, { headers: headers() });
    if (response.ok) setAccounts(await response.json() as ConnectedAccount[]);
  }, [headers, token]);

  useEffect(() => {
    if (!token) return;
    const timeout = window.setTimeout(() => {
      void loadMe(token).then((valid) => { if (valid) void loadWorkspace(); });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadMe, loadWorkspace, token]);

  useEffect(() => {
    if (!token) return;
    const refresh = () => { void loadMe(token).then((valid) => { if (valid) void loadWorkspace(); }); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [loadMe, loadWorkspace, token]);

  useEffect(() => {
    if (!token || !me) return;
    const next = safeNextPath(window.location.search, window.location.origin);
    if (next) window.location.replace(next);
  }, [token, me]);

  useEffect(() => {
    const gatewayOrigin = new URL(gatewayUrl, window.location.origin).origin;
    const listener = (event: MessageEvent) => {
      if (event.origin !== gatewayOrigin) return;
      const type = (event.data as { type?: string } | null)?.type;
      if (type === 'piggybot:zernio-connected') {
        setMessage('Account connected. Refreshing your destinations…');
        void refreshAccounts(true);
      }
      if (type === 'piggybot:google-sheets-connected') {
        setMessage('Google account connected — paste a spreadsheet link below to import its rows.');
        void loadWorkspace();
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [refreshAccounts, loadWorkspace]);

  async function connectSocial(platform: typeof socialPlatforms[number][0]) {
    // Reserve the popup while the click still has browser user activation.
    const popup = platform === 'telegram' ? null : window.open('about:blank', 'piggybot-zernio-connect', 'popup,width=720,height=820');
    if (platform !== 'telegram' && !popup) { setMessage('Allow pop-ups for Piggybot, then click Connect again.'); return; }
    setMessage(''); setConnecting(platform); setTelegram(null);
    try {
      const response = await fetch(`${gatewayUrl}/api/zernio/connect?platform=${encodeURIComponent(platform)}`, { headers: headers(), cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string; telegram?: typeof telegram };
      if (!response.ok) throw new Error(result.error === 'zernio_x_billing_required'
        ? 'X connection requires a payment method on the platform’s Zernio account. Contact Piggybot support; buying AI credits will not resolve this.'
        : result.error === 'zernio_billing_required' ? 'The platform’s Zernio account has a billing or capacity restriction. Contact support.'
        : 'The connection could not be started. Check your session and connector configuration, then retry.');
      if (result.telegram) { setTelegram(result.telegram); return; }
      if (!result.url || new URL(result.url).protocol !== 'https:') throw new Error('Invalid connector redirect. Contact support.');
      if (popup?.closed) throw new Error('The connection window was closed. Click Connect to try again.');
      if (popup) popup.location.replace(result.url);
    } catch (error) { popup?.close(); setMessage(error instanceof Error ? error.message : 'Connection failed. Please retry.'); }
    finally { setConnecting(''); }
  }

  function startTemplate(template: PipelineTemplate) {
    setDraft({ ...freshDraft(), sourceType: 'template', templateId: template.id, name: template.name, brief: template.description });
    setSavedPipeline(null); setReadiness(null); setWizardStep('configure');
  }

  function startDescription() {
    setDraft({ ...freshDraft(), sourceType: 'description' });
    setSavedPipeline(null); setReadiness(null); setWizardStep('configure');
  }

  function continuePipeline(pipeline: PipelineView) {
    const source = pipeline.definition.source;
    setDraft({
      sourceType: source.type,
      templateId: source.type === 'template' ? source.templateId : 'repurpose',
      description: source.type === 'description' ? source.description : '',
      name: pipeline.name,
      brief: pipeline.definition.brief,
      targetAccountIds: pipeline.definition.targetAccountIds,
      approvalPolicy: pipeline.definition.approvalPolicy,
      tone: pipeline.definition.tone,
      language: pipeline.definition.language,
      modelBand: pipeline.definition.modelBand ?? 'eco',
    });
    setSavedPipeline(pipeline); setReadiness(null); setWizardStep('configure');
  }

  function toggleAccount(accountId: string) {
    setDraft((current) => ({ ...current, targetAccountIds: current.targetAccountIds.includes(accountId) ? current.targetAccountIds.filter((id) => id !== accountId) : [...current.targetAccountIds, accountId] }));
  }

  async function saveDraft() {
    setMessage(''); setLoading(true);
    const payload = {
      name: draft.name,
      source: draft.sourceType === 'template' ? { type: 'template', templateId: draft.templateId } : { type: 'description', description: draft.description || draft.brief },
      configuration: { brief: draft.brief, targetAccountIds: draft.targetAccountIds, approvalPolicy: draft.approvalPolicy, tone: draft.tone, language: draft.language, modelBand: draft.modelBand },
    };
    const editing = Boolean(savedPipeline?.status === 'draft');
    const response = await fetch(editing ? `${gatewayUrl}/api/pipelines/${savedPipeline!.id}` : `${gatewayUrl}/api/pipelines`, {
      method: editing ? 'PATCH' : 'POST', headers: headers(true), body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({})) as PipelineView & { error?: string };
    setLoading(false);
    if (!response.ok || !result.id) { setMessage(result.error ?? 'The pipeline draft could not be saved.'); return; }
    setSavedPipeline(result); setReadiness(null); setWizardStep('saved');
    await loadWorkspace();
  }

  async function testSetup() {
    if (!savedPipeline) return;
    setLoading(true);
    const response = await fetch(`${gatewayUrl}/api/pipelines/${savedPipeline.id}/test`, { method: 'POST', headers: headers() });
    const result = await response.json().catch(() => null) as PipelineReadiness | null;
    setLoading(false);
    if (!response.ok || !result) { setMessage('The readiness check could not be completed.'); return; }
    setReadiness(result);
  }

  async function activateSavedPipeline() {
    if (!savedPipeline || !readiness?.ready || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`${gatewayUrl}/api/pipelines/${savedPipeline.id}/activate`, { method: 'POST', headers: headers() });
      const result = await response.json().catch(() => ({})) as PipelineView;
      if (!response.ok || !result.id || !result.run) { setMessage('The pipeline could not be started. Check billing and run the readiness check again.'); return; }
      setSavedPipeline(result); setRunId(result.run.id); setRun(result.run);
      setMessage(`${result.name}: run ${result.run.id} is ${result.run.status}. Publishing requires approval.`);
      setWizardStep(null); setSection('activity'); await loadWorkspace();
    } catch {
      setMessage('The start request could not be confirmed. Retry safely: this pipeline version will not create a duplicate run.');
    } finally { setLoading(false); }
  }

  async function loadRun() {
    const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: headers() });
    if (!response.ok) { setRun(null); setMessage('Run not found or access is denied.'); return; }
    setRun(await response.json() as RunView);
  }

  async function decideApproval(approvalId: string, decision: 'approved' | 'rejected'): Promise<boolean> {
    try {
      const response = await fetch(`${gatewayUrl}/api/approval-requests/${encodeURIComponent(approvalId)}/${decision}`, { method: 'POST', headers: headers(true), body: '{}' });
      if (!response.ok) { setMessage(w('The decision could not be saved. Refresh and retry.', 'No se pudo guardar la decisión. Actualiza y reintenta.', '决定未能保存，请刷新后重试。')); return false; }
      setApprovals(current => current.filter(item => item.id !== approvalId));
      setMessage(w('Decision saved.', 'Decisión guardada.', '决定已保存。'));
      await loadWorkspace(); return true;
    } catch { setMessage(w('Connection failed. Your decision has not been confirmed.', 'Error de conexión. Tu decisión no se ha confirmado.', '连接失败，尚未确认决定是否保存。')); return false; }
  }

  async function sendFeedback() {
    setFeedbackStatus('');
    const response = await fetch(`${gatewayUrl}/api/feedback`, { method: 'POST', headers: headers(true), body: JSON.stringify({ category: feedbackCategory, message: feedbackMessage, locale: document.documentElement.lang.slice(0, 2), pageUrl: window.location.href }) });
    const result = await response.json().catch(() => ({})) as { ticketId?: string };
    if (!response.ok || !result.ticketId) { setFeedbackStatus('Your message could not be sent. Confirm that your workspace session is active.'); return; }
    setFeedbackMessage(''); setFeedbackStatus(`Thanks — ticket ${result.ticketId} was sent to support.`);
  }

  async function createReferralLink() {
    const response = await fetch(`${gatewayUrl}/api/referral/link`, { method: 'POST', headers: headers() });
    const result = await response.json().catch(() => ({})) as { url?: string };
    if (!response.ok || !result.url) { setReferralStatus('A workspace owner or admin session is required.'); return; }
    setReferralUrl(result.url); setReferralStatus('Share this link and earn 20% credit on eligible first-year payments.');
  }

  async function savePassword() {
    setPasswordStatus('');
    const response = await fetch(`${gatewayUrl}/api/auth/password`, {
      method: 'POST', headers: headers(true), body: JSON.stringify({ password: newPassword }),
    });
    if (!response.ok) { setPasswordStatus('The password could not be saved. Use 8-128 characters.'); return; }
    setNewPassword('');
    setPasswordStatus('Password saved — you can now sign in with your email.');
    await loadMe(token);
  }

  async function createImport(sourceType: 'paste' | 'csv' | 'discord', content: string, label = importLabel) {
    if (new TextEncoder().encode(content).byteLength > 2 * 1024 * 1024) { setMessage('Import content exceeds 2 MiB. Split it into smaller batches.'); return; }
    setMessage('');
    // 后端 label 必填：粘贴导入没有文件名兜底，空标题直接在本地拦下并提示。
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setMessage('Give this import a title first — it is how you will recognize the batch later.'); return; }
    setImportBusy(true);
    try {
      const response = await fetch(`${gatewayUrl}/api/imports`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ label: trimmedLabel, sourceType, ...(sourceType === 'discord' ? { channelId: content.trim() } : { content }), modelBand: importBand }),
      });
      const result = await response.json().catch(() => ({})) as { id?: string; status?: string; error?: string; message?: string };
      if (response.status === 402 || result.error === 'subscription_required') {
        setMessage(result.error === 'ai_credits_exhausted'
          ? 'AI credits are exhausted for this period — top up or wait for the next billing cycle.'
          : 'Imports require an active subscription. Pick a plan to unlock AI classification.');
        return;
      }
      // 服务端 HttpError 的 message 带可操作细节（如超限条目序号），优先展示。
      if (!response.ok || !result.id) {
        const discordErrors: Record<string, string> = {
          discord_import_not_configured: 'Ask your administrator to configure the Discord import bot and workspace channel allowlist.',
          discord_import_configuration_invalid: 'The Discord import configuration is invalid. Contact your administrator.',
          discord_import_channel_not_allowed: 'This Discord channel is not authorized for your workspace. Contact your administrator.',
          discord_import_check_bot_channel_permissions: 'Ask your administrator to check the Discord bot token, View Channel and Read Message History permissions.',
          discord_import_no_text_check_message_content_intent: 'No readable human text was found. Check Message Content intent and channel history permissions, or try a channel with recent text.',
          discord_import_no_new_messages: 'No new Discord messages in the latest 500-message window. Existing imports will not be billed again.',
          discord_import_rate_limited_retry_later: 'Discord is rate limiting imports. Wait before trying again.',
          discord_import_message_exceeds_2000_characters: 'A Discord message exceeds the 2,000-character import limit. Nothing was imported; use a curated CSV export instead.',
          discord_import_provider_unavailable: 'Discord could not be reached. Nothing was imported; retry later.',
        };
        setMessage(discordErrors[result.error ?? ''] ?? result.message ?? result.error ?? 'The import could not be created.'); return;
      }
      setImportContent(''); setImportLabel('');
      setMessage(`Import queued (${result.status ?? 'pending'}) — classification is running in the background.`);
      await loadWorkspace();
    } catch {
      setMessage('The import could not reach the workspace service. Please retry.');
    } finally {
      setImportBusy(false);
    }
  }

  async function connectGoogleSheets() {
    // Reserve the popup while the click still has browser user activation.
    const popup = window.open('about:blank', 'piggybot-google-connect', 'popup,width=720,height=820');
    if (!popup) { setMessage('Allow pop-ups for Piggybot, then click Connect again.'); return; }
    setMessage('');
    try {
      const response = await fetch(`${gatewayUrl}/api/imports/google/connect`, { headers: headers(), cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        throw new Error(result.error === 'google_sheets_not_configured' || result.error === 'google_sheets_encryption_not_configured'
          ? 'Google Sheets import is not configured on this deployment. Contact your administrator.'
          : 'The connection could not be started. Check your session, then retry.');
      }
      if (new URL(result.url).protocol !== 'https:') throw new Error('Invalid connector redirect. Contact support.');
      if (popup.closed) throw new Error('The connection window was closed. Click Connect to try again.');
      popup.location.replace(result.url);
    } catch (error) {
      popup.close();
      setMessage(error instanceof Error ? error.message : 'Connection failed. Please retry.');
    }
  }

  async function disconnectGoogleSheets() {
    const response = await fetch(`${gatewayUrl}/api/imports/google/disconnect`, { method: 'POST', headers: headers() });
    if (!response.ok) { setMessage('The Google account could not be disconnected. Retry or contact support.'); return; }
    setGoogleConnection({ connected: false });
    setMessage('Google account disconnected. Stored credentials were deleted.');
  }

  async function importGoogleSheet() {
    // Accept both bare spreadsheet IDs and full share links.
    const spreadsheetId = googleSheetId.match(/\/d\/([A-Za-z0-9_-]{20,120})/)?.[1] ?? googleSheetId.trim();
    const trimmedLabel = importLabel.trim();
    if (!trimmedLabel) { setMessage('Give this import a title first — it is how you will recognize the batch later.'); return; }
    setMessage('');
    setImportBusy(true);
    try {
      const response = await fetch(`${gatewayUrl}/api/imports`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ label: trimmedLabel, sourceType: 'google_sheets', spreadsheetId, sheetName: googleSheetName.trim() || undefined, modelBand: importBand }),
      });
      const result = await response.json().catch(() => ({})) as { id?: string; status?: string; error?: string; message?: string };
      if (response.status === 402 || result.error === 'subscription_required') {
        setMessage(result.error === 'ai_credits_exhausted'
          ? 'AI credits are exhausted for this period — top up or wait for the next billing cycle.'
          : 'Imports require an active subscription. Pick a plan to unlock AI classification.');
        return;
      }
      if (!response.ok || !result.id) {
        const sheetErrors: Record<string, string> = {
          google_sheets_not_configured: 'Google Sheets import is not configured on this deployment. Contact your administrator.',
          google_sheets_encryption_not_configured: 'Google Sheets token storage is missing its encryption key. Contact your administrator.',
          google_sheets_not_connected: 'Connect your Google account first, then import the sheet.',
          google_sheets_connection_revoked: 'Google access was revoked or expired. Reconnect your Google account and retry.',
          google_sheets_reconnect_required: 'The stored Google credential can no longer be read. Reconnect your Google account.',
          google_sheets_check_spreadsheet_sharing: 'The spreadsheet is not readable. Share it with the connected Google account and check the spreadsheet link.',
          google_sheets_no_items_check_headers: 'No importable rows found. The first row must be headers like text, author, platform, views, likes, rating.',
          google_sheets_no_new_rows: 'Every row in that sheet is already imported. New or edited rows will import next time.',
          google_sheets_rate_limited_retry_later: 'Google is rate limiting sheet reads. Wait before trying again.',
          google_sheets_invalid_response: 'Google returned an unexpected response. Nothing was imported; retry later.',
          google_sheets_provider_unavailable: 'Google Sheets could not be reached. Nothing was imported; retry later.',
        };
        setMessage(sheetErrors[result.error ?? ''] ?? result.message ?? result.error ?? 'The import could not be created.'); return;
      }
      setGoogleSheetId(''); setGoogleSheetName(''); setImportLabel('');
      setMessage(`Import queued (${result.status ?? 'pending'}) — classification is running in the background.`);
      await loadWorkspace();
    } catch {
      setMessage('The import could not reach the workspace service. Please retry.');
    } finally {
      setImportBusy(false);
    }
  }

  async function importCsvFile(file: File) {
    if (file.size > 2 * 1024 * 1024) { setMessage('CSV files are limited to 2 MB. Split larger exports into batches.'); return; }
    const content = await file.text();
    const label = importLabel.trim() || file.name.replace(/\.csv$/i, '').trim().slice(0, 120) || 'CSV import';
    setImportLabel(label);
    await createImport('csv', content, label);
  }

  async function loadImportDetail(batchId: string) {
    const response = await fetch(`${gatewayUrl}/api/imports/${batchId}`, { headers: headers() });
    if (!response.ok) { setImportDetail(null); setMessage('Import batch not found or access is denied.'); return; }
    setImportDetail(await response.json() as ImportDetailView);
  }

  async function createInsight() {
    setMessage(''); setInsightBusy(true);
    try {
      const response = await fetch(`${gatewayUrl}/api/insights`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ template: insightTemplate, modelBand: insightBand, language: outputLanguage, ...(insightBatchIds.length ? { batchIds: insightBatchIds } : {}) }),
      });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (response.status === 402 || result.error === 'subscription_required') {
        setMessage(result.error === 'ai_credits_exhausted'
          ? 'AI credits are exhausted for this period — top up or wait for the next billing cycle.'
          : 'Insight reports require an active subscription. Pick a plan to unlock AI analysis.');
        return;
      }
      if (!response.ok || !result.id) {
        setMessage(result.error === 'insight_no_classified_batches' ? 'Import and classify a batch first — insights are built from tagged items.'
          : result.error === 'insight_batches_not_ready' ? 'Some selected batches are still classifying. Wait for them to finish.'
          : result.error ?? 'The insight report could not be created.');
        return;
      }
      setInsightBatchIds([]);
      setMessage('Insight report queued — the AI is reading your tagged evidence now.');
      await loadWorkspace();
    } catch {
      setMessage('The insight request could not reach the workspace service. Please retry.');
    } finally {
      setInsightBusy(false);
    }
  }

  async function deliverInsight(reportId: string, input: { channel: 'email' | 'discord'; email?: string; connectedAccountId?: string; draftKey?: string }): Promise<boolean> {
    setMessage('');
    try {
    const response = await fetch(`${gatewayUrl}/api/insights/${reportId}/deliver`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify(input),
    });
    const result = await response.json().catch(() => ({})) as InsightReportView & { error?: string };
    if (!response.ok) {
      setMessage(result.error === 'insight_delivery_pending' ? 'A delivery for this report is already awaiting approval.'
        : result.error === 'insight_not_generated' ? 'Only a finished report can be sent.'
        : result.error === 'insight_delivery_target_invalid' ? 'Pick a connected Discord account with posting permission.'
        : result.error === 'insight_delivery_target_missing' ? 'No workspace owner email found — enter an email address.'
        : result.error === 'insight_draft_too_long_for_discord' ? 'This draft exceeds the Discord delivery limit. Choose Email to send the complete text.'
        : result.error === 'insight_draft_not_found' ? 'This draft is unavailable. Reopen the report and select a saved draft.'
        : result.error ?? 'The delivery request could not be created.');
      return false;
    }
    setInsightDetail(result);
    setMessage('Delivery queued — approve it in Review to send.');
    await loadWorkspace(); return true;
    } catch { setMessage('The delivery request could not be created.'); return false; }
  }

  const loadInsightDetail = useCallback(async (reportId: string) => {
    const response = await fetch(`${gatewayUrl}/api/insights/${reportId}`, { headers: headers() });
    if (!response.ok) { setInsightDetail(null); setMessage('Insight report not found or access is denied.'); return; }
    setInsightDetail(await response.json() as InsightReportView);
    const nextHash = `#${section === 'insights' ? 'insights' : 'reports'}/${encodeURIComponent(reportId)}`;
    if (location.hash !== nextHash) history.pushState(null, '', nextHash);
  }, [headers, section]);

  const sessionVerified = Boolean(me);
  useEffect(() => {
    const restore = () => {
      const [route, id] = location.hash.slice(1).split('/');
      if (token && sessionVerified && (route === 'reports' || route === 'insights') && id) void loadInsightDetail(decodeURIComponent(id));
      else setInsightDetail(null);
    };
    restore(); window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [token, sessionVerified, loadInsightDetail]);

  async function startTopicRun() {
    setMessage(''); setTopicBusy(true);
    try {
      const response = await fetch(`${gatewayUrl}/api/topics/runs`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ modelBand: topicBand }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 402) {
          setMessage(result.error === 'ai_credits_exhausted'
            ? 'AI credits are exhausted — top up in the Dashboard tab, then retry.'
            : 'Topic clustering requires an active subscription. Pick a plan to unlock AI analysis.');
          return;
        }
        setMessage(result.error === 'topic_run_already_active' ? 'A topic run is already in progress — wait for it to finish.'
          : result.error === 'topics_no_classified_items' ? 'Import and classify a batch first — topics are built from tagged items.'
          : result.error ?? 'The topic run could not be created.');
        return;
      }
      setTopicDetail(null);
      setMessage('Topic run queued — clustering every classified item with verifiable counts.');
      await loadWorkspace();
    } catch {
      setMessage('The topic request could not reach the workspace service. Please retry.');
    } finally {
      setTopicBusy(false);
    }
  }

  const loadTopicItems = useCallback(async (topicId: string) => {
    const response = await fetch(`${gatewayUrl}/api/topics/${topicId}/items`, { headers: headers() });
    if (!response.ok) { setTopicDetail(null); setMessage('Topic not found or access is denied.'); return; }
    setTopicDetail(await response.json() as TopicItemListView);
  }, [headers]);

  // Poll while any batch is still being classified.
  const importsInFlight = importBatches.some((batch) => batch.status === 'pending' || batch.status === 'classifying');
  useEffect(() => {
    if (!token || section !== 'imports' || !importsInFlight) return;
    const timer = window.setInterval(() => void loadWorkspace(), 5_000);
    return () => window.clearInterval(timer);
  }, [token, section, importsInFlight, loadWorkspace]);

  // Poll while an insight report is generating; refresh the open detail too.
  const insightsInFlight = insights.some((report) => report.status === 'pending' || report.status === 'generating');
  useEffect(() => {
    if (!token || !['insights','reports','dashboard'].includes(section) || !insightsInFlight) return;
    const timer = window.setInterval(() => {
      void loadWorkspace();
      if (insightDetail && (insightDetail.status === 'pending' || insightDetail.status === 'generating')) void loadInsightDetail(insightDetail.id);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [token, section, insightsInFlight, insightDetail, loadWorkspace, loadInsightDetail]);

  // Poll while a topic run is proposing/assigning — counts grow deterministically.
  const topicRun = topicData.run;
  const topicsInFlight = topicRun !== null && ['pending', 'proposing', 'assigning'].includes(topicRun.status);
  useEffect(() => {
    if (!token || section !== 'topics' || !topicsInFlight) return;
    const timer = window.setInterval(() => {
      void loadWorkspace();
      if (topicDetail) void loadTopicItems(topicDetail.topic.id);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [token, section, topicsInFlight, topicDetail, loadWorkspace, loadTopicItems]);

  if (!token) {
    return <EmailAuthScreen onSession={(session) => {
      storeSessionAccessToken(session);
      setMe(null);
      setToken(session);
    }} />;
  }

  if (!me) return <main className="min-h-screen bg-paper p-10 text-ink"><p role="status">{sessionError || 'Verifying your session…'}</p>{sessionError && <button onClick={() => void loadMe(token).then((valid) => { if (valid) void loadWorkspace(); })} className="m-3 rounded-md border p-3">{t("Retry")}</button>}<button onClick={signOut} className="m-3 rounded-md border p-3">{t("Sign in again")}</button></main>;

  const locked = !ACTIVE_SUBSCRIPTIONS.has(me.subscriptionStatus) || usage?.status === 'paused';
  async function recoverCheckout() {
    setRecoveringCheckout(true);
    try {
      const response = await fetch(`${gatewayUrl}/api/billing/checkout-session/recover`, { method: 'POST', headers: headers() });
      if (!response.ok) throw new Error('Unable to verify checkout. Retry or contact support; do not purchase again.');
      const result = await response.json() as { state: string; url?: string };
      if (result.state === 'open' && result.url) { window.location.assign(result.url); return; }
      if (result.state === 'confirmed') { await loadMe(token); await loadWorkspace(); setMessage('Subscription verified. Current trial and usage limits still apply.'); }
      else setMessage(result.state === 'expired' ? 'Your previous checkout expired without completing. Choose a plan to start a new checkout.' : 'No recorded checkout was found for this workspace. A Stripe Customer alone does not activate a subscription.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Checkout verification failed.'); }
    finally { setRecoveringCheckout(false); }
  }

  return (
    <WorkspaceShell section={section} navigate={setSection} name={me.workspace.name} email={me.user.email} pending={approvals.length} usage={usage} signOut={signOut}>

      {locked && <section className="mx-auto mt-8 max-w-7xl rounded-xl border-2 border-sunset/50 bg-sunset/10 p-5"><h2 className="text-lg font-semibold">{t("Automation is paused")}</h2><p className="mt-1 text-sm text-ink-soft">{t("Complete your subscription or review your usage limits. A free trial pauses after 7 days or 30 AI credits, whichever comes first.")}</p><div className="mt-4 flex flex-wrap gap-3">{me.role === 'owner' && <button disabled={recoveringCheckout} onClick={() => void recoverCheckout()} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:opacity-50">{recoveringCheckout ? t("Checking Stripe…") : t("Check / resume checkout")}</button>}<a href="/activate?plan=growth" className="inline-block rounded-md bg-sunset px-5 py-3 font-medium text-white shadow-paint-sm">{t("View plans")}</a></div></section>}

      <div className={`workspace-content ${locked && section !== 'settings' && section !== 'dashboard' && section !== 'billing' ? "pointer-events-none select-none opacity-40 grayscale" : ''}`} aria-disabled={locked && section !== 'settings' && section !== 'dashboard' && section !== 'billing'} inert={locked && section !== 'settings' && section !== 'dashboard' && section !== 'billing'}>
        {section === 'billing' && <BillingDashboard token={token} gatewayUrl={gatewayUrl} onUsage={applyBillingUsage} />}
        {section === 'dashboard' && <Overview navigate={setSection} reports={insights} approvals={approvals} items={importBatches.reduce((sum, batch) => sum + batch.itemCount, 0)} accountIssues={accounts.filter(account => account.status !== 'connected').length} onReport={id => { setSection('reports'); void loadInsightDetail(id); }} />}
        {section === 'review' && <ApprovalQueue approvals={approvals} onDecision={decideApproval} />}
        {section === 'reports' && !insightDetail && <ReportLibrary reports={insights} onOpen={id => void loadInsightDetail(id)} />}
        {(section === 'reports' || section === 'insights') && insightDetail && <section className="workspace-card"><button onClick={() => { setInsightDetail(null); history.pushState(null, '', `#${section}`); }}>{section === 'insights' ? w('Back to insights', 'Volver a análisis', '返回洞察') : w('Back to reports', 'Volver a informes', '返回报告')}</button><h2 className="mt-4">{insightDetail.title}</h2><DeliveryPanel report={insightDetail} accounts={accounts} onDeliver={(id,input) => deliverInsight(id,input)} /><InsightReportBody report={insightDetail} /></section>}
        {workspaceError && <div className="mb-6 rounded-xl border border-sky-deep/20 bg-sky-pale p-4 text-sm text-sky-deep" role="alert">{t(workspaceError)} <button className="ml-3 underline" onClick={() => void loadWorkspace()}>{t('Retry')}</button></div>}
        {message && <div className="mb-6 rounded-xl border border-sky-deep/20 bg-sky-pale p-4 text-sm text-sky-deep" role="status">{t(message)} <button className="ml-3 underline" onClick={() => { setMessage(''); void loadWorkspace(); }}>{t('Retry')}</button></div>}
        {section === 'pipelines' && <PipelinesSection templates={templates} pipelines={pipelines} usage={usage} loading={loading} onNew={() => { setDraft(freshDraft()); setSavedPipeline(null); setReadiness(null); setWizardStep('start'); }} onTemplate={startTemplate} onContinue={continuePipeline} onActivity={() => setSection('activity')} />}
        {section === 'imports' && <ImportsSection batches={importBatches} label={importLabel} setLabel={setImportLabel} band={importBand} setBand={setImportBand} content={importContent} setContent={setImportContent} busy={importBusy} detail={importDetail} onPasteImport={() => void createImport('paste', importContent)} onDiscordImport={(id) => void createImport('discord', id)} onCsvFile={(file) => void importCsvFile(file)} onOpenDetail={(id) => void loadImportDetail(id)} onCloseDetail={() => setImportDetail(null)} googleConnection={googleConnection} sheetId={googleSheetId} setSheetId={setGoogleSheetId} sheetName={googleSheetName} setSheetName={setGoogleSheetName} onConnectGoogle={() => void connectGoogleSheets()} onDisconnectGoogle={() => void disconnectGoogleSheets()} onGoogleImport={() => void importGoogleSheet()} />}
        {section === 'insights' && <div hidden={Boolean(insightDetail)}><InsightsSection outputLanguage={outputLanguage} setOutputLanguage={setOutputLanguage} reports={insights} batches={importBatches.filter((batch) => batch.status === 'classified')} template={insightTemplate} setTemplate={setInsightTemplate} band={insightBand} setBand={setInsightBand} selectedBatchIds={insightBatchIds} setSelectedBatchIds={setInsightBatchIds} busy={insightBusy} detail={null} accounts={accounts} onGenerate={() => void createInsight()} onOpenDetail={(id) => void loadInsightDetail(id)} onDeliver={(id, input) => deliverInsight(id, input)} /></div>}
        {section === 'notifications' && <NotificationCenter apiBase={gatewayUrl} accounts={accounts} />}
        {section === 'topics' && <TopicsSection data={topicData} band={topicBand} setBand={setTopicBand} busy={topicBusy} detail={topicDetail} hasClassifiedItems={importBatches.some((batch) => batch.status === 'classified')} onStart={() => void startTopicRun()} onOpenDetail={(id) => void loadTopicItems(id)} onCloseDetail={() => setTopicDetail(null)} />}
        {section === 'accounts' && <><AccountsSection accounts={accounts.filter(account => !['snapchat', 'whatsapp'].includes(account.platform))} connecting={connecting} onConnect={connectSocial} onRefresh={() => void refreshAccounts(true)} />{telegram && <section className="mt-6 rounded-xl border border-ink/20 p-6"><h3 className="text-lg font-semibold">{t("Connect Telegram")}</h3><p className="my-3">{t("Code:")} <strong>{telegram.code}</strong> {t("· Expires:")} {new Date(telegram.expiresAt).toLocaleString()}</p><ol className="space-y-2">{telegram.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol><p className="mt-4">{t("After the bot confirms, select Sync account health above to verify the connection.")}</p><button onClick={() => setTelegram(null)} className="mt-3 underline">{t("Dismiss code")}</button></section>}</>}
        {section === 'activity' && <ActivitySection approvals={approvals} taskEvents={taskEvents} auditEvents={auditEvents} runId={runId} setRunId={setRunId} run={run} onLoadRun={() => void loadRun()} onDecision={decideApproval} />}
        {section === 'settings' && <SettingsSection me={me} locked={locked} newPassword={newPassword} setNewPassword={setNewPassword} passwordStatus={t(passwordStatus)} onSavePassword={() => void savePassword()} onSignOut={signOut} feedbackCategory={feedbackCategory} setFeedbackCategory={setFeedbackCategory} feedbackMessage={feedbackMessage} setFeedbackMessage={setFeedbackMessage} feedbackStatus={t(feedbackStatus)} onFeedback={() => void sendFeedback()} referralUrl={referralUrl} referralStatus={t(referralStatus)} onReferral={() => void createReferralLink()} />}
        {section === 'settings' && me && <ReferralLedger key={me.workspace.id} gatewayUrl={gatewayUrl} headers={headers} />}
      </div>

      {wizardStep && !locked && <PipelineWizard step={wizardStep} draft={draft} setDraft={setDraft} templates={templates} selectedTemplate={draft.sourceType === 'template' ? selectedTemplate : undefined} accounts={healthyAccounts} savedPipeline={savedPipeline} readiness={readiness} loading={loading} onClose={() => setWizardStep(null)} onStep={setWizardStep} onTemplate={startTemplate} onDescription={startDescription} onToggleAccount={toggleAccount} onSave={() => void saveDraft()} onTest={() => void testSetup()} onActivate={() => void activateSavedPipeline()} />}
    </WorkspaceShell>
  );
}

/** Email sign-in / registration gate from PR #35. */
function EmailAuthScreen({ onSession }: { onSession: (accessToken: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>(() => /\/register\/?$/.test(window.location.pathname) ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${gatewayUrl}/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'login'
          ? { email, password }
          : { email, password, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as SessionResponse & { error?: string };
      if (!response.ok || typeof body.accessToken !== 'string') {
        setError(body.error === 'email_already_registered'
          ? 'This email already has an account — sign in instead.'
          : body.error === 'rate_limited'
            ? 'Too many attempts. Wait a few minutes and try again.'
            : 'Sign-in failed. Check your email and password.');
        return;
      }
      onSession(body.accessToken);
    } catch {
      setError('The platform could not be reached. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="workspace-v6 paper-grain flex min-h-screen items-center justify-center bg-paper p-6 text-ink"><section className="wobble sketch w-full max-w-md bg-paper-card p-8 shadow-paint"><WorkspaceLanguageSelect /><p className="font-hand text-xl text-sky-deep">{t("Piggybot Platform")}</p><h1 className="mt-2 font-display text-3xl">{mode === 'login' ? t("Sign in to your workspace") : t("Create your workspace")}</h1><p className="mt-2 text-sm text-ink-soft">{mode === 'login' ? t("Use the email you signed up with — Gmail works great.") : t("Register with your email. A free workspace is created instantly; subscribe any time to unlock every feature.")}</p><div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-ink/15 p-1 text-sm font-medium"><button onClick={() => { setMode('login'); setError(''); }} className={`rounded-md px-3 py-2 ${mode === 'login' ? "bg-sky-deep text-white" : "text-ink-soft hover:text-ink"}`}>{t("Sign in")}</button><button onClick={() => { setMode('register'); setError(''); }} className={`rounded-md px-3 py-2 ${mode === 'register' ? "bg-sky-deep text-white" : "text-ink-soft hover:text-ink"}`}>{t("Register")}</button></div><label className="mt-5 block text-sm text-ink-soft">{t("Email")}</label><input aria-label={t("Email")} type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder={t("you@gmail.com")} autoComplete="email" /><label className="mt-4 block text-sm text-ink-soft">{t("Password")}</label><input aria-label={t("Password")} type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder={mode === 'register' ? t("8-128 characters") : t("Your password")} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />{mode === 'register' && <><label className="mt-4 block text-sm text-ink-soft">{t("Display name")} <span className="text-ink-faint">{t("(optional)")}</span></label><input aria-label={t("Display name")} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder={t("How should we call you?")} autoComplete="name" /></>}{error && <p className="mt-4 rounded-lg bg-sunset/15 p-3 text-sm text-sunset-deep" role="alert">{t(error)}</p>}<button disabled={busy || !email.trim() || password.length < 8} onClick={() => void submit()} className="mt-6 w-full rounded-md bg-sky-deep px-4 py-3 font-medium text-white shadow-paint-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50">{busy ? t("One moment…") : mode === 'login' ? t("Sign in") : t("Create account")}</button><div className="mt-5 flex justify-between text-sm"><a href="/" className="text-ink-soft hover:text-ink">{t("← Back to site")}</a><a href="/contact" className="text-ink-soft hover:text-ink">{t("Need help?")}</a></div></section></main>;
}

function PipelinesSection({ templates, pipelines, usage, loading, onNew, onTemplate, onContinue, onActivity }: { templates: PipelineTemplate[]; pipelines: PipelineView[]; usage: UsageView | null; loading: boolean; onNew: () => void; onTemplate: (template: PipelineTemplate) => void; onContinue: (pipeline: PipelineView) => void; onActivity: () => void; }) {
  const active = pipelines.filter((pipeline) => pipeline.status === 'published').length;
  return <div className="space-y-8">
    <section className="grid gap-4 md:grid-cols-3">
      <Stat label={t("Published pipelines")} value={String(active)} detail={`${pipelines.length - active} draft${pipelines.length - active === 1 ? '' : 's'}`} />
      <Stat label={t("Task usage")} value={usage ? `${usage.taskUsed} / ${usage.taskQuota}` : '—'} detail={usage?.status === 'degraded' ? t("Energy-saving mode") : t("Current billing period")} />
      <Stat label={t("AI credits")} value={usage ? String(usage.aiCreditsAvailable) : '—'} detail={usage ? `${usage.aiCreditsUsed} used this period` : t("Current billing period")} />
      <button onClick={onNew} className="wobble sketch bg-sunset p-5 text-left text-white shadow-paint transition hover:-translate-y-1"><span className="block text-sm font-semibold uppercase tracking-wide">{t("Create")}</span><span className="mt-2 block font-display text-2xl">{t("New automation →")}</span></button>
    </section>

    <section>
      <div className="flex items-end justify-between gap-4"><div><p className="font-hand text-lg text-sky-deep">{t("Your automation shelf")}</p><h2 className="font-display text-3xl">{t("My Pipelines")}</h2></div>{loading && <span className="text-sm text-ink-soft">{t("Refreshing…")}</span>}</div>
      {pipelines.length === 0 ? <EmptyState title={t("No pipelines yet")} detail={t("Choose a proven template or describe the result you want. Piggybot will create a safe, editable draft.")} action={t("Create your first pipeline")} onAction={onNew} /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pipelines.map((pipeline) => <article key={pipeline.id} className="sketch bg-paper-card p-5 shadow-paint-sm"><div className="flex items-center justify-between gap-3"><StatusBadge status={pipeline.status} /><span className="text-xs text-ink-soft">v{pipeline.version}</span></div><h3 className="mt-4 text-lg font-semibold">{pipeline.name}</h3><p className="mt-2 line-clamp-2 text-sm text-ink-soft">{pipeline.definition.brief}</p><div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-sky-pale px-2 py-1">{pipeline.definition.targetAccountIds.length} {t("destination")}{pipeline.definition.targetAccountIds.length === 1 ? '' : 's'}</span><span className="rounded-full bg-sun/30 px-2 py-1">{t("Approval")} {pipeline.definition.approvalPolicy === 'required' ? 'required' : 'assisted'}</span>{pipeline.lastRunStatus && <span className="rounded-full bg-meadow-light px-2 py-1">{t("Last run:")} {pipeline.lastRunStatus}</span>}</div><button onClick={() => pipeline.status === 'draft' ? onContinue(pipeline) : onActivity()} className="mt-5 w-full rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{pipeline.status === 'draft' ? t("Continue setup") : t("View activity")}</button></article>)}</div>}
    </section>

    <section><p className="font-hand text-lg text-sky-deep">{t("Proven starting points")}</p><h2 className="font-display text-3xl">{t("Standard templates")}</h2><div className="mt-5 grid gap-4 md:grid-cols-3">{templates.map((template) => <TemplateCard key={template.id} template={template} onClick={() => onTemplate(template)} />)}</div></section>
  </div>;
}

function CitationList({ citations }: { citations?: ReportCitation[] }) {
  if (!citations?.length) return null;
  return <div className="mt-2 space-y-1">{citations.map((citation, index) => <blockquote key={index} className="border-l-2 border-sky-deep/40 pl-2 text-xs italic text-ink-soft">“{citation.snippet}”</blockquote>)}</div>;
}

interface RecapReport { summary: string; topContent: { ref: string; note: string; successFactors: string[]; citations: ReportCitation[] }[]; successFactors: { factor: string; detail: string; citations: ReportCitation[] }[]; fanThemes: { theme: string; citations: ReportCitation[] }[]; nextTopics: string[]; draftTitles: string[]; draftScripts?: { title: string; body: string; citations: ReportCitation[] }[]; }
interface CommentReport { summary: string; frequentQuestions: { question: string; approxCount: number; citations: ReportCitation[] }[]; sentimentNotes: { sentiment: string; note: string; citations: ReportCitation[] }[]; demandRanking: { demand: string; approxCount: number; citations: ReportCitation[] }[]; productOpportunities: { opportunity: string; citations: ReportCitation[] }[]; memeMaterial: { meme: string; citations: ReportCitation[] }[]; highValueComments: { ref: string; reason: string; replyDraft: string; citations: ReportCitation[] }[]; }
interface OpportunityReport { summary: string; opportunities: { name: string; formFactor: string; audience: string; difficulty: string; evidenceCount: number; risks: string[]; validationAction: string; listingDraft: string; citations: ReportCitation[] }[]; presalePollDraft: string; }
interface ReviewReport { summary: string; issueClusters: { theme: string; approxCount: number; severity: string; affectedSkus: string[]; citations: ReportCitation[] }[]; returnReasons: { reason: string; approxCount: number; citations: ReportCitation[] }[]; expectationMismatches: { aspect: string; detail: string; citations: ReportCitation[] }[]; priorityFixes: { fix: string; sku?: string; priority: string; expectedImpact: string; citations: ReportCitation[] }[]; serviceReplyDrafts: { ref: string; issue: string; replyDraft: string; citations: ReportCitation[] }[]; listingFixSuggestions: string[]; }
interface DigestReport { summary: string; hotTopics: { topic: string; citations: ReportCitation[] }[]; unresolvedQuestions: { question: string; citations: ReportCitation[] }[]; highValueMembers: { author: string; reason: string; signals: string[]; citations?: ReportCitation[] }[]; conflictRisks: { risk: string; severity: string; citations: ReportCitation[] }[]; activityIdeas: string[]; announcementDraft: string; }
interface DailyOpsReport { summary: string; tasks: { title: string; reason: string; suggestedAction: string; draftCopy?: string; priority: string; dueHint: string; citations: ReportCitation[] }[]; }

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-sunset text-white', high: 'bg-sun/60 text-ink', normal: 'bg-sky-pale text-ink-soft',
  critical: 'bg-sunset text-white', medium: 'bg-sun/60 text-ink', low: 'bg-sky-pale text-ink-soft',
};
function PriorityChip({ value }: { value: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${PRIORITY_STYLES[value] ?? 'bg-sky-pale text-ink-soft'}`}>{value}</span>;
}

function InsightReportBody({ report }: { report: InsightReportView }) {
  if (report.status !== 'generated' || !report.report) {
    return <p className="p-6 text-sm text-ink-soft">{report.status === 'failed' ? `Generation failed: ${report.error ?? 'unknown error'}. You can safely generate a new report.` : t("The AI is reading your tagged evidence. This usually takes under a minute…")}</p>;
  }
  const body = report.report;
  return <div className="space-y-6 p-6 md:p-8">
    <ReportActionFeedback reportId={report.id} apiBase={gatewayUrl} />
    <ReportDatasetStats value={body._dataset} />
    <p className="text-xs text-ink-soft">{t("Conclusion counts below show distinct cited sources, not total mentions across the dataset. References starting with p quote prior report summaries (secondary evidence), not original comments.")}</p>
    {'summary' in body && <p className="rounded-xl bg-sky-pale p-4 text-sm">{(body as { summary: string }).summary}</p>}
    {report.droppedCitations > 0 && <p className="text-xs text-ink-soft">{report.droppedCitations} {t("citation")}{report.droppedCitations === 1 ? '' : 's'} {t("failed verbatim verification and were removed before saving.")}</p>}

    {report.template === 'content_recap' && (() => { const recap = body as unknown as RecapReport; return <>
      {recap.topContent?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Top content & why it worked")}</h3><div className="mt-3 space-y-3">{recap.topContent.map((item, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><p className="text-sm font-medium">#{index + 1} · {item.note}</p>{item.successFactors?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{item.successFactors.map((factor) => <span key={factor} className="rounded-full bg-sun/30 px-2 py-0.5 text-[11px]">{factor}</span>)}</div>}<CitationList citations={item.citations} /></div>)}</div></section>}
      {recap.successFactors?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Repeatable success factors")}</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{recap.successFactors.map((factor, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><p className="text-sm font-semibold">{factor.factor}</p><p className="mt-1 text-xs text-ink-soft">{factor.detail}</p><CitationList citations={factor.citations} /></div>)}</div></section>}
      {recap.fanThemes?.length > 0 && <section><h3 className="text-lg font-semibold">{t("What fans care about now")}</h3><div className="mt-3 space-y-2">{recap.fanThemes.map((theme, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm font-medium">{theme.theme}</p><CitationList citations={theme.citations} /></div>)}</div></section>}
      {recap.nextTopics?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Next batch:")} {recap.nextTopics.length} {t("topic ideas")}</h3><ol className="mt-3 list-decimal space-y-1 pl-6 text-sm">{recap.nextTopics.map((topic, index) => <li key={index}>{topic}</li>)}</ol></section>}
      {Boolean(recap.draftScripts?.length) && <section><h3 className="text-lg font-semibold">{t("Script drafts · review before publishing")}</h3><div className="mt-3 space-y-3">{recap.draftScripts!.map((script, index) => <article key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><h4 className="font-semibold">{script.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm">{script.body}</p><CitationList citations={script.citations} /></article>)}</div></section>}
      {recap.draftTitles?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Ready-to-publish titles")}</h3><div className="mt-3 space-y-2">{recap.draftTitles.map((title, index) => <p key={index} className="rounded-lg border border-ink/15 bg-paper-card p-3 text-sm">{title}</p>)}</div></section>}
    </>; })()}

    {report.template === 'comment_insights' && (() => { const insights = body as unknown as CommentReport; return <>
      {insights.demandRanking?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Fan demand ranking")}</h3><div className="mt-3 space-y-2">{insights.demandRanking.map((demand, index) => <div key={index} className="flex items-start gap-3 rounded-lg bg-paper-card p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-deep text-xs text-white">{index + 1}</span><div className="flex-1"><p className="text-sm font-medium">{demand.demand} <span className="text-xs text-ink-soft">· {demand.citations ? new Set(demand.citations.map(c => c.ref)).size : 0} {t("cited sources")}</span></p><CitationList citations={demand.citations} /></div></div>)}</div></section>}
      {insights.frequentQuestions?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Frequent questions")}</h3><div className="mt-3 space-y-2">{insights.frequentQuestions.map((question, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm font-medium">{question.question} <span className="text-xs text-ink-soft">· {question.citations ? new Set(question.citations.map(c => c.ref)).size : 0} {t("cited sources")}</span></p><CitationList citations={question.citations} /></div>)}</div></section>}
      {insights.sentimentNotes?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Sentiment signals")}</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{insights.sentimentNotes.map((note, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{note.sentiment.replace('_', ' ')}</p><p className="mt-1 text-sm">{note.note}</p><CitationList citations={note.citations} /></div>)}</div></section>}
      {insights.highValueComments?.length > 0 && <section><h3 className="text-lg font-semibold">{t("High-value comments & reply drafts")}</h3><div className="mt-3 space-y-3">{insights.highValueComments.map((comment, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><p className="text-sm font-medium">{comment.reason}</p><CitationList citations={comment.citations} /><div className="mt-2 rounded-lg bg-meadow-light/60 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-meadow-deep">{t("Reply draft")}</p><p className="mt-1 text-sm">{comment.replyDraft}</p></div></div>)}</div></section>}
      {insights.memeMaterial?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Meme material")}</h3><div className="mt-3 space-y-2">{insights.memeMaterial.map((meme, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm">{meme.meme}</p><CitationList citations={meme.citations} /></div>)}</div></section>}
      {insights.productOpportunities?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Productizable signals")}</h3><div className="mt-3 space-y-2">{insights.productOpportunities.map((opportunity, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm">{opportunity.opportunity}</p><CitationList citations={opportunity.citations} /></div>)}</div></section>}
    </>; })()}

    {report.template === 'product_opportunities' && (() => { const opportunities = body as unknown as OpportunityReport; return <>
      {opportunities.opportunities?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Opportunity list")}</h3><div className="mt-3 space-y-3">{opportunities.opportunities.map((opportunity, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{opportunity.name}</p><span className="rounded-full bg-sky-pale px-2 py-0.5 text-[11px]">{opportunity.formFactor.replace('_', ' ')}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${opportunity.difficulty === 'low' ? "bg-meadow-light text-meadow-deep" : opportunity.difficulty === 'medium' ? 'bg-sun/35' : "bg-sunset/15 text-sunset"}`}>{opportunity.difficulty} {t("difficulty")}</span><span className="text-[11px] text-ink-soft">{opportunity.citations ? new Set(opportunity.citations.map(c => c.ref)).size : 0} {t("cited sources")}</span></div><p className="mt-2 text-xs text-ink-soft">{t("Audience:")} {opportunity.audience}</p>{opportunity.risks?.length > 0 && <p className="mt-1 text-xs text-sunset">{t("Risks:")} {opportunity.risks.join(' · ')}</p>}<p className="mt-1 text-xs"><span className="font-semibold">{t("Validate:")}</span> {opportunity.validationAction}</p><CitationList citations={opportunity.citations} /><div className="mt-2 rounded-lg bg-sky-pale/70 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{t("Listing draft")}</p><p className="mt-1 text-sm whitespace-pre-line">{opportunity.listingDraft}</p></div></div>)}</div></section>}
      {opportunities.presalePollDraft && <section><h3 className="text-lg font-semibold">{t("Presale poll draft")}</h3><p className="mt-3 rounded-xl bg-sky-pale p-4 text-sm whitespace-pre-line">{opportunities.presalePollDraft}</p></section>}
    </>; })()}

    {report.template === 'review_attribution' && (() => { const review = body as unknown as ReviewReport; return <>
      {Boolean(body._reviewRanking) && <p className="rounded-xl bg-sky-pale p-3 text-sm">{t("Top")} {review.issueClusters.length} {t("issues (up to 5): ordered by model-assessed severity, then distinct cited reviews. This is not a sales-impact or full-dataset frequency ranking. SKU labels are restricted to the cited source metadata.")}</p>}
      {review.issueClusters?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Complaint themes")}</h3><div className="mt-3 space-y-3">{review.issueClusters.map((cluster, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{cluster.theme}</p><PriorityChip value={cluster.severity} /><span className="text-[11px] text-ink-soft">{cluster.citations ? new Set(cluster.citations.map(c => c.ref)).size : 0} {t("cited reviews")}</span></div>{cluster.affectedSkus?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{cluster.affectedSkus.map((sku) => <span key={sku} className="rounded-full bg-sky-pale px-2 py-0.5 text-[11px]">{t("SKU:")} {sku}</span>)}</div>}<CitationList citations={cluster.citations} /></div>)}</div></section>}
      {review.priorityFixes?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Priority fixes")}</h3><div className="mt-3 space-y-2">{review.priorityFixes.map((fix, index) => <div key={index} className="flex items-start gap-3 rounded-lg bg-paper-card p-3"><PriorityChip value={fix.priority} /><div className="flex-1"><p className="text-sm font-medium">{fix.fix}{fix.sku && <span className="text-xs text-ink-soft"> {t("· SKU")} {fix.sku}</span>}</p><p className="mt-1 text-xs text-ink-soft">{t("Expected impact:")} {fix.expectedImpact}</p><CitationList citations={fix.citations} /></div></div>)}</div></section>}
      {review.returnReasons?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Return reasons")}</h3><div className="mt-3 space-y-2">{review.returnReasons.map((reason, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm">{reason.reason} <span className="text-xs text-ink-soft">· {reason.citations ? new Set(reason.citations.map(c => c.ref)).size : 0} {t("cited sources")}</span></p><CitationList citations={reason.citations} /></div>)}</div></section>}
      {review.expectationMismatches?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Listing vs reality")}</h3><div className="mt-3 space-y-2">{review.expectationMismatches.map((mismatch, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm font-medium">{mismatch.aspect}</p><p className="mt-1 text-xs text-ink-soft">{mismatch.detail}</p><CitationList citations={mismatch.citations} /></div>)}</div></section>}
      {review.serviceReplyDrafts?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Customer-service reply drafts")}</h3><div className="mt-3 space-y-3">{review.serviceReplyDrafts.map((draft, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><p className="text-sm font-medium">{draft.issue}</p><CitationList citations={draft.citations} /><div className="mt-2 rounded-lg bg-meadow-light/60 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-meadow-deep">{t("Reply draft")}</p><p className="mt-1 text-sm">{draft.replyDraft}</p></div></div>)}</div></section>}
      {review.listingFixSuggestions?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Product page edits")}</h3><ul className="mt-3 list-disc space-y-1 pl-6 text-sm">{review.listingFixSuggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ul></section>}
    </>; })()}

    {report.template === 'community_digest' && (() => { const digest = body as unknown as DigestReport; return <>
      {digest.hotTopics?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Hot topics")}</h3><div className="mt-3 space-y-2">{digest.hotTopics.map((topic, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm font-medium">{topic.topic}</p><CitationList citations={topic.citations} /></div>)}</div></section>}
      {digest.highValueMembers?.length > 0 && <section><h3 className="text-lg font-semibold">{t("High-value members")}</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{digest.highValueMembers.map((member, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><p className="text-sm font-semibold">{member.author}</p><p className="mt-1 text-xs text-ink-soft">{member.reason}</p>{member.signals?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{member.signals.map((signal) => <span key={signal} className="rounded-full bg-meadow-light px-2 py-0.5 text-[11px]">{signal}</span>)}</div>}<CitationList citations={member.citations ?? []} /></div>)}</div></section>}
      {digest.unresolvedQuestions?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Unresolved questions")}</h3><div className="mt-3 space-y-2">{digest.unresolvedQuestions.map((question, index) => <div key={index} className="rounded-lg bg-paper-card p-3"><p className="text-sm">{question.question}</p><CitationList citations={question.citations} /></div>)}</div></section>}
      {digest.conflictRisks?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Moderation watchlist")}</h3><div className="mt-3 space-y-2">{digest.conflictRisks.map((risk, index) => <div key={index} className="flex items-start gap-3 rounded-lg bg-paper-card p-3"><PriorityChip value={risk.severity} /><div className="flex-1"><p className="text-sm">{risk.risk}</p><CitationList citations={risk.citations} /></div></div>)}</div></section>}
      {digest.activityIdeas?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Activity ideas")}</h3><ul className="mt-3 list-disc space-y-1 pl-6 text-sm">{digest.activityIdeas.map((idea, index) => <li key={index}>{idea}</li>)}</ul></section>}
      {digest.announcementDraft && <section><h3 className="text-lg font-semibold">{t("Announcement draft")}</h3><p className="mt-3 rounded-xl bg-sky-pale p-4 text-sm whitespace-pre-line">{digest.announcementDraft}</p></section>}
    </>; })()}

    {report.template === 'daily_ops' && (() => { const daily = body as unknown as DailyOpsReport; return <>
      {daily.tasks?.length > 0 && <section><h3 className="text-lg font-semibold">{t("Today's priorities")}</h3><div className="mt-3 space-y-3">{daily.tasks.map((task, index) => <div key={index} className="rounded-xl border border-ink/15 bg-paper-card p-4"><div className="flex flex-wrap items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-deep text-xs text-white">{index + 1}</span><p className="flex-1 text-sm font-semibold">{task.title}</p><PriorityChip value={task.priority} /><span className="text-[11px] text-ink-soft">{task.dueHint}</span></div><p className="mt-2 text-xs text-ink-soft">{task.reason}</p><p className="mt-1 text-sm"><span className="font-semibold">{t("Action:")}</span> {task.suggestedAction}</p>{task.draftCopy && <div className="mt-2 rounded-lg bg-sky-pale/70 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{t("Ready-to-use copy")}</p><p className="mt-1 text-sm whitespace-pre-line">{task.draftCopy}</p></div>}<CitationList citations={task.citations} /></div>)}</div></section>}
    </>; })()}
  </div>;
}

function InsightsSection({ outputLanguage, setOutputLanguage, reports, batches, template, setTemplate, band, setBand, selectedBatchIds, setSelectedBatchIds, busy, detail, accounts, onGenerate, onOpenDetail, onDeliver }: { outputLanguage: 'en'|'es'|'zh'; setOutputLanguage: (language:'en'|'es'|'zh')=>void; reports: InsightReportView[]; batches: ImportBatchView[]; template: InsightTemplate; setTemplate: (template: InsightTemplate) => void; band: ModelBand; setBand: (band: ModelBand) => void; selectedBatchIds: string[]; setSelectedBatchIds: (ids: string[]) => void; busy: boolean; detail: InsightReportView | null; accounts: ConnectedAccount[]; onGenerate: () => void; onOpenDetail: (id: string) => void; onDeliver: (id: string, input: { channel: 'email' | 'discord'; email?: string; connectedAccountId?: string; draftKey?: string }) => Promise<boolean>; }) {
  return <div className="space-y-8">
    <WeeklyInsightReview apiBase={gatewayUrl} onOpenReport={onOpenDetail} />
    <WeeklyHistory apiBase={gatewayUrl} onOpenReport={onOpenDetail} />
    <section className="sketch bg-paper-card p-6 shadow-paint-sm">
      <p className="font-hand text-lg text-sky-deep">{t("Result templates")}</p>
      <h2 className="font-display text-3xl">{t("Insight reports")}</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">{t("Each report is generated only from your imported, AI-tagged items — every conclusion carries verbatim evidence quotes verified by the platform.")}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {INSIGHT_TEMPLATES.map((option) => <button key={option.id} onClick={() => setTemplate(option.id)} className={`sketch p-5 text-left transition hover:-translate-y-1 ${template === option.id ? "bg-sky-pale outline-2 outline-sky-deep" : 'bg-paper-card'}`}><span className="block text-lg font-semibold">{t(option.name)}</span><span className="mt-2 block text-sm text-ink-soft">{t(option.tagline)}</span></button>)}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label={t("Content language")}><select aria-label={t("Content language")} value={outputLanguage} onChange={e=>setOutputLanguage(e.target.value as typeof outputLanguage)}><option value="en">English</option><option value="es">Español</option><option value="zh">简体中文</option></select></Field>
        <Field label={t("AI model band")}><ModelBandPicker value={band} onChange={setBand} /></Field>
        {template === 'daily_ops'
          ? <Field label={t("Source")}><p className="rounded-md border border-ink/20 bg-paper p-3 text-xs text-ink-soft">{t("Automatic — your latest classified items plus the findings of your recent insight reports. A fresh report is also auto-generated every morning for subscribed workspaces.")}</p></Field>
          : <Field label={`Source batches (${selectedBatchIds.length ? `${selectedBatchIds.length} selected` : t("latest classified")})`}>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-ink/20 bg-paper p-2">
              {batches.length === 0 && <p className="p-2 text-xs text-ink-soft">{t("No classified batches yet — import data first.")}</p>}
              {batches.map((batch) => <label key={batch.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-sky-pale"><input type="checkbox" checked={selectedBatchIds.includes(batch.id)} onChange={() => setSelectedBatchIds(selectedBatchIds.includes(batch.id) ? selectedBatchIds.filter((id) => id !== batch.id) : [...selectedBatchIds, batch.id])} />{batch.label} · {batch.itemCount} {t("items")}</label>)}
            </div>
          </Field>}
      </div>
      <button disabled={busy || (batches.length === 0 && reports.length === 0)} onClick={onGenerate} className="mt-4 rounded-md bg-sunset px-5 py-3 font-medium text-white shadow-paint-sm disabled:cursor-not-allowed disabled:opacity-40">{busy ? t("Queuing…") : template === 'daily_ops' ? t("Generate today's tasks") : t("Generate insight report")}</button>
    </section>

    <section>
      <p className="font-hand text-lg text-sky-deep">{t("History")}</p>
      <h2 className="font-display text-3xl">{t("Reports")}</h2>
      {reports.length === 0 ? <EmptyState title={t("No reports yet")} detail={t("Pick a template above and generate your first evidence-backed report.")} /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{reports.map((report) => <article key={report.id} className="sketch bg-paper-card p-5 shadow-paint-sm"><div className="flex items-center justify-between gap-3"><StatusBadge status={report.status} /><span className="text-xs text-ink-soft">{report.modelBand}</span></div><h3 className="mt-4 text-lg font-semibold">{report.title}</h3><p className="mt-1 text-xs text-ink-soft">{INSIGHT_TEMPLATES.find((t) => t.id === report.template)?.name} · {report.itemCount} {t("items ·")} {new Date(report.createdAt).toLocaleString()}</p><button onClick={() => onOpenDetail(report.id)} className="mt-4 w-full rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{t("Open report")}</button></article>)}</div>}
    </section>

    {detail && <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"><div className="mx-auto my-4 max-w-4xl rounded-2xl bg-paper shadow-2xl"><header className="flex items-start justify-between border-b border-ink/15 p-6"><div><p className="font-hand text-lg text-sky-deep">{INSIGHT_TEMPLATES.find((t) => t.id === detail.template)?.name} · {detail.itemCount} {t("items")}</p><h2 className="font-display text-3xl">{detail.title}</h2></div></header><DeliveryPanel report={detail} accounts={accounts} onDeliver={onDeliver} /><InsightReportBody report={detail} /></div></div>}
  </div>;
}

/**
 * Module 2（全量主题聚类与可信计数）：对全部已分类条目按具体主题聚类。
 * "被提到 N 次"由平台 SQL COUNT 得出（不是 LLM 声明）；点开的每条证据
 * 都是原文逐字摘录，构成可核验的计数路径。
 */
function TopicsSection({ data, band, setBand, busy, detail, hasClassifiedItems, onStart, onOpenDetail, onCloseDetail }: { data: TopicListView; band: ModelBand; setBand: (band: ModelBand) => void; busy: boolean; detail: TopicItemListView | null; hasClassifiedItems: boolean; onStart: () => void; onOpenDetail: (id: string) => void; onCloseDetail: () => void; }) {
  const run = data.run;
  const active = run !== null && ['pending', 'proposing', 'assigning'].includes(run.status);
  const runStatusLabel = run?.status === 'pending' ? 'Queued' : run?.status === 'proposing' ? 'Discovering topics' : run?.status === 'assigning' ? 'Assigning items' : run?.status === 'completed' ? 'Completed' : 'Failed';
  return <div className="space-y-8">
    <section className="sketch bg-paper-card p-6 shadow-paint-sm">
      <p className="font-hand text-lg text-sky-deep">{t("Verifiable demand counts")}</p>
      <h2 className="font-display text-3xl">{t("Topic clustering")}</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">{t("One run reads every classified item, groups them into concrete topics, and counts exactly how many items mention each need. Counts come from verified database rows — open any topic to audit every item and its verbatim evidence.")}</p>
      <div className="mt-5 max-w-md"><Field label={t("AI model band")}><ModelBandPicker value={band} onChange={setBand} /></Field></div>
      <button disabled={busy || active || !hasClassifiedItems} onClick={onStart} className="mt-4 rounded-md bg-sunset px-5 py-3 font-medium text-white shadow-paint-sm disabled:cursor-not-allowed disabled:opacity-40">{busy ? t("Queuing…") : active ? t("Run in progress…") : t("Cluster all items")}</button>
      {!hasClassifiedItems && <p className="mt-2 text-xs text-ink-soft">{t("Import and classify a batch first — topics are built from tagged items.")}</p>}
    </section>

    {run && <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-hand text-lg text-sky-deep">{t("Latest run")}</p><h2 className="font-display text-3xl">{t("Topics")}</h2></div>
        <div className="flex items-center gap-3 text-xs text-ink-soft"><StatusBadge status={run.status} /><span>{t(runStatusLabel)} · {run.modelBand} · {run.itemCount} {t("items ·")} {new Date(run.createdAt).toLocaleString()}{run.completedAt ? ` · done ${new Date(run.completedAt).toLocaleString()}` : ''}</span></div>
      </div>
      {run.status === 'failed' && run.error && <p className="mt-3 rounded-md bg-sunset/10 p-3 text-sm text-sunset">{t("Run failed:")} {run.error}{t(". Start a new run to retry from scratch.")}</p>}
      {data.topics.length === 0
        ? <EmptyState title={active ? t("Discovering topics…") : t("No topics yet")} detail={active ? t("The AI is reading a sample of your items to propose concrete topics, then assigns every item with verbatim evidence.") : t("Run a clustering pass to see what your audience keeps asking for.")} />
        : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.topics.map((topic) => <article key={topic.id} className="sketch bg-paper-card p-5 shadow-paint-sm">
          <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-semibold">{topic.label}</h3><span className="rounded-full bg-sky-pale px-2.5 py-1 text-sm font-semibold text-sky-deep" title={t("Verified count: items assigned with platform-checked verbatim evidence")}>×{topic.itemCount}</span></div>
          <p className="mt-2 text-sm text-ink-soft">{topic.description}</p>
          <button onClick={() => onOpenDetail(topic.id)} className="mt-4 w-full rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{t("Audit")} {topic.itemCount} {t("item")}{topic.itemCount === 1 ? '' : 's'}</button>
        </article>)}</div>}
    </section>}
    {!run && <EmptyState title={t("No topic run yet")} detail={t("Cluster all classified items to get verifiable counts of what your audience asks for.")} />}

    {detail && <WorkspaceDialog title={t("Details")} onClose={onCloseDetail}><div>
      <header className="flex items-start justify-between border-b border-ink/15 p-6">
        <div><p className="font-hand text-lg text-sky-deep">{detail.total} {t("verified mention")}{detail.total === 1 ? '' : 's'}</p><h2 className="font-display text-3xl">{detail.topic.label}</h2><p className="mt-1 text-sm text-ink-soft">{detail.topic.description}</p></div>

      </header>
      <div className="space-y-3 p-6">
        <p className="text-xs text-ink-soft">{t("Every row below is one imported item assigned to this topic. The highlighted quote is the exact evidence the platform verified as a verbatim substring of the item text.")}</p>
        {detail.items.length === 0 && <p className="text-sm text-ink-soft">{t("No items assigned yet")}{active ? t(" — the run is still processing.") : '.'}</p>}
        {detail.items.map((item) => <article key={item.itemId} className="rounded-xl border border-ink/15 bg-paper-card p-4">
          <p className="text-sm leading-relaxed">{highlightEvidence(item.text, item.evidence)}</p>
          <p className="mt-2 text-xs text-ink-soft">{item.platform}{item.author ? ` · ${item.author}` : ''} {t("· confidence")} {Math.round(item.confidence * 100)}% · {new Date(item.createdAt).toLocaleString()}</p>
        </article>)}
        {detail.total > detail.items.length && <p className="text-xs text-ink-soft">{t("Showing the first")} {detail.items.length} {t("of")} {detail.total} {t("mentions.")}</p>}
      </div>
    </div></WorkspaceDialog>}
  </div>;
}

/** 高亮逐字证据（证据已在平台侧校验为原文子串，此处只需定位一次）。 */
function highlightEvidence(text: string, evidence: string): ReactNode {
  const at = text.indexOf(evidence);
  if (at < 0) return text;
  return <>{text.slice(0, at)}<mark className="rounded bg-sun/40 px-0.5">{text.slice(at, at + evidence.length)}</mark>{text.slice(at + evidence.length)}</>;
}

/** 报告外发（迭代 4）：生成完毕的报告可申请推送到邮箱/Discord，经人工审批后发送。 */
function DeliveryPanel({ report, accounts, onDeliver }: { report: InsightReportView; accounts: ConnectedAccount[]; onDeliver: (id: string, input: { channel: 'email' | 'discord'; email?: string; connectedAccountId?: string; draftKey?: string }) => Promise<boolean>; }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [channel, setChannel] = useState<'email' | 'discord'>('email');
  const [email, setEmail] = useState('');
  const [accountId, setAccountId] = useState('');
  const [draftKey, setDraftKey] = useState('');
  const drafts = reportDrafts(report.template, report.report ?? {});
  if (report.status !== 'generated') return null;
  const delivery = report.delivery;
  const discordAccounts = accounts.filter((account) => account.platform === 'discord' && account.status === 'connected' && account.capabilities.includes('publish'));
  const pending = delivery?.status === 'awaiting_approval' || delivery?.status === 'approved';
  const statusLabel = delivery?.status === 'awaiting_approval' ? 'Awaiting approval' : delivery?.status === 'approved' ? 'Approved — sending' : delivery?.status === 'delivered' ? 'Delivered' : delivery?.status === 'rejected' ? 'Rejected' : 'Delivery failed';
  return <div className="border-b border-ink/15 bg-sky-pale/40 p-6">
    {delivery && <p className="mb-3 text-sm">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${delivery.status === 'delivered' ? 'bg-meadow-light' : delivery.status === 'failed' || delivery.status === 'rejected' ? 'bg-sun/40' : 'bg-sky-pale'}`}>{t(statusLabel)}</span>
      <span className="ml-2 text-xs text-ink-soft">{delivery.channel === 'email' ? t("Email") : t("Discord")} → {delivery.targetLabel}{delivery.deliveredAt ? ` · ${new Date(delivery.deliveredAt).toLocaleString()}` : ''}{delivery.status === 'failed' && delivery.error ? ` · ${delivery.error}` : ''}</span>
    </p>}
    {pending && <p className="text-xs text-ink-soft">{t("Approve or reject this delivery in the Activity tab — nothing is sent automatically.")}</p>}
    {!open && !pending && <button onClick={() => setOpen(true)} className="rounded-md bg-sky-deep px-4 py-2 text-sm font-medium text-white hover:bg-sky">{delivery ? t("Send again…") : t("Send report…")}</button>}
    {open && !pending && <div className="space-y-3">
      <label className="block text-sm">{t("Content to send")}<select aria-label={t("Content to send")} value={draftKey} onChange={e => setDraftKey(e.target.value)} className="ml-2 rounded border p-2"><option value="">{t("Report digest")}</option>{drafts.map(draft => <option key={draft.key} value={draft.key}>{draft.label}</option>)}</select></label>
      {channel === 'email' && <p><strong>{t('Email subject')}</strong>: <span translate="no">{`[Piggybot] ${report.title}`.slice(0, 200)}</span></p>}
      <p>{t('Content language')}: {String(report.report?._language || t('Original language'))}</p>
      {draftKey && <pre translate="no" lang={String(report.report?._language || '') || undefined} className="whitespace-pre-wrap rounded border bg-paper p-3 text-sm">{drafts.find(draft => draft.key === draftKey)?.text}</pre>}
      <div className="flex gap-2">{(['email', 'discord'] as const).map((option) => <button key={option} onClick={() => setChannel(option)} className={`rounded-full px-3 py-1 text-xs font-medium ${channel === option ? "bg-sky-deep text-white" : t("border border-ink/25")}`}>{option === 'email' ? t("Email") : t("Discord")}</button>)}</div>
      {channel === 'email'
        ? <input aria-label={t("Delivery email")} value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="w-full max-w-md rounded-md border border-ink/20 bg-paper p-2 text-sm" placeholder={t("Workspace owner's email (or type another address)")} />
        : discordAccounts.length === 0
          ? <p className="text-xs text-ink-soft">{t("No connected Discord account with posting permission — connect one in the Accounts tab.")}</p>
          : <select aria-label={t("Discord destination")} value={accountId} onChange={(event) => setAccountId(event.target.value)} className="w-full max-w-md rounded-md border border-ink/20 bg-paper p-2 text-sm"><option value="">{t("Pick a Discord account…")}</option>{discordAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select>}
      <div className="flex gap-2">
        <button disabled={submitting || (channel === 'discord' && !accountId) || (channel === 'email' && !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))} onClick={async () => { setSubmitting(true); try { const saved = await onDeliver(report.id, { channel, ...(draftKey ? { draftKey } : {}), ...(channel === 'email' && email.trim() ? { email: email.trim() } : {}), ...(channel === 'discord' ? { connectedAccountId: accountId } : {}) }); if (saved) setOpen(false); } finally { setSubmitting(false); } }} className="rounded-md bg-sunset px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{t("Request approval")}</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-ink/25 px-4 py-2 text-sm">{t("Cancel")}</button>
      </div>
      <p className="text-xs text-ink-soft">{t("Nothing is sent yet — a human approves every outbound delivery in the Activity tab.")}</p>
    </div>}
  </div>;
}

function ImportsSection({ batches, label, setLabel, band, setBand, content, setContent, busy, detail, onPasteImport, onDiscordImport, onCsvFile, onOpenDetail, onCloseDetail, googleConnection, sheetId, setSheetId, sheetName, setSheetName, onConnectGoogle, onDisconnectGoogle, onGoogleImport }: { batches: ImportBatchView[]; label: string; setLabel: (value: string) => void; band: ModelBand; setBand: (band: ModelBand) => void; content: string; setContent: (value: string) => void; busy: boolean; detail: ImportDetailView | null; onPasteImport: () => void; onDiscordImport: (id: string) => void; onCsvFile: (file: File) => void; onOpenDetail: (id: string) => void; onCloseDetail: () => void; googleConnection: { connected: boolean; email?: string; connectedAt?: string } | null; sheetId: string; setSheetId: (value: string) => void; sheetName: string; setSheetName: (value: string) => void; onConnectGoogle: () => void; onDisconnectGoogle: () => void; onGoogleImport: () => void; }) {
  const [discordChannel, setDiscordChannel] = useState('');
  const { w } = useWorkspaceLanguage();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ items: string[]; source: 'paste' | 'csv' } | null>(null);
  const [previewError, setPreviewError] = useState('');
  async function prepare(source: 'paste' | 'csv') {
    setPreviewError('');
    if (!label.trim()) { setPreviewError(w('Give this import a title first.', 'Pon un título a esta importación.', '请先填写导入标题。')); document.getElementById('import-label')?.focus(); return; }
    try {
      if (source === 'csv' && !csvFile) throw new Error('file');
      const text = source === 'paste' ? content : await csvFile!.text();
      setPreview({ items: previewImport(text, source), source });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const errors: Record<string, string> = {
        size: w('Use a file under 2 MiB.', 'Usa un archivo de menos de 2 MiB.', '请使用小于 2 MiB 的文件。'),
        count: w('Use at most 5,000 items.', 'Usa como máximo 5.000 elementos.', '每批最多 5,000 条。'),
        length: w('Each item must be at most 2,000 characters.', 'Cada elemento debe tener como máximo 2.000 caracteres.', '每条最多 2,000 个字符。'),
        quotes: w('Fix the CSV quotation marks and retry.', 'Corrige las comillas del CSV y reintenta.', '请纠正 CSV 引号后重试。'),
        headers: w('Add a text, comment, review or title column.', 'Añade una columna text, comment, review o title.', '请添加 text、comment、review 或 title 列。'),
        file: w('Choose a CSV file first.', 'Elige un archivo CSV.', '请先选择 CSV 文件。'),
        empty: w('Add at least one non-empty item.', 'Añade al menos un elemento con texto.', '请至少添加一条非空内容。'),
      }; setPreviewError(errors[code] || w('The file could not be read.', 'No se pudo leer el archivo.', '无法读取文件。'));
    }
  }
  return <div className="space-y-8">
    {previewError && <p id="import-preview-error" role="alert" className="workspace-error">{previewError}</p>}
    {preview && <WorkspaceDialog title={w('Confirm import','Confirmar importación','确认导入')} onClose={() => setPreview(null)}><p>{label} · {preview.items.length.toLocaleString()} {w('items','elementos','条内容')}</p><p>{w('Classification uses AI credits. The first five items are shown below.', 'La clasificación usa créditos de IA. Se muestran los primeros cinco elementos.', '分类会使用 AI 额度，以下预览前五条内容。')}</p>{preview.items.slice(0,5).map((text,index) => <pre className="approval-snapshot" key={index}>{text}</pre>)}<button className="workspace-primary" disabled={busy} onClick={() => { if (preview.source === 'paste') onPasteImport(); else if (csvFile) onCsvFile(csvFile); setPreview(null); }}>{w('Confirm import','Confirmar importación','确认导入')}</button></WorkspaceDialog>}
    <section className="sketch bg-paper-card p-6 shadow-paint-sm">
      <p className="font-hand text-lg text-sky-deep">{t("Bring your own data")}</p>
      <h2 className="font-display text-3xl">{t("Import content for AI tagging")}</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">{t("Paste comments, reviews, or posts — or upload a CSV export (columns like text, author, platform, views, likes). Every AI tag is stored with a verbatim evidence quote from the original text.")}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label={t("Batch label")}><input id="import-label" aria-invalid={!!previewError && !label.trim()} aria-describedby={previewError ? "import-preview-error" : undefined} value={label} onChange={(event) => setLabel(event.target.value)} className="w-full rounded-md border border-ink/20 bg-paper p-3" placeholder={t("October comment export")} maxLength={120} /></Field>
        <Field label={t("AI model band")}><ModelBandPicker value={band} onChange={setBand} /></Field>
      </div>
      <Field label={t("Paste content (one item per line)")}>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} className="min-h-28 w-full rounded-md border border-ink/20 bg-paper p-3" placeholder={'Love this serum — where can I buy it?\nThe new packaging leaks, please fix it\n…'} />
      </Field>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={busy || content.trim().length === 0} onClick={() => void prepare('paste')} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? w('Importing…','Importando…','导入中…') : w('Preview import','Vista previa','预览导入')}</button>
        <label>{w('CSV file','Archivo CSV','CSV 文件')}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { setCsvFile(event.target.files?.[0] ?? null); setPreviewError(''); }} /></label>
        <button disabled={busy || !csvFile} onClick={() => void prepare('csv')}>{w('Preview CSV','Vista previa CSV','预览 CSV')}</button>
        <span className="text-xs text-ink-soft">{t("Up to 5,000 items or 2 MB per batch. Classification runs in the background.")}</span>
      </div>
      <div className="mt-6 border-t border-ink/15 pt-4">
        <Field label={t("Discord channel ID")}><input value={discordChannel} onChange={event => setDiscordChannel(event.target.value)} inputMode="numeric" maxLength={20} className="w-full rounded-md border border-ink/20 bg-paper p-3" /></Field>
        <p className="my-2 text-xs text-ink-soft">{t("Admin-authorized channels only. Scans the latest 500 messages, imports new human text and queues paid AI classification. Bots, attachments and thread history are excluded; this is not continuous sync.")}</p>
        <button disabled={busy || !/^\d{17,20}$/.test(discordChannel.trim()) || !label.trim()} onClick={() => onDiscordImport(discordChannel)} className="rounded-md border border-ink/25 px-5 py-3 disabled:opacity-40">{t("Import Discord messages")}</button>
      </div>
      <div className="mt-6 border-t border-ink/15 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">{t("Google Sheets")}</p>
          {googleConnection?.connected
            ? <p className="text-xs text-ink-soft">{t("Connected as")} {googleConnection.email} · <button onClick={onDisconnectGoogle} className="underline hover:text-ink">{t("Disconnect")}</button></p>
            : <button onClick={onConnectGoogle} className="rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{t("Connect Google account")}</button>}
        </div>
        {googleConnection?.connected && <div className="mt-3 space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("Spreadsheet link or ID")}><input value={sheetId} onChange={event => setSheetId(event.target.value)} maxLength={300} className="w-full rounded-md border border-ink/20 bg-paper p-3" placeholder={t("https://docs.google.com/spreadsheets/d/…")} /></Field>
            <Field label={t("Tab name (optional)")}><input value={sheetName} onChange={event => setSheetName(event.target.value)} maxLength={120} className="w-full rounded-md border border-ink/20 bg-paper p-3" placeholder={t("Sheet1")} /></Field>
          </div>
          <p className="text-xs text-ink-soft">{t("First row must be headers (text, author, platform, views, likes, rating…). Reads up to 5,000 rows once — already-imported rows are skipped, and this is not continuous sync.")}</p>
          <button disabled={busy || !/^[A-Za-z0-9_-]{20,120}$/.test(sheetId.match(/\/d\/([A-Za-z0-9_-]{20,120})/)?.[1] ?? sheetId.trim()) || !label.trim()} onClick={onGoogleImport} className="rounded-md border border-ink/25 px-5 py-3 disabled:opacity-40">{t("Import sheet rows")}</button>
        </div>}
        {!googleConnection?.connected && <p className="mt-2 text-xs text-ink-soft">{t("Authorize read-only access with your Google account, then import rows from any spreadsheet shared with it. The token is stored encrypted and can be revoked at any time.")}</p>}
      </div>
    </section>

    <section>
      <div className="flex items-end justify-between gap-4"><div><p className="font-hand text-lg text-sky-deep">{t("History")}</p><h2 className="font-display text-3xl">{t("Import batches")}</h2></div></div>
      {batches.length === 0 ? <EmptyState title={t("No imports yet")} detail={t("Import a batch above. The AI will tag each item with intent labels and keep the exact evidence quote for every tag.")} /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{batches.map((batch) => <article key={batch.id} className="sketch bg-paper-card p-5 shadow-paint-sm"><div className="flex items-center justify-between gap-3"><StatusBadge status={batch.status} /><span className="text-xs text-ink-soft">{(batch.sourceType || 'unknown').toUpperCase()} · {batch.modelBand}</span></div><h3 className="mt-4 text-lg font-semibold">{batch.label}</h3><p className="mt-1 text-xs text-ink-soft">{batch.itemCount} {t("item")}{batch.itemCount === 1 ? '' : 's'} · {new Date(batch.createdAt).toLocaleString()}</p>{Object.keys(batch.tagDistribution).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{Object.entries(batch.tagDistribution).sort((a, b) => b[1] - a[1]).map(([tag, count]) => <span key={tag} className="rounded-full bg-sky-pale px-2 py-0.5 text-[11px]">{TAG_LABELS[tag] ?? tag} · {count}</span>)}</div>}<button onClick={() => onOpenDetail(batch.id)} className="mt-4 w-full rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{t("View tagged items")}</button></article>)}</div>}
    </section>

    {detail && <WorkspaceDialog title={t("Details")} onClose={onCloseDetail}><div><header className="flex items-start justify-between border-b border-ink/15 p-6"><div><p className="font-hand text-lg text-sky-deep">{detail.batch.itemCount} {t("items ·")} {detail.batch.modelBand}</p><h2 className="font-display text-3xl">{detail.batch.label}</h2></div></header><div className="space-y-4 p-6 md:p-8">
      {detail.items.length === 0 && <p className="text-sm text-ink-soft">{t("No items in this batch.")}</p>}
      {detail.items.map((item) => <article key={item.id} className="rounded-xl border border-ink/15 bg-paper-card p-4"><div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft"><span className="font-semibold uppercase tracking-wide text-sky-deep">{platformLabel(item.platform)}</span>{item.author && <span>· {item.author}</span>}</div><p className="mt-2 text-sm">{item.text}</p>{item.tags.length > 0 && <div className="mt-3 space-y-2">{item.tags.map((tag) => <div key={tag.tag} className="rounded-lg bg-sky-pale/70 p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">{TAG_LABELS[tag.tag] ?? tag.tag}</span><span className="text-[11px] text-ink-soft">{Math.round(tag.confidence * 100)}%</span></div><blockquote className="mt-1 border-l-2 border-sky-deep/40 pl-2 text-xs italic text-ink-soft">“{tag.evidence}”</blockquote></div>)}</div>}</article>)}
    </div></div></WorkspaceDialog>}
  </div>;
}

function AccountsSection({ accounts, connecting, onConnect, onRefresh }: { accounts: ConnectedAccount[]; connecting: string; onConnect: (platform: typeof socialPlatforms[number][0]) => void; onRefresh: () => void; }) {
  return <div className="space-y-8"><section><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-hand text-lg text-sky-deep">{t("White-label connections")}</p><h2 className="font-display text-3xl">{t("Connected Accounts")}</h2><p className="mt-2 max-w-2xl text-sm text-ink-soft">{t("Authorize with the social network, then choose pages, organizations, boards, or phone numbers inside a Piggybot-branded flow.")}</p></div><button onClick={onRefresh} className="rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{t("Sync account health")}</button></div>{accounts.length === 0 ? <EmptyState title={t("No connected accounts")} detail={t("Connect at least one destination before activating a pipeline.")} /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <article key={account.id} className="sketch bg-paper-card p-5"><div className="flex items-start justify-between gap-4"><div><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{platformLabel(account.platform)}</span><h3 className="mt-1 font-semibold">{account.displayName}</h3></div><StatusBadge status={account.status} /></div><p className="mt-4 text-xs text-ink-soft">{account.capabilities.length ? account.capabilities.join(' · ') : t("Capabilities update after the next sync.")}</p></article>)}</div>}</section><section><h3 className="text-lg font-semibold">{t("Add another destination")}</h3><div className="mt-4 flex flex-wrap gap-2">{socialPlatforms.map(([id, label]) => <button key={id} disabled={Boolean(connecting)} onClick={() => onConnect(id)} className="rounded-md border border-ink/30 bg-paper-card px-4 py-2 text-sm font-medium hover:bg-sky-pale disabled:opacity-50">{connecting === id ? t("Opening…") : `Connect ${label}`}</button>)}</div></section></div>;
}

function ActivitySection({ approvals, taskEvents, auditEvents, runId, setRunId, run, onLoadRun, onDecision }: { approvals: ApprovalView[]; taskEvents: TaskEventView[]; auditEvents: AuditEventView[]; runId: string; setRunId: (value: string) => void; run: RunView | null; onLoadRun: () => void; onDecision: (id: string, decision: 'approved' | 'rejected') => Promise<boolean>; }) {
  return <div className="space-y-8"><section><p className="font-hand text-lg text-sky-deep">{t("Human control")}</p><h2 className="font-display text-3xl">{t("Approvals & Activity")}</h2><div className="mt-5 grid gap-6 lg:grid-cols-3"><ApprovalQueue approvals={approvals} onDecision={onDecision} /><Feed title={t("Successful actions")} empty={t("No billable actions yet.")}>{taskEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.actionType}: {event.actionType.startsWith('ai.') ? `${event.aiCredits} credit(s)` : `${event.billableUnits} unit(s)`}</p><p className="mt-1 text-xs text-ink-soft">{event.status} · {new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed><Feed title={t("Audit trail")} empty={t("No audit events yet.")}>{auditEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.eventType}</p><p className="mt-1 text-xs text-ink-soft">{new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed></div></section><section className="rounded-xl border border-ink/20 bg-paper-card p-5"><h3 className="text-lg font-semibold">{t("Find a specific run")}</h3><div className="mt-4 flex flex-col gap-3 md:flex-row"><input aria-label={t("Workflow run UUID")} value={runId} onChange={(event) => setRunId(event.target.value)} className="flex-1 rounded-md border border-ink/20 bg-paper p-3" placeholder={t("Workflow run UUID")} /><button onClick={onLoadRun} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white">{t("Load run")}</button></div>{run && <div className="mt-5 grid gap-3 rounded-lg bg-sky-pale p-4 text-sm md:grid-cols-3"><span>{t("Status:")} <b>{run.status}</b></span><span>{t("Workflow:")} {run.workflowId}</span><span>{t("Created:")} {new Date(run.createdAt).toLocaleString()}</span></div>}</section></div>;
}

function SettingsSection({ me, locked, newPassword, setNewPassword, passwordStatus, onSavePassword, onSignOut, feedbackCategory, setFeedbackCategory, feedbackMessage, setFeedbackMessage, feedbackStatus, onFeedback, referralUrl, referralStatus, onReferral }: { me: MeView | null; locked: boolean; newPassword: string; setNewPassword: (value: string) => void; passwordStatus: string; onSavePassword: () => void; onSignOut: () => void; feedbackCategory: string; setFeedbackCategory: (value: string) => void; feedbackMessage: string; setFeedbackMessage: (value: string) => void; feedbackStatus: string; onFeedback: () => void; referralUrl: string; referralStatus: string; onReferral: () => void; }) {
  return <div className="grid gap-6 lg:grid-cols-2"><section className="sketch bg-paper-card p-5"><h2 className="text-lg font-semibold">{t("Account")}</h2>{me ? <><p className="mt-2 text-sm font-medium">{me.user.email}</p><p className="mt-1 text-sm text-ink-soft">{me.workspace.name} · {me.role} {t("· plan")} {me.plan}</p>{!me.user.passwordSet && <><p className="mt-4 text-sm text-ink-soft">{t("Set a password so you can sign in with your email next time.")}</p><input aria-label={t("New password")} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder={t("New password (8-128 characters)")} autoComplete="new-password" /><button disabled={newPassword.length < 8} onClick={onSavePassword} className="mt-3 rounded-md bg-sky-deep px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{t("Save password")}</button></>}{passwordStatus && <p className="mt-3 text-sm text-sky-deep" role="status">{t(passwordStatus)}</p>}</> : <p className="mt-2 text-sm text-ink-soft">{t("Loading workspace identity…")}</p>}<button onClick={onSignOut} className="mt-4 rounded-md border border-ink/20 px-4 py-2 text-sm font-medium">{t("Sign out")}</button></section><section className="sketch bg-paper-card p-5"><h2 className="text-lg font-semibold">{t("Refer & earn 20%")}</h2><p className="mt-1 text-sm text-ink-soft">{t("Earn account credit after an eligible referral clears its refund window.")}</p><input aria-label={t("Referral link")} readOnly value={referralUrl} className="mt-4 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder={t("Generate your personal referral link")} /><div className="mt-3 flex gap-2"><button disabled={locked} onClick={onReferral} className="rounded-md bg-sunset px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{t("Generate link")}</button>{referralUrl && <button onClick={() => void navigator.clipboard.writeText(referralUrl)} className="rounded-md border border-ink/30 px-4 py-2 text-sm font-medium">{t("Copy")}</button>}</div>{referralStatus && <p className="mt-3 text-sm text-sky-deep">{t(referralStatus)}</p>}</section><section className="sketch bg-paper-card p-5 lg:col-span-2"><h2 className="text-lg font-semibold">{t("Help & support")}</h2><div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]"><select aria-label={t("Support category")} value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value)} className="rounded-md border border-ink/20 bg-paper p-3"><option value="billing">{t("Billing")}</option><option value="bug">{t("Bug")}</option><option value="feature">{t("Feature request")}</option><option value="other">{t("Other")}</option></select><textarea aria-label={t("Support message")} value={feedbackMessage} maxLength={2000} onChange={(event) => setFeedbackMessage(event.target.value)} className="min-h-24 rounded-md border border-ink/20 bg-paper p-3" placeholder={t("How can we help?")} /><button disabled={locked || !feedbackMessage.trim()} onClick={onFeedback} className="h-fit rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{t("Send to support")}</button></div>{feedbackStatus && <p className="mt-3 text-sm text-sky-deep">{t(feedbackStatus)}</p>}</section></div>;
}

function PipelineWizard({ step, draft, setDraft, templates, selectedTemplate, accounts, savedPipeline, readiness, loading, onClose, onStep, onTemplate, onDescription, onToggleAccount, onSave, onTest, onActivate }: { step: WizardStep; draft: PipelineDraft; setDraft: React.Dispatch<React.SetStateAction<PipelineDraft>>; templates: PipelineTemplate[]; selectedTemplate?: PipelineTemplate; accounts: ConnectedAccount[]; savedPipeline: PipelineView | null; readiness: PipelineReadiness | null; loading: boolean; onClose: () => void; onStep: (step: WizardStep) => void; onTemplate: (template: PipelineTemplate) => void; onDescription: () => void; onToggleAccount: (id: string) => void; onSave: () => void; onTest: () => void; onActivate: () => void; }) {
  const steps = ['Starting point', 'Configure', 'Accounts', 'Review', 'Activate'];
  const index = ({ start: 0, configure: 1, accounts: 2, review: 3, saved: 4 } as const)[step];
  return <WorkspaceDialog title={t("Build your pipeline")} onClose={onClose}><div><header className="flex items-start justify-between border-b border-ink/15 p-6"><div><p className="font-hand text-lg text-sky-deep">{t("New automation")}</p><h2 className="font-display text-3xl">{t("Build your pipeline")}</h2></div></header><div className="grid gap-1 border-b border-ink/10 px-6 py-4 sm:grid-cols-5">{steps.map((label, stepIndex) => <div key={label} className={`rounded px-2 py-2 text-xs font-medium ${stepIndex === index ? "bg-sky-deep text-white" : stepIndex < index ? "bg-meadow-light text-ink" : "bg-paper-card text-ink-soft"}`}>{stepIndex + 1}. {label}</div>)}</div><div className="p-6 md:p-8">
    {step === 'start' && <div><h3 className="text-xl font-semibold">{t("How would you like to start?")}</h3><p className="mt-1 text-sm text-ink-soft">{t("Both paths create an editable pipeline draft.")}</p><div className="mt-6 grid gap-4 md:grid-cols-2">{templates.map((template) => <TemplateCard key={template.id} template={template} onClick={() => onTemplate(template)} />)}<button onClick={onDescription} className="sketch border-2 border-dashed border-sky-deep/40 bg-sky-pale p-5 text-left transition hover:-translate-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{t("Custom")}</span><span className="mt-2 block text-lg font-semibold">{t("Describe an announcement")}</span><span className="mt-2 block text-sm text-ink-soft">{t("Turn your announcement brief into posts for approval. Other automation types are not enabled.")}</span></button></div></div>}
    {step === 'configure' && <div className="space-y-5"><div><h3 className="text-xl font-semibold">{t("Configure the outcome")}</h3><p className="mt-1 text-sm text-ink-soft">{t("Name the pipeline and give Piggybot the context it needs.")}</p></div>{draft.sourceType === 'description' && <Field label={t("What should this automation do?")}><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value, brief: event.target.value }))} className="min-h-24 w-full rounded-md border border-ink/20 bg-paper-card p-3" placeholder={t("Example: Turn every product launch brief into LinkedIn and Instagram drafts for approval.")} /></Field>}<Field label={t("Pipeline name")}><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3" placeholder={t("Product launch distribution")} /></Field><Field label={t("Working brief")}><textarea value={draft.brief} onChange={(event) => setDraft((current) => ({ ...current, brief: event.target.value }))} className="min-h-28 w-full rounded-md border border-ink/20 bg-paper-card p-3" /></Field><div className="grid gap-4 md:grid-cols-3"><Field label={t("Tone")}><input value={draft.tone} onChange={(event) => setDraft((current) => ({ ...current, tone: event.target.value }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3" /></Field><Field label={t("Language")}><select value={draft.language} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3"><option value="en">{t("English")}</option><option value="zh">中文</option><option value="es">{t("Español")}</option></select></Field><Field label={t("Approval policy")}><select value={draft.approvalPolicy} onChange={(event) => setDraft((current) => ({ ...current, approvalPolicy: event.target.value as PipelineDraft['approvalPolicy'] }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3"><option value="required">{t("Always require approval")}</option><option value="auto_approve">{t("Assisted approval")}</option></select></Field></div><Field label={t("AI model band")}><ModelBandPicker value={draft.modelBand} onChange={(band) => setDraft((current) => ({ ...current, modelBand: band }))} /></Field><WizardActions back={() => onStep(savedPipeline ? 'saved' : 'start')} next={() => onStep('accounts')} nextDisabled={draft.name.trim().length < 3 || draft.brief.trim().length < 10 || (draft.sourceType === 'description' && draft.description.trim().length < 10)} /></div>}
    {step === 'accounts' && <div><h3 className="text-xl font-semibold">{t("Choose destinations")}</h3><p className="mt-1 text-sm text-ink-soft">{t("Pipelines remain drafts until their selected accounts are connected and healthy.")}</p>{accounts.length === 0 ? <EmptyState title={t("Connect an account first")} detail={t("Close this builder, open Accounts, and connect a destination through the Piggybot-branded flow.")} /> : <div className="mt-6 grid gap-3 md:grid-cols-2">{accounts.map((account) => <label key={account.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${draft.targetAccountIds.includes(account.id) ? "border-sky-deep bg-sky-pale" : "border-ink/15 bg-paper-card"}`}><input type="checkbox" checked={draft.targetAccountIds.includes(account.id)} onChange={() => onToggleAccount(account.id)} /><span><strong className="block">{account.displayName}</strong><small className="text-ink-soft">{platformLabel(account.platform)} · {account.status}</small></span></label>)}</div>}<WizardActions back={() => onStep('configure')} next={() => onStep('review')} nextLabel={draft.targetAccountIds.length ? t("Review pipeline") : t("Save without accounts")} /></div>}
    {step === 'review' && <div><h3 className="text-xl font-semibold">{t("Review the pipeline draft")}</h3><div className="mt-5 grid gap-5 md:grid-cols-2"><div className="rounded-xl bg-paper-card p-5"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{t("Pipeline")}</span><h4 className="mt-2 text-lg font-semibold">{draft.name}</h4><p className="mt-2 text-sm text-ink-soft">{draft.brief}</p><dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-4"><dt>{t("Tone")}</dt><dd className="text-ink-soft">{draft.tone}</dd></div><div className="flex justify-between gap-4"><dt>{t("Approval")}</dt><dd className="text-ink-soft">{draft.approvalPolicy === 'required' ? t("Always required") : t("Assisted")}</dd></div><div className="flex justify-between gap-4"><dt>{t("Model band")}</dt><dd className="text-ink-soft capitalize">{draft.modelBand}</dd></div><div className="flex justify-between gap-4"><dt>{t("Destinations")}</dt><dd className="text-ink-soft">{draft.targetAccountIds.length}</dd></div></dl></div><div className="rounded-xl bg-sky-pale p-5"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{t("Planned steps")}</span><ol className="mt-3 space-y-3">{(selectedTemplate?.steps ?? ['Understand outcome', 'AI prepares work', 'Human review', 'Execute safely']).map((item, stepIndex) => <li key={item} className="flex gap-3 text-sm"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-deep text-xs text-white">{stepIndex + 1}</span>{item}</li>)}</ol></div></div><WizardActions back={() => onStep('accounts')} next={onSave} nextLabel={loading ? t("Saving…") : savedPipeline ? t("Update draft") : t("Save pipeline draft")} nextDisabled={loading} /></div>}
    {step === 'saved' && savedPipeline && <div><h3 className="text-xl font-semibold">{t("Test before activation")}</h3><p className="mt-1 text-sm text-ink-soft">{t("This readiness test performs no external publishing action. Starting queues one announcement run; posts require approval. Recurring schedules are not enabled.")}</p><div className="mt-6 rounded-xl bg-paper-card p-5"><div className="flex items-center justify-between"><div><StatusBadge status={savedPipeline.status} /><h4 className="mt-3 text-lg font-semibold">{savedPipeline.name}</h4></div><button onClick={() => onStep('configure')} className="rounded-md border border-ink/20 px-4 py-2 text-sm">{t("Edit setup")}</button></div>{readiness ? <div className="mt-5 space-y-3">{readiness.checks.map((check) => <div key={check.id} className="flex gap-3 rounded-lg border border-ink/10 bg-paper p-3"><span className={`font-bold ${check.passed ? 'text-meadow-deep' : 'text-sunset'}`}>{check.passed ? '✓' : '!'}</span><div><p className="text-sm font-medium">{check.label}</p><p className="text-xs text-ink-soft">{check.detail}</p></div></div>)}</div> : <p className="mt-5 rounded-lg bg-sky-pale p-4 text-sm">{t("Run the readiness check to validate the brief, destinations, account health, and approval guardrail.")}</p>}</div><div className="mt-6 flex flex-wrap justify-end gap-3"><button onClick={onClose} className="rounded-md border border-ink/20 px-5 py-3 font-medium">{t("Keep as draft")}</button><button disabled={loading} onClick={onTest} className="rounded-md border border-sky-deep px-5 py-3 font-medium text-sky-deep disabled:opacity-50">{loading ? t("Checking…") : t("Test setup")}</button><button disabled={!readiness?.ready || loading} onClick={onActivate} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{t("Start run (approval required)")}</button></div></div>}
  </div></div></WorkspaceDialog>;
}

function TemplateCard({ template, onClick }: { template: PipelineTemplate; onClick: () => void; }) { return <button disabled={!template.available} onClick={onClick} className="wobble-2 sketch bg-paper-card p-5 text-left shadow-paint-sm transition hover:-translate-y-1 hover:bg-sky-pale"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{t("Standard template")}</span><span className="mt-2 block text-lg font-semibold">{t(template.name)}</span><span className="mt-2 block text-sm text-ink-soft">{t(template.description)}</span><span className="mt-4 block text-xs font-medium text-sky-deep">{template.available ? t("Use this template →") : t("Coming soon — not executable yet")}</span></button>; }
function Stat({ label, value, detail }: { label: string; value: string; detail: string; }) { return <div className="sketch bg-paper-card p-5 shadow-paint-sm"><p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p><p className="mt-2 font-display text-3xl">{value}</p><p className="mt-1 text-xs text-ink-soft">{detail}</p></div>; }
function StatusBadge({ status }: { status: string }) { const active = status === 'published' || status === 'connected' || status === 'succeeded' || status === 'classified'; const working = status === 'draft' || status === 'syncing' || status === 'pending' || status === 'classifying'; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${active ? "bg-meadow-light text-meadow-deep" : working ? "bg-sun/35 text-ink" : "bg-sunset/15 text-sunset"}`}>{status === 'published' ? t("Published") : t(status)}</span>; }
function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void; }) { return <div className="mt-5 rounded-xl border-2 border-dashed border-ink/15 bg-paper-card p-8 text-center"><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-lg text-sm text-ink-soft">{detail}</p>{action && onAction && <button onClick={onAction} className="mt-4 rounded-md bg-sky-deep px-5 py-2 text-sm font-medium text-white">{action}</button>}</div>; }
function Feed({ title, empty, children }: { title: string; empty: string; children: ReactNode }) { return <section className="wobble sketch bg-paper-card p-5"><h3 className="text-lg font-semibold">{title}</h3><div className="mt-3">{children || <p className="text-sm text-ink-soft">{empty}</p>}</div></section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>{children}</label>; }
function WizardActions({ back, next, nextLabel = 'Continue', nextDisabled = false }: { back: () => void; next: () => void; nextLabel?: string; nextDisabled?: boolean; }) { return <div className="flex justify-between gap-3 pt-3"><button onClick={back} className="rounded-md border border-ink/20 px-5 py-3 font-medium">{t("Back")}</button><button disabled={nextDisabled} onClick={next} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:opacity-40">{t(nextLabel)}</button></div>; }
function platformLabel(platform: string): string { return socialPlatforms.find(([id]) => id === platform)?.[1] ?? platform.replaceAll('_', ' '); }
