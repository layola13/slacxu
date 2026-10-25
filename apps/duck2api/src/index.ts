import { createApp } from "./server.js";

const port = Number(process.env["PORT"] ?? 44090);
const app = createApp();

export default {
  port,
  fetch: app.fetch,
};

console.log(`duck2api-ts listening on :${port}`);
