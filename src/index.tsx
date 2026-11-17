import type * as ReactRuntime from "react";
import { makeSoloTest, presets, type Preset, type SoloState } from "./capture";
import { communityBroker, inviteFromParams, invitePage, nameLimit, parseInvite, type Invite } from "./protocol";
import { makeRoomSession, type RoomSnapshot } from "./room";
import panelStyles from "./panel.css";

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

const icons = {
  monitor: "M3 5h18v12H3zM8 21h8m-4-4v4",
  source: "M3 5h18v14H3zM3 9h18m-7 6h4m-2-2v4",
  stop: "M6 6h12v12H6z",
  play: "m9 5 11 7-11 7z",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  eyeOff: "m3 3 18 18M10 6.2a12 12 0 0 1 2-.2c6.5 0 10 6 10 6a15 15 0 0 1-2.4 2.8M6.1 7.8A17 17 0 0 0 2 12s3.5 6 10 6a11 11 0 0 0 4-.8",
  link: "m10 13 4-4m-6 7-1 1a4 4 0 0 1-5.7-5.7l4-4A4 4 0 0 1 11 7m2 10a4 4 0 0 0 5.7 0l4-4A4 4 0 0 0 17 7.3l-1 1",
  leave: "M10 4H4v16h6m4-12 4 4-4 4m-6-4h13",
  chevron: "m6 9 6 6 6-6",
} as const;
type IconName = keyof typeof icons;

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

  function Icon({ name }: { name: IconName }) {
    return <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={icons[name]} />
    </svg>;
  }

  function Control({ label, icon, iconOnly, variant = "subtle", ...button }:
    ReactRuntime.ButtonHTMLAttributes<HTMLButtonElement> & {
      label: string;
      icon?: IconName;
      iconOnly?: boolean;
      variant?: "ghost" | "subtle" | "prominent" | "destructive";
    }) {
    return <button type="button" {...button} className="buzz-button" data-buzz-ui="" data-size="sm"
      data-variant={variant} data-disabled={button.disabled ? "" : undefined}
      data-icon-variant={iconOnly ? variant : undefined} data-icon-size={iconOnly ? "toolbar" : undefined}
      data-icon-shape={iconOnly ? "round" : undefined} aria-label={button["aria-label"] ?? (iconOnly ? label : undefined)}
      title={iconOnly ? label : undefined}>
      <span className="buzz-button-label">{icon && <Icon name={icon} />}{!iconOnly && label}</span>
    </button>;
  }

  function Stage({ title, detail, label = "Shared screen", stream, waiting, live, preview, controls, compact }: {
    title: string;
    detail?: ReactRuntime.ReactNode;
    label?: string;
    stream?: MediaStream;
    waiting?: string;
    live?: boolean;
    preview?: { hidden: boolean; toggle(): void };
    controls?: ReactRuntime.ReactNode;
    compact?: boolean;
  }) {
    const video = useRef<HTMLVideoElement>(null);
    const [height, setHeight] = useState(0);
    const [error, setError] = useState("");
    const visible = preview?.hidden ? undefined : stream;
    useEffect(() => {
      const element = video.current;
      setHeight(0);
      setError("");
      if (!element || !visible) return;
      element.srcObject = visible;
      return () => { element.srcObject = null; };
    }, [visible]);

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
    return <div className="h2s2-stage" data-compact={compact ? "" : undefined}>
      <header className="h2s2-stage-header">
        <div className="h2s2-stage-heading">
          <div className="h2s2-row">
            <h2 className="h2s2-truncate" title={title}>{title}</h2>
            {live && <span className="h2s2-live">Live</span>}
          </div>
          {(detail || visible) && <div className="h2s2-meta h2s2-truncate">
            {detail ?? (height ? `Receiving ${height}p` : "Waiting for video…")}
          </div>}
        </div>
        {(preview || visible) && <div className="h2s2-row h2s2-stage-actions">
          {preview && <Control variant="ghost" icon={preview.hidden ? "eye" : "eyeOff"} iconOnly
            label={preview.hidden ? "Show preview" : "Hide preview"} onClick={preview.toggle} />}
          {visible && <Control variant="ghost" icon="expand" iconOnly label="Fullscreen" onClick={() => void expand()} />}
        </div>}
      </header>
      {visible ? <div className="h2s2-viewport">
        <video aria-label={label} ref={video} autoPlay muted playsInline onResize={measure} onLoadedMetadata={measure} />
      </div> : <div className="h2s2-stage-message" data-preview-hidden={preview?.hidden ? "" : undefined}>
        <Icon name={preview?.hidden ? "eyeOff" : "monitor"} />
        <p role="status">{preview?.hidden ? "Preview hidden" : waiting}</p>
      </div>}
      {error && <p className="h2s2-notice" role="alert">{error}</p>}
      {controls && <div className="h2s2-dock">{controls}</div>}
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
    return <label className="h2s2-quality">Share quality
      <select value={preset} onChange={(event) => change(event.target.value as Preset)} disabled={disabled}>
        {Object.entries(presets).map(([value, item]) => <option key={value} value={value} title={item.label}>
          {item.video.height}p · 30 fps
        </option>)}
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

    return <form className="h2s2-form" onSubmit={submit}>
      {entry
        ? <p className="h2s2-meta">Sharing session on {new URL(entry.broker).host}</p>
        : <label className="h2s2-field">Invite link
          <input className="buzz-input" value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} autoComplete="off" required />
        </label>}
      <div className="h2s2-row"><Control type="submit" variant="prominent" icon="play" label="Join streams" /></div>
      {error && <p className="h2s2-notice" role="alert">{error}</p>}
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

    return <>
      <Stage title="Share your screen" compact waiting="Choose a window or screen in the system picker."
        controls={<>
          <ShareQuality preset={preset} change={setPreset} />
          {automatic && <Control variant="prominent" icon="monitor" label="Share screen" onClick={() => share(automatic)} />}
        </>} />
      <details className="h2s2-details">
        <summary><Icon name="link" />Join from an invite<Icon name="chevron" /></summary>
        <JoinInvite channel={channel} />
      </details>
      <details className="h2s2-details" open={automatic ? undefined : true}>
        <summary>Room service settings<Icon name="chevron" /></summary>
        <form className="h2s2-form" onSubmit={(event) => {
          event.preventDefault();
          writeSetting(brokerKey, broker.trim());
          share(broker, key || undefined);
          setKey("");
        }}>
          <label className="h2s2-field">Room service URL
            <input className="buzz-input" value={broker} onChange={(event) => setBroker(event.target.value)} placeholder="wss://streams.example.org/rooms" maxLength={256} spellCheck={false} required />
          </label>
          <label className="h2s2-field">Room creation key, if required by your server
            <input className="buzz-input" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" maxLength={256} />
          </label>
          <div className="h2s2-row"><Control type="submit" variant="prominent" icon="monitor" label="Share with this service" /></div>
        </form>
      </details>
    </>;
  }

  function LiveRoom({ room, preset, setPreset }: {
    room: RoomSnapshot; preset: Preset; setPreset(value: Preset): void;
  }) {
    const [previewHidden, setPreviewHidden] = useState(false);
    const watching = room.streams.find((stream) => stream.id === room.watching);
    const sharing = room.sharing;
    const isSharing = Boolean(sharing);
    useEffect(() => { if (!isSharing) setPreviewHidden(false); }, [isSharing]);

    const shareControls = <>
      {sharing ? <Control label="Change source" icon="source" onClick={() => void session.share(preset)}
        disabled={room.picking || room.phase !== "connected"} />
      : <>
        <ShareQuality preset={preset} change={setPreset} disabled={room.picking || room.stopping} />
        <Control label="Share screen" icon="monitor" variant="prominent" onClick={() => void session.share(preset)}
          disabled={room.picking || room.stopping || room.phase !== "connected"} />
      </>}
      {sharing && <Control label="Stop sharing" icon="stop" variant="destructive" onClick={() => void session.stopSharing()} />}
    </>;

    const localStage = sharing && <Stage title="Your preview" label="Your stream preview" live
      detail={<><span title={sharing.label}>{sharing.label}</span> · Up to {presets[sharing.preset].video.height}p / 30 fps</>}
      stream={sharing.preview} preview={{ hidden: previewHidden, toggle: () => setPreviewHidden(!previewHidden) }}
      controls={shareControls} compact={Boolean(watching)} />;

    return <>
      {room.phase === "reconnecting" && <p className="h2s2-notice" role="status">Reconnecting to the sharing session…</p>}
      {room.picking && <p className="h2s2-notice" role="status">Choose a source in the system picker…</p>}
      {room.stopping && <p className="h2s2-notice" role="status">Stopping the stream…</p>}
      <div className="h2s2-workspace" data-with-rail={room.streams.length > 0 ? "" : undefined}>
        {watching ? <Stage key={watching.id} title={`Watching ${watching.presenter}`} live={!watching.muted}
          stream={watching.muted ? undefined : room.video}
          waiting={watching.muted ? "The presenter paused their stream." : "Loading stream…"}
          controls={<>
            <label className="h2s2-quality">Viewer quality
              <select value={room.quality} onChange={(event) => session.quality(event.target.value === "auto" ? "auto" : Number(event.target.value))}>
                <option value="auto">Auto</option>
                {room.layers.map(({ value, height }) => <option value={value} key={height}>{height}p</option>)}
              </select>
            </label>
            <Control label="Stop watching" icon="stop" onClick={() => session.changeWatch()} />
          </>} />
        : localStage ?? <Stage title={room.streams.length ? "Pick a stream" : "Ready to share"} compact
          waiting={room.streams.length ? "Select Watch stream to start viewing." : "No one is sharing yet."} controls={shareControls} />}

        {room.streams.length > 0 && <aside className="h2s2-rail" aria-label="Live streams">
          <div className="h2s2-streams">
            <h3>Live streams</h3>
            <ul>
              {room.streams.map((stream) => {
                const selected = room.watching === stream.id;
                return <li key={stream.id} data-watching={selected ? "" : undefined}>
                  <span className="h2s2-stream-icon"><Icon name="monitor" /></span>
                  <div className="h2s2-stream-name">
                    <strong className="h2s2-truncate" title={stream.presenter}>{stream.presenter}</strong>
                    {stream.muted && <small className="h2s2-meta">Paused</small>}
                  </div>
                  <Control label={selected ? "Watching" : "Watch stream"} variant={selected ? "ghost" : "subtle"}
                    aria-label={`Watch ${stream.presenter}’s stream`} aria-pressed={selected}
                    disabled={!selected && room.phase !== "connected"} onClick={() => session.changeWatch(selected ? undefined : stream.id)} />
                </li>;
              })}
            </ul>
          </div>
          {watching && (localStage ?? <div className="h2s2-share-alongside h2s2-row">{shareControls}</div>)}
        </aside>}
      </div>
    </>;
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

    const expiredInvite = invite && Date.now() >= invite.expiresAt;
    return <section className="h2s2-stream-panel" aria-label="Streams" data-buzz-ui="">
      <style>{panelStyles}</style>
      {(local.error || room.error) && <p className="h2s2-notice" role="alert">{room.error || local.error}</p>}
      {room.phase === "idle" && !local.active && <>
        {phase === "connected"
          ? entry
            ? <JoinInvite key={entry.code} entry={entry} channel={channel} />
            : <RoomEntry channel={channel} preset={preset} setPreset={setPreset} />
          : <Stage title="Screen sharing" compact waiting="Join a Huddle to share or watch a screen." />}
        <div className="h2s2-row"><Control label="Test my screen" variant="ghost" icon="monitor" onClick={() => {
          ownsSolo.current = true;
          void soloTest.start();
        }} /></div>
      </>}
      {local.active && <Stage title="Screen test" stream={local.video}
        detail={local.video && "Playing back on this device"} waiting="Choose a source or wait for local playback…"
        controls={<Control label="Stop test" icon="stop" variant="destructive" onClick={() => soloTest.stop()} />} />}
      {room.phase === "connecting" && <Stage title="Connecting streams" compact
        waiting={room.picking ? "Choose a source in the system picker…" : "Connecting to the sharing session…"}
        controls={<Control label="Cancel" onClick={() => session.leave()} />} />}
      {(room.phase === "connected" || room.phase === "reconnecting") && <>
        <LiveRoom room={room} preset={preset} setPreset={setPreset} />
        <footer className="h2s2-session">
          <div className="h2s2-row h2s2-session-actions">
            {invite && !expiredInvite && <Control label="Copy invite link" icon="link" variant="ghost" onClick={() => void copyInvite()} />}
            <Control label="Leave Streams" icon="leave" variant="ghost" aria-description="Your voice Huddle stays connected." onClick={() => session.leave()} />
          </div>
          {expiredInvite && <p className="h2s2-meta">The invite has expired.</p>}
          {invite && !expiredInvite && copyStatus === "copied" && <p className="h2s2-meta" role="status">Invite copied.</p>}
          {invite && !expiredInvite && copyStatus === "manual" && <label className="h2s2-field">Session invite
            <input className="buzz-input" ref={inviteField} value={invite.link} readOnly onFocus={(event) => event.target.select()} />
            <span className="h2s2-meta">Use your copy shortcut.</span>
          </label>}
        </footer>
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
    if (room.sharing) return <Control label="Stop sharing" variant="destructive" icon="stop" onClick={() => void session.stopSharing()} />;
    if (local.active) return <Control label="Stop screen test" onClick={() => soloTest.stop()} />;
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
