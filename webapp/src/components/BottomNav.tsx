import { LayoutList, PieChart } from "lucide-react";
import type { Tab } from "../lib/types";

type BottomNavProps = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

const TABS: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutList },
  { id: "analytics", label: "Analytics", icon: PieChart },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 flex border-t bg-[var(--background)]"
         style={{ borderColor: "var(--border)" }}>
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2"
          >
            <Icon
              size={20}
              color={active ? "var(--foreground)" : "var(--text-secondary)"}
              strokeWidth={active ? 2.5 : 1.5}
            />
            <span
              className="text-[10px]"
              style={{
                color: active ? "var(--foreground)" : "var(--text-secondary)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
