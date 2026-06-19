import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { client } from "@/gen/client.gen"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

// Use relative base URL so requests stay on the same origin.
// In dev, Vite proxies /api/* to the bridge on localhost:3030.
client.setConfig({ baseUrl: "" })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
