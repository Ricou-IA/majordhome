-- La signature du PV de réception est liée à la version de la déclaration lue par le client.
-- Spec : docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
-- Corrige 20261118_1_chantier_pv_points_levee.sql (déjà appliquée : ne pas la modifier).
--
-- Constat (relecture du 2026-11-18) : `chantier_pv_preparer` peut être rejouée jusqu'à la
-- signature. La page du client lit la déclaration de l'entreprise (GET → chantier_pv_contexte),
-- puis signe plus tard (chantier_pv_signer). Si le bureau prépare à nouveau entre les deux, la
-- signature était enregistrée contre une déclaration (et peut-être un gabarit) que le client n'a
-- jamais vue. Une signature doit prouver ce que le client a lu.
--
-- Correctif : le payload de signature porte `prepare_at`, le texte EXACT que le contexte a rendu
-- pour `pv.prepare_at` (l'edge le repasse sans le transformer). Comparaison en TEXTE, jamais par
-- conversion du payload (une valeur mal formée doit refuser, pas lever une erreur) : la valeur
-- enregistrée est rendue comme le contexte la rend, `to_jsonb(prepare_at) #>> '{}'`. Garde
-- positive : `prepare_at` absent, nul ou différent ⇒ refus `pv_modifie` (le client recharge la
-- page et relit la nouvelle déclaration).
--
-- Fonction identique à celle de 20261118_1, à cette seule garde près.

CREATE OR REPLACE FUNCTION public.chantier_pv_signer(p_chantier_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_chantier  majordhome.chantiers;
  v_pv        majordhome.chantier_pv;
  v_type      text := p_payload->>'reception_type';
  v_nom       text := btrim(COALESCE(p_payload->>'signataire_nom', ''));
  v_signature text := COALESCE(p_payload->>'signature_png', '');
  v_nature    text := NULLIF(btrim(COALESCE(p_payload->>'reserves_nature', '')), '');
  v_travaux   text := NULLIF(btrim(COALESCE(p_payload->>'reserves_travaux', '')), '');
  v_client    jsonb;
  v_devis     jsonb;
  v_passe     boolean := false;
BEGIN
  SELECT * INTO v_chantier FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  SELECT * INTO v_pv FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id FOR UPDATE;

  IF v_chantier.pv_reception_path IS NOT NULL OR v_pv.signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deja_signe');
  END IF;

  -- Garde positive : sans ligne, v_pv.points_entreprise est NULL ⇒ refus.
  IF (v_pv.points_entreprise IS NOT NULL) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pv_non_prepare');
  END IF;

  -- La déclaration signée est celle que le client a lue : même `prepare_at`, comparé en texte.
  IF (p_payload->>'prepare_at' = (to_jsonb(v_pv.prepare_at) #>> '{}')) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pv_modifie');
  END IF;

  IF v_type IS NULL OR v_type NOT IN ('sans_reserves', 'avec_reserves') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'choix_requis');
  END IF;
  IF v_nom = '' OR length(v_nom) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'nom_requis');
  END IF;
  IF v_signature NOT LIKE 'data:image/png;base64,%' OR length(v_signature) < 200 OR length(v_signature) > 400000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'signature_requise');
  END IF;
  IF v_type = 'avec_reserves' AND v_nature IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'reserves_a_decrire');
  END IF;
  IF length(COALESCE(v_nature, '')) > 2000 OR length(COALESCE(v_travaux, '')) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'texte_trop_long');
  END IF;

  -- Points du client : seuls les objets sont gardés, réduits à cle / texte / confirme (booléen,
  -- vrai seulement si le client a coché). L'edge en est l'autorité (textes repris du module).
  IF jsonb_typeof(p_payload->'points_client') = 'array' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cle', e->>'cle', 'texte', e->>'texte',
             'confirme', COALESCE(e->'confirme' = 'true'::jsonb, false)) ORDER BY i), '[]'::jsonb)
      INTO v_client
      FROM jsonb_array_elements(p_payload->'points_client') WITH ORDINALITY AS x(e, i)
     WHERE jsonb_typeof(e) = 'object';
  ELSE
    v_client := '[]'::jsonb;
  END IF;

  -- Photo des devis validés au moment de la signature (même lecture que le contexte).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('libelle', q.quote_label, 'date', q.quote_date)
                            ORDER BY q.quote_date, q.pennylane_quote_id), '[]'::jsonb)
    INTO v_devis
    FROM majordhome.lead_pennylane_quotes q
   WHERE q.chantier_id = p_chantier_id AND q.ejected_at IS NULL
     AND majordhome.quote_status_bucket(q.quote_status) = 'validated';

  UPDATE majordhome.chantier_pv
     SET signed_at = now(),
         signataire_nom = v_nom,
         signature_png = v_signature,
         reception_type = v_type,
         reserves_nature = CASE WHEN v_type = 'avec_reserves' THEN v_nature END,
         reserves_travaux = CASE WHEN v_type = 'avec_reserves' THEN v_travaux END,
         points_client = v_client,
         devis = v_devis,
         updated_at = now()
   WHERE chantier_id = p_chantier_id;

  IF v_chantier.chantier_status = 'planification' THEN
    UPDATE majordhome.chantiers
       SET chantier_status = 'realise', updated_at = now()
     WHERE id = p_chantier_id;
    v_passe := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'passe_en_receptionne', v_passe,
    'avec_reserves', v_type = 'avec_reserves'
  );
END;
$$;

-- Charte : PUBLIC est obligatoire dans le REVOKE (sinon anon garde EXECUTE par héritage).
REVOKE ALL ON FUNCTION public.chantier_pv_signer(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chantier_pv_signer(uuid, jsonb) TO service_role;
