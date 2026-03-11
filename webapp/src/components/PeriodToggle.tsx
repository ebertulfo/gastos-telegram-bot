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
    <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)" }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex-1 rounded-md py-1.5 text-xs transition-all"
            style={{
              background: active ? "var(--background)" : "transparent",
              color: active ? "var(--foreground)" : "var(--text-secondary)",
              fontWeight: active ? 600 : 400,
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
