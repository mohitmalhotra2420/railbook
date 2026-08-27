import { useEffect, useState } from "react";
import { api, type NvidiaAdminCatalog } from "../api";

export function AdminModels() {
  const [nvidia, setNvidia] = useState<NvidiaAdminCatalog | null>(null);
  const [nvidiaBusy, setNvidiaBusy] = useState(false);
  const [nvidiaErr, setNvidiaErr] = useState<string | null>(null);

  async function loadNvidia(refresh = false) {
    setNvidiaBusy(true);
    setNvidiaErr(null);
    try {
      const data = refresh ? await api.refreshNvidiaModels() : await api.nvidiaModels(false);
      setNvidia(data);
      if (data.error) setNvidiaErr(data.error);
    } catch (e) {
      setNvidiaErr(e instanceof Error ? e.message : "Could not load NVIDIA models.");
    } finally {
      setNvidiaBusy(false);
    }
  }

  useEffect(() => {
    void loadNvidia(false);
  }, []);

  return (
    <div className="page tight">
      <header className="topbar">
        <div className="brand">AI Models</div>
        <div className="spacer" />
        <a className="icon-btn ghost" href="#/" title="Back to booking">
          ←
        </a>
      </header>
      <p className="lede" style={{ padding: "12px 16px 0" }}>
        NVIDIA NIM catalog. Keys stay on the server. Live booking model is NVIDIA_MODEL.
      </p>
      <div style={{ padding: 16 }}>
        <button className="btn primary" disabled={nvidiaBusy} onClick={() => void loadNvidia(true)}>
          {nvidiaBusy ? "Checking NVIDIA…" : "Check NVIDIA models"}
        </button>
        {nvidiaErr && <div className="banner err" style={{ marginTop: 12 }}>{nvidiaErr}</div>}
        {nvidia && (
          <div className="list-card" style={{ marginTop: 16 }}>
            <div><strong>{nvidia.label}</strong></div>
            <div className="muted">Models available: {nvidia.modelsAvailable}</div>
            <div className="muted">Chat-suitable: {nvidia.suitableCount}</div>
            <div className="muted">Endpoint: {nvidia.endpoint}</div>
            <div className="muted">Fetched: {nvidia.fetchedAt ?? "never"}</div>
          </div>
        )}
        {nvidia?.models.map((m) => (
          <article key={m.id} className="list-card">
            <strong>{m.id}</strong>
            <div>{m.name}</div>
            <div className="muted">Provider: {m.provider ?? "unknown"}</div>
            <div className="muted">
              Type: {m.kind}
              {m.capabilities?.length ? ` · ${m.capabilities.join(", ")}` : ""}
            </div>
            <div className="muted">Context length: {m.contextLength ?? "unknown"}</div>
            <div className="muted">{m.suitable ? "chat/text generation" : "filtered (not chat)"}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
