import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const port = Number(process.env.VITE_PORT) || 5101
const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:5100"

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
