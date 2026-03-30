type PeriodOption = {
  value: string;
  label: string;
};

type PeriodToggleProps = {
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
};

export function PeriodToggle({ options, value, onChange }: PeriodToggleProps) {
  return (
    <div
      className="flex p-0.5"
      style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-md)" }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex-1 py-1.5 text-xs transition-all"
            style={{
              background: active ? "var(--bg-elevated)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              fontWeight: active ? 600 : 400,
              fontFamily: "var(--font-mono)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
