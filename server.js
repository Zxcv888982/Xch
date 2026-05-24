const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// 创建HTTP服务器，用于提供HTML页面
const server = http.createServer((req, res) => {
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('404 Not Found');
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

// 绑定WebSocket到HTTP服务器
const wss = new WebSocket.Server({ server });

let clients = new Map(); // 存储客户端信息: clientId -> { ws, nickname }

function getClientId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function broadcast(data, excludeWs = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(message);
    }
  });
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
  const clientInfo = { ws, nickname: '游客' };
  clients.set(id, clientInfo);

  // 发送欢迎信息和clientId
  ws.send(JSON.stringify({
    type: 'welcome',
    text: '🎉 你已加入聊天室',
    clientId: id
  }));

  // 通知其他人新用户加入
  broadcast({
    type: 'system',
    text: '一位新朋友进入了房间'
  }, ws);

  updateUserCount();

  ws.on('message', (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch (e) {
      return;
    }

    const clientEntry = clients.get(id);
    if (!clientEntry) return;

    switch (data.type) {
      case 'message':
        const messageText = data.text?.trim();
        if (!messageText) return;
        
        const senderNick = clientEntry.nickname || '匿名';
        const broadcastMsg = {
          type: 'message',
          text: messageText,
          sender: senderNick,
          timestamp: Date.now(),
          clientId: id
        };
        // 广播给所有客户端（包括自己）
        broadcastAll(broadcastMsg);
        break;

      case 'nickname':
        const newNick = (data.nickname || '游客').trim().substring(0, 15) || '游客';
        const oldNick = clientEntry.nickname;
        clientEntry.nickname = newNick;
        
        // 通知昵称变更
        if (oldNick !== newNick) {
          broadcastAll({
            type: 'system',
            text: `"${oldNick}" 改名为 "${newNick}"`
          });
        }
        break;

      case 'join':
        if (data.nickname) {
          clientEntry.nickname = data.nickname.trim().substring(0, 15) || '游客';
        }
        break;
        
      default:
        break;
    }
  });

  ws.on('close', () => {
    const leavingNick = clients.get(id)?.nickname || '某人';
    clients.delete(id);
    broadcast({
      type: 'system',
      text: `"${leavingNick}" 离开了聊天室`
    });
    updateUserCount();
  });

  ws.on('error', () => {
    clients.delete(id);
    updateUserCount();
  });
});

server.listen(PORT, () => {
  console.log(`🌐 聊天室服务器启动: http://localhost:${PORT}`);
  console.log(`📡 WebSocket 已就绪`);
});
