const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

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

function loadJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch(e) {}
  return fallback;
}

users = loadJSON(USERS_FILE, {});
messages = loadJSON(MESSAGES_FILE, []);
favorites = loadJSON(FAVORITES_FILE, {});
posts = loadJSON(POSTS_FILE, []);

function saveJSON(file, data) { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch(e) {} }

// ==================== HTTP ====================
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const setHeaders = () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };
  if (req.method === 'OPTIONS') { setHeaders(); res.writeHead(200); res.end(); return; }

  // 注册
  if (pathname === '/api/register' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400); return res.end(JSON.stringify({ success: false })); }
        if (users[username]) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名已存在' })); }
        users[username] = { password, nickname: nickname || username, avatar: '3b82f6', avatarType: 'color', signature: '' };
        saveJSON(USERS_FILE, users);
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== password) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, token, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'color' } }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 自动登录
  if (pathname === '/api/auto-login' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const username = Buffer.from(JSON.parse(body).token, 'base64').toString('utf-8').split(':')[0];
        const user = users[username];
        if (!user) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'color' } }));
      } catch(e) { res.writeHead(401); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 更新资料
  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const { username, nickname, avatar, avatarType } = JSON.parse(body);
        if (users[username]) {
          if (nickname !== undefined) users[username].nickname = nickname;
          if (avatar !== undefined) users[username].avatar = avatar;
          if (avatarType !== undefined) users[username].avatarType = avatarType;
          saveJSON(USERS_FILE, users);
        }
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 在线用户
  if (pathname === '/api/online-users' && req.method === 'GET') {
    setHeaders();
    const list = [];
    onlineClients.forEach(c => { if (c.username) list.push({ username: c.username, nickname: c.nickname }); });
    res.writeHead(200); res.end(JSON.stringify({ success: true, users: list, count: wss.clients.size }));
    return;
  }

  // 帖子列表（分页）
  if (pathname === '/api/posts' && req.method === 'GET') {
    setHeaders();
    const page = parseInt(parsed.query.page) || 1;
    const limit = Math.min(parseInt(parsed.query.limit) || 20, 50);
    const sorted = [...posts].sort((a, b) => b.timestamp - a.timestamp);
    const start = (page - 1) * limit;
    const result = sorted.slice(start, start + limit);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, posts: result, hasMore: start + limit < sorted.length, total: posts.length }));
    return;
  }

  // 保存帖子
  if (pathname === '/api/save-posts' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const data = JSON.parse(body);
        if (data.posts) posts = data.posts;
        saveJSON(POSTS_FILE, posts);
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 收藏
  if (pathname === '/api/favorites' && req.method === 'GET') {
    setHeaders();
    const username = parsed.query.username;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, favIds: favorites[username] || [] }));
    return;
  }

  // 收藏切换
  if (pathname === '/api/toggle-favorite' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const { username, msgId } = JSON.parse(body);
        if (!favorites[username]) favorites[username] = [];
        const idx = favorites[username].indexOf(msgId);
        idx > -1 ? favorites[username].splice(idx, 1) : favorites[username].push(msgId);
        saveJSON(FAVORITES_FILE, favorites);
        res.writeHead(200); res.end(JSON.stringify({ success: true, favIds: favorites[username] }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 静态文件
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mimes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const ct = mimes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': ct }); res.end(content);
  });
});

// ==================== WebSocket ====================
const wss = new WebSocket.Server({ server, maxPayload: 100 * 1024 * 1024 });
const onlineClients = new Map();

function broadcast(data, excludeId) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      const entry = [...onlineClients.entries()].find(([, v]) => v.ws === c);
      if (!excludeId || (entry && entry[0] !== excludeId)) c.send(msg);
    }
  });
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// 发送给特定用户
function sendToUser(username, data) {
  for (const [, client] of onlineClients) {
    if (client.username === username && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }
}

wss.on('connection', (ws) => {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  onlineClients.set(id, { ws, username: null, nickname: '游客', avatar: '3b82f6', avatarType: 'color' });
  ws.send(JSON.stringify({ type: 'welcome', clientId: id }));
  broadcastAll({ type: 'onlineCount', count: wss.clients.size });

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
          client.avatarType = u.avatarType || 'color';
          ws.send(JSON.stringify({ type: 'login_success', username: data.username, nickname: u.nickname, avatar: u.avatar, avatarType: u.avatarType || 'color', clientId: id }));
          broadcastAll({ type: 'onlineCount', count: wss.clients.size });
        }
        break;

      // 新帖子通知
      case 'new-post':
        broadcastAll({
          type: 'new-post-notify',
          postId: data.postId,
          nickname: client.nickname,
          text: (data.text || '').substring(0, 50)
        });
        break;

      // 点赞通知
      case 'like-post':
        sendToUser(data.targetUser, {
          type: 'like-notify',
          fromUser: client.nickname,
          postId: data.postId
        });
        broadcastAll({
          type: 'like-update',
          postId: data.postId,
          likes: data.likes
        });
        break;

      // 评论通知
      case 'comment-post':
        sendToUser(data.targetUser, {
          type: 'comment-notify',
          fromUser: client.nickname,
          postId: data.postId,
          text: (data.text || '').substring(0, 40)
        });
        broadcastAll({
          type: 'comment-update',
          postId: data.postId,
          commentCount: data.commentCount
        });
        break;

      case 'update-profile':
        if (client.username && users[client.username]) {
          if (data.avatar !== undefined) users[client.username].avatar = data.avatar;
          if (data.avatarType !== undefined) users[client.username].avatarType = data.avatarType;
          client.avatar = data.avatar || client.avatar;
          client.avatarType = data.avatarType || client.avatarType;
          saveJSON(USERS_FILE, users);
        }
        break;
    }
  });

  ws.on('close', () => {
    onlineClients.delete(id);
    broadcastAll({ type: 'onlineCount', count: wss.clients.size });
  });
});

server.listen(PORT, () => console.log(`🌿 蓝社启动: http://localhost:${PORT}`));