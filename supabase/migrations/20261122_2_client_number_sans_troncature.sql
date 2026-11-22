-- 20261122_2 — Numéros de client : le défaut ne tronque plus au-delà de 99 999.
--
-- Constat (production, 2026-11-22) : le défaut de `majordhome.clients.client_number` était
--   'CLI-' || lpad(nextval('majordhome.client_number_seq')::text, 5, '0')
-- Or `lpad(texte, 5, …)` COUPE un texte de plus de 5 caractères : au numéro 100 000 il rend « 10000 », donc
-- « CLI-10000 », déjà pris. La contrainte d'unicité `clients_client_number_key` refuserait alors toute création
-- de client, pour TOUTES les entreprises (la séquence est commune à la base partagée). La séquence est à 4 065 ;
-- l'import de clients (20261121_13) consomme des numéros par milliers.
--
-- Correctif : le numéro passe par une fonction qui ne lit la séquence qu'UNE fois — cinq chiffres complétés par
-- des zéros jusqu'à 99 999 (forme inchangée : CLI-04066), le nombre entier au-delà (CLI-100000). Une expression
-- de défaut ne peut pas réutiliser deux fois la même valeur de `nextval` sans fonction. La colonne est un
-- varchar(20) : la place ne manque pas. Aucun numéro existant n'est touché.
--
-- Hors périmètre, même défaut à corriger un jour (séquences encore loin du seuil au 2026-11-22) :
--   contracts.contract_number (lpad 5, séquence à 910), certificats.reference (lpad 5, à 1 728),
--   webshop_orders.order_number (lpad 4, à 15), et la fonction `public.majordhome_clients_all_insert_fn`
--   (même formule en dur ; plus aucun trigger ne l'appelle).

-- Base partagée : changer un défaut demande un verrou bref sur `clients` ; mieux vaut échouer et rejouer
-- que faire attendre les autres requêtes derrière une longue lecture.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION majordhome.client_number_suivant()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = majordhome, public, pg_temp
AS $$
  SELECT 'CLI-' || CASE WHEN s.n < 100000 THEN lpad(s.n::text, 5, '0') ELSE s.n::text END
    FROM (SELECT nextval('majordhome.client_number_seq') AS n) AS s;
$$;

COMMENT ON FUNCTION majordhome.client_number_suivant() IS
  'Prochain numéro de client : CLI- + cinq chiffres jusqu''à 99 999, le nombre entier au-delà. Seule définition de la forme du numéro.';

-- Pas SECURITY DEFINER : elle s'exécute avec les droits de qui insère, comme le `nextval` du défaut précédent.
-- Les rôles qui insèrent dans `majordhome.clients` (authenticated, service_role) doivent pouvoir l'exécuter ;
-- personne d'autre.
REVOKE ALL ON FUNCTION majordhome.client_number_suivant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.client_number_suivant() TO authenticated, service_role;

ALTER TABLE majordhome.clients
  ALTER COLUMN client_number SET DEFAULT majordhome.client_number_suivant();

RESET lock_timeout;
