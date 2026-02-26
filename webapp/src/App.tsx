import { useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import DashboardScreen from '@/screens/DashboardScreen'
import ReviewQueueScreen from '@/screens/ReviewQueueScreen'

function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "review">("dashboard");

  return (
    <AppLayout activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === "dashboard" && <DashboardScreen />}
      {activeTab === "review" && <ReviewQueueScreen />}
    </AppLayout>
  )
}

export default App
