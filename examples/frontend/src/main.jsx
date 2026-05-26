import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>PocketStack Frontend Adapter</h1>
      <p>This Vite app is mounted and started inside a browser WebContainer.</p>
      <p>Mode: {import.meta.env.VITE_POCKETSTACK_MODE || "unknown"}</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
