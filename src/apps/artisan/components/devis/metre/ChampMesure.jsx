// src/apps/artisan/components/devis/metre/ChampMesure.jsx
// Champ d'une mesure du métré : texte libre au clavier décimal, lu par parseNombre (virgule ou point, quelle que
// soit la langue du navigateur). Le relevé ne reçoit que des nombres : « 1, » en cours de frappe n'écrit rien,
// une saisie refusée VIDE la valeur (même règle que DateInput) pour que la validation du relevé la refuse.
import { useEffect, useRef, useState } from 'react';
import { inputClass } from '../../FormFields';
import { parseNombre, formaterSaisie } from '@/lib/fumisterie/saisie.js';

// `message` : refus du relevé pour ce champ (écrit dessous) ; une frappe illisible le remplace par sa propre consigne.
export default function ChampMesure({ id, valeur, unite, onChange, message = null }) {
  const [texte, setTexte] = useState(() => formaterSaisie(valeur));
  const [refuse, setRefuse] = useState(false);
  // Dernière valeur rendue au relevé : une valeur qui change d'ailleurs (« Ajuster », brouillon) réécrit le champ,
  // la nôtre jamais (sinon « 1,0 » redeviendrait « 1 » pendant la frappe).
  const emise = useRef(valeur);
  useEffect(() => {
    if (valeur === emise.current) return;
    emise.current = valeur;
    setTexte(formaterSaisie(valeur));
    setRefuse(false);
  }, [valeur]);

  const emettre = (v) => { emise.current = v; onChange(v); };
  const saisir = (t) => {
    setTexte(t);
    const lu = parseNombre(t);
    if (lu.etat === 'ok') { setRefuse(false); emettre(lu.valeur); } else if (lu.etat === 'vide') { setRefuse(false); emettre(''); } else if (lu.etat === 'invalide') { setRefuse(true); emettre(''); }
  };
  const quitter = () => {
    const lu = parseNombre(texte);
    if (lu.etat !== 'en_cours') { if (lu.etat === 'ok') setTexte(formaterSaisie(lu.valeur)); return; }
    // « 1, » laissé tel quel = 1 ; « - » seul = vide.
    const fin = parseNombre(texte.trim().replace(/[.,]$/, ''));
    if (fin.etat === 'ok') { emettre(fin.valeur); setTexte(formaterSaisie(fin.valeur)); } else { emettre(''); setTexte(''); }
  };

  const texteErreur = refuse ? 'Saisissez un nombre, par exemple 1,05.' : message;
  const idErreur = `${id}-erreur`;
  return (
    <div>
      <div className="flex items-center gap-2">
        <input id={id} type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off" spellCheck={false}
          value={texte} onChange={(e) => saisir(e.target.value)} onBlur={quitter}
          aria-invalid={texteErreur ? 'true' : undefined} aria-describedby={texteErreur ? idErreur : undefined}
          className={`${inputClass} tabular-nums ${texteErreur ? 'border-st-alerte' : ''}`} />
        {unite && <span className="shrink-0 text-caption text-secondary-600">{unite}</span>}
      </div>
      {texteErreur && <p id={idErreur} className="mt-1 text-caption text-st-alerte">{texteErreur}</p>}
    </div>
  );
}
