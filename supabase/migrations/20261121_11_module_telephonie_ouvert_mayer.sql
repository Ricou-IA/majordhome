-- L'agent téléphonique devient un module à part (Eric 2026-11-21 : plus lourd, pas prêt pour tous),
-- fermé par défaut. On l'ouvre aux organisations qui ont déjà relié un agent (Mayer), AVANT la mise
-- en ligne de l'écran, sinon leur tuile de réglage disparaîtrait. Données : NE PAS REJOUER.
SELECT public.org_set_modules(o.id, '{"telephonie": true}'::jsonb, 'migration 20261121_11')
FROM core.organizations o
WHERE coalesce(o.settings->'telephonie'->>'elevenlabs_agent_id', '') <> ''
  AND (o.settings->'modules'->>'telephonie') IS NULL;
