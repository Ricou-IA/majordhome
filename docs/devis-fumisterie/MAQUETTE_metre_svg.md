# MAQUETTE — Schémas cotés SVG pour le métré (devis fumisterie Hermes)

Complément au `HANDOFF_devis_fumisterie.md`. Rédigé le 2026-09-28 (session Cowork). Fichier de référence : `maquette_metre_ptr30.html` (autonome, s'ouvre dans un navigateur). Direction validée par Eric. Design retenu : `docs/superpowers/specs/2026-09-28-assistant-devis-fumisterie-design.md`.

## 1. Objet

Remplacer la saisie « à l'aveugle » des cotes par un schéma en coupe coté et interactif : le technicien (ou Hermes via ses questions) renseigne les cotes, le schéma se redessine à l'échelle, les contrôles réglementaires et la liste de pièces chiffrée se recalculent en direct.

La maquette implémente le gabarit G1 = configuration CFG-24 (création intérieure verticale PTR30, bois bûche, zone 1, catalogue p.24) avec les prix nets réels du tarif MAYER002.

## 2. Principes (décisions)

- On ne réutilise pas les images Modinox pour le métré : droits (usage dans un devis client = accord écrit d'Altema) et rendus 3D figés (PNG) impossibles à coter. Elles restent une référence visuelle rattachée à chaque configuration (`index_image` du JSON).
- On dessine nos propres coupes 2D paramétriques en SVG. Pas de problème de droits, le schéma coté peut figurer dans le devis client.
- Le schéma est l'écran de saisie : clic (ou Entrée) sur une cote → focus sur le champ correspondant.
- Un gabarit = une suite de tronçons paramétrés, pas un dessin par configuration.
- Le calcul des quantités vit dans un moteur réutilisable par Hermes (décision finale : module JavaScript pur partagé front + edge function, cf. spec). Le SVG n'est qu'un rendu + une saisie.
- Les gabarits sont pilotés par les données (tables), jamais codés en dur par configuration.

## 3. Gabarits cibles (~6 pour les 19 configurations)

| Gabarit | Description | Configurations (id JSON) |
|---|---|---|
| G1 | Création intérieure verticale, avec ou sans dévoiement | CFG-24, CFG-28, CFG-32 |
| G3 | Création extérieure en façade | CFG-25, CFG-33 |
| G4 | Tubage d'un conduit existant (flexible ou rigide) | CFG-26, CFG-27, CFG-30, CFG-31, CFG-34, CFG-35, CFG-37, CFG-39 |
| G5 | Raccordement seul | CFG-42, CFG-43, CFG-45 |
| G6 | Sortie horizontale en façade (ventouse, zone 3) | CFG-29 |
| G1/G3 variante MFI | Création + raccordement MFI (appareil étanche) | CFG-40 |
| G1 variante chaudière | Chaudière pellets étanche (PLA) | CFG-48 |

(G2 « avec dévoiement » est fusionné dans G1.) Répartition à valider à l'implémentation.

### Tronçons types

| Tronçon | Paramètres saisis |
|---|---|
| Raccordement appareil → plafond | hauteur de buse, hauteur sous plafond |
| Traversée de plancher | épaisseur, nombre |
| Étage intermédiaire | hauteur sous plafond |
| Combles | hauteur au droit du conduit |
| Dévoiement | angle (0 / 15 / 30 / 45°), décalage horizontal |
| Traversée de toiture | pente, épaisseur |
| Sortie au-dessus du toit | hauteur visée, distance au faîtage, finition (noir / inox) |
| Façade (G3) | hauteur, traversée de mur, fixations |
| Conduit existant (G4) | longueur, section, nature, épaisseur vérifiable |

Chaque ligne de nomenclature est rattachée à un tronçon, porte un repère (numéro affiché sur le schéma et dans la liste de pièces) et un statut : **catalogue** (composant présent sur le schéma Modinox), **implicite** (nécessaire au montage, non dessiné), **provisoire** (règle de quantité à valider par un technicien).

## 4. Contenu de la maquette G1

**Saisie (valeurs d'exemple)** : Ø150 (ou Ø180) · buse 1,05 m · HSP pièce 2,50 m · plancher 0,25 m · 1 étage de 2,50 m · combles 1,40 m · pente 35° · toiture 0,30 m · sortie → faîtage 1,60 m · dévoiement 30° / 0,40 m · sortie visée 1,60 m · finition noire.

**Schéma** : coupe à l'échelle (sol, murs, planchers, toiture à 2 pans, appareil, simple paroi émaillé, PTR30+ inox intérieur, PTR30+ extérieur noir ou inox, solin, chapeau) ; lignes « Faîtage » et « Minimum zone 1 » (bleue si respectée, jaune sinon, icône ✓ / ⚠) ; cotes cliquables ; repères 1 à 6 (chapeau, éléments extérieurs, solin, dévoiement / conduit intérieur, traversées de plancher, raccordement simple paroi).

**Contrôles affichés**

| Contrôle | Règle | Source |
|---|---|---|
| Zone 1 | sortie ≥ faîtage + 0,40 m si pente > 15° ; ≥ toit + 1,20 m si pente ≤ 15° | catalogue p.23 |
| Toit plat | pente ≤ 15° traitée comme toit plat | catalogue p.23 |
| Dévoiement | le gain vertical (décalage / tan angle) doit tenir dans les combles (marge 0,10 m sous toiture) | géométrie |
| Haubanage | > 3 m de conduit libre au-dessus du toit → kit de non-haubanage ou haubanage | catalogue p.33 (transposé, à confirmer) |
| Solin | pas de solin standard pour la pente et le diamètre → ligne « sur devis » | tarif |
| Buse | buse au niveau ou au-dessus du plafond → erreur de saisie | géométrie |
| Surlongueurs | surlongueur intérieure / émaillée signalée | calcul |

Bouton « Ajuster la sortie au minimum zone 1 » : hauteur de sortie minimale arrondie aux 5 cm, surlongueur intérieure comprise.

**Liste de pièces (exemple Ø150, 14 lignes, ≈ 1 480 € HT fournitures)** — prix = colonne « Prix pour client » de MAYER002 (remises incluses).

| Rep. | Composant | Référence Ø150 | Statut |
|---|---|---|---|
| 1 | Chapeau anti-refouleur PTR30+ noir / inox | 2PTICHARN150NO / 2PTICHARN150 | catalogue |
| 2 | Éléments droits PTR30+ extérieurs 1000/500/250 | 2PTIELDR150{LG}NO / 2PTIELDR150{LG} | catalogue |
| 2 | Élément réglable 320-500 | 2PTIELRE150500(NO) | catalogue |
| 2 | Collier de jonction extérieur | 2PTICOJO150(NO) | provisoire |
| 3 | Solin inox par plage de pente | 2DIVS{plage}IN230KEI | catalogue |
| 3 | Collier universel sous toiture | 2DIVCTOS150 | provisoire |
| 4 | Coudes 15/30/45° ×2 | 2PTICO{angle}150 | catalogue |
| 4 | Éléments droits PTR30+ inox intérieurs | 2PTIELDR150{LG} | implicite |
| 4 | Élément réglable inox 320-520 | 2PTIELRE150500 | implicite |
| 5 | Plaque de propreté RT2012 560×560 | 2PTIPPDR150 | provisoire |
| 5 | Couronne coupe-feu | 2PTGCOCF150 | provisoire |
| 6 | Raccord simple paroi réduit Ø150/148 (émaillé) | 2PTIRASR150148 | implicite |
| 6 | Tuyaux émaillés Ligne+ noir 1000/500/250 | 2LEPTUYA150{LG}NO | catalogue |

Équivalents Ø180 : même logique de codes (180 à la place de 150), sauf raccord 2PTIRASS180, solins 2DIVS{plage}IN250KEI, collier sous toiture 2DIVCTOS180.

## 5. Moteur de calcul de la maquette — règles PROVISOIRES

À valider par un technicien Mayer ; portées telles quelles dans `src/lib/fumisterie/gabarits/g1.js` et `compose.js`.

**Géométrie**
- Niveau combles yC = HSP pièce + plancher (+ HSP étage + plancher si étage).
- Dessus de toiture au droit du conduit = yC + hauteur combles + épaisseur toiture.
- Faîtage = dessus de toiture + distance sortie→faîtage × tan(pente).
- Longueur intérieure PTR = (toit − plafond RDC) − gain vertical du dévoiement + longueur oblique (décalage / sin angle). ⚠ Encombrement des coudes ignoré — à corriger avec les cotes réelles des coudes PTR30+.
- Combinaison d'éléments (PTR) : n × 1000 mm, puis le reste couvert par 250 / 500 / 500+250 / élément réglable (320-500) quand il tombe juste, sinon un 1000 de plus. La surlongueur intérieure est reportée sur la hauteur de sortie.
- Simple paroi émaillé = HSP pièce − hauteur de buse, en 1000/500/250, arrondi au-dessus (recoupe ou tuyau coulissant ; pas de coulissant Ø180 au tarif).
- Kit RT2012 PTR : n'existe pas comme article au tarif. Reconstitué par plancher traversé : plaque de propreté RT2012 + couronne coupe-feu. À confirmer auprès d'Altema / d'un technicien.
- Solin : première plage de pente contenant la pente saisie ; Ø180 n'a pas de plage 15-25°.
- Fixations : 1 collier de jonction par emboîtement extérieur, 1 collier universel sous toiture.

**Questions à trancher avec le technicien**
- Composition réelle du « kit RT2012 » PTR (quels articles, combien par traversée).
- Surlongueur : élément réglable systématique, recoupe, ou sortie plus haute ?
- Fixations : fréquence des supports / colliers en intérieur et au-dessus du toit.
- Composants implicites manquants (tampon de ramonage, plaque de finition plafond, élément de départ…).
- Encombrement des coudes pour le calcul du dévoiement.

## 6. Intégration Majordhome

Le schéma de données retenu (gabarits, tronçons, composants avec repère/statut/règle de quantité, `fum_metres`, moteur `calculerMetre`) est décrit dans la spec du 2026-09-28. Les réglages de quantité (longueurs standard, fixations, plages) vivent dans `settings.fumisterie`, éditables dans Settings.

Contraintes UI d'Eric : palette jaune/bleu uniquement (#F5C542 / #FFD166 · #2196F3 / #1565C0 / #0D47A1), jamais rouge/vert seuls, toujours couleur + icône + libellé. Déjà respecté dans la maquette.
