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
