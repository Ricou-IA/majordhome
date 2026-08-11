-- ============================================================================
-- sms_logs : RPC d'ecriture — sortie du SQL brut N8N
-- ============================================================================
--
-- CONTEXTE
-- Le workflow N8N « Mayer - SMS Avis Client » ecrit dans majordhome.sms_logs
-- par TROIS requetes SQL brutes, via une connexion Postgres partagee avec les
-- apps voisines : un pre-log avant envoi, puis une mise a jour selon que
-- WhatsApp passe ou que le SMS prend le relais. Les valeurs y sont interpolees
-- dans la chaine SQL (le workflow double lui-meme les apostrophes, ce qui dit
-- tout du procede), et la connexion contourne la RLS.
--
-- Ce modele ne sait pas etre multi-client : URL, cles et identifiants sont
-- poses en dur dans le workflow, donc un 2e client imposerait un 2e jeu de
-- workflows a maintenir. Les flux metier deviennent des edge functions
-- parametrees par org ; N8N ne garde que le tiers pur.
--
-- Ces deux RPC sont le socle d'ecriture de l'edge qui remplacera le workflow.
-- Elles ne decident RIEN : elles ecrivent ce qu'on leur donne. La resolution de
-- l'org, de l'identite d'expediteur et du gabarit se fait cote edge.
--
-- ⚠ Elles prennent p_org_id dans leur payload sans le deriver d'auth.uid() :
-- charte multi-tenant => service_role ONLY. C'est l'edge, elle, qui valide la
-- membership de l'appelant via requireOrgMembership avant de les appeler.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pre-log : la ligne est ecrite AVANT l'appel au fournisseur.
--    C'est volontaire — un envoi parti sans trace est pire qu'une trace sans
--    envoi. Le statut 'pending' qui resterait tel quel signale un envoi dont on
--    ignore l'issue, ce qui est une information, pas un bug.
-- ---------------------------------------------------------------------------
create or replace function public.sms_log_create(
  p_org_id          uuid,
  p_phone_to        text,
  p_message         text,
  p_campaign_name   text,
  p_channel         text default 'sms',
  p_client_id       uuid default null,
  p_intervention_id uuid default null,
  p_short_code      text default null
)
returns uuid
language plpgsql
security definer
set search_path = majordhome, public
as $$
declare
  v_id uuid;
begin
  if p_org_id is null then
    raise exception 'org_id_required' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_phone_to), '') = '' then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_campaign_name), '') = '' then
    raise exception 'campaign_required' using errcode = 'P0001';
  end if;

  insert into majordhome.sms_logs (
    org_id, client_id, intervention_id, phone_to, message,
    campaign_name, channel, status, short_code
  )
  values (
    p_org_id, p_client_id, p_intervention_id, p_phone_to, p_message,
    p_campaign_name, coalesce(p_channel, 'sms'), 'pending', p_short_code
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Cloture : appelee apres reponse du fournisseur.
--    p_message est re-ecrit car le repli SMS n'envoie PAS le meme texte que
--    WhatsApp (sans accents, un seul segment) — la trace doit porter ce qui a
--    reellement ete envoye, pas ce qu'on avait prevu d'envoyer.
--    p_channel idem : on repart sur le canal effectivement utilise.
-- ---------------------------------------------------------------------------
create or replace function public.sms_log_mark_sent(
  p_log_id       uuid,
  p_status       text,
  p_channel      text default null,
  p_provider_sid text default null,
  p_message      text default null
)
returns boolean
language plpgsql
security definer
set search_path = majordhome, public
as $$
declare
  v_found boolean;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  update majordhome.sms_logs
     set status       = p_status,
         channel      = coalesce(p_channel, channel),
         provider_sid = coalesce(p_provider_sid, provider_sid),
         message      = coalesce(p_message, message),
         sent_at      = case when p_status = 'sent' then now() else sent_at end
   where id = p_log_id
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges — `PUBLIC` n'est PAS optionnel : PostgreSQL accorde EXECUTE a
-- PUBLIC par defaut sur toute fonction creee, et anon en herite. Un REVOKE
-- ... FROM anon seul reussirait sans rien retirer (echec silencieux).
-- ---------------------------------------------------------------------------
revoke execute on function public.sms_log_create(uuid, text, text, text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sms_log_create(uuid, text, text, text, text, uuid, uuid, text)
  to service_role;

revoke execute on function public.sms_log_mark_sent(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.sms_log_mark_sent(uuid, text, text, text, text)
  to service_role;
