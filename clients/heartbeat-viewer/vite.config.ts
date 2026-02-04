import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const port = Number(process.env.VITE_PORT) || 5174
const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:4001"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "clients/heartbeat-viewer",
  server: {
    host: true,
    port,
    proxy: {
      "/api": backendUrl,
    },
  },
})
