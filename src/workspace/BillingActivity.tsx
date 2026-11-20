import { useWorkspaceLanguage } from './useWorkspaceLanguage';
import { t } from './translate';

export interface TaskEventView {
  id: string; runId: string | null; subjectId?: string | null;
  actionType: string; billableUnits: string; aiCredits: string;
  reservationState?: string; reversalOf?: string | null;
  status: string; createdAt: string; ledgerSource?: string;
  journalKind?: 'reserve' | 'settle' | 'release' | 'refund';
}

export function BillingActivityRow({event}: {event: TaskEventView}) {
  const {w} = useWorkspaceLanguage();
  if (event.ledgerSource === 'cost-v1' && event.journalKind) {
    const labels = {
      reserve: w('Reserved (not a final charge)', 'Reservado (no es un cargo definitivo)', '已预留（非最终扣费）'),
      settle: w('Settled from reservation', 'Liquidado de la reserva', '从预留中结算'),
      release: w('Unused credits released', 'Créditos no utilizados liberados', '未用额度已释放'),
      refund: w('Credits refunded', 'Créditos reembolsados', '额度已退款'),
    };
    return <div className="border-b border-ink/10 py-3 text-sm">
      <p>{labels[event.journalKind]}: {event.aiCredits} credits</p>
      <p className="mt-1 text-xs text-ink-soft">{event.actionType} · {new Date(event.createdAt).toLocaleString()}</p>
      {(event.runId || event.subjectId) && <small>{event.runId || event.subjectId}</small>}
    </div>;
  }
  return <div className="border-b border-ink/10 py-3 text-sm">
    <p>{event.reversalOf ? t('AI credit refund') : event.actionType}: {(event.actionType === 'ai' || event.actionType.startsWith('ai.') || event.actionType.startsWith('credit_refund.')) ? `${event.status === 'reversed' ? '+' : '−'}${event.aiCredits} credit(s)` : `${event.billableUnits} unit(s)`}</p>
    <p className="mt-1 text-xs text-ink-soft">{event.reversalOf ? t('Credits refunded') : event.reservationState ? t(event.reservationState === 'refunded' ? 'Refunded' : event.reservationState === 'reserved' ? 'Reserved' : 'Settled') : event.status} · {new Date(event.createdAt).toLocaleString()}</p>
  </div>;
}
