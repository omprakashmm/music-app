// Vercel serverless entry point.
// Vercel serves the Vite-built frontend from /dist automatically.
// All /api/* requests are routed here by vercel.json rewrites.
import { createApp } from "../lib/app.js";

const app = createApp();

export default app;
