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

    // Track keyboard height via visualViewport so fixed-position drawers
    // can shift up above the keyboard (iOS doesn't resize the layout viewport)
    const vv = window.visualViewport;
    if (vv) {
      const update = () => {
        const keyboardHeight = window.innerHeight - vv.height;
        document.documentElement.style.setProperty(
          "--keyboard-offset",
          `${Math.max(0, keyboardHeight)}px`
        );
      };
      vv.addEventListener("resize", update);
      return () => vv.removeEventListener("resize", update);
    }
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
