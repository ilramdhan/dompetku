import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { usePrivacy } from "@/lib/privacy";
import { tooltipStyle } from "./shared";

export type DonutSlice = { name: string; value: number; color: string };

export default function DonutChart({
  data,
  innerRadius,
  outerRadius,
  styledTooltip = true,
}: {
  data: DonutSlice[];
  innerRadius: number;
  outerRadius: number;
  styledTooltip?: boolean;
}) {
  usePrivacy();
  const { t } = useI18n();
  const total = data.reduce((s, d) => s + d.value, 0);
  const summary = `${t("Rincian grafik")}: ${data
    .map(
      (d) =>
        `${d.name} ${money(d.value)}${total > 0 ? ` (${Math.round((d.value / total) * 100)}%)` : ""}`,
    )
    .join(", ")}`;
  return (
    <div role="img" aria-label={summary} className="h-full w-full">
      <div aria-hidden="true" className="h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
            >
              {data.map((c, i) => (
                <Cell key={i} fill={c.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => money(v)}
              contentStyle={styledTooltip ? tooltipStyle : undefined}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
