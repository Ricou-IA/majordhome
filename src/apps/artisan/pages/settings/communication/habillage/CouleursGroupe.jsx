/**
 * CouleursGroupe.jsx — « Couleurs » de l'écran Habillage des e-mails
 * ============================================================================
 * La couleur d'accent (boutons, liens, liseré des encadrés, boutons des blocs fixes) et la couleur du
 * bandeau. Groupe à part, en tête de l'écran (Eric 2026-11-22 : « et pour les emphases en couleur, on
 * le configure où ? » — le champ était rangé au bas du groupe En-tête). Présentation seule : règles
 * dans `src/lib/mailHabillageEcran.js`.
 * ============================================================================
 */
import { DEFAUTS_MARQUE } from '@/lib/mailHabillage';
import {
  couleurBandeauUtilisee, lisibiliteBandeau, lisibiliteBoutons, PASTILLES_BOUTONS, PASTILLES_BANDEAU,
} from '@/lib/mailHabillageEcran';
import { ChampCouleur, Groupe } from './elements';

/** Le texte blanc se lit mal sur la couleur choisie : on le dit, et on propose la même teinte plus foncée. */
function AvertissementLisibilite({ texte, suggestion, onSuggestion }) {
  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p>{texte}</p>
      {suggestion && (
        <button type="button" onClick={() => onSuggestion(suggestion)} className="mt-1 inline-flex items-center gap-2 font-medium hover:underline">
          <span className="inline-block h-4 w-4 rounded-sm border border-amber-300" style={{ background: suggestion }} aria-hidden="true" />
          Prendre une teinte plus foncée ({suggestion})
        </button>
      )}
    </div>
  );
}

export default function CouleursGroupe({ form, erreurs, champ }) {
  const lisibilite = lisibiliteBoutons(form.couleurBoutons);
  const lisibiliteDuBandeau = lisibiliteBandeau(form.couleurBandeau);

  return (
    <Groupe titre="Couleurs" aide="Les couleurs de votre entreprise, reprises dans tous vos e-mails.">
      <ChampCouleur
        id="habillage-boutons"
        libelle="Couleur d’accent"
        aide="Les boutons, les liens et le liseré des encadrés de vos e-mails. C’est aussi la couleur des pages que vos clients ouvrent sans compte (prise de rendez-vous, procès-verbal de réception)."
        valeur={form.couleurBoutons}
        defaut={DEFAUTS_MARQUE.accent}
        pastilles={PASTILLES_BOUTONS}
        erreur={erreurs.couleurBoutons}
        onChange={(v) => champ('couleurBoutons', v)}
      >
        {!erreurs.couleurBoutons && !lisibilite.lisible && (
          <AvertissementLisibilite
            texte="Le texte blanc des boutons se lit mal sur cette couleur."
            suggestion={lisibilite.suggestion}
            onSuggestion={(c) => champ('couleurBoutons', c)}
          />
        )}
      </ChampCouleur>

      {couleurBandeauUtilisee(form) && (
        <ChampCouleur
          id="habillage-bandeau"
          libelle="Couleur du bandeau"
          aide="La bande de couleur sous le logo, et le fond du pied de page si vous le choisissez."
          valeur={form.couleurBandeau}
          defaut={DEFAUTS_MARQUE.bandeau}
          pastilles={PASTILLES_BANDEAU}
          erreur={erreurs.couleurBandeau}
          onChange={(v) => champ('couleurBandeau', v)}
        >
          {!erreurs.couleurBandeau && !lisibiliteDuBandeau.lisible && (
            <AvertissementLisibilite
              texte="Le texte blanc du bandeau et du pied de page se lit mal sur cette couleur."
              suggestion={lisibiliteDuBandeau.suggestion}
              onSuggestion={(c) => champ('couleurBandeau', c)}
            />
          )}
        </ChampCouleur>
      )}
    </Groupe>
  );
}
