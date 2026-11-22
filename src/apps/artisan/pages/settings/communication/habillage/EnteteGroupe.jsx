/**
 * EnteteGroupe.jsx — « En-tête » de l'écran Habillage des e-mails
 * ============================================================================
 * Logo seul ou logo et bandeau, place et taille du logo, phrase et bouton du
 * bandeau, couleurs. Présentation seule : règles dans `src/lib/mailHabillageEcran.js`.
 * ============================================================================
 */
import { Link } from 'react-router-dom';
import { Image as ImageIcon } from 'lucide-react';
import { DEFAUTS_MARQUE } from '@/lib/mailHabillage';
import {
  bandeauVisible, couleurBandeauUtilisee, couleurPourSelecteur, lisibiliteBoutons, logoAffiche, ligneLogo, BORNES_HABILLAGE,
  PASTILLES_BOUTONS, PASTILLES_BANDEAU,
} from '@/lib/mailHabillageEcran';
import {
  ChampBouton, ChampCouleur, ChoixVisuel, Groupe, HINT_CLASS, INPUT_CLASS, LABEL_CLASS, LIEN_CLASS,
} from './elements';

/** Miniature d'un en-tête, pour choisir à l'œil. */
function MiniatureEntete({ bandeau, couleur, centre }) {
  return (
    <div className="mb-2 overflow-hidden rounded border border-secondary-200 bg-white" aria-hidden="true">
      <div className={`flex px-2 pt-2 ${centre ? 'justify-center' : ''}`}><div className="h-2.5 w-10 rounded-sm bg-secondary-300" /></div>
      <div className="mt-2 h-3" style={bandeau ? { background: couleur } : undefined} />
      <div className="space-y-1 px-2 py-2"><div className="h-1.5 w-full rounded-sm bg-secondary-100" /><div className="h-1.5 w-2/3 rounded-sm bg-secondary-100" /></div>
    </div>
  );
}

/** Miniature d'une taille de logo. */
function MiniatureTaille({ hauteur }) {
  return (
    <div className="mb-2 flex h-8 items-center rounded border border-secondary-200 bg-white px-2" aria-hidden="true">
      <div className="w-10 rounded-sm bg-secondary-300" style={{ height: hauteur }} />
    </div>
  );
}

export default function EnteteGroupe({ form, settings, erreurs, suggestions, champ }) {
  const couleurBandeau = couleurPourSelecteur(form.couleurBandeau, DEFAUTS_MARQUE.bandeau);
  const centre = form.logo.position === 'centre';
  const lisibilite = lisibiliteBoutons(form.couleurBoutons);
  const logo = logoAffiche(settings);
  const etatLogo = ligneLogo(settings);

  const entetes = [
    { cle: 'logo', titre: 'Logo seul', aide: 'Votre logo en haut, sur fond blanc.', miniature: <MiniatureEntete centre={centre} /> },
    {
      cle: 'logo_bandeau', titre: 'Logo et bandeau', aide: 'Votre logo, puis une bande de couleur avec une phrase.',
      miniature: <MiniatureEntete bandeau couleur={couleurBandeau} centre={centre} />,
    },
  ];
  const positions = [
    { cle: 'gauche', titre: 'À gauche', miniature: <MiniatureEntete /> },
    { cle: 'centre', titre: 'Au centre', miniature: <MiniatureEntete centre /> },
  ];
  const tailles = [
    { cle: 'petit', titre: 'Petit', miniature: <MiniatureTaille hauteur={6} /> },
    { cle: 'moyen', titre: 'Moyen', miniature: <MiniatureTaille hauteur={10} /> },
    { cle: 'grand', titre: 'Grand', miniature: <MiniatureTaille hauteur={16} /> },
  ];

  return (
    <Groupe titre="En-tête" aide="Ce qui apparaît en haut de chaque e-mail.">
      <ChoixVisuel libelle="Disposition" options={entetes} valeur={form.entete} onChange={(v) => champ('entete', v)} />

      <div>
        <p className={LABEL_CLASS}>Logo</p>
        <div className="mt-2 flex items-center gap-4">
          <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-secondary-200 bg-white p-2">
            {settings?.logo_url
              ? <img src={settings.logo_url} alt="Logo de l’entreprise" className="max-h-full max-w-full object-contain" />
              : <ImageIcon className="h-6 w-6 text-secondary-300" aria-hidden="true" />}
          </div>
          <div className="min-w-0 text-xs text-secondary-500">
            {etatLogo === 'absent' && <p>Pas de logo : le nom de l’entreprise est écrit à sa place{logo.nom ? ` (« ${logo.nom} »)` : ''}.</p>}
            {etatLogo === 'non_sur' && <p>Ce logo n’est pas hébergé de façon sûre : le nom de l’entreprise est écrit à sa place. Déposez-le à nouveau pour l’utiliser.</p>}
            <Link to="/settings/organization?tab=identity" className={LIEN_CLASS}>Changer le logo dans Organisation → Identité</Link>
          </div>
        </div>
      </div>

      <ChoixVisuel
        libelle="Place du logo"
        aide="Sans logo, le nom de l’entreprise prend la même place."
        options={positions}
        valeur={form.logo.position}
        onChange={(v) => champ('logo', { ...form.logo, position: v })}
      />
      <ChoixVisuel
        libelle="Taille du logo"
        aide="Un logo très large garde ses proportions."
        options={tailles}
        colonnes={3}
        valeur={form.logo.taille}
        onChange={(v) => champ('logo', { ...form.logo, taille: v })}
      />

      {form.entete === 'logo_bandeau' && (
        <>
          <div>
            <label htmlFor="habillage-phrase" className={LABEL_CLASS}>Phrase du bandeau</label>
            <p className={HINT_CLASS}>Une phrase courte, écrite en blanc dans le bandeau. Le bandeau n’apparaît que si une phrase est écrite.</p>
            <input
              id="habillage-phrase"
              type="text"
              value={form.phrase}
              onChange={(e) => champ('phrase', e.target.value)}
              placeholder="Chauffage, climatisation et entretien depuis 1990"
              maxLength={140}
              className={`${INPUT_CLASS} mt-2`}
            />
            {!bandeauVisible(form) && <p className="mt-1 text-xs text-amber-800">Sans phrase, le bandeau n’est pas affiché.</p>}
          </div>
          <ChampBouton
            id="habillage-bouton-bandeau"
            libelle="Bouton du bandeau"
            aide="Facultatif : un bouton à droite de la phrase, par exemple « Prendre rendez-vous ». Il n’apparaît que si le bandeau apparaît."
            bouton={form.boutonBandeau}
            max={BORNES_HABILLAGE.libelle}
            onChange={(b) => champ('boutonBandeau', b)}
            erreur={erreurs.boutonBandeau}
            suggestion={suggestions.boutonBandeau}
          />
        </>
      )}

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
        />
      )}

      <ChampCouleur
        id="habillage-boutons"
        libelle="Couleur des boutons et des liens"
        aide="C’est aussi la couleur des pages que vos clients ouvrent sans compte (prise de rendez-vous, procès-verbal de réception)."
        valeur={form.couleurBoutons}
        defaut={DEFAUTS_MARQUE.accent}
        pastilles={PASTILLES_BOUTONS}
        erreur={erreurs.couleurBoutons}
        onChange={(v) => champ('couleurBoutons', v)}
      >
        {!erreurs.couleurBoutons && !lisibilite.lisible && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>Le texte blanc des boutons se lit mal sur cette couleur.</p>
            {lisibilite.suggestion && (
              <button type="button" onClick={() => champ('couleurBoutons', lisibilite.suggestion)} className="mt-1 inline-flex items-center gap-2 font-medium hover:underline">
                <span className="inline-block h-4 w-4 rounded-sm border border-amber-300" style={{ background: lisibilite.suggestion }} aria-hidden="true" />
                Prendre une teinte plus foncée ({lisibilite.suggestion})
              </button>
            )}
          </div>
        )}
      </ChampCouleur>
    </Groupe>
  );
}
