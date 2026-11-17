import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const codePattern = /^[A-Za-z0-9_-]{22}$/;
const maxSockets = 128;
const validVideo = (sdp) => {
	if (typeof sdp !== "string" || sdp.length > 16000) return false;
	const media = sdp.match(/^m=.+$/gm);
	return media?.length === 1 && media[0].startsWith("m=video ");
};

export function createSignaling({
	iceServers = [],
	invitationMs = 5 * 60_000,
} = {}) {
	const rooms = new Map();
	const sockets = new WebSocketServer({
		noServer: true,
		maxPayload: 24 * 1024,
		perMessageDeflate: false,
		maxPendingAutoPongs: 4,
	});
	const server = createServer((req, res) => {
		res.writeHead(req.method === "GET" && req.url === "/health" ? 200 : 404, {
			"Content-Type": "text/plain",
		});
		res.end();
	});
	server.on("upgrade", (request, socket, head) => {
		if (request.url !== "/signal" || sockets.clients.size >= maxSockets) {
			socket.destroy();
			return;
		}
		sockets.handleUpgrade(request, socket, head, (client) =>
			sockets.emit("connection", client),
		);
	});

	const send = (socket, value) => {
		if (socket?.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify(value));
	};
	const end = (room) => {
		clearTimeout(room.expiry);
		rooms.delete(room.code);
		room.presenter.close(1000, "Share ended");
		room.viewer?.close(1000, "Share ended");
	};

	sockets.on("connection", (socket) => {
		let room;
		let presenter = false;
		let alive = true;
		let messageCount = 0;
		const handshake = setTimeout(
			() => socket.close(1008, "Share code required"),
			6000,
		);
		socket.on("pong", () => {
			alive = true;
		});
		const heartbeat = setInterval(() => {
			if (!alive) socket.terminate();
			else {
				alive = false;
				socket.ping();
			}
			messageCount = 0;
		}, 15_000);
		socket.on("error", () => socket.terminate());
		socket.on("close", () => {
			clearTimeout(handshake);
			clearInterval(heartbeat);
			if (room && rooms.get(room.code) === room) end(room);
		});
		socket.on("message", (raw, binary) => {
			if (binary || ++messageCount > 16)
				return socket.close(1008, "Signal limit exceeded");
			let message;
			try {
				message = JSON.parse(raw.toString());
			} catch {
				/* Reject below. */
			}
			if (!message || typeof message !== "object")
				return socket.close(1008, "Invalid signal");

			if (!room) {
				const { code, type } = message;
				if (typeof code !== "string" || !codePattern.test(code))
					return socket.close(1008, "Invalid share code");
				if (type === "present" && !rooms.has(code)) {
					room = { code, presenter: socket, stage: "waiting" };
					room.expiry = setTimeout(() => end(room), invitationMs);
					rooms.set(code, room);
					presenter = true;
					clearTimeout(handshake);
					send(socket, { type: "waiting" });
					return;
				}
				const openRoom = rooms.get(code);
				if (type !== "watch" || !openRoom || openRoom.stage !== "waiting") {
					return socket.close(1008, "Share code unavailable");
				}
				room = openRoom;
				clearTimeout(handshake);
				clearTimeout(room.expiry);
				room.stage = "offer";
				room.viewer = socket;
				room.expiry = setTimeout(() => end(room), 2 * 60 * 60_000);
				send(room.viewer, { type: "paired", iceServers });
				send(room.presenter, { type: "paired", iceServers });
				return;
			}

			if (!validVideo(message.sdp))
				return socket.close(1008, "Only screen video is supported");
			if (presenter && room.stage === "offer" && message.type === "offer") {
				room.stage = "answer";
				send(room.viewer, { type: "offer", sdp: message.sdp });
			} else if (
				!presenter &&
				room.stage === "answer" &&
				message.type === "answer"
			) {
				room.stage = "connected";
				send(room.presenter, { type: "answer", sdp: message.sdp });
			} else socket.close(1008, "Unexpected signal");
		});
	});
	return { server, sockets };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const iceServers = JSON.parse(process.env.ICE_SERVERS ?? "[]");
	if (!Array.isArray(iceServers))
		throw new Error("ICE_SERVERS must be a JSON array");
	const { server } = createSignaling({ iceServers });
	server.listen(
		Number(process.env.PORT ?? 8090),
		process.env.HOST ?? "127.0.0.1",
		() => {
			console.log(
				`Huddle signaling listening on ${JSON.stringify(server.address())}`,
			);
		},
	);
}
