import { useState, useEffect } from "react";
import WebApp from "@twa-dev/sdk";
import { BottomNav } from "./components/BottomNav";
import { DashboardScreen } from "./screens/DashboardScreen";
import { AnalyticsScreen } from "./screens/AnalyticsScreen";
import type { Tab } from "./lib/types";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [drillDownTag, setDrillDownTag] = useState<string | null>(null);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    document.documentElement.classList.add("dark");

    // iOS Telegram WebView: keyboard overlaps content without resizing viewport.
    // Scroll the focused input into view after keyboard animation completes.
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        setTimeout(() => {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 300);
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, []);

  // Back button for drill-down
  useEffect(() => {
    if (drillDownTag) {
      WebApp.BackButton.show();
      const handleBack = () => setDrillDownTag(null);
      WebApp.BackButton.onClick(handleBack);
      return () => {
        WebApp.BackButton.offClick(handleBack);
        WebApp.BackButton.hide();
      };
    }
  }, [drillDownTag]);

  const handleTabChange = (tab: Tab) => {
    setDrillDownTag(null);
    setActiveTab(tab);
  };

  return (
    <div className="flex flex-col" style={{ background: "var(--bg-base)", minHeight: "100dvh" }}>
      <main className="flex-1 overflow-y-auto px-4 pb-16">
        {activeTab === "dashboard" && <DashboardScreen />}
        {activeTab === "analytics" && (
          <AnalyticsScreen
            drillDownCategory={drillDownTag}
            onDrillDown={setDrillDownTag}
            onBack={() => setDrillDownTag(null)}
          />
        )}
      </main>
      {!drillDownTag && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}
    </div>
  );
}
