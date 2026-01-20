import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';

export const ConversionFunnel = ({ data }) => {
  const appointmentRate = data.totalLeads > 0 ? (data.appointments / data.totalLeads) * 100 : 0;
  const salesRate = data.appointments > 0 ? (data.sales / data.appointments) * 100 : 0;

  const stages = [
    {
      label: 'Nouveau',
      value: data.totalLeads,
      percentage: 100,
      color: 'bg-primary',
    },
    {
      label: 'Rendez-vous',
      value: data.appointments,
      percentage: appointmentRate,
      color: 'bg-accent',
      conversionRate: appointmentRate,
    },
    {
      label: 'Vendu',
      value: data.sales,
      percentage: data.totalLeads > 0 ? (data.sales / data.totalLeads) * 100 : 0,
      color: 'bg-success',
      conversionRate: salesRate,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funnel de conversion</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {stages.map((stage, index) => (
            <div key={stage.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stage.label}</span>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground">{stage.value}</span>
                  {index > 0 && stage.conversionRate !== undefined && (
                    <span className="text-xs text-success">
                      {stage.conversionRate.toFixed(1)}% de conversion
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-8 overflow-hidden">
                <div
                  className={`h-full ${stage.color} transition-all duration-500 flex items-center justify-end px-3`}
                  style={{ width: `${stage.percentage}%` }}
                >
                  <span className="text-xs font-medium text-white">{stage.percentage.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
