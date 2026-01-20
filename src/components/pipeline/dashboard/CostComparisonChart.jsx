import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export const CostComparisonChart = ({ sourceMetrics }) => {
  const chartData = sourceMetrics.map((metric) => ({
    name: metric.sourceName,
    CPL: metric.cpl,
    CPRDV: metric.cpAppointment,
    CPVente: metric.cpSale,
  }));

  if (sourceMetrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comparaison des coûts par source</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">Aucune donnée disponible</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparaison des coûts par source</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
              }}
              formatter={(value) => `${value.toFixed(2)} €`}
            />
            <Legend />
            <Bar dataKey="CPL" fill="hsl(var(--primary))" name="CPL (€)" />
            <Bar dataKey="CPRDV" fill="hsl(var(--accent))" name="CPRDV (€)" />
            <Bar dataKey="CPVente" fill="hsl(var(--success))" name="CPVente (€)" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
