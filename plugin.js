export const inject = ["react", "panels"];
const target = "h2s2-screen-sharing";
const endpointKey = "studio.h2s2.screen-sharing.endpoint";
const codePattern = /^[A-Za-z0-9_-]{22}$/;
const idle = { phase: "idle" };

function endpointUrl(value) {
	try {
		const url = new URL(value.trim());
		if (
			url.protocol === "wss:" &&
			!url.username &&
			!url.password &&
			url.pathname === "/signal" &&
			!url.search &&
			!url.hash
		)
			return url.href;
	} catch {
		/* Invalid URL. */
	}
	throw new Error("Enter a secure signaling URL ending in /signal.");
}

function shareCode() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function videoDescription(sdp) {
	if (typeof sdp !== "string" || sdp.length > 16000) return false;
	const media = sdp.match(/^m=.+$/gm);
	return media?.length === 1 && media[0].startsWith("m=video ");
}

function gather(connection, signal) {
	return new Promise((resolve, reject) => {
		const settle = (error) => {
			clearTimeout(timer);
			connection.removeEventListener("icegatheringstatechange", check);
			signal.removeEventListener("abort", abort);
			const sdp = connection.localDescription?.sdp;
			if (error || !videoDescription(sdp))
				reject(new Error("Couldn’t negotiate screen video."));
			else resolve(sdp);
		};
		const check = () => {
			if (connection.iceGatheringState === "complete") settle(false);
		};
		const abort = () => settle(true);
		const timer = setTimeout(abort, 8000);
		connection.addEventListener("icegatheringstatechange", check);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		else check();
	});
}

// Owned by the plugin activation. Both the call phase and the mounted panel can end it.
function makeSession() {
	const listeners = new Set();
	let connected = false;
	let active;
	let screen = idle;
	let snapshot = { connected, screen };
	const emit = (next) => {
		screen = next;
		snapshot = { connected, screen };
		for (const listener of listeners) listener();
	};
	const stop = (error) => {
		const previous = active;
		active = undefined;
		if (previous) {
			previous.abort.abort();
			clearTimeout(previous.timeout);
			previous.peer?.close();
			previous.testReceiver?.close();
			previous.socket?.close();
			for (const track of previous.stream?.getTracks() ?? []) track.stop();
		}
		emit(error ? { phase: "idle", error } : idle);
	};
	async function playLocally(run) {
		emit({ phase: "starting-test" });
		// Both peers and all SDP stay in this Buzz window.
		const sender = new RTCPeerConnection({ iceServers: [] });
		run.peer = sender;
		const receiver = new RTCPeerConnection({ iceServers: [] });
		run.testReceiver = receiver;
		run.timeout = setTimeout(() => {
			if (active === run) stop("Local video playback didn’t start.");
		}, 20000);
		const show = () => {
			if (active !== run) return;
			const state = receiver.connectionState;
			if (state === "failed" || state === "disconnected") {
				stop("Local video playback stopped.");
			} else if (state === "connected" && run.remote) {
				clearTimeout(run.timeout);
				emit({ phase: "testing", remote: run.remote });
			}
		};
		receiver.onconnectionstatechange = show;
		receiver.ontrack = ({ track }) => {
			if (active !== run || track.kind !== "video") return;
			run.remote = new MediaStream([track]);
			show();
		};
		sender.addTransceiver(run.stream.getVideoTracks()[0], {
			direction: "sendonly",
		});
		await sender.setLocalDescription(await sender.createOffer());
		await receiver.setRemoteDescription({
			type: "offer",
			sdp: await gather(sender, run.abort.signal),
		});
		await receiver.setLocalDescription(await receiver.createAnswer());
		await sender.setRemoteDescription({
			type: "answer",
			sdp: await gather(receiver, run.abort.signal),
		});
	}

	async function accept(run, message) {
		if (active !== run) return;
		if (message.type === "waiting" && run.role === "present" && !run.peer) {
			clearTimeout(run.timeout);
			emit({ phase: "waiting", code: run.code });
			return;
		}
		if (
			message.type === "paired" &&
			!run.peer &&
			Array.isArray(message.iceServers)
		) {
			emit({ phase: "connecting" });
			clearTimeout(run.timeout);
			run.timeout = setTimeout(
				() =>
					active === run && stop("Couldn’t make a direct video connection."),
				20000,
			);
			const peer = new RTCPeerConnection({ iceServers: message.iceServers });
			run.peer = peer;
			peer.onconnectionstatechange = () => {
				if (active !== run) return;
				if (peer.connectionState === "connected") {
					clearTimeout(run.timeout);
					emit({
						phase: run.role === "present" ? "sharing" : "watching",
						remote: run.remote,
					});
				} else if (
					peer.connectionState === "failed" ||
					peer.connectionState === "disconnected"
				) {
					stop("The video connection ended.");
				}
			};
			if (run.role === "watch") {
				peer.ontrack = ({ track }) => {
					if (active !== run || track.kind !== "video") return;
					run.remote = new MediaStream([track]);
					if (peer.connectionState === "connected")
						emit({ phase: "watching", remote: run.remote });
				};
			} else {
				peer.addTransceiver(run.stream.getVideoTracks()[0], {
					direction: "sendonly",
				});
				await peer.setLocalDescription(await peer.createOffer());
				const sdp = await gather(peer, run.abort.signal);
				if (active === run)
					run.socket.send(JSON.stringify({ type: "offer", sdp }));
			}
		} else if (videoDescription(message.sdp) && run.peer) {
			const peer = run.peer;
			if (run.role === "watch" && message.type === "offer") {
				await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
				await peer.setLocalDescription(await peer.createAnswer());
				const sdp = await gather(peer, run.abort.signal);
				if (active === run)
					run.socket.send(JSON.stringify({ type: "answer", sdp }));
			} else if (run.role === "present" && message.type === "answer") {
				await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
			}
		}
	}

	return {
		snapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		huddle(phase) {
			const next = phase === "connected";
			if (next === connected) return;
			connected = next;
			if (!next && active?.role !== "test") stop();
			else emit(screen);
		},
		stop,
		async start(role, endpoint = "", input = "") {
			const testing = role === "test";
			if (active || (!testing && !connected)) return;
			if (typeof RTCPeerConnection !== "function") {
				stop("This Buzz installation can’t open a WebRTC connection.");
				return;
			}
			let url;
			let code;
			if (!testing) {
				try {
					url = endpointUrl(endpoint);
				} catch (error) {
					stop(error.message);
					return;
				}
				code = role === "present" ? shareCode() : input.trim();
				if (!codePattern.test(code)) {
					stop("Enter the share code from the presenter.");
					return;
				}
			}
			const run = { role, code, abort: new AbortController() };
			active = run;
			try {
				if (role !== "watch") {
					if (!navigator.mediaDevices?.getDisplayMedia) {
						stop("Screen capture isn’t available in this Buzz installation.");
						return;
					}
					emit({ phase: "picking" });
					const stream = await navigator.mediaDevices.getDisplayMedia({
						video: { width: { ideal: 1280 }, frameRate: { ideal: 15 } },
						audio: false,
					});
					const track = stream.getVideoTracks()[0];
					if (active !== run || !track || track.readyState !== "live") {
						for (const captured of stream.getTracks()) captured.stop();
						if (active === run) stop("The selected source is unavailable.");
						return;
					}
					run.stream = stream;
					track.addEventListener(
						"ended",
						() => {
							if (active === run) stop();
						},
						{ once: true },
					);
				}
				if (testing) {
					await playLocally(run);
					return;
				}
				emit({ phase: "connecting" });
				const socket = new WebSocket(url);
				run.socket = socket;
				run.timeout = setTimeout(
					() => active === run && stop("The signaling service didn’t respond."),
					10000,
				);
				socket.onopen = () => {
					if (active === run) socket.send(JSON.stringify({ type: role, code }));
				};
				socket.onclose = ({ code: closeCode }) => {
					if (active === run)
						stop(
							closeCode === 1000
								? undefined
								: role === "watch" && closeCode === 1008
									? "That share code is unavailable or expired."
									: "The signaling connection ended.",
						);
				};
				socket.onmessage = (event) => {
					if (typeof event.data !== "string" || event.data.length > 24000)
						return;
					Promise.resolve()
						.then(() => accept(run, JSON.parse(event.data)))
						.catch(() => {
							if (active === run) stop("Couldn’t connect the screen share.");
						});
				};
				try {
					localStorage.setItem(endpointKey, url);
				} catch {
					/* Storage is optional. */
				}
			} catch {
				if (active === run)
					stop(
						role !== "watch" && !run.stream
							? "No screen was selected. Check screen recording permissions if the picker didn’t open."
							: testing
								? "Couldn’t start local video playback."
								: "Couldn’t open the signaling connection.",
					);
			}
		},
	};
}

export function apply(ctx) {
	const {
		createElement: h,
		useEffect,
		useRef,
		useState,
		useSyncExternalStore,
	} = ctx.react;
	const session = makeSession();
	ctx.inject(["huddleStatus"], (scope) => {
		const sync = () => session.huddle(scope.huddleStatus.phase());
		sync();
		const unsubscribe = scope.huddleStatus.subscribe(sync);
		scope.effect(() => () => {
			unsubscribe();
			session.huddle("idle");
		});
	});
	ctx.effect(() => () => session.stop());
	const useScreenState = () =>
		useSyncExternalStore(session.subscribe, session.snapshot);
	const button = (label, onClick, props = {}) =>
		h("button", { ...props, type: "button", onClick }, label);
	const row = {
		display: "flex",
		gap: "var(--space-2)",
		flexWrap: "wrap",
		alignItems: "center",
	};
	const column = { display: "grid", gap: "var(--space-2)" };
	const field = (label, value, set, placeholder) =>
		h(
			"label",
			{ style: column },
			label,
			h("input", {
				value,
				onChange: (event) => set(event.target.value),
				placeholder,
				spellCheck: false,
				style: { width: "100%", minWidth: 0 },
			}),
		);

	function ScreenView({ stream }) {
		const video = useRef(null);
		useEffect(() => {
			if (!video.current) return;
			const element = video.current;
			element.srcObject = stream;
			return () => {
				element.srcObject = null;
			};
		}, [stream]);
		return h("video", {
			ref: video,
			autoPlay: true,
			muted: true,
			playsInline: true,
			"aria-label": "Shared screen",
			style: { width: "100%", maxHeight: "65vh", objectFit: "contain" },
		});
	}

	function Panel() {
		const { connected, screen } = useScreenState();
		const [endpoint, setEndpoint] = useState(() => {
			try {
				return localStorage.getItem(endpointKey) ?? "";
			} catch {
				return "";
			}
		});
		const [code, setCode] = useState("");
		const [copy, setCopy] = useState("");
		useEffect(() => () => session.stop(), []);
		const phase = screen.phase;
		const status = {
			picking: "Choose what to share…",
			connecting: "Connecting…",
			"starting-test": "Starting local video playback…",
			testing: "Playing your screen back on this device.",
			waiting: "Waiting for someone to enter the share code.",
			sharing: "You’re sharing your screen.",
			watching: "Watching shared screen.",
		}[phase];
		return h(
			"div",
			{ style: { ...column, padding: "var(--space-panel-inset)" } },
			phase === "idle" &&
				button("Test my screen", () => void session.start("test")),
			phase === "idle" &&
				!connected &&
				h("p", null, "Join a Huddle to share or watch a screen."),
			phase === "idle" && connected
				? h(
						ctx.react.Fragment,
						null,
						field(
							"Signaling URL",
							endpoint,
							setEndpoint,
							"wss://screens.example.org/signal",
						),
						button("Share screen", () => {
							setCopy("");
							void session.start("present", endpoint, "");
						}),
						field("Share code", code, setCode, "Code from the presenter"),
						button("Watch screen", () => {
							void session.start("watch", endpoint, code);
						}),
					)
				: null,
			status && h("p", { role: "status" }, status),
			screen.error && h("p", { role: "alert" }, screen.error),
			screen.code &&
				h(
					"div",
					{ style: row },
					h("input", {
						"aria-label": "Your share code",
						readOnly: true,
						value: screen.code,
						onFocus: (event) => event.target.select(),
					}),
					button(copy || "Copy share code", () => {
						navigator.clipboard?.writeText(screen.code).then(
							() => setCopy("Copied"),
							() => setCopy("Select the code to copy it"),
						);
					}),
				),
			screen.remote && h(ScreenView, { stream: screen.remote }),
			phase !== "idle" &&
				button(
					phase === "sharing" || phase === "waiting"
						? "Stop sharing"
						: phase === "testing" || phase === "starting-test"
							? "Stop test"
							: "Close screen share",
					() => session.stop(),
				),
		);
	}

	function Launcher({ pressed, toggle, available }) {
		return button(
			"Screen sharing",
			() => {
				if (available()) toggle(target);
			},
			{ "aria-pressed": pressed },
		);
	}

	ctx.panels.register({
		id: "screen-sharing",
		title: "Screen sharing",
		matches: (value) => value === target,
		component: Panel,
		channelLauncher: Launcher,
		channelPlacement: "side",
	});
}
