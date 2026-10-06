// src/apps/artisan/pages/settings/devis/ReglagesDevisPanel.jsx
// Panneau gauche de Settings → Devis : accordéons (familles, émetteur, contenu, paiement, affichage).
// `zoneActive` (zone cliquée dans l'aperçu) ouvre l'accordéon et surligne le champ ; le focus d'un champ
// remonte `onFocusZone(id)` pour encadrer la zone dans l'aperçu. Correspondance = ZONES du modèle.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Layers, Building2, FileText, CreditCard, Eye } from 'lucide-react';
import { ZONES } from '@/lib/devisDocumentModel.js';
import FamillesEditor from './FamillesEditor';

const INPUT = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL = 'block text-xs font-medium text-secondary-600 mb-1';

const zoneDuChamp = (champ) => ZONES.find((z) => z.champ === champ)?.id || null;

function Accordeon({ k, label, icon: Icon, ouvert, onToggle, children }) {
  return (
    <section className="rounded-xl border border-secondary-200 bg-white overflow-hidden" data-accordeon={k}>
      <button type="button" onClick={onToggle} aria-expanded={ouvert} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary-50">
        <span className="flex items-center gap-2 text-sm font-semibold text-secondary-800"><Icon className="w-4 h-4 text-secondary-400" /> {label}</span>
        {ouvert ? <ChevronDown className="w-4 h-4 text-secondary-400" /> : <ChevronRight className="w-4 h-4 text-secondary-400" />}
      </button>
      {ouvert && <div className="px-4 pb-4 pt-1 space-y-4 border-t border-secondary-100">{children}</div>}
    </section>
  );
}

/** Champ texte / zone de texte / case relié à une zone de l'aperçu. */
function Champ({ champ, label, hint, type = 'text', rows, form, onChange, zoneActive, onFocusZone, min, max }) {
  const zone = zoneDuChamp(champ);
  const actif = zone && zoneActive === zone;
  const ref = useRef(null);
  useEffect(() => { if (actif && ref.current) { ref.current.focus({ preventScroll: true }); ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, [actif]);
  const [groupe, cle] = champ.split('.');
  const valeur = form[groupe][cle];
  const set = (v) => onChange(groupe, cle, v);
  const classe = `${INPUT} transition-shadow ${actif ? 'ring-2 ring-primary-500 bg-primary-50/40' : ''}`;
  const focus = () => onFocusZone?.(zone);
  if (type === 'checkbox') {
    return (
      <label className={`flex items-center gap-2 text-sm rounded-md px-1 -mx-1 ${actif ? 'bg-primary-50 ring-2 ring-primary-500' : ''}`}>
        <input ref={ref} type="checkbox" checked={!!valeur} onChange={(e) => set(e.target.checked)} onFocus={focus} /> {label}
        {hint && <span className="text-xs text-secondary-400">· {hint}</span>}
      </label>
    );
  }
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {type === 'textarea'
        ? <textarea ref={ref} value={valeur} onChange={(e) => set(e.target.value)} onFocus={focus} rows={rows || 3} className={classe} />
        : <input ref={ref} type={type} value={valeur} onChange={(e) => set(type === 'number' ? e.target.value : e.target.value)} onFocus={focus} min={min} max={max} className={classe} />}
      {hint && <p className="mt-1 text-xs text-secondary-500">{hint}</p>}
    </div>
  );
}

export default function ReglagesDevisPanel({ form, onChange, onFamilles, ouverts, onToggle, zoneActive, onFocusZone, company, invoicing }) {
  const champ = (props) => <Champ {...props} form={form} onChange={onChange} zoneActive={zoneActive} onFocusZone={onFocusZone} />;
  return (
    <div className="space-y-3">
      <Accordeon k="familles" label="Familles et chapitres" icon={Layers} ouvert={ouverts.familles} onToggle={() => onToggle('familles')}>
        <p className="text-xs text-secondary-500">Les installations proposées dans « Nouveau devis », et les chapitres créés pour chacune. Les familles masquées restent lisibles sur les anciens devis.</p>
        <FamillesEditor familles={form.familles} onChange={onFamilles} />
      </Accordeon>

      <Accordeon k="emetteur" label="Émetteur" icon={Building2} ouvert={ouverts.emetteur} onToggle={() => onToggle('emetteur')}>
        <div className={`text-sm text-secondary-700 space-y-0.5 rounded-md px-1 -mx-1 ${zoneActive === 'emetteur' ? 'bg-primary-50 ring-2 ring-primary-500' : ''}`}>
          <div className="font-medium">{company?.name}</div>
          {[company?.address, [company?.postalCode, company?.city].filter(Boolean).join(' '), company?.phone, company?.email, company?.siret ? `SIRET ${company.siret}` : null, company?.tvaIntra ? `TVA ${company.tvaIntra}` : null].filter(Boolean).map((l) => <div key={l}>{l}</div>)}
        </div>
        <p className="text-xs text-secondary-500">Nom, coordonnées, logo et couleur se modifient dans <Link to="/settings/organization" className="text-primary-700 underline">Organisation</Link>.</p>
      </Accordeon>

      <Accordeon k="contenu" label="Contenu du document" icon={FileText} ouvert={ouverts.contenu} onToggle={() => onToggle('contenu')}>
        {champ({ champ: 'document.titre', label: 'Titre du document' })}
        {champ({ champ: 'document.intro', label: 'Introduction', type: 'textarea', rows: 3, hint: 'Sous l’objet, avant les lignes. Vide = rien.' })}
        {champ({ champ: 'document.acompte', label: 'Acompte et échéancier', type: 'textarea', rows: 2, hint: 'Ex. « Acompte de 30 % à la commande, solde à la mise en service. »' })}
        {champ({ champ: 'document.validite_jours', label: 'Validité par défaut (jours)', type: 'number', min: 1, max: 365 })}
        {champ({ champ: 'document.conditions', label: 'Conditions de vente par défaut', type: 'textarea', rows: 5, hint: 'Proposées à chaque nouveau devis ; modifiables devis par devis.' })}
        {champ({ champ: 'document.mention_speciale', label: 'Mention spéciale', type: 'textarea', rows: 2, hint: 'En gras sous les conditions (ex. aides, garantie).' })}
        {champ({ champ: 'document.signature', label: 'Libellé de la zone de signature' })}
        {champ({ champ: 'document.pied_de_page', label: 'Pied de page', type: 'textarea', rows: 2, hint: 'Vide = nom, adresse, SIRET, TVA et mentions légales de l’entreprise.' })}
      </Accordeon>

      <Accordeon k="paiement" label="Paiement" icon={CreditCard} ouvert={ouverts.paiement} onToggle={() => onToggle('paiement')}>
        {champ({ champ: 'paiement.afficher', label: 'Afficher le bloc paiement (IBAN, BIC)', type: 'checkbox' })}
        <p className="text-xs text-secondary-500">IBAN : {invoicing?.iban ? <span className="font-mono">{invoicing.iban}</span> : <em>non renseigné</em>}{invoicing?.bic ? <> · BIC <span className="font-mono">{invoicing.bic}</span></> : null}. Modifiables dans <Link to="/settings/pennylane" className="text-primary-700 underline">Facturation</Link>.</p>
        {champ({ champ: 'paiement.etablissement', label: 'Établissement bancaire' })}
        {champ({ champ: 'paiement.texte', label: 'Texte d’accompagnement', type: 'textarea', rows: 2 })}
      </Accordeon>

      <Accordeon k="affichage" label="Affichage" icon={Eye} ouvert={ouverts.affichage} onToggle={() => onToggle('affichage')}>
        {champ({ champ: 'affichage.logo', label: 'Logo de l’entreprise', type: 'checkbox', hint: company?.logoUrl ? 'logo défini dans Organisation' : 'aucun logo dans Organisation' })}
        {champ({ champ: 'affichage.references', label: 'Colonne références fournisseur', type: 'checkbox' })}
        {champ({ champ: 'affichage.prix_unitaires', label: 'Colonne prix unitaires', type: 'checkbox' })}
        {champ({ champ: 'affichage.tva_par_ligne', label: 'Colonne TVA par ligne', type: 'checkbox' })}
        {champ({ champ: 'affichage.detail_lignes', label: 'Détail des lignes', type: 'checkbox', hint: 'décoché : seulement le sous-total de chaque chapitre' })}
      </Accordeon>
    </div>
  );
}
