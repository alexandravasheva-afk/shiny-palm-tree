import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Catch unhandled errors to prevent silent crashes in production
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const DB_PATH = path.join(process.cwd(), 'db.json');

async function startServer() {
  console.log('Starting safeMS Server (Local Persistence Mode)...');
  const app = express();
  
  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 50 * 1024 * 1024, // 50 MB limit for file transfers
  });

  const PORT = 3000;
  let dbLoaded = false;

  // In-memory store for users and messages
  interface Session {
    socketId: string;
    deviceModel: string;
    connectedAt: number;
  }
  
  interface ServerUser {
    id: string;
    username: string;
    displayName?: string;
    publicKey: string;
    passwordHash?: string;
    encryptedPrivateKey?: string;
    avatar?: string;
    role?: string;
    sessions: Session[];
    lastSeen: number;
  }

  interface Group {
    id: string;
    name: string;
    avatar?: string;
    adminId: string;
    members: string[]; // User IDs
    createdAt: number;
  }

  interface Message {
    id: string;
    senderId: string;
    receiverId: string;
    content?: string;
    encryptedContent?: string;
    timestamp: number;
    iv?: string;
    isGroup?: boolean;
    type?: string;
    fileName?: string;
    fileSize?: number;
  }
  
  const users = new Map<string, ServerUser>();
  const groups = new Map<string, Group>();
  const usernameToId = new Map<string, string>();
  const offlineMessages = new Map<string, Message[]>();
  const allMessages: Message[] = [];

  // Persistence logic
  const saveDB = () => {
    if (!dbLoaded) return;
    try {
      const data = {
        users: Array.from(users.values()).map(u => {
          const { sessions, ...rest } = u;
          return rest; // Don't save active sessions
        }),
        groups: Array.from(groups.values()),
        offlineMessages: Array.from(offlineMessages.entries()),
        messages: allMessages
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('Warning: Failed to save database (filesystem might be read-only):', e);
    }
  };

  const loadDB = () => {
    if (fs.existsSync(DB_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        if (data.users) {
          data.users.forEach((u: any) => {
            users.set(u.id, { ...u, sessions: [] });
            usernameToId.set(u.username, u.id);
          });
        }
        if (data.groups) {
          data.groups.forEach((g: any) => groups.set(g.id, g));
        }
        if (data.offlineMessages) {
          data.offlineMessages.forEach(([id, msgs]: [string, Message[]]) => offlineMessages.set(id, msgs));
        }
        if (data.messages) {
          allMessages.push(...data.messages);
        }
        dbLoaded = true;
        console.log(`Loaded data from db.json: ${users.size} users, ${groups.size} groups, ${allMessages.length} messages`);
      } catch (e) {
        console.error('Failed to load database:', e);
      }
    } else {
      dbLoaded = true;
    }
  };

  loadDB();
  
  // Pre-populate creator profile if not exists
  if (!users.has('admin')) {
    users.set('admin', {
      id: 'admin',
      username: 'admin',
      displayName: 'Creator',
      publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEzKn2k3Q0WT4034OIrj9F4isIC5e0PQNP2PfbYJMfFNXjJA3QtvO4qB4goyIy0wH+z5h7Ld8hpZFTNKffqT62eg==',
      passwordHash: 'db4b1a48b949625d13654c884f08b7c9798f70f676adbae8f81959958515cfd8',
      encryptedPrivateKey: '+Fq2o3vLtBLE/e7tREY81S/vpt+TLVPW70MIm4+My970QJOpRnmUaTU9a6eWpT9z0JqNIo7DW2fgVJsEZUCd4njgWh7vdS3M6+Dt3WJXFyFzSViFHhR3AZnBsHHJPC1+Rl6xOn6fcdFwRx+W0VyegPWHXXgEr9ATEUWHDXs9tuLh56JNX3DtEMJzZzk7GD71t5Q24d+m3Zrp81rez77q9pHeAR3udZrbfuIMVwDzAG71yUf62KXIfrY4RRIo5siR1yFoEaGVmHn6cDyDM6vhyfNAnNcM=',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=admin',
      sessions: [],
      lastSeen: Date.now(),
      role: 'admin'
    });
    usernameToId.set('admin', 'admin');
    saveDB();
  }
  
  // Bot management
  const botsDir = path.join(process.cwd(), 'bots');
  try {
    if (!fs.existsSync(botsDir)) {
      fs.mkdirSync(botsDir, { recursive: true });
    }
  } catch (e) {
    console.warn('Warning: Failed to create bots directory:', e);
  }
  const activeBots = new Map<string, ChildProcess>();

  const startBot = (botPath: string, botId: string) => {
    console.log(`Starting bot: ${botId} from ${botPath}`);
    const botProcess = spawn('python3', [botPath]);
    
    botProcess.stdout.on('data', (data) => {
      try {
        const output = data.toString().trim();
        if (output.startsWith('{')) {
          const command = JSON.parse(output);
          if (command.type === 'message') {
            if (command.groupId) {
              const group = groups.get(command.groupId);
              if (group) {
                const payload: Message = {
                  id: `bot-${Date.now()}`,
                  senderId: botId,
                  receiverId: command.groupId,
                  content: command.content,
                  timestamp: Date.now(),
                  isGroup: true
                };
                allMessages.push(payload);
                saveDB();
                group.members.forEach(memberId => {
                  const member = users.get(memberId);
                  if (member) {
                    member.sessions.forEach(s => io.to(s.socketId).emit('message', payload));
                  }
                });
              }
            } else if (command.receiverId) {
              const receiver = users.get(command.receiverId);
              const payload = {
                id: `bot-${Date.now()}`,
                senderId: botId,
                receiverId: command.receiverId,
                encryptedContent: command.content,
                timestamp: Date.now(),
                isBot: true
              };
              allMessages.push(payload);
              saveDB();
              if (receiver) {
                receiver.sessions.forEach(s => io.to(s.socketId).emit('message', payload));
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error parsing bot output (${botId}):`, e);
      }
    });

    botProcess.stderr.on('data', (data) => {
      console.error(`Bot error (${botId}):`, data.toString());
    });

    botProcess.on('error', (err) => {
      console.error(`Failed to start bot ${botId}:`, err);
    });

    botProcess.on('close', (code) => {
      console.log(`Bot ${botId} exited with code ${code}`);
      activeBots.delete(botId);
    });

    activeBots.set(botId, botProcess);
  };

  // Load existing bots
  if (fs.existsSync(botsDir)) {
    fs.readdirSync(botsDir).forEach(file => {
      if (file.endsWith('.py')) {
        startBot(path.join(botsDir, file), file.replace('.py', ''));
      }
    });
  }

  const broadcastUsers = () => {
    io.emit('users', Array.from(users.values()).map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      publicKey: u.publicKey,
      avatar: u.avatar,
      online: u.sessions.length > 0,
      lastSeen: u.lastSeen
    })));
  };

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('users', Array.from(users.values()).map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      publicKey: u.publicKey,
      avatar: u.avatar,
      online: u.sessions.length > 0,
      lastSeen: u.lastSeen
    })));

    socket.on('register', async (data: { 
      id: string; 
      username: string; 
      displayName?: string; 
      publicKey: string; 
      passwordHash?: string;
      encryptedPrivateKey?: string;
      avatar?: string; 
      deviceModel?: string 
    }) => {
      let user = users.get(data.id);
      if (!user) {
        const existingId = usernameToId.get(data.username);
        if (existingId && existingId !== data.id) {
          socket.emit('error', { message: 'Username already taken' });
          return;
        }
        user = { 
          id: data.id, 
          username: data.username, 
          displayName: data.displayName, 
          publicKey: data.publicKey, 
          passwordHash: data.passwordHash,
          encryptedPrivateKey: data.encryptedPrivateKey,
          avatar: data.avatar, 
          role: data.username === 'admin' ? 'admin' : 'user',
          sessions: [], 
          lastSeen: Date.now() 
        };
        users.set(data.id, user);
        usernameToId.set(data.username, data.id);
      } else {
        user.publicKey = data.publicKey;
        user.username = data.username;
        if (data.passwordHash) user.passwordHash = data.passwordHash;
        if (data.encryptedPrivateKey) user.encryptedPrivateKey = data.encryptedPrivateKey;
        if (data.displayName) user.displayName = data.displayName;
        if (data.avatar) user.avatar = data.avatar;
      }

      saveDB();
      
      user.sessions = user.sessions.filter(s => s.socketId !== socket.id);
      user.sessions.push({ socketId: socket.id, deviceModel: data.deviceModel || 'Unknown Device', connectedAt: Date.now() });
      
      // Join a room for this user ID to allow io.to(userId)
      socket.join(data.id);
      
      broadcastUsers();

      const pendingMessages = offlineMessages.get(data.id) || [];
      if (pendingMessages.length > 0) {
        pendingMessages.forEach(msg => socket.emit('message', msg));
        offlineMessages.delete(data.id);
        saveDB();
      }
    });

    socket.on('login', async (data: { username: string; passwordHash: string }, callback: (response: { success: boolean; user?: any; message?: string }) => void) => {
      const searchUsername = data.username.trim();
      const userId = usernameToId.get(searchUsername);
      
      if (!userId) {
        callback({ success: false, message: 'User not found' });
        return;
      }

      const user = users.get(userId);
      if (!user || user.passwordHash !== data.passwordHash) {
        callback({ success: false, message: 'Invalid username or password' });
        return;
      }

      callback({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          publicKey: user.publicKey,
          encryptedPrivateKey: user.encryptedPrivateKey,
          avatar: user.avatar
        } 
      });
    });

    socket.on('message', async (data: Message) => {
      const receiver = users.get(data.receiverId);
      
      allMessages.push(data);
      saveDB();

      if (receiver && receiver.sessions.length > 0) {
        receiver.sessions.forEach(s => io.to(s.socketId).emit('message', data));
      } else {
        const pending = offlineMessages.get(data.receiverId) || [];
        pending.push(data);
        offlineMessages.set(data.receiverId, pending);
        saveDB();
      }

      activeBots.forEach((botProcess, botId) => {
        if (botProcess.stdin) {
          botProcess.stdin.write(JSON.stringify({ type: 'message', ...data }) + '\n');
        }
      });
    });

    socket.on('get_history', (userId: string, callback: (messages: Message[]) => void) => {
      const history = allMessages.filter(m => 
        m.senderId === userId || m.receiverId === userId || (m.isGroup && groups.get(m.receiverId)?.members.includes(userId))
      );
      callback(history);
    });

    socket.on('get_sessions', (userId: string, callback: (sessions: Session[]) => void) => {
      const user = users.get(userId);
      callback(user ? user.sessions : []);
    });

    socket.on('kick_session', ({ userId, socketIdToKick }) => {
      const user = users.get(userId);
      if (user) {
        user.sessions = user.sessions.filter(s => s.socketId !== socketIdToKick);
        io.to(socketIdToKick).emit('kicked');
        const socketToDisconnect = io.sockets.sockets.get(socketIdToKick);
        if (socketToDisconnect) socketToDisconnect.disconnect();
        broadcastUsers();
      }
    });

    socket.on('update_key', ({ id, publicKey }) => {
      const user = users.get(id);
      if (user) {
        user.publicKey = publicKey;
        saveDB();
        broadcastUsers();
      }
    });

    socket.on('update_profile', ({ id, username, displayName, avatar }) => {
      const user = users.get(id);
      if (user) {
        if (displayName !== undefined) user.displayName = displayName;
        if (avatar !== undefined) user.avatar = avatar;
        saveDB();
        broadcastUsers();
      }
    });

    socket.on('create_group', (data: { id: string; name: string; avatar?: string; adminId: string }, callback: (group: Group) => void) => {
      const newGroup: Group = {
        id: data.id,
        name: data.name,
        avatar: data.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${data.id}`,
        adminId: data.adminId,
        members: [data.adminId],
        createdAt: Date.now()
      };
      groups.set(newGroup.id, newGroup);
      saveDB();
      io.emit('groups', Array.from(groups.values()));
      callback(newGroup);
    });

    socket.on('join_group', (data: { groupId: string; userId: string }, callback: (response: { success: boolean; group?: Group; message?: string }) => void) => {
      const group = groups.get(data.groupId);
      if (!group) {
        callback({ success: false, message: 'Group not found' });
        return;
      }
      if (!group.members.includes(data.userId)) {
        group.members.push(data.userId);
        saveDB();
        io.emit('groups', Array.from(groups.values()));
      }
      callback({ success: true, group });
    });

    socket.on('group_message', async (data: Message) => {
      const group = groups.get(data.receiverId);
      if (!group) return;

      allMessages.push(data);
      saveDB();

      // Check for bot upload
      if (data.type === 'file' && data.fileName?.endsWith('.txt') && data.content) {
        const user = users.get(data.senderId);
        if (user && user.role === 'admin') {
          try {
            const base64Data = data.content.split(',')[1];
            const botCode = Buffer.from(base64Data, 'base64').toString('utf-8');
            if (botCode.includes('import ') || botCode.includes('print(') || botCode.includes('def ')) {
              const botName = data.fileName.replace('.txt', '');
              const botPath = path.join(botsDir, `${botName}.py`);
              fs.writeFileSync(botPath, botCode);
              if (activeBots.has(botName)) activeBots.get(botName)?.kill();
              startBot(botPath, botName);
              
              const botNotify = {
                id: `system-${Date.now()}`,
                senderId: 'system',
                receiverId: data.receiverId,
                content: `Bot ${botName} has been deployed and started!`,
                timestamp: Date.now(),
                isGroup: true,
                type: 'text'
              };
              allMessages.push(botNotify);
              saveDB();
              group.members.forEach(memberId => {
                const member = users.get(memberId);
                if (member) member.sessions.forEach(s => io.to(s.socketId).emit('message', botNotify));
              });
            }
          } catch (e) {
            console.error('Failed to process bot file:', e);
          }
        }
      }

      group.members.forEach(memberId => {
        const member = users.get(memberId);
        if (member) {
          const payload = { ...data, isGroup: true };
          if (member.sessions.length > 0) {
            member.sessions.forEach(s => io.to(s.socketId).emit('message', payload));
          } else {
            const pending = offlineMessages.get(memberId) || [];
            pending.push(payload);
            offlineMessages.set(memberId, pending);
            saveDB();
          }
        }
      });

      activeBots.forEach((botProcess, botId) => {
        if (botProcess.stdin) {
          botProcess.stdin.write(JSON.stringify({ type: 'group_message', ...data }) + '\n');
        }
      });
    });

    socket.on('get_groups', (callback: (groups: Group[]) => void) => {
      callback(Array.from(groups.values()));
    });

    socket.on('call_user', (data: { offer: any; to: string; from: string; video?: boolean }) => {
      // Emit to all sessions of the receiver
      io.to(data.to).emit('incoming_call', { offer: data.offer, from: data.from, video: data.video });
    });

    socket.on('answer_call', (data: { answer: any; to: string }) => {
      io.to(data.to).emit('call_answered', { answer: data.answer });
    });

    socket.on('ice_candidate', (data: { candidate: any; to: string }) => {
      io.to(data.to).emit('ice_candidate', { candidate: data.candidate });
    });

    socket.on('reject_call', (data: { to: string }) => {
      const receiver = users.get(data.to);
      if (receiver) {
        receiver.sessions.forEach(s => io.to(s.socketId).emit('call_rejected'));
      }
    });

    socket.on('end_call', (data: { to: string }) => {
      const receiver = users.get(data.to);
      if (receiver) {
        receiver.sessions.forEach(s => io.to(s.socketId).emit('call_ended'));
      }
    });

    socket.on('update_group', (data: { groupId: string; updates: Partial<Group> }, callback: (response: { success: boolean; group?: Group }) => void) => {
      const group = groups.get(data.groupId);
      if (group) {
        if (data.updates.name !== undefined) group.name = data.updates.name;
        if (data.updates.avatar !== undefined) group.avatar = data.updates.avatar;
        saveDB();
        io.emit('groups', Array.from(groups.values()));
        callback({ success: true, group });
      } else {
        callback({ success: false });
      }
    });

    socket.on('admin_broadcast', (data: { senderId: string; content: string; timestamp: number }) => {
      const admin = users.get(data.senderId);
      if (!admin || admin.username !== 'admin') return;

      for (const [userId, user] of users.entries()) {
        const payload = {
          id: `broadcast-${Date.now()}-${userId}`,
          senderId: 'bot-safems',
          receiverId: userId,
          content: data.content,
          timestamp: data.timestamp,
          type: 'text'
        };
        allMessages.push(payload);
        if (user.sessions.length > 0) {
          user.sessions.forEach(s => io.to(s.socketId).emit('message', payload));
        } else {
          const pending = offlineMessages.get(userId) || [];
          pending.push(payload);
          offlineMessages.set(userId, pending);
        }
      }
      saveDB();
    });

    socket.on('disconnect', () => {
      let disconnectedUserId: string | null = null;
      for (const [id, user] of users.entries()) {
        const initialLen = user.sessions.length;
        user.sessions = user.sessions.filter(s => s.socketId !== socket.id);
        if (user.sessions.length < initialLen) {
          disconnectedUserId = id;
          if (user.sessions.length === 0) {
            user.lastSeen = Date.now();
            saveDB();
          }
          break;
        }
      }
      if (disconnectedUserId) broadcastUsers();
      console.log('User disconnected:', socket.id);
    });
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  const isProd = process.env.NODE_ENV === 'production';
  const rootDir = process.cwd();
  const distPath = path.join(rootDir, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (isProd && hasDist) {
    console.log('Production mode: Serving static files from', distPath);
    
    // ===== 1. СТАТИКА (ПЕРВАЯ!) =====
    // Обслуживаем только папку assets как статику, чтобы не светить server.js
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      immutable: true,
      maxAge: '1y'
    }));
    
    // Обслуживаем остальные статические файлы из корня dist (manifest, sw.js и т.д.)
    app.use(express.static(distPath, { index: false }));

    // ===== 2. ТОЛЬКО ДЛЯ HTML =====
    app.get('*', (req, res, next) => {
      // ❗ если это запрос к ассетам, которые не нашлись — 404
      if (req.path.startsWith('/assets')) {
        return res.status(404).end();
      }
      
      // Если это API запрос — пропускаем дальше
      if (req.path.startsWith('/api')) return next();
      
      // Для всех остальных навигационных запросов отдаем index.html
      const indexPath = path.join(distPath, 'index.html');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.sendFile(indexPath);
    });
  } else {
    console.log(isProd && !hasDist 
      ? 'Warning: NODE_ENV is production but /dist not found. Falling back to Vite dev mode.' 
      : 'Development mode: Using Vite middleware');
      
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ 
      server: { middlewareMode: true }, 
      appType: 'spa',
      root: process.cwd()
    });
    
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api') || url.includes('.') || !req.accepts('html')) return next();
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
