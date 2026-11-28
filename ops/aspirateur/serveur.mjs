// ops/aspirateur/serveur.mjs — service de l'aspirateur sur le VPS (KVM 2), derrière Traefik.
// Deux routes : GET /sante (sans clé) et POST /travaux (en-tête X-Aspirateur-Key, comparaison en temps constant).
// Tout le reste : 404. Corps limité à 200 Ko, forme vérifiée ; rien de la requête n'est journalisé.
// Les résultats repartent vers l'edge fournisseur-aspirer-retour ; le modèle est appelé par l'edge
// fournisseur-aspirer-modele (aucune clé de base ni de l'API Claude sur cette machine).
// Env : MDH_ASPIRATEUR_KEY, ASPIRATEUR_URL_RETOUR, ASPIRATEUR_URL_MODELE, ASPIRATEUR_PORT (8645), ASPIRATEUR_ECOUTE (127.0.0.1).
// README.md : installation (utilisateur Unix dédié, systemd, Traefik).
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { creerFile, executerTravail } from './travaux.mjs';
import { CodeErreur } from './erreurs.mjs';
import { ouvrirNavigateur } from './navigateur.mjs';
import { creerModele } from './modele.mjs';
import { apprendre } from './apprentissage.mjs';
import { rejouer } from './rejeu.mjs';

const CORPS_MAX = 200 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const egal = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Vrai si le corps a la forme d'un travail. @param {any} t */
export function travailValide(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return false;
  if (!UUID.test(String(t.aspiration_id || ''))) return false;
  if (t.genre !== 'apprentissage' && t.genre !== 'aspiration') return false;
  if (typeof t.hote_site !== 'string' || !t.hote_site || /[/\s]/.test(t.hote_site)) return false;
  try { if (new URL(t.url_depart).protocol !== 'https:') return false; } catch { return false; }
  if (t.acces !== null && (typeof t.acces !== 'object' || typeof t.acces.identifiant !== 'string' || typeof t.acces.mot_de_passe !== 'string')) return false;
  if (!Array.isArray(t.champs) || !Array.isArray(t.marques)) return false;
  if (t.recette !== null && (typeof t.recette !== 'object' || Array.isArray(t.recette))) return false;
  if (t.genre === 'aspiration' && !t.recette) return false;
  return true;
}

/** @param {{ cle: string, file: { soumettre: (t: any) => void } }} cfg */
export function creerServeur({ cle, file }) {
  return http.createServer((req, res) => {
    const repondre = (code, corps) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(corps)); };
    const chemin = (req.url || '').split('?')[0];
    if (req.method === 'GET' && chemin === '/sante') return repondre(200, { ok: true });
    if (req.method !== 'POST' || chemin !== '/travaux') return repondre(404, { error: 'introuvable' });
    if (!cle || !egal(req.headers['x-aspirateur-key'] || '', cle)) return repondre(401, { error: 'non_autorise' });
    let taille = 0;
    const morceaux = [];
    let trop = false;
    req.on('data', (c) => {
      if (trop) return; // le reste du corps est lu et jeté
      taille += c.length;
      if (taille > CORPS_MAX) {
        trop = true;
        morceaux.length = 0;
        res.setHeader('connection', 'close');
        repondre(413, { error: 'corps_trop_grand' });
        return;
      }
      morceaux.push(c);
    });
    req.on('end', () => {
      if (trop) return;
      let t;
      try { t = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return repondre(400, { error: 'json_invalide' }); }
      if (!travailValide(t)) return repondre(400, { error: 'requete_invalide' });
      file.soumettre(t);
      return repondre(202, { ok: true });
    });
  });
}

/**
 * Envoi d'un résultat vers l'edge de retour (secret partagé). L'edge répond HTTP 200 avec `{ error: code }` quand elle
 * refuse : ce refus est LU et devient une CodeErreur, qui arrête le travail (relecture I1 : un lot perdu en silence
 * laisserait annoncer « terminé »).
 * @param {string} url @param {string} cle @param {typeof fetch} [fetchImpl]
 */
export function creerEnvoi(url, cle, fetchImpl = fetch) {
  return async (corps) => {
    let r;
    try {
      r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` }, body: JSON.stringify(corps), signal: AbortSignal.timeout(120_000) });
    } catch { throw new CodeErreur('service_indisponible'); }
    let reponse = null;
    try { reponse = await r.json(); } catch { reponse = null; }
    if (!r.ok || !reponse) throw new CodeErreur('service_indisponible');
    if (reponse.error) throw new CodeErreur(/^[a-z_]{1,40}$/.test(String(reponse.error)) ? String(reponse.error) : 'service_indisponible');
    return reponse.data ?? null;
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cle = process.env.MDH_ASPIRATEUR_KEY || '';
  const urlRetour = process.env.ASPIRATEUR_URL_RETOUR || '';
  const urlModele = process.env.ASPIRATEUR_URL_MODELE || '';
  if (cle.length < 32 || !urlRetour.startsWith('https://') || !urlModele.startsWith('https://')) {
    console.error('[aspirateur] configuration incomplète (MDH_ASPIRATEUR_KEY ≥ 32 caractères, URL https de retour et du modèle)');
    process.exit(1);
  }
  const deps = {
    ouvrirNavigateur, apprendre, rejouer,
    creerModele: ({ aspirationId }) => creerModele({ urlRelais: urlModele, cle, aspirationId }),
    envoyerRetour: creerEnvoi(urlRetour, cle),
  };
  const file = creerFile({ maxTotal: 2, executer: (t) => executerTravail(t, deps) });
  const port = Number(process.env.ASPIRATEUR_PORT || 8645);
  const ecoute = process.env.ASPIRATEUR_ECOUTE || '127.0.0.1';
  creerServeur({ cle, file }).listen(port, ecoute, () => console.log(`[aspirateur] à l'écoute sur ${ecoute}:${port}`));
}
