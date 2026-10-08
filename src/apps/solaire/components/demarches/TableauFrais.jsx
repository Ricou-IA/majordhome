// src/apps/solaire/components/demarches/TableauFrais.jsx
// Frais administratifs (montants et prise en charge calculés par le moteur).
import { formatEuro } from '@lib/utils';

const PEC = {
  inclus: 'Inclus dans l’offre',
  refacture: 'Avancés par nous, refacturés',
};

export default function TableauFrais({ frais }) {
  if (!frais?.lignes?.length) return null;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-secondary-500">
        <tr>
          <th className="py-1 pr-2 font-medium">Poste</th>
          <th className="py-1 pr-2 font-medium text-right">Montant TTC</th>
          <th className="py-1 font-medium">Prise en charge</th>
        </tr>
      </thead>
      <tbody>
        {frais.lignes.map((l) => (
          <tr key={l.code} className="border-t border-secondary-100">
            <td className="py-1.5 pr-2 text-secondary-800">{l.libelle}</td>
            <td className="py-1.5 pr-2 text-right font-medium text-secondary-900">
              {l.montant_connu ? (l.montant_ttc === 0 ? 'Gratuit' : formatEuro(l.montant_ttc)) : <span className="text-[#7C4A03]">À renseigner</span>}
            </td>
            <td className="py-1.5 text-secondary-600">{l.montant_ttc === 0 && l.montant_connu ? '—' : (PEC[l.prise_en_charge] ?? l.prise_en_charge)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-secondary-200">
          <td className="py-1.5 pr-2 font-semibold text-secondary-900">Total</td>
          <td className="py-1.5 pr-2 text-right font-semibold text-secondary-900">
            {frais.total_connu ? formatEuro(frais.total_ttc) : <span className="text-[#7C4A03]">Incomplet</span>}
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}
