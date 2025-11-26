# Low-Bandwidth Voice & Text Chat

A lightweight, peer-to-peer voice and text chat application built on WebRTC, optimized for poor network conditions.

## Features

- **Voice Chat** - Real-time audio communication using WebRTC
- **Text Chat** - Simple text messaging for when voice isn't enough
- **Low Bandwidth Optimized** - Uses Opus codec with aggressive bitrate tuning
- **Multiple Quality Presets**:
  - **Low** (~6 kbps) - For extremely poor connections
  - **Medium** (~16 kbps) - Good balance of quality and bandwidth
  - **High** (~32 kbps) - Better quality when bandwidth allows
- **Voice Activity Detection** - Visual feedback when someone is speaking
- **Noise Suppression & Echo Cancellation** - Built-in audio processing
- **No Video** - Audio-only to minimize bandwidth usage
- **Modern UI** - Clean, dark-themed interface

## Technical Optimizations

The app uses several techniques to minimize bandwidth:

1. **Opus Codec Tuning** - Configures maxaveragebitrate, usedtx (discontinuous transmission), and useinbandfec (forward error correction)
2. **Mono Audio** - Single channel audio to halve bandwidth
3. **Reduced Sample Rates** - 8kHz-24kHz depending on quality setting
4. **VAD (Voice Activity Detection)** - Only processes audio when speaking
5. **WebSocket Transport** - Minimal signaling overhead
6. **STUN Only** - Uses Google's public STUN servers (no TURN to reduce complexity)

## Requirements

- Node.js 16.0.0 or higher
- A modern web browser (Chrome, Firefox, Safari, Edge)
- Microphone access

## Installation

```bash
# Clone or download the repository
cd cousine-web

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on port 8001 by default. You can change this by setting the `PORT` environment variable:

```bash
PORT=3000 npm start
```

## Usage

1. Open `http://localhost:8001` in your browser
2. Enter your name and a room name
3. Select your preferred audio quality based on your connection
4. Click "Join Room"
5. Grant microphone permission when prompted
6. Share the room name with others to chat!

### Controls

- **Mute Button** - Toggle your microphone on/off
- **Volume Slider** - Adjust your microphone input level
- **Per-Peer Volume** - Adjust individual participant volumes
- **Per-Peer Mute** - Mute specific participants locally
- **Text Chat** - Send messages in the sidebar

## Bandwidth Usage

Approximate bandwidth consumption per direction:

| Quality | Audio Bitrate | With Overhead |
|---------|--------------|---------------|
| Low     | ~6 kbps      | ~10-15 kbps   |
| Medium  | ~16 kbps     | ~20-25 kbps   |
| High    | ~32 kbps     | ~40-50 kbps   |

Actual usage may vary based on network conditions and browser implementation.

## Architecture

### Server (`server.js`)
- Express.js HTTP server
- Socket.IO 4.x for WebSocket signaling
- Handles room management and peer discovery
- Relays ICE candidates and session descriptions

### Client (`public/client.js`)
- Pure JavaScript (no jQuery or other dependencies)
- Modern WebRTC API (RTCPeerConnection, MediaDevices)
- Voice Activity Detection using Web Audio API
- SDP manipulation for bitrate control

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## Tips for Best Performance

1. **Use headphones** - Prevents echo and feedback
2. **Start with Low quality** - Upgrade only if connection is stable
3. **Close unnecessary tabs** - Reduces CPU/memory usage
4. **Use wired connection** - More stable than WiFi when possible
5. **Check firewall settings** - WebRTC needs UDP ports for P2P

## Troubleshooting

### Can't connect to peers
- Check that both users are in the same room
- Ensure firewall allows WebRTC traffic
- Try refreshing the page

### Audio quality is poor
- Try a lower quality setting
- Check your internet connection
- Close bandwidth-heavy applications

### Echo or feedback
- Use headphones
- Enable browser echo cancellation (enabled by default)
- Reduce speaker volume

### Microphone not working
- Check browser permissions
- Ensure correct input device is selected in OS settings
- Try a different browser

## License

MIT License - See LICENSE file for details