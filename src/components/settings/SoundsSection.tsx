import { useState } from "react";
import { shortenPath } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { notify as banner } from "../../lib/notify";
import { newTopic, pushTest } from "../../lib/push";
import { playSound, SOUND_DEFAULTS, SOUND_EVENTS, SOUNDS, type SoundEvent } from "../../lib/sounds";
import type { SectionProps } from "./registry";

function SoundPick({ value, volume, onChange }: { value: string; volume: number; onChange(id: string): void }) {
  return (
    <div className="field-row">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {SOUNDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}: {s.desc}
          </option>
        ))}
        <option value="off">Off</option>
      </select>
      <button type="button" disabled={value === "off"} onClick={() => playSound(value, volume)} title="Preview">
        ▶
      </button>
    </div>
  );
}

export function SoundsSection({ draft, update, notify }: SectionProps) {
  const sounds = draft.sounds;
  const push = draft.push;
  const [pushing, setPushing] = useState(false);

  const addProject = async () => {
    const picked = await ipc.pickFolder("~").catch(() => null);
    if (picked) update((c) => (c.sounds.projects[picked] ??= {}));
  };

  return (
    <>
      <section className="set-group">
        <h3>Alert sounds</h3>
        <label className="field check">
          <input type="checkbox" checked={sounds.enabled} onChange={(e) => update((c) => (c.sounds.enabled = e.target.checked))} />
          <span>Play a sound when an agent needs you</span>
        </label>
        <label className="field">
          <span>Volume</span>
          <input type="range" min={0} max={100} value={sounds.volume} onChange={(e) => update((c) => (c.sounds.volume = Number(e.target.value)))} />
        </label>
        {SOUND_EVENTS.map((ev) => (
          <label className="field" key={ev.id}>
            <span>
              {ev.label} <small className="hint">{ev.hint}</small>
            </span>
            <SoundPick
              value={sounds.events[ev.id] ?? SOUND_DEFAULTS[ev.id]}
              volume={sounds.volume}
              onChange={(id) => update((c) => (c.sounds.events[ev.id] = id))}
            />
          </label>
        ))}
        <p className="hint">
          Sounds play from inside AureliaSpace, so macOS Focus can't mute them. No sound plays for the pane you're looking at.
        </p>
      </section>

      <section className="set-group">
        <h3>Per project</h3>
        <p className="hint">Give a project its own sounds. Any folder below it counts; events you leave on "Same as above" use the sounds above.</p>
        {Object.entries(sounds.projects).map(([dir, own]) => (
          <div className="set-card" key={dir}>
            <div className="field-row">
              <strong title={dir}>{shortenPath(dir)}</strong>
              <button type="button" onClick={() => update((c) => delete c.sounds.projects[dir])}>
                Remove
              </button>
            </div>
            {SOUND_EVENTS.map((ev) => (
              <label className="field" key={ev.id}>
                <span>{ev.label}</span>
                <div className="field-row">
                  <select
                    value={own[ev.id] ?? ""}
                    onChange={(e) =>
                      update((c) => {
                        if (e.target.value) c.sounds.projects[dir][ev.id as SoundEvent] = e.target.value;
                        else delete c.sounds.projects[dir][ev.id];
                      })
                    }
                  >
                    <option value="">Same as above</option>
                    {SOUNDS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="off">Off</option>
                  </select>
                  <button type="button" disabled={!own[ev.id] || own[ev.id] === "off"} onClick={() => playSound(own[ev.id], sounds.volume)} title="Preview">
                    ▶
                  </button>
                </div>
              </label>
            ))}
          </div>
        ))}
        <button type="button" onClick={addProject}>
          Add a project…
        </button>
      </section>

      <section className="set-group">
        <h3>Desktop banner</h3>
        <p className="hint">
          macOS banners follow your Focus settings. If one doesn't show, allow AureliaSpace under System Settings → Focus → your Focus →
          Allowed Notifications → Apps.
        </p>
        <button type="button" onClick={() => banner("AureliaSpace", "If you can read this, banners get through.").then(() => notify("Test banner sent."))}>
          Send a test banner
        </button>
      </section>

      <section className="set-group">
        <h3>Phone alerts</h3>
        <label className="field check">
          <input type="checkbox" checked={push.enabled} onChange={(e) => update((c) => (c.push.enabled = e.target.checked))} />
          <span>Send alerts to my phone while AureliaSpace isn't the focused app</span>
        </label>
        <label className="field">
          <span>Topic</span>
          <div className="field-row">
            <input value={push.topic} placeholder="make one →" onChange={(e) => update((c) => (c.push.topic = e.target.value.trim()))} spellCheck={false} />
            <button type="button" onClick={() => update((c) => (c.push.topic = newTopic()))}>
              {push.topic ? "New topic" : "Make one"}
            </button>
          </div>
        </label>
        <label className="field">
          <span>Server</span>
          <input value={push.server} onChange={(e) => update((c) => (c.push.server = e.target.value.trim()))} spellCheck={false} />
        </label>
        <label className="field check">
          <input type="checkbox" checked={push.detail} onChange={(e) => update((c) => (c.push.detail = e.target.checked))} />
          <span>Include the pane's name and message (off = a generic line)</span>
        </label>
        <button
          type="button"
          disabled={pushing || !push.topic}
          onClick={async () => {
            setPushing(true);
            const err = await pushTest(push.server, push.topic);
            setPushing(false);
            notify(err ? `Phone test failed: ${err}` : "Phone test sent.");
          }}
        >
          Send a test to my phone
        </button>
        <p className="hint">
          Install the free <strong>ntfy</strong> app on your phone, tap + and subscribe to the topic above on the same server. Alerts go through
          that server (ntfy.sh unless you host your own), and anyone who knows the topic name can read them, so keep it private.
        </p>
      </section>
    </>
  );
}
