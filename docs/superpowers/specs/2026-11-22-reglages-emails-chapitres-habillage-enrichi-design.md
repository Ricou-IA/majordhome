# Réglages e-mails en chapitres, habillage enrichi — conception courte

Validée par Eric le 2026-11-22 (« oui go »). Suite de
`2026-11-21-createur-mail-une-page-habillage-design.md`, dont les règles restent valables
(habillage rendu à l'envoi par `src/lib/mailHabillage.js`, même code dans le navigateur et dans les
douze edges d'envoi ; aperçu = envoi ; rien de technique à l'écran).

## Pourquoi

Eric, en voyant l'écran : « la configuration des e-mails doit être en chapitre du paramétrage ; il
manque la création de section ou de CTA ; pour les en-têtes et les pieds de page il faudrait quelques
features ». Précision demandée : les sections et boutons vont **dans l'habillage** (sur les e-mails
eux-mêmes), pas dans le texte.

## Approches écartées

- Cinq tuiles séparées dans Paramètres : oblige à revenir à l'accueil des réglages pour passer de l'une
  à l'autre. Retenu : une seule page, des chapitres dans un menu à gauche.
- Des blocs riches dans le texte du mail (colonnes, images) : ce n'est pas la demande.

## 1. Chapitres

`/settings/communication` garde son adresse. Chapitres, choisis par `?tab=` : `expediteur` (défaut ;
adresse d'envoi, adresse de réponse, domaine), `habillage`, `automatiques` (e-mails envoyés
automatiquement), `sequences`, `sms`. Menu vertical à gauche sur écran large, onglets défilants sur
écran étroit (`SettingsPage`, prop `disposition="menu"`). Habillage, e-mails automatiques et séquences
n'apparaissent que si le module Communication est ouvert. Anciens liens : `?tab=sms` inchangé,
`#habillage` → `?tab=habillage`, les liens vers les séquences → `?tab=sequences`.

## 2. Habillage : ce qui s'ajoute

Tout vit dans `settings.email_habillage` (toujours enregistré entier), lu par `lireHabillage` qui borne
et nettoie chaque valeur ; une clé absente = le comportement d'aujourd'hui.

```
email_habillage = {
  entete: 'logo' | 'logo_bandeau',                       // existant
  logo: { position: 'gauche' | 'centre', taille: 'petit' | 'moyen' | 'grand' },   // défaut gauche, moyen
  bouton_bandeau: { libelle, adresse } | null,           // à droite dans le bandeau, si le bandeau s'affiche
  pied: {
    coordonnees, certifications, site,                   // existants
    horaires: string, texte: string,                     // lignes libres, vides par défaut
    fond: 'clair' | 'bandeau',                           // défaut clair
    reseaux: { facebook, instagram, avis_google, linkedin },   // adresses, vides par défaut
  },
  blocs: [ { titre, texte, bouton: { libelle, adresse } | null, ou: 'campagnes' | 'tous' } ],   // 2 au plus
}
```

- Tailles du logo : 40 / 56 / 80 px de haut au plus. Sans logo en `https`, le nom de l'entreprise, à la
  même position.
- Bouton du bandeau : texte blanc souligné ou pastille claire dans le bandeau ; n'apparaît que si le
  bandeau apparaît (en-tête « logo et bandeau » ET phrase écrite) — sinon l'écran le dit.
- Pied à fond « bandeau » : texte blanc sur la couleur du bandeau, liens blancs soulignés.
- Réseaux : une ligne de liens en toutes lettres (« Facebook · Instagram · Nos avis Google · LinkedIn »),
  pas d'images (une image distante est souvent bloquée par les messageries).
- Blocs fixes : placés après le texte du mail, avant le pied ; titre, texte court, bouton à la couleur
  des boutons. Chaque bloc dit où il apparaît : `campagnes` (défaut) = e-mails du Mailing (campagnes,
  séquences, leurs essais) ; `tous` = aussi les e-mails automatiques (facture, PV, RDV…).
- Adresses (bouton, réseaux) : `https://`, `http://`, `mailto:`, `tel:` seulement ; une adresse invalide
  enregistrée ne s'affiche pas (l'écran refuse de l'enregistrer). Toute valeur de texte est échappée.
- Bornes : libellé de bouton 40 caractères, titre de bloc 80, texte de bloc 300, horaires 200, ligne
  libre 300.

`habillerMail(reglages, corps, options?)` gagne `options.usage: 'campagne' | 'individuel'` (défaut
`individuel`). `mailing-send` passe `campagne` ; les autres edges ne changent pas (`wrapWithSkeleton`).
L'aperçu (`rendreApercu`) passe `campagne` pour une campagne ou une séquence, `individuel` sinon.
L'ancien habillage (`email_skeleton_html`) et une page complète ne sont pas concernés : ces nouveautés
ne valent qu'avec l'habillage construit.

## 3. Écran

Chapitre Habillage : à gauche En-tête (choix existant, position et taille du logo, phrase, bouton du
bandeau, couleurs), Pied de page (interrupteurs existants, réseaux, horaires, ligne libre, fond), Blocs
fixes (ajouter / retirer / monter, deux au plus) ; à droite l'aperçu, avec un choix « Campagne » /
« E-mail automatique » pour voir où chaque bloc apparaît. Règles dans `src/lib/mailHabillageEcran.js`
(formulaire, validité, ce qui est enregistré), testées ; sous-composants dans
`pages/settings/communication/habillage/`.

## Mise en production

Les chapitres sont front seul : poussés d'abord. L'habillage enrichi touche `mailHabillage.js` (copié
dans les edges) et `mailing-send` : sync, puis redéploiement des douze edges d'envoi **sur le oui
d'Eric**, en une fois, avant de pousser l'écran (sinon l'aperçu montrerait ce que l'envoi ne fait pas
encore).

## Hors périmètre

Blocs dans le texte du mail, images dans l'habillage, plus de deux blocs, enregistrer les couleurs en
gardant l'ancien habillage (décision en attente).
