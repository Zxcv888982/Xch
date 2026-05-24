const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ==================== 数据持久化 ====================
const USERS_FILE = './users.json';
const MESSAGES_FILE = './messages.json';

let users = {};
let messages = [];

try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }
} catch (e) {
  console.log('用户数据加载失败');
}

try {
  if (fs.existsSync(MESSAGES_FILE)) {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    if (!Array.isArray(messages)) messages = [];
    if (messages.length > 500) messages = messages.slice(messages.length - 500);
  }
} catch (e) {
  messages = [];
}

function saveUsers() {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch(e) {}
}

function saveMessages() {
  try {
    if (messages.length > 500) messages = messages.slice(messages.length - 500);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch(e) {}
}

// ==================== HTTP 服务器 ====================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  const setJsonHeaders = () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
  };

  if (req.method === 'OPTIONS') {
    setJsonHeaders();
    res.writeHead(200);
    res.end();
    return;
  }

  // 注册
  if (pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, password, nickname } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, message: '用户名和密码不能为空' }));
        }
        if (users[username]) {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, message: '用户名已存在' }));
        }
        users[username] = {
          password,
          nickname: nickname || username,
          avatar: '😀',
          avatarType: 'emoji'
        };
        saveUsers();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: '注册成功' }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== password) {
          res.writeHead(401);
          return res.end(JSON.stringify({ success: false, message: '用户名或密码错误' }));
        }
        const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          token,
          user: {
            username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji'
          }
        }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // 自动登录
  if (pathname === '/api/auto-login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { token } = JSON.parse(body);
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const username = decoded.split(':')[0];
        const user = users[username];
        if (!user) {
          res.writeHead(401);
          return res.end(JSON.stringify({ success: false }));
        }
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          user: {
            username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji'
          }
        }));
      } catch(e) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // 更新资料
  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
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
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // 获取在线用户
  if (pathname === '/api/online-users' && req.method === 'GET') {
    setJsonHeaders();
    const onlineList = [];
    onlineClients.forEach(client => {
      if (client.username) {
        onlineList.push({
          username: client.username,
          nickname: client.nickname,
          avatar: client.avatar,
          avatarType: client.avatarType
        });
      }
    });
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, users: onlineList }));
    return;
  }

  // 获取历史消息
  if (pathname === '/api/messages' && req.method === 'GET') {
    setJsonHeaders();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, messages }));
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
  };
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync('./index.html', 'utf-8'));
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// ==================== WebSocket ====================
const wss = new WebSocket.Server({ server });
const onlineClients = new Map();

function getClientId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function updateUserCount() {
  broadcastAll({ type: 'userCount', count: wss.clients.size });
}

wss.on('connection', (ws) => {
  const id = getClientId();
  onlineClients.set(id, {
    ws,
    username: null,
    nickname: '游客',
    avatar: '😀',
    avatarType: 'emoji'
  });

  ws.send(JSON.stringify({ type: 'welcome', clientId: id }));
  updateUserCount();

  ws.on('message', (rawData) => {
    let data;
    try { data = JSON.parse(rawData); } catch(e) { return; }

    const client = onlineClients.get(id);
    if (!client) return;

    switch(data.type) {
      case 'login':
        if (data.username && users[data.username]) {
          const user = users[data.username];
          client.username = data.username;
          client.nickname = user.nickname;
          client.avatar = user.avatar;
          client.avatarType = user.avatarType || 'emoji';
          ws.send(JSON.stringify({
            type: 'login_success',
            username: data.username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji',
            clientId: id
          }));
          broadcastAll({ type: 'system', text: `👋 ${user.nickname} 上线了` });
          updateUserCount();
        }
        break;

      case 'message':
        if (!data.text || !data.text.trim()) return;
        const msgData = {
          type: 'message',
          text: data.text.trim(),
          sender: client.nickname,
          senderUsername: client.username,
          avatar: client.avatar,
          avatarType: client.avatarType,
          timestamp: Date.now(),
          clientId: id
        };
        messages.push(msgData);
        if (messages.length % 10 === 0) saveMessages();
        broadcastAll(msgData);
        break;

      case 'image':
        if (!data.image) return;
        const imgData = {
          type: 'message',
          imageUrl: 'data:image/png;base64,' + data.image,
          sender: client.nickname,
          senderUsername: client.username,
          avatar: client.avatar,
          avatarType: client.avatarType,
          timestamp: Date.now(),
          clientId: id
        };
        messages.push(imgData);
        if (messages.length % 10 === 0) saveMessages();
        broadcastAll(imgData);
        break;

      case 'audio':
        if (!data.audio) return;
        const audioData = {
          type: 'message',
          audioUrl: 'data:audio/webm;base64,' + data.audio,
          sender: client.nickname,
          senderUsername: client.username,
          avatar: client.avatar,
          avatarType: client.avatarType,
          timestamp: Date.now(),
          clientId: id
        };
        messages.push(audioData);
        if (messages.length % 10 === 0) saveMessages();
        broadcastAll(audioData);
        break;

      case 'update-profile':
        if (client.username && users[client.username]) {
          if (data.nickname) {
            users[client.username].nickname = data.nickname;
            client.nickname = data.nickname;
          }
          if (data.avatar) {
            users[client.username].avatar = data.avatar;
            client.avatar = data.avatar;
          }
          if (data.avatarType) {
            users[client.username].avatarType = data.avatarType;
            client.avatarType = data.avatarType;
          }
          saveUsers();
          ws.send(JSON.stringify({
            type: 'profile_updated',
            nickname: client.nickname,
            avatar: client.avatar,
            avatarType: client.avatarType
          }));
        }
        break;
    }
  });

  ws.on('close', () => {
    const client = onlineClients.get(id);
    if (client && client.username) {
      broadcastAll({ type: 'system', text: `👋 ${client.nickname} 离开了聊天室` });
    }
    onlineClients.delete(id);
    updateUserCount();
    saveMessages();
  });

  ws.on('error', () => {
    onlineClients.delete(id);
    updateUserCount();
  });
});

setInterval(() => saveMessages(), 30000);

server.listen(PORT, () => {
  console.log(`🌐 聊天室: http://localhost:${PORT}`);
  console.log(`👥 用户: ${Object.keys(users).length} | 💬 消息: ${messages.length}`);
});