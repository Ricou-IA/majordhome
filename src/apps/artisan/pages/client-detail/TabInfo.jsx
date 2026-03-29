import { User, Phone, MapPin, Home, FileText, ExternalLink } from 'lucide-react';
import { FormField, TextInput, PhoneInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';
import { CLIENT_CATEGORIES, LEAD_SOURCES, HOUSING_TYPES } from '@services/clients.service';

export const TabInfo = ({ formData, setFormData, isLocked }) => {
  const u = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-8">
      {/* Identité */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-secondary-500" />
          Identité
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Nom" required>
            <TextInput value={formData.lastName} onChange={(v) => u('lastName', v.toUpperCase())} placeholder="DUPONT" disabled={isLocked} />
          </FormField>
          <FormField label="Prénom">
            <TextInput value={formData.firstName} onChange={(v) => u('firstName', v.toUpperCase())} placeholder="JEAN" disabled={isLocked} />
          </FormField>
          <FormField label="Catégorie">
            <SelectInput value={formData.clientCategory} onChange={(v) => u('clientCategory', v)} options={CLIENT_CATEGORIES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <FormField label="Société">
            <TextInput value={formData.companyName} onChange={(v) => u('companyName', v)} placeholder="Entreprise (optionnel)" disabled={isLocked} />
          </FormField>
          <FormField label="Source">
            <SelectInput value={formData.leadSource} onChange={(v) => u('leadSource', v)} options={LEAD_SOURCES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <Phone className="w-4 h-4 text-secondary-500" />
          Contact
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Téléphone">
            <PhoneInput value={formData.phone} onChange={(v) => u('phone', v)} disabled={isLocked} />
          </FormField>
          <FormField label="Téléphone secondaire">
            <PhoneInput value={formData.phoneSecondary} onChange={(v) => u('phoneSecondary', v)} placeholder="Fixe, bureau..." disabled={isLocked} />
          </FormField>
          <FormField label="Email">
            <TextInput value={formData.email} onChange={(v) => u('email', v)} placeholder="client@email.com" type="email" disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Adresse */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-secondary-500" />
          Adresse
        </h3>
        <div className="space-y-4">
          <FormField label="Adresse">
            <TextInput value={formData.address} onChange={(v) => u('address', v)} placeholder="12 rue des Lilas" disabled={isLocked} />
          </FormField>
          <FormField label="Complément">
            <TextInput value={formData.addressComplement} onChange={(v) => u('addressComplement', v)} placeholder="Bâtiment, étage..." disabled={isLocked} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code postal">
              <TextInput value={formData.postalCode} onChange={(v) => u('postalCode', v)} placeholder="40100" disabled={isLocked} />
            </FormField>
            <FormField label="Ville">
              <TextInput value={formData.city} onChange={(v) => u('city', v)} placeholder="Dax" disabled={isLocked} />
            </FormField>
          </div>
          <FormField label="Instructions d'accès">
            <TextInput value={formData.accessInstructions} onChange={(v) => u('accessInstructions', v)} placeholder="Digicode, portail, code clé..." disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Logement */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <Home className="w-4 h-4 text-secondary-500" />
          Logement
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Type">
            <SelectInput value={formData.housingType} onChange={(v) => u('housingType', v)} options={HOUSING_TYPES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
          <FormField label="Surface (m²)">
            <TextInput value={formData.surface} onChange={(v) => u('surface', v)} placeholder="120" type="number" disabled={isLocked} />
          </FormField>
          <FormField label="N° DPE ADEME">
            <div className="flex gap-2">
              <TextInput value={formData.dpeNumber} onChange={(v) => u('dpeNumber', v)} placeholder="2341E0000000X" disabled={isLocked} />
              {formData.dpeNumber && (
                <a
                  href={`https://observatoire-dpe.ademe.fr/trouver-dpe#${formData.dpeNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                  title="Voir sur ADEME"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              )}
            </div>
          </FormField>
        </div>
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-secondary-500" />
          Notes
        </h3>
        <TextArea value={formData.notes} onChange={(v) => u('notes', v)} placeholder="Notes visibles par toute l'équipe..." rows={3} disabled={isLocked} />
        <div className="mt-4">
          <FormField label="Notes internes">
            <TextArea value={formData.internalNotes} onChange={(v) => u('internalNotes', v)} placeholder="Notes internes (non visibles par le client)" rows={2} disabled={isLocked} />
          </FormField>
        </div>
      </section>
    </div>
  );
};
