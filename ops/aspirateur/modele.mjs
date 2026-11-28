// ops/aspirateur/modele.mjs — appel au modèle PAR LE RELAIS (edge fournisseur-aspirer-modele) : le service n'a pas de
// clé de l'API Claude. Une réponse `{ error: code }` devient une CodeErreur (plafond_atteint arrête le travail).
import { CodeErreur } from './erreurs.mjs';

/**
 * @param {{ urlRelais: string, cle: string, aspirationId: string, fetchImpl?: typeof fetch }} cfg
 */
export function creerModele({ urlRelais, cle, aspirationId, fetchImpl = fetch }) {
  return {
    /**
     * @param {{ usage: 'apprendre' | 'lire', system: string, messages: unknown[], tools?: unknown[], max_tokens?: number }} demande
     * @returns {Promise<{ content: Array<Record<string, unknown>>, stop_reason: string | null }>}
     */
    async appeler(demande) {
      let r;
      try {
        r = await fetchImpl(urlRelais, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
          body: JSON.stringify({ aspiration_id: aspirationId, ...demande }),
          signal: AbortSignal.timeout(150_000),
        });
      } catch {
        throw new CodeErreur('service_indisponible');
      }
      let corps = null;
      try { corps = await r.json(); } catch { corps = null; }
      if (!r.ok || !corps) throw new CodeErreur('service_indisponible');
      if (corps.error) throw new CodeErreur(String(corps.error));
      return { content: corps.data?.content || [], stop_reason: corps.data?.stop_reason ?? null };
    },
  };
}

/** Texte des blocs `text` d'une réponse. @param {{ content: Array<Record<string, unknown>> }} reponse */
export function texteDe(reponse) {
  return (reponse?.content || []).filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('\n');
}
