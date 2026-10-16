import { useEffect, useState } from "react";
import { ipc, type RemoteStatus } from "../../lib/ipc";
import { useConfig } from "../../store/config";
import type { SectionProps } from "./registry";

export function RemoteSection({ draft, update, notify }: SectionProps) {
  const r = draft.remote ?? { enabled: false, port: 4747, allowLan: false };
  const set = (patch: Partial<typeof r>) => update((c) => (c.remote = { ...r, ...patch }));
  const saved = useConfig((s) => s.config?.remote);
  const [status, setStatus] = useState<RemoteStatus | null>(null);

  // Re-read after saves and every few seconds (Tailscale coming up, phones connecting).
  useEffect(() => {
    let alive = true;
    const load = () => ipc.remoteStatus().then((s) => alive && setStatus(s)).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [saved]);

  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => notify("Link copied."), () => notify("Couldn't copy."));

  return (
    <>
      <section className="set-group">
        <h3>Phone remote</h3>
        <label className="field check">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>Control AureliaSpace from my phone's browser</span>
        </label>
        <p className="hint">
          See every pane, read and type into it, answer Claude's questions and open new agents. Your phone reaches this Mac through{" "}
          <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a>, from anywhere, without a domain or opening ports.
        </p>
        <label className="field check">
          <input type="checkbox" checked={r.allowLan} onChange={(e) => set({ allowLan: e.target.checked })} />
          <span>Also allow phones on the same Wi-Fi without Tailscale</span>
        </label>
        <label className="field">
          <span>Port</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={r.port}
            onChange={(e) => set({ port: Math.max(1024, Math.min(65535, Number(e.target.value) || 4747)) })}
          />
        </label>
      </section>

      {status?.enabled && (
        <section className="set-group remote-pair">
          <h3>Pair your phone</h3>
          {status.error && <p className="hint err">Couldn't start: {status.error}</p>}
          {status.running && !status.tailscale && (
            <ol className="remote-steps">
              <li>Install Tailscale on this Mac and on your phone, and sign in to the same account on both.</li>
              <li>Come back here: the QR code appears once this Mac has a Tailscale address.</li>
            </ol>
          )}
          {status.qrSvg && (
            <div className="remote-qr-row">
              <div className="remote-qr" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: status.qrSvg }} />
              <div className="remote-qr-help">
                <p>Scan with your phone's camera while Tailscale is on. It opens AureliaSpace in the browser and remembers this phone.</p>
                <p className="hint">Tip: Share → Add to Home Screen makes it a full-screen app.</p>
                <p className="hint">
                  {status.clients === 0 ? "No phone connected." : status.clients === 1 ? "1 phone connected." : `${status.clients} phones connected.`}
                </p>
              </div>
            </div>
          )}
          {status.links.length > 0 && (
            <ul className="remote-links">
              {status.links.map((l) => (
                <li key={l.url}>
                  <span className="remote-link-label">{l.label}</span>
                  <code>{l.url.replace(/\?k=.*/, "")}</code>
                  <button type="button" onClick={() => copy(l.url)}>
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status.running && (
            <div className="field-row">
              <button
                type="button"
                onClick={async () => {
                  setStatus(await ipc.remoteResetToken());
                  notify("New pairing code. Phones paired before have to scan it again.");
                }}
              >
                Unpair all phones
              </button>
            </div>
          )}
          <p className="hint">Anyone with the pairing link can type into your terminals, so keep it to your own devices.</p>
        </section>
      )}
      {r.enabled !== (saved?.enabled ?? false) && <p className="hint">Save to {r.enabled ? "start" : "stop"} the remote.</p>}
    </>
  );
}
