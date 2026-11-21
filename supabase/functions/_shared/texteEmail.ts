// ============================================================================
// _shared/texteEmail.ts — texte d'un e-mail automatique, avec son défaut
// ============================================================================
// SEULE lecture du texte d'un e-mail du registre (`emailsAutomatiques.js`) côté
// edges : la ligne NON archivée de `mail_campaigns` de l'entreprise si elle a un
// objet et un corps, sinon le texte par défaut. Une entreprise qui n'a jamais
// ouvert « Modifier le texte » envoie donc quand même (avant le 2026-11-21 :
// refus `template_missing`).
//
// Une lecture en ÉCHEC n'est jamais remplacée par le défaut : `erreur` est
// renseignée et l'appelant refuse, pour ne pas envoyer le texte par défaut à la
// place d'un texte personnalisé qu'on n'a pas su lire.
//
// Fichier à part de `mail.ts` : seules les edges qui lisent un texte du registre
// embarquent le registre et ses modules.
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { texteEffectif } from "./emailsAutomatiques.js";

export interface TexteEmail {
  subject: string;
  html_body: string;
  /** `entreprise` : ligne `mail_campaigns` ; `defaut` : texte du registre. */
  source: "entreprise" | "defaut";
}

export interface LectureTexteEmail {
  /** `null` : lecture en échec (`erreur`), ou clé hors registre sans ligne. */
  texte: TexteEmail | null;
  erreur: string | null;
}

/**
 * @param supabase client de l'appelant (jeton utilisateur ou service_role)
 * @param orgId organisation CORE (celle de `mail_campaigns.org_id`)
 * @param cle `mail_campaigns.key`
 */
export async function chargerTexteEmail(
  supabase: SupabaseClient,
  orgId: string,
  cle: string,
): Promise<LectureTexteEmail> {
  const { data, error } = await supabase
    .from("majordhome_mail_campaigns")
    .select("subject, html_body")
    .eq("org_id", orgId)
    .eq("key", cle)
    .eq("is_archived", false)
    .maybeSingle();
  if (error) return { texte: null, erreur: error.message || "lecture du texte de l'e-mail" };
  return { texte: texteEffectif(data, cle) as TexteEmail | null, erreur: null };
}
