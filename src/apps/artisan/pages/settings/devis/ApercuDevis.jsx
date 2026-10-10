// src/apps/artisan/pages/settings/devis/ApercuDevis.jsx
// Aperçu HTML du devis : dessine le MÊME modèle que DevisPDF.jsx (buildDevisDocumentModel), zone par zone.
// Chaque zone est cliquable (→ le panneau ouvre le réglage) et s'encadre quand son réglage a le focus.
// Rien n'est calculé ici : si un chiffre manque, c'est le modèle qu'il faut corriger.
import { ZONES } from '@/lib/devisDocumentModel.js';

const LIBELLES = Object.fromEntries(ZONES.map((z) => [z.id, z]));

function Zone({ id, active, onClick, className = '', children, inline = false }) {
  const z = LIBELLES[id];
  const editable = !!z?.accordeon;
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={editable ? () => onClick?.(id) : undefined}
      onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(id); } } : undefined}
      title={z ? (editable ? `Modifier : ${z.libelle}` : `${z.libelle} (porté par le devis)`) : undefined}
      className={`relative rounded-sm outline-offset-2 transition-shadow ${editable ? 'cursor-pointer hover:ring-2 hover:ring-primary-300/70' : ''} ${active ? 'ring-2 ring-primary-500 bg-primary-50/40' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}

export default function ApercuDevis({ model: m, zoneActive, onZoneClick }) {
  if (!m) return null;
  const accent = m.emetteur.couleur;
  const col = m.tableau.colonnes;
  const props = (id, extra = '') => ({ id, active: zoneActive === id, onClick: onZoneClick, className: extra });

  return (
    <div className="bg-white shadow-xl rounded-sm mx-auto w-full max-w-[720px] px-10 py-9 text-[11px] leading-snug text-secondary-900 font-sans" style={{ minHeight: 960 }}>
      {/* En-tête */}
      <div className="flex justify-between items-start mb-6">
        <Zone {...props('entete', 'px-1 -mx-1')}>
          <div className="text-2xl font-bold" style={{ color: accent }}>{m.entete.titre}</div>
          {m.entete.numero && <div className="text-secondary-500 mt-1">{m.entete.numero}</div>}
          {m.entete.date && <div className="text-secondary-500">{m.entete.date}</div>}
        </Zone>
        <div className="text-right flex flex-col items-end gap-1">
          <Zone {...props('logo', 'min-w-[110px] min-h-[36px] flex items-center justify-end')}>
            {m.logo.url ? <img src={m.logo.url} alt="" className="max-h-12 max-w-[120px] object-contain" /> : <span className="text-[10px] text-secondary-300">{m.logo.visible ? 'logo (Organisation)' : 'logo masqué'}</span>}
          </Zone>
          <Zone {...props('emetteur')}>
            <div className="font-bold text-sm" style={{ color: accent }}>{m.emetteur.nom}</div>
            {m.emetteur.lignes.slice(0, 2).map((l, i) => <div key={i} className="text-secondary-500">{l}</div>)}
          </Zone>
        </div>
      </div>

      {/* Parties */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Zone {...props('emetteur', 'bg-secondary-50 rounded p-3')}>
          <div className="text-[9px] font-bold uppercase tracking-wider text-secondary-400 mb-1">Prestataire</div>
          <div>{m.emetteur.nom}</div>
          {m.emetteur.lignes.map((l, i) => <div key={i}>{l}</div>)}
        </Zone>
        <Zone {...props('client', 'bg-secondary-50 rounded p-3')}>
          <div className="text-[9px] font-bold uppercase tracking-wider text-secondary-400 mb-1">Client</div>
          {m.client.lignes.length ? m.client.lignes.map((l, i) => <div key={i}>{l}</div>) : <div>—</div>}
        </Zone>
      </div>

      {m.objet.texte && (
        <Zone {...props('objet', 'bg-orange-50 rounded p-3 mb-3')}>
          <div className="text-[9px] font-bold uppercase text-secondary-400 mb-1">Objet</div>
          <div className="font-bold">{m.objet.texte}</div>
        </Zone>
      )}

      <Zone {...props('intro', 'mb-2 min-h-[14px]')}>
        {m.intro.lignes.length ? m.intro.lignes.map((l, i) => <p key={i} className="text-secondary-700 mb-1">{l}</p>) : <span className="text-secondary-300 italic">Introduction (vide)</span>}
      </Zone>
      <Zone {...props('acompte', 'mb-3 min-h-[14px]')}>
        {m.acompte.lignes.length ? m.acompte.lignes.map((l, i) => <p key={i} className="text-secondary-700 mb-1">{l}</p>) : <span className="text-secondary-300 italic">Acompte et échéancier (vide)</span>}
      </Zone>

      {/* Tableau */}
      <Zone {...props('tableau')}>
        <div className="flex text-white text-[9px] font-bold rounded-sm px-2 py-1.5" style={{ backgroundColor: accent }}>
          <div className="flex-[4]">Désignation</div>
          {col.reference && <div className="flex-[1.5]">Réf.</div>}
          <div className="flex-1 text-center">Qté</div>
          {col.prix_unitaire && <div className="flex-[1.5] text-right">P.U. HT</div>}
          {col.tva && <div className="flex-1 text-center">TVA</div>}
          <div className="flex-[1.5] text-right">Total HT</div>
        </div>
        {m.tableau.chapitres.map((c, ci) => (
          <div key={ci}>
            {c.titre && (
              <div className="flex justify-between bg-secondary-100 text-secondary-500 font-bold uppercase tracking-wider text-[10px] px-2 py-1.5">
                <span>{c.titre}</span>
                {!col.detail && <span>{c.sous_total}</span>}
              </div>
            )}
            {c.lignes.map((l, i) => (
              <div key={i} className={`flex px-2 py-1.5 border-b border-secondary-100 ${i % 2 === 1 ? 'bg-secondary-50/60' : ''}`}>
                <div className="flex-[4]"><div>{l.designation}</div>{l.description && <div className="text-[9px] text-secondary-500">{l.description}</div>}</div>
                {col.reference && <div className="flex-[1.5]">{l.reference}</div>}
                <div className="flex-1 text-center">{l.quantite}</div>
                {col.prix_unitaire && <div className="flex-[1.5] text-right">{l.prix_unitaire}</div>}
                {col.tva && <div className="flex-1 text-center">{l.tva}</div>}
                <div className="flex-[1.5] text-right">{l.total}</div>
              </div>
            ))}
          </div>
        ))}
      </Zone>

      <Zone {...props('totaux', 'ml-auto w-[220px] mt-4')}>
        {m.totaux.lignes.map((l, i) => (
          <div key={i} className={`flex justify-between py-0.5 ${l.libelle === 'Total TTC' ? 'border-t border-secondary-300 mt-1 pt-1 text-sm font-bold' : ''} ${l.gras ? 'font-bold' : ''}`}>
            <span>{l.libelle}</span><span>{l.valeur}</span>
          </div>
        ))}
      </Zone>

      <Zone {...props('commentaire', 'mt-4')}>
        {m.commentaire.lignes.length ? (
          <>
            <div className="text-[9px] font-bold uppercase text-secondary-400 mb-1">{m.commentaire.titre}</div>
            {m.commentaire.lignes.map((l, i) => <div key={i} className="text-[10px] text-secondary-700 leading-relaxed">{l}</div>)}
          </>
        ) : <span className="text-secondary-300 italic">Commentaire du devis (saisi sur chaque devis, vide ici)</span>}
      </Zone>

      <Zone {...props('validite', 'mt-4 italic text-secondary-500')}>{m.validite.texte}</Zone>

      <Zone {...props('conditions', 'mt-4 bg-secondary-50 rounded p-3')}>
        <div className="text-[9px] font-bold uppercase text-secondary-400 mb-1">{m.conditions.titre}</div>
        {m.conditions.lignes.length ? m.conditions.lignes.map((l, i) => <div key={i} className="text-[10px] text-secondary-600 leading-relaxed">{l}</div>) : <span className="text-secondary-300 italic">Aucune condition</span>}
      </Zone>

      <Zone {...props('mention_speciale', 'mt-3 min-h-[14px] font-bold text-secondary-700')}>
        {m.mention_speciale.lignes.length ? m.mention_speciale.lignes.map((l, i) => <div key={i}>{l}</div>) : <span className="font-normal text-secondary-300 italic">Mention spéciale (vide)</span>}
      </Zone>

      <Zone {...props('paiement', 'mt-3 bg-secondary-50 rounded p-3')}>
        <div className="text-[9px] font-bold uppercase text-secondary-400 mb-1">Paiement</div>
        {m.paiement.visible ? (
          <div className="text-[10px] text-secondary-600 leading-relaxed">
            {m.paiement.etablissement && <div>Établissement : {m.paiement.etablissement}</div>}
            <div>IBAN : {m.paiement.iban}</div>
            {m.paiement.bic && <div>BIC : {m.paiement.bic}</div>}
            {m.paiement.texte && <div>{m.paiement.texte}</div>}
          </div>
        ) : (
          <span className="text-secondary-300 italic">{m.paiement.sans_iban ? 'Bloc demandé mais aucun IBAN dans Facturation' : 'Bloc paiement masqué'}</span>
        )}
      </Zone>

      <div className="flex justify-end mt-5">
        <Zone {...props('signature', 'w-[200px] border border-secondary-300 rounded p-3')}>
          <div className="text-[9px] font-bold text-secondary-500 mb-7">{m.signature.libelle}</div>
          <div className="border-t border-secondary-400 pt-1 text-[9px] text-secondary-400">{m.signature.sous_libelle}</div>
        </Zone>
      </div>

      <Zone {...props('pied_de_page', 'mt-8 pt-2 border-t border-secondary-200 text-center text-[9px] text-secondary-400')}>{m.pied_de_page.texte}</Zone>
    </div>
  );
}
