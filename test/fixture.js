import * as React from "react";
import { createRoot } from "react-dom/client";
import { apply } from "../plugin.js";

const unsubscribers = [];
const phaseListeners = new Set();
const query = new URLSearchParams(location.search);
let phase = query.has("solo") ? "idle" : "connected";
let openedSockets = 0;
let panel;
let capture;
const endpoint = query.get("endpoint");
const NativeSocket = window.WebSocket;
// The plugin still validates wss. Loopback tests exercise the actual relay without installing a certificate.
window.WebSocket = class extends NativeSocket {
	constructor(url) {
		openedSockets++;
		if (url !== endpoint || new URL(url).hostname !== "127.0.0.1")
			throw new Error("Unexpected test endpoint");
		super(url.replace(/^wss:/, "ws:"));
	}
};
Object.defineProperty(MediaDevices.prototype, "getDisplayMedia", {
	value: async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 320;
		canvas.height = 180;
		const ctx = canvas.getContext("2d");
		let color = false;
		const draw = () => {
			color = !color;
			ctx.fillStyle = color ? "blue" : "red";
			ctx.fillRect(0, 0, 320, 180);
		};
		draw();
		const stream = canvas.captureStream(10);
		capture = stream.getVideoTracks()[0];
		const interval = setInterval(
			() => (capture.readyState === "live" ? draw() : clearInterval(interval)),
			100,
		);
		return stream;
	},
});
window.screenTest = {
	leave() {
		phase = "idle";
		for (const listener of phaseListeners) listener();
	},
	captureState: () => capture?.readyState,
	openedSockets: () => openedSockets,
};
apply({
	react: React,
	panels: {
		register(contribution) {
			panel = contribution;
		},
	},
	effect(setup) {
		unsubscribers.push(setup());
	},
	inject(keys, callback) {
		if (keys[0] !== "huddleStatus") throw new Error("Unexpected injection");
		callback({
			effect(setup) {
				unsubscribers.push(setup());
			},
			huddleStatus: {
				phase: () => phase,
				subscribe(listener) {
					phaseListeners.add(listener);
					return () => phaseListeners.delete(listener);
				},
			},
		});
	},
});
window.addEventListener(
	"pagehide",
	() => {
		for (const release of unsubscribers.reverse()) release();
	},
	{ once: true },
);
function Fixture() {
	const [open, setOpen] = React.useState(false);
	return React.createElement(
		React.Fragment,
		null,
		React.createElement(panel.channelLauncher, {
			pressed: open,
			available: () => true,
			toggle: (target) => {
				if (panel.matches(target)) setOpen(!open);
			},
		}),
		open && React.createElement(panel.component),
	);
}
createRoot(document.querySelector("#app")).render(React.createElement(Fixture));
