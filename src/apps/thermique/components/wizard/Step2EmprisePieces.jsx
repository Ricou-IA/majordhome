// src/apps/thermique/components/wizard/Step2EmprisePieces.jsx
// Étape 2 du wizard Thermique (mode paramétrique) : assemble la barre de niveaux (opérant sur
// `saisie.niveaux`, sans dessinOps — mutation immuable directe), l'EmpriseCanvas du niveau actif,
// le tableau des pièces (PiecesTable), le panneau de cohérence emprise↔pièces (PanneauCoherence)
// et le bloc Compositions (3× CompositionFamille + 3 U menuiseries + exceptions par pièce —
// repris à l'identique de Step3OuverturesCompositions, qui reste la source legacy/dessin).
import { useEffect, useState } from 'react';
import { Calculator, Layers, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import EmpriseCanvas from '../canvas/EmpriseCanvas';
import PiecesTable from './PiecesTable';
import PanneauCoherence from './PanneauCoherence';
import CompositionFamille, { InputU } from './CompositionFamille';
import UwHelperModal from './UwHelperModal';

const HAUTEUR_NIVEAU_DEFAUT = 250; // cm — même défaut que le RDC initial (wizardState.js)

/** Nom par défaut d'un nouveau niveau : « Niveau N » sans collision (max des « Niveau X »
 * existants + 1). Éditable ensuite par l'utilisateur (les noms sont libres). Le `rang` gère
 * l'ordre physique (plus bas = plancher, plus haut = plafond), indépendamment du nom. */
function nomNiveauDefaut(niveaux) {
  const nums = niveaux
    .map((n) => /^Niveau (\d+)$/.exec(n.nom ?? '')?.[1])
    .filter(Boolean)
    .map(Number);
  const suivant = nums.length ? Math.max(...nums) + 1 : niveaux.length + 1;
  return `Niveau ${suivant}`;
}

const CHAMPS_MENUISERIES = [
  { cle: 'fenetre', label: 'Fenêtre', proposer: true },
  { cle: 'porteFenetre', label: 'Porte-fenêtre', proposer: true },
  { cle: 'porte', label: 'Porte', proposer: false },
];

const FAMILLES_EXCEPTIONS = [
  { cle: 'murs', label: 'Murs' },
  { cle: 'plancherBas', label: 'Plancher' },
  { cle: 'plafondToiture', label: 'Plafond' },
];

export default function Step2EmprisePieces({
  saisie, compositions, config, annee, onSaisieChange, onPatchCompositions, onExceptionParoi,
}) {
  const [niveauActifId, setNiveauActifId] = useState(saisie.niveaux[0]?.id ?? null);
  const [confirmNiveau, setConfirmNiveau] = useState(false);
  const [uwTarget, setUwTarget] = useState(null); // null | 'fenetre' | 'porteFenetre'

  // Niveau actif toujours valide (suppression, restauration de brouillon, LOAD_STUDY…).
  useEffect(() => {
    if (!saisie.niveaux.some((n) => n.id === niveauActifId)) {
      setNiveauActifId(saisie.niveaux[0]?.id ?? null);
    }
  }, [saisie.niveaux, niveauActifId]);

  const niveauActif = saisie.niveaux.find((n) => n.id === niveauActifId) ?? null;

  // Draft hauteur (commit au blur/Enter).
  const [hauteurDraft, setHauteurDraft] = useState(niveauActif ? String(niveauActif.hauteur) : '');
  const hauteurActive = niveauActif?.hauteur;
  useEffect(() => {
    setHauteurDraft(hauteurActive == null ? '' : String(hauteurActive));
  }, [niveauActifId, hauteurActive]);

  // Draft nom du niveau actif (commit au blur/Enter — nom éditable, vide refusé).
  const [nomDraft, setNomDraft] = useState(niveauActif?.nom ?? '');
  const nomActif = niveauActif?.nom;
  useEffect(() => { setNomDraft(nomActif ?? ''); }, [niveauActifId, nomActif]);

  const handleAjouteNiveau = () => {
    const id = crypto.randomUUID();
    const maxRang = saisie.niveaux.reduce((m, n) => Math.max(m, n.rang ?? 0), -1);
    // Nouveau niveau au sommet (rang le plus haut = plafond). Nom par défaut éditable.
    const nouveau = {
      id, nom: nomNiveauDefaut(saisie.niveaux), rang: maxRang + 1,
      hauteur: HAUTEUR_NIVEAU_DEFAUT, emprise: { polygone: [] },
    };
    onSaisieChange({ ...saisie, niveaux: [...saisie.niveaux, nouveau] });
    setNiveauActifId(id);
  };

  const commitNom = () => {
    if (!niveauActif) return;
    const valeur = nomDraft.trim();
    if (valeur === '' || valeur === niveauActif.nom) {
      setNomDraft(niveauActif.nom);   // vide refusé → on restaure le nom courant
      return;
    }
    onSaisieChange({
      ...saisie,
      niveaux: saisie.niveaux.map((n) => (n.id === niveauActifId ? { ...n, nom: valeur } : n)),
    });
  };

  const piecesNiveauActif = saisie.pieces.filter((p) => p.niveauId === niveauActifId);

  const handleSupprimeNiveau = () => {
    setConfirmNiveau(false);
    // Simple filtre : les noms sont libres (pas de renumérotation), et rangMin/rangMax du moteur
    // tolèrent les rangs non contigus (le plus bas restant porte le plancher).
    onSaisieChange({
      ...saisie,
      niveaux: saisie.niveaux.filter((n) => n.id !== niveauActifId),
      pieces: saisie.pieces.filter((p) => p.niveauId !== niveauActifId),
    });
    // Le repointage du niveau actif est géré par l'effect de cohérence ci-dessus.
  };

  const commitHauteur = () => {
    if (!niveauActif) return;
    const valeur = Number(hauteurDraft);
    if (!Number.isFinite(valeur) || valeur === niveauActif.hauteur) {
      setHauteurDraft(String(niveauActif.hauteur));
      return;
    }
    onSaisieChange({
      ...saisie,
      niveaux: saisie.niveaux.map((n) => (n.id === niveauActifId ? { ...n, hauteur: valeur } : n)),
    });
  };

  const piecesChauffees = saisie.pieces.filter((p) => p.chauffee);
  const nomNiveau = (niveauId) => saisie.niveaux.find((n) => n.id === niveauId)?.nom ?? '';

  return (
    <div className="space-y-3">
      {/* Barre de niveaux */}
      <div className="card py-3 flex items-center gap-2 flex-wrap">
        <Layers className="w-4 h-4 text-secondary-400 flex-shrink-0" />
        <div className="flex items-center gap-1 flex-wrap">
          {saisie.niveaux.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setNiveauActifId(n.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                n.id === niveauActifId
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-secondary-600 hover:bg-secondary-100'
              }`}
            >
              {n.nom}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleAjouteNiveau}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium text-secondary-600 hover:bg-secondary-100 rounded-lg"
        >
          <Plus className="w-4 h-4" /> Niveau
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-secondary-600 flex items-center gap-1.5">
            Nom
            <input
              type="text"
              value={nomDraft}
              onChange={(e) => setNomDraft(e.target.value)}
              onBlur={commitNom}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              disabled={!niveauActif}
              className="w-32 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              aria-label="Nom du niveau"
            />
          </label>
          <label className="text-sm text-secondary-600 flex items-center gap-1.5">
            Hauteur
            <input
              type="number"
              inputMode="numeric"
              min={180}
              max={500}
              value={hauteurDraft}
              onChange={(e) => setHauteurDraft(e.target.value)}
              onBlur={commitHauteur}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              disabled={!niveauActif}
              className="w-20 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            />
            cm
          </label>
          <button
            type="button"
            onClick={() => (piecesNiveauActif.length > 0 ? setConfirmNiveau(true) : handleSupprimeNiveau())}
            disabled={saisie.niveaux.length <= 1 || !niveauActif}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            title="Supprimer le niveau actif"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Emprise au sol du niveau actif */}
      <div className="card p-0 overflow-hidden">
        <div className="h-[460px]">
          <EmpriseCanvas
            polygone={niveauActif?.emprise?.polygone ?? []}
            onChange={(polygone) => onSaisieChange({
              ...saisie,
              niveaux: saisie.niveaux.map((n) => (
                n.id === niveauActifId ? { ...n, emprise: { polygone } } : n
              )),
            })}
          />
        </div>
      </div>

      {/* Pièces du niveau actif */}
      <PiecesTable saisie={saisie} config={config} onChange={onSaisieChange} niveauActifId={niveauActifId} />

      {/* Cohérence emprise ↔ pièces */}
      <PanneauCoherence saisie={saisie} />

      {/* ===== Compositions par famille ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <CompositionFamille
          famille="murs"
          label="Murs"
          valeur={compositions.familles.murs}
          annee={annee}
          onPatch={(patch) => onPatchCompositions({ murs: patch })}
        />
        <CompositionFamille
          famille="plancherBas"
          label="Plancher bas"
          valeur={compositions.familles.plancherBas}
          annee={annee}
          onPatch={(patch) => onPatchCompositions({ plancherBas: patch })}
        />
        <CompositionFamille
          famille="plafondToiture"
          label="Plafond / toiture"
          valeur={compositions.familles.plafondToiture}
          annee={annee}
          onPatch={(patch) => onPatchCompositions({ plafondToiture: patch })}
        />
      </div>

      {/* ===== Menuiseries (U des ouvertures) ===== */}
      <div className="card space-y-4">
        <h3 className="font-semibold text-secondary-900 text-sm">Menuiseries — U W/(m²·K)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CHAMPS_MENUISERIES.map(({ cle, label, proposer }) => (
            <div key={cle} className="space-y-1">
              <label className="block text-sm font-medium text-secondary-700">{label}</label>
              <div className="flex items-center gap-1.5">
                <InputU
                  value={compositions.familles[cle]?.u ?? null}
                  onCommit={(u) => onPatchCompositions({ [cle]: { u } })}
                  allowEmpty={false}
                  className="w-24"
                />
                {proposer && (
                  <button
                    type="button"
                    onClick={() => setUwTarget(cle)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-secondary-600 hover:bg-secondary-100 border border-secondary-300 rounded-lg"
                    title="Proposer depuis les composants (vitrage × menuiserie × volet)"
                  >
                    <Calculator className="w-3.5 h-3.5" /> Proposer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== Exceptions par pièce ===== */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold text-secondary-900">
          Exceptions par pièce (avancé)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-secondary-500">
            Le U saisi remplace le réglage global pour cette pièce. Vider le champ retire l’exception.
          </p>
          {piecesChauffees.length === 0 ? (
            <p className="text-sm text-secondary-500">Aucune pièce chauffée.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
                    <th className="py-2 pr-3 font-medium">Pièce</th>
                    {FAMILLES_EXCEPTIONS.map((f) => (
                      <th key={f.cle} className="py-2 pr-3 font-medium">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100">
                  {piecesChauffees.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 text-secondary-900">
                        {p.nom}
                        {saisie.niveaux.length > 1 && (
                          <span className="text-xs text-secondary-500"> — {nomNiveau(p.niveauId)}</span>
                        )}
                      </td>
                      {FAMILLES_EXCEPTIONS.map((f) => (
                        <td key={f.cle} className="py-2 pr-3">
                          <InputU
                            value={compositions.exceptions.parois[`${p.id}:${f.cle}`]?.u ?? null}
                            onCommit={(u) => onExceptionParoi(`${p.id}:${f.cle}`, u)}
                            placeholder="—"
                            className="w-24"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      {/* Modale Uw — montée conditionnellement : état interne remis à zéro à chaque ouverture */}
      {uwTarget != null && (
        <UwHelperModal
          champLabel={uwTarget === 'porteFenetre' ? 'Porte-fenêtre' : 'Fenêtre'}
          onApply={(u) => {
            onPatchCompositions({ [uwTarget]: { u } });
            setUwTarget(null);
          }}
          onClose={() => setUwTarget(null)}
        />
      )}

      <ConfirmDialog
        open={confirmNiveau}
        onOpenChange={setConfirmNiveau}
        title={`Supprimer « ${niveauActif?.nom ?? ''} »`}
        description={`Ce niveau contient ${piecesNiveauActif.length} pièce${piecesNiveauActif.length > 1 ? 's' : ''} — elles seront supprimées.`}
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleSupprimeNiveau}
      />
    </div>
  );
}
