import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useMailCampaignStats } from '@hooks/useMailCampaignStats';
import { formatDateTimeFR } from '@/lib/utils';
import { CampaignRecipientsDrawer } from './CampaignRecipientsDrawer';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { LignesSquelette } from '@/components/ui/squelette';
import { PERIODES_STATS, statsAffichees } from '@/lib/mailStats';

/**
 * Onglet Stats — KPIs agrégés par campagne mailing.
 * Source : vue Postgres `public.majordhome_mail_campaign_stats`.
 */
export default function StatsTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { stats, isLoading, refetch } = useMailCampaignStats(orgId);
  // Drill-down : { campaignName, mode } | null
  const [drawer, setDrawer] = useState(null);
  // Période et tri (brief UX P2-13), règles pures dans src/lib/mailStats.js.
  const [periode, setPeriode] = useState('tout');
  const [tri, setTri] = useState({ cle: 'dernier', ascendant: false });
  const lignes = statsAffichees(stats || [], { periode, tri });
  const trier = (cle) => setTri((t) => ({ cle, ascendant: t.cle === cle ? !t.ascendant : cle === 'campagne' }));

  if (isLoading) {
    return <div className="card p-5"><LignesSquelette nombre={5} libelle="Chargement des statistiques" /></div>;
  }

  if (!stats.length) {
    return (
      <div className="card p-8 text-center text-secondary-500">
        Aucune campagne envoyée pour l&apos;instant.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Campagnes envoyées depuis"
            value={periode}
            onChange={setPeriode}
            options={PERIODES_STATS.map((p) => ({ value: p.value, label: p.label }))}
          />
          <p className="text-sm text-secondary-500">{lignes.length} campagne{lignes.length > 1 ? 's' : ''}</p>
        </div>
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
              <Th cle="campagne" tri={tri} onTri={trier}>Campagne</Th>
              <Th align="right" cle="envois" tri={tri} onTri={trier}>Envois</Th>
              <Th align="right">Délivrés</Th>
              <Th align="right" cle="ouverts" tri={tri} onTri={trier}>Ouverts</Th>
              <Th align="right" cle="cliques" tri={tri} onTri={trier}>Cliqués</Th>
              <Th align="right">Bounce</Th>
              <Th align="right">Désabos</Th>
              <Th align="right">Spam</Th>
              <Th align="right" cle="dernier" tri={tri} onTri={trier}>Dernier envoi</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100 bg-white">
            {lignes.map((row) => (
              <CampaignRow
                key={`${row.org_id}-${row.campaign_name}`}
                row={row}
                onDrill={(mode) => setDrawer({ campaignName: row.campaign_name, mode })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-secondary-400 px-1">
        Open rate calculé sur les délivrés. Bounce / désabos / spam calculés sur les envois.
        Benchmarks B2C : open &gt;25% excellent · &gt;18% bon · click &gt;2,5% bon · bounce &lt;2% · spam &lt;0,1%.
      </div>

      <CampaignRecipientsDrawer
        orgId={orgId}
        campaignName={drawer?.campaignName}
        mode={drawer?.mode}
        isOpen={!!drawer}
        onClose={() => setDrawer(null)}
      />
    </div>
  );
}

function CampaignRow({ row, onDrill }) {
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
        <Pct value={openRate} count={opened} thresholds={{ good: 25, ok: 18 }} onClick={() => onDrill('opened')} />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={clickRate} count={clicked} thresholds={{ good: 2.5, ok: 1 }} onClick={() => onDrill('clicked')} />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={bounceRate} count={bounced} thresholds={{ good: 1, ok: 2 }} reverse onClick={() => onDrill('bounced')} />
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <Pct value={unsubRate} count={unsubscribed} thresholds={{ good: 0.5, ok: 1 }} reverse onClick={() => onDrill('unsubscribed')} />
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

function Th({ children, align = 'left', cle, tri, onTri }) {
  const triee = cle && tri?.cle === cle;
  return (
    <th
      aria-sort={triee ? (tri.ascendant ? 'ascending' : 'descending') : undefined}
      className={`px-4 py-2.5 text-xs font-semibold text-secondary-500 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {cle ? (
        <button type="button" onClick={() => onTri(cle)} className={`inline-flex items-center gap-1 hover:text-secondary-900 ${triee ? 'text-secondary-900' : ''}`}>
          {children}{triee ? (tri.ascendant ? ' ↑' : ' ↓') : ''}
        </button>
      ) : children}
    </th>
  );
}

function Pct({ value, count, thresholds, reverse = false, onClick }) {
  const colorClass = colorFor(value, thresholds, reverse);
  const inner = (
    <>
      <span className={onClick && count > 0 ? '' : 'text-secondary-700'}>{count.toLocaleString('fr-FR')}</span>{' '}
      <span className={`text-xs font-semibold ${colorClass}`}>({fmtPct(value)})</span>
    </>
  );
  // Cliquable uniquement si un handler est fourni ET qu'il y a au moins 1 destinataire
  // (pas de drawer vide → on ne casse pas la confiance dans le chiffre).
  if (onClick && count > 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Voir le détail des destinataires"
        className="inline-flex items-center rounded px-1 -mx-1 text-primary-700 underline underline-offset-2 hover:bg-secondary-100 transition-colors cursor-pointer"
      >
        {inner}
      </button>
    );
  }
  return <span>{inner}</span>;
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
