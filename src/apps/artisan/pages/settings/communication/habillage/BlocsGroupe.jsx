/**
 * BlocsGroupe.jsx — « Blocs fixes » de l'écran Habillage des e-mails
 * ============================================================================
 * Deux blocs au plus, posés après le texte de l'e-mail et avant le pied de page :
 * titre, texte court, bouton, et où le bloc apparaît. Présentation seule : règles
 * (ajout, retrait, ordre, validité) dans `src/lib/mailHabillageEcran.js`.
 * ============================================================================
 */
import { ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  ajouterBloc, modifierBloc, monterBloc, peutAjouterBloc, retirerBloc, BLOCS_MAX, BORNES_HABILLAGE, OU_BLOC,
} from '@/lib/mailHabillageEcran';
import { ChampBouton, ChampTexte, Groupe, LABEL_CLASS } from './elements';

function OuApparait({ index, valeur, onChange }) {
  return (
    <div>
      <p className={LABEL_CLASS}>Où ce bloc apparaît</p>
      <div className="mt-2 space-y-2" role="radiogroup" aria-label={`Bloc ${index + 1} : où il apparaît`}>
        {OU_BLOC.map((o) => (
          <label key={o.cle} className="flex cursor-pointer items-start gap-2 text-sm text-secondary-800">
            <input
              type="radio"
              name={`habillage-bloc-${index}-ou`}
              checked={valeur === o.cle}
              onChange={() => onChange(o.cle)}
              className="mt-0.5 h-4 w-4 accent-primary-700"
            />
            <span>{o.libelle}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function BlocsGroupe({ form, erreurs, suggestions, setForm }) {
  const blocs = form.blocs;
  const modifier = (i, modif) => setForm((f) => modifierBloc(f, i, modif));

  return (
    <Groupe
      titre="Blocs fixes"
      aide={`Jusqu’à ${BLOCS_MAX} encadrés, ajoutés à la fin de vos e-mails, juste avant le pied de page.`}
    >
      {blocs.length === 0 && (
        <p className="rounded-lg border border-dashed border-secondary-300 px-4 py-3 text-sm text-secondary-600">
          Un bloc fixe met en avant une offre ou une demande dans chaque e-mail, sans la réécrire à chaque fois : « Parrainez un
          proche », « Laissez-nous un avis »…
        </p>
      )}

      {blocs.map((bloc, i) => (
        // Deux blocs au plus, sans identifiant : l'ordre est la seule clé.
        <div key={i} className="space-y-4 rounded-lg border border-secondary-200 bg-secondary-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-secondary-900">Bloc {i + 1}</p>
            <div className="flex items-center gap-1">
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => setForm((f) => monterBloc(f, i))}
                  aria-label={`Monter le bloc ${i + 1}`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-secondary-700 hover:bg-white"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />Monter
                </button>
              )}
              <button
                type="button"
                onClick={() => setForm((f) => retirerBloc(f, i))}
                aria-label={`Retirer le bloc ${i + 1}`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-700 hover:bg-white"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Retirer
              </button>
            </div>
          </div>
          <ChampTexte
            id={`habillage-bloc-${i}-titre`}
            libelle="Titre"
            valeur={bloc.titre}
            onChange={(v) => modifier(i, { titre: v })}
            placeholder="Parrainez un proche"
            max={BORNES_HABILLAGE.titre}
            erreur={erreurs[`bloc.${i}.titre`]}
          />
          <ChampTexte
            id={`habillage-bloc-${i}-texte`}
            libelle="Texte"
            aide="Deux ou trois lignes au plus."
            valeur={bloc.texte}
            onChange={(v) => modifier(i, { texte: v })}
            placeholder="Un mois d’entretien offert pour vous et pour lui."
            max={BORNES_HABILLAGE.texteBloc}
            lignes={3}
            erreur={erreurs[`bloc.${i}.texte`]}
          />
          <ChampBouton
            id={`habillage-bloc-${i}-bouton`}
            libelle="Bouton"
            aide="Facultatif : il prend la couleur de vos boutons."
            bouton={bloc.bouton}
            max={BORNES_HABILLAGE.libelle}
            onChange={(b) => modifier(i, { bouton: b })}
            erreur={erreurs[`bloc.${i}.bouton`]}
            suggestion={suggestions[`bloc.${i}.bouton`]}
          />
          <OuApparait index={i} valeur={bloc.ou} onChange={(ou) => modifier(i, { ou })} />
        </div>
      ))}

      {peutAjouterBloc(form) ? (
        <button
          type="button"
          onClick={() => setForm((f) => ajouterBloc(f))}
          className="inline-flex items-center gap-1.5 rounded-md border border-secondary-300 px-3 py-2 text-sm font-medium text-secondary-800 hover:bg-secondary-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />Ajouter un bloc
        </button>
      ) : (
        <p className="text-xs text-secondary-500">Deux blocs au plus : retirez-en un pour en ajouter un autre.</p>
      )}
    </Groupe>
  );
}
