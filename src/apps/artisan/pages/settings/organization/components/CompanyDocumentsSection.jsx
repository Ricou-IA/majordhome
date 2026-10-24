// src/apps/artisan/pages/settings/organization/components/CompanyDocumentsSection.jsx
// Documents de l'entreprise (certifications, attestation fluides, attestation d'assurance) :
// zones de dépôt org-scopées dans le bucket product-documents. La liste est portée par le
// formulaire parent (settings.company_documents) — le Storage n'est purgé qu'à l'Enregistrement
// (ou à l'Annulation pour un fichier déposé puis abandonné), cf. IdentityTab.
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Trash2, Loader2, FileText, ExternalLink } from 'lucide-react';
import { storageService } from '@services/storage.service';
import {
  COMPANY_DOCUMENT_KINDS, COMPANY_DOCUMENT_MIME_TYPES, COMPANY_DOCUMENT_MAX_BYTES,
  buildCompanyDocumentPath, expiryStatus,
} from '@/lib/companyDocuments';

export const COMPANY_DOCUMENTS_BUCKET = 'product-documents';

const BADGES = {
  soon: { label: 'Expire bientôt', className: 'bg-amber-100 text-amber-800' },
  expired: { label: 'Expiré', className: 'bg-secondary-800 text-white' },
};

function DocumentRow({ doc, onOpen, onRemove, onDateChange }) {
  const badge = BADGES[expiryStatus(doc.valid_until)];
  return (
    <li className="flex items-center gap-3 flex-wrap py-2">
      <button type="button" onClick={() => onOpen(doc.path)} className="flex items-center gap-2 text-sm text-primary-700 hover:underline min-w-0">
        <FileText className="w-4 h-4 shrink-0" />
        <span className="truncate max-w-[16rem]">{doc.name}</span>
        <ExternalLink className="w-3 h-3 shrink-0" />
      </button>
      <label className="flex items-center gap-1 text-xs text-secondary-500 ml-auto">
        Valide jusqu’au
        <input
          type="date"
          value={doc.valid_until || ''}
          onChange={(e) => onDateChange(e.target.value || null)}
          className="px-2 py-1 border border-secondary-300 rounded-md text-xs"
        />
      </label>
      {badge && <span className={`text-xs px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>}
      <button type="button" onClick={onRemove} title="Retirer" className="text-secondary-400 hover:text-secondary-800">
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}

function DropZone({ kind, orgId, docs, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const upload = async (files) => {
    const list = Array.from(files || []);
    if (!list.length || !orgId) return;
    const accepted = kind.multiple ? list : list.slice(0, 1);
    const added = [];
    setBusy(true);
    for (const file of accepted) {
      if (!COMPANY_DOCUMENT_MIME_TYPES.includes(file.type)) { toast.error(`${file.name} : format non accepté (PDF, JPG ou PNG)`); continue; }
      if (file.size > COMPANY_DOCUMENT_MAX_BYTES) { toast.error(`${file.name} : fichier trop lourd (5 Mo maximum)`); continue; }
      const target = buildCompanyDocumentPath(orgId, kind.key, file.name);
      const { path, error } = await storageService.uploadFile(COMPANY_DOCUMENTS_BUCKET, target, file, { contentType: file.type });
      if (error || !path) { toast.error(`${file.name} : échec de l'upload (${error?.message ?? 'erreur inconnue'})`); continue; }
      added.push({ path, name: file.name, valid_until: null });
    }
    setBusy(false);
    if (!added.length) return;
    onChange(kind.multiple ? [...docs, ...added] : added);
    toast.success(`${added.length > 1 ? `${added.length} documents déposés` : 'Document déposé'} — ne pas oublier d’Enregistrer`);
  };

  const open = async (path) => {
    const win = window.open('', '_blank');
    const { url, error } = await storageService.getSignedUrl(COMPANY_DOCUMENTS_BUCKET, path);
    if (error || !url) { win?.close(); toast.error('Document introuvable'); return; }
    if (win) win.location.href = url; else window.location.href = url;
  };

  const update = (index, patch) => onChange(docs.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const showZone = kind.multiple || docs.length === 0;

  return (
    <div>
      <p className="text-sm font-medium text-secondary-800">{kind.label}</p>
      <p className="text-xs text-secondary-500 mb-2">{kind.hint}</p>
      {docs.length > 0 && (
        <ul className="divide-y divide-secondary-100 mb-2">
          {docs.map((doc, i) => (
            <DocumentRow
              key={doc.path}
              doc={doc}
              onOpen={open}
              onRemove={() => onChange(docs.filter((_, j) => j !== i))}
              onDateChange={(valid_until) => update(i, { valid_until })}
            />
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={COMPANY_DOCUMENT_MIME_TYPES.join(',')}
        multiple={kind.multiple}
        className="hidden"
        onChange={(e) => { upload(e.target.files); e.target.value = ''; }}
      />
      {showZone ? (
        <button
          type="button"
          disabled={busy || !orgId}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          className={`w-full border-2 border-dashed rounded-md px-4 py-5 flex items-center justify-center gap-2 text-sm transition-colors disabled:opacity-50 ${over ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-secondary-300 text-secondary-500 hover:border-secondary-400'}`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Déposer {kind.multiple ? 'des fichiers' : 'le fichier'} ici ou cliquer — PDF, JPG ou PNG, 5 Mo maximum
        </button>
      ) : (
        <button type="button" disabled={busy || !orgId} onClick={() => fileRef.current?.click()} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Remplacer
        </button>
      )}
    </div>
  );
}

export default function CompanyDocumentsSection({ orgId, value, onChange }) {
  return (
    <div className="space-y-6">
      {COMPANY_DOCUMENT_KINDS.map((kind) => (
        <DropZone
          key={kind.key}
          kind={kind}
          orgId={orgId}
          docs={value[kind.key] || []}
          onChange={(docs) => onChange({ ...value, [kind.key]: docs })}
        />
      ))}
    </div>
  );
}
