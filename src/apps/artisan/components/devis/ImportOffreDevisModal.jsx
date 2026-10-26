/**
 * ImportOffreDevisModal.jsx — « Importer une offre fournisseur » dans un devis
 * ============================================================================
 * Demande d'Eric (2026-10-25) : certains devis dépendent du dimensionnement fait par le fournisseur, on ne réécrit
 * pas ses lignes. Le PDF est lu par l'IA (OffreDepot) ; chaque ligne est rapprochée d'un article (même fournisseur +
 * même référence, sinon même référence fabricant). Retours d'Eric sur la première version : tout entre au catalogue
 * (pas de choix « catalogue ou non ») et la fenêtre ne présente QUE les nouveaux articles — nature et doublon possible
 * (suggestion) ; les articles reconnus partent directement dans le devis.
 * Prix d'achat = prix net de l'offre, enregistré au catalogue du fournisseur par l'admin (planCatalogueDevis → edge
 * apply → supplier_catalog_upsert : références créées, prix mis à jour, ligne nouvelle rattachée à l'article choisi).
 * Prix de vente = celui de la base article, sinon « à chiffrer ». Les lignes vont dans le chapitre du type de leur
 * nature (insererLignesOffre).
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { X, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCanAccess } from '@hooks/usePermissions';
import { useSuppliers } from '@hooks/useSuppliers';
import { useOffreFournisseurMutations, useOffreRapprochement } from '@hooks/useOffresFournisseur';
import { useCatalogItemMutations } from '@hooks/useCatalogItems';
import { fournisseurDeLOffre, ligneDevisDepuisOffre, planCatalogueDevis } from '@/lib/catalogue/offreRapprochement.js';
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
const GRILLE = 'grid grid-cols-[minmax(0,1fr)_8rem_minmax(0,15rem)_5.5rem] gap-2 items-center';

function NouvelArticle({ ligne, rap, nature, onNature, existant, onExistant }) {
  const suggestions = rap?.suggestions || [];
  return (
    <div className={`${GRILLE} px-3 py-2 rounded-lg border border-secondary-200 bg-white`}>
      <div className="min-w-0">
        <p className="text-sm text-secondary-900 break-words">{ligne.designation}</p>
        <p className="text-xs text-secondary-400 break-words">
          {[referenceLigne(ligne), ligne.ref_fabricant && ligne.ref_fabricant !== ligne.code ? `réf. ${ligne.ref_fabricant}` : null, ligne.marque].filter(Boolean).join(' · ')}
          {' · '}{ligne.quantite ?? '?'} {uniteDepuisOffre(ligne.unite)} × {ligne.prix_unitaire_net != null ? formatEuro(ligne.prix_unitaire_net) : '?'} achat
        </p>
      </div>
      <select value={nature} disabled={!!existant} onChange={(e) => onNature(e.target.value)}
        className="border border-secondary-300 rounded-lg px-2 py-1 text-xs" title="Range la ligne dans le chapitre du devis du même type">
        {NATURES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
      </select>
      {suggestions.length ? (
        <select value={existant} onChange={(e) => onExistant(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-1 text-xs w-full truncate"
          title="Un article proche existe déjà : le choisir évite un doublon">
          <option value="">Nouvel article</option>
          {suggestions.map((s) => <option key={s.article.id} value={s.article.id}>C’est : {s.article.name}</option>)}
        </select>
      ) : <span className="text-xs text-secondary-400">Nouvel article</span>}
      <span className="text-xs text-right text-amber-600" title="Prix de vente à saisir dans le devis">à chiffrer</span>
    </div>
  );
}

/**
 * @param {{ orgId: string, tva: number, onInsert: (nouvelles: Array<{ line: object, nature: string }>, titreSecours: string) => void, onClose: () => void }} p
 */
export default function ImportOffreDevisModal({ orgId, tva, onInsert, onClose }) {
  const { can } = useCanAccess();
  const peutEditerArticles = can('articles', 'edit');
  const { suppliers = [] } = useSuppliers(orgId);
  const { appliquer, isApplying, articles } = useOffreFournisseurMutations(orgId);
  const { attach } = useCatalogItemMutations(orgId);
  const [lecture, setLecture] = useState(null);
  const [fournisseurId, setFournisseurId] = useState('');
  const [natures, setNatures] = useState({}); // index → nature choisie (nouveaux articles)
  const [existants, setExistants] = useState({}); // index → article existant choisi à la place d'un nouvel article
  const [enCours, setEnCours] = useState(false);
  const lignes = useMemo(() => lecture?.offre?.lignes || [], [lecture]);
  const { rapprochements, isLoading, error } = useOffreRapprochement(orgId, fournisseurId || null, lignes);
  const fournisseur = suppliers.find((s) => s.id === fournisseurId) || null;
  const peutEcrire = peutEditerArticles && !!fournisseur;

  const surLecture = (l) => {
    setLecture(l);
    setNatures({});
    setExistants({});
    setFournisseurId(fournisseurDeLOffre(l.offre.fournisseur?.nom, suppliers)?.id || '');
  };

  // Lignes de l'offre avec leur choix : reconnue ⇒ son article ; nouvelle ⇒ l'article proche choisi, sinon création
  // (admin) ou ligne libre. Dérivé à chaque rendu, rien n'est figé dans un état.
  const rows = useMemo(() => {
    if (!rapprochements) return null;
    return lignes.map((ligne, i) => {
      const rap = rapprochements[i];
      if (rap.article) return { i, ligne, rap, reconnue: true, choix: { type: 'article', itemId: rap.article.id }, nature: rap.article.product_kind || ligne.nature };
      const existant = existants[i] ? rap.suggestions.find((s) => s.article.id === existants[i])?.article : null;
      if (existant) return { i, ligne, rap, reconnue: false, choix: { type: 'article', itemId: existant.id }, nature: existant.product_kind || ligne.nature };
      return { i, ligne, rap, reconnue: false, choix: { type: peutEcrire ? 'creer' : 'libre' }, nature: natures[i] ?? ligne.nature };
    });
  }, [rapprochements, lignes, existants, natures, peutEcrire]);
  const reconnues = rows ? rows.filter((r) => r.reconnue) : [];
  const nouvelles = rows ? rows.filter((r) => !r.reconnue) : [];
  const plan = useMemo(() => (peutEcrire && rows ? planCatalogueDevis(rows, lecture?.offre?.date ?? null) : { aEcrire: [], aRattacher: [], ignorees: [] }),
    [peutEcrire, rows, lecture]);
  const bloquee = (lecture?.controle?.alertes || []).some((a) => a.bloquante);
  const ecoTotal = lecture?.offre?.eco_total;

  const valider = async () => {
    setEnCours(true);
    try {
      const produitParRef = new Map();
      const articleParId = new Map();
      for (const r of rows) for (const a of [r.rap?.article, ...(r.rap?.suggestions || []).map((s) => s.article)]) if (a) articleParId.set(a.id, a);
      // 1. prix d'achat de l'offre au catalogue du fournisseur (admin) ; ligne nouvelle rattachée à l'article choisi
      if (peutEcrire && plan.aEcrire.length) {
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
          } catch (err) { toast.error(`${reference} : rattachement à l'article refusé (${err?.message || 'erreur'})`); }
        }
        const ids = [...new Set([...produitParRef.values()].map((p) => p.catalog_item_id).filter((id) => id && !articleParId.has(id)))];
        for (const a of await articles(ids)) articleParId.set(a.id, a);
        const r = res.resultat || {};
        toast.info(`Catalogue ${fournisseur.name} : ${r.inseres ?? 0} article(s) créé(s), ${r.mis_a_jour ?? 0} prix d'achat mis à jour`);
      }
      // 2. lignes du devis : prix d'achat de l'offre, prix de vente de l'article
      let sansArticle = 0;
      const lignesDevis = rows.map((r) => {
        let produit = produitParRef.get(referenceLigne(r.ligne)) || null;
        let article = null;
        if (r.choix.type === 'article') {
          article = articleParId.get(r.choix.itemId) || null;
          if (!produit && r.rap?.produit && r.rap.article?.id === r.choix.itemId) produit = r.rap.produit;
        } else if (r.choix.type === 'creer') {
          article = produit?.catalog_item_id ? (articleParId.get(produit.catalog_item_id) || null) : null;
        } else {
          produit = null;
        }
        if (!article) sansArticle += 1;
        return { line: ligneDevisDepuisOffre(r.ligne, { article, produit, fournisseur, tva }), nature: r.nature };
      });
      onInsert(lignesDevis, `FOURNITURES ${(fournisseur?.name || lecture.offre.fournisseur?.nom || '').toUpperCase()}`.trim());
      const aChiffrer = lignesDevis.filter((n) => !(n.line.unit_price_ht > 0)).length;
      toast.success(`${lignesDevis.length} ligne${lignesDevis.length > 1 ? 's' : ''} ajoutée${lignesDevis.length > 1 ? 's' : ''} au devis`);
      if (sansArticle) toast.warning(`${sansArticle} ligne${sansArticle > 1 ? 's' : ''} sans article (ligne${sansArticle > 1 ? 's' : ''} libre${sansArticle > 1 ? 's' : ''})`);
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col m-4">
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
                <select id="offre-fournisseur" value={fournisseurId} onChange={(e) => { setFournisseurId(e.target.value); setExistants({}); }} className="border border-secondary-300 rounded-lg px-2 py-1 text-sm">
                  <option value="">— non choisi —</option>
                  {suppliers.filter((s) => s.is_active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!fournisseur && <span className="text-xs text-amber-600">Choisissez le fournisseur pour reconnaître ses références et enregistrer ses prix.</span>}
              </div>
              {error && <p className="text-sm text-red-600">Rapprochement impossible : {error.message}</p>}
              {lignes.length === 0 ? <p className="text-sm text-secondary-500 py-6 text-center">Aucune ligne d&apos;article à importer.</p>
                : isLoading || !rows ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
              ) : (
                <>
                  {reconnues.length > 0 && (
                    <details className="text-sm text-secondary-600">
                      <summary className="cursor-pointer flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-primary-600" />
                        {reconnues.length} article{reconnues.length > 1 ? 's' : ''} déjà dans la base, ajouté{reconnues.length > 1 ? 's' : ''} tel{reconnues.length > 1 ? 's' : ''} quel{reconnues.length > 1 ? 's' : ''}
                      </summary>
                      <ul className="mt-1 ml-6 text-xs text-secondary-500 list-disc">
                        {reconnues.map((r) => <li key={r.i}>{r.rap.article.name} · {r.ligne.quantite ?? '?'} × {formatEuro(r.ligne.prix_unitaire_net)} achat</li>)}
                      </ul>
                    </details>
                  )}
                  {nouvelles.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-secondary-800">
                        {nouvelles.length} nouvel{nouvelles.length > 1 ? 's' : ''} article{nouvelles.length > 1 ? 's' : ''}
                        {!peutEditerArticles && <span className="ml-2 text-xs font-normal text-amber-600">ajoutés en lignes libres : la création d&apos;articles est réservée aux responsables</span>}
                      </p>
                      <div className={`${GRILLE} px-3 text-[10px] font-medium uppercase tracking-wider text-secondary-400`}>
                        <span>Ligne de l&apos;offre</span><span>Nature</span><span>Article</span><span className="text-right">Vente HT</span>
                      </div>
                      {nouvelles.map((r) => (
                        <NouvelArticle key={`${r.ligne.rang}-${r.i}`} ligne={r.ligne} rap={r.rap} nature={r.nature}
                          onNature={(v) => setNatures((p) => ({ ...p, [r.i]: v }))}
                          existant={existants[r.i] || ''} onExistant={(v) => setExistants((p) => ({ ...p, [r.i]: v }))} />
                      ))}
                    </div>
                  ) : <p className="text-sm text-secondary-500">Aucun nouvel article : toutes les lignes sont déjà dans la base.</p>}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <p className="text-xs text-secondary-500 max-w-xl">
            {lecture ? <>
              Prix d&apos;achat = prix net de l&apos;offre{ecoTotal ? ` (éco-participations en sus : ${formatEuro(ecoTotal)} HT, hors marge)` : ''} ; prix de vente = celui de la base article.{' '}
              {peutEcrire
                ? `${plan.aEcrire.length} prix d'achat enregistré${plan.aEcrire.length > 1 ? 's' : ''} au catalogue ${fournisseur.name}${plan.ignorees.length ? ` (${plan.ignorees.length} inchangé${plan.ignorees.length > 1 ? 's' : ''} ou plus récent${plan.ignorees.length > 1 ? 's' : ''} au catalogue)` : ''}.`
                : 'Les prix d’achat ne sont pas enregistrés au catalogue (fournisseur à choisir, réservé à l’administrateur).'}
            </> : 'Formats acceptés : PDF, 8 Mo maximum.'}
          </p>
          <div className="flex gap-2">
            {lecture && <button type="button" onClick={() => { setLecture(null); setNatures({}); setExistants({}); }} className="btn-secondary btn-sm">Autre fichier</button>}
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
            {lecture && (
              <button type="button" onClick={valider} disabled={!rows?.length || enCours || isApplying || bloquee} className="btn-primary btn-sm">
                {(enCours || isApplying) ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowRight className="w-4 h-4 mr-1" />}
                Ajouter {lignes.length} ligne{lignes.length > 1 ? 's' : ''} au devis
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
