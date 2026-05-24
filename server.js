const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ==================== 数据持久化 ====================
const USERS_FILE = './users.json';
const MESSAGES_FILE = './messages.json';

let users = {};           // { username: { password, nickname, avatar, avatarType } }
let messages = [];        // [{ type, text, imageUrl, audioUrl, sender, avatar, avatarType, timestamp, clientId }]

// 加载用户数据
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }
} catch (e) {
  console.log('用户数据加载失败，使用空数据库');
}

// 加载历史消息（只保留最近 500 条）
try {
  if (fs.existsSync(MESSAGES_FILE)) {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
    if (!Array.isArray(messages)) messages = [];
    // 只保留最近 500 条
    if (messages.length > 500) {
      messages = messages.slice(messages.length - 500);
    }
  }
} catch (e) {
  console.log('消息数据加载失败，使用空列表');
  messages = [];
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('保存用户数据失败:', e.message);
  }
}

function saveMessages() {
  try {
    // 只保留最近 500 条
    if (messages.length > 500) {
      messages = messages.slice(messages.length - 500);
    }
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (e) {
    console.error('保存消息数据失败:', e.message);
  }
}

function addMessage(msg) {
  messages.push(msg);
  // 每 10 条消息保存一次，避免频繁写入
  if (messages.length % 10 === 0) {
    saveMessages();
  }
}

// ==================== HTTP 服务器 ====================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS 和 JSON 头
  const setJsonHeaders = () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  };

  if (req.method === 'OPTIONS') {
    setJsonHeaders();
    res.writeHead(200);
    res.end();
    return;
  }

  // ========== API 路由 ==========
  
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
        if (username.length < 3 || username.length > 20) {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, message: '用户名需要 3-20 个字符' }));
        }
        if (password.length < 4) {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, message: '密码至少 4 个字符' }));
        }
        if (users[username]) {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, message: '用户名已存在' }));
        }
        users[username] = {
          password: password,
          nickname: nickname || username,
          avatar: '😀',
          avatarType: 'emoji'
        };
        saveUsers();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: '注册成功' }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: '服务器错误' }));
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
        // 生成 token（简易版）
        const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: '登录成功',
          token: token,
          user: {
            username: username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji'
          }
        }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: '服务器错误' }));
      }
    });
    return;
  }

  // 自动登录（通过 token 验证）
  if (pathname === '/api/auto-login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { token } = JSON.parse(body);
        // 解码 token
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const username = decoded.split(':')[0];
        const user = users[username];
        if (!user) {
          res.writeHead(401);
          return res.end(JSON.stringify({ success: false, message: '用户不存在' }));
        }
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          user: {
            username: username,
            nickname: user.nickname,
            avatar: user.avatar,
            avatarType: user.avatarType || 'emoji'
          }
        }));
      } catch (e) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, message: 'Token 无效' }));
      }
    });
    return;
  }

  // 更新个人资料
  if (pathname === '/api/update-profile' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      setJsonHeaders();
      try {
        const { username, nickname, avatar, avatarType } = JSON.parse(body);
        if (!users[username]) {
          res.writeHead(404);
          return res.end(JSON.stringify({ success: false, message: '用户不存在' }));
        }
        if (nickname) users[username].nickname = nickname;
        if (avatar) users[username].avatar = avatar;
        if (avatarType) users[username].avatarType = avatarType;
        saveUsers();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: '资料更新成功' }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: '服务器错误' }));
      }
    });
    return;
  }

  // 获取历史消息
  if (pathname === '/api/messages' && req.method === 'GET') {
    setJsonHeaders();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, messages: messages }));
    return;
  }

  // ========== 静态文件服务 ==========
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
      if (error.code === 'ENOENT') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

// ==================== WebSocket 服务器 ====================
const wss = new WebSocket.Server({ server });

const onlineClients = new Map(); // clientId -> { ws, username, nickname, avatar, avatarType }

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

  ws.send(JSON.stringify({
    type: 'welcome',
    text: '🎉 欢迎来到公共聊天室',
    clientId: id
  }));

  updateUserCount();

  ws.on('message', (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch (e) {
      return;
    }

    const client = onlineClients.get(id);
    if (!client) return;

    switch (data.type) {
      case 'login':
        // WebSocket 登录绑定
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
            avatarType: user.avatarType || 'emoji'
          }));
        }
        break;

      case 'message':
        if (!data.text || !data.text.trim()) return;
        const textMsg = {
          type: 'message',
          text: data.text.trim(),
          sender: client.nickname,
          avatar: client.avatar,
          avatarType: client.avatarType,
          timestamp: Date.now(),
          clientId: id
        };
        addMessage(textMsg);
        broadcastAll(textMsg);
        break;

      case 'image':
        if (!data.image) return;
        const imgMsg = {
          type: 'message',
          imageUrl: 'data:image/png;base64,' + data.image,
          sender: client.nickname,
          avatar: client.avatar,
          avatarType: client.avatarType,
          timestamp: Date.now(),
          clientId: id
        };
        addMessage(imgMsg);
        broadcastAll(imgMsg);
        break;

      case 'audio':
        if (!data.audio) return;
        const audioMsg = {
          type: 'message',
          audioUrl: 'data:audio/webm;base64,' + data.audio,
          sender: client.nickname,
          avatar: client.avatar,
          avatarType: client.avatarType,
          timestamp: Date.now(),
          clientId: id
        };
        addMessage(audioMsg);
        broadcastAll(audioMsg);
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
      broadcastAll({
        type: 'system',
        text: `👋 ${client.nickname} 离开了聊天室`
      });
    }
    onlineClients.delete(id);
    updateUserCount();
    // 关闭连接时保存消息
    saveMessages();
  });

  ws.on('error', () => {
    onlineClients.delete(id);
    updateUserCount();
  });
});

// 定期保存消息（每 30 秒）
setInterval(() => {
  saveMessages();
}, 30000);

server.listen(PORT, () => {
  console.log(`🌐 聊天室已启动: http://localhost:${PORT}`);
  console.log(`👥 已加载 ${Object.keys(users).length} 个用户`);
  console.log(`💬 已加载 ${messages.length} 条历史消息`);
});