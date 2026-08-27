import { createApp } from "./app.js";
import { env } from "./env.js";
import { getProvider } from "./providers/index.js";

const app = createApp();
const provider = getProvider();

app.listen(env.port, "0.0.0.0", () => {
  console.log(
    `RailBook API on :${env.port} · provider=${provider.id}${provider.mock ? " (mock)" : ""}`,
  );
});
