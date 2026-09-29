# Tests manuels — tranche 1 (G1) — à faire par Eric / Philippe

Extraits des rapports d'implémentation (2026-09-28). Résultats et règles provisoires contestées : à consigner ici en « Retours d'usage ».

## Pré-requis
- Tarif importé et seed rejoué en prod (`scripts/fumisterie/apply-sql.mjs`, cf. mémoire projet).
- `settings.pennylane.enabled = true` sur l'org.

## A. Métré assisté → devis (écran)
1. Ouvrir une fiche lead, idéalement avec un client lié ; sans client lié, vérifier que le bandeau ambre apparaît sur l'étape Client.
2. Cliquer sur **Nouveau devis**. Dans « Installation », choisir **Poêle à Bois**, puis cliquer sur **Suivant**.
3. Dans la section **FUMISTERIE**, cliquer sur la pastille jaune **« Métré assisté »** (à gauche du « + »).
4. Qualification : filtrer au besoin (Projet « Création de conduit intérieur », Appareil « Poêle ou cuisinière »…). Sélectionner **CFG-24**, puis cliquer sur **Relevé →**.
5. Relevé : saisir les valeurs de la maquette (`docs/devis-fumisterie/maquette_metre_ptr30.html`). Vérifier qu'un clic sur une cote de la coupe place le focus dans le champ, et que « Ajuster la sortie au minimum de zone 1 » fonctionne.
6. Attendu : **14 lignes** et **total achat 1 480,90 €** dans le pied de la liste de pièces. Contrôler les alertes.
7. Cliquer sur **Injecter dans le devis**. Une confirmation s'affiche si un contrôle non « article_manquant » est en alerte. Les 14 lignes apparaissent sous FUMISTERIE, les « à chiffrer » à 0 € avec « À CHIFFRER » dans la description.
8. **Suivant** (Récapitulatif) puis **Créer le devis**.
9. En base : `select count(*) from majordhome.fum_metres where quote_id = '<id>'` = 1 ; `select count(*) from majordhome.quote_lines where quote_id = '<id>'` = 14 + les autres lignes (titres de section, main d'œuvre…).
10. Brouillon : ouvrir le métré, saisir, fermer avec la croix, rouvrir. La saisie doit être restaurée.


## B. Envoi dans Pennylane + rattachement au lead
Pré-requis : `settings.pennylane.enabled = true` ; un devis MDH en **brouillon**, lié à un **lead** qui a un **client** (sinon bouton grisé), avec au moins un titre de section et des lignes `pièce` / TVA 20.

1. Ouvrir la fiche devis → le bouton jaune « Envoyer dans Pennylane » est à côté de « Générer PDF ». Survol sans client : « Lier un client au lead avant l'envoi ».
2. Cliquer. Attendu : toast « Devis D-… créé dans Pennylane et rattaché au lead ». En cas d'erreur, le toast affiche le message Pennylane (400/422) : **corriger le payload** (`buildPennylaneQuote`), ne pas contourner.
3. Dans Pennylane : devis **brouillon** au bon client, sections (POÊLE / FUMISTERIE / …) dans l'ordre, libellés, quantités, PU HT, TVA 20 %, remise globale éventuelle, total HT = total MDH. `external_reference` = id du devis MDH.
4. Dans MDH, la fiche devis passe en « Envoyé » et montre le badge « Dans Pennylane · n° … » ; la carte du lead est en « Devis envoyé » sur le pipeline.
5. SQL (remplacer les ids) :
   ```sql
   select status, sent_at, pennylane_quote_id, pennylane_synced_at from majordhome.quotes where id = '<quote_id>';
   -- attendu : envoye, horodaté, id PL, horodaté
   select * from majordhome.pennylane_sync where entity_type = 'quote' and local_id = '<quote_id>';
   -- 1 ligne, sync_status = synced, pennylane_number = D-…
   select * from majordhome.lead_pennylane_quotes where pennylane_quote_id = '<pl_id>';
   -- 1 ligne, lead_id = lead du devis
   select column_key from majordhome_kanban_cards where lead_id = '<lead_id>';
   -- devis_envoye
   ```
6. Idempotence (optionnel) : remettre le devis en brouillon (`update majordhome.quotes set status='brouillon', pennylane_quote_id=null where id=…`), recliquer → aucun second devis dans PL (PUT), toujours 1 ligne dans `lead_pennylane_quotes`.

## C. Choix métier à valider
- Raccord simple paroi : 2 lignes de mapping à priorité — réduit `RASR{D}{D-2}` (pour tuyau émaillé, Ø150) puis raccord droit `RASS{D}` (Ø180). Est-ce le bon montage en Ø180 ?
- Règles « provisoires » (colliers par emboîtement, kit RT2012 = plaque + couronne, collier sous toiture) : à confirmer avec Philippe ; éditables dans Settings → Entretiens & Contrats → Fumisterie.

## Retours d'usage
_(à remplir)_

---

# Tests manuels — tranche 2 (G4 tubage) — 2026-09-29

Configurations métrables ajoutées : **CFG-34** (tubage flexible POLYLISSE, pellets), **CFG-26** (idem, bûches), **CFG-35** (rigide PRH, pellets), **CFG-27** (rigide PRH, bûches). Spec : `docs/superpowers/specs/2026-09-29-fumisterie-tranche2-g4-tubage-design.md`.

## D. Tubage flexible pellets (CFG-34)
1. Nouveau devis → **Poêle à Granulé** → Suivant → FUMISTERIE → Métré assisté. Attendu : Appareil et Combustible pré-cochés par la famille ; si un brouillon existe sur le lead, bandeau « Saisie précédente restaurée » + « Repartir de zéro ».
2. Projet **Tubage d'un conduit existant**. Attendu : « N configurations compatibles · 2 avec métré » (CFG-34 et CFG-35 sans cadenas, CFG-37/39 POLYPERF cadenassées).
3. CFG-34 → Relevé. Saisir : Ø **80**, buse 0,9, entrée **par le plafond**, HSP 2,4, tuyau **Émaillé 1,2 mm**, hauteur du conduit **6,2**, boisseau **20 × 20**, chapeau Standard, kit d'air **Oui**.
4. Attendu : **10 lignes**, achat **502,17 € HT**, 0 à chiffrer. Flexible `2FLEPOLIXT1080C` × **7** (6,2 + 0,5 de débord → 7,0 m), kit de couronnement `2DIVKCIRN180`, plaque ventilée `2FLEPHV1N80NO`, RDE `2FLERADE8086`, kit d'air `2KITEAIR033` (Ø100, indépendant du Ø). Contrôles : info « zone 1 non vérifiée » + info flexible commandé ; aucun ⚠.
5. Passer l'entrée **par le mur** (piquage 1,6 m, horizontal 0,45). Attendu : RDE et plaque ventilée disparaissent, adaptateur de piquage `2FLEADA180NO` + coude 90° `2PELCO9080NO` apparaissent.

## E. Tubage flexible bûches (CFG-26), Ø150, entrée par le mur
Ø 150, buse 1,05, mur (1,6 / 0,45), émaillé 1,2, conduit 7,3, boisseau 30 × 30, chapeau **Plat**. Attendu : **8 lignes**, **679,61 € HT** d'achat, `2FLECHPL150`, `2DIVKCIRN3150`, `2FLEADA1150NO`, `2LEPCO90150NO`, `2LEPTUYA1501000NO`.

## F. Tubage rigide (CFG-35 Ø80 / CFG-27 Ø150)
- CFG-35 Ø80 plafond, conduit 6,2, boisseau 25 × 25 : 8 lignes, **1 à chiffrer** (plaque ARP Ø80 absente du tarif 5/10 — comportement voulu, ligne « À CHIFFRER » à 0 € dans le devis), chapeau plat sur manchette `2PRWCHSI80` (pas d'anti-refouleur 5/10 au tarif), tuyaux 1000/500/250.
- CFG-27 Ø150 mur (1,6 / 0,45), conduit 7,3, boisseau 20 × 40 : **8 lignes**, **750,45 € HT**, tuyaux composés en **330** (`2PR6TUYA150330`), coude à purge + tampon.

## G. Réglages
Settings → Entretiens & Contrats → Fumisterie → section « Tubage » : débord du flexible (50 cm), arrondi (50 cm), longueurs PRH 6/10 (1000, 500, 330) et 5/10 (1000, 500, 250). Changer le débord à 100 cm → le flexible de D.4 passe à 7,5 m.

## Choix métier à valider (Philippe)
- Kit de couronnement MODINOX = « collerette + plaque de couronnement » du catalogue, choisi par la section du boisseau.
- Flexible POLYLISSE XT **10/100** à la coupe (12/100 existe) ; débord 0,5 m ; arrondi 0,5 m.
- Plaque ARP 300 × 300 par défaut (rigide), coude 90° à purge + tampon pour l'entrée par le mur.
- Adaptateur de piquage n°1 (entrée par le mur, jusqu'au Ø150) ; kit d'entrée d'air Ø100 noir obturable par défaut.
- Ø80/100 rigide : PRH 5/10 brillant, chapeau plat sur manchette avec grillage.

## Retours d'usage
_(à remplir)_

---

# Tests manuels — tranche 3 (toutes les configurations) — 2026-09-29

Les 19 configurations du catalogue sont métrables. Spec : `docs/superpowers/specs/2026-09-29-fumisterie-tranche3-toutes-configurations-design.md`. Toutes les règles sont **provisoires** (badge PROVISOIRE dans la liste de pièces) ; ce qui suit donne, pour chaque famille, un relevé et le résultat attendu (achat HT, tarif juin 2026).

| Cas | Relevé | Attendu |
|---|---|---|
| **H. CFG-45** raccordement seul, Ø150, plafond, émaillé 1,2, kit d'air Oui | buse 1,05 · HSP 2,5 | 4 lignes, **132,15 €**, info « conduit non métré » |
| **I. CFG-43** foyer sur flexible, Ø150 | buse 1,2 · conduit 7 · boisseau 30×30 | 6 lignes, **441,53 €**, Griffaflex `2FLERAGRM150156`, 7,5 m de gaine, pas de tuyau |
| **J. CFG-37** POLYPERF Ø150, bas de conduit « RDE + plaque ventilée » | buse 1,05 · HSP 2,5 · conduit 6,2 · boisseau 30×30 | 9 lignes, **1 100,11 €**, kit `2FLIPOPEN1507` (7 m pour 6,7 nécessaires). Passer le bas sur « Griffaflex » : les tuyaux disparaissent |
| **K. CFG-30** kit rénovation PLA Ø80, plafond | buse 0,9 · HSP 2,4 · conduit 6 · boisseau 20×20 | 7 lignes, **411,04 €**, adaptateurs `2PLAADA6802020` / `2PLAADA7802020` |
| **L. CFG-31** conduit isolé existant Ø80, mur | piquage 1,3 · horizontal 0,4 · conduit 6 · boisseau 25×25 | 7 lignes, **2 à chiffrer** (adaptateurs n°4 / n°2 sur mesure) |
| **M. CFG-29** ventouse Ø80 | buse 0,9 · axe de sortie 1,8 · horizontal 0,6 · mur 0,3 | 8 lignes, **361,09 €**, ⚠ « zone 3 non vérifiée » |
| **N. CFG-25** façade PTR Ø150 noir | buse 1,05 · HSP 2,5 · traversée 1,6 · appareil→mur 0,6 · mur 0,3 · égout 5,5 · pente 35 · faîtage 4 · sommet +3,5 | 14 lignes, **2 216,86 €**, zone 1 ✓, ⚠ haubanage (> 3 m), 4 supports muraux `2DIVSUMIR210NO`. Bouton « Ajuster » : le sommet descend au minimum de zone 1 |
| **O. CFG-33** façade PLA + PTR Ø80 inox | idem N avec pente 30, faîtage 3, sommet +2,5 | 15 lignes, **1 à chiffrer** (support de départ Ø80) |
| **P. CFG-32** création PTR + souche Polytoit Ø150 (relevé de la maquette) | comme le test A | 10 lignes, **1 731,48 €**, souche `2SOU109L3238PTG150` (pente 35 → 32-38°) ; pente 20 → `2SOU107L1623PTG150` |
| **Q. CFG-42** foyer via combles + Polytoit + PRH hotte Ø150 | maquette, sans dévoiement | 12 lignes, **1 697,09 €** |
| **R. CFG-28** création PLA Ø80 étanche | maquette, Ø80, inox | 14 lignes, **983,31 €**, collerette `2PLACSOL80RT` |
| **S. CFG-48** chaudière PLA Ø100 | maquette, Ø100, sans dévoiement | 15 lignes, **1 à chiffrer** (solin Ø100), condition bloquante (modèle de chaudière) affichée |
| **T. CFG-40** MFI Ø150 inox | maquette | 15 lignes, **2 376,42 €**, solin `2DIVS2535IN250KEI`, kit de raccordement **à chiffrer** (1 kit par appareil) |

## Choix métier à valider (Philippe) — tranche 3
- Façade : 1 support mural tous les 2 m (réglage), té 90° + purge au pied, 2 plaques de propreté pour la traversée de mur, coude 90° émaillé quel que soit le tuyau.
- Souche Polytoit : « Souche 1000 corps lisse, hauteur 700/800/900 selon la pente, PTR G » + raccord Polytoit + collier de fixation bas.
- PLA : manchon F/M recoupable sur l'appareil, té de piquage d'air, adaptateurs n°6 / n°7 inox (V1) par section de boisseau.
- POLYPERF : kit fibre de N m (pièces de finition incluses), kit bas pour plaque ventilée, collier de gaine au Ø nominal.
- MFI : té 135° piquage air Ø100 par défaut, kit de raccordement à chiffrer d'après la fiche appareil (R-MFI-01).
- Ventouse (zone 3) : terminal horizontal inox standard, rosace plate 2 parties ; distances réglementaires non vérifiées.

## Retours d'usage
_(à remplir)_
