# Référence des Tables Supabase utilisées dans l'application

Ce document liste tous les fichiers qui interrogent Supabase et les tables qu'ils utilisent, pour vous aider à adapter votre schéma de base de données.

## 📋 Tables utilisées

### Tables du schéma `public` (par défaut)

#### 1. **`leads`** - Table des leads/pistes commerciales
- **Fichiers utilisateurs :**
  - `src/hooks/pipeline/useDashboardData.js` (lignes 116, 136)
- **Champs utilisés :**
  - `id`
  - `created_date` (date de création)
  - `is_deleted` (booléen)
  - `assigned_user_id` (ID utilisateur assigné)
  - `source_id` (ID de la source)
  - `order_amount_ht` (montant HT de la commande)
  - Relations : `statuses(label)`, `sources(name, id)`

#### 2. **`sources`** - Table des sources de leads
- **Fichiers utilisateurs :**
  - `src/hooks/pipeline/useDashboardData.js` (ligne 149)
  - `src/components/pipeline/dashboard/DashboardFilters.jsx` (ligne 34)
- **Champs utilisés :**
  - `id`
  - `name`
  - `is_active` (booléen)

#### 3. **`monthly_source_costs`** - Coûts mensuels par source
- **Fichiers utilisateurs :**
  - `src/hooks/pipeline/useDashboardData.js` (lignes 153, 159)
- **Champs utilisés :**
  - `cost_amount` (montant du coût)
  - `source_id` (ID de la source)
  - `month` (format: "YYYY-MM")

#### 4. **`statuses`** - Table des statuts (relation avec leads)
- **Fichiers utilisateurs :**
  - `src/hooks/pipeline/useDashboardData.js` (via relation avec leads)
- **Champs utilisés :**
  - `label` (ex: "Rendez-vous", "Vendu")

#### 5. **`projects`** - Table des projets/clients
- **Fichiers utilisateurs :**
  - `src/shared/services/clients.service.js` (lignes 162, 229, 317, 367, 467, 498, 692, 701, 711, 751)
- **Structure :**
  - Contient les clients avec un champ `identity` (JSON) contenant :
    - `email`
    - `phone`
    - `address`
    - `client_type`
    - `first_name`
    - `last_name`
    - etc.

#### 6. **`majordhome_equipments`** - Table des équipements
- **Fichiers utilisateurs :**
  - `src/shared/services/clients.service.js` (lignes 238, 528, 552, 609, 634)
- **Utilisation :**
  - Gestion des équipements clients avec contrats

#### 7. **`majordhome_interventions`** - Table des interventions
- **Fichiers utilisateurs :**
  - `src/shared/services/clients.service.js` (lignes 247, 661)
- **Utilisation :**
  - Historique des interventions sur les équipements

### Tables du schéma `core`

#### 8. **`profiles`** - Profils utilisateurs
- **Fichiers utilisateurs :**
  - `src/shared/services/auth.service.js` (lignes 229-233, 253-260)
  - `src/components/pipeline/dashboard/DashboardFilters.jsx` (ligne 36)
- **Champs utilisés :**
  - `id` (correspond à user_id de Supabase Auth)
  - `full_name`
  - `user_id` (alternative à id)

#### 9. **`organizations`** - Organisations
- **Fichiers utilisateurs :**
  - `src/shared/services/auth.service.js` (via relation avec organization_members)
- **Utilisation :**
  - Gestion des organisations multi-tenant

#### 10. **`organization_members`** - Membres d'organisations
- **Fichiers utilisateurs :**
  - `src/shared/services/auth.service.js` (lignes 286-294)
- **Champs utilisés :**
  - `id`
  - `user_id`
  - `role` (ex: 'org_admin', 'team_leader')
  - `status` (ex: 'active')
  - `joined_at`
  - Relation : `organization:organizations(*)`

### Fonctions RPC (Remote Procedure Call)

#### 11. **`join_organization_by_code`** - Fonction RPC
- **Fichiers utilisateurs :**
  - `src/shared/services/auth.service.js` (ligne 328)
- **Paramètres :**
  - `p_invite_code` (string) - Code d'invitation

---

## 📁 Fichiers détaillés

### 1. `src/hooks/pipeline/useDashboardData.js`
**Tables utilisées :**
- `leads` (2 requêtes)
- `sources` (1 requête)
- `monthly_source_costs` (2 requêtes)
- `statuses` (via relation avec leads)

**Opérations :**
- Lecture de leads avec filtres par période, utilisateur, source
- Calcul de métriques (leads, rendez-vous, ventes, CA)
- Calcul de ROI par source
- Tendances mensuelles sur 6 mois

### 2. `src/shared/services/clients.service.js`
**Tables utilisées :**
- `projects` (10 requêtes)
- `majordhome_equipments` (5 requêtes)
- `majordhome_interventions` (2 requêtes)

**Opérations :**
- CRUD complet sur les clients (projects)
- Gestion des équipements
- Historique des interventions
- Recherche et filtrage

### 3. `src/shared/services/auth.service.js`
**Tables utilisées :**
- `core.profiles` (lecture/écriture)
- `core.organization_members` (lecture)
- `core.organizations` (via relation)
- RPC: `join_organization_by_code`

**Opérations :**
- Authentification (via Supabase Auth)
- Gestion des profils utilisateurs
- Gestion des organisations et membres
- Rôles et permissions

### 4. `src/components/pipeline/dashboard/DashboardFilters.jsx`
**Tables utilisées :**
- `sources` (lecture)
- `profiles` (lecture, si admin)

**Opérations :**
- Liste des sources actives
- Liste des commerciaux (profils)

### 5. `src/contexts/AuthContext.jsx`
**Utilisation :**
- `supabase.auth.getSession()` - Récupération de session
- `supabase.auth.onAuthStateChange()` - Écoute des changements d'état

**Note :** N'utilise pas directement les tables, mais gère l'authentification.

---

## 🔧 Schéma SQL suggéré

Voici un exemple de schéma pour les tables principales (à adapter selon vos besoins) :

```sql
-- Table leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date DATE NOT NULL,
  is_deleted BOOLEAN DEFAULT false,
  assigned_user_id UUID REFERENCES auth.users(id),
  source_id UUID REFERENCES sources(id),
  order_amount_ht DECIMAL(10,2),
  status_id UUID REFERENCES statuses(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table sources
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table monthly_source_costs
CREATE TABLE monthly_source_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES sources(id),
  month TEXT NOT NULL, -- Format: "YYYY-MM"
  cost_amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(source_id, month)
);

-- Table statuses
CREATE TABLE statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table projects (clients)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity JSONB, -- Contient email, phone, address, client_type, etc.
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table majordhome_equipments
CREATE TABLE majordhome_equipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  equipment_type TEXT,
  contract_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table majordhome_interventions
CREATE TABLE majordhome_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID REFERENCES majordhome_equipments(id),
  intervention_date DATE,
  intervention_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## ⚠️ Notes importantes

1. **Schéma `core`** : Les tables `profiles`, `organizations`, et `organization_members` sont dans le schéma `core`. Assurez-vous que ce schéma existe et que les permissions sont correctes.

2. **Relations** : Les requêtes utilisent des relations Supabase (syntaxe `!inner`, `:relation_name(*)`). Assurez-vous que les foreign keys sont bien définies.

3. **RLS (Row Level Security)** : Vérifiez que les politiques RLS sont configurées pour permettre l'accès aux données selon les rôles.

4. **Index** : Pour de meilleures performances, créez des index sur :
   - `leads.created_date`
   - `leads.assigned_user_id`
   - `leads.source_id`
   - `leads.is_deleted`
   - `monthly_source_costs.month`
   - `monthly_source_costs.source_id`

5. **Fonction RPC** : La fonction `join_organization_by_code` doit être créée dans votre base de données.

---

## 📝 Checklist pour adapter votre base de données

- [ ] Créer la table `leads` avec tous les champs nécessaires
- [ ] Créer la table `sources`
- [ ] Créer la table `monthly_source_costs`
- [ ] Créer la table `statuses` avec au moins les statuts "Rendez-vous" et "Vendu"
- [ ] Créer la table `projects` (ou adapter votre table clients existante)
- [ ] Créer les tables `majordhome_equipments` et `majordhome_interventions`
- [ ] Créer le schéma `core` s'il n'existe pas
- [ ] Créer les tables `core.profiles`, `core.organizations`, `core.organization_members`
- [ ] Créer la fonction RPC `join_organization_by_code`
- [ ] Configurer les foreign keys et relations
- [ ] Configurer les politiques RLS
- [ ] Créer les index pour les performances
