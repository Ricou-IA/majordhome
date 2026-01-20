import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Users, Calendar, TrendingUp, DollarSign, Target, Percent } from 'lucide-react';

export const DashboardCards = ({ data, isAdmin }) => {
  const statCards = [
    {
      title: 'Leads',
      value: data.totalLeads,
      icon: Users,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Rendez-vous',
      value: data.appointments,
      icon: Calendar,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'Ventes',
      value: data.sales,
      icon: TrendingUp,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
    {
      title: 'CA HT',
      value: `${data.revenue.toLocaleString('fr-FR')} €`,
      icon: DollarSign,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
    ...(isAdmin
      ? [
          {
            title: 'Dépenses',
            value: `${data.expenses.toLocaleString('fr-FR')} €`,
            icon: Target,
            color: 'text-warning',
            bgColor: 'bg-warning/10',
          },
          {
            title: 'ROI',
            value: `${data.roi.toFixed(1)}%`,
            icon: Percent,
            color: data.roi >= 0 ? 'text-success' : 'text-destructive',
            bgColor: data.roi >= 0 ? 'bg-success/10' : 'bg-destructive/10',
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {statCards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`p-1.5 sm:p-2 rounded-lg ${card.bgColor}`}>
                <Icon className={`h-3 w-3 sm:h-4 sm:w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-lg sm:text-2xl font-bold truncate">{card.value}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
