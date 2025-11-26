const PORT = process.env.PORT || 8001;

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Socket.IO 4.x configuration with optimizations for low bandwidth
const io = new Server(server, {
  // Reduce ping interval for faster disconnect detection
  pingInterval: 10000,
  pingTimeout: 5000,
  // Enable compression for signaling data
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3,
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024,
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
  },
  // Use websocket first for lower latency
  transports: ["websocket", "polling"],
  // Allow reconnection
  allowEIO3: false,
});

server.listen(PORT, () => {
  console.log(`Voice & Text Chat Server listening on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

// Serve static files
app.use("/static", express.static(__dirname + "/public"));

// Serve the client
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/client.html");
});

// Channel and socket management
const channels = {};
const sockets = {};
const usernames = {};

/**
 * Signaling server for WebRTC voice chat
 * Handles peer discovery, ICE candidate relay, and session description exchange
 */
io.on("connection", (socket) => {
  socket.channels = {};
  sockets[socket.id] = socket;

  console.log(`[${socket.id}] Connected`);

  // Handle disconnection
  socket.on("disconnect", () => {
    for (const channel in socket.channels) {
      part(channel);
    }
    console.log(`[${socket.id}] Disconnected`);
    delete sockets[socket.id];
    delete usernames[socket.id];
  });

  // Set username
  socket.on("setUsername", (username) => {
    usernames[socket.id] = username || `User-${socket.id.slice(0, 6)}`;
    console.log(`[${socket.id}] Set username: ${usernames[socket.id]}`);
  });

  // Handle chat messages
  socket.on("chatMessage", (config) => {
    const channel = config.channel;
    const message = config.message;

    if (!channel || !channels[channel]) return;

    console.log(`[${socket.id}] Chat: ${message.substring(0, 50)}...`);

    // Broadcast to all users in the channel
    for (const id in channels[channel]) {
      channels[channel][id].emit("chatMessage", {
        peer_id: socket.id,
        username: usernames[socket.id] || socket.id.slice(0, 6),
        message: message,
        timestamp: Date.now(),
      });
    }
  });

  // Handle joining a channel
  socket.on("join", (config) => {
    console.log(`[${socket.id}] Joining:`, config);

    const channel = config.channel;
    const userdata = config.userdata || {};

    if (!channel) {
      console.log(`[${socket.id}] ERROR: No channel specified`);
      return;
    }

    if (channel in socket.channels) {
      console.log(`[${socket.id}] ERROR: Already in channel ${channel}`);
      return;
    }

    // Create channel if it doesn't exist
    if (!(channel in channels)) {
      channels[channel] = {};
    }

    // Store username
    if (userdata.username) {
      usernames[socket.id] = userdata.username;
    }

    // Notify existing peers about new peer and vice versa
    for (const id in channels[channel]) {
      // Tell existing peer about new peer
      channels[channel][id].emit("addPeer", {
        peer_id: socket.id,
        username: usernames[socket.id] || socket.id.slice(0, 6),
        should_create_offer: false,
      });

      // Tell new peer about existing peer
      socket.emit("addPeer", {
        peer_id: id,
        username: usernames[id] || id.slice(0, 6),
        should_create_offer: true,
      });
    }

    // Add socket to channel
    channels[channel][socket.id] = socket;
    socket.channels[channel] = channel;

    // Send current user list
    const userList = Object.keys(channels[channel]).map((id) => ({
      peer_id: id,
      username: usernames[id] || id.slice(0, 6),
    }));
    socket.emit("userList", userList);
  });

  // Handle leaving a channel
  function part(channel) {
    console.log(`[${socket.id}] Leaving channel: ${channel}`);

    if (!(channel in socket.channels)) {
      console.log(`[${socket.id}] ERROR: Not in channel ${channel}`);
      return;
    }

    delete socket.channels[channel];
    delete channels[channel][socket.id];

    // Notify remaining peers
    for (const id in channels[channel]) {
      channels[channel][id].emit("removePeer", { peer_id: socket.id });
      socket.emit("removePeer", { peer_id: id });
    }

    // Clean up empty channels
    if (Object.keys(channels[channel]).length === 0) {
      delete channels[channel];
    }
  }
  socket.on("part", part);

  // Relay ICE candidates between peers
  socket.on("relayICECandidate", (config) => {
    const peer_id = config.peer_id;
    const ice_candidate = config.ice_candidate;

    if (peer_id in sockets) {
      sockets[peer_id].emit("iceCandidate", {
        peer_id: socket.id,
        ice_candidate: ice_candidate,
      });
    }
  });

  // Relay session descriptions between peers
  socket.on("relaySessionDescription", (config) => {
    const peer_id = config.peer_id;
    const session_description = config.session_description;

    console.log(
      `[${socket.id}] Relaying ${session_description.type} to [${peer_id}]`,
    );

    if (peer_id in sockets) {
      sockets[peer_id].emit("sessionDescription", {
        peer_id: socket.id,
        session_description: session_description,
      });
    }
  });

  // Handle mute status broadcasts
  socket.on("muteStatus", (config) => {
    const channel = config.channel;
    const isMuted = config.isMuted;

    if (!channel || !channels[channel]) return;

    for (const id in channels[channel]) {
      if (id !== socket.id) {
        channels[channel][id].emit("peerMuteStatus", {
          peer_id: socket.id,
          isMuted: isMuted,
        });
      }
    }
  });

  // Handle speaking status for visual feedback
  socket.on("speakingStatus", (config) => {
    const channel = config.channel;
    const isSpeaking = config.isSpeaking;

    if (!channel || !channels[channel]) return;

    for (const id in channels[channel]) {
      if (id !== socket.id) {
        channels[channel][id].emit("peerSpeakingStatus", {
          peer_id: socket.id,
          isSpeaking: isSpeaking,
        });
      }
    }
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
