/**
 * ApercuSections.jsx - Import d'articles, blocs de l'aperçu
 * Fournisseurs du fichier (existants, à créer), valeurs à interpréter (nature, catégorie, unité),
 * articles à importer, doublons (repris ou écartés au choix) et lignes écartées. Présentation seule :
 * chaque verdict vient de src/lib/importArticles/.
 */

import { CheckCircle2, Copy, XCircle, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ListeChoix } from '@/components/ui/liste-choix';
import { formatEuro } from '@/lib/utils';
import { NATURES_ARTICLE } from '@/lib/catalogue/natures.js';
import { champArticle } from '@/lib/importArticles/champs';
import { optionsDuChamp } from '@/lib/importArticles/envoi';
import { aImporter } from '@/lib/importArticles/controles';
import { raisonAfficheeArticle } from '@/lib/importArticles/fichierType';
import { Repliable } from '@/apps/artisan/components/clients/import/ListeLignes';
import { CHAMPS_A_INTERPRETER, OPTIONS_VALEURS } from './useParcoursImportArticles';

const LIBELLE_NATURE = Object.fromEntries(NATURES_ARTICLE.map((n) => [n.value, n.label]));

// Choix proposés : la valeur par défaut est une option réelle (la choisir rend la valeur reconnue).
const OPTIONS_PAR_CHAMP = Object.fromEntries(CHAMPS_A_INTERPRETER.map((c) => [c, optionsDuChamp(c, OPTIONS_VALEURS[c])]));

/** Fournisseurs nommés dans le fichier : reconnus, ou à créer (coche « Créer », cochée par défaut). */
export function FournisseursDuFichier({ fournisseurs, enCours, onCreation }) {
  if (!fournisseurs || fournisseurs.length === 0) return null;
  return (
    <Card as="section" aria-labelledby="apercu-fournisseurs">
      <CardHeader
        title={<span id="apercu-fournisseurs">Fournisseurs du fichier</span>}
        subtitle="Un fournisseur à créer et décoché : ses articles sont importés sans ligne fournisseur."
      />
      <ul className="divide-y divide-secondary-100 px-5 pb-4">
        {fournisseurs.map((f) => (
          <li key={f.cle} className="py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <Truck className="w-4 h-4 shrink-0 text-secondary-400" aria-hidden="true" />
              <span className="font-medium text-secondary-900 truncate">« {f.nom} »</span>
              <span className="text-secondary-500" aria-hidden="true">→</span>
              <span className="text-secondary-700 truncate">{f.aCreer ? 'nouveau fournisseur' : `${f.nomExistant} (existant)`}</span>
            </span>
            {f.aCreer && (
              <label className="inline-flex items-center gap-2 text-secondary-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.creer}
                  disabled={enCours}
                  onChange={(e) => onCreation(f.cle, e.target.checked)}
                  className="w-4 h-4 rounded border-secondary-300 text-primary-600"
                />
                Créer
              </label>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Une ligne par valeur distincte du fichier, et la valeur de Majord'home qu'elle devient. */
export function ValeursAInterpreter({ valeurs, enCours, onValeur }) {
  const champs = CHAMPS_A_INTERPRETER.filter((c) => valeurs[c]?.distinctes.length > 0);
  if (champs.length === 0) return null;
  return (
    <Card as="section" aria-labelledby="apercu-valeurs">
      <CardHeader
        title={<span id="apercu-valeurs">Valeurs à interpréter</span>}
        subtitle="Vérifiez ce que devient chaque valeur de votre fichier. Une valeur non reconnue prend la valeur par défaut et se compte « illisible »."
      />
      <div className="px-5 pb-5 space-y-5">
        {champs.map((champ) => (
          <div key={champ}>
            <h3 className="text-sm font-semibold text-secondary-900 mb-2">{champArticle(champ)?.libelle}</h3>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 text-left text-secondary-500">
                  <th scope="col" className="py-1.5 pr-4 font-medium w-1/2">Dans votre fichier</th>
                  <th scope="col" className="py-1.5 font-medium">Dans Majord&apos;home</th>
                </tr>
              </thead>
              <tbody>
                {valeurs[champ].distinctes.map((brute) => {
                  const cible = valeurs[champ].table[brute] || '';
                  const nonReconnue = !cible && !valeurs[champ].explicites.has(brute);
                  return (
                    <tr key={brute} className={`border-b border-secondary-100 ${nonReconnue ? 'bg-st-attente-bg' : ''}`}>
                      <th scope="row" className="py-1.5 pr-4 font-medium text-secondary-900 text-left">
                        {brute}
                        {nonReconnue && <span className="block text-xs font-normal text-st-attente">Non reconnue</span>}
                      </th>
                      <td className="py-1.5">
                        <ListeChoix
                          value={cible}
                          onChange={(v) => onValeur(champ, brute, v)}
                          options={OPTIONS_PAR_CHAMP[champ]}
                          disabled={enCours}
                          libelle={`${champArticle(champ)?.libelle} pour « ${brute} »`}
                          className="w-full min-w-[14rem]"
                          selectClassName="w-full min-w-[14rem]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LigneArticle({ ligne }) {
  const f = ligne.fiche;
  return (
    <span>
      <span className="text-secondary-500">Ligne {ligne.numero} · </span>
      <span className="font-medium text-secondary-900">{f?.name || '(sans désignation)'}</span>
      {f?.brand && <span className="text-secondary-600"> · {f.brand}</span>}
    </span>
  );
}

/** Échantillon des articles tels qu'ils seront écrits, pour vérifier avant d'importer. */
export function ListePretes({ lignes }) {
  return (
    <Repliable titre="À importer" icone={CheckCircle2} compte={lignes.length} limiteFixe={20} ouvert>
      {(n) => (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th scope="col" className="py-1.5 pr-3 font-medium">Ligne</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Désignation</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Marque</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Nature</th>
                <th scope="col" className="py-1.5 pr-3 font-medium text-right">Prix de vente HT</th>
                <th scope="col" className="py-1.5 font-medium">Fournisseur</th>
              </tr>
            </thead>
            <tbody>
              {lignes.slice(0, n).map((l) => (
                <tr key={l.numero} className="border-b border-secondary-100">
                  <td className="py-1.5 pr-3 text-secondary-500">{l.numero}</td>
                  <td className="py-1.5 pr-3 text-secondary-900">{l.fiche.name}</td>
                  <td className="py-1.5 pr-3 text-secondary-700">{l.fiche.brand || ''}</td>
                  <td className="py-1.5 pr-3 text-secondary-700">{LIBELLE_NATURE[l.fiche.product_kind] || l.fiche.product_kind}</td>
                  <td className="py-1.5 pr-3 text-secondary-700 text-right">{l.fiche.selling_price_ht > 0 ? formatEuro(l.fiche.selling_price_ht) : 'à renseigner'}</td>
                  <td className="py-1.5 text-secondary-700">
                    {l.fiche.fournisseur ? `${l.fiche.fournisseur.nom} · ${l.fiche.fournisseur.reference}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Repliable>
  );
}

/** Doublons : écartés par défaut quand ils sont forts, repris par défaut quand ils sont faibles ; recochables un à un. */
export function ListeDoublons({ lignes, choix, enCours, onBasculer, onTous }) {
  return (
    <Repliable titre="Doublons" icone={Copy} compte={lignes.length}>
      {(n) => (
        <>
          <div className="flex flex-wrap gap-2 pb-2">
            <Button type="button" size="sm" variant="secondary" disabled={enCours} onClick={() => onTous(true)}>Tout importer</Button>
            <Button type="button" size="sm" variant="secondary" disabled={enCours} onClick={() => onTous(false)}>Tout écarter</Button>
          </div>
          <ul className="space-y-2 text-sm">
            {lignes.slice(0, n).map((l) => (
              <li key={l.numero} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="min-w-0">
                  <LigneArticle ligne={l} />
                  <span className="block text-xs text-secondary-600">
                    {raisonAfficheeArticle(l)}
                    {l.doublon.force === 'faible' ? ' (ressemblance : importé par défaut)' : ''}
                  </span>
                </span>
                {l.recochable ? (
                  <label className="inline-flex items-center gap-2 text-secondary-700 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={aImporter(l, choix)}
                      disabled={enCours}
                      onChange={() => onBasculer(l)}
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600"
                    />
                    Importer quand même
                  </label>
                ) : (
                  <span className="text-xs text-secondary-500 shrink-0">Ne peut pas être importé</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Repliable>
  );
}

/** Lignes que l'import ne reprend pas, avec leur raison. */
export function ListeEcartees({ lignes }) {
  return (
    <Repliable titre="Écartées" icone={XCircle} compte={lignes.length}>
      {(n) => (
        <ul className="space-y-1 text-sm">
          {lignes.slice(0, n).map((l) => (
            <li key={l.numero}>
              <span className="text-secondary-500">Ligne {l.numero} · </span>
              <span className="text-secondary-800">{raisonAfficheeArticle(l)}</span>
            </li>
          ))}
        </ul>
      )}
    </Repliable>
  );
}
