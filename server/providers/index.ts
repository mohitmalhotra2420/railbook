import { env } from "../env.js";
import { AuthorizedRailwayProvider } from "./authorized.js";
import { MockRailwayProvider } from "./mock.js";
import { RailKitProvider } from "../railway/railkit.js";
import { RailCoreProvider } from "../railway/railcore.js";
import { FallbackRailwayProvider, resetFallbackProvider } from "../railway/router.js";
import type { RailwayProvider } from "./types.js";

let instance: RailwayProvider | null = null;

export function getProvider(): RailwayProvider {
  if (instance) return instance;
  if (env.provider === "authorized") {
    instance = new AuthorizedRailwayProvider();
  } else if (env.provider === "railkit") {
    instance = new RailKitProvider();
  } else if (env.provider === "mock") {
    instance = new MockRailwayProvider();
  } else {
    // Default and any other value: RailCore primary + RailKit fallback.
    instance = new FallbackRailwayProvider();
  }
  return instance;
}

export function setProvider(next: RailwayProvider | null): void {
  instance = next;
  if (!next) resetFallbackProvider();
}

export type { RailwayProvider } from "./types.js";
export { RailCoreProvider, RailKitProvider, FallbackRailwayProvider };
