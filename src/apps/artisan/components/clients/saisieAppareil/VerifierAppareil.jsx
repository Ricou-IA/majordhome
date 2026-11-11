/**
 * VerifierAppareil.jsx — « Vérifier » l'appareil saisi : base locale d'abord (fiches du référentiel, articles du
 * catalogue), recherche web sur clic seulement. Rien n'est présélectionné ni rattaché d'office : l'intervenant
 * choisit. Une fiche web validée entre dans la file de contrôle de l'administrateur.
 * Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 4.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, Loader2, Globe, Package, X } from 'lucide-react';
import { useEquipmentModelsForBrand, useArticlesForEquipment, useEquipmentEnrichment } from '@hooks/useEquipmentModels';
import { classerAppareils, classerArticles, messageErreurAppareil, messageBaseLocale } from '@/lib/equipements/saisieAppareil';
import AppareilWebCarte from './AppareilWebCarte';

const LIGNE = 'w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg border border-transparent hover:bg-gray-50 disabled:opacity-50';

/**
 * @param {{ brand: string, model: string, equipmentTypeId?: string|null, typeLabel?: string|null,
 *   champs?: Array<{ key: string, label: string, unit?: string|null, type?: string }>, onChoisir: (modelId: string) => void }} p
 */
export default function VerifierAppareil({ brand, model, equipmentTypeId = null, typeLabel = null, champs = [], onChoisir }) {
  const [ouvert, setOuvert] = useState(false);
  const [web, setWeb] = useState({ etat: 'idle', appareils: [] }); // idle | cherche | resultats
  const { modeles, marqueReconnue, isLoading: chargeModeles, error: erreurModeles } = useEquipmentModelsForBrand(brand, ouvert);
  const { articles, isLoading: chargeArticles, error: erreurArticles } = useArticlesForEquipment(brand, model, ouvert);
  const { searchWeb, createFromWeb, createFromCatalog, isSearching, isCreating } = useEquipmentEnrichment();

  const fiches = useMemo(() => (marqueReconnue ? classerAppareils(modeles, { model, equipmentTypeId }).slice(0, 8) : []), [modeles, marqueReconnue, model, equipmentTypeId]);
  const articlesProches = useMemo(() => classerArticles(articles, { model }).slice(0, 6), [articles, model]);
  const chargement = chargeModeles || chargeArticles;
  // une erreur de lecture ne se dit jamais « rien trouvé » (messageBaseLocale)
  const message = messageBaseLocale({ erreur: erreurModeles || erreurArticles, nbFiches: fiches.length, nbArticles: articlesProches.length, brand, model });

  const fermer = () => { setOuvert(false); setWeb({ etat: 'idle', appareils: [] }); };

  const choisirArticle = async (article) => {
    try {
      const r = await createFromCatalog(article.id);
      onChoisir(r.model_id);
      fermer();
    } catch (err) { toast.error(messageErreurAppareil(err)); }
  };

  const chercherWeb = async () => {
    setWeb({ etat: 'cherche', appareils: [] });
    try {
      const r = await searchWeb({ brand, model, equipmentTypeId, typeLabel, champs });
      setWeb({ etat: 'resultats', appareils: r?.appareils || [] });
    } catch (err) {
      setWeb({ etat: 'idle', appareils: [] });
      toast.error(messageErreurAppareil(err));
    }
  };

  const validerWeb = async (appareil) => {
    try {
      const r = await createFromWeb({ appareil, equipmentTypeId, champs });
      if (r.existante) toast.info('Cet appareil existait déjà dans la base : il y est rattaché.');
      else toast.success('Appareil trouvé : indexation à venir dans la base.');
      (r.avertissements || []).forEach((a) => toast.warning(a));
      onChoisir(r.model_id);
      fermer();
    } catch (err) { toast.error(messageErreurAppareil(err)); }
  };

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)} className="inline-flex items-center gap-1.5 text-sm text-indigo-700 hover:text-indigo-900">
        <Search className="w-4 h-4" />Vérifier l&apos;appareil
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800">Est-ce l&apos;un de ces appareils ?</p>
        <button type="button" onClick={fermer} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Fermer"><X className="w-4 h-4" /></button>
      </div>

      {chargement && <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />Recherche dans la base…</p>}

      {!chargement && fiches.length > 0 && (
        <div>
          <p className="px-1 pb-1 text-[11px] font-medium text-gray-500 uppercase tracking-wide">Appareils connus</p>
          {fiches.map((f) => (
            <button key={f.id} type="button" onClick={() => { onChoisir(f.id); fermer(); }} className={LIGNE}>
              <Package className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-900 truncate">{f.model_name || f.name}</span>
                <span className="block text-xs text-gray-500 truncate">{f.brand} · réf. {f.reference}{f.lifecycle === 'arrete' ? ' · plus vendu' : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!chargement && articlesProches.length > 0 && (
        <div>
          <p className="px-1 pb-1 text-[11px] font-medium text-gray-500 uppercase tracking-wide">Articles du catalogue</p>
          {articlesProches.map((a) => (
            <button key={a.id} type="button" disabled={isCreating} onClick={() => choisirArticle(a)} className={LIGNE}>
              {a.image_url ? <img src={a.image_url} alt="" className="w-8 h-8 object-contain flex-shrink-0" /> : <Package className="w-4 h-4 text-gray-300 flex-shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-900 truncate">{a.name}</span>
                <span className="block text-xs text-gray-500 truncate">{a.brand}{a.code ? ` · ${a.code}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!chargement && message && web.etat === 'idle' && (
        <p className={`text-xs ${erreurModeles || erreurArticles ? 'text-amber-800' : 'text-gray-500'}`}>{message}</p>
      )}

      {web.etat === 'cherche' && (
        <p className="flex items-center gap-2 text-xs text-gray-600"><Loader2 className="w-3.5 h-3.5 animate-spin" />Recherche web : 20 à 60 secondes…</p>
      )}
      {web.etat === 'resultats' && web.appareils.length === 0 && (
        <p className="text-xs text-gray-600">La recherche web n&apos;a rien trouvé : enregistrez l&apos;appareil tel quel, il pourra être rattaché plus tard.</p>
      )}
      {web.etat === 'resultats' && web.appareils.map((a, i) => (
        <AppareilWebCarte key={`${a.model_name}-${i}`} appareil={a} champs={champs} isCreating={isCreating} onValider={validerWeb} />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100">
        {web.etat === 'idle' ? (
          <button type="button" onClick={chercherWeb} disabled={isSearching} className="inline-flex items-center gap-1.5 text-xs text-indigo-700 hover:text-indigo-900 disabled:opacity-50">
            <Globe className="w-3.5 h-3.5" />Rien ne correspond — chercher sur le web
          </button>
        ) : <span />}
        <button type="button" onClick={fermer} className="text-xs text-gray-500 hover:text-gray-700">Aucun de ceux-là</button>
      </div>
    </div>
  );
}
