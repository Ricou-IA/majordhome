import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useMailCampaignStats } from '@hooks/useMailCampaignStats';
import { formatDateTimeFR } from '@/lib/utils';

/**
 * Onglet Stats — KPIs agrégés par campagne mailing.
 * Source : vue Postgres `public.majordhome_mail_campaign_stats`.
 */
export default function StatsTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { stats, isLoading, refetch } = useMailCampaignStats(orgId);

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center text-secondary-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Chargement des stats…
      </div>
    );
  }

  if (!stats.length) {
    return (
      <div className="card p-8 text-center text-secondary-500">
        Aucune campagne envoyée pour l'instant. Lance une campagne depuis l'onglet « Envoi » pour voir les stats arriver ici.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary-500">
          {stats.length} campagne{stats.length > 1 ? 's' : ''} — données rafraîchies toutes les 60s
        </p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100 rounded-md transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Rafraîchir
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-secondary-200">
          <thead className="bg-secondary-50">
            <tr>
              <Th>Campagne</Th>
              <Th align="right">Envois</Th>
              <Th align="right">Délivrés</Th>
              <Th align="right">Ouverts</Th>
              <Th align="right">Cliqués</Th>
              <Th align="right">Bounce</Th>
              <Th align="right">Désabos</Th>
              <Th align="right">Spam</Th>
              <Th align="right">Dernier envoi</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100 bg-white">
            {stats.map((row) => (
              <CampaignRow key={`${row.org_id}-${row.campaign_name}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-secondary-400 px-1">
        Open rate calculé sur les délivrés. Bounce / désabos / spam calculés sur les envois.
        Benchmarks B2C : open &gt;25% excellent · &gt;18% bon · click &gt;2,5% bon · bounce &lt;2% · spam &lt;0,1%.
      </div>
    </div>
  );
}

function CampaignRow({ row }) {
  const sent = row.total_sent || 0;
  const delivered = row.total_delivered || 0;
  const opened = row.total_opened || 0;
  const clicked = row.total_clicked || 0;
  const bounced = row.total_bounced || 0;
  const unsubscribed = row.total_unsubscribed || 0;
  const complained = row.total_complained || 0;

  const deliveryRate = sent ? (delivered / sent) * 100 : 0;
  const openRate = delivered ? (opened / delivered) * 100 : 0;
  const clickRate = delivered ? (clicked / delivered) * 100 : 0;
  const bounceRate = sent ? (bounced / sent) * 100 : 0;
  const unsubRate = delivered ? (unsubscribed / delivered) * 100 : 0;
  const complaintRate = sent ? (complained / sent) * 100 : 0;

  return (
    <tr className="hover:bg-secondary-50 transition-colors">
      <td className="px-4 py-3 text-sm">
        <div className="font-medium text-secondary-900">{row.campaign_name}</div>
      </td>
      <td className="px-4 py-3 text-sm text-right text-secondary-700 tabular-nums">
        {sent.toLocaleString('fr-FR')}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <span className="text-secondary-700">{delivered.toLocaleString('fr-FR')}</span>{' '}
        <span className="text-secondary-400">({fmtPct(deliveryRate)})</span>
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={openRate} count={opened} thresholds={{ good: 25, ok: 18 }} />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={clickRate} count={clicked} thresholds={{ good: 2.5, ok: 1 }} />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={bounceRate} count={bounced} thresholds={{ good: 1, ok: 2 }} reverse />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={unsubRate} count={unsubscribed} thresholds={{ good: 0.5, ok: 1 }} reverse />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={complaintRate} count={complained} thresholds={{ good: 0.1, ok: 0.3 }} reverse />
      </td>
      <td className="px-4 py-3 text-xs text-right text-secondary-500 whitespace-nowrap">
        {row.last_sent_at ? formatDateTimeFR(row.last_sent_at) : '—'}
      </td>
    </tr>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-secondary-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Pct({ value, count, thresholds, reverse = false }) {
  const colorClass = colorFor(value, thresholds, reverse);
  return (
    <span>
      <span className="text-secondary-700">{count.toLocaleString('fr-FR')}</span>{' '}
      <span className={`text-xs font-semibold ${colorClass}`}>({fmtPct(value)})</span>
    </span>
  );
}

function colorFor(value, { good, ok }, reverse) {
  if (reverse) {
    if (value <= good) return 'text-emerald-600';
    if (value <= ok) return 'text-amber-600';
    return 'text-red-600';
  }
  if (value >= good) return 'text-emerald-600';
  if (value >= ok) return 'text-blue-600';
  return 'text-secondary-400';
}

function fmtPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}
