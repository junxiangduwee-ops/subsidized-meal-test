'use client';

import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatSen } from '@/lib/money';

// Categorical palette: distinguishable at small sizes and in greyscale order.
const SERIES = ['#ea580c', '#0284c7', '#059669', '#7c3aed', '#d97706', '#0891b2', '#be123c'];

const axis = { stroke: '#94a3b8', fontSize: 11 };
const grid = { stroke: '#e2e8f0', strokeDasharray: '3 3' } as const;

function tooltipStyle() {
  return {
    contentStyle: {
      borderRadius: 8,
      border: '1px solid #e2e8f0',
      fontSize: 12,
      boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
    },
  };
}

export function WeeklyDemandChart({
  data,
}: {
  data: Array<{ label: string; meals: number; orders: number }>;
}) {
  const t = useTranslations('charts');
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="label" {...axis} tickLine={false} interval="preserveStartEnd" />
        <YAxis {...axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle()} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="meals" name={t('meals')} stroke={SERIES[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="orders" name={t('orders')} stroke={SERIES[1]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SpendChart({
  data,
}: {
  data: Array<{ label: string; staff: number; company: number }>;
}) {
  const t = useTranslations('charts');
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="label" {...axis} tickLine={false} interval="preserveStartEnd" />
        <YAxis
          {...axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v / 100)}`}
        />
        <Tooltip {...tooltipStyle()} formatter={(v) => formatSen(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="staff" name={t('staffPaid')} stackId="a" fill={SERIES[1]} radius={[0, 0, 0, 0]} />
        <Bar dataKey="company" name={t('companySubsidy')} stackId="a" fill={SERIES[2]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WeekdayChart({ data }: { data: Array<{ weekday: string; meals: number }> }) {
  const t = useTranslations('charts');
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="weekday" {...axis} tickLine={false} />
        <YAxis {...axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle()} />
        <Bar dataKey="meals" name={t('meals')} fill={SERIES[0]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RestaurantShareChart({ data }: { data: Array<{ name: string; grossSen: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="grossSen"
          nameKey="name"
          innerRadius={52}
          outerRadius={82}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle()} formatter={(v) => formatSen(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
