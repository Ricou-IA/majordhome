/**
 * ImportOffreCatalogueModal.jsx — « Importer une offre » sur la fiche d'un fournisseur (org_admin)
 * ============================================================================
 * Demande d'Eric (2026-10-25) : mettre à jour la base d'articles depuis une offre de prix PDF — références nouvelles
 * créées, prix d'achat des existantes mis à jour — avec un écran de validation avant écriture. Écriture par l'écrivain
 * unique supplier_catalog_upsert (edge supplier-offer-import, apply, desactiver_absents = false : les articles absents
 * de l'offre ne bougent pas ; libellé, prix de vente et nature d'une ligne existante non plus). Une ligne créée reçoit
 * son article Majord'home de la base (rattachement franc ou création) ; l'admin peut la rattacher à un article choisi
 * parmi les suggestions (catalog_item_attach, après l'écriture). Un prix connu plus récent que l'offre est décoché.
 * ============================================================================
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Save, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useOffreFournisseurMutations, useOffreRapprochement } from '@hooks/useOffresFournisseur';
import { useCatalogItemMutations } from '@hooks/useCatalogItems';
import { fournisseurDeLOffre, actionCatalogue } from '@/lib/catalogue/offreRapprochement.js';
import { referenceLigne, uniteDepuisOffre } from '@/lib/catalogue/offreFournisseur.js';
import { formatEuro } from '@/lib/utils';
import OffreDepot from '../../../components/offres/OffreDepot';
import OffreEntete from '../../../components/offres/OffreEntete';

const NATURES = [
  { value: 'main', label: 'Équipement' },
  { value: 'accessory', label: 'Accessoire' },
  { value: 'consumable', label: 'Consommable' },
];
const GRILLE = 'grid grid-cols-[auto_minmax(0,1fr)_7.5rem_minmax(0,11rem)_minmax(0,14rem)] gap-2 items-center';

function LigneCatalogue({ ligne, rap, action, etat, onChange }) {
  const candidats = [...(rap?.statut === 'reference_fabricant' ? [{ article: rap.article, raisons: ['même référence fabricant'] }] : []), ...(rap?.suggestions || [])];
  return (
    <div className={`${GRILLE} px-3 py-2 rounded-lg border ${etat.inclus ? 'border-secondary-200 bg-white' : 'border-secondary-100 bg-secondary-50 opacity-60'}`}>
      <input type="checkbox" checked={etat.inclus} onChange={(e) => onChange({ inclus: e.target.checked })} aria-label="Écrire cette ligne" />
      <div className="min-w-0">
        <p className="text-sm text-secondary-900 break-words">{ligne.designation}</p>
        <p className="text-xs text-secondary-400 break-words">
          {[referenceLigne(ligne), ligne.ref_fabricant && ligne.ref_fabricant !== ligne.code ? `réf. ${ligne.ref_fabricant}` : null, ligne.marque, uniteDepuisOffre(ligne.unite)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <select value={etat.nature} disabled={!etat.inclus || action.action !== 'creer'} onChange={(e) => onChange({ nature: e.target.value })}
        className="border border-secondary-300 rounded-lg px-2 py-1 text-xs" title={action.action === 'creer' ? 'Nature de l’article créé' : 'Une ligne existante garde sa nature'}>
        {NATURES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
      </select>
      <div className="text-xs min-w-0">
        {action.action === 'creer' && <span className="text-primary-700 font-medium">Nouvelle référence · {action.nouveau != null ? formatEuro(action.nouveau) : '?'}</span>}
        {action.action === 'maj' && <span className="text-secondary-700">Achat {formatEuro(action.ancien)} → <b>{formatEuro(action.nouveau)}</b></span>}
        {action.action === 'identique' && <span className="text-secondary-400">Inchangé ({formatEuro(action.nouveau)})</span>}
        {action.avertissement && <p className="text-amber-600 flex gap-1 mt-0.5"><AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />{action.avertissement}</p>}
      </div>
      <div className="min-w-0 text-xs">
        {action.action === 'creer' ? (
          <select value={etat.rattacher} disabled={!etat.inclus} onChange={(e) => onChange({ rattacher: e.target.value })}
            className="border border-secondary-300 rounded-lg px-2 py-1 text-xs w-full truncate">
            <option value="">Article : posé par la base (nouveau ou même modèle)</option>
            {candidats.map((c) => <option key={c.article.id} value={c.article.id}>Rattacher à : {c.article.name} — {c.raisons.join(', ') || 'proche'}</option>)}
          </select>
        ) : (
          <span className="text-secondary-500 break-words">{rap?.article ? `Article : ${rap.article.name}` : 'Ligne sans article'}</span>
        )}
      </div>
    </div>
  );
}

export default function ImportOffreCatalogueModal({ supplier, orgId, onClose }) {
  const { appliquer, isApplying } = useOffreFournisseurMutations(orgId);
  const { attach } = useCatalogItemMutations(orgId);
  const [lecture, setLecture] = useState(null);
  const lignes = useMemo(() => lecture?.offre?.lignes || [], [lecture]);
  const { rapprochements, isLoading, error } = useOffreRapprochement(orgId, supplier.id, lignes);
  const [etats, setEtats] = useState([]);
  const [enCours, setEnCours] = useState(false);

  const actions = useMemo(() => (rapprochements
    ? lignes.map((l, i) => actionCatalogue(l, rapprochements[i].produit, lecture?.offre?.date ?? null))
    : null), [rapprochements, lignes, lecture]);

  // choix par défaut une seule fois par offre lue (une relecture du rapprochement ne défait pas les choix)
  const fait = useRef(false);
  useEffect(() => {
    if (!actions || fait.current) return;
    fait.current = true;
    setEtats(actions.map((a, i) => ({
      inclus: a.coche, nature: lignes[i].nature,
      rattacher: rapprochements[i].statut === 'reference_fabricant' ? rapprochements[i].article.id : '',
    })));
  }, [actions, lignes, rapprochements]);

  const nomLu = lecture?.offre?.fournisseur?.nom;
  const autreFournisseur = !!nomLu && !fournisseurDeLOffre(nomLu, [supplier]);
  const bloquee = (lecture?.controle?.alertes || []).some((a) => a.bloquante);
  const choisies = etats.filter((e) => e.inclus).length;

  const valider = async () => {
    setEnCours(true);
    try {
      const rows = etats.map((e, i) => ({ ...e, ligne: lignes[i] })).filter((r) => r.inclus);
      const res = await appliquer(supplier.id, lecture.offre, rows.map((r) => ({ ...r.ligne, nature: r.nature })));
      const r = res.resultat || {};
      toast.success(`Catalogue ${supplier.name} : ${r.inseres ?? 0} référence(s) créée(s), ${r.mis_a_jour ?? 0} prix mis à jour`);
      if (r.articles) toast.info(`Articles Majord’home : ${r.articles.crees ?? 0} créé(s), ${r.articles.rattaches ?? 0} rattaché(s) à un article existant`);
      (res.ecartees || []).forEach((e) => toast.warning(`Non écrit : ${e}`));
      // rattachements choisis à l'écran (après l'écriture : la ligne a maintenant un id)
      const parRef = new Map((res.produits || []).map((p) => [p.reference, p]));
      const echecs = [];
      let rattaches = 0;
      for (const row of rows.filter((x) => x.rattacher)) {
        const p = parRef.get(referenceLigne(row.ligne));
        if (!p) { echecs.push(`${row.ligne.designation} : ligne introuvable après écriture`); continue; }
        if (p.catalog_item_id === row.rattacher) continue;
        try { await attach(p.id, row.rattacher); rattaches += 1; } catch (err) { echecs.push(`${row.ligne.designation} : ${err?.message || 'rattachement refusé'}`); }
      }
      if (rattaches) toast.success(`${rattaches} ligne(s) rattachée(s) à l’article choisi`);
      echecs.forEach((e) => toast.error(e));
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Écriture au catalogue refusée');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col m-4">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-base font-semibold text-secondary-900">Importer une offre de prix · {supplier.name}</h3>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {!lecture ? <OffreDepot orgId={orgId} onLue={(l) => { fait.current = false; setEtats([]); setLecture(l); }} /> : (
            <>
              <OffreEntete lecture={lecture} />
              {autreFournisseur && (
                <p className="flex gap-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  L&apos;offre semble venir de « {nomLu} », pas de « {supplier.name} » : vérifiez avant d&apos;écrire dans ce catalogue.
                </p>
              )}
              {error && <p className="text-sm text-red-600">Rapprochement impossible : {error.message}</p>}
              {lignes.length === 0 ? <p className="text-sm text-secondary-500 py-6 text-center">Aucune ligne d&apos;article à importer.</p>
                : isLoading || !actions || etats.length !== lignes.length ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
              ) : (
                <div className="space-y-1.5">
                  <div className={`${GRILLE} px-3 text-[10px] font-medium uppercase tracking-wider text-secondary-400`}>
                    <span className="w-3.5" /><span>Ligne de l&apos;offre</span><span>Nature</span><span>Prix d&apos;achat</span><span>Article</span>
                  </div>
                  {lignes.map((l, i) => (
                    <LigneCatalogue key={`${l.rang}-${i}`} ligne={l} rap={rapprochements[i]} action={actions[i]} etat={etats[i]}
                      onChange={(patch) => setEtats((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)))} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <p className="text-xs text-secondary-500 max-w-xl">
            Prix d&apos;achat = prix net de l&apos;offre, éco-participation exclue, daté de l&apos;offre. Les articles absents de l&apos;offre ne sont pas touchés ; le libellé, la nature et le prix de vente d&apos;une référence existante non plus.
          </p>
          <div className="flex gap-2">
            {lecture && <button type="button" onClick={() => { setLecture(null); setEtats([]); fait.current = false; }} className="btn-secondary btn-sm">Autre fichier</button>}
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
            {lecture && (
              <button type="button" onClick={valider} disabled={!choisies || enCours || isApplying || bloquee} className="btn-primary btn-sm">
                {(enCours || isApplying) ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                Écrire {choisies} ligne{choisies > 1 ? 's' : ''} au catalogue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
