/**
 * ImportOffreDevisModal.jsx — « Importer une offre fournisseur » dans un devis
 * ============================================================================
 * Demande d'Eric (2026-10-25) : certains devis dépendent du dimensionnement fait par le fournisseur, on ne réécrit
 * pas ses lignes. Le PDF est lu par l'IA (OffreDepot), chaque ligne est rapprochée d'un article (même fournisseur +
 * même référence, sinon même référence fabricant, sinon suggestions) ou proposée en création (org_admin) ; on valide
 * ligne par ligne, puis les lignes partent dans les chapitres selon la nature de l'article (insererLignesOffre).
 * Prix d'achat = prix net de l'offre ; prix de vente = celui de la base article s'il existe, sinon « à chiffrer ».
 * Retour d'Eric (2026-10-25) : « l'offre fournisseur est un prix d'achat, c'est important pour le listing produit ».
 * L'admin qui valide enregistre donc les prix d'achat au catalogue du fournisseur (planCatalogueDevis → edge apply →
 * supplier_catalog_upsert) : références créées, prix mis à jour, ligne nouvelle rattachée à l'article choisi ; la
 * prochaine offre ou le prochain devis retrouvent l'article, son prix d'achat et son prix de vente.
 * ============================================================================
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useSuppliers } from '@hooks/useSuppliers';
import { useOffreFournisseurMutations, useOffreRapprochement } from '@hooks/useOffresFournisseur';
import { useCatalogItemMutations } from '@hooks/useCatalogItems';
import { fournisseurDeLOffre, choixParDefaut, ligneDevisDepuisOffre, planCatalogueDevis } from '@/lib/catalogue/offreRapprochement.js';
import { referenceLigne, uniteDepuisOffre } from '@/lib/catalogue/offreFournisseur.js';
import { formatEuro } from '@/lib/utils';
import OffreDepot from '../offres/OffreDepot';
import OffreEntete from '../offres/OffreEntete';

const NATURES = [
  { value: 'main', label: 'Équipement' },
  { value: 'accessory', label: 'Option' },
  { value: 'consumable', label: 'Consommable' },
  { value: 'stock', label: 'Matériel stocké' },
];
const NATURES_FOURNISSEUR = ['main', 'accessory', 'consumable'];
const RAISON = { meme_reference: 'même référence chez ce fournisseur', reference_fabricant: 'même référence fabricant' };

const encoder = (c) => (c.type === 'article' ? `article:${c.itemId}` : c.type);
const decoder = (v) => (v.startsWith('article:') ? { type: 'article', itemId: v.slice(8) } : { type: v });

function LigneOffre({ ligne, rap, etat, onChange, peutCreer }) {
  const options = [];
  if (rap?.article) options.push({ value: `article:${rap.article.id}`, label: `✓ ${rap.article.name} (${RAISON[rap.statut] || 'reconnu'})` });
  for (const s of rap?.suggestions || []) options.push({ value: `article:${s.article.id}`, label: `≈ ${s.article.name} — ${s.raisons.join(', ') || 'proche'}` });
  if (peutCreer) options.push({ value: 'creer', label: '+ Créer l’article (catalogue du fournisseur)' });
  options.push({ value: 'libre', label: 'Ligne libre, sans article (hors catalogue)' });
  const article = etat.choix.type === 'article'
    ? [rap?.article, ...(rap?.suggestions || []).map((s) => s.article)].find((a) => a?.id === etat.choix.itemId)
    : null;
  const vente = Number(article?.selling_price_ht) || 0;

  return (
    <div className={`grid grid-cols-[auto_minmax(0,1fr)_minmax(0,16rem)_8rem_5.5rem] gap-2 items-center px-3 py-2 rounded-lg border ${etat.inclus ? 'border-secondary-200 bg-white' : 'border-secondary-100 bg-secondary-50 opacity-60'}`}>
      <input type="checkbox" checked={etat.inclus} onChange={(e) => onChange({ inclus: e.target.checked })} aria-label="Importer cette ligne" />
      <div className="min-w-0">
        <p className="text-sm text-secondary-900 break-words">{ligne.designation}</p>
        <p className="text-xs text-secondary-400 break-words">
          {[referenceLigne(ligne), ligne.ref_fabricant && ligne.ref_fabricant !== ligne.code ? `réf. ${ligne.ref_fabricant}` : null, ligne.marque].filter(Boolean).join(' · ')}
          {' · '}{ligne.quantite ?? '?'} {uniteDepuisOffre(ligne.unite)} × {ligne.prix_unitaire_net != null ? formatEuro(ligne.prix_unitaire_net) : '?'} achat
        </p>
      </div>
      <select value={encoder(etat.choix)} disabled={!etat.inclus} onChange={(e) => onChange({ choix: decoder(e.target.value) }, e.target.value)}
        className="border border-secondary-300 rounded-lg px-2 py-1 text-xs w-full truncate">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select value={etat.nature} disabled={!etat.inclus} onChange={(e) => onChange({ nature: e.target.value })}
        className="border border-secondary-300 rounded-lg px-2 py-1 text-xs" title="Décide du chapitre du devis">
        {NATURES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
      </select>
      <span className={`text-xs text-right ${vente > 0 ? 'text-secondary-700' : 'text-amber-600'}`} title="Prix de vente HT de l'article">
        {vente > 0 ? formatEuro(vente) : 'à chiffrer'}
      </span>
    </div>
  );
}

/**
 * @param {{ orgId: string, tva: number, onInsert: (nouvelles: Array<{ line: object, nature: string }>, titreSecours: string) => void, onClose: () => void }} p
 */
export default function ImportOffreDevisModal({ orgId, tva, onInsert, onClose }) {
  const { isOrgAdmin } = useAuth();
  const { suppliers = [] } = useSuppliers(orgId);
  const { appliquer, isApplying, articles } = useOffreFournisseurMutations(orgId);
  const { attach } = useCatalogItemMutations(orgId);
  const [lecture, setLecture] = useState(null);
  const [fournisseurId, setFournisseurId] = useState('');
  const lignes = useMemo(() => lecture?.offre?.lignes || [], [lecture]);
  const { rapprochements, isLoading, error } = useOffreRapprochement(orgId, fournisseurId || null, lignes);
  const [etats, setEtats] = useState([]);
  const [enCours, setEnCours] = useState(false);
  const fournisseur = suppliers.find((s) => s.id === fournisseurId) || null;
  const peutCreer = isOrgAdmin && !!fournisseur;

  const surLecture = (l) => {
    setLecture(l);
    setFournisseurId(fournisseurDeLOffre(l.offre.fournisseur?.nom, suppliers)?.id || '');
  };

  // choix par défaut quand l'offre est lue ou le fournisseur changé (pas à chaque relecture : les choix faits restent) ;
  // les cases décochées le restent
  const cleChoix = useRef('');
  useEffect(() => {
    const cle = `${fournisseurId}|${peutCreer}|${lignes.length}`;
    if (!rapprochements || cleChoix.current === cle) return;
    cleChoix.current = cle;
    setEtats((prev) => rapprochements.map((r, i) => {
      const choix = choixParDefaut(r, { peutCreer });
      return { inclus: prev[i]?.inclus ?? true, choix, nature: (choix.type === 'article' && r.article?.product_kind) || lignes[i].nature };
    }));
  }, [rapprochements, peutCreer, lignes, fournisseurId]);

  const changer = (i, patch, valeur) => setEtats((prev) => prev.map((e, j) => {
    if (j !== i) return e;
    const suivant = { ...e, ...patch };
    if (valeur?.startsWith('article:')) {
      const r = rapprochements[i];
      const a = [r.article, ...r.suggestions.map((s) => s.article)].find((x) => x?.id === patch.choix.itemId);
      if (a?.product_kind) suivant.nature = a.product_kind;
    }
    return suivant;
  }));

  const inclus = etats.filter((e) => e.inclus).length;
  const ecoTotal = lecture?.offre?.eco_total;
  // ce que la validation enregistrera au catalogue du fournisseur (affiché en pied de fenêtre)
  const plan = useMemo(() => (peutCreer && rapprochements && etats.length === lignes.length
    ? planCatalogueDevis(etats.map((e, i) => ({ ...e, ligne: lignes[i], rap: rapprochements[i] })).filter((r) => r.inclus), lecture?.offre?.date ?? null)
    : { aEcrire: [], aRattacher: [], ignorees: [] }), [peutCreer, rapprochements, etats, lignes, lecture]);
  const bloquee = (lecture?.controle?.alertes || []).some((a) => a.bloquante);

  const valider = async () => {
    setEnCours(true);
    try {
      const rows = etats.map((e, i) => ({ ...e, ligne: lignes[i], rap: rapprochements[i] })).filter((r) => r.inclus);
      const produitParRef = new Map();
      const articleParId = new Map();
      for (const r of rows) for (const a of [r.rap?.article, ...(r.rap?.suggestions || []).map((s) => s.article)]) if (a) articleParId.set(a.id, a);
      // 1. prix d'achat de l'offre enregistrés au catalogue du fournisseur (admin) : références créées, prix mis à jour,
      //    puis la ligne nouvelle chez ce fournisseur rattachée à l'article choisi (planCatalogueDevis)
      let rattachees = 0;
      if (peutCreer && plan.aEcrire.length) {
        const res = await appliquer(fournisseurId, lecture.offre, plan.aEcrire.map((e) => ({
          ...e.ligne, nature: NATURES_FOURNISSEUR.includes(e.nature) ? e.nature : 'accessory',
        })));
        for (const p of res.produits || []) produitParRef.set(p.reference, p);
        (res.ecartees || []).forEach((e) => toast.warning(`Non enregistré au catalogue : ${e}`));
        for (const { reference, itemId } of plan.aRattacher) {
          const p = produitParRef.get(reference);
          if (!p || p.catalog_item_id === itemId) continue;
          try {
            await attach(p.id, itemId);
            produitParRef.set(reference, { ...p, catalog_item_id: itemId });
            rattachees += 1;
          } catch (err) { toast.error(`${reference} : rattachement à l'article refusé (${err?.message || 'erreur'})`); }
        }
        const ids = [...new Set([...produitParRef.values()].map((p) => p.catalog_item_id).filter((id) => id && !articleParId.has(id)))];
        for (const a of await articles(ids)) articleParId.set(a.id, a);
        const r = res.resultat || {};
        toast.info(`Catalogue ${fournisseur.name} : ${r.inseres ?? 0} référence(s) créée(s), ${r.mis_a_jour ?? 0} prix d'achat mis à jour${rattachees ? `, ${rattachees} rattachée(s) à l'article choisi` : ''}`);
      }
      // 2. lignes du devis : prix d'achat de l'offre, prix de vente de l'article
      let sansArticle = 0;
      const nouvelles = rows.map((r) => {
        let article = null;
        let produit = produitParRef.get(referenceLigne(r.ligne)) || null;
        if (r.choix.type === 'article') {
          article = articleParId.get(r.choix.itemId) || null;
          if (!produit && r.rap?.produit && r.rap.article?.id === r.choix.itemId) produit = r.rap.produit;
        } else if (r.choix.type === 'creer') {
          article = produit?.catalog_item_id ? (articleParId.get(produit.catalog_item_id) || null) : null;
          if (!article) sansArticle += 1;
        } else {
          produit = null;
        }
        return { line: ligneDevisDepuisOffre(r.ligne, { article, produit, fournisseur, tva }), nature: r.nature };
      });
      onInsert(nouvelles, `FOURNITURES ${(fournisseur?.name || lecture.offre.fournisseur?.nom || '').toUpperCase()}`.trim());
      const aChiffrer = nouvelles.filter((n) => !(n.line.unit_price_ht > 0)).length;
      toast.success(`${nouvelles.length} ligne${nouvelles.length > 1 ? 's' : ''} ajoutée${nouvelles.length > 1 ? 's' : ''} au devis`);
      if (sansArticle) toast.warning(`${sansArticle} ligne${sansArticle > 1 ? 's' : ''} restée${sansArticle > 1 ? 's' : ''} libre${sansArticle > 1 ? 's' : ''} : article non créé`);
      if (aChiffrer) toast.warning(`${aChiffrer} ligne${aChiffrer > 1 ? 's' : ''} sans prix de vente dans la base article : à chiffrer dans le devis`);
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Import de l\'offre refusé');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col m-4">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-base font-semibold text-secondary-900">Importer une offre fournisseur</h3>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {!lecture ? <OffreDepot orgId={orgId} onLue={surLecture} /> : (
            <>
              <OffreEntete lecture={lecture} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="offre-fournisseur" className="text-secondary-700">Fournisseur</label>
                <select id="offre-fournisseur" value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-1 text-sm">
                  <option value="">— non choisi —</option>
                  {suppliers.filter((s) => s.is_active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!fournisseur && <span className="text-xs text-amber-600">Choisissez le fournisseur pour reconnaître ses références{isOrgAdmin ? ' et créer les articles' : ''}.</span>}
              </div>
              {error && <p className="text-sm text-red-600">Rapprochement impossible : {error.message}</p>}
              {lignes.length === 0 ? <p className="text-sm text-secondary-500 py-6 text-center">Aucune ligne d&apos;article à importer.</p>
                : isLoading || !rapprochements || etats.length !== lignes.length ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,16rem)_8rem_5.5rem] gap-2 px-3 text-[10px] font-medium uppercase tracking-wider text-secondary-400">
                    <span className="w-3.5" /><span>Ligne de l&apos;offre</span><span>Article</span><span>Chapitre</span><span className="text-right">Vente HT</span>
                  </div>
                  {lignes.map((l, i) => (
                    <LigneOffre key={`${l.rang}-${i}`} ligne={l} rap={rapprochements[i]} etat={etats[i]} peutCreer={peutCreer} onChange={(patch, v) => changer(i, patch, v)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <p className="text-xs text-secondary-500 max-w-xl">
            {lecture ? <>
              Prix d&apos;achat = prix net de l&apos;offre{ecoTotal ? ` (éco-participations en sus : ${formatEuro(ecoTotal)} HT, hors marge)` : ''} ; prix de vente = celui de la base article.{' '}
              {peutCreer
                ? `${plan.aEcrire.length} prix d'achat seront enregistrés au catalogue ${fournisseur.name}${plan.ignorees.length ? ` (${plan.ignorees.length} non : ligne libre, prix inchangé ou plus récent)` : ''}.`
                : 'Les prix d’achat ne sont pas enregistrés au catalogue (fournisseur à choisir, réservé à l’administrateur).'}
            </> : 'Formats acceptés : PDF, 8 Mo maximum.'}
          </p>
          <div className="flex gap-2">
            {lecture && <button type="button" onClick={() => { setLecture(null); setEtats([]); cleChoix.current = ''; }} className="btn-secondary btn-sm">Autre fichier</button>}
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
            {lecture && (
              <button type="button" onClick={valider} disabled={!inclus || enCours || isApplying || bloquee || !rapprochements} className="btn-primary btn-sm">
                {(enCours || isApplying) ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowRight className="w-4 h-4 mr-1" />}
                Ajouter {inclus} ligne{inclus > 1 ? 's' : ''} au devis
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
