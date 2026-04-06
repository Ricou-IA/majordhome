# Prompt de refactorisation — Session Certificats multi-équipements (2026-04-06/07)

## Contexte
Session de vibe coding intensive qui a produit du code fonctionnel mais nécessitant un nettoyage. Tout fonctionne et le build passe. L'objectif est de rendre le code propre, maintenable et cohérent avec les patterns du projet.

## Fichiers à refactoriser (par priorité)

### 1. `EntretienSAVModal.jsx` (~700 LOC) — PRIORITÉ HAUTE
**Problème** : La section certificats (lazy create enfants, progress bar, liste CertificatEquipmentRow, handlers néant) a été ajoutée inline dans le composant. Ça l'alourdit considérablement.
**Action** : Extraire une section `CertificatsSection.jsx` qui encapsule :
- Les hooks `useCertificatChildren` + `useCertificatEntretienMutations`
- Le state `certEquipments`, `certMutatingId`, `certCreatingRef`
- Le useEffect de lazy create
- Le rendu (progress bar + liste CertificatEquipmentRow)
- Props : `item`, `onClose` (pour CertificatLink onCloseModal)

### 2. `sav.service.js` (~690 LOC) — PRIORITÉ HAUTE
**Problème** : 5 méthodes certificats ajoutées en bloc à la fin. Import circulaire potentiel avec `entretiensService`.
**Action** :
- Vérifier que l'import `entretiensService` ne crée pas de cycle
- Éventuellement extraire les méthodes certificats dans un fichier séparé `certificats-workflow.service.js` ou les garder groupées avec un commentaire de section clair
- Ajouter les JSDoc manquants

### 3. `CertificatsEntretienModal.jsx` — PRIORITÉ MOYENNE
**Problème** : Fichier créé mais plus utilisé (section intégrée dans EntretienSAVModal). Il a encore le code de gestion mail + save notes qui n'est pas dans EntretienSAVModal.
**Action** : Soit le supprimer (dead code), soit le garder comme modale standalone pour un usage futur (ex: ouverture depuis la fiche client). Si gardé, synchroniser les fonctionnalités avec la section intégrée.

### 4. `EquipmentFormModal.jsx` — PRIORITÉ MOYENNE
**Problème** : Le changement de `form.brand`/`form.model` de IDs vers texte libre a modifié la logique du `handleSubmit`. L'ancien code résolvait les noms depuis les IDs, le nouveau passe directement le texte. Vérifier que tous les consumers (ajout/édition équipement) gèrent correctement les deux cas.
**Action** :
- Vérifier `handleEquipmentSubmit` dans les pages qui utilisent ce modal
- S'assurer que le `supplierProductId` est bien set quand un produit connu est sélectionné
- Tester : créer un équipement avec une marque libre, puis avec une marque connue

### 5. `CertificatWizard.jsx` — PRIORITÉ BASSE
**Problème** :
- Import `useAuth` ajouté pour `profile.full_name` — vérifier que ça ne re-render pas excessivement
- `savService` remplacé par `supabase` direct pour la transition realise — inconsistant avec le pattern service
**Action** :
- Remplacer le `supabase.update` direct (ligne ~327) par un appel service (`savService.updateWorkflowStatus` étendu pour mettre aussi `status`)
- Ou ajouter une méthode `savService.markRealise(interventionId)` qui fait les deux updates

### 6. `TabInterventions.jsx` — PRIORITÉ BASSE
**Problème** : Le tri parent/enfants est fait avec une IIFE inline dans le JSX, ce qui est dur à lire.
**Action** : Extraire dans un `useMemo` en haut du composant

### 7. `CertificatEntretien.jsx` (page) — PRIORITÉ BASSE
**Problème** : `parentDate` state + useEffect pour charger la date du parent — pourrait être un hook custom
**Action** : Optionnel, c'est propre tel quel

## Vérifications post-refacto

1. `npx vite build` — zéro erreur
2. Ouvrir le Kanban Entretiens → cartes affichées, pas de doublons
3. Cliquer une carte `planifie` → modale avec section certificats, boutons Remplir/Néant
4. Cliquer "Remplir" → wizard certificat, nom technicien pré-rempli, date correcte
5. Générer PDF → logo, titre centré, signature technicien, pas de TVA
6. Retour auto après génération → modale se rouvre, statut "Rempli"
7. Marquer Néant → badge gris, barre progression avance
8. Tous traités → transition parent realise automatique
9. Bouton "Valider facturation" sur carte → carte disparaît
10. Fiche client > Interventions → parent compact + enfants indentés, compteur correct
11. Fiche client > Équipements → combobox marque/modèle fonctionne (libre + suggestions)

## Patterns du projet à respecter
- Services : `{ data, error }` return pattern
- Hooks : TanStack React Query v5, `staleTime`, cache keys centralisées (`cacheKeys.js`)
- Composants : .jsx PascalCase, Tailwind, toast sonner, FormFields partagés
- Pas de `supabase` direct dans les composants — passer par les services
- JSDoc sur les méthodes de service
