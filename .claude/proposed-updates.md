## [2026-04-26 14:59] Séquence DB client_number — gotcha race condition
**Statut** : RESOLU
**Commit** : 58892c7829f69fc9c0ec4fa078d34be2db71f1b9
**Contexte** : Le cron `pennylane-sync-cron` calculait manuellement `client_number` via `SELECT MAX(client_number) + 1`, ce qui désynchronisait la séquence PostgreSQL `majordhome.client_number_seq`. Quand le frontend créait un client ensuite, le DEFAULT de la séquence générait un numéro déjà utilisé → duplicate key error. Fix : retirer le calcul manuel, laisser le DEFAULT DB générer atomiquement via la séquence.
**Proposition** : Ajouter un gotcha dans la section "Base de Données (Supabase)" ou "Conventions de Code" :
**Gotcha séquences PostgreSQL** : Ne JAMAIS calculer manuellement un ID/numéro via `SELECT MAX(col) + 1`. Toujours laisser le DEFAULT de la séquence DB (`nextval()`) générer la valeur automatiquement — atomique, évite race conditions et désynchronisation. Exemple : `majordhome.client_number` utilise `majordhome.client_number_seq`, toute insertion doit omettre `client_number` pour que le DEFAULT s'applique.
---

## [2026-04-26 14:59] Pattern sync Pennylane fire-and-forget
**Statut** : RESOLU
**Commit** : 58892c7829f69fc9c0ec4fa078d34be2db71f1b9
**Contexte** : `ClientModal` appelle désormais `usePennylaneSyncClient().syncClient()` après création client, en fire-and-forget (`.catch()` pour logger les erreurs silencieusement). L'UX n'est pas bloquée si l'API Pennylane est lente ou indisponible. Le code 411 Pennylane est récupéré et stocké automatiquement dans `clients.pennylane_account_number`.
**Proposition** : Documenter le pattern de synchronisation Pennylane dans une nouvelle section ou intégrer dans "Conventions de Code" :
**Sync Pennylane** : Sync automatique MDH→Pennylane après création client via `usePennylaneSyncClient` (fire-and-forget, ne bloque pas UX). Le code 411 Pennylane est récupéré et stocké dans `clients.pennylane_account_number`. Erreurs loggées silencieusement (console.warn). Cron `pennylane-sync-cron` : ne calcule JAMAIS `client_number` manuellement, laisse la séquence DB générer la valeur (évite race condition + duplicate key).
OU
Est-ce que la stratégie fire-and-forget doit s'appliquer à d'autres services (geocoding, etc.) ? Faut-il documenter un pattern général de sync externe non-bloquant ?
---

## [2026-04-27 10:20] Documentation URL Google Place ID Finder et pattern d'aide contextuelle
**Statut** : RESOLU
**Commit** : dc25013f3ff7c3db3102e37a26db82a8492b95ac
**Contexte** : Ajout d'un bouton "Trouver" avec lien externe vers la documentation Google Place ID Finder (https://developers.google.com/maps/documentation/places/web-service/place-id) dans le formulaire GeoGrid. Le tooltip rappelle de chercher le business (pas l'adresse postale). Pattern d'aide contextuelle avec icône ExternalLink.
**Proposition** : Faut-il documenter l'URL de référence Google Place ID Finder dans la section Module GeoGrid du CLAUDE.md ? Et/ou documenter le pattern UI "aide contextuelle avec lien externe + tooltip" dans les conventions de code composants ?
---

## [2026-04-27 10:57] GeoGrid : sélecteur de ville source de vérité + sync Place ID org
**Statut** : REJETE
**Commit** : 024aed6852afa8bd5771b504bd7ced1735d10e2a
**Contexte** : Refactor `ScanConfigPanel.jsx` : `selectedCityCode` est maintenant le state explicite (au lieu de `centerLat/centerLng` dans config + dérivation inverse). Les coordonnées sont calculées à partir de la ville sélectionnée au moment du submit. Élimine le risque de désynchro entre l'affichage du sélecteur et les coordonnées envoyées au scan. Ajout d'un affichage des coordonnées sous le sélecteur pour vérification visuelle. Pattern synchronisation automatique du `placeId` avec `businessName` : si le nom saisi correspond à l'org (insensible casse/espaces), le `placeId` stocké dans `organization.settings.google_place_id` est auto-rempli (badge AUTO vert). Si le nom ne correspond plus, le `placeId` est vidé pour permettre saisie manuelle.
**Décision** : Rejeté — info déjà couverte dans la section GeoGrid de CLAUDE.md (`google_place_id` dans `core.organizations.settings`). Pattern UI trop spécifique pour une convention générale.
---

## [2026-04-27 12:42] Master prompt SEO audit site web Mayer
**Statut** : REJETE
**Commit** : d1a47f4d248594a9b8087bac2c52215ec93a41b4
**Contexte** : Création du fichier `docs/SEO_AUDIT_MASTER_PROMPT.md` (293 lignes) — prompt complet pour session Claude dédiée à l'audit SEO et stratégie de contenus du site mayer-energie.fr (repo séparé `C:\Dev\Landing Page - Mayer`).
**Décision** : Rejeté — déjà mentionné dans la section "Module GeoGrid Rank Tracker" → "Master prompt SEO (session séparée)" de CLAUDE.md.
---

## [2026-04-27 12:42] Loop frontend séquentiel pour benchmarks vs edge function batch
**Statut** : REJETE
**Commit** : d1a47f4d248594a9b8087bac2c52215ec93a41b4
**Contexte** : `BenchmarkLauncher.jsx` implémente un loop frontend qui lance 1 scan à la fois en séquentiel. Alternative architecturale possible : modifier l'edge function pour accepter un array de keywords et gérer le loop côté backend.
**Décision** : Rejeté — décision visible dans le code et commits. Pas critique de la formaliser tant qu'elle n'est pas remise en cause.
---

## [2026-04-27 12:42] Pattern auto-tag famille keywords par regex
**Statut** : REJETE
**Commit** : d1a47f4d248594a9b8087bac2c52215ec93a41b4
**Contexte** : `BenchmarkResultTable.jsx` définit une fonction `detectFamily(keyword)` qui matche par regex (Poêle / Ramonage / Clim / PAC / Chauffage / Entretien). Si un nouveau métier Mayer arrive (ex: ventilation, VMC), il faudra étendre le pattern.
**Décision** : Rejeté — déjà mentionné en 1 ligne dans la section GeoGrid de CLAUDE.md. Extraction en module séparé à reconsidérer si nouveaux métiers ajoutés.
---

## [2026-04-27 13:10] Vérification explicite erreur UPDATE benchmark_id (anti silent failure)
**Statut** : RESOLU
**Commit** : 567557f518f3ac359cef5f39bdd8831e92f46d0f
**Contexte** : `BenchmarkLauncher.jsx` ajoutait un lien `benchmark_id` sur le scan créé via un `UPDATE` Supabase, mais sans vérifier l'erreur retournée. Un trigger fantôme (`set_geogrid_scans_updated_at`) tentait de set une colonne `updated_at` inexistante → UPDATE échouait silencieusement.
**Décision** : Intégré dans CLAUDE.md section Gotchas DB (validé par utilisateur 2026-04-27).
---

## [2026-04-27 13:37] UI benchmarks : cards famille cliquables + filtre actif tableau
**Statut** : REJETE
**Commit** : b2da534a15221bda55d320db8199b2c76fcb71ee
**Contexte** : `BenchmarkResultTable.jsx` — les 6-7 cards famille sont maintenant cliquables pour filtrer le tableau sur une famille uniquement. Click sur card = toggle. Card sélectionnée : ring + shadow ; non sélectionnées : opacity 40%.
**Décision** : Rejeté — UX validée par utilisateur, pas de gotcha technique à documenter.
---
