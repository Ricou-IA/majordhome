-- Une seule écriture par grand secteur (Eric, 2026-11-15).
--
-- Le nom d'un grand secteur vient d'une ville saisie sur une fiche client, où la même
-- ville est écrite « ALBI » ou « Albi » selon la fiche. Le moteur côté serveur passait
-- déjà ses noms par normaliserSecteur (src/lib/tournee/secteurs.js : « Albi »,
-- « L'Union », « Cordes Sur Ciel »), mais la pose d'un RDV depuis l'écran figeait le nom
-- brut : mesuré avant migration, 333 RDV sur 631 portaient une écriture en majuscules
-- (ALBI 39 / Albi 26, LAVAUR 104 / Lavaur 9, GRAULHET 36 / Graulhet 2…).
--
-- Correction de données, sans changement de structure : la même règle, écrite en SQL
-- (vérifiée valeur par valeur contre la règle JS sur les 29 écritures présentes en base),
-- appliquée aux trois tables qui portent un nom de secteur. Rejouable : une valeur déjà
-- à la bonne écriture n'est pas touchée. Le code (entretiens.service, appointments.service)
-- écrit désormais la bonne écriture à la source.
--
-- Le journal d'audit des RDV garde la trace de chaque changement (« Grand secteur :
-- ALBI → Albi », auteur « Système ») : voulu, c'est une modification réelle.
DO $$
DECLARE
  v_rdv int;
  v_journees int;
  v_propositions int;
  v_doublons int;
BEGIN
  -- Même règle que normaliserSecteur : espaces resserrés, tout en minuscules, puis
  -- majuscule à la première lettre de chaque mot (après début, espace, apostrophe, tiret).
  CREATE FUNCTION pg_temp.ecriture_secteur(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $f$
    SELECT string_agg(upper(left(m[1], 1)) || substr(m[1], 2) || m[2], '' ORDER BY ord)
    FROM regexp_matches(
      lower(regexp_replace(btrim(p), '\s+', ' ', 'g')),
      '([^ ''’-]*)([ ''’-]?)', 'g'
    ) WITH ORDINALITY AS t(m, ord)
  $f$;

  UPDATE majordhome.appointments
     SET grand_secteur = pg_temp.ecriture_secteur(grand_secteur)
   WHERE grand_secteur IS NOT NULL
     AND btrim(grand_secteur) <> ''
     AND grand_secteur IS DISTINCT FROM pg_temp.ecriture_secteur(grand_secteur);
  GET DIAGNOSTICS v_rdv = ROW_COUNT;

  UPDATE majordhome.journees_secteur
     SET grand_secteur = pg_temp.ecriture_secteur(grand_secteur)
   WHERE grand_secteur IS NOT NULL
     AND btrim(grand_secteur) <> ''
     AND grand_secteur IS DISTINCT FROM pg_temp.ecriture_secteur(grand_secteur);
  GET DIAGNOSTICS v_journees = ROW_COUNT;

  UPDATE majordhome.agent_propositions
     SET grand_secteur = pg_temp.ecriture_secteur(grand_secteur)
   WHERE grand_secteur IS NOT NULL
     AND btrim(grand_secteur) <> ''
     AND grand_secteur IS DISTINCT FROM pg_temp.ecriture_secteur(grand_secteur);
  GET DIAGNOSTICS v_propositions = ROW_COUNT;

  -- Garde : plus aucun secteur écrit de deux façons, sinon tout est annulé.
  SELECT count(*) INTO v_doublons FROM (
    SELECT lower(grand_secteur)
      FROM (
        SELECT grand_secteur FROM majordhome.appointments WHERE grand_secteur IS NOT NULL
        UNION ALL SELECT grand_secteur FROM majordhome.journees_secteur WHERE grand_secteur IS NOT NULL
        UNION ALL SELECT grand_secteur FROM majordhome.agent_propositions WHERE grand_secteur IS NOT NULL
      ) v
     GROUP BY 1
    HAVING count(DISTINCT grand_secteur) > 1
  ) d;
  IF v_doublons > 0 THEN
    RAISE EXCEPTION 'garde: % secteur(s) encore écrit(s) de deux façons', v_doublons;
  END IF;

  DROP FUNCTION pg_temp.ecriture_secteur(text);
  RAISE NOTICE 'grand_secteur réaligné : % RDV, % journées, % propositions', v_rdv, v_journees, v_propositions;
END $$;
