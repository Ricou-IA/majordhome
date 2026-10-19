// src/apps/artisan/pages/settings/webshop/ProcessTab.jsx
// Settings → Webshop → Process : ce que déclenche chaque changement de colonne d'une commande
// (envoi COLIS) et chaque événement de tournée (envoi PALETTE). Réglage = `settings.webshop.process`
// (défauts : src/lib/webshop/reglages.js), exécuté par l'edge `webshop-process`.
import { ORDER_BOARD_COLUMNS } from '@/lib/webshop/orders';
import { WEBSHOP_PROCESS_TRANSITIONS, WEBSHOP_PROCESS_EVENEMENTS_TOURNEE } from '@/lib/webshop/reglages';
import { WEBSHOP_EMAIL_DEFAULTS } from '@/lib/webshop/emailTemplates';
import { GABARIT_ORDRE_COLIS } from '@/lib/webshop/process';
import {
  gabaritsClient, gabaritsManquants, ordreColisSansPrestataire, processDepuisForm,
} from '@/lib/webshop/settingsForm';
import { useGabaritsExistants, useWebshopProcessForm } from './useWebshopReglagesForm';
import { Avertissement, BarreEnregistrer, CARD, Champ, Chargement, INPUT, SECTION_TITLE } from './common';

const LIBELLE_COLONNE = Object.fromEntries(ORDER_BOARD_COLUMNS.map((c) => [c.id, c.label]));
const LIBELLE_TOURNEE = { partie: 'Tournée partie', livree: 'Tournée livrée' };
const CLIENT = gabaritsClient();

const libelleGabarit = (key) => WEBSHOP_EMAIL_DEFAULTS[key]?.label ?? key;
const estClient = (key) => CLIENT.some((g) => g.key === key);

/** @param {{ value: string, onChange: (v: string) => void }} p */
function SelectGabarit({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">Aucun</option>
      {CLIENT.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
      {value && !estClient(value) && (
        <option value={value}>{libelleGabarit(value)} (gabarit non client : à remplacer)</option>
      )}
    </select>
  );
}

/** @param {{ onAllerEmails: () => void }} p */
export default function ProcessTab({ onAllerEmails }) {
  const r = useWebshopProcessForm();
  const gabarits = useGabaritsExistants();
  const { form, setForm } = r;
  if (r.isLoading) return <Chargement />;

  const process = processDepuisForm(form);
  const manquants = gabaritsManquants(process, gabarits.cles);
  const sansPrestataire = ordreColisSansPrestataire(process, r.cfg.colis.prestataire.emails);
  // Valeur enregistrée hors gabarits client (ex. réglage posé à la main) : signalée, jamais retirée en silence.
  const nonClient = [
    ...Object.values(form.transitions).map((t) => t.email_client),
    ...Object.values(form.tournee).map((t) => t.email_client),
  ].filter((k) => k && !estClient(k));

  const setTransition = (k, champ, v) => setForm((f) => ({
    ...f, transitions: { ...f.transitions, [k]: { ...f.transitions[k], [champ]: v } },
  }));
  const setTournee = (k, v) => setForm((f) => ({
    ...f, tournee: { ...f.tournee, [k]: { email_client: v } },
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      {gabarits.error ? (
        <Avertissement>
          Impossible de vérifier les gabarits d’e-mail ({gabarits.error.message}). Ceux que le Process utilise existent peut-être déjà.
        </Avertissement>
      ) : manquants === null ? (
        <p className="text-xs text-secondary-500">Vérification des gabarits d’e-mail…</p>
      ) : manquants.length > 0 && (
        <Avertissement>
          Gabarit(s) utilisé(s) par le Process mais absent(s) ou archivé(s) : {manquants.map(libelleGabarit).join(', ')}.
          L’envoi correspondant échouera (« gabarit absent ») tant qu’il n’est pas créé.{' '}
          <button type="button" onClick={onAllerEmails} className="underline font-medium">Créer dans l’onglet E-mails</button>
        </Avertissement>
      )}
      {nonClient.length > 0 && (
        <Avertissement>
          E-mail au client réglé sur un gabarit qui n’est pas destiné au client : {[...new Set(nonClient)].map(libelleGabarit).join(', ')}.
          Choisissez un gabarit client ou « Aucun ».
        </Avertissement>
      )}
      {sansPrestataire && (
        <Avertissement>
          L’ordre d’enlèvement est coché mais aucun e-mail de prestataire colis n’est saisi (onglet Colis) : l’ordre échouera.
        </Avertissement>
      )}

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Commandes : envoi colis</h2>
        <p className="text-xs text-secondary-500 mb-4">
          Déclenché quand la carte entre dans la colonne. Ignoré si la commande n’a pas de ligne colis ; l’e-mail ne parle que des colis.
        </p>
        <div className="space-y-4">
          {WEBSHOP_PROCESS_TRANSITIONS.map((k) => (
            <div key={k} className="border border-secondary-200 rounded-md p-3">
              <p className="text-sm font-medium text-secondary-900 mb-2">{LIBELLE_COLONNE[k] ?? k}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <Champ label="E-mail au client (colis)">
                  <SelectGabarit value={form.transitions[k].email_client} onChange={(v) => setTransition(k, 'email_client', v)} />
                </Champ>
                <label className="flex items-start gap-2 text-sm text-secondary-700 sm:mt-6">
                  <input
                    type="checkbox"
                    checked={form.transitions[k].ordre_colis}
                    onChange={(e) => setTransition(k, 'ordre_colis', e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Ordre d’enlèvement au prestataire colis
                    <span className="block text-xs text-secondary-500">Gabarit « {libelleGabarit(GABARIT_ORDRE_COLIS)} ».</span>
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Tournées palette</h2>
        <p className="text-xs text-secondary-500 mb-4">
          Les palettes partent par la feuille de route ; le client palette est prévenu par les événements de tournée.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {WEBSHOP_PROCESS_EVENEMENTS_TOURNEE.map((k) => (
            <Champ key={k} label={`${LIBELLE_TOURNEE[k] ?? k} : e-mail au client`}>
              <SelectGabarit value={form.tournee[k].email_client} onChange={(v) => setTournee(k, v)} />
            </Champ>
          ))}
        </div>
      </section>

      <BarreEnregistrer
        isDirty={r.isDirty}
        peutEnregistrer={r.peutEnregistrer}
        isSaving={r.isSaving}
        nbErreurs={0}
        onSave={r.enregistrer}
        onReset={r.annuler}
      />
    </div>
  );
}
