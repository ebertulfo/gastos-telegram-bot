import { useState, useEffect } from "react";
import WebApp from "@twa-dev/sdk";
import { BottomNav } from "./components/BottomNav";
import { DashboardScreen } from "./screens/DashboardScreen";
import { AnalyticsScreen } from "./screens/AnalyticsScreen";
import type { Tab } from "./lib/types";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [drillDownCategory, setDrillDownCategory] = useState<string | null>(null);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();

    const updateTheme = () => {
      document.documentElement.classList.toggle("dark", WebApp.colorScheme === "dark");
    };
    updateTheme();
    WebApp.onEvent("themeChanged", updateTheme);
    return () => WebApp.offEvent("themeChanged", updateTheme);
  }, []);

  // Back button for drill-down
  useEffect(() => {
    if (drillDownCategory) {
      WebApp.BackButton.show();
      const handleBack = () => setDrillDownCategory(null);
      WebApp.BackButton.onClick(handleBack);
      return () => {
        WebApp.BackButton.offClick(handleBack);
        WebApp.BackButton.hide();
      };
    }
  }, [drillDownCategory]);

  const handleTabChange = (tab: Tab) => {
    setDrillDownCategory(null); // reset drill-down on tab switch
    setActiveTab(tab);
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--background)" }}>
      <main className="flex-1 overflow-y-auto px-4 pb-16">
        {activeTab === "dashboard" && <DashboardScreen />}
        {activeTab === "analytics" && (
          <AnalyticsScreen
            drillDownCategory={drillDownCategory}
            onDrillDown={setDrillDownCategory}
            onBack={() => setDrillDownCategory(null)}
          />
        )}
      </main>
      {!drillDownCategory && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}
    </div>
  );
}
