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
3. CFG-34 → Relevé. Saisir : Ø **80**, buse 0,9, entrée **par le plafond**, HSP 2,4, tuyau **Émaillé 0,7 mm**, hauteur du conduit **6,2**, boisseau **20 × 20**, chapeau Standard, kit d'air **Oui**.
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
