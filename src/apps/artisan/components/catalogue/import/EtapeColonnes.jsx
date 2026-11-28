/**
 * EtapeColonnes.jsx - Import d'articles, étape 2
 * Une ligne par colonne du fichier : son en-tête, trois valeurs, et le champ de l'article qu'elle remplit.
 */

import { useMemo } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListeChoix } from '@/components/ui/liste-choix';
import { CIBLE_IGNORER, CIBLE_A_CHOISIR } from '@/lib/importClients/champs';
import { texteAccentsRepares } from '@/lib/importClients/libelles';
import { CHAMPS_ARTICLE } from '@/lib/importArticles/champs';
import { Encadre } from './Encadres';

const OPTIONS_CIBLE = [
  { value: CIBLE_A_CHOISIR, label: '— À choisir —' },
  ...CHAMPS_ARTICLE.map((c) => ({ value: c.cle, label: c.libelle })),
  { value: CIBLE_IGNORER, label: 'Ignorer cette colonne' },
];

/** Trois premières valeurs non vides de chaque colonne. */
function exemplesParColonne(lignes, nbColonnes) {
  const exemples = Array.from({ length: nbColonnes }, () => []);
  for (const l of lignes) {
    let complet = true;
    for (let k = 0; k < nbColonnes; k += 1) {
      if (exemples[k].length < 3) {
        if (l.cellules[k]) exemples[k].push(l.cellules[k]);
        if (exemples[k].length < 3) complet = false;
      }
    }
    if (complet) break;
  }
  return exemples;
}

/** Aperçu d'une ligne du fichier pour le choix de la ligne d'en-tête. */
function resumeLigne(ligne) {
  const texte = (ligne || []).filter((c) => String(c ?? '').trim() !== '').slice(0, 4).join(' · ');
  const coupe = texte.length > 70 ? `${texte.slice(0, 70)}…` : texte;
  return coupe || '(ligne vide)';
}

export default function EtapeColonnes({
  fichier, correspondance, validation, fournisseurIncomplet, onEntete, onCible, onRetour, onSuite,
}) {
  const exemples = useMemo(() => exemplesParColonne(fichier.lignes, fichier.entetes.length), [fichier]);
  const accents = texteAccentsRepares(fichier.reparees);
  const { erreurs, aChoisir } = validation;

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-section text-secondary-900">Quelle colonne va où ?</h2>
            <p className="text-sm text-secondary-600">
              {fichier.nom} · {fichier.lignes.length} ligne{fichier.lignes.length > 1 ? 's' : ''}. Vérifiez le champ choisi
              pour chaque colonne de votre fichier.
            </p>
            {accents && <p className="mt-1 text-sm text-secondary-700">{accents}</p>}
          </div>
          <div>
            <label htmlFor="import-articles-entete" className="block text-sm font-medium text-secondary-700 mb-1">Ligne d&apos;en-tête</label>
            <ListeChoix
              id="import-articles-entete"
              value={fichier.indexEntete}
              onChange={(v) => onEntete(Number(v))}
              className="sm:w-80"
              selectClassName="sm:w-80"
              options={fichier.matrice.slice(0, 10).map((ligne, i) => ({ value: i, label: `Ligne ${i + 1} : ${resumeLigne(ligne)}` }))}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th scope="col" className="py-2 pr-4 font-medium">Colonne du fichier</th>
                <th scope="col" className="py-2 pr-4 font-medium">Premières valeurs</th>
                <th scope="col" className="py-2 font-medium">Champ de l&apos;article</th>
              </tr>
            </thead>
            <tbody>
              {correspondance.map((col) => {
                const aFaire = col.cible === CIBLE_A_CHOISIR;
                return (
                  <tr key={col.index} className={`border-b border-secondary-100 align-top ${aFaire ? 'bg-st-attente-bg' : ''}`}>
                    <th scope="row" className="py-2 pr-4 font-medium text-secondary-900 text-left">
                      {col.entete}
                      {aFaire && <span className="block text-xs font-normal text-st-attente">À choisir</span>}
                    </th>
                    <td className="py-2 pr-4 text-secondary-600">
                      {exemples[col.index]?.length
                        ? exemples[col.index].map((v, i) => <div key={i} className="truncate max-w-xs">{v}</div>)
                        : <span className="text-secondary-400">(colonne vide)</span>}
                    </td>
                    <td className="py-2">
                      <ListeChoix
                        value={col.cible}
                        onChange={(v) => onCible(col.index, v)}
                        options={OPTIONS_CIBLE}
                        libelle={`Champ pour la colonne ${col.entete}`}
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
      </Card>

      {fournisseurIncomplet && (
        <Encadre ton="attention">
          Pour créer la ligne fournisseur de chaque article, choisissez les trois colonnes « Fournisseur », « Référence
          fournisseur » et « Prix d&apos;achat HT ». Sans elles, les articles sont importés seuls.
        </Encadre>
      )}
      {aChoisir > 0 && (
        <Encadre ton="attention">
          {aChoisir} colonne{aChoisir > 1 ? 's' : ''} à choisir ou à ignorer. Sans choix, {aChoisir > 1 ? 'elles seront ignorées' : 'elle sera ignorée'}.
        </Encadre>
      )}
      {erreurs.length > 0 && (
        <div role="alert" className="space-y-2">
          {erreurs.map((e) => <Encadre key={e} ton="alerte">{e}</Encadre>)}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={onRetour}>
          <ArrowLeft aria-hidden="true" />
          Changer de fichier
        </Button>
        <Button type="button" onClick={onSuite} disabled={erreurs.length > 0}>
          Voir l&apos;aperçu
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
