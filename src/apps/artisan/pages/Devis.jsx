/**
 * Devis.jsx — page /devis (menu « Devis »)
 * ============================================================================
 * Les devis faits dans Majord'home, tous statuts : recherche, pastilles de statut, ouverture
 * dans l'application (DevisModal : aperçu, statut, PDF, « Modifier » d'un brouillon).
 * « Nouveau devis » = fiche client courte puis éditeur (NouveauDevisRapideModal), aussi
 * ouvert par le menu « Créer » (`?nouveau=1`).
 * L'ancien explorateur des devis Pennylane jamais rattachés devient l'onglet
 * « Orphelins Pennylane » (administrateur, organisation reliée à Pennylane).
 * Tout l'état de l'écran est dans l'URL : `?onglet=orphelins`, `?statut=`, `?q=`, `?devis=<id>`.
 * Règles de la liste : src/lib/devisListe.js (testé).
 * ============================================================================
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileText, Plus, Search } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useDevisListe } from '@hooks/useDevis';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DataTable } from '@/components/ui/data-table';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import { STATUTS_DEVIS, filtrerDevis, compterDevis, statutDevis } from '@/lib/devisListe';
import DevisModal from '@apps/artisan/components/devis/DevisModal';
import NouveauDevisRapideModal from '@apps/artisan/components/devis/NouveauDevisRapideModal';
import DevisExplorer from './DevisExplorer';

const COLONNES = [
  { cle: 'numero', titre: 'N°', rendu: (d) => <span className="font-medium text-secondary-900">{d.quote_number || '—'}</span> },
  {
    cle: 'client', titre: 'Client', rendu: (d) => (
      <div className="min-w-0">
        <p className="truncate text-secondary-900">{d.client_display_name || 'Client non renseigné'}</p>
        {d.client_city && <p className="truncate text-xs text-secondary-500">{d.client_city}</p>}
      </div>
    ),
  },
  { cle: 'objet', titre: 'Objet', rendu: (d) => <span className="line-clamp-2 text-secondary-700">{d.subject || 'Sans objet'}</span> },
  { cle: 'montant', titre: 'Montant HT', alignement: 'droite', rendu: (d) => (Number(d.total_ht) > 0 ? formatEuro(d.total_ht) : '—') },
  {
    cle: 'statut', titre: 'Statut', rendu: (d) => {
      const s = statutDevis(d.status);
      return <StatusPill tone={s.ton}>{s.label}</StatusPill>;
    },
  },
  { cle: 'date', titre: 'Créé le', rendu: (d) => <span className="whitespace-nowrap text-secondary-600">{formatDateShortFR(d.created_at)}</span> },
];

export default function Devis() {
  const { isOrgAdmin } = useAuth();
  const { can } = useCanAccess();
  const pennylaneActive = usePennylaneEnabled();
  const [params, setParams] = useSearchParams();

  const orphelinsPossibles = isOrgAdmin && pennylaneActive;
  const onglet = params.get('onglet') === 'orphelins' && orphelinsPossibles ? 'orphelins' : 'devis';
  const statut = params.get('statut') || '';
  const q = params.get('q') || '';
  const devisOuvert = params.get('devis');
  const peutCreer = can('devis', 'create') && can('pipeline', 'create');

  const changer = (maj, { remplacer = true } = {}) => {
    const suivant = new URLSearchParams(params);
    for (const [k, v] of Object.entries(maj)) { if (v) suivant.set(k, v); else suivant.delete(k); }
    setParams(suivant, { replace: remplacer });
  };

  // Menu « Créer » → « Nouveau devis » : la page ouvre la fenêtre puis retire le paramètre.
  const [nouveau, setNouveau] = useState(false);
  const demandeNouveau = params.get('nouveau') === '1';
  useEffect(() => {
    if (!demandeNouveau) return;
    if (peutCreer) setNouveau(true);
    const suivant = new URLSearchParams(params);
    suivant.delete('nouveau');
    setParams(suivant, { replace: true });
  }, [demandeNouveau, peutCreer, params, setParams]);

  const { devis, isLoading, error, refetch } = useDevisListe({ enabled: onglet === 'devis' });
  const connue = Array.isArray(devis);
  const compteurs = useMemo(() => compterDevis(devis || [], q), [devis, q]);
  const lignes = useMemo(() => filtrerDevis(devis || [], { statut, q }), [devis, statut, q]);
  const ligneOuverte = devisOuvert && connue ? devis.find((d) => d.id === devisOuvert) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devis"
        subtitle={onglet === 'devis' && connue ? `${devis.length} devis` : undefined}
        actions={[peutCreer && { label: 'Nouveau devis', icon: Plus, variant: 'primary', onClick: () => setNouveau(true) }]}
      />

      {orphelinsPossibles && (
        <SegmentedControl
          label="Onglets de la page Devis"
          value={onglet}
          onChange={(v) => changer({ onglet: v === 'orphelins' ? 'orphelins' : null, statut: null, q: null }, { remplacer: false })}
          options={[{ value: 'devis', label: 'Devis' }, { value: 'orphelins', label: 'Orphelins Pennylane' }]}
        />
      )}

      {onglet === 'orphelins' ? <DevisExplorer embarque /> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" aria-hidden="true" />
              <input
                type="search"
                value={q}
                onChange={(e) => changer({ q: e.target.value })}
                placeholder="Rechercher un numéro, un client, un objet"
                aria-label="Rechercher un devis"
                className="w-full rounded-lg border border-secondary-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <SegmentedControl
              label="Statut des devis"
              value={statut}
              onChange={(v) => changer({ statut: v })}
              options={[
                { value: '', label: 'Tous', count: connue ? compteurs.tous : undefined },
                ...STATUTS_DEVIS.map((s) => ({ value: s.value, label: s.label, count: connue ? compteurs[s.value] : undefined })),
              ]}
            />
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-lg bg-st-alerte-bg p-4 text-st-alerte">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="flex-1 text-sm">Les devis n&apos;ont pas pu être lus : {error?.message || 'erreur inconnue'}</p>
              <button type="button" onClick={() => refetch()} className="shrink-0 text-sm font-medium underline">Réessayer</button>
            </div>
          )}

          {!error && connue && lignes.length === 0 && (
            <EmptyState
              icon={FileText}
              message={devis.length === 0 ? 'Aucun devis fait dans Majord’home pour l’instant' : 'Aucun devis ne correspond'}
              action={devis.length > 0 && (q || statut) ? { label: 'Tout afficher', onClick: () => changer({ q: null, statut: null }) } : undefined}
            />
          )}

          {!error && (!connue || lignes.length > 0) && (
            <DataTable
              libelle="Devis de l'entreprise"
              colonnes={COLONNES}
              lignes={lignes}
              cleLigne={(d) => d.id}
              chargement={!connue && isLoading}
              onLigne={(d) => changer({ devis: d.id }, { remplacer: false })}
              libelleLigne={(d) => `Ouvrir le devis ${d.quote_number || ''} ${d.client_display_name || ''}`.trim()}
            />
          )}
        </>
      )}

      {devisOuvert && (
        <DevisModal
          quoteId={devisOuvert}
          leadId={ligneOuverte?.lead_id || null}
          onClose={() => changer({ devis: null })}
          onStatusChange={() => {}}
        />
      )}

      {nouveau && (
        <NouveauDevisRapideModal onClose={() => setNouveau(false)} onDone={() => refetch()} />
      )}
    </div>
  );
}
