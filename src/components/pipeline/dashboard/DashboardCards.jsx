import { Card, CardContent } from '@components/ui/card';
import { Users, CalendarCheck, Trophy, Euro } from 'lucide-react';
import { formatEuro } from '@lib/utils';

const CARD_CONFIG = [
  {
    key: 'leads',
    title: 'Leads',
    icon: Users,
    iconBg: 'bg-blue-500',
    getValue: (d) => d.totalLeads,
    getSub: () => null,
  },
  {
    key: 'rdv',
    title: 'Rendez-vous',
    icon: CalendarCheck,
    iconBg: 'bg-amber-500',
    getValue: (d) => d.appointments,
    getSub: (d) =>
      d.totalLeads > 0 ? `${d.conversionRdv.toFixed(1)}% des leads` : null,
    subColor: 'text-amber-600',
  },
  {
    key: 'ventes',
    title: 'Ventes',
    icon: Trophy,
    iconBg: 'bg-emerald-500',
    getValue: (d) => d.sales,
    getSub: (d) => {
      const parts = [];
      if (d.totalLeads > 0) parts.push(`${d.conversionVente.toFixed(1)}% conv.`);
      if (d.ticketMoyen > 0) parts.push(`TM ${formatEuro(d.ticketMoyen)}`);
      return parts.length > 0 ? parts.join(' · ') : null;
    },
    subColor: 'text-emerald-600',
  },
  {
    key: 'ca',
    title: 'CA HT',
    icon: Euro,
    iconBg: 'bg-indigo-500',
    getValue: (d) => formatEuro(d.revenue),
    getSub: () => null,
  },
];

export const DashboardCards = ({ data }) => {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {CARD_CONFIG.map((card) => {
        const Icon = card.icon;
        const subText = card.getSub?.(data);
        return (
          <Card key={card.key} className="hover:shadow-md transition-shadow border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-secondary-500">{card.title}</span>
                <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-secondary-900">{card.getValue(data)}</p>
              {subText && (
                <p className={`text-xs mt-1 font-medium ${card.subColor || 'text-secondary-400'}`}>
                  {subText}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
