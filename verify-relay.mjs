import WebSocket from 'ws';

const sessionId = 'kodi-verify-' + Math.random().toString(36).substring(7);
const ws = new WebSocket(`ws://127.0.0.1:8090/api/remote/ws?session=${sessionId}&role=controller`);

const timeout = setTimeout(() => {
  console.log('Timeout reached');
  process.exit(0);
}, 25000);

ws.on('open', () => {
  console.log('Connected to session:', sessionId);
  ws.send(JSON.stringify({
    type: 'settings',
    settings: {
      playbackTarget: 'kodi',
      kodiConfig: { address: 'http://mini.local:8080/jsonrpc', username: 'kodi', password: 'kodi' }
    }
  }));
});

let loadSent = false;
let seekSent = false;

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('Received:', JSON.stringify(msg));

  if (msg.type === 'session_state' && msg.payload.playbackTarget === 'kodi') {
    if (msg.payload.kodi.connected && !loadSent) {
       console.log('Kodi connected, sending load...');
       loadSent = true;
       ws.send(JSON.stringify({ type: 'load', video: { id: 'aqz-KE-bpKQ' } }));
    }
  }

  if (msg.type === 'player_status' && !msg.state.paused && !msg.state.buffering && !seekSent && loadSent) {
      console.log('Playback active, seeking...');
      seekSent = true;
      ws.send(JSON.stringify({ type: 'seek', time: 60 }));
  }
  
  if (seekSent && msg.type === 'player_status') {
      if (msg.state.buffering) {
          console.log('Detected post-seek buffering!');
      } else if (!msg.state.buffering && msg.state.time >= 55) {
          console.log('Detected post-seek resumed playback!');
          // We could exit here but let's see one more
      }
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});
