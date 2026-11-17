import type * as ReactRuntime from "react";
import { makeSoloTest, presets, type Preset, type SoloState } from "./capture";
import { communityBroker, inviteFromParams, invitePage, nameLimit, parseInvite, type Invite } from "./protocol";
import { makeRoomSession } from "./room";

type HuddlePhase = "idle" | "incoming" | "connecting" | "connected" | "leaving" | "error";
type Effect = (setup: () => () => void) => void;
type LauncherProps = { pressed: boolean; toggle: (target: string) => void; available: () => boolean };
type ChannelContext = { relayUrl: string; viewer: string; scope: string };
type Route = { version: number; params: unknown };
type PageProps = { navigation?: { target: { route?: Route } } };
type PluginContext = {
  react: typeof ReactRuntime;
  relay: { snapshot(): {
    origin?: string;
    viewer?: string;
    scope?: string;
    session: { profiles: { snapshot(): ReadonlyMap<string, { name?: string }> } };
  } };
  effect: Effect;
  inject: (
    keys: ["huddleStatus"],
    setup: (scope: { huddleStatus: { phase(): HuddlePhase; subscribe(listener: () => void): () => void }; effect: Effect }) => void,
  ) => void;
  panels: { register(panel: {
    id: string; title: string; matches(value: string): boolean;
    component: ReactRuntime.ComponentType<{ channelContext?: ChannelContext }>;
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

export const inject = ["react", "panels", "pages", "relay"];
const panelTarget = "h2s2-screen-sharing";
const brokerKey = "studio.h2s2.screen-sharing.room-service";

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

  function ScreenVideo({
    stream, fullscreen = false, label = "Shared screen", maxHeight = "65vh",
  }: {
    stream: MediaStream;
    fullscreen?: boolean;
    label?: string;
    maxHeight?: string;
  }) {
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
        aria-label={label}
        ref={video}
        autoPlay muted playsInline
        onResize={measure}
        onLoadedMetadata={measure}
        style={{ width: "100%", maxHeight, background: "var(--surface-panel, #202024)", objectFit: "contain" }}
      />
      {fullscreen && <div style={spread}>
        <span style={quiet}>{height ? `Receiving ${height}p` : "Waiting for video…"}</span>
        <button type="button" onClick={() => void expand()}>Fullscreen</button>
      </div>}
      {error && <p role="alert" style={quiet}>{error}</p>}
    </div>;
  }

  function participantName(channel?: ChannelContext) {
    const current = ctx.relay.snapshot();
    const viewer = channel?.viewer ?? current.viewer;
    const profile = viewer ? current.session.profiles.snapshot().get(viewer) : undefined;
    const name = Array.from(profile?.name?.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim() ?? "")
      .slice(0, nameLimit).join("");
    return name || (viewer ? `Participant ${viewer.slice(0, 6)}` : "Participant");
  }

  function ShareQuality({ preset, change, disabled }: {
    preset: Preset; change(value: Preset): void; disabled?: boolean;
  }) {
    return <label style={stack}>Share quality
      <select value={preset} onChange={(event) => change(event.target.value as Preset)} disabled={disabled}>
        {Object.entries(presets).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
      </select>
    </label>;
  }

  function JoinInvite({ entry, channel }: { entry?: Invite; channel?: ChannelContext }) {
    const [input, setInput] = useState("");
    const [error, setError] = useState("");

    function submit(event: ReactRuntime.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (huddle !== "connected") return;
      const invite = entry ?? parseInvite(input);
      if (!invite) return setError("Paste a Buzz Streams invite link.");
      setError("");
      void session.connect(invite.broker, { type: "join", name: participantName(channel), code: invite.code });
    }

    return <form style={stack} onSubmit={submit}>
      {entry
        ? <p style={quiet}>Sharing session on {new URL(entry.broker).host}</p>
        : <label style={stack}>Invite link
          <input style={field} value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} autoComplete="off" required />
        </label>}
      <div style={row}><button type="submit">Join streams</button></div>
      {error && <p role="alert" style={quiet}>{error}</p>}
    </form>;
  }

  function RoomEntry({ channel, preset, setPreset }: {
    channel?: ChannelContext; preset: Preset; setPreset(value: Preset): void;
  }) {
    const automatic = communityBroker(channel?.relayUrl ?? ctx.relay.snapshot().origin);
    const [broker, setBroker] = useState(() => readSetting(brokerKey) || automatic || "");
    const [key, setKey] = useState("");

    function share(url: string, key?: string) {
      if (huddle !== "connected") return;
      void session.connect(url, { type: "create", name: participantName(channel), key }, preset);
    }

    return <div style={stack}>
      {automatic && <div style={row}>
        <button type="button" onClick={() => share(automatic)}>Share screen</button>
      </div>}
      <ShareQuality preset={preset} change={setPreset} />
      <details>
        <summary>Join from an invite</summary>
        <JoinInvite channel={channel} />
      </details>
      <details open={automatic ? undefined : true}>
        <summary>Room service settings</summary>
        <form style={stack} onSubmit={(event) => {
          event.preventDefault();
          writeSetting(brokerKey, broker.trim());
          share(broker, key || undefined);
          setKey("");
        }}>
          <label style={stack}>Room service URL
            <input style={field} value={broker} onChange={(event) => setBroker(event.target.value)} placeholder="wss://streams.example.org/rooms" maxLength={256} spellCheck={false} required />
          </label>
          <label style={stack}>Room creation key, if required by your server
            <input style={field} type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" maxLength={256} />
          </label>
          <div style={row}><button type="submit">Share with this service</button></div>
        </form>
      </details>
    </div>;
  }

  function Surface({ entry, channel }: { entry?: Invite; channel?: ChannelContext }) {
    const phase = useSyncExternalStore(subscribe, () => huddle);
    const local = useSyncExternalStore(subscribe, () => solo);
    const room = useSyncExternalStore(session.subscribe, session.snapshot);
    const [preset, setPreset] = useState<Preset>("balanced");
    const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");
    const ownsSolo = useRef(false);
    const inviteField = useRef<HTMLInputElement>(null);
    const invite = room.invite;
    useEffect(() => () => { if (ownsSolo.current) soloTest.stop(); }, []);
    useEffect(() => { setCopyStatus("idle"); }, [invite?.link]);
    useEffect(() => {
      if (copyStatus === "manual") {
        inviteField.current?.focus();
        inviteField.current?.select();
      }
    }, [copyStatus]);

    async function copyInvite() {
      if (!invite || Date.now() >= invite.expiresAt) return;
      try {
        await navigator.clipboard.writeText(invite.link);
        setCopyStatus("copied");
      } catch {
        setCopyStatus("manual");
      }
    }

    const watching = room.streams.find((stream) => stream.id === room.watching);
    const expiredInvite = invite && Date.now() >= invite.expiresAt;
    return <section style={{ ...stack, padding: "var(--space-panel-inset, 12px)", gap: "var(--space-3, 12px)" }}>
      {(local.error || room.error) && <p role="alert" style={quiet}>{room.error || local.error}</p>}
      {room.phase === "idle" && !local.active && <>
        {phase === "connected"
          ? entry
            ? <JoinInvite key={entry.code} entry={entry} channel={channel} />
            : <RoomEntry channel={channel} preset={preset} setPreset={setPreset} />
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
        <p role="status" style={quiet}>{room.picking ? "Choose a source in the system picker…" : "Connecting streams…"}</p>
        <button type="button" onClick={() => session.leave()}>Cancel</button>
      </div>}
      {(room.phase === "connected" || room.phase === "reconnecting") && <>
        <div style={{ ...stack, ...divider }}>
          {room.sharing && <>
            <div style={spread}>
              <strong>You’re sharing</strong>
              <button type="button" onClick={() => void session.stopSharing()}>Stop sharing</button>
            </div>
            <span style={ellipsis} title={room.sharing.label}>{room.sharing.label}</span>
            <small style={quiet}>{presets[room.sharing.preset].label}</small>
          </>}
          <div style={row}>
            {!room.sharing && <ShareQuality preset={preset} change={setPreset} disabled={room.picking} />}
            <button type="button" disabled={room.picking || room.stopping || room.phase !== "connected"} onClick={() => void session.share(preset)}>
              {room.sharing ? "Change source" : "Share screen"}
            </button>
            {invite && !expiredInvite && <button type="button" onClick={() => void copyInvite()}>Copy invite link</button>}
          </div>
          {expiredInvite && <p style={quiet}>The invite has expired.</p>}
          {invite && !expiredInvite && copyStatus === "copied" && <p role="status" style={quiet}>Invite copied.</p>}
          {invite && !expiredInvite && copyStatus === "manual" && <label style={stack}>Session invite
            <input style={field} ref={inviteField} value={invite.link} readOnly onFocus={(event) => event.target.select()} />
            <span style={quiet}>Use your copy shortcut.</span>
          </label>}
          {room.picking && <p role="status" style={quiet}>Choose a source in the system picker…</p>}
          {room.stopping && <p role="status" style={quiet}>Stopping the stream…</p>}
          {room.sharing && <details open>
            <summary>Your preview</summary>
            <ScreenVideo
              stream={room.sharing.preview}
              label="Your stream preview"
              maxHeight={watching ? "min(18vh, 100px)" : "min(28vh, 180px)"}
            />
          </details>}
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
        <div style={row}><button type="button" aria-description="Your voice Huddle stays connected." onClick={() => session.leave()}>Leave Streams</button></div>
      </>}
    </section>;
  }

  function Launcher({ pressed, toggle, available }: LauncherProps) {
    const room = useSyncExternalStore(session.subscribe, session.snapshot);
    const live = Boolean(room.sharing);
    return <button
      type="button"
      className="buzz-button"
      data-buzz-ui=""
      data-variant="ghost"
      data-size="sm"
      data-icon-variant="ghost"
      data-icon-size="toolbar"
      data-icon-shape="control"
      aria-label="Streams"
      aria-description={live ? "You’re sharing your screen." : undefined}
      aria-pressed={pressed}
      title={live ? "Streams — you’re sharing" : "Streams"}
      onClick={() => { if (available()) toggle(panelTarget); }}
    >
      <span className="buzz-button-label">
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="4" width="19" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
          {live && <circle cx="19.5" cy="5" r="3.5" fill="var(--status-online, #2a8b57)" stroke="var(--surface-panel, Canvas)" />}
        </svg>
      </span>
    </button>;
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
    component: ({ channelContext }) => <Surface channel={channelContext} />, toolbar: Toolbar, channelLauncher: Launcher, channelPlacement: "side",
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
