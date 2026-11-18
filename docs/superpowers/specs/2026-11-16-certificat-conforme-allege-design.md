# Certificat « Conforme » allégé, posé par le bureau

Date : 2026-11-16 · Statut : à valider par Eric

## Pourquoi

Quand le technicien ne remplit pas le certificat sur place, le bureau ne peut pas facturer :
la carte ne passe en « Réalisé » que si chaque ligne d'équipement est traitée. Le seul geste
disponible est « Néant », qui veut dire « équipement non entretenu ». Il est donc détourné :
depuis le 1ᵉʳ septembre, 18 entretiens d'Antoine et Ludovic et 35 de Mohammed ont été clos sans
certificat. Reprendre le certificat complet après coup est trop lourd.

Conséquence pour le client : aucun document. Ni certificat, ni attestation de ramonage (elle est
générée au clic « Facturer », une par certificat).

## Ce qu'on veut

Un geste de bureau, rapide : « on est passé, rien d'anormal ». Il produit un petit document
d'une page, envoyé au client avec la facture, et l'attestation de ramonage si le ramonage a été
fait.

- **But** : facturer sans détour, et que le client reçoive un écrit.
- **Hors périmètre** : mesures, contrôles détaillés, pièces, signature du client, anomalies
  (une anomalie se saisit dans le certificat complet). Pas de reprise des entretiens déjà clos
  en « Néant ».
- **À ne surtout pas produire** : un raccourci pour le technicien. S'il voit ce bouton, il ne
  remplira plus jamais un certificat.

## Approches envisagées

1. **Un certificat allégé, rangé avec les autres (retenue).** Une ligne `certificats` marquée
   `mode = 'allege'`, son PDF d'une page au même endroit que les autres. Toute la suite existe
   déjà et ne change pas : carte « Réalisé », visite de l'année, coche des certificats dans
   « Facturer », attestation de ramonage, e-mail. Coût : une colonne, un PDF, une fenêtre de
   confirmation.
2. **Un document à part, hors de la table des certificats.** Pas de colonne, mais il faudrait
   apprendre à « Facturer », à l'attestation et à l'e-mail à trouver ce second type de document :
   trois endroits à modifier au lieu d'aucun.
3. **Un « mode rapide » dans le certificat complet.** Le bureau devrait quand même ouvrir
   l'écran du certificat, et la signature du client y est le geste de clôture : c'est la
   lourdeur qu'on veut éviter.

## Conception

**Le geste.** Sur chaque ligne d'équipement « À faire » de la fiche d'entretien, un bouton
« Conforme » entre « Remplir » et « Néant ». Visible pour le responsable et l'administrateur
seulement (même règle que « Facturer »), jamais pour le technicien.

**La confirmation.** Une petite fenêtre, trois choses :
- la date de passage, reprise du RDV, jamais dans le futur ;
- le technicien, repris du RDV (choix s'ils étaient plusieurs) ;
- la case « Ramonage effectué », seulement pour un appareil à conduit de fumée.

**Ce qui est enregistré.** Un certificat `mode = 'allege'`, bilan « conforme », finalisé, sans
signature du client. Case cochée ⇒ un conduit noté « ramoné », sans méthode (on n'affirme pas
une méthode qu'on ne connaît pas : l'attestation dit alors « l'opération a été effectuée sur la
totalité du conduit »).

**L'enchaînement**, dans le même ordre que le certificat complet et dans une seule fonction :
certificat enregistré → ligne « Réalisé » (et carte, si c'était la dernière ligne, avec la
visite de l'année à la date saisie) → PDF → archivage. Un PDF qui échoue ne défait rien : il se
régénère depuis « Voir certificat ».

**Le document** (une page, à l'en-tête de l'entreprise) :

```
CERTIFICAT D'ENTRETIEN                                   CERT-2026-01617
Client     AMAR JEANNE, 1 Impasse Emilien Natoly, 81370 SAINT-SULPICE-LA-POINTE
Appareil   Poêle à granulés PALAZZETTI eco fire beatrice 6
Contrat    CTR-00881

Nous attestons être intervenus le 13 novembre 2026 pour l'entretien annuel
de cet appareil. (Le technicien n'est pas nommé : retiré le 2026-11-18, Eric.)

Aucune anomalie n'a été relevée. L'installation est conforme et apte à un
usage normal.

Le conduit de fumée raccordé à l'appareil a été ramoné.     (si case cochée)

Fait à Gaillac, le 16 novembre 2026          [entreprise, signataire, fonction]
```

**À l'écran.** La ligne affiche « Conforme » et « Voir certificat ». Tant que la carte n'est pas
facturée, « Annuler » retire le certificat allégé et remet la ligne « À faire » (même geste que
l'annulation d'un « Néant »).

**« Néant »** retrouve son seul sens : équipement non entretenu.

## Ce que la case « Ramonage effectué » engage

L'attestation de ramonage envoyée au client écrit que le test de vacuité a réussi et que le
conduit est vacant. Cocher la case, c'est l'affirmer pour l'assurance du client. La fenêtre de
confirmation le dit en une ligne.

## Mes choix, à corriger si besoin

- Colonne `certificats.mode` (`complet` | `allege`) plutôt qu'un marqueur caché : on peut
  compter les certificats allégés par technicien.
- Texte du document rangé dans un module pur testé (`src/lib/certificatConformeModel.js`), le
  PDF ne fait que dessiner — même règle que l'attestation.
- Bouton réservé au responsable et à l'administrateur.
- Pas de méthode de ramonage demandée.
- Les entretiens déjà clos en « Néant » ne sont pas repris.

## Reste au constructeur

Migration versionnée (colonne ajoutée en fin de vue `majordhome_certificats`, répétée sur le
harnais), vérification que « Facturer » et `invoice-send` joignent bien un certificat sans
signature, régénération du PDF allégé depuis « Voir certificat », tests du modèle.
