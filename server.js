const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'uploads'))) fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

let users = {};
let messages = [];
let favorites = {};

try { if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch(e) {}
try {
  if (fs.existsSync(MESSAGES_FILE)) {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    if (!Array.isArray(messages)) messages = [];
    cleanOldMessages();
  }
} catch(e) { messages = []; }
try { if (fs.existsSync(FAVORITES_FILE)) favorites = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8')); } catch(e) {}

function saveUsers() { try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch(e) {} }
function saveMessages() { try { cleanOldMessages(); fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2)); } catch(e) {} }
function saveFavorites() { try { fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2)); } catch(e) {} }

function cleanOldMessages() {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  messages = messages.filter(msg => {
    if (msg.imageUrl || msg.videoUrl) return (now - msg.timestamp) < sevenDays;
    return true;
  });
  const textMsgs = messages.filter(m => !m.imageUrl && !m.videoUrl);
  if (textMsgs.length > 1000) {
    const toRemove = textMsgs.slice(0, textMsgs.length - 1000);
    toRemove.forEach(m => { const idx = messages.indexOf(m); if (idx > -1) messages.splice(idx, 1); });
  }
}

let msgCounter = 0;
function getMsgId() { msgCounter++; return `${Date.now().toString(36)}_${msgCounter}_${Math.random().toString(36).substr(2, 4)}`; }

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const setJsonHeaders = () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };
  if (req.method === 'OPTIONS') { setJsonHeaders(); res.writeHead(200); return res.end(); }

  if (pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400); return res.end(JSON.stringify({ success: false })); }
        if (users[username]) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名已存在' })); }
        users[username] = { password, nickname: nickname || username, avatar: '😀', avatarType: 'emoji', signature: '这个人很懒，什么都没写...', intimacy: {} };
        saveUsers();
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== password) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, token, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji', signature: user.signature || '' } }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  if (pathname === '/api/auto-login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const username = Buffer.from(JSON.parse(body).token, 'base64').toString('utf-8').split(':')[0];
        const user = users[username];
        if (!user) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji', signature: user.signature || '' } }));
      } catch(e) { res.writeHead(401); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, nickname, avatar, avatarType, signature } = JSON.parse(body);
        if (users[username]) {
          if (nickname) users[username].nickname = nickname;
          if (avatar) users[username].avatar = avatar;
          if (avatarType) users[username].avatarType = avatarType;
          if (signature !== undefined) users[username].signature = signature;
          saveUsers();
        }
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 用户主页数据
  if (pathname === '/api/user-profile' && req.method === 'GET') {
    setJsonHeaders();
    const targetUsername = parsedUrl.query.username;
    const user = users[targetUsername];
    if (!user) { res.writeHead(404); return res.end(JSON.stringify({ success: false })); }
    // 最近发言
    const recentMsgs = messages.filter(m => m.senderUsername === targetUsername && !m.recalled).slice(-10).reverse();
    // 亲密关系
    const intimacy = user.intimacy || {};
    const intimacyList = Object.entries(intimacy).map(([uname, count]) => {
      const u = users[uname];
      return { username: uname, nickname: u?.nickname || uname, avatar: u?.avatar || '😀', avatarType: u?.avatarType || 'emoji', count };
    }).sort((a, b) => b.count - a.count).slice(0, 6);
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      profile: { username: targetUsername, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji', signature: user.signature || '', isOnline: [...onlineClients.values()].some(c => c.username === targetUsername) },
      recentMsgs,
      intimacyList
    }));
    return;
  }

  if (pathname === '/api/online-users' && req.method === 'GET') {
    setJsonHeaders();
    const list = [];
    onlineClients.forEach(c => { if (c.username) list.push({ username: c.username, nickname: c.nickname, avatar: c.avatar, avatarType: c.avatarType, signature: (users[c.username]?.signature || '') }); });
    res.writeHead(200); res.end(JSON.stringify({ success: true, users: list, count: wss.clients.size }));
    return;
  }

  if (pathname === '/api/messages' && req.method === 'GET') {
    setJsonHeaders();
    const all = messages.slice(-1000);
    res.writeHead(200); res.end(JSON.stringify({ success: true, messages: all }));
    return;
  }

  if (pathname === '/api/favorites' && req.method === 'GET') {
    setJsonHeaders();
    const username = parsedUrl.query.username;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, favorites: messages.filter(m => (favorites[username] || []).includes(m.msgId)), favIds: favorites[username] || [] }));
    return;
  }

  if (pathname === '/api/toggle-favorite' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, msgId } = JSON.parse(body);
        if (!favorites[username]) favorites[username] = [];
        const idx = favorites[username].indexOf(msgId);
        idx > -1 ? favorites[username].splice(idx, 1) : favorites[username].push(msgId);
        saveFavorites();
        res.writeHead(200); res.end(JSON.stringify({ success: true, isFavorited: idx === -1, favIds: favorites[username] }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  if (pathname === '/api/recall-message' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { msgId, username } = JSON.parse(body);
        const msg = messages.find(m => m.msgId === msgId);
        if (!msg) { res.writeHead(404); return res.end(JSON.stringify({ success: false })); }
        if (msg.senderUsername !== username) { res.writeHead(403); return res.end(JSON.stringify({ success: false })); }
        if (Date.now() - msg.timestamp > 120000) { res.writeHead(400); return res.end(JSON.stringify({ success: false })); }
        msg.recalled = true; msg.text = '[消息已撤回]'; msg.imageUrl = null; msg.videoUrl = null; msg.audioUrl = null;
        saveMessages();
        broadcastAll({ type: 'message-recalled', msgId });
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    const filePath = path.join(DATA_DIR, pathname);
    fs.readFile(filePath, (error, content) => {
      if (error) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(filePath).toLowerCase();
      const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length, 'Cache-Control': 'public, max-age=604800' });
      res.end(content);
    });
    return;
  }

  let filePath = '.' + pathname;
  if (filePath === './') filePath = './index.html';
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const contentType = mimeTypes[extname] || 'application/octet-stream';
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); res.end('Not Found'); }
    else { res.writeHead(200, { 'Content-Type': contentType }); res.end(content, 'utf-8'); }
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 100 * 1024 * 1024 });
const onlineClients = new Map();

function getClientId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

function broadcastAll(data, excludeId) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      const entry = [...onlineClients.entries()].find(([, v]) => v.ws === c);
      if (!excludeId || (entry && entry[0] !== excludeId)) c.send(msg);
    }
  });
}

function broadcastOnlineUsers() {
  const list = [];
  onlineClients.forEach(c => {
    if (c.username) list.push({ username: c.username, nickname: c.nickname, avatar: c.avatar, avatarType: c.avatarType, signature: (users[c.username]?.signature || '') });
  });
  broadcastAll({ type: 'onlineUsers', users: list, count: wss.clients.size });
}

wss.on('connection', (ws) => {
  const id = getClientId();
  onlineClients.set(id, { ws, username: null, nickname: '游客', avatar: '😀', avatarType: 'emoji' });
  ws.send(JSON.stringify({ type: 'welcome', clientId: id }));
  broadcastOnlineUsers();

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch(e) { return; }
    const client = onlineClients.get(id);
    if (!client) return;

    switch(data.type) {
      case 'login':
        if (data.username && users[data.username]) {
          const u = users[data.username];
          client.username = data.username;
          client.nickname = u.nickname;
          client.avatar = u.avatar;
          client.avatarType = u.avatarType || 'emoji';
          ws.send(JSON.stringify({ type: 'login_success', username: data.username, nickname: u.nickname, avatar: u.avatar, avatarType: u.avatarType || 'emoji', signature: u.signature || '', clientId: id }));
          broadcastAll({ type: 'system', text: `👋 ${u.nickname} 上线了` }, id);
          broadcastOnlineUsers();
        }
        break;

      case 'message': {
        if (!data.text?.trim()) return;
        const msg = { type: 'message', msgId: getMsgId(), text: data.text.trim(), sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, mentions: data.mentions || [], recalled: false };
        messages.push(msg);
        broadcastAll(msg);
        updateIntimacy(client.username, data.mentions || []);
        if (messages.length % 10 === 0) saveMessages();
        break;
      }

      case 'image': {
        if (!data.image) return;
        const size = Math.round(data.image.length * 0.75 / 1024);
        const msg = { type: 'message', msgId: data.msgId || getMsgId(), imageUrl: 'data:image/jpeg;base64,' + data.image, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false, fileSize: size };
        messages.push(msg);
        broadcastAll(msg);
        saveMessages();
        break;
      }

      case 'audio': {
        if (!data.audio) return;
        const size = Math.round(data.audio.length * 0.75 / 1024);
        const msg = { type: 'message', msgId: getMsgId(), audioUrl: 'data:audio/webm;base64,' + data.audio, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false, fileSize: size };
        messages.push(msg);
        broadcastAll(msg);
        saveMessages();
        break;
      }

      case 'video': {
        if (!data.video) return;
        const size = Math.round(data.video.length * 0.75 / (1024 * 1024) * 10) / 10;
        const msg = { type: 'message', msgId: data.msgId || getMsgId(), videoUrl: data.video, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false, fileSize: size };
        messages.push(msg);
        broadcastAll(msg);
        saveMessages();
        break;
      }

      case 'update-profile':
        if (client.username && users[client.username]) {
          if (data.nickname) { users[client.username].nickname = data.nickname; client.nickname = data.nickname; }
          if (data.avatar) { users[client.username].avatar = data.avatar; client.avatar = data.avatar; }
          if (data.avatarType) { users[client.username].avatarType = data.avatarType; client.avatarType = data.avatarType; }
          if (data.signature !== undefined) users[client.username].signature = data.signature;
          saveUsers();
          ws.send(JSON.stringify({ type: 'profile_updated', nickname: client.nickname, avatar: client.avatar, avatarType: client.avatarType, signature: users[client.username].signature || '' }));
          broadcastOnlineUsers();
        }
        break;
    }
  });

  ws.on('close', () => {
    const c = onlineClients.get(id);
    if (c?.username) broadcastAll({ type: 'system', text: `👋 ${c.nickname} 离开了聊天室` });
    onlineClients.delete(id);
    broadcastOnlineUsers();
  });
  ws.on('error', () => { onlineClients.delete(id); broadcastOnlineUsers(); });
});

function updateIntimacy(senderUsername, mentions) {
  if (!senderUsername) return;
  mentions.forEach(targetNickname => {
    const targetClient = [...onlineClients.values()].find(c => c.nickname === targetNickname);
    if (targetClient?.username && targetClient.username !== senderUsername) {
      if (!users[senderUsername]) users[senderUsername] = { intimacy: {} };
      if (!users[senderUsername].intimacy) users[senderUsername].intimacy = {};
      if (!users[targetClient.username]) users[targetClient.username] = { intimacy: {} };
      if (!users[targetClient.username].intimacy) users[targetClient.username].intimacy = {};
      users[senderUsername].intimacy[targetClient.username] = (users[senderUsername].intimacy[targetClient.username] || 0) + 1;
      users[targetClient.username].intimacy[senderUsername] = (users[targetClient.username].intimacy[senderUsername] || 0) + 1;
      saveUsers();
    }
  });
}

setInterval(() => saveMessages(), 15000);
server.listen(PORT, () => console.log(`🌐 极速聊天室: http://localhost:${PORT}`));