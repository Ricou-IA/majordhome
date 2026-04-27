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
