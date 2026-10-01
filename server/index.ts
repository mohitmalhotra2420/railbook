/* Round-52b: Render par kuch outbound hosts (NVIDIA NIM) IPv6 par hang ho jaate the — pehle IPv4. */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
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
