const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// 数据目录
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'uploads'))) fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

let users = {};
let messages = [];
let favorites = {}; // { username: [msgId, ...] }

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
function saveMessages() {
  try {
    cleanOldMessages();
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch(e) {}
}
function saveFavorites() { try { fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2)); } catch(e) {} }

function cleanOldMessages() {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  // 文字消息保留1000条，图片/视频保留7天
  messages = messages.filter(msg => {
    if (msg.type === 'message' && (msg.imageUrl || msg.videoUrl)) {
      return (now - msg.timestamp) < sevenDays;
    }
    return true;
  });
  // 保留最新1000条
  const textMsgs = messages.filter(m => !m.imageUrl && !m.videoUrl);
  const mediaMsgs = messages.filter(m => m.imageUrl || m.videoUrl);
  if (textMsgs.length > 1000) {
    const toRemove = textMsgs.slice(0, textMsgs.length - 1000);
    toRemove.forEach(m => {
      const idx = messages.indexOf(m);
      if (idx > -1) messages.splice(idx, 1);
    });
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

  // 消息列表（一次加载全部，最多1000条）
  if (pathname === '/api/messages' && req.method === 'GET') {
    setJsonHeaders();
    const all = messages.slice(-1000);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, messages: all }));
    return;
  }

  // 收藏列表
  if (pathname === '/api/favorites' && req.method === 'GET') {
    setJsonHeaders();
    const username = parsedUrl.query.username;
    const userFavs = username ? (favorites[username] || []) : [];
    const favMsgs = messages.filter(m => userFavs.includes(m.msgId));
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, favorites: favMsgs, favIds: userFavs }));
    return;
  }

  // 切换收藏
  if (pathname === '/api/toggle-favorite' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, msgId } = JSON.parse(body);
        if (!favorites[username]) favorites[username] = [];
        const idx = favorites[username].indexOf(msgId);
        if (idx > -1) { favorites[username].splice(idx, 1); }
        else { favorites[username].push(msgId); }
        saveFavorites();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, isFavorited: idx === -1, favIds: favorites[username] }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 撤回消息
  if (pathname === '/api/recall-message' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { msgId, username } = JSON.parse(body);
        const msg = messages.find(m => m.msgId === msgId);
        if (!msg) { res.writeHead(404); return res.end(JSON.stringify({ success: false, message: '消息不存在' })); }
        if (msg.senderUsername !== username) { res.writeHead(403); return res.end(JSON.stringify({ success: false, message: '只能撤回自己的消息' })); }
        if (Date.now() - msg.timestamp > 120000) { res.writeHead(400); return res.end(JSON.stringify({ success: false, message: '只能撤回2分钟内的消息' })); }
        msg.recalled = true;
        msg.text = '[消息已撤回]';
        msg.imageUrl = null;
        msg.videoUrl = null;
        msg.audioUrl = null;
        saveMessages();
        broadcastAll({ type: 'message-recalled', msgId });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ success: false })); }
    });
    return;
  }

  // 上传视频
  if (pathname === '/api/upload-video' && req.method === 'POST') {
    let chunks = [];
    let filename = '';
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const boundary = req.headers['content-type']?.split('boundary=')[1];
      if (!boundary) { res.writeHead(400); return res.end('No boundary'); }
      
      const str = buffer.toString();
      const parts = str.split('--' + boundary);
      
      for (const part of parts) {
        if (part.includes('filename=')) {
          const nameMatch = part.match(/filename="(.+?)"/);
          if (nameMatch) {
            filename = Date.now() + '_' + nameMatch[1];
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd > -1) {
              const fileData = part.substring(headerEnd + 4);
              const cleanData = fileData.endsWith('\r\n') ? fileData.substring(0, fileData.length - 2) : fileData;
              fs.writeFileSync(path.join(DATA_DIR, 'uploads', filename), Buffer.from(cleanData, 'binary'));
            }
          }
        }
      }
      
      setJsonHeaders();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, filename }));
    });
    return;
  }

  // 静态文件（包括上传的视频）
  if (pathname.startsWith('/uploads/')) {
    const filePath = path.join(DATA_DIR, pathname);
    fs.readFile(filePath, (error, content) => {
      if (error) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(filePath).toLowerCase();
      const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
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
    if (error) { res.writeHead(404); res.end('404 Not Found'); }
    else { res.writeHead(200, { 'Content-Type': contentType }); res.end(content, 'utf-8'); }
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
  onlineClients.forEach(c => { if (c.username) list.push({ username: c.username, nickname: c.nickname, avatar: c.avatar, avatarType: c.avatarType }); });
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
        const txtMsg = { type: 'message', msgId: getMsgId(), text: data.text.trim(), sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, mentions: data.mentions || [], recalled: false };
        messages.push(txtMsg);
        broadcastAll(txtMsg);
        saveMessages();
        break;
      }

      case 'image': {
        if (!data.image) return;
        const imgMsg = { type: 'message', msgId: getMsgId(), imageUrl: 'data:image/png;base64,' + data.image, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false };
        messages.push(imgMsg);
        broadcastAll(imgMsg);
        saveMessages();
        break;
      }

      case 'audio': {
        if (!data.audio) return;
        const audMsg = { type: 'message', msgId: getMsgId(), audioUrl: 'data:audio/webm;base64,' + data.audio, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false };
        messages.push(audMsg);
        broadcastAll(audMsg);
        saveMessages();
        break;
      }

      case 'video': {
        if (!data.video) return;
        const vidMsg = { type: 'message', msgId: getMsgId(), videoUrl: data.video, sender: client.nickname, senderUsername: client.username, avatar: client.avatar, avatarType: client.avatarType, timestamp: Date.now(), clientId: id, recalled: false };
        messages.push(vidMsg);
        broadcastAll(vidMsg);
        saveMessages();
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
  });
  ws.on('error', () => { onlineClients.delete(id); broadcastOnlineUsers(); });
});

setInterval(() => saveMessages(), 30000);
server.listen(PORT, () => console.log(`🌐 聊天室: http://localhost:${PORT}`));