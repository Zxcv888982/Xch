const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const USERS_FILE = './users.json';
const MESSAGES_FILE = './messages.json';

let users = {};
let messages = [];

try { if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch(e) {}
try {
  if (fs.existsSync(MESSAGES_FILE)) {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    if (!Array.isArray(messages)) messages = [];
    if (messages.length > 1000) messages = messages.slice(-1000);
  }
} catch(e) { messages = []; }

function saveUsers() { try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch(e) {} }
function saveMessages() {
  try {
    if (messages.length > 1000) messages = messages.slice(-1000);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch(e) {}
}

let msgCounter = 0;
function getMsgId() { msgCounter++; return `${Date.now().toString(36)}_${msgCounter}`; }

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const setJsonHeaders = () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };
  if (req.method === 'OPTIONS') { setJsonHeaders(); res.writeHead(200); return res.end(); }

  // 注册
  if (pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名和密码不能为空' })); }
        if (users[username]) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '用户名已存在' })); }
        users[username] = { password, nickname: nickname || username, avatar: '😀', avatarType: 'emoji' };
        saveUsers();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: '注册成功' }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== password) { res.writeHead(401); return res.end(JSON.stringify({ success: false, message: '用户名或密码错误' })); }
        const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, token, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji' } }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 自动登录
  if (pathname === '/api/auto-login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { token } = JSON.parse(body);
        const username = Buffer.from(token, 'base64').toString('utf-8').split(':')[0];
        const user = users[username];
        if (!user) { res.writeHead(401); return res.end(JSON.stringify({ success: false })); }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: { username, nickname: user.nickname, avatar: user.avatar, avatarType: user.avatarType || 'emoji' } }));
      } catch(e) { res.writeHead(401); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 更新资料
  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, nickname, avatar, avatarType } = JSON.parse(body);
        if (users[username]) {
          if (nickname) users[username].nickname = nickname;
          if (avatar) users[username].avatar = avatar;
          if (avatarType) users[username].avatarType = avatarType;
          saveUsers();
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 在线用户
  if (pathname === '/api/online-users' && req.method === 'GET') {
    setJsonHeaders();
    const list = [];
    onlineClients.forEach(c => { if (c.username) list.push({ username: c.username, nickname: c.nickname, avatar: c.avatar, avatarType: c.avatarType }); });
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, users: list, count: wss.clients.size }));
    return;
  }

  // 消息列表（分页）
  if (pathname === '/api/messages' && req.method === 'GET') {
    setJsonHeaders();
    const before = parseInt(parsedUrl.query.before) || Date.now();
    const limit = Math.min(parseInt(parsedUrl.query.limit) || 50, 100);
    // 找到 before 之前的消息
    let result = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].timestamp < before) {
        result.unshift(messages[i]);
        if (result.length >= limit) break;
      }
    }
    const hasMore = result.length === limit && messages.length > limit;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, messages: result, hasMore }));
    return;
  }

  // 静态文件
  let filePath = '.' + pathname;
  if (filePath === './') filePath = './index.html';
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[extname] || 'application/octet-stream';
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end(error.code === 'ENOENT' ? '404 Not Found' : 'Server Error');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });
const onlineClients = new Map();

function getClientId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function broadcastOnlineUsers() {
  const list = [];
  onlineClients.forEach(c => {
    if (c.username) list.push({ username: c.username, nickname: c.nickname, avatar: c.avatar, avatarType: c.avatarType });
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
          ws.send(JSON.stringify({ type: 'login_success', username: data.username, nickname: u.nickname, avatar: u.avatar, avatarType: u.avatarType || 'emoji', clientId: id }));
          broadcastAll({ type: 'system', text: `👋 ${u.nickname} 上线了` });
          broadcastOnlineUsers();
        }
        break;

      case 'message': {
        if (!data.text?.trim()) return;
        const txtMsg = { type: 'message', msgId: getMsgId(), text: data.text.trim(), sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, mentions: data.mentions || [] };
        messages.push(txtMsg);
        broadcastAll(txtMsg);
        if (messages.length % 10 === 0) saveMessages();
        break;
      }

      case 'image': {
        if (!data.image) return;
        const imgMsg = { type: 'message', msgId: getMsgId(), imageUrl: 'data:image/png;base64,' + data.image, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id };
        messages.push(imgMsg);
        broadcastAll(imgMsg);
        if (messages.length % 10 === 0) saveMessages();
        break;
      }

      case 'audio': {
        if (!data.audio) return;
        const audMsg = { type: 'message', msgId: getMsgId(), audioUrl: 'data:audio/webm;base64,' + data.audio, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id };
        messages.push(audMsg);
        broadcastAll(audMsg);
        if (messages.length % 10 === 0) saveMessages();
        break;
      }

      case 'update-profile':
        if (client.username && users[client.username]) {
          if (data.nickname) { users[client.username].nickname = data.nickname; client.nickname = data.nickname; }
          if (data.avatar) { users[client.username].avatar = data.avatar; client.avatar = data.avatar; }
          if (data.avatarType) { users[client.username].avatarType = data.avatarType; client.avatarType = data.avatarType; }
          saveUsers();
          ws.send(JSON.stringify({ type: 'profile_updated', nickname: client.nickname, avatar: client.avatar, avatarType: client.avatarType }));
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
    saveMessages();
  });
  ws.on('error', () => { onlineClients.delete(id); broadcastOnlineUsers(); });
});

setInterval(() => saveMessages(), 30000);
server.listen(PORT, () => console.log(`🌐 聊天室: http://localhost:${PORT}`));