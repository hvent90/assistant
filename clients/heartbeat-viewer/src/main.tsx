import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

function App() {
  return (
    <div className="flex h-dvh bg-black text-white items-center justify-center">
      <p className="text-neutral-500">heartbeat viewer</p>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
