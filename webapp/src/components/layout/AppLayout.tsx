import { useEffect } from "react";
import { ListIcon, PieChartIcon } from "lucide-react";
import WebApp from "@twa-dev/sdk";

interface AppLayoutProps {
    children: React.ReactNode;
    activeTab: "dashboard" | "analytics" | "review";
    setActiveTab: (tab: "dashboard" | "analytics" | "review") => void;
}

export default function AppLayout({ children, activeTab, setActiveTab }: AppLayoutProps) {
    useEffect(() => {
        // Notify Telegram we are ready
        WebApp.ready();
        // Expand to full height on mobile
        WebApp.expand();

        const updateTheme = () => {
            if (WebApp.colorScheme === "dark") {
                document.documentElement.classList.add("dark");
            } else {
                document.documentElement.classList.remove("dark");
            }
        };

        updateTheme();
        WebApp.onEvent("themeChanged", updateTheme);

        return () => {
            WebApp.offEvent("themeChanged", updateTheme);
        };
    }, []);

    return (
        <div className="flex flex-col h-screen max-h-screen w-full bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)] overflow-hidden font-sans">
            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto pb-16">
                {children}
            </main>

            {/* Bottom Navigation Bar */}
            <nav className="fixed bottom-0 left-0 w-full h-16 bg-[var(--tg-theme-secondary-bg-color,var(--tg-theme-bg-color))] border-t border-[var(--tg-theme-hint-color)] border-opacity-20 flex items-center justify-around z-50">
                <button
                    onClick={() => setActiveTab("dashboard")}
                    className={`flex flex-col items-center justify-center w-full h-full transition-colors ${activeTab === "dashboard"
                        ? "text-[var(--tg-theme-button-color)]"
                        : "text-[var(--tg-theme-hint-color)]"
                        }`}
                >
                    <ListIcon className="w-6 h-6 mb-1" />
                    <span className="text-xs font-medium">Dashboard</span>
                </button>

                <button
                    onClick={() => setActiveTab("analytics")}
                    className={`flex flex-col items-center justify-center w-full h-full transition-colors ${activeTab === "analytics"
                        ? "text-[var(--tg-theme-button-color)]"
                        : "text-[var(--tg-theme-hint-color)]"
                        }`}
                >
                    <PieChartIcon className="w-6 h-6 mb-1" />
                    <span className="text-xs font-medium">Analytics</span>
                </button>

                <button
                    onClick={() => setActiveTab("review")}
                    className={`flex flex-col items-center justify-center w-full h-full transition-colors ${activeTab === "review"
                        ? "text-[var(--tg-theme-button-color)]"
                        : "text-[var(--tg-theme-hint-color)]"
                        }`}
                >
                    <div className="relative">
                        <ListIcon className="w-6 h-6 mb-1" />
                    </div>
                    <span className="text-xs font-medium">Review Queue</span>
                </button>
            </nav>
        </div>
    );
}
