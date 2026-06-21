/**
 * InscriptionsTab.jsx - Webshop
 * ============================================================================
 * Sous-onglet « Inscriptions » : inscriptions aux offres (campagnes).
 * Filtre par campagne, detail contact + champs libres (data jsonb), export CSV.
 * Pattern aligne sur OrdersTab (useState/useEffect + service direct, pas React Query).
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Megaphone, RefreshCw, Loader2, Download, ChevronDown, ChevronUp,
  Phone, Mail, MapPin, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { inscriptionsService } from '@services/inscriptions.service';
import { toCsv } from '@lib/csv';

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function InscriptionRow({ insc }) {
  const [expanded, setExpanded] = useState(false);
  const extra = insc.data && typeof insc.data === 'object' ? Object.entries(insc.data) : [];

  return (
    <div className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
      <div
        className="grid grid-cols-12 gap-2 items-center px-4 py-3 cursor-pointer hover:bg-secondary-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="col-span-3">
          <p className="font-medium text-sm text-secondary-900">{insc.first_name} {insc.last_name}</p>
          <p className="text-xs text-secondary-500">{insc.postal_code} {insc.city}</p>
        </div>
        <div className="col-span-4 min-w-0">
          <p className="text-sm text-secondary-700 truncate">{insc.email || insc.phone || '—'}</p>
          {insc.client_id && (
            <p className="text-xs text-emerald-700">Client CRM lié{insc.client_number ? ` (${insc.client_number})` : ''}</p>
          )}
        </div>
        <div className="col-span-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
            {insc.campaign_label || insc.campaign_key}
          </span>
        </div>
        <div className="col-span-1 text-right text-xs text-secondary-500">{formatDate(insc.created_at)}</div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp className="w-4 h-4 text-secondary-400" /> : <ChevronDown className="w-4 h-4 text-secondary-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-secondary-100 bg-secondary-50/50 px-4 py-4 grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">Contact</p>
            {insc.phone && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /><a href={`tel:${insc.phone}`} className="hover:text-primary-600">{insc.phone}</a>
              </p>
            )}
            {insc.email && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /><a href={`mailto:${insc.email}`} className="hover:text-primary-600">{insc.email}</a>
              </p>
            )}
            {insc.address && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />{insc.address}, {insc.postal_code} {insc.city}
              </p>
            )}
            {insc.parrainage_code_used && (
              <p className="text-xs text-secondary-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />Parrainage : {insc.parrainage_code_used}{insc.parrain_id ? ' (parrain trouvé)' : ''}
              </p>
            )}
            <p className="text-xs text-secondary-400">Inscrit le {formatDateTime(insc.created_at)} · source : {insc.source || '—'}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">Détails de l'offre</p>
            {extra.length === 0 ? (
              <p className="text-sm text-secondary-400 italic">Aucun champ supplémentaire</p>
            ) : (
              <dl className="text-sm space-y-0.5">
                {extra.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-secondary-500">{k} :</dt>
                    <dd className="text-secondary-800">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InscriptionsTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('all');

  const load = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    const { data, error } = await inscriptionsService.getInscriptions({ orgId });
    setIsLoading(false);
    if (error) {
      toast.error('Erreur de chargement des inscriptions');
      return;
    }
    setRows(data);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const campaigns = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.campaign_key)) {
        map.set(r.campaign_key, { key: r.campaign_key, label: r.campaign_label || r.campaign_key, count: 0 });
      }
      map.get(r.campaign_key).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => campaignFilter === 'all' || r.campaign_key === campaignFilter),
    [rows, campaignFilter]
  );

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error('Aucune inscription à exporter');
      return;
    }
    const csv = toCsv(filtered, [
      { key: 'campaign_label', label: 'Campagne' },
      { key: 'first_name', label: 'Prénom' },
      { key: 'last_name', label: 'Nom' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Téléphone' },
      { key: 'address', label: 'Adresse' },
      { key: 'postal_code', label: 'CP' },
      { key: 'city', label: 'Ville' },
      { key: 'parrainage_code_used', label: 'Parrainage' },
      { key: 'source', label: 'Source' },
      { key: 'created_at', label: 'Inscrit le' },
      { key: 'data', label: 'Détails' },
    ]);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscriptions-${campaignFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCampaignFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            campaignFilter === 'all'
              ? 'bg-secondary-900 text-white border-secondary-900'
              : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
          }`}
        >
          Toutes ({rows.length})
        </button>
        {campaigns.map((c) => (
          <button
            key={c.key}
            onClick={() => setCampaignFilter(c.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              campaignFilter === c.key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
            }`}
          >
            {c.label} ({c.count})
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            onClick={load}
            className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 text-primary-600 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-secondary-200 rounded-xl">
          <Megaphone className="w-10 h-10 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-600">Aucune inscription</p>
          <p className="text-xs text-secondary-400 mt-1">Les inscriptions aux offres (campagnes) apparaîtront ici.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((insc) => <InscriptionRow key={insc.id} insc={insc} />)}
        </div>
      )}
    </div>
  );
}
