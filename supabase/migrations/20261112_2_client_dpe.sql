-- 20261112_2 — Logement MonsieurDPE : le DPE rattaché à chaque client et la carte du logement.
-- Spec : docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md (§5, §7).
--
-- Une ligne par client. Écrite par la SEULE edge function `dpe-lien`, via `client_dpe_record` (service_role) qui
-- tient `clients.dpe_number` cohérent dans la même transaction. Lecture : tout membre de l'organisation.
-- org_id = organisation CORE (comme clients.org_id).
--
-- Origine du numéro : auto (rattachement automatique) | choisi (un humain a choisi parmi des candidats) |
-- saisi (tapé dans le champ de la fiche). Un numéro choisi ou saisi n'est JAMAIS remplacé par un rattachement
-- automatique (garde dans la fonction, en plus de la règle de l'écran).

CREATE TABLE IF NOT EXISTS majordhome.client_dpe (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  client_id            uuid NOT NULL UNIQUE REFERENCES majordhome.clients(id) ON DELETE CASCADE,
  dpe_number           text CHECK (dpe_number IS NULL OR dpe_number ~ '^[0-9A-Za-z]{13}$'),
  origine              text CHECK (origine IN ('auto', 'choisi', 'saisi')),
  etat                 text NOT NULL CHECK (etat IN ('rattache', 'candidats', 'aucun_dpe', 'adresse_non_trouvee', 'detache', 'erreur')),
  adresse_tentee       text,
  tente_le             timestamptz,
  candidats            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ecartes              text[] NOT NULL DEFAULT '{}',
  voisinage            boolean NOT NULL DEFAULT false,
  -- colonnes filtrables (src/lib/dpeCorpus.js::colonnesFiltrables), pour la prospection
  etiquette_dpe        text,
  etiquette_ges        text,
  energie_chauffage    text,
  generateur_chauffage text,
  surface              numeric,
  periode_construction text,
  date_dpe             date,
  rapport_complet      boolean,
  -- la carte complète (mapCorpusDossier) et sa version
  carte                jsonb,
  version_carte        integer,
  lu_le                timestamptz,
  rattache_par         uuid,
  rattache_le          timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE majordhome.client_dpe IS
  'DPE rattaché à un client (corpus MonsieurDPE) et carte du logement. Écrit par la seule edge dpe-lien via client_dpe_record.';

CREATE INDEX IF NOT EXISTS client_dpe_org_idx ON majordhome.client_dpe (org_id);

ALTER TABLE majordhome.client_dpe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_dpe_select ON majordhome.client_dpe;
CREATE POLICY client_dpe_select ON majordhome.client_dpe
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

REVOKE ALL ON majordhome.client_dpe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.client_dpe TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_client_dpe
WITH (security_invoker = true) AS
SELECT id, org_id, client_id, dpe_number, origine, etat, adresse_tentee, tente_le, candidats, ecartes, voisinage,
       etiquette_dpe, etiquette_ges, energie_chauffage, generateur_chauffage, surface, periode_construction, date_dpe,
       rapport_complet, carte, version_carte, lu_le, rattache_par, rattache_le, updated_at
FROM majordhome.client_dpe;

REVOKE ALL ON public.majordhome_client_dpe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_client_dpe TO authenticated, service_role;

-- Écriture : service_role seul (org_id en paramètre).
--   p_action = 'tentative'  : résultat d'un rattachement (etat, adresse_tentee, candidats ; si rattache : numéro + carte, origine auto)
--              'choisir'    : un humain choisit un numéro (origine choisi)
--              'actualiser' : relecture de la carte du numéro de la fiche (origine fournie : saisi si le numéro a changé)
--              'detacher'   : « Ce n'est pas le bon » — numéro écarté, fiche vidée
CREATE OR REPLACE FUNCTION public.client_dpe_record(
  p_org_id    uuid,
  p_client_id uuid,
  p_action    text,
  p_patch     jsonb,
  p_user      uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_client_org  uuid;
  v_fiche       text;
  v_ligne       majordhome.client_dpe;
  v_numero      text := nullif(trim(coalesce(p_patch->>'dpe_number', '')), '');
  v_etat        text := coalesce(p_patch->>'etat', 'rattache');
  v_origine     text;
  v_avec_carte  boolean := p_patch ? 'carte' AND jsonb_typeof(p_patch->'carte') = 'object';
BEGIN
  IF p_org_id IS NULL OR p_client_id IS NULL OR p_action IS NULL THEN
    RAISE EXCEPTION 'client_dpe_invalid';
  END IF;
  SELECT c.org_id, nullif(trim(coalesce(c.dpe_number, '')), '') INTO v_client_org, v_fiche
    FROM majordhome.clients c WHERE c.id = p_client_id FOR UPDATE;
  IF (v_client_org = p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'client_dpe_client_org_mismatch';
  END IF;
  SELECT * INTO v_ligne FROM majordhome.client_dpe WHERE client_id = p_client_id FOR UPDATE;

  IF p_action = 'tentative' THEN
    -- Un numéro posé par un humain (choisi ou saisi, ou présent sur la fiche sans ligne) n'est jamais remplacé.
    IF v_fiche IS NOT NULL AND (v_ligne.id IS NULL OR v_ligne.origine IS DISTINCT FROM 'auto') THEN
      RAISE EXCEPTION 'client_dpe_saisi_protege';
    END IF;
    IF v_etat = 'rattache' AND v_numero IS NULL THEN RAISE EXCEPTION 'client_dpe_invalid'; END IF;
    IF v_etat = 'rattache' AND v_numero = ANY (coalesce(v_ligne.ecartes, '{}')) THEN
      RAISE EXCEPTION 'client_dpe_numero_ecarte';
    END IF;
    v_origine := CASE WHEN v_etat = 'rattache' THEN 'auto' END;
    IF v_etat <> 'rattache' THEN v_numero := NULL; END IF;
  ELSIF p_action = 'choisir' THEN
    IF v_numero IS NULL THEN RAISE EXCEPTION 'client_dpe_invalid'; END IF;
    v_origine := 'choisi'; v_etat := 'rattache';
  ELSIF p_action = 'actualiser' THEN
    v_origine := coalesce(p_patch->>'origine', v_ligne.origine, 'saisi');
    v_etat := CASE WHEN v_numero IS NULL THEN 'detache' ELSE 'rattache' END;
  ELSIF p_action = 'detacher' THEN
    v_origine := NULL; v_etat := 'detache'; v_numero := NULL;
  ELSE
    RAISE EXCEPTION 'client_dpe_action_inconnue';
  END IF;

  INSERT INTO majordhome.client_dpe AS t (
    org_id, client_id, dpe_number, origine, etat, adresse_tentee, tente_le, candidats, ecartes, voisinage,
    etiquette_dpe, etiquette_ges, energie_chauffage, generateur_chauffage, surface, periode_construction, date_dpe,
    rapport_complet, carte, version_carte, lu_le, rattache_par, rattache_le, updated_at
  ) VALUES (
    p_org_id, p_client_id, v_numero, v_origine, v_etat,
    coalesce(p_patch->>'adresse_tentee', v_ligne.adresse_tentee),
    CASE WHEN p_action = 'tentative' THEN now() ELSE v_ligne.tente_le END,
    CASE WHEN p_action = 'tentative' THEN coalesce(p_patch->'candidats', '[]'::jsonb) ELSE coalesce(v_ligne.candidats, '[]'::jsonb) END,
    CASE WHEN p_action = 'detacher' AND v_ligne.dpe_number IS NOT NULL
         THEN array_append(coalesce(v_ligne.ecartes, '{}'), v_ligne.dpe_number)
         ELSE coalesce(v_ligne.ecartes, '{}') END,
    CASE WHEN p_action = 'choisir' THEN coalesce((p_patch->>'voisinage')::boolean, false)
         WHEN p_action IN ('tentative', 'detacher') THEN false
         ELSE coalesce(v_ligne.voisinage, false) END,
    CASE WHEN v_avec_carte THEN p_patch->>'etiquette_dpe' END,
    CASE WHEN v_avec_carte THEN p_patch->>'etiquette_ges' END,
    CASE WHEN v_avec_carte THEN p_patch->>'energie_chauffage' END,
    CASE WHEN v_avec_carte THEN p_patch->>'generateur_chauffage' END,
    CASE WHEN v_avec_carte THEN (p_patch->>'surface')::numeric END,
    CASE WHEN v_avec_carte THEN p_patch->>'periode_construction' END,
    CASE WHEN v_avec_carte THEN (p_patch->>'date_dpe')::date END,
    CASE WHEN v_avec_carte THEN (p_patch->>'rapport_complet')::boolean END,
    CASE WHEN v_avec_carte THEN p_patch->'carte' END,
    CASE WHEN v_avec_carte THEN (p_patch->>'version_carte')::integer END,
    CASE WHEN v_avec_carte THEN now() END,
    CASE WHEN v_numero IS NOT NULL THEN p_user END,
    CASE WHEN v_numero IS NOT NULL THEN now() END,
    now()
  )
  ON CONFLICT (client_id) DO UPDATE SET
    dpe_number = EXCLUDED.dpe_number, origine = EXCLUDED.origine, etat = EXCLUDED.etat,
    adresse_tentee = EXCLUDED.adresse_tentee, tente_le = EXCLUDED.tente_le, candidats = EXCLUDED.candidats,
    ecartes = EXCLUDED.ecartes, voisinage = EXCLUDED.voisinage,
    etiquette_dpe = EXCLUDED.etiquette_dpe, etiquette_ges = EXCLUDED.etiquette_ges,
    energie_chauffage = EXCLUDED.energie_chauffage, generateur_chauffage = EXCLUDED.generateur_chauffage,
    surface = EXCLUDED.surface, periode_construction = EXCLUDED.periode_construction, date_dpe = EXCLUDED.date_dpe,
    rapport_complet = EXCLUDED.rapport_complet, carte = EXCLUDED.carte, version_carte = EXCLUDED.version_carte,
    lu_le = EXCLUDED.lu_le,
    rattache_par = CASE WHEN EXCLUDED.dpe_number IS DISTINCT FROM t.dpe_number THEN EXCLUDED.rattache_par ELSE t.rattache_par END,
    rattache_le  = CASE WHEN EXCLUDED.dpe_number IS DISTINCT FROM t.dpe_number THEN EXCLUDED.rattache_le ELSE t.rattache_le END,
    updated_at = now()
  RETURNING * INTO v_ligne;

  -- La fiche suit : le champ « N° DPE ADEME » affiche le numéro rattaché.
  UPDATE majordhome.clients SET dpe_number = v_numero
   WHERE id = p_client_id AND org_id = p_org_id AND dpe_number IS DISTINCT FROM v_numero;

  RETURN to_jsonb(v_ligne);
END;
$$;

REVOKE ALL ON FUNCTION public.client_dpe_record(uuid, uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_dpe_record(uuid, uuid, text, jsonb, uuid) TO service_role;

-- Reprise de l'existant : un numéro déjà sur une fiche est un choix humain. La carte sera lue à la prochaine ouverture.
INSERT INTO majordhome.client_dpe (org_id, client_id, dpe_number, origine, etat)
SELECT c.org_id, c.id, upper(trim(c.dpe_number)), 'choisi', 'rattache'
  FROM majordhome.clients c
 WHERE trim(coalesce(c.dpe_number, '')) ~ '^[0-9A-Za-z]{13}$'
ON CONFLICT (client_id) DO NOTHING;
