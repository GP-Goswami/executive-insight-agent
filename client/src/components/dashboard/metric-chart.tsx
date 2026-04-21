import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface MetricChartProps {
  title: string;
  data: Array<{ date: string; value: number; value2?: number }>;
  dataKey?: string;
  dataKey2?: string;
  color?: string;
  color2?: string;
  height?: number;
}

export function MetricChart({
  title,
  data,
  dataKey = "value",
  dataKey2,
  color = "#06b6d4",
  color2 = "#a855f7",
  height = 200,
}: MetricChartProps) {
  return (
    <Card className="border-white/10 bg-card/50 backdrop-blur-sm" data-testid={`chart-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
              {dataKey2 && (
                <linearGradient id={`gradient-${dataKey2}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color2} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color2} stopOpacity={0} />
                </linearGradient>
              )}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "rgb(148 163 184)", fontSize: 11 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "rgb(148 163 184)", fontSize: 11 }}
              dx={-10}
              tickFormatter={(value) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
                return value;
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(220 14% 10%)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
              }}
              labelStyle={{ color: "white", fontWeight: 500 }}
              itemStyle={{ color: "rgb(148 163 184)" }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${dataKey})`}
            />
            {dataKey2 && (
              <Area
                type="monotone"
                dataKey={dataKey2}
                stroke={color2}
                strokeWidth={2}
                fill={`url(#gradient-${dataKey2})`}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
