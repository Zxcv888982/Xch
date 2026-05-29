const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'blueflow_secret_key_2025';
const TOKEN_EXPIRE = '30d';

const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

let users = {};
let posts = [];
let favorites = {};

function loadJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch(e) {}
  return fallback;
}
users = loadJSON(USERS_FILE, {});
posts = loadJSON(POSTS_FILE, []);
favorites = loadJSON(FAVORITES_FILE, {});

function saveJSON(file, data) { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch(e) {} }

// ==================== JWT 工具 ====================
function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRE });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch(e) { return null; }
}
async function hashPassword(pwd) {
  return bcrypt.hashSync(pwd, 10);
}
function checkPassword(pwd, hash) {
  return bcrypt.compareSync(pwd, hash);
}

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
    let body = ''; req.on('data', c => body += c); req.on('end', async () => {
      setHeaders();
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '请填写完整' })); }
        if (username.length < 2 || username.length > 20) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名2-20个字符' })); }
        if (password.length < 4) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '密码至少4个字符' })); }
        if (users[username]) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名已存在' })); }
        const hashed = await hashPassword(password);
        users[username] = { password: hashed, nickname: (nickname || username).substring(0, 15), avatar: '3b82f6', avatarType: 'color', signature: '' };
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
        if (!user || !checkPassword(password, user.password)) { res.writeHead(401); return res.end(JSON.stringify({ success: false, message: '用户名或密码错误' })); }
        const token = generateToken(username);
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
        const payload = verifyToken(JSON.parse(body).token);
        if (!payload) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        const user = users[payload.username];
        if (!user) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: { username: payload.username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'color' } }));
      } catch(e) { res.writeHead(401); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 更新资料
  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const { username, avatar, avatarType, signature } = JSON.parse(body);
        if (users[username]) {
          if (avatar) users[username].avatar = avatar;
          if (avatarType) users[username].avatarType = avatarType;
          if (signature !== undefined) users[username].signature = signature;
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
    res.writeHead(200); res.end(JSON.stringify({ success: true, count: wss.clients.size }));
    return;
  }

  // 帖子（分页）
  if (pathname === '/api/posts' && req.method === 'GET') {
    setHeaders();
    const page = parseInt(parsed.query.page) || 1;
    const limit = Math.min(parseInt(parsed.query.limit) || 15, 30);
    const sorted = [...posts].sort((a, b) => b.timestamp - a.timestamp);
    const start = (page - 1) * limit;
    const result = sorted.slice(start, start + limit);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, posts: result, hasMore: start + limit < sorted.length }));
    return;
  }

  // 保存帖子
  if (pathname === '/api/save-posts' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try { const d = JSON.parse(body); if (d.posts) posts = d.posts; saveJSON(POSTS_FILE, posts); res.writeHead(200); res.end(JSON.stringify({ success: true })); } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 收藏
  if (pathname === '/api/favorites' && req.method === 'GET') {
    setHeaders();
    res.writeHead(200); res.end(JSON.stringify({ success: true, favIds: favorites[parsed.query.username] || [] }));
    return;
  }

  if (pathname === '/api/toggle-favorite' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      setHeaders();
      try {
        const { username, msgId } = JSON.parse(body);
        if (!favorites[username]) favorites[username] = [];
        const i = favorites[username].indexOf(msgId);
        i > -1 ? favorites[username].splice(i, 1) : favorites[username].push(msgId);
        saveJSON(FAVORITES_FILE, favorites);
        res.writeHead(200); res.end(JSON.stringify({ success: true, favIds: favorites[username] }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 静态文件
  let fp = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(fp).toLowerCase();
  const ct = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'text/plain';
  fs.readFile(fp, (err, c) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': ct }); res.end(c);
  });
});

// ==================== WebSocket（带鉴权） ====================
const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 });
const onlineClients = new Map();

function broadcastAll(data) {
  const m = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(m); });
}

function sendToUser(username, data) {
  for (const [, c] of onlineClients) {
    if (c.username === username && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  onlineClients.set(id, { ws, username: null, nickname: '游客' });
  let authTimeout = setTimeout(() => { ws.close(); }, 10000);

  ws.send(JSON.stringify({ type: 'welcome', clientId: id }));

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch(e) { return; }
    const client = onlineClients.get(id);
    if (!client) return;

    switch(data.type) {
      case 'login':
        // WebSocket 登录鉴权
        if (data.token) {
          const payload = verifyToken(data.token);
          if (payload && users[payload.username]) {
            clearTimeout(authTimeout);
            const u = users[payload.username];
            client.username = payload.username;
            client.nickname = u.nickname;
            client.avatar = u.avatar;
            client.avatarType = u.avatarType || 'color';
            ws.send(JSON.stringify({ type: 'login_success', username: payload.username, nickname: u.nickname, avatar: u.avatar, avatarType: u.avatarType || 'color', clientId: id }));
            broadcastAll({ type: 'onlineCount', count: wss.clients.size });
          } else {
            ws.send(JSON.stringify({ type: 'auth_fail' }));
            ws.close();
          }
        } else {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
          ws.close();
        }
        break;

      case 'new-post':
        if (!client.username) return;
        broadcastAll({ type: 'new-post-notify', postId: data.postId, nickname: client.nickname });
        break;

      case 'like-post':
        if (!client.username) return;
        sendToUser(data.targetUser, { type: 'like-notify', fromUser: client.nickname, postId: data.postId });
        broadcastAll({ type: 'like-update', postId: data.postId, likes: data.likes });
        break;

      case 'comment-post':
        if (!client.username) return;
        sendToUser(data.targetUser, { type: 'comment-notify', fromUser: client.nickname, postId: data.postId, text: (data.text || '').substring(0, 40) });
        broadcastAll({ type: 'comment-update', postId: data.postId, commentCount: data.commentCount });
        break;

      case 'update-profile':
        if (client.username && users[client.username]) {
          if (data.avatar) { users[client.username].avatar = data.avatar; client.avatar = data.avatar; }
          if (data.avatarType) { users[client.username].avatarType = data.avatarType; client.avatarType = data.avatarType; }
          saveJSON(USERS_FILE, users);
        }
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    onlineClients.delete(id);
    broadcastAll({ type: 'onlineCount', count: wss.clients.size });
  });
});

server.listen(PORT, () => console.log(`🌿 蓝社启动: http://localhost:${PORT}`));