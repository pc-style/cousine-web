/**
 * Low-Bandwidth Voice & Text Chat Client
 * Optimized for poor network conditions using Opus codec tuning
 */

// Configuration
const CONFIG = {
  // Audio quality presets (Opus codec settings)
  quality: {
    low: {
      maxBitrate: 6000, // 6 kbps - extremely low bandwidth
      sampleRate: 8000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    medium: {
      maxBitrate: 16000, // 16 kbps - good balance
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    high: {
      maxBitrate: 32000, // 32 kbps - better quality
      sampleRate: 24000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  },

  // ICE servers for NAT traversal
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],

  // Voice Activity Detection threshold (0-1)
  vadThreshold: 0.01,
  vadSmoothingFrames: 5,
};

// State
let signalingSocket = null;
let localStream = null;
let peers = {};
let peerAudioElements = {};
let currentChannel = null;
let currentUsername = null;
let selectedQuality = "medium";
let isMuted = false;
let audioContext = null;
let vadAnalyser = null;
let vadDataArray = null;
let isSpeaking = false;
let speakingFrameCount = 0;

// DOM Elements
const elements = {};

/**
 * Initialize the application
 */
function init() {
  // Cache DOM elements
  elements.joinScreen = document.getElementById("join-screen");
  elements.chatScreen = document.getElementById("chat-screen");
  elements.usernameInput = document.getElementById("username-input");
  elements.roomInput = document.getElementById("room-input");
  elements.joinBtn = document.getElementById("join-btn");
  elements.leaveBtn = document.getElementById("leave-btn");
  elements.roomName = document.getElementById("room-name");
  elements.connectionStatus = document.getElementById("connection-status");
  elements.localUsername = document.getElementById("local-username");
  elements.localSpeaking = document.getElementById("local-speaking");
  elements.muteBtn = document.getElementById("mute-btn");
  elements.micOnIcon = document.getElementById("mic-on-icon");
  elements.micOffIcon = document.getElementById("mic-off-icon");
  elements.inputVolume = document.getElementById("input-volume");
  elements.peersList = document.getElementById("peers-list");
  elements.chatMessages = document.getElementById("chat-messages");
  elements.chatInput = document.getElementById("chat-input");
  elements.sendBtn = document.getElementById("send-btn");
  elements.audioContainer = document.getElementById("audio-container");
  elements.qualityBtns = document.querySelectorAll(".quality-btn");

  // Set up event listeners
  setupEventListeners();

  // Load saved preferences
  loadPreferences();
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Quality selection
  elements.qualityBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.qualityBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedQuality = btn.dataset.quality;
      localStorage.setItem("audioQuality", selectedQuality);
    });
  });

  // Join button
  elements.joinBtn.addEventListener("click", joinRoom);

  // Allow Enter to join
  elements.usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") elements.roomInput.focus();
  });
  elements.roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
  });

  // Leave button
  elements.leaveBtn.addEventListener("click", leaveRoom);

  // Mute button
  elements.muteBtn.addEventListener("click", toggleMute);

  // Volume control
  elements.inputVolume.addEventListener("input", (e) => {
    setInputVolume(e.target.value / 100);
  });

  // Chat input
  elements.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Send button
  elements.sendBtn.addEventListener("click", sendChatMessage);

  // Auto-resize chat input
  elements.chatInput.addEventListener("input", () => {
    elements.chatInput.style.height = "auto";
    elements.chatInput.style.height =
      Math.min(elements.chatInput.scrollHeight, 100) + "px";
  });
}

/**
 * Load saved preferences from localStorage
 */
function loadPreferences() {
  const savedQuality = localStorage.getItem("audioQuality");
  if (savedQuality && CONFIG.quality[savedQuality]) {
    selectedQuality = savedQuality;
    elements.qualityBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.quality === savedQuality);
    });
  }

  const savedUsername = localStorage.getItem("username");
  if (savedUsername) {
    elements.usernameInput.value = savedUsername;
  }

  const savedRoom = localStorage.getItem("lastRoom");
  if (savedRoom) {
    elements.roomInput.value = savedRoom;
  }
}

/**
 * Join a room
 */
async function joinRoom() {
  const username = elements.usernameInput.value.trim() || "Anonymous";
  const room = elements.roomInput.value.trim() || "general";

  // Save preferences
  localStorage.setItem("username", username);
  localStorage.setItem("lastRoom", room);

  currentUsername = username;
  currentChannel = room;

  // Update UI
  elements.localUsername.textContent = username;
  elements.roomName.textContent = `🎤 ${room}`;

  // Request microphone access
  try {
    await setupLocalMedia();
  } catch (error) {
    console.error("Failed to access microphone:", error);
    alert(
      "Could not access your microphone. Please grant permission and try again.",
    );
    return;
  }

  // Connect to signaling server
  connectToSignalingServer();

  // Switch screens
  elements.joinScreen.classList.add("hidden");
  elements.chatScreen.classList.remove("hidden");
}

/**
 * Leave the current room
 */
function leaveRoom() {
  // Disconnect from signaling server
  if (signalingSocket) {
    signalingSocket.emit("part", currentChannel);
    signalingSocket.disconnect();
    signalingSocket = null;
  }

  // Stop local media
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  // Close all peer connections
  for (const peerId in peers) {
    if (peers[peerId]) {
      peers[peerId].close();
    }
  }
  peers = {};

  // Remove all audio elements
  for (const peerId in peerAudioElements) {
    if (peerAudioElements[peerId]) {
      peerAudioElements[peerId].remove();
    }
  }
  peerAudioElements = {};

  // Stop audio context
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  // Reset state
  currentChannel = null;
  isMuted = false;
  isSpeaking = false;

  // Reset UI
  elements.muteBtn.classList.remove("muted");
  elements.micOnIcon.classList.remove("hidden");
  elements.micOffIcon.classList.add("hidden");
  elements.peersList.innerHTML =
    '<p class="peers-placeholder">Waiting for others to join...</p>';
  elements.chatMessages.innerHTML =
    '<p class="chat-placeholder">No messages yet...</p>';

  // Switch screens
  elements.chatScreen.classList.add("hidden");
  elements.joinScreen.classList.remove("hidden");
}

/**
 * Set up local audio media with optimized constraints
 */
async function setupLocalMedia() {
  const qualitySettings = CONFIG.quality[selectedQuality];

  const constraints = {
    audio: {
      channelCount: qualitySettings.channelCount,
      sampleRate: qualitySettings.sampleRate,
      echoCancellation: qualitySettings.echoCancellation,
      noiseSuppression: qualitySettings.noiseSuppression,
      autoGainControl: qualitySettings.autoGainControl,
    },
    video: false,
  };

  localStream = await navigator.mediaDevices.getUserMedia(constraints);

  // Set up Voice Activity Detection
  setupVAD();

  console.log(
    "Local audio stream acquired:",
    localStream.getAudioTracks()[0].getSettings(),
  );
}

/**
 * Set up Voice Activity Detection
 */
function setupVAD() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(localStream);
    vadAnalyser = audioContext.createAnalyser();
    vadAnalyser.fftSize = 256;
    vadAnalyser.smoothingTimeConstant = 0.8;
    source.connect(vadAnalyser);

    vadDataArray = new Uint8Array(vadAnalyser.frequencyBinCount);

    // Start VAD loop
    checkVoiceActivity();
  } catch (error) {
    console.warn("Could not set up VAD:", error);
  }
}

/**
 * Check for voice activity (called in a loop)
 */
function checkVoiceActivity() {
  if (!vadAnalyser || !currentChannel) return;

  vadAnalyser.getByteFrequencyData(vadDataArray);

  // Calculate average volume
  let sum = 0;
  for (let i = 0; i < vadDataArray.length; i++) {
    sum += vadDataArray[i];
  }
  const average = sum / vadDataArray.length / 255;

  // Smoothing to prevent flickering
  const wasSpeaking = isSpeaking;
  if (average > CONFIG.vadThreshold) {
    speakingFrameCount = Math.min(
      speakingFrameCount + 1,
      CONFIG.vadSmoothingFrames,
    );
  } else {
    speakingFrameCount = Math.max(speakingFrameCount - 1, 0);
  }

  isSpeaking = speakingFrameCount >= CONFIG.vadSmoothingFrames / 2;

  // Update UI and notify peers if state changed
  if (isSpeaking !== wasSpeaking) {
    elements.localSpeaking.classList.toggle("hidden", !isSpeaking || isMuted);

    if (signalingSocket && currentChannel) {
      signalingSocket.emit("speakingStatus", {
        channel: currentChannel,
        isSpeaking: isSpeaking && !isMuted,
      });
    }
  }

  requestAnimationFrame(checkVoiceActivity);
}

/**
 * Connect to the signaling server
 */
function connectToSignalingServer() {
  updateConnectionStatus("connecting", "Connecting...");

  // Connect with optimized settings
  signalingSocket = io({
    transports: ["websocket"],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  signalingSocket.on("connect", () => {
    console.log("Connected to signaling server");
    updateConnectionStatus("connected", "Connected");

    // Set username
    signalingSocket.emit("setUsername", currentUsername);

    // Join the channel
    signalingSocket.emit("join", {
      channel: currentChannel,
      userdata: { username: currentUsername },
    });
  });

  signalingSocket.on("disconnect", () => {
    console.log("Disconnected from signaling server");
    updateConnectionStatus("disconnected", "Disconnected");
  });

  signalingSocket.on("connect_error", (error) => {
    console.error("Connection error:", error);
    updateConnectionStatus("error", "Connection error");
  });

  // Handle peer events
  signalingSocket.on("addPeer", handleAddPeer);
  signalingSocket.on("removePeer", handleRemovePeer);
  signalingSocket.on("sessionDescription", handleSessionDescription);
  signalingSocket.on("iceCandidate", handleIceCandidate);

  // Handle chat messages
  signalingSocket.on("chatMessage", handleChatMessage);

  // Handle peer status updates
  signalingSocket.on("peerMuteStatus", handlePeerMuteStatus);
  signalingSocket.on("peerSpeakingStatus", handlePeerSpeakingStatus);

  // Handle user list
  signalingSocket.on("userList", handleUserList);
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status, text) {
  elements.connectionStatus.className = `status ${status}`;
  elements.connectionStatus.textContent = text;
}

/**
 * Handle adding a new peer
 */
async function handleAddPeer(config) {
  console.log("Adding peer:", config);

  const peerId = config.peer_id;
  const peerUsername = config.username || peerId.slice(0, 6);

  if (peers[peerId]) {
    console.log("Already connected to peer:", peerId);
    return;
  }

  // Create peer connection with optimized settings
  const peerConnection = new RTCPeerConnection({
    iceServers: CONFIG.iceServers,
    iceCandidatePoolSize: 2,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  });

  peers[peerId] = peerConnection;

  // Add local stream tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      signalingSocket.emit("relayICECandidate", {
        peer_id: peerId,
        ice_candidate: {
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          candidate: event.candidate.candidate,
        },
      });
    }
  };

  // Handle remote tracks
  peerConnection.ontrack = (event) => {
    console.log("Received remote track from:", peerId);
    handleRemoteTrack(peerId, peerUsername, event.streams[0]);
  };

  // Handle connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log(
      `Peer ${peerId} connection state:`,
      peerConnection.connectionState,
    );
    updatePeerConnectionStatus(peerId, peerConnection.connectionState);
  };

  // Add peer to UI
  addPeerToUI(peerId, peerUsername);

  // Create offer if we should initiate
  if (config.should_create_offer) {
    try {
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      // Modify SDP to set audio bitrate
      const modifiedOffer = {
        type: offer.type,
        sdp: setAudioBitrate(
          offer.sdp,
          CONFIG.quality[selectedQuality].maxBitrate,
        ),
      };

      await peerConnection.setLocalDescription(modifiedOffer);

      signalingSocket.emit("relaySessionDescription", {
        peer_id: peerId,
        session_description: peerConnection.localDescription,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  }
}

/**
 * Handle removing a peer
 */
function handleRemovePeer(config) {
  console.log("Removing peer:", config);

  const peerId = config.peer_id;

  // Close peer connection
  if (peers[peerId]) {
    peers[peerId].close();
    delete peers[peerId];
  }

  // Remove audio element
  if (peerAudioElements[peerId]) {
    peerAudioElements[peerId].remove();
    delete peerAudioElements[peerId];
  }

  // Remove from UI
  removePeerFromUI(peerId);
}

/**
 * Handle session description from remote peer
 */
async function handleSessionDescription(config) {
  const peerId = config.peer_id;
  const remoteDescription = config.session_description;

  console.log(
    "Received session description from:",
    peerId,
    remoteDescription.type,
  );

  const peerConnection = peers[peerId];
  if (!peerConnection) {
    console.error("No peer connection for:", peerId);
    return;
  }

  try {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(remoteDescription),
    );

    // If this was an offer, create and send an answer
    if (remoteDescription.type === "offer") {
      const answer = await peerConnection.createAnswer();

      // Modify SDP to set audio bitrate
      const modifiedAnswer = {
        type: answer.type,
        sdp: setAudioBitrate(
          answer.sdp,
          CONFIG.quality[selectedQuality].maxBitrate,
        ),
      };

      await peerConnection.setLocalDescription(modifiedAnswer);

      signalingSocket.emit("relaySessionDescription", {
        peer_id: peerId,
        session_description: peerConnection.localDescription,
      });
    }
  } catch (error) {
    console.error("Error handling session description:", error);
  }
}

/**
 * Handle ICE candidate from remote peer
 */
async function handleIceCandidate(config) {
  const peerId = config.peer_id;
  const candidate = config.ice_candidate;

  const peerConnection = peers[peerId];
  if (!peerConnection) return;

  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
  }
}

/**
 * Handle remote audio track
 */
function handleRemoteTrack(peerId, peerUsername, stream) {
  // Create audio element
  const audio = document.createElement("audio");
  audio.id = `audio-${peerId}`;
  audio.autoplay = true;
  audio.srcObject = stream;

  // Add to container
  elements.audioContainer.appendChild(audio);
  peerAudioElements[peerId] = audio;

  console.log("Remote audio element created for:", peerUsername);
}

/**
 * Modify SDP to set audio bitrate for Opus codec
 */
function setAudioBitrate(sdp, bitrate) {
  const lines = sdp.split("\r\n");
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);

    // Find audio m-line and add bandwidth attribute
    if (lines[i].startsWith("m=audio")) {
      // Add TIAS (Transport Independent Application Specific) bandwidth
      result.push(`b=TIAS:${bitrate}`);
    }

    // Modify Opus fmtp line to add bitrate constraints
    if (lines[i].includes("opus/48000")) {
      // Find the payload type
      const match = lines[i].match(/a=rtpmap:(\d+) opus/);
      if (match) {
        const pt = match[1];
        // Look for existing fmtp line
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith(`a=fmtp:${pt}`)) {
            // Modify the fmtp line
            if (!lines[j].includes("maxaveragebitrate")) {
              lines[j] +=
                `;maxaveragebitrate=${bitrate};maxplaybackrate=${CONFIG.quality[selectedQuality].sampleRate};useinbandfec=1;usedtx=1;cbr=0`;
            }
            break;
          }
        }
      }
    }
  }

  return result.join("\r\n");
}

/**
 * Add peer to the UI
 */
function addPeerToUI(peerId, username) {
  // Remove placeholder if present
  const placeholder = elements.peersList.querySelector(".peers-placeholder");
  if (placeholder) {
    placeholder.remove();
  }

  // Check if already exists
  if (document.getElementById(`peer-${peerId}`)) return;

  const peerElement = document.createElement("div");
  peerElement.id = `peer-${peerId}`;
  peerElement.className = "peer-item";
  peerElement.innerHTML = `
    <div class="peer-info">
      <span class="peer-name">${escapeHtml(username)}</span>
      <span class="peer-status connecting">Connecting...</span>
      <span class="peer-speaking hidden">🎤</span>
    </div>
    <div class="peer-controls">
      <button class="peer-mute-btn" onclick="togglePeerMute('${peerId}')" title="Mute/Unmute">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>
      </button>
      <input type="range" class="peer-volume" min="0" max="100" value="100"
             onchange="setPeerVolume('${peerId}', this.value)" title="Volume">
    </div>
  `;

  elements.peersList.appendChild(peerElement);
}

/**
 * Remove peer from the UI
 */
function removePeerFromUI(peerId) {
  const peerElement = document.getElementById(`peer-${peerId}`);
  if (peerElement) {
    peerElement.remove();
  }

  // Show placeholder if no peers left
  if (elements.peersList.children.length === 0) {
    elements.peersList.innerHTML =
      '<p class="peers-placeholder">Waiting for others to join...</p>';
  }
}

/**
 * Update peer connection status in UI
 */
function updatePeerConnectionStatus(peerId, state) {
  const peerElement = document.getElementById(`peer-${peerId}`);
  if (!peerElement) return;

  const statusElement = peerElement.querySelector(".peer-status");
  if (statusElement) {
    statusElement.className = `peer-status ${state}`;
    switch (state) {
      case "connected":
        statusElement.textContent = "Connected";
        break;
      case "connecting":
        statusElement.textContent = "Connecting...";
        break;
      case "disconnected":
        statusElement.textContent = "Disconnected";
        break;
      case "failed":
        statusElement.textContent = "Failed";
        break;
      default:
        statusElement.textContent = state;
    }
  }
}

/**
 * Handle user list from server
 */
function handleUserList(users) {
  console.log("User list:", users);
  // Users are added via addPeer events, this is just for initial state
}

/**
 * Toggle local mute
 */
function toggleMute() {
  isMuted = !isMuted;

  if (localStream) {
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }

  // Update UI
  elements.muteBtn.classList.toggle("muted", isMuted);
  elements.micOnIcon.classList.toggle("hidden", isMuted);
  elements.micOffIcon.classList.toggle("hidden", !isMuted);
  elements.localSpeaking.classList.add("hidden");

  // Notify peers
  if (signalingSocket && currentChannel) {
    signalingSocket.emit("muteStatus", {
      channel: currentChannel,
      isMuted: isMuted,
    });
  }
}

/**
 * Set input volume (gain)
 */
function setInputVolume(volume) {
  // This would require a GainNode in the audio pipeline
  // For now, we just log it
  console.log("Input volume set to:", volume);
}

/**
 * Toggle peer mute
 */
function togglePeerMute(peerId) {
  const audio = peerAudioElements[peerId];
  if (audio) {
    audio.muted = !audio.muted;

    const btn = document.querySelector(`#peer-${peerId} .peer-mute-btn`);
    if (btn) {
      btn.classList.toggle("muted", audio.muted);
    }
  }
}

/**
 * Set peer volume
 */
function setPeerVolume(peerId, volume) {
  const audio = peerAudioElements[peerId];
  if (audio) {
    audio.volume = volume / 100;
  }
}

/**
 * Handle peer mute status update
 */
function handlePeerMuteStatus(config) {
  const peerElement = document.getElementById(`peer-${config.peer_id}`);
  if (peerElement) {
    peerElement.classList.toggle("peer-muted", config.isMuted);
  }
}

/**
 * Handle peer speaking status update
 */
function handlePeerSpeakingStatus(config) {
  const peerElement = document.getElementById(`peer-${config.peer_id}`);
  if (peerElement) {
    const speakingIndicator = peerElement.querySelector(".peer-speaking");
    if (speakingIndicator) {
      speakingIndicator.classList.toggle("hidden", !config.isSpeaking);
    }
    peerElement.classList.toggle("speaking", config.isSpeaking);
  }
}

/**
 * Send a chat message
 */
function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (!message || !signalingSocket || !currentChannel) return;

  signalingSocket.emit("chatMessage", {
    channel: currentChannel,
    message: message,
  });

  elements.chatInput.value = "";
  elements.chatInput.style.height = "auto";
}

/**
 * Handle incoming chat message
 */
function handleChatMessage(config) {
  // Remove placeholder if present
  const placeholder = elements.chatMessages.querySelector(".chat-placeholder");
  if (placeholder) {
    placeholder.remove();
  }

  const messageElement = document.createElement("div");
  messageElement.className = "chat-message";

  const isMe = config.peer_id === signalingSocket?.id;

  messageElement.innerHTML = `
    <span class="message-author ${isMe ? "me" : ""}">${escapeHtml(config.username || "Unknown")}:</span>
    <span class="message-text">${escapeHtml(config.message)}</span>
    <span class="message-time">${formatTime(config.timestamp)}</span>
  `;

  elements.chatMessages.appendChild(messageElement);

  // Scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

/**
 * Format timestamp for chat messages
 */
function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.togglePeerMute = togglePeerMute;
window.setPeerVolume = setPeerVolume;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
