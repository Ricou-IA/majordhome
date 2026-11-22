/**
 * PiedGroupe.jsx — « Pied de page » de l'écran Habillage des e-mails
 * ============================================================================
 * Coordonnées, certifications, site (interrupteurs), horaires, ligne libre,
 * adresses des réseaux, fond clair ou couleur du bandeau. Présentation seule :
 * règles dans `src/lib/mailHabillageEcran.js`.
 * ============================================================================
 */
import { Link } from 'react-router-dom';
import { BORNES_HABILLAGE, RESEAUX } from '@/lib/mailHabillageEcran';
import { ChampTexte, ChoixVisuel, Groupe, HINT_CLASS, Interrupteur, LABEL_CLASS, LIEN_CLASS } from './elements';

const INTERRUPTEURS = [
  { cle: 'coordonnees', titre: 'Coordonnées', aide: 'Nom, adresse, téléphone et adresse e-mail de l’entreprise.' },
  { cle: 'certifications', titre: 'Certifications', aide: 'Vos labels et qualifications (RGE…).' },
  { cle: 'site', titre: 'Site internet', aide: 'Un lien vers votre site.' },
];

const EXEMPLES_RESEAUX = {
  facebook: 'https://www.facebook.com/votre-entreprise',
  instagram: 'https://www.instagram.com/votre-entreprise',
  avis_google: 'https://g.page/r/…',
  linkedin: 'https://www.linkedin.com/company/votre-entreprise',
};

/** Miniature d'un fond de pied de page. */
function MiniatureFond({ couleur }) {
  return (
    <div className="mb-2 overflow-hidden rounded border border-secondary-200 bg-white" aria-hidden="true">
      <div className="space-y-1 px-2 py-2"><div className="h-1.5 w-full rounded-sm bg-secondary-100" /></div>
      <div className="h-4 border-t border-secondary-200" style={couleur ? { background: couleur } : undefined} />
    </div>
  );
}

export default function PiedGroupe({ form, disponible, erreurs, suggestions, couleurBandeau, setPied }) {
  const pied = form.pied;
  const fonds = [
    { cle: 'clair', titre: 'Fond clair', aide: 'Texte gris sur fond blanc.', miniature: <MiniatureFond /> },
    { cle: 'bandeau', titre: 'Couleur du bandeau', aide: 'Texte et liens blancs.', miniature: <MiniatureFond couleur={couleurBandeau} /> },
  ];

  return (
    <Groupe titre="Pied de page" aide="Ce qui apparaît en bas de chaque e-mail. Le lien pour se désabonner y est toujours.">
      <ul className="divide-y divide-secondary-100 rounded-lg border border-secondary-200">
        {INTERRUPTEURS.map((p) => {
          const dispo = disponible[p.cle];
          return (
            <li key={p.cle} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p className={`text-sm ${dispo.disponible ? 'text-secondary-900' : 'text-secondary-400'}`}>{p.titre}</p>
                <p className="text-xs text-secondary-500">
                  {dispo.disponible ? p.aide : (
                    <>{dispo.raison} <Link to={dispo.lien.vers} className={LIEN_CLASS}>À renseigner dans {dispo.lien.libelle}</Link></>
                  )}
                </p>
              </div>
              <Interrupteur
                actif={dispo.disponible && pied[p.cle]}
                disabled={!dispo.disponible}
                onClick={() => setPied({ [p.cle]: !pied[p.cle] })}
                libelle={p.titre}
              />
            </li>
          );
        })}
      </ul>

      <ChampTexte
        id="habillage-horaires"
        libelle="Horaires"
        aide="Facultatif : vos jours et heures d’ouverture, sur une ou deux lignes."
        valeur={pied.horaires}
        onChange={(v) => setPied({ horaires: v })}
        placeholder="Du lundi au vendredi, de 8 h à 18 h"
        max={BORNES_HABILLAGE.horaires}
        lignes={2}
        erreur={erreurs['pied.horaires']}
      />
      <ChampTexte
        id="habillage-ligne-libre"
        libelle="Ligne libre"
        aide="Facultatif : une phrase de votre choix, par exemple une mention ou un engagement."
        valeur={pied.texte}
        onChange={(v) => setPied({ texte: v })}
        placeholder="Entreprise familiale au service de la région depuis 1990"
        max={BORNES_HABILLAGE.ligneLibre}
        lignes={2}
        erreur={erreurs['pied.texte']}
      />

      <div>
        <p className={LABEL_CLASS}>Réseaux et avis</p>
        <p className={HINT_CLASS}>Facultatif : l’adresse de vos pages. Chaque page renseignée devient un lien écrit en toutes lettres en bas de l’e-mail.</p>
        <div className="mt-2 space-y-3">
          {RESEAUX.map((r) => (
            <ChampTexte
              key={r.cle}
              id={`habillage-reseau-${r.cle}`}
              libelle={r.cle === 'avis_google' ? 'Avis Google' : r.libelle}
              type="url"
              valeur={pied.reseaux[r.cle]}
              onChange={(v) => setPied({ reseaux: { ...pied.reseaux, [r.cle]: v } })}
              placeholder={EXEMPLES_RESEAUX[r.cle]}
              erreur={erreurs[`reseaux.${r.cle}`]}
              suggestion={suggestions[`reseaux.${r.cle}`]}
            />
          ))}
        </div>
      </div>

      <ChoixVisuel
        libelle="Fond du pied de page"
        aide="Sur la couleur du bandeau, le texte et les liens s’écrivent en blanc."
        options={fonds}
        valeur={pied.fond}
        onChange={(v) => setPied({ fond: v })}
      />
    </Groupe>
  );
}
