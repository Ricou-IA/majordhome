/**
 * ConfirmerRecette.jsx — « voici ce que j'ai lu sur ces fiches » : l'administrateur confirme la recette apprise
 * (aspiration complète) ou l'écarte (rien n'est aspiré). Présentation seule ; gestes dans AspirateurFournisseur.
 */
import { CheckCircle2, FileText, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const valeurTexte = (v, champ) => {
  if (v === true) return 'oui';
  if (v === false) return 'non';
  const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  return champ?.unit && typeof v === 'number' ? `${t} ${champ.unit}` : t;
};

export default function ConfirmerRecette({ travail, champs, onConfirmer, onRejeter, enCours }) {
  const produits = Array.isArray(travail?.essai) ? travail.essai : [];
  return (
    <div className="rounded-lg border border-st-attente/40 bg-st-attente-bg/40 p-3 space-y-3">
      <p className="text-sm text-secondary-800">
        Voici ce que l’aspirateur a lu sur {produits.length} fiche{produits.length > 1 ? 's' : ''} du site. Si c’est juste,
        tout le site sera aspiré ; rien n’est écrit dans le catalogue sans votre validation.
      </p>
      <ul className="space-y-2">
        {produits.map((p) => (
          <li key={p.url} className="rounded border border-secondary-200 bg-white p-2 text-xs text-secondary-700 space-y-1">
            <p className="text-sm font-medium text-secondary-900">{p.nom || '(sans nom)'}</p>
            <p>Référence : {p.reference_fabricant || <span className="text-st-alerte">introuvable</span>}{p.marque ? ` · ${p.marque}` : ''}</p>
            {Array.isArray(p.documents) && p.documents.length > 0 && (
              <p className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {p.documents.length} document{p.documents.length > 1 ? 's' : ''}</p>
            )}
            {p.valeurs && Object.keys(p.valeurs).length > 0 && (
              <p>{Object.entries(p.valeurs).map(([k, v]) => {
                const champ = champs.find((c) => c.key === k);
                return `${champ?.label || k} : ${valeurTexte(v, champ)}`;
              }).join(' · ')}</p>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onRejeter} disabled={enCours}>
          <XCircle className="w-4 h-4 mr-1" /> Ce n’est pas ça
        </Button>
        <Button type="button" size="sm" onClick={onConfirmer} disabled={enCours}>
          <CheckCircle2 className="w-4 h-4 mr-1" /> C’est bon, tout aspirer
        </Button>
      </div>
    </div>
  );
}
