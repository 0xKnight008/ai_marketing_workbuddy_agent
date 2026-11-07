import {ScheduledTasks} from "../workspace/Feedback";
import { PipelineWorkspace } from '../workspace/PipelineWorkspace';
import { AiBudgetProvider, useAiBudgetFetch } from '../workspace/AiBudget';
import {RunDiagnostics,type RunDetails} from '../workspace/WorkflowRunDetails';
import {ModelChoiceQueue,ExecutionHistory} from '../workspace/ModelControls';
import { SupportWidget } from '../workspace/SupportWidget';
import {TaskWorkspace,TaskPreferences,TaskResults} from '../workspace/TaskWorkspace';
import { audience, AUDIENCES, AUDIENCE_TEMPLATE } from '../../platform/src/contracts/audience';
import { ReferralLedger } from '../components/ReferralLedger';
import { CONNECTION_PLATFORMS, publicationAvailability } from '../../platform/src/zernio/social-platforms';
import { useWorkspaceLanguage } from '../workspace/useWorkspaceLanguage';
import { sectionFromHash, type Section } from '../workspace/routes';
import { t } from '../workspace/translate';
import { WorkspaceShell, WorkspaceDialog } from '../workspace/Shell';
import { WorkspaceLanguage, WorkspaceLanguageSelect } from '../workspace/i18n';
import { ApprovalQueue, ReportLibrary } from '../workspace/Overview';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

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

type TemplateId = 'repurpose' | 'weekly_report' | 'comment_lead';
type ModelBand = 'eco' | 'standard' | 'flagship';

interface PipelineTemplate { id: TemplateId; name: string; description: string; steps: string[]; available: boolean; }
interface PipelineDefinition {
  source: { type: 'template'; templateId: TemplateId } | { type: 'description'; description: string };
  brief: string;
  sourceText?: string;
  goal?: string;
  targetAccountIds: string[];
  approvalPolicy: 'required' | 'auto_approve';
  tone: string;
  language: string;
  modelBand?: ModelBand;
  steps: Array<{ type: string }>;
}
interface PipelineView { id: string; name: string; status: 'draft' | 'published' | 'archived'; version: number; updatedAt: string; definition: PipelineDefinition; lastRunStatus?: string; lastRunId?: string | null; run?: RunView; }
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

interface ConnectedAccount { id: string; externalAccountId: string; displayName: string; platform: string; capabilities: string[]; status: 'connected' | 'expired' | 'disconnected' | 'syncing'; lastSyncedAt?: string; }
interface RunView extends RunDetails { id: string; status: string; workflowId: string; createdAt: string; }
interface ApprovalView { id: string; runId: string | null; requestedAction: { summary?: string; parameters?: { content?: string; subject?: string } }; requestedAt: string; }
interface TaskEventView { id: string; runId: string | null; actionType: string; billableUnits: string; aiCredits: string; reservationState?: string; reversalOf?: string | null; status: string; createdAt: string; }
interface AuditEventView { id: string; runId?: string; eventType: string; createdAt: string; }
interface UsageView { trialConversionAvailable?: boolean; status: string; taskUsed: number; taskQuota: number; aiCreditsUsed: number; aiCreditsAvailable: number; subscriptionStatus: string; plan: string; }
interface MeView {
  user: { email: string; displayName: string; passwordSet: boolean };
  workspace: { id: string; name: string };
  role: string;
  plan: string;
  subscriptionStatus: string;
}
interface SessionResponse { accessToken?: string; expiresAt?: string; }

const fallbackTemplates: PipelineTemplate[] = [
  { id: 'repurpose', name: 'Repurpose and publish', description: 'Turn one brief into channel-ready posts with approval before publishing.', steps: ['Brief', 'AI drafts', 'Review', 'Publish'], available: true },
  { id: 'weekly_report', name: 'Weekly growth report', description: 'Collect performance and prepare an approval-ready weekly summary.', steps: ['Weekly trigger', 'Pull analytics', 'AI summary', 'Review'], available: false },
  { id: 'comment_lead', name: 'Comment-to-lead review', description: 'Classify high-intent comments and hand qualified leads to your team.', steps: ['Watch comments', 'AI classify', 'Review', 'Hand off'], available: false },
];

const ACTIVE_SUBSCRIPTIONS = new Set(['active', 'trialing', 'manual']);

const socialPlatforms = CONNECTION_PLATFORMS;

const MODEL_BAND_OPTIONS: { value: ModelBand; label: string; hint: string }[] = [
  { value: 'eco', label: 'Eco', hint: 'Fast and economical · review credits before running' },
  { value: 'standard', label: 'Standard', hint: 'Balanced quality · review credits before running' },
  { value: 'flagship', label: 'Flagship', hint: 'Advanced reasoning · review credits before running' },
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

export default function PlatformDashboard() { return <WorkspaceLanguage><AiBudgetProvider><PlatformWorkspace /></AiBudgetProvider></WorkspaceLanguage>; }
function PlatformWorkspace() {
  const fetch=useAiBudgetFetch();
  const { w } = useWorkspaceLanguage();
  const [token, setToken] = useState(readSessionAccessToken);
  const [me, setMe] = useState<MeView | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [section, updateSection] = useState<Section>(() => { if (new URLSearchParams(location.search).has('topup_session')) return 'settings'; return sectionFromHash(location.hash); });
  const setSection = (next: Section) => { if(next==='start')setSourceLibrary(false); setInsightDetail(null); updateSection(next); history.pushState(null, '', `#${next}`); };
  useEffect(() => { const restore = () => { updateSection(sectionFromHash(location.hash)); setSourceLibrary(location.hash.startsWith('#imports')); if(location.hash.startsWith('#topics'))setReportTab('topics'); if(location.hash.startsWith('#notifications'))setManagementTab('notifications'); if(location.hash.startsWith('#billing'))setManagementTab('billing'); }; window.addEventListener('popstate', restore); window.addEventListener('hashchange',restore); return () => {window.removeEventListener('popstate', restore);window.removeEventListener('hashchange',restore)}; }, []);
  const [templates, setTemplates] = useState<PipelineTemplate[]>(fallbackTemplates);
  const [pipelines, setPipelines] = useState<PipelineView[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [syncingAccounts,setSyncingAccounts]=useState(false);
  const [accountSyncError,setAccountSyncError]=useState('');
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEventView[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [managementTab,setManagementTab]=useState<'billing'|'account'|'notifications'>(()=>location.hash.startsWith('#notifications')?'notifications':'billing');
  const [sourceLibrary,setSourceLibrary]=useState(()=>location.hash.startsWith('#imports'));
  const [reportTab,setReportTab]=useState<'results'|'topics'|'weekly'>(()=>location.hash.startsWith('#topics')?'topics':'results');
  const [message, setMessage] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [connecting, setConnecting] = useState('');
  const [disconnecting, setDisconnecting] = useState('');
  const [telegram, setTelegram] = useState<{ code: string; expiresAt: string; instructions: string[] } | null>(null);
  useEffect(() => { setTelegram(null); }, [token]);
  const [referralUrl, setReferralUrl] = useState('');
  const [referralStatus, setReferralStatus] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [recoveringCheckout, setRecoveringCheckout] = useState(false);
  const [importBatches, setImportBatches] = useState<ImportBatchView[]>([]);
  const [importLabel, setImportLabel] = useState('');
  const [importBand, setImportBand] = useState<ModelBand>('eco');
  const [importDetail, setImportDetail] = useState<ImportDetailView | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [insights, setInsights] = useState<InsightReportView[]>([]);
  const [insightDetail, setInsightDetail] = useState<InsightReportView | null>(null);
  const [topicData, setTopicData] = useState<TopicListView>({ run: null, topics: [] });
  const [topicBand, setTopicBand] = useState<ModelBand>('eco');
  const [topicDetail, setTopicDetail] = useState<TopicItemListView | null>(null);
  const [topicBusy, setTopicBusy] = useState(false);
  const applyBillingUsage = useCallback((next: UsageView) => {
    setUsage(next);
    setMe((current) => current ? { ...current, plan: next.plan, subscriptionStatus: next.subscriptionStatus } : current);
  }, []);

  const signOut = useCallback(() => {
    clearSessionAccessToken();
    setToken('');
    setMe(null);
    setSessionError('');
    setPipelines([]); setAccounts([]); setApprovals([]); setTaskEvents([]); setAuditEvents([]); setUsage(null);
    setRun(null); setReferralUrl('');
    setWorkspaceError(''); setMessage(''); setInsights([]); setInsightDetail(null); setImportBatches([]); setImportDetail(null); setImportLabel(''); setTopicData({run:null,topics:[]}); setTopicDetail(null);
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
      fetch(`${gatewayUrl}/api/insights`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/topics`, { headers: headers() }),
    ]);
      if (requests.some(response => response.status === 401)) { signOut(); return; }
      if (readSessionAccessToken() !== token) return;
      const [templatesResponse, pipelinesResponse, accountsResponse, approvalsResponse, usageResponse, tasksResponse, auditResponse, importsResponse, insightsResponse, topicsResponse] = requests;
      let existingWork = false;
      if (templatesResponse.ok) setTemplates(await templatesResponse.json() as PipelineTemplate[]);
      if (pipelinesResponse.ok) { const rows = await pipelinesResponse.json() as PipelineView[]; setPipelines(rows); existingWork ||= rows.length > 0; }
      if (accountsResponse.ok) setAccounts(await accountsResponse.json() as ConnectedAccount[]);
      if (approvalsResponse.ok) setApprovals(await approvalsResponse.json() as ApprovalView[]);
      if (usageResponse.ok) {
        const latest = await usageResponse.json() as UsageView;
        setUsage(latest);
        setMe((previous) => previous ? { ...previous, subscriptionStatus: latest.subscriptionStatus, plan: latest.plan } : previous);
      }
      if (tasksResponse.ok) setTaskEvents(await tasksResponse.json() as TaskEventView[]);
      if (auditResponse.ok) setAuditEvents(await auditResponse.json() as AuditEventView[]);
      if (importsResponse.ok) { const rows = await importsResponse.json() as ImportBatchView[]; setImportBatches(rows); existingWork ||= rows.length > 0; }
      if (insightsResponse.ok) {
        const reports = await insightsResponse.json() as InsightReportView[];
        setInsights(reports);
        // Only an empty workspace without an explicit destination gets the first-task chooser.
        if (!reports.length && !existingWork && requests.every(r => r.ok) && !location.hash && !new URLSearchParams(location.search).has('topup_session')) {
          updateSection('start'); history.replaceState(null, '', `${location.pathname}${location.search}#start`);
        }
      }
      if (topicsResponse.ok) {
        // 防御性解析：非预期负载（如旧代理/兜底桩返回数组）不得破坏渲染。
        const data = await topicsResponse.json() as TopicListView;
        if (data && Array.isArray(data.topics)) setTopicData({ run: data.run ?? null, topics: data.topics });
      }
      setWorkspaceError(requests.some((response) => !response.ok) ? 'Some workspace data could not be loaded. Refresh to retry; missing results may be incomplete.' : '');
    } catch {
      setWorkspaceError('Piggybot could not reach the workspace service. Please try again.');
    }
  }, [headers, token, signOut]);

  const refreshAccounts = useCallback(async (sync = false) => {
    if (!token) return;
    if(sync){setSyncingAccounts(true);setAccountSyncError('');}
    try {
      if (sync) {const result=await fetch(`${gatewayUrl}/api/zernio/sync`, { method: 'POST', headers: headers() });if(!result.ok)throw new Error('account_sync_failed');}
      const response = await fetch(`${gatewayUrl}/api/zernio/accounts`, { headers: headers(),cache:'no-store' });
      if(!response.ok)throw new Error('account_sync_failed');
      const rows=await response.json();if(!Array.isArray(rows))throw new Error('account_sync_failed');setAccounts(rows as ConnectedAccount[]);
    }catch{if(sync)setAccountSyncError('account_sync_failed');}
    finally{if(sync)setSyncingAccounts(false);}
  }, [headers, token]);

  async function disconnectSocial(account: ConnectedAccount) {
    if (!window.confirm(`Disconnect ${account.displayName}? New jobs will be blocked. Already submitted or scheduled posts are NOT cancelled; review them in Zernio separately.`)) return;
    setDisconnecting(account.id);
    try {
      const response = await fetch(`${gatewayUrl}/api/zernio/accounts/${encodeURIComponent(account.id)}/disconnect`, { method: 'POST', headers: headers() });
      if (!response.ok) throw new Error(response.status === 403 ? 'Only a workspace owner or admin can disconnect accounts.' : 'Supplier disconnect was not confirmed. Refresh account status and retry; do not assume the provider is unlinked.');
      setMessage('Account disconnected. New jobs cannot use it. Already submitted posts must be managed separately.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Disconnect failed. Refresh account status and retry.');
    } finally {
      await refreshAccounts().catch(() => undefined);
      setDisconnecting('');
    }
  }

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

  async function loadRun() {
    const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: headers() });
    if (!response.ok) { setRun(null); setMessage('Run not found or access is denied.'); return; }
    setRun(await response.json() as RunView);
  }

  useEffect(() => {
    if (!token || !runId || !run || !['pending', 'queued', 'running'].includes(run.status)) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: headers() });
        if (!response.ok || cancelled) return;
        const next = await response.json() as RunView;
        if (cancelled) return;
        setRun(next);
        await loadWorkspace();
      } catch { /* A temporary polling failure can retry on the next interval. */ }
    }, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [token, runId, run?.status, loadWorkspace]);

  async function decideApproval(approvalId: string, decision: 'approved' | 'rejected', reason?:string, expectedVersion?:number): Promise<boolean> {
    try {
      const response = await fetch(`${gatewayUrl}/api/approval-requests/${encodeURIComponent(approvalId)}/${decision}`, { method: 'POST', headers: headers(true), body: JSON.stringify({reason,expectedVersion}) });
      if (!response.ok) { setMessage(w('The decision could not be saved. Refresh and retry.', 'No se pudo guardar la decisión. Actualiza y reintenta.', '决定未能保存，请刷新后重试。')); return false; }
      setApprovals(current => current.filter(item => item.id !== approvalId));
      setMessage(w('Decision saved.', 'Decisión guardada.', '决定已保存。'));
      await loadWorkspace(); return true;
    } catch { setMessage(w('Connection failed. Your decision has not been confirmed.', 'Error de conexión. Tu decisión no se ha confirmado.', '连接失败，尚未确认决定是否保存。')); return false; }
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

  async function createImport(sourceType: 'csv' | 'discord', content: string, label = importLabel) {
    if (new TextEncoder().encode(content).byteLength > 2 * 1024 * 1024) { setMessage('Import content exceeds 2 MiB. Split it into smaller batches.'); return; }
    setMessage('');
    // 后端 label 必填；CSV 和 Discord 导入均在提交前校验标题。
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
      setImportLabel('');
      setMessage(`Import queued (${result.status ?? 'pending'}) — classification is running in the background.`);
      await loadWorkspace();
    } catch {
      setMessage('The import could not reach the workspace service. Please retry.');
    } finally {
      setImportBusy(false);
    }
  }

  async function loadImportDetail(batchId: string) {
    const response = await fetch(`${gatewayUrl}/api/imports/${batchId}`, { headers: headers() });
    if (!response.ok) { setImportDetail(null); setMessage('Import batch not found or access is denied.'); return; }
    setImportDetail(await response.json() as ImportDetailView);
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
    setMessage(w('Delivery queued — approve it in Publish & review to send.','Envío en cola: apruébalo en Publicar y revisar.','发送已排队，请在「发布与审核」批准。'));
    await loadWorkspace(); return true;
    } catch { setMessage('The delivery request could not be created.'); return false; }
  }

  const loadInsightDetail = useCallback(async (reportId: string) => {
    const response = await fetch(`${gatewayUrl}/api/insights/${reportId}`, { headers: headers() });
    if (!response.ok) { setInsightDetail(null); setMessage('Insight report not found or access is denied.'); return; }
    setInsightDetail(await response.json() as InsightReportView);
    const nextHash = `#reports/${encodeURIComponent(reportId)}`;
    if (location.hash !== nextHash) history.pushState(null, '', nextHash);
  }, [headers]);

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
    if (!token || (section !== 'start' || !sourceLibrary) || !importsInFlight) return;
    const timer = window.setInterval(() => void loadWorkspace(), 5_000);
    return () => window.clearInterval(timer);
  }, [token, section, sourceLibrary, importsInFlight, loadWorkspace]);

  // Poll while an insight report is generating; refresh the open detail too.
  const insightsInFlight = insights.some((report) => report.status === 'pending' || report.status === 'generating');
  useEffect(() => {
    if (!token || section !== 'reports' || !insightsInFlight) return;
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
    if (!token || (section !== 'reports' || reportTab !== 'topics') || !topicsInFlight) return;
    const timer = window.setInterval(() => {
      void loadWorkspace();
      if (topicDetail) void loadTopicItems(topicDetail.topic.id);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [token, section, reportTab, topicsInFlight, topicDetail, loadWorkspace, loadTopicItems]);

  if (!token) {
    return <EmailAuthScreen onSession={(session) => {
      storeSessionAccessToken(session);
      setMe(null);
      setToken(session);
    }} />;
  }

  if (!me) return <main className="min-h-screen bg-paper p-10 text-ink"><p role="status">{sessionError || 'Verifying your session…'}</p>{sessionError && <button onClick={() => void loadMe(token).then((valid) => { if (valid) void loadWorkspace(); })} className="m-3 rounded-md border p-3">{t("Retry")}</button>}<button onClick={signOut} className="m-3 rounded-md border p-3">{t("Sign in again")}</button></main>;

  function openSavedReport(id: string) {
    const report = insights.find(item => item.id === id);
    const persona = AUDIENCES.find(p => AUDIENCE_TEMPLATE[p] === report?.template);
    if (persona) { setSection('start'); history.replaceState(null, '', `#start/${persona}/${encodeURIComponent(id)}`); }
    else { setSection('reports'); void loadInsightDetail(id); }
  }

  const locked = !ACTIVE_SUBSCRIPTIONS.has(me.subscriptionStatus) || (usage?.status === 'paused' && !usage?.trialConversionAvailable);
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
    <WorkspaceShell section={section} navigate={setSection} name={me.workspace.name} email={me.user.email} pending={approvals.length} usage={usage} signOut={signOut} support={<SupportWidget token={token} apiBase={gatewayUrl} />}>

      <ModelChoiceQueue token={token} apiBase={gatewayUrl} role={me.role} onChange={() => void loadWorkspace()}/>
      {me.subscriptionStatus==='trialing' && <section className="workspace-card" role="note"><p>{w('Your remaining trial credits are used first. If a model step needs more, continuing starts billing your selected Stripe subscription immediately; the task keeps its model and uses paid credits for the difference. Payment must succeed before paid execution continues.','Primero usamos los créditos de prueba restantes. Si un paso necesita más, continuar inicia de inmediato el cobro de tu suscripción de Stripe elegida; la tarea conserva el modelo y usa créditos de pago para la diferencia. El pago debe completarse antes de continuar.','系统先使用剩余试用额度。如果模型步骤所需额度更高，继续执行将立即启动已选 Stripe 订阅的正式扣费；任务保持原模型，差额使用套餐额度。付款确认成功后才会继续付费执行。')}</p></section>}
      {locked && <section className="mx-auto mt-8 max-w-7xl rounded-xl border-2 border-sunset/50 bg-sunset/10 p-5"><h2 className="text-lg font-semibold">{t("Automation is paused")}</h2><p className="mt-1 text-sm text-ink-soft">{t("Complete your subscription or review your usage limits. A free trial pauses after 7 days or 30 AI credits, whichever comes first.")}</p><div className="mt-4 flex flex-wrap gap-3">{me.role === 'owner' && <button disabled={recoveringCheckout} onClick={() => void recoverCheckout()} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:opacity-50">{recoveringCheckout ? t("Checking Stripe…") : t("Check / resume checkout")}</button>}<a href={`/activate?plan=growth${audience(new URLSearchParams(location.search).get('persona')) ? `&persona=${audience(new URLSearchParams(location.search).get('persona'))}` : ''}`} className="inline-block rounded-md bg-sunset px-5 py-3 font-medium text-white shadow-paint-sm">{t("View plans")}</a></div></section>}

      <div className="workspace-content">
        {section==='start'&&<><div className="workspace-button-row"><button aria-pressed={sourceLibrary} onClick={()=>setSourceLibrary(v=>!v)}>{sourceLibrary?w('Back to current task','Volver a la tarea','返回当前任务'):w('Source library','Biblioteca de fuentes','素材库')}</button></div><div hidden={sourceLibrary}><TaskWorkspace key={me.workspace.id} token={token} apiBase={gatewayUrl} workspaceId={me.workspace.id} role={me.role} canRun={!locked} onFullReport={id=>{setSection('reports');void loadInsightDetail(id)}} onUsageChange={()=>void loadWorkspace()} sourceRevision={importBatches.map(b=>b.id+b.status).join(',')}/></div>{sourceLibrary&&<SourceLibrary batches={importBatches} label={importLabel} setLabel={setImportLabel} band={importBand} setBand={setImportBand} busy={importBusy||locked} detail={importDetail} onDiscordImport={id=>void createImport('discord',id)} onOpenDetail={id=>void loadImportDetail(id)} onCloseDetail={()=>setImportDetail(null)} token={token}/>}</>}

        {section === 'settings'&&<div className="management-tabs" role="tablist" aria-label={w('Settings & usage','Ajustes y consumo','设置与用量')}><button role="tab" aria-selected={managementTab==='billing'} onClick={()=>{setManagementTab('billing');setSection('settings')}}>{w('Plan & usage','Plan y consumo','套餐与用量')}</button><button role="tab" aria-selected={managementTab==='account'} onClick={()=>{setManagementTab('account');setSection('settings')}}>{w('Account & referrals','Cuenta y recomendaciones','账号与推荐')}</button><button role="tab" aria-selected={managementTab==='notifications'} onClick={()=>setManagementTab('notifications')}>{w('Digests & reminders','Resúmenes y recordatorios','摘要与提醒')}</button></div>}
        {(section === 'settings'&&managementTab==='billing') && <BillingDashboard token={token} gatewayUrl={gatewayUrl} onUsage={applyBillingUsage} />}
        {section==='settings'&&managementTab==='notifications'&&<NotificationCenter apiBase={gatewayUrl} accounts={accounts}/>}
        {section==='reports'&&!insightDetail&&<div className="management-tabs" role="tablist" aria-label={w('Report tools','Herramientas de informes','报告工具')}>{(['results','topics','weekly'] as const).map(tab=><button key={tab} role="tab" aria-selected={reportTab===tab} onClick={()=>setReportTab(tab)}>{{results:w('Saved results','Resultados guardados','已保存结果'),topics:w('Topics','Temas','主题'),weekly:w('Weekly review','Revisión semanal','每周复盘')}[tab]}</button>)}</div>}
        {section==='reports'&&reportTab==='weekly'&&<div hidden={Boolean(insightDetail)}><WeeklyInsightReview apiBase={gatewayUrl} onOpenReport={openSavedReport}/><WeeklyHistory apiBase={gatewayUrl} onOpenReport={openSavedReport}/></div>}
        {section==='reports'&&!insightDetail&&reportTab==='topics'&&<TopicsSection token={token} data={topicData} band={topicBand} setBand={setTopicBand} busy={topicBusy||locked} detail={topicDetail} hasClassifiedItems={importBatches.some(batch=>batch.status==='classified')} onStart={()=>void startTopicRun()} onOpenDetail={id=>void loadTopicItems(id)} onCloseDetail={()=>setTopicDetail(null)}/>}
        {section === 'schedules' && <ScheduledTasks token={token} apiBase={gatewayUrl} onReport={openSavedReport}/>}
        {section === 'review' && <ApprovalQueue approvals={approvals} onDecision={decideApproval} token={token} apiBase={gatewayUrl}/>}
        {section === 'reports' && !insightDetail && reportTab==='results' && <><TaskResults token={token} apiBase={gatewayUrl} onOpen={id=>{setSection('start');history.replaceState(null,'',`#start/task/${id}`)}}/><ReportLibrary reports={insights} onOpen={openSavedReport} /></>}
        {section === 'reports' && insightDetail && <section className="workspace-card"><button onClick={() => { setInsightDetail(null); history.pushState(null, '', `#${section}`); }}>{w('Back to reports', 'Volver a informes', '返回报告')}</button><h2 className="mt-4">{insightDetail.title}</h2><DeliveryPanel report={insightDetail} accounts={accounts} onDeliver={(id,input) => deliverInsight(id,input)} /><ExecutionHistory token={token} apiBase={gatewayUrl} kind="report" id={insightDetail.id} requested={insightDetail.modelBand}/><InsightReportBody report={insightDetail} /></section>}
        {workspaceError && <div className="mb-6 rounded-xl border border-sky-deep/20 bg-sky-pale p-4 text-sm text-sky-deep" role="alert">{t(workspaceError)} <button className="ml-3 underline" onClick={() => void loadWorkspace()}>{t('Retry')}</button></div>}
        {message && <div className="mb-6 rounded-xl border border-sky-deep/20 bg-sky-pale p-4 text-sm text-sky-deep" role="status">{t(message)} <button className="ml-3 underline" onClick={() => { setMessage(''); void loadWorkspace(); }}>{t('Retry')}</button></div>}
        {section === 'pipelines' && <><details className="workspace-card" open={location.hash.startsWith('#review')}><summary>{w('Pending approvals','Aprobaciones pendientes','待审核事项')} · {approvals.length}</summary><ApprovalQueue approvals={approvals} onDecision={decideApproval} token={token} apiBase={gatewayUrl}/></details><div className={locked ? "pointer-events-none select-none opacity-40 grayscale" : undefined} aria-disabled={locked} inert={locked}><PipelineWorkspace key={me.workspace.id} token={token} apiBase={gatewayUrl} role={me.role} pipelines={pipelines} accounts={accounts} templates={templates} onChange={loadWorkspace} /></div></>}
        {section === 'accounts' && <><AccountsSection syncing={syncingAccounts} syncError={accountSyncError} accounts={accounts.filter(account => account.status!=='disconnected'&&!['snapchat', 'whatsapp'].includes(account.platform))} connecting={connecting} onConnect={connectSocial} onRefresh={() => void refreshAccounts(true)} disconnecting={disconnecting} onDisconnect={['owner', 'admin'].includes(me?.role ?? '') ? disconnectSocial : undefined} />{telegram && <section className="mt-6 rounded-xl border border-ink/20 p-6"><h3 className="text-lg font-semibold">{t("Connect Telegram")}</h3><p className="my-3">{t("Code:")} <strong>{telegram.code}</strong> {t("· Expires:")} {new Date(telegram.expiresAt).toLocaleString()}</p><ol className="space-y-2">{telegram.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol><p className="mt-4">{t("After the bot confirms, select Sync account health above to verify the connection.")}</p><button onClick={() => setTelegram(null)} className="mt-3 underline">{t("Dismiss code")}</button></section>}</>}
        {section === 'activity' && <ActivitySection approvals={approvals} taskEvents={taskEvents} auditEvents={auditEvents} runId={runId} setRunId={setRunId} run={run} onLoadRun={() => void loadRun()} token={token}/>}
        {section === 'settings' && managementTab==='account' && <SettingsSection me={me} locked={locked} newPassword={newPassword} setNewPassword={setNewPassword} passwordStatus={t(passwordStatus)} onSavePassword={() => void savePassword()} onSignOut={signOut} referralUrl={referralUrl} referralStatus={t(referralStatus)} onReferral={() => void createReferralLink()} />}
        {section==='settings'&&managementTab==='account'&&<TaskPreferences token={token} apiBase={gatewayUrl}/>}
        {section === 'settings' && managementTab==='account' && me && ['owner','admin'].includes(me.role) && <ReferralLedger key={me.workspace.id} gatewayUrl={gatewayUrl} headers={headers} />}
      </div>


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
  const {w}=useWorkspaceLanguage();
  if(report.status==='failed'&&report.error==='ai_input_exceeds_confirmed_limit')return <p role="alert" className="p-6">{w('The complete request exceeds the confirmed budget or context limit. Reduce the source scope or confirm a larger budget before trying again. No provider request was sent for this preflight failure.','La solicitud completa supera el presupuesto o el contexto permitido. Reduce las fuentes o confirma un presupuesto mayor antes de reintentar. Este fallo de comprobación no envió una solicitud al proveedor.','完整请求超出已确认预算或上下文限制。请缩小来源范围，或确认更高预算后重试。本次预检失败未向上游发起请求。')}</p>;
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

function TopicsSection({ token, data, band, setBand, busy, detail, hasClassifiedItems, onStart, onOpenDetail, onCloseDetail }: { token:string; data: TopicListView; band: ModelBand; setBand: (band: ModelBand) => void; busy: boolean; detail: TopicItemListView | null; hasClassifiedItems: boolean; onStart: () => void; onOpenDetail: (id: string) => void; onCloseDetail: () => void; }) {
  const run = data.run;
  const active = run !== null && ['pending', 'proposing', 'assigning'].includes(run.status);
  const runStatusLabel = run?.status === 'pending' ? 'Queued' : run?.status === 'proposing' ? 'Discovering topics' : run?.status === 'assigning' ? 'Assigning items' : run?.status === 'completed' ? 'Completed' : 'Failed';
  return <div className="space-y-8">
    {run?.status==='completed'&&<ExecutionHistory token={token} apiBase={gatewayUrl} kind="topics" id={run.id} requested={run.modelBand}/>}
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

function SourceLibrary({batches,label,setLabel,band,setBand,busy,detail,onDiscordImport,onOpenDetail,onCloseDetail,token}:{batches:ImportBatchView[];label:string;setLabel:(s:string)=>void;band:ModelBand;setBand:(b:ModelBand)=>void;busy:boolean;detail:ImportDetailView|null;onDiscordImport:(s:string)=>void;onOpenDetail:(s:string)=>void;onCloseDetail:()=>void;token:string}){
 const {w}=useWorkspaceLanguage();const [channel,setChannel]=useState('');
 return <section className="workspace-card"><h2>{w('Source library','Biblioteca de fuentes','素材库')}</h2><p>{w('Paste text and CSV are imported from New task. Existing sources stay available for reuse and evidence checks.','Importa texto y CSV desde Nueva tarea. Las fuentes existentes se conservan para reutilizar y verificar evidencias.','文本和 CSV 从新建任务导入；已有素材继续保留，供复用与原文核对。')}</p><details><summary>{w('Import Discord messages','Importar mensajes de Discord','导入 Discord 消息')}</summary><label>{w('Source name','Nombre de fuente','来源名称')}<input value={label} maxLength={120} onChange={e=>setLabel(e.target.value)}/></label><label>{w('Discord channel ID','ID de canal de Discord','Discord 频道 ID')}<input inputMode="numeric" value={channel} onChange={e=>setChannel(e.target.value)}/></label><ModelBandPicker value={band} onChange={setBand}/><button disabled={busy||!label.trim()||!/^\d{17,20}$/.test(channel)} onClick={()=>onDiscordImport(channel)}>{w('Import Discord messages','Importar mensajes de Discord','导入 Discord 消息')}</button></details>{batches.map(batch=><div className="workspace-row" key={batch.id}><div><strong>{batch.label}</strong><small>{t(batch.status)} · {batch.itemCount} {w('items','elementos','条')}</small></div><button onClick={()=>onOpenDetail(batch.id)}>{w('View source','Ver fuente','查看素材')}</button></div>)}{detail&&<WorkspaceDialog title={detail.batch.label} onClose={onCloseDetail}><ExecutionHistory token={token} apiBase={gatewayUrl} kind="import" id={detail.batch.id} requested={detail.batch.modelBand}/>{detail.items.map(item=><article key={item.id}><small>{item.author} · {item.platform}</small><pre translate="no">{item.text}</pre>{item.tags?.map((tag,index)=><blockquote key={index}><strong>{tag.tag}</strong><p translate="no">{tag.evidence}</p></blockquote>)}{item.metrics&&Object.keys(item.metrics).length>0&&<details><summary>{w('Source metrics','Métricas de fuente','来源指标')}</summary><pre>{JSON.stringify(item.metrics,null,2)}</pre></details>}</article>)}</WorkspaceDialog>}</section>;
}

function AccountsSection({ syncing, syncError, accounts, connecting, onConnect, onRefresh, disconnecting, onDisconnect }: { syncing:boolean;syncError:string;accounts: ConnectedAccount[]; connecting: string; onConnect: (platform: typeof socialPlatforms[number][0]) => void; onRefresh: () => void; disconnecting: string; onDisconnect?: (account: ConnectedAccount) => Promise<void>; }) {
  const {w}=useWorkspaceLanguage();const [search,setSearch]=useState('');const [platform,setPlatform]=useState('');const [status,setStatus]=useState('');const [page,setPage]=useState(1);const filtered=accounts.filter(a=>(!search||(a.displayName+' '+a.platform).toLowerCase().includes(search.toLowerCase()))&&(!platform||a.platform===platform)&&(!status||a.status===status));const pages=Math.max(1,Math.ceil(filtered.length/12));const current=Math.min(page,pages);const visible=filtered.slice((current-1)*12,current*12);
  return <div className="space-y-8"><div className="account-filters"><input aria-label={w('Search accounts','Buscar cuentas','搜索账号')} placeholder={w('Search accounts','Buscar cuentas','搜索账号')} value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/><select aria-label={w('Platform','Plataforma','平台')} value={platform} onChange={e=>{setPlatform(e.target.value);setPage(1)}}><option value="">{w('All platforms','Todas las plataformas','所有平台')}</option>{[...new Set(accounts.map(a=>a.platform))].map(p=><option key={p} value={p}>{platformLabel(p)}</option>)}</select><select aria-label={w('Status','Estado','状态')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">{w('All statuses','Todos los estados','所有状态')}</option>{[...new Set(accounts.map(a=>a.status))].map(p=><option key={p} value={p}>{t(p)}</option>)}</select></div><div className="flex justify-between items-center"><span>{filtered.length} {w('accounts','cuentas','个账号')}</span><div className="flex gap-3"><button disabled={current===1} onClick={()=>setPage(current-1)}>{w('Previous','Anterior','上一页')}</button><span>{current} / {pages}</span><button disabled={current===pages} onClick={()=>setPage(current+1)}>{w('Next','Siguiente','下一页')}</button></div></div>
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="font-hand text-lg text-sky-deep">{t("White-label connections")}</p><h2 className="font-display text-3xl">{t("Connected Accounts")}</h2><p className="mt-2 max-w-2xl text-sm text-ink-soft">{t("Authorize with the social network, then choose pages, organizations, boards, or phone numbers inside a Piggybot-branded flow.")}</p></div>
        <button disabled={syncing} aria-busy={syncing} onClick={onRefresh} className="rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{syncing?w("Syncing…","Sincronizando…","同步中…"):t("Sync account health")}</button>
      </div>
      {syncError&&<p role="alert">{w('Sync failed. The previous account list is retained; retry to confirm current connections.','La sincronización falló. Se conserva la lista anterior; reintenta para confirmar las conexiones.','同步失败，保留原账号列表。请重试以确认当前连接状态。')}</p>}
      {filtered.length === 0 ? <EmptyState title={t("No connected accounts")} detail={t("Connect at least one destination before activating a pipeline.")} /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(account => <article key={account.id} className="sketch bg-paper-card p-5">
          <div className="flex items-start justify-between gap-4"><div><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{platformLabel(account.platform)}</span><h3 className="mt-1 font-semibold">{account.displayName}</h3></div><StatusBadge status={account.status} /></div>
          <p className="mt-4 text-xs text-ink-soft">{account.capabilities.length ? account.capabilities.join(' · ') : t("Capabilities update after the next sync.")}</p>
          <p className="mt-2 text-xs text-ink-soft">{t(publicationAvailability(account.platform))}</p>
          {onDisconnect && <button disabled={Boolean(disconnecting) || Boolean(connecting)} onClick={() => void onDisconnect(account)} className="mt-4 rounded-md border border-ink/25 px-3 py-2 text-sm disabled:opacity-50">{disconnecting === account.id ? t("Disconnecting…") : t("Disconnect")}</button>}
        </article>)}
      </div>}
    </section>
    <section><h3 className="text-lg font-semibold">{t("Add another destination")}</h3><div className="mt-4 flex flex-wrap gap-2">{socialPlatforms.map(([id, label]) => <button key={id} disabled={Boolean(connecting) || Boolean(disconnecting)} onClick={() => onConnect(id)} className="rounded-md border border-ink/30 bg-paper-card px-4 py-2 text-sm font-medium hover:bg-sky-pale disabled:opacity-50">{connecting === id ? t("Opening…") : `Connect ${label}`}</button>)}</div></section>
  </div>;
}

function ActivitySection({ approvals, taskEvents, auditEvents, runId, setRunId, run, onLoadRun, token }: { approvals: ApprovalView[]; taskEvents: TaskEventView[]; auditEvents: AuditEventView[]; runId: string; setRunId: (value: string) => void; run: RunView | null; onLoadRun: () => void; token:string; }) {
  return <div className="space-y-8"><section><p className="font-hand text-lg text-sky-deep">{t("Human control")}</p><h2 className="font-display text-3xl">{t("Approvals & Activity")}</h2><p className="mt-2 text-sm text-ink-soft">{t("AI credits are reserved before generation. A reservation does not confirm model success or a provider payment.")}</p><div className="mt-5 grid gap-6 lg:grid-cols-3"><a className="workspace-text-button" href="#review">{t("Review")} ({approvals.length})</a><Feed title={t("AI credit reservations & actions")} empty={t("No billable actions yet.")}>{taskEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.reversalOf?t("AI credit refund"):event.actionType}: {(event.actionType==='ai'||event.actionType.startsWith('ai.')||event.actionType.startsWith('credit_refund.')) ? `${event.status==='reversed'?'+':'−'}${event.aiCredits} credit(s)` : `${event.billableUnits} unit(s)`}</p><p className="mt-1 text-xs text-ink-soft">{event.reversalOf?t('Credits refunded'):event.reservationState?t(event.reservationState==='refunded'?'Refunded':event.reservationState==='reserved'?'Reserved':'Settled'):event.status} · {new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed><Feed title={t("Audit trail")} empty={t("No audit events yet.")}>{auditEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.eventType}</p><p className="mt-1 text-xs text-ink-soft">{new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed></div></section><section className="rounded-xl border border-ink/20 bg-paper-card p-5"><h3 className="text-lg font-semibold">{t("Find a specific run")}</h3><div className="mt-4 flex flex-col gap-3 md:flex-row"><input aria-label={t("Workflow run UUID")} value={runId} onChange={(event) => setRunId(event.target.value)} className="flex-1 rounded-md border border-ink/20 bg-paper p-3" placeholder={t("Workflow run UUID")} /><button onClick={onLoadRun} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white">{t("Load run")}</button></div>{run&&<ExecutionHistory token={token} apiBase={gatewayUrl} kind="workflow" id={run.id} requested={run.modelBand}/>} {run&&<RunDiagnostics run={run}/>} {run && <div className="mt-5 grid gap-3 rounded-lg bg-sky-pale p-4 text-sm md:grid-cols-3"><span>{t("Status:")} <b>{run.status}</b></span><span>{t("Workflow:")} {run.workflowId}</span><span>{t("Created:")} {new Date(run.createdAt).toLocaleString()}</span></div>}</section></div>;
}

function SettingsSection({me,locked,newPassword,setNewPassword,passwordStatus,onSavePassword,onSignOut,referralUrl,referralStatus,onReferral}:{me:MeView|null;locked:boolean;newPassword:string;setNewPassword:(v:string)=>void;passwordStatus:string;onSavePassword:()=>void;onSignOut:()=>void;referralUrl:string;referralStatus:string;onReferral:()=>void}){
 const {w}=useWorkspaceLanguage();const [copyStatus,setCopyStatus]=useState('');const canRefer=!locked&&!!me&&['owner','admin'].includes(me.role);
 return <div className="grid gap-6 lg:grid-cols-2"><section className="workspace-card"><h2>{w('Account & current plan','Cuenta y plan actual','账号与当前套餐')}</h2><p>{me?.user.email}</p><p>{me?.workspace.name} · {me?.role}</p><p>{w('Current plan','Plan actual','当前套餐')}: {me?.plan} · {me?.subscriptionStatus}</p>{me&&!me.user.passwordSet&&<label>{t('New password')}<input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} /><button disabled={newPassword.length<8||newPassword.length>128} onClick={onSavePassword}>{t('Save password')}</button></label>}{passwordStatus&&<p role="status">{passwordStatus}</p>}<button onClick={onSignOut}>{t('Sign out')}</button></section><section className="workspace-card"><h2>{t('Refer & earn 20%')}</h2><p>{t('Earn account credit after an eligible referral clears its refund window.')}</p><label>{t('Referral link')}<input readOnly value={referralUrl} /></label><div className="mt-3 flex gap-3"><button disabled={!canRefer} onClick={onReferral}>{t('Generate link')}</button><button disabled={!referralUrl||!canRefer} onClick={()=>void navigator.clipboard.writeText(referralUrl).then(()=>setCopyStatus(w('Copied','Copiado','已复制'))).catch(()=>setCopyStatus(w('Select the link and copy manually.','Selecciona y copia el enlace.','请选择链接手动复制。')))}>{t('Copy')}</button></div>{!canRefer&&<p>{w('An active owner or admin session is required.','Se requiere sesión activa de propietario o administrador.','需要有效的负责人或管理员会话。')}</p>}{referralStatus&&<p role="status">{referralStatus}</p>}{copyStatus&&<p role="status">{copyStatus}</p>}</section></div>;
}


function StatusBadge({ status }: { status: string }) { const active = status === 'published' || status === 'connected' || status === 'succeeded' || status === 'classified'; const working = status === 'draft' || status === 'syncing' || status === 'pending' || status === 'classifying'; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${active ? "bg-meadow-light text-meadow-deep" : working ? "bg-sun/35 text-ink" : "bg-sunset/15 text-sunset"}`}>{status === 'published' ? t("Published") : t(status)}</span>; }
function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void; }) { return <div className="mt-5 rounded-xl border-2 border-dashed border-ink/15 bg-paper-card p-8 text-center"><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-lg text-sm text-ink-soft">{detail}</p>{action && onAction && <button onClick={onAction} className="mt-4 rounded-md bg-sky-deep px-5 py-2 text-sm font-medium text-white">{action}</button>}</div>; }
function Feed({ title, empty, children }: { title: string; empty: string; children: ReactNode }) { return <section className="wobble sketch bg-paper-card p-5"><h3 className="text-lg font-semibold">{title}</h3><div className="mt-3">{children || <p className="text-sm text-ink-soft">{empty}</p>}</div></section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>{children}</label>; }

function platformLabel(platform: string): string { return socialPlatforms.find(([id]) => id === platform)?.[1] ?? platform.replaceAll('_', ' '); }
