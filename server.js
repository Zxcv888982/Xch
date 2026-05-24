const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

let users = {};
let onlineUsers = new Map();

const USERS_FILE = './users.json';
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }
} catch (e) {
  console.log('用户数据加载失败，使用空数据库');
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('保存用户数据失败:', e.message);
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let filePath = '.' + parsedUrl.pathname;
  
  if (parsedUrl.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password, nickname, avatar } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '用户名和密码不能为空' }));
        }
        if (users[username]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '用户名已存在' }));
        }
        users[username] = {
          password: password,
          nickname: nickname || username,
          avatar: avatar || '😀',
          avatarType: 'emoji'
        };
        saveUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '注册成功' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: '服务器错误' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const user = users[username];
        if (!user || user.password !== password) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '用户名或密码错误' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: '登录成功',
          user: {
            username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji'
          }
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: '服务器错误' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/update-profile' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, nickname, avatar, avatarType } = JSON.parse(body);
        if (!users[username]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '用户不存在' }));
        }
        if (nickname) users[username].nickname = nickname;
        if (avatar) users[username].avatar = avatar;
        if (avatarType) users[username].avatarType = avatarType;
        saveUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '资料更新成功' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: '服务器错误' }));
      }
    });
    return;
  }

  if (filePath === './') filePath = './index.html';
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
  };
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync('./index.html', 'utf-8'));
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });

function getClientId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function broadcastAll(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  const id = getClientId();
  onlineUsers.set(id, { ws, username: null, nickname: '游客', avatar: '😀', avatarType: 'emoji' });

  ws.send(JSON.stringify({
    type: 'welcome',
    text: '🎉 请先登录或注册',
    clientId: id
  }));

  ws.on('message', (rawData) => {
    let data;
    try { data = JSON.parse(rawData); } catch (e) { return; }
    const userEntry = onlineUsers.get(id);
    if (!userEntry) return;

    switch (data.type) {
      case 'login':
        if (data.username && users[data.username]) {
          const user = users[data.username];
          userEntry.username = data.username;
          userEntry.nickname = user.nickname;
          userEntry.avatar = user.avatar;
          userEntry.avatarType = user.avatarType || 'emoji';
          ws.send(JSON.stringify({
            type: 'login_success',
            username: data.username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji'
          }));
          broadcastAll({ type: 'system', text: `👋 ${user.nickname} 上线了` });
        }
        break;

      case 'update-profile':
        if (userEntry.username && users[userEntry.username]) {
          if (data.nickname) {
            users[userEntry.username].nickname = data.nickname;
            userEntry.nickname = data.nickname;
          }
          if (data.avatar) {
            users[userEntry.username].avatar = data.avatar;
            userEntry.avatar = data.avatar;
          }
          if (data.avatarType) {
            users[userEntry.username].avatarType = data.avatarType;
            userEntry.avatarType = data.avatarType;
          }
          saveUsers();
          ws.send(JSON.stringify({
            type: 'profile_updated',
            nickname: userEntry.nickname,
            avatar: userEntry.avatar,
            avatarType: userEntry.avatarType
          }));
        }
        break;

      case 'message':
        if (!data.text?.trim()) return;
        broadcastAll({
          type: 'message',
          text: data.text.trim(),
          sender: userEntry.nickname || '匿名',
          avatar: userEntry.avatar || '😀',
          avatarType: userEntry.avatarType || 'emoji',
          timestamp: Date.now(),
          clientId: id
        });
        break;

      case 'image':
        if (data.image) {
          broadcastAll({
            type: 'message',
            imageUrl: 'data:image/png;base64,' + data.image,
            sender: userEntry.nickname || '匿名',
            avatar: userEntry.avatar || '😀',
            avatarType: userEntry.avatarType || 'emoji',
            timestamp: Date.now(),
            clientId: id
          });
        }
        break;

      case 'audio':
        if (data.audio) {
          broadcastAll({
            type: 'message',
            audioUrl: 'data:audio/webm;base64,' + data.audio,
            sender: userEntry.nickname || '匿名',
            avatar: userEntry.avatar || '😀',
            avatarType: userEntry.avatarType || 'emoji',
            timestamp: Date.now(),
            clientId: id
          });
        }
        break;
    }
  });

  ws.on('close', () => {
    const leavingNick = onlineUsers.get(id)?.nickname || '某人';
    onlineUsers.delete(id);
    broadcastAll({ type: 'system', text: `👋 ${leavingNick} 离开了聊天室` });
  });
});

server.listen(PORT, () => {
  console.log(`🌐 服务器启动: http://localhost:${PORT}`);
});
