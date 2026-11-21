// Bloc « HésiaSun » de l'onglet Identité : relier l'entreprise à son compte HésiaSun pour ne saisir son
// identité qu'une fois (Majord'home est la source). Présentation et enchaînement des gestes ; les règles sont
// dans @/lib/organisation/liaisonHesiasun, les appels dans useLiaisonHesiasun.
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronDown, Link2, Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useLiaisonHesiasun } from '@hooks/useLiaisonHesiasun';
import { comparerIdentites, identitePourReglages, messageLiaison } from '@/lib/organisation/liaisonHesiasun';
import { formatDateFR } from '@/lib/utils';
import { INPUT_CLASS, SettingsSection, SettingsSurface } from './layout';

const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50';
const PRINCIPAL = `${BOUTON} bg-primary-600 text-white hover:bg-primary-700`;
const SECONDAIRE = `${BOUTON} border border-secondary-300 text-secondary-700 bg-white hover:bg-secondary-50`;

/**
 * @param {{ formulaireModifie: boolean }} p  onglet Identité en cours de saisie : on relie et on envoie ce qui est ENREGISTRÉ
 */
export default function LiaisonHesiasun({ formulaireModifie }) {
  const { settings, save } = useOrgSettings();
  const { etat, rompueLe, relier, comparer, pousser, delier, enCours } = useLiaisonHesiasun();
  const [ouvert, setOuvert] = useState(false);
  const [cle, setCle] = useState('');
  const [erreur, setErreur] = useState(null);
  // Identité côté HésiaSun, reçue au moment de relier (ou relue) : sert au choix, jamais enregistrée ici.
  const [identiteLabas, setIdentiteLabas] = useState(null);
  const [confirmerDelier, setConfirmerDelier] = useState(false);

  const dire = (err) => setErreur(messageLiaison(err.message, err.champs));

  const handleRelier = async () => {
    setErreur(null);
    try {
      const r = await relier(cle.trim());
      setCle('');
      setIdentiteLabas(r?.identite_hesiasun || {});
      // Déjà tenue par cette même liaison côté HésiaSun : rien à choisir.
      if (r?.etat?.ouverte) toast.success('Liaison avec HésiaSun rétablie');
    } catch (err) {
      dire(err);
    }
  };

  const handleComparer = async () => {
    setErreur(null);
    try {
      const r = await comparer();
      setIdentiteLabas(r?.identite_hesiasun || {});
    } catch (err) {
      dire(err);
    }
  };

  const envoyer = async (message) => {
    setErreur(null);
    try {
      await pousser();
      setIdentiteLabas(null);
      toast.success(message);
    } catch (err) {
      dire(err);
    }
  };

  const handleReprendre = async () => {
    setErreur(null);
    try {
      await save(identitePourReglages(identiteLabas));
    } catch (err) {
      setErreur(err.message || 'L’identité de HésiaSun n’a pas pu être enregistrée dans Majord’home.');
      return;
    }
    await envoyer('Identité de HésiaSun reprise ; Majord’home en est maintenant la source');
  };

  const handleDelier = async () => {
    setErreur(null);
    try {
      const r = await delier();
      setConfirmerDelier(false);
      setIdentiteLabas(null);
      if (r?.hesiasun_prevenu) toast.success('Liaison défaite : l’identité se modifie de nouveau dans HésiaSun');
      else toast.warning('Liaison défaite ici, mais HésiaSun n’a pas répondu : dans HésiaSun, cliquez « Reprendre la gestion ici » pour rouvrir la fiche.');
    } catch (err) {
      dire(err);
    }
  };

  // Rien de relié : une ligne repliée, pour qui n'a pas HésiaSun.
  if (!etat && !ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)} className="mt-4 flex items-center gap-2 text-sm text-secondary-600 hover:text-secondary-900">
        <Link2 className="w-4 h-4" />
        Vous utilisez aussi HésiaSun ? Relier les deux comptes
        <ChevronDown className="w-4 h-4" />
      </button>
    );
  }

  const comparaison = identiteLabas ? comparerIdentites(settings, identiteLabas) : null;
  const differences = comparaison ? comparaison.lignes.filter((l) => l.different) : [];

  return (
    <div className="mt-4">
      <SettingsSurface>
        <SettingsSection
          title="HésiaSun"
          description="Votre identité se saisit une seule fois, ici : elle est envoyée à HésiaSun à chaque enregistrement."
        >
          {!etat && (
            <div className="space-y-3">
              {rompueLe && (
                <p className="text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  La gestion de l’identité a été reprise dans HésiaSun le {formatDateFR(rompueLe)} : la liaison est rompue.
                </p>
              )}
              <p className="text-sm text-secondary-600">
                Dans HésiaSun, ouvrez Paramètres → API, créez une clé avec la permission « Recevoir l’identité de l’entreprise », puis collez-la ici.
                Elle est rangée au coffre de votre organisation et n’est plus jamais affichée.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  value={cle}
                  onChange={(e) => setCle(e.target.value)}
                  placeholder="bk_live_…"
                  autoComplete="off"
                  className={`${INPUT_CLASS} flex-1 min-w-[16rem] font-mono`}
                />
                <button type="button" onClick={handleRelier} disabled={enCours || !cle.trim() || formulaireModifie} className={PRINCIPAL}>
                  {enCours && <Loader2 className="w-4 h-4 animate-spin" />}
                  Relier
                </button>
              </div>
              {formulaireModifie && <p className="text-xs text-secondary-600">Enregistrez d’abord vos modifications de l’onglet.</p>}
            </div>
          )}

          {etat && !etat.ouverte && (
            <div className="space-y-3">
              <p className="text-sm text-secondary-900">
                Relié à <span className="font-medium">{etat.entreprise || 'votre entreprise HésiaSun'}</span>. Il reste à choisir, une fois, quelle identité garder :
                ensuite elle se modifiera ici et HésiaSun la recevra.
              </p>
              {!comparaison && (
                <button type="button" onClick={handleComparer} disabled={enCours} className={SECONDAIRE}>
                  {enCours && <Loader2 className="w-4 h-4 animate-spin" />}
                  Comparer les deux identités
                </button>
              )}
              {comparaison && comparaison.identiques && <p className="text-sm text-secondary-700">Les deux identités sont identiques.</p>}
              {comparaison && differences.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-secondary-500">
                        <th className="py-1.5 pr-3 font-medium">Champ</th>
                        <th className="py-1.5 pr-3 font-medium">Majord’home</th>
                        <th className="py-1.5 font-medium">HésiaSun</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-secondary-100">
                      {differences.map((l) => (
                        <tr key={l.cle}>
                          <td className="py-1.5 pr-3 text-secondary-600">{l.libelle}</td>
                          <td className="py-1.5 pr-3 text-secondary-900">{l.ici || <span className="text-secondary-400">vide</span>}</td>
                          <td className="py-1.5 text-secondary-900">{l.labas || <span className="text-secondary-400">vide</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-xs text-secondary-500">
                    {comparaison.lignes.length - differences.length} champ(s) identique(s) ne sont pas listés. Un champ vide du côté gardé vide l’autre.
                  </p>
                </div>
              )}
              {comparaison && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => envoyer('Identité envoyée à HésiaSun ; Majord’home en est maintenant la source')}
                    disabled={enCours || formulaireModifie || comparaison.iciVide}
                    className={comparaison.labasVide || comparaison.identiques ? PRINCIPAL : SECONDAIRE}
                  >
                    Garder celle de Majord’home
                  </button>
                  {!comparaison.identiques && (
                    <button
                      type="button"
                      onClick={handleReprendre}
                      disabled={enCours || formulaireModifie || comparaison.labasVide}
                      className={comparaison.iciVide ? PRINCIPAL : SECONDAIRE}
                    >
                      Reprendre celle de HésiaSun
                    </button>
                  )}
                  {enCours && <Loader2 className="w-4 h-4 animate-spin self-center text-secondary-400" />}
                </div>
              )}
              {formulaireModifie && <p className="text-xs text-secondary-600">Enregistrez d’abord vos modifications de l’onglet.</p>}
            </div>
          )}

          {etat?.ouverte && (
            <div className="space-y-2">
              <p className="text-sm text-secondary-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-primary-700" />
                <span>
                  Relié à <span className="font-medium">{etat.entreprise || 'votre entreprise HésiaSun'}</span>
                  {etat.dernier_envoi_le ? ` — dernier envoi le ${formatDateFR(etat.dernier_envoi_le)}` : ''}. Dans HésiaSun, ces champs sont en lecture seule.
                </span>
              </p>
              {etat.erreur && (
                <p className="text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Le dernier envoi n’est pas passé. {messageLiaison(etat.erreur, etat.erreur_champs)}
                    {etat.en_attente ? ' Un nouvel essai est fait chaque heure pendant 24 heures.' : ''}
                  </span>
                </p>
              )}
              {etat.erreur && (
                <button type="button" onClick={() => envoyer('Identité envoyée à HésiaSun')} disabled={enCours || formulaireModifie} className={SECONDAIRE}>
                  {enCours && <Loader2 className="w-4 h-4 animate-spin" />}
                  Renvoyer
                </button>
              )}
            </div>
          )}

          {erreur && (
            <p role="alert" className="text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {erreur}
            </p>
          )}

          {etat && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {confirmerDelier ? (
                <>
                  <span className="text-secondary-700">L’identité se modifiera de nouveau séparément dans chaque produit.</span>
                  <button type="button" onClick={handleDelier} disabled={enCours} className={SECONDAIRE}>Confirmer</button>
                  <button type="button" onClick={() => setConfirmerDelier(false)} disabled={enCours} className="text-secondary-600 hover:underline">Annuler</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmerDelier(true)} disabled={enCours} className="text-secondary-600 hover:text-secondary-900 underline">
                  Délier
                </button>
              )}
            </div>
          )}
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
