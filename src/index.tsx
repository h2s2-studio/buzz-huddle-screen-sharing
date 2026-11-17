import type * as ReactRuntime from "react";
import { makeSoloTest, presets, type Preset, type SoloState } from "./capture";
import { inviteFromParams, invitePage, nameLimit, parseInvite, type Invite } from "./protocol";
import { makeRoomSession } from "./room";

type HuddlePhase = "idle" | "incoming" | "connecting" | "connected" | "leaving" | "error";
type Effect = (setup: () => () => void) => void;
type LauncherProps = { pressed: boolean; toggle: (target: string) => void; available: () => boolean };
type Route = { version: number; params: unknown };
type PageProps = { navigation?: { target: { route?: Route } } };
type PluginContext = {
  react: typeof ReactRuntime;
  effect: Effect;
  inject: (
    keys: ["huddleStatus"],
    setup: (scope: { huddleStatus: { phase(): HuddlePhase; subscribe(listener: () => void): () => void }; effect: Effect }) => void,
  ) => void;
  panels: { register(panel: {
    id: string; title: string; matches(value: string): boolean;
    component: ReactRuntime.ComponentType;
    toolbar: ReactRuntime.ComponentType;
    channelLauncher: ReactRuntime.ComponentType<LauncherProps>;
    channelPlacement: "side";
  }): void };
  pages: { register(page: {
    id: string; title: string; conversationNavigation: boolean;
    route: { version: number; validate(params: unknown): boolean };
    component: ReactRuntime.ComponentType<PageProps>;
  }): void };
};

export const inject = ["react", "panels", "pages"];
const panelTarget = "h2s2-screen-sharing";
const brokerKey = "studio.h2s2.screen-sharing.room-service";
const nameKey = "studio.h2s2.screen-sharing.name";

const row: ReactRuntime.CSSProperties = {
  display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2, 8px)",
};
const spread: ReactRuntime.CSSProperties = { ...row, justifyContent: "space-between" };
const stack: ReactRuntime.CSSProperties = { display: "grid", gap: "var(--space-2, 8px)", minWidth: 0 };
const divider: ReactRuntime.CSSProperties = {
  borderBlockEnd: "1px solid var(--border-standard, #8885)", paddingBlockEnd: "var(--space-3, 12px)",
};
const quiet: ReactRuntime.CSSProperties = { color: "var(--text-muted, inherit)", margin: 0 };
const field: ReactRuntime.CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box" };
const ellipsis: ReactRuntime.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

function readSetting(key: string) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

function writeSetting(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage can be restricted. */ }
}

export function apply(ctx: PluginContext) {
  const React = ctx.react;
  const { useEffect, useRef, useState, useSyncExternalStore } = React;
  const session = makeRoomSession();
  let huddle: HuddlePhase = "idle";
  let solo: SoloState = { active: false };
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const notify = () => { for (const listener of listeners) listener(); };
  const soloTest = makeSoloTest((next) => {
    solo = next;
    notify();
  });

  function setHuddle(next: HuddlePhase) {
    if (huddle === next) return;
    huddle = next;
    if (next !== "connected" && session.snapshot().phase !== "idle") session.leave();
    notify();
  }

  ctx.inject(["huddleStatus"], (scope) => {
    const sync = () => setHuddle(scope.huddleStatus.phase());
    sync();
    const off = scope.huddleStatus.subscribe(sync);
    scope.effect(() => () => { off(); setHuddle("idle"); });
  });
  ctx.effect(() => () => { session.leave(); soloTest.stop(); });

  function ScreenVideo({ stream, fullscreen = false }: { stream: MediaStream; fullscreen?: boolean }) {
    const video = useRef<HTMLVideoElement>(null);
    const [height, setHeight] = useState(0);
    const [error, setError] = useState("");
    useEffect(() => {
      const element = video.current;
      if (!element) return;
      setHeight(0);
      setError("");
      element.srcObject = stream;
      return () => { element.srcObject = null; };
    }, [stream]);

    async function expand() {
      const element = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      if (!element) return;
      try {
        if (element.requestFullscreen) await element.requestFullscreen();
        else if (element.webkitEnterFullscreen) element.webkitEnterFullscreen();
        else throw new Error("Fullscreen unavailable");
      } catch {
        setError("Fullscreen isn’t available in this Buzz window.");
      }
    }
    function measure() {
      setHeight(video.current?.videoHeight ?? 0);
    }
    return <div style={stack}>
      <video
        aria-label="Shared screen"
        ref={video}
        autoPlay muted playsInline
        onResize={measure}
        onLoadedMetadata={measure}
        style={{ width: "100%", maxHeight: "65vh", background: "var(--surface-panel, #202024)", objectFit: "contain" }}
      />
      {fullscreen && <div style={spread}>
        <span style={quiet}>{height ? `Receiving ${height}p` : "Waiting for video…"}</span>
        <button type="button" onClick={() => void expand()}>Fullscreen</button>
      </div>}
      {error && <p role="alert" style={quiet}>{error}</p>}
    </div>;
  }

  function RoomEntry({ entry }: { entry?: Invite }) {
    const [mode, setMode] = useState<"join" | "create">("join");
    const [name, setName] = useState(() => readSetting(nameKey));
    const [broker, setBroker] = useState(() => readSetting(brokerKey));
    const [key, setKey] = useState("");
    const [invite, setInvite] = useState("");
    const [error, setError] = useState("");
    const parsed = entry ?? parseInvite(invite);

    function submit(event: ReactRuntime.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (huddle !== "connected") return;
      if (!name.trim()) return setError("Enter your display name.");
      setError("");
      if (mode === "create" && !entry) {
        writeSetting(brokerKey, broker.trim());
        void session.connect(broker, { type: "create", name: name.trim(), key });
        setKey("");
      } else {
        if (!parsed) return setError("Paste a Buzz Streams invite link.");
        void session.connect(parsed.broker, { type: "join", name: name.trim(), code: parsed.code });
      }
      writeSetting(nameKey, name.trim());
    }

    return <form style={stack} onSubmit={submit}>
      {!entry && <div style={row} aria-label="Sharing session">
        <button type="button" aria-pressed={mode === "join"} onClick={() => { setMode("join"); setError(""); }}>Join a session</button>
        <button type="button" aria-pressed={mode === "create"} onClick={() => { setMode("create"); setError(""); }}>Start a session</button>
      </div>}
      {entry && <p style={quiet}>Room service on {new URL(entry.broker).host}</p>}
      <label style={stack}>Display name
        <input style={field} value={name} onChange={(event) => setName(event.target.value)} maxLength={nameLimit} autoComplete="off" required />
      </label>
      {mode === "create" && !entry ? <>
        <label style={stack}>Room service URL
          <input style={field} value={broker} onChange={(event) => setBroker(event.target.value)} placeholder="wss://streams.example.org/rooms" maxLength={256} spellCheck={false} required />
        </label>
        <label style={stack}>Room creation key
          <input style={field} type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" maxLength={256} required />
        </label>
      </> : !entry && <label style={stack}>Invite link
        <input style={field} value={invite} onChange={(event) => setInvite(event.target.value)} spellCheck={false} autoComplete="off" required />
      </label>}
      <div style={row}><button type="submit">{mode === "create" && !entry ? "Create room" : "Join streams"}</button></div>
      {error && <p role="alert" style={quiet}>{error}</p>}
    </form>;
  }

  function Surface({ entry }: { entry?: Invite }) {
    const phase = useSyncExternalStore(subscribe, () => huddle);
    const local = useSyncExternalStore(subscribe, () => solo);
    const room = useSyncExternalStore(session.subscribe, session.snapshot);
    const [preset, setPreset] = useState<Preset>("balanced");
    const [copyStatus, setCopyStatus] = useState("");
    const ownsSolo = useRef(false);
    const inviteField = useRef<HTMLInputElement>(null);
    const invite = room.invite;
    useEffect(() => () => { if (ownsSolo.current) soloTest.stop(); }, []);
    useEffect(() => { setCopyStatus(""); }, [invite?.link]);

    async function copyInvite() {
      if (!invite || Date.now() >= invite.expiresAt) return;
      try {
        await navigator.clipboard.writeText(invite.link);
        setCopyStatus("Invite copied.");
      } catch {
        inviteField.current?.focus();
        inviteField.current?.select();
        setCopyStatus("Link selected. Use your copy shortcut.");
      }
    }

    const watching = room.streams.find((stream) => stream.id === room.watching);
    const expiredInvite = invite && Date.now() >= invite.expiresAt;
    return <section style={{ ...stack, padding: "var(--space-panel-inset, 12px)", gap: "var(--space-3, 12px)" }}>
      {room.phase === "idle" && !local.active && <>
        {phase === "connected"
          ? <RoomEntry key={entry?.code} entry={entry} />
          : <p style={quiet}>Join a Huddle to share or watch a screen.</p>}
        <div style={row}><button type="button" onClick={() => {
          ownsSolo.current = true;
          void soloTest.start();
        }}>Test my screen</button></div>
      </>}
      {local.active && <>
        <p role="status" style={quiet}>{local.video ? "Playing your screen back on this device." : "Choose a source or wait for local playback…"}</p>
        {local.video && <ScreenVideo stream={local.video} />}
        <div style={row}><button type="button" onClick={() => soloTest.stop()}>Stop test</button></div>
      </>}
      {room.phase === "connecting" && <div style={spread}>
        <p role="status" style={quiet}>Joining sharing session…</p>
        <button type="button" onClick={() => session.leave()}>Cancel</button>
      </div>}
      {(room.phase === "connected" || room.phase === "reconnecting") && <>
        <div style={{ ...stack, ...divider }}>
          <div style={spread}>
            <strong>{room.sharing ? "You’re sharing" : "Screen sharing"}</strong>
            {room.sharing && <button type="button" onClick={() => void session.stopSharing()}>Stop sharing</button>}
          </div>
          {room.sharing && <>
            <span style={ellipsis} title={room.sharing.label}>{room.sharing.label}</span>
            <small style={quiet}>{presets[room.sharing.preset].label}</small>
          </>}
          <div style={spread}>
            {!room.sharing && <label style={stack}>Share quality
              <select value={preset} onChange={(event) => setPreset(event.target.value as Preset)} disabled={room.picking}>
                {Object.entries(presets).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
            </label>}
            <button type="button" disabled={room.picking || room.stopping || room.phase !== "connected"} onClick={() => void session.share(preset)}>
              {room.sharing ? "Change source" : "Share screen"}
            </button>
          </div>
          {room.picking && <p role="status" style={quiet}>Choose a source in the system picker…</p>}
          {room.stopping && <p role="status" style={quiet}>Stopping the stream…</p>}
        </div>
        {room.phase === "reconnecting" && <p role="status" style={quiet}>Reconnecting to the sharing session…</p>}
        {watching && <div style={{ ...stack, ...divider }}>
          <div style={spread}>
            <strong style={ellipsis}>Watching {watching.presenter}</strong>
            <button type="button" onClick={() => session.changeWatch()}>Stop watching</button>
          </div>
          {room.video && !watching.muted && <ScreenVideo stream={room.video} fullscreen />}
          {watching.muted && <p role="status" style={quiet}>The presenter’s stream is paused.</p>}
          {!room.video && !watching.muted && <p role="status" style={quiet}>Loading stream…</p>}
          <label style={row}>Viewer quality
            <select value={room.quality} onChange={(event) => session.quality(event.target.value === "auto" ? "auto" : Number(event.target.value))}>
              <option value="auto">Auto</option>
              {room.layers.map(({ value, height }) => <option value={value} key={height}>{height}p</option>)}
            </select>
          </label>
        </div>}
        <div style={stack} aria-label="Live streams">
          {room.streams.length === 0 && <p style={quiet}>No one else is sharing yet.</p>}
          {room.streams.map((stream) => <div key={stream.id} style={spread}>
            <span style={ellipsis} title={stream.presenter}>{stream.presenter}</span>
            <button type="button" aria-label={`Watch ${stream.presenter}’s stream`}
              aria-pressed={room.watching === stream.id}
              disabled={room.phase !== "connected" || room.watching === stream.id}
              onClick={() => session.changeWatch(stream.id)}>
              {room.watching === stream.id ? "Watching" : "Watch stream"}
            </button>
          </div>)}
        </div>
        {invite && <div style={{ ...stack, ...divider }}>
          {expiredInvite ? <p style={quiet}>The invite has expired.</p> : <>
            <label style={stack}>Session invite
              <input style={field} ref={inviteField} value={invite.link} readOnly onFocus={(event) => event.target.select()} />
            </label>
            <div style={row}><button type="button" onClick={() => void copyInvite()}>Copy invite link</button></div>
          </>}
          {copyStatus && <p role="status" style={quiet}>{copyStatus}</p>}
        </div>}
        <div style={row}><button type="button" onClick={() => session.leave()}>Leave sharing session</button></div>
      </>}
      {(local.error || room.error) && <p role="alert" style={quiet}>{room.error || local.error}</p>}
    </section>;
  }

  function Launcher({ pressed, toggle, available }: LauncherProps) {
    return <button type="button" aria-pressed={pressed} onClick={() => { if (available()) toggle(panelTarget); }}>Streams</button>;
  }

  function Toolbar() {
    const room = useSyncExternalStore(session.subscribe, session.snapshot);
    const local = useSyncExternalStore(subscribe, () => solo);
    if (room.sharing) return <button type="button" onClick={() => void session.stopSharing()}>Stop sharing</button>;
    if (local.active) return <button type="button" onClick={() => soloTest.stop()}>Stop screen test</button>;
    return null;
  }

  ctx.panels.register({
    id: "screen-sharing", title: "Streams", matches: (value) => value === panelTarget,
    component: Surface, toolbar: Toolbar, channelLauncher: Launcher, channelPlacement: "side",
  });
  ctx.pages.register({
    id: invitePage, title: "Streams", conversationNavigation: true,
    route: { version: 1, validate: (params) => Boolean(inviteFromParams(params)) },
    component: ({ navigation }) => {
      const route = navigation?.target.route;
      return <Surface entry={route?.version === 1 ? inviteFromParams(route.params) : undefined} />;
    },
  });
}
