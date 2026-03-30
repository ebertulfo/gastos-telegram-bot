type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type DonutChartProps = {
  segments: DonutSegment[];
  total: string; // formatted total string
  currency: string;
  size?: number;
};

export function DonutChart({ segments, total, currency, size = 120 }: DonutChartProps) {
  const center = size / 2;
  const radius = size * 0.4;
  const strokeWidth = size * 0.15;
  const circumference = 2 * Math.PI * radius;
  const totalValue = segments.reduce((sum, s) => sum + s.value, 0);

  let accumulated = 0;

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--bg-raised)"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {segments.map((segment) => {
          const pct = totalValue > 0 ? segment.value / totalValue : 0;
          const dashLength = circumference * pct;
          const dashOffset = circumference * (0.25 - accumulated); // start from top
          accumulated += pct;

          return (
            <circle
              key={segment.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          );
        })}
        {/* Center text */}
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          className="text-sm font-bold"
          style={{ fill: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
        >
          {total}
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          className="text-[9px]"
          style={{ fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
        >
          {currency}
        </text>
      </svg>
    </div>
  );
}
