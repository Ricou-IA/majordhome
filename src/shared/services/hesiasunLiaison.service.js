import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Liaison Majord'home → HésiaSun (identité de l'entreprise saisie une fois) — appels à l'edge `hesiasun-identite`.
 * L'edge répond 200 `{ data, error, champs? }` où `error` est un CODE, traduit par `messageLiaison`
 * (@/lib/organisation/liaisonHesiasun). L'erreur rendue porte ce code dans `message` et, s'il y en a,
 * les champs refusés dans `champs`.
 * Spec : docs/superpowers/specs/2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md (lot 3)
 */
async function appeler(orgId, action, extra) {
  if (!orgId) throw new Error('service_injoignable');
  const { data, error } = await supabase.functions.invoke('hesiasun-identite', { body: { org_id: orgId, action, ...extra } });
  if (error) throw new Error('service_injoignable');
  if (data?.error) {
    const refus = new Error(data.error);
    refus.champs = data.champs || null;
    throw refus;
  }
  return data?.data ?? null;
}

export const hesiasunLiaisonService = {
  /** Vérifie la clé, la range au coffre et note la liaison. → `{ etat, identite_hesiasun }` (rien n'est envoyé) */
  relier: (orgId, cle) => withErrorHandling(() => appeler(orgId, 'relier', { cle }), 'hesiasunLiaison.relier'),
  /** Relit l'identité côté HésiaSun (choix resté en suspens). → `{ etat, identite_hesiasun }` */
  comparer: (orgId) => withErrorHandling(() => appeler(orgId, 'comparer'), 'hesiasunLiaison.comparer'),
  /** Envoie l'identité enregistrée ; le premier envoi ouvre la liaison. → `{ etat }` */
  pousser: (orgId) => withErrorHandling(() => appeler(orgId, 'pousser'), 'hesiasunLiaison.pousser'),
  /** Défait la liaison. → `{ delie, hesiasun_prevenu }` */
  delier: (orgId) => withErrorHandling(() => appeler(orgId, 'delier'), 'hesiasunLiaison.delier'),
};
