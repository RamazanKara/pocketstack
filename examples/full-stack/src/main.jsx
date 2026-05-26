import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const [api, setApi] = useState("loading");
  const [db, setDb] = useState("loading");

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/health`)
      .then((response) => response.json())
      .then((payload) => setApi(JSON.stringify(payload)))
      .catch((error) => setApi(error.message));

    fetch(import.meta.env.VITE_POCKETSTACK_DB_DB_URL + "/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "select name from todos order by id" }),
    })
      .then((response) => response.json())
      .then((payload) => setDb(JSON.stringify(payload.result)))
      .catch((error) => setDb(error.message));
  }, []);

  return (
    <main>
      <h1>PocketStack full-stack demo</h1>
      <section>
        <h2>Mock API</h2>
        <pre>{api}</pre>
      </section>
      <section>
        <h2>PGlite query bridge</h2>
        <pre>{db}</pre>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
