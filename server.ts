// Railway / local development entry point.
// Wraps the shared Express app with Vite (dev) or static (prod) frontend serving,
// initialises the database, and starts the HTTP server.

import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";
import { createApp, initDb } from "./lib/app.js";

dotenvConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createApp();
  const PORT = parseInt(process.env.PORT || "8080");

  //  Frontend 
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const { default: express } = await import("express");
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) =>
      res.sendFile(path.join(__dirname, "dist", "index.html"))
    );
  }

  //  Database 
  await initDb();

  //  HTTP server 
  const server = app.listen(PORT, "0.0.0.0", () =>
    console.log(`🎵 SonicStream running on http://localhost:${PORT}`)
  );

  // Graceful shutdown so Railway sees a clean stop (exit 0), not a crash
  function shutdown(signal: string) {
    console.log(`${signal} received – shutting down gracefully`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

startServer();
