const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// 数据目录
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');

let users = {};
let messages = [];
let favorites = {};
let posts = [];

// ==================== 数据加载 ====================
function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch(e) { console.error(`加载 ${file} 失败:`, e.message); }
  return fallback;
}

users = loadJSON(USERS_FILE, {});
messages = loadJSON(MESSAGES_FILE, []);
favorites = loadJSON(FAVORITES_FILE, {});
posts = loadJSON(POSTS_FILE, []);

function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch(e) {}
}

// ==================== 消息清理 ====================
function cleanMessages() {
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const MAX_TEXT = 1000;

  let textMsgs = [];
  let mediaMsgs = [];

  messages.forEach(m => {
    if (m.imageUrl || m.videoUrl || m.audioUrl) {
      if (now - m.timestamp < SEVEN_DAYS) mediaMsgs.push(m);
    } else {
      textMsgs.push(m);
    }
  });

  if (textMsgs.length > MAX_TEXT) textMsgs = textMsgs.slice(-MAX_TEXT);
  messages = [...textMsgs, ...mediaMsgs].sort((a, b) => a.timestamp - b.timestamp);
}

cleanMessages();

// ==================== 工具函数 ====================
let msgCounter = 0;
function getMsgId() {
  msgCounter++;
  return `${Date.now().toString(36)}_${msgCounter}_${Math.random().toString(36).substring(2, 6)}`;
}

const onlineClients = new Map();

function broadcastAll(data, excludeClientId) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      const entry = [...onlineClients.entries()].find(([, v]) => v.ws === c);
      if (!excludeClientId || (entry && entry[0] !== excludeClientId)) c.send(msg);
    }
  });
}

function broadcastOnlineUsers() {
  const list = [];
  onlineClients.forEach(c => {
    if (c.username) {
      list.push({
        username: c.username,
        nickname: c.nickname,
        avatar: c.avatar,
        avatarType: c.avatarType,
        signature: users[c.username]?.signature || ''
      });
    }
  });
  broadcastAll({ type: 'onlineUsers', users: list, count: wss.clients.size });
}

function updateIntimacy(from, mentions) {
  if (!from || !mentions?.length) return;
  mentions.forEach(nickname => {
    const target = [...onlineClients.values()].find(c => c.nickname === nickname);
    if (target?.username && target.username !== from) {
      if (!users[from].intimacy) users[from].intimacy = {};
      if (!users[target.username].intimacy) users[target.username].intimacy = {};
      users[from].intimacy[target.username] = (users[from].intimacy[target.username] || 0) + 1;
      users[target.username].intimacy[from] = (users[target.username].intimacy[from] || 0) + 1;
      saveJSON(USERS_FILE, users);
    }
  });
}

// ==================== HTTP 服务器 ====================
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const setHeaders = () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };

  if (req.method === 'OPTIONS') { setHeaders(); res.writeHead(200); res.end(); return; }

  // ======== 注册 ========
  if (pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '请填写用户名和密码' })); }
        if (users[username]) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名已存在' })); }
        users[username] = { password, nickname: nickname || username, avatar: '😀', avatarType: 'emoji', signature: '', intimacy: {} };
        saveJSON(USERS_FILE, users);
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // ======== 登录 ========
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== password) { res.writeHead(401); return res.end(JSON.stringify({ success: false, message: '用户名或密码错误' })); }
        const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, token, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji', signature: user.signature || '' } }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // ======== 自动登录 ========
  if (pathname === '/api/auto-login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
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

  // ======== 更新资料 ========
  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
      try {
        const { username, nickname, avatar, avatarType, signature } = JSON.parse(body);
        if (users[username]) {
          if (nickname !== undefined) users[username].nickname = nickname;
          if (avatar !== undefined) users[username].avatar = avatar;
          if (avatarType !== undefined) users[username].avatarType = avatarType;
          if (signature !== undefined) users[username].signature = signature;
          saveJSON(USERS_FILE, users);
        }
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // ======== 用户主页 ========
  if (pathname === '/api/user-profile' && req.method === 'GET') {
    setHeaders();
    const target = parsed.query.username;
    const user = users[target];
    if (!user) { res.writeHead(404); return res.end(JSON.stringify({ success: false })); }
    const recentMsgs = messages.filter(m => m.senderUsername === target && !m.recalled).slice(-10).reverse();
    const intimacy = user.intimacy || {};
    const intimacyList = Object.entries(intimacy)
      .map(([u, count]) => ({ username: u, nickname: users[u]?.nickname || u, avatar: users[u]?.avatar || '😀', avatarType: users[u]?.avatarType || 'emoji', count }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, profile: { username: target, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji', signature: user.signature || '', isOnline: [...onlineClients.values()].some(c => c.username === target) }, recentMsgs, intimacyList }));
    return;
  }

  // ======== 在线用户 ========
  if (pathname === '/api/online-users' && req.method === 'GET') {
    setHeaders();
    const list = [];
    onlineClients.forEach(c => {
      if (c.username) list.push({ username: c.username, nickname: c.nickname, avatar: c.avatar, avatarType: c.avatarType, signature: users[c.username]?.signature || '' });
    });
    res.writeHead(200); res.end(JSON.stringify({ success: true, users: list, count: wss.clients.size }));
    return;
  }

  // ======== 消息列表 ========
  if (pathname === '/api/messages' && req.method === 'GET') {
    setHeaders();
    const all = messages.slice(-1000);
    res.writeHead(200); res.end(JSON.stringify({ success: true, messages: all }));
    return;
  }

  // ======== 收藏 ========
  if (pathname === '/api/favorites' && req.method === 'GET') {
    setHeaders();
    const username = parsed.query.username;
    const favIds = favorites[username] || [];
    const favMsgs = messages.filter(m => favIds.includes(m.msgId));
    res.writeHead(200); res.end(JSON.stringify({ success: true, favorites: favMsgs, favIds }));
    return;
  }

  if (pathname === '/api/toggle-favorite' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
      try {
        const { username, msgId } = JSON.parse(body);
        if (!favorites[username]) favorites[username] = [];
        const idx = favorites[username].indexOf(msgId);
        idx > -1 ? favorites[username].splice(idx, 1) : favorites[username].push(msgId);
        saveJSON(FAVORITES_FILE, favorites);
        res.writeHead(200); res.end(JSON.stringify({ success: true, isFavorited: idx === -1, favIds: favorites[username] }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // ======== 撤回 ========
  if (pathname === '/api/recall-message' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
      try {
        const { msgId, username } = JSON.parse(body);
        const msg = messages.find(m => m.msgId === msgId);
        if (!msg) { res.writeHead(404); return res.end(JSON.stringify({ success: false })); }
        if (msg.senderUsername !== username) { res.writeHead(403); return res.end(JSON.stringify({ success: false })); }
        if (Date.now() - msg.timestamp > 120000) { res.writeHead(400); return res.end(JSON.stringify({ success: false })); }
        msg.recalled = true; msg.text = '[消息已撤回]'; msg.imageUrl = null; msg.videoUrl = null; msg.audioUrl = null;
        saveJSON(MESSAGES_FILE, messages);
        broadcastAll({ type: 'message-recalled', msgId });
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // ======== 帖子列表 ========
  if (pathname === '/api/posts' && req.method === 'GET') {
    setHeaders();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, posts }));
    return;
  }

  // ======== 保存帖子 ========
  if (pathname === '/api/save-posts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setHeaders();
      try {
        const data = JSON.parse(body);
        if (data.posts) posts = data.posts;
        saveJSON(POSTS_FILE, posts);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // ======== 静态文件 ========
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mimes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = mimes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

// ==================== WebSocket ====================
const wss = new WebSocket.Server({ server, maxPayload: 100 * 1024 * 1024 });

wss.on('connection', (ws) => {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
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
        updateIntimacy(client.username, data.mentions);
        if (messages.length % 10 === 0) saveJSON(MESSAGES_FILE, messages);
        break;
      }

      case 'image': {
        if (!data.image) return;
        const msg = { type: 'message', msgId: data.msgId || getMsgId(), imageUrl: 'data:image/jpeg;base64,' + data.image, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false, fileSize: Math.round(data.image.length * 0.75 / 1024) };
        messages.push(msg);
        broadcastAll(msg);
        saveJSON(MESSAGES_FILE, messages);
        break;
      }

      case 'video': {
        if (!data.video) return;
        const msg = { type: 'message', msgId: data.msgId || getMsgId(), videoUrl: data.video, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false, fileSize: Math.round(data.video.length * 0.75 / (1024 * 1024) * 10) / 10 };
        messages.push(msg);
        broadcastAll(msg);
        saveJSON(MESSAGES_FILE, messages);
        break;
      }

      case 'audio': {
        if (!data.audio) return;
        const msg = { type: 'message', msgId: getMsgId(), audioUrl: 'data:audio/webm;base64,' + data.audio, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false, fileSize: Math.round(data.audio.length * 0.75 / 1024) };
        messages.push(msg);
        broadcastAll(msg);
        saveJSON(MESSAGES_FILE, messages);
        break;
      }

      case 'update-profile':
        if (client.username && users[client.username]) {
          if (data.nickname !== undefined) { users[client.username].nickname = data.nickname; client.nickname = data.nickname; }
          if (data.avatar !== undefined) { users[client.username].avatar = data.avatar; client.avatar = data.avatar; }
          if (data.avatarType !== undefined) { users[client.username].avatarType = data.avatarType; client.avatarType = data.avatarType; }
          if (data.signature !== undefined) users[client.username].signature = data.signature;
          saveJSON(USERS_FILE, users);
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
    saveJSON(MESSAGES_FILE, messages);
    saveJSON(POSTS_FILE, posts);
  });

  ws.on('error', () => {
    onlineClients.delete(id);
    broadcastOnlineUsers();
  });
});

setInterval(() => {
  saveJSON(MESSAGES_FILE, messages);
  saveJSON(POSTS_FILE, posts);
}, 15000);

server.listen(PORT, () => {
  console.log(`\n🌿 青蓝社区已启动`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`👥 ${Object.keys(users).length} 用户 | 💬 ${messages.length} 消息 | 📝 ${posts.length} 帖子\n`);
});