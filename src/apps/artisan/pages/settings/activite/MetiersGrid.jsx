// Mon activité → « Métiers » : une ligne par métier, deux colonnes à cocher (règles : src/lib/activite/metiers.js).
//   « Projets et devis » : type de projet proposé dans les leads et « Nouveau devis » (settings.devis.familles).
//   « Parc client » : catégorie et type d'équipement recensés chez le client et entretenus.
// Chaque coche s'enregistre aussitôt. Décocher désactive, ne supprime jamais.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildDevisConfig, outilDeFamille, validerDevisConfig } from '@/lib/devisConfig.js';
import { moduleActif } from '@/lib/modules';
import { METIERS, ajoutsHorsCatalogue, basculerFamille, etatMetier, planMiseAuParc, planRetraitDuParc } from '@/lib/activite/metiers';
import { depuisConfig, patchFamilles, versSettings } from '../devis/famillesSettings';

const GROUPES = [
  { key: 'pose', titre: 'Installation' },
  { key: 'hors_pose', titre: 'Hors installation' },
];

function Coche({ valeur, enCours, onChange, libelle }) {
  if (valeur === null) return <span className="text-secondary-300" aria-hidden="true">—</span>;
  if (enCours) return <Loader2 className="w-4 h-4 mx-auto text-primary-600 animate-spin" aria-label="Enregistrement" />;
  return (
    <input
      type="checkbox"
      checked={valeur}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={libelle}
      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
    />
  );
}

export default function MetiersGrid({ admin }) {
  const { settings, save } = useOrgSettings();
  const [enCours, setEnCours] = useState(null); // `${metier}:projet|parc`

  const config = useMemo(() => buildDevisConfig(settings), [settings]);
  const referentiel = { familles: config.familles, categories: admin.categories, types: admin.equipmentTypes };
  const ajouts = ajoutsHorsCatalogue(referentiel);
  const entretiensOuvert = moduleActif(settings, 'entretiens');

  const basculerProjet = async (metier, actif) => {
    const familles = basculerFamille(depuisConfig(config), metier.famille, actif);
    const validation = validerDevisConfig({ familles: versSettings(familles), document: config.document });
    if (!validation.ok) { toast.error(validation.erreurs[0]); return; }
    setEnCours(`${metier.key}:projet`);
    try {
      await save(patchFamilles(settings, familles));
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    } finally { setEnCours(null); }
  };

  const basculerParc = async (metier, actif) => {
    setEnCours(`${metier.key}:parc`);
    try {
      if (actif) {
        const plan = planMiseAuParc(metier, referentiel);
        let categoryId = plan.categorie.id;
        if (plan.categorie.action === 'creer') categoryId = (await admin.createCategory.mutateAsync(plan.categorie.payload)).id;
        if (plan.categorie.action === 'reactiver') await admin.updateCategory.mutateAsync({ id: plan.categorie.id, payload: { is_active: true } });
        if (plan.categorieDuType) await admin.updateCategory.mutateAsync({ id: plan.categorieDuType, payload: { is_active: true } });
        if (plan.type.action === 'creer') await admin.createEquipmentType.mutateAsync({ ...plan.type.payload, category_id: plan.type.payload.category_id || categoryId });
        if (plan.type.action === 'reactiver') await admin.updateEquipmentType.mutateAsync({ id: plan.type.id, payload: { is_active: true } });
      } else {
        const plan = planRetraitDuParc(metier, referentiel);
        for (const id of plan.types) await admin.updateEquipmentType.mutateAsync({ id, payload: { is_active: false } });
        for (const id of plan.categories) await admin.updateCategory.mutateAsync({ id, payload: { is_active: false } });
      }
    } catch (err) {
      // Une étape a pu passer avant l'échec : la grille relit le référentiel et montre l'état réel.
      toast.error(err.message || "Erreur lors de l'enregistrement");
    } finally { setEnCours(null); }
  };

  return (
    <div className="card max-w-3xl space-y-5">
      <p className="text-sm text-secondary-600">
        Cochez ce que vous faites. <strong className="font-medium text-secondary-800">Projets et devis</strong> : le type
        est proposé dans les leads et les devis. <strong className="font-medium text-secondary-800">Parc client</strong> : vous
        recensez cet équipement chez vos clients et vous l&apos;entretenez. Chaque coche s&apos;enregistre aussitôt ; décocher
        masque sans rien effacer.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-secondary-200 text-left text-secondary-500">
            <th className="py-2 pr-3 font-medium">Métier</th>
            <th className="py-2 px-3 font-medium text-center w-36">Projets et devis</th>
            <th className="py-2 pl-3 font-medium text-center w-36">Parc client</th>
          </tr>
        </thead>
        {GROUPES.map((g) => (
          <tbody key={g.key}>
            <tr>
              <th colSpan={3} className="pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">{g.titre}</th>
            </tr>
            {METIERS.filter((m) => m.groupe === g.key).map((m) => {
              const etat = etatMetier(m, referentiel);
              const outil = m.famille ? outilDeFamille(m.famille) : null;
              return (
                <tr key={m.key} className="border-t border-secondary-100">
                  <td className="py-2.5 pr-3">
                    <span className="text-secondary-900">{m.label}</span>
                    {outil && (
                      <span className="block text-xs text-secondary-500">
                        {outil.libelle}{outil.module && !moduleActif(settings, outil.module) ? ' : avec le module correspondant' : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <Coche valeur={etat.projet} enCours={enCours === `${m.key}:projet`} libelle={`${m.label} : projets et devis`}
                      onChange={(v) => basculerProjet(m, v)} />
                  </td>
                  <td className="py-2.5 pl-3 text-center">
                    <Coche valeur={etat.parc} enCours={enCours === `${m.key}:parc`} libelle={`${m.label} : parc client`}
                      onChange={(v) => basculerParc(m, v)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>

      {(ajouts.familles.length > 0 || ajouts.types.length > 0) && (
        <div className="text-xs text-secondary-600 border-t border-secondary-100 pt-3 space-y-1">
          {ajouts.familles.length > 0 && (
            <p>Types de projet ajoutés par vous : {ajouts.familles.map((f) => f.label).join(', ')}. Ils se gèrent dans l&apos;onglet Types de projet.</p>
          )}
          {ajouts.types.length > 0 && (
            <p>Équipements ajoutés par vous : {ajouts.types.map((t) => t.label).join(', ')}. Ils se gèrent dans l&apos;onglet Types d&apos;équipement.</p>
          )}
        </div>
      )}

      {entretiensOuvert && (
        <p className="text-xs text-secondary-500">
          Durée et prix d&apos;entretien de chaque équipement : <Link to="/settings/pricing" className="text-primary-700 hover:underline">Tarification</Link>.
        </p>
      )}
    </div>
  );
}
