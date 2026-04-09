import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

// Catch unhandled errors to prevent silent crashes in production
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

async function startServer() {
  console.log('Starting safeMS Server...');
  const app = express();
  
  // Load Firebase config
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let db: any = null;

  if (fs.existsSync(configPath)) {
    try {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      console.log('Initializing Firebase Admin with project:', firebaseConfig.projectId);
      
      // Check if already initialized
      if (admin.apps.length === 0) {
        admin.initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
      
      const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
      db = getFirestore(admin.app(), databaseId);
      console.log(`Firebase Admin initialized. Database: ${databaseId}`);
    } catch (err) {
      console.error('Failed to initialize Firebase Admin:', err);
    }
  } else {
    console.warn('firebase-applet-config.json not found. Running without persistence.');
  }
  
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

  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
      userId: string | undefined;
      email: string | null | undefined;
      emailVerified: boolean | undefined;
      isAnonymous: boolean | undefined;
      tenantId: string | null | undefined;
      providerInfo: {
        providerId: string;
        displayName: string | null;
        email: string | null;
        photoUrl: string | null;
      }[];
    }
  }

  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

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
    passwordHash?: string; // Added for authentication
    encryptedPrivateKey?: string; // Added for cloud backup/sync
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
  
  const users = new Map<string, ServerUser>();
  const groups = new Map<string, Group>();
  const usernameToId = new Map<string, string>(); // Helper for login
  
  // Load users from Firestore on startup
  if (db) {
    try {
      const usersSnapshot = await db.collection('global_users').get();
      usersSnapshot.forEach((doc: any) => {
        const userData = doc.data();
        users.set(userData.id, {
          ...userData,
          sessions: [],
          lastSeen: Date.now()
        } as ServerUser);
        usernameToId.set(userData.username, userData.id);
      });
      console.log(`Loaded ${users.size} users from Firestore via Admin SDK`);
    } catch (err) {
      console.warn('Failed to load users from Firestore via Admin SDK:', err);
    }
  }
  
  // Pre-populate creator profile
  users.set('admin', {
    id: 'admin',
    username: 'admin',
    displayName: 'Creator',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEzKn2k3Q0WT4034OIrj9F4isIC5e0PQNP2PfbYJMfFNXjJA3QtvO4qB4goyIy0wH+z5h7Ld8hpZFTNKffqT62eg==',
    passwordHash: 'db4b1a48b949625d13654c884f08b7c9798f70f676adbae8f81959958515cfd8',
    encryptedPrivateKey: '+Fq2o3vLtBLE/e7tREY81S/vpt+TLVPW70MIm4+My970QJOpRnmUaTU9a6eWpT9z0JqNIo7DW2fgVJsEZUCd4njgWh7vdS3M6+Dt3WJXFyFzSViFHhR3AZnBsHHJPC1+Rl6xOn6fcdFwRx+W0VyegPWHXXgEr9ATEUWHDXs9tuLh56JNX3DtEMJzZzk7GD71t5Q24d+m3Zrp81rez7q9pHeAR3udZrbfuIMVwDzAG71yUf62KXIfrY4RRIo5siR1yFoEaGVmHn6cDyDM6vhyfNAnNcM=',
    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=admin',
    sessions: [],
    lastSeen: Date.now()
  });
  usernameToId.set('admin', 'admin');
  
  // Store offline messages
  const offlineMessages = new Map<string, any[]>();
  
  // Bot management
  const botsDir = path.join(process.cwd(), 'bots');
  if (!fs.existsSync(botsDir)) {
    fs.mkdirSync(botsDir);
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
            // Bot sending a message
            if (command.groupId) {
              const group = groups.get(command.groupId);
              if (group) {
                const payload = {
                  id: `bot-${Date.now()}`,
                  senderId: botId,
                  groupId: command.groupId,
                  content: command.content,
                  timestamp: Date.now(),
                  isGroup: true
                };
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
                encryptedContent: command.content, // Bots might send unencrypted if they don't have keys, or we handle it
                timestamp: Date.now(),
                isBot: true
              };
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
  fs.readdirSync(botsDir).forEach(file => {
    if (file.endsWith('.py')) {
      startBot(path.join(botsDir, file), file.replace('.py', ''));
    }
  });

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

    // Send current users to the newly connected client immediately
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
        // Check if username already taken in memory
        const existingId = usernameToId.get(data.username);
        if (existingId && existingId !== data.id) {
          socket.emit('error', { message: 'Username already taken' });
          return;
        }

        // Check Firestore for username if not in memory
        if (db && !existingId) {
          try {
            const snapshot = await db.collection('global_users').where('username', '==', data.username).get();
            if (!snapshot.empty && snapshot.docs[0].id !== data.id) {
              socket.emit('error', { message: 'Username already taken' });
              return;
            }
          } catch (err) {
            console.warn('Firestore username check failed via Admin SDK:', err);
          }
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

      // Save to Firestore - Filter out undefined values and use merge
      const { sessions, ...persistentData } = user;
      const cleanData = Object.fromEntries(
        Object.entries(persistentData).filter(([_, v]) => v !== undefined)
      );

      if (db) {
        try {
          await db.collection('global_users').doc(data.id).set(cleanData, { merge: true });
          console.log(`User ${data.username} saved to Firestore via Admin SDK`);
        } catch (err: any) {
          console.error('Failed to save user to Firestore via Admin SDK:', err);
        }
      }
      
      user.sessions = user.sessions.filter(s => s.socketId !== socket.id);
      user.sessions.push({ socketId: socket.id, deviceModel: data.deviceModel || 'Unknown Device', connectedAt: Date.now() });
      
      // Broadcast updated user list
      broadcastUsers();

      // Send offline messages if any
      const pendingMessages = offlineMessages.get(data.id) || [];
      if (pendingMessages.length > 0) {
        pendingMessages.forEach(msg => socket.emit('message', msg));
        offlineMessages.delete(data.id);
      }
    });

    socket.on('login', async (data: { username: string; passwordHash: string }, callback: (response: { success: boolean; user?: any; message?: string }) => void) => {
      const searchUsername = data.username.trim();
      let userId = usernameToId.get(searchUsername);
      
      console.log(`Login attempt for username: "${searchUsername}". In-memory lookup: ${userId || 'Not found'}`);

      // Fallback: Check Firestore if not in memory
      if (!userId && db) {
        try {
          const snapshot = await db.collection('global_users').where('username', '==', searchUsername).get();
          if (!snapshot.empty) {
            const userData = snapshot.docs[0].data();
            userId = userData.id;
            console.log(`Found user "${searchUsername}" in Firestore via Admin SDK. ID: ${userId}`);
            // Update memory
            users.set(userId, { ...userData, sessions: [], lastSeen: Date.now() } as ServerUser);
            usernameToId.set(userData.username, userId);
          }
        } catch (err) {
          console.warn('Firestore lookup failed during login via Admin SDK:', err);
        }
      }

      if (!userId) {
        console.log(`Login failed: User '${data.username}' not found in memory or Firestore. Current memory size: ${users.size}`);
        callback({ success: false, message: 'User not found' });
        return;
      }

      const user = users.get(userId);
      if (!user || user.passwordHash !== data.passwordHash) {
        console.log(`Login failed for ${data.username}: ${!user ? 'User not in memory' : 'Password mismatch'}`);
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

    socket.on('message', async (data: { id: string; senderId: string; receiverId: string; encryptedContent: string; timestamp: number; iv: string }) => {
      const receiver = users.get(data.receiverId);
      
      // Persistence
      if (db) {
        try {
          // Save to both sender and receiver paths for reliability
          await db.collection('users').doc(data.senderId).collection('messages').doc(data.id).set(data);
          await db.collection('users').doc(data.receiverId).collection('messages').doc(data.id).set(data);
        } catch (err) {
          console.error('Failed to save message to Firestore:', err);
        }
      }

      if (receiver && receiver.sessions.length > 0) {
        // If receiver is online, send to all their active sessions
        receiver.sessions.forEach(s => io.to(s.socketId).emit('message', data));
      } else {
        // Store for later
        const pending = offlineMessages.get(data.receiverId) || [];
        pending.push(data);
        offlineMessages.set(data.receiverId, pending);
      }

      // Notify active bots
      activeBots.forEach((botProcess, botId) => {
        botProcess.stdin.write(JSON.stringify({ type: 'message', ...data }) + '\n');
      });
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
        broadcastUsers();
      }
    });

    socket.on('update_profile', ({ id, username, displayName, avatar }) => {
      const user = users.get(id);
      if (user) {
        // Only allow updating displayName and avatar, username is fixed for existing users
        if (displayName !== undefined) user.displayName = displayName;
        if (avatar !== undefined) user.avatar = avatar;
        broadcastUsers();
      }
    });

    // Group Handlers
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
        io.emit('groups', Array.from(groups.values()));
      }
      callback({ success: true, group });
    });

    socket.on('group_message', async (data: { id: string; senderId: string; groupId: string; content: string; timestamp: number; type?: string; fileName?: string; fileSize?: number }) => {
      const group = groups.get(data.groupId);
      if (!group) return;

      // Persistence
      if (db) {
        try {
          await db.collection('groups').doc(data.groupId).collection('messages').doc(data.id).set(data);
        } catch (err) {
          console.error('Failed to save group message to Firestore:', err);
        }
      }

      // Check for bot upload (.txt file with python code)
      if (data.type === 'file' && data.fileName?.endsWith('.txt')) {
        const user = users.get(data.senderId);
        // Check if user is admin
        if (user && user.role === 'admin') {
          try {
            // Extract base64 content
            const base64Data = data.content.split(',')[1];
            const botCode = Buffer.from(base64Data, 'base64').toString('utf-8');
            
            // Simple check if it's python
            if (botCode.includes('import ') || botCode.includes('print(') || botCode.includes('def ')) {
              const botName = data.fileName.replace('.txt', '');
              const botPath = path.join(botsDir, `${botName}.py`);
              fs.writeFileSync(botPath, botCode);
              
              // Restart bot if already running
              if (activeBots.has(botName)) {
                activeBots.get(botName)?.kill();
              }
              startBot(botPath, botName);
              
              // Notify group
              const botNotify = {
                id: `system-${Date.now()}`,
                senderId: 'system',
                groupId: data.groupId,
                content: `Bot ${botName} has been deployed and started!`,
                timestamp: Date.now(),
                isGroup: true,
                type: 'text'
              };
              group.members.forEach(memberId => {
                const member = users.get(memberId);
                if (member) {
                  member.sessions.forEach(s => io.to(s.socketId).emit('message', botNotify));
                }
              });
            }
          } catch (e) {
            console.error('Failed to process bot file:', e);
          }
        }
      }

      // Broadcast to all members
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
          }
        }
      });

      // Notify active bots
      activeBots.forEach((botProcess, botId) => {
        botProcess.stdin.write(JSON.stringify({ type: 'group_message', ...data }) + '\n');
      });
    });

    socket.on('get_groups', (callback: (groups: Group[]) => void) => {
      callback(Array.from(groups.values()));
    });

    // Call Signaling
    socket.on('call_user', (data: { offer: any; to: string; from: string }) => {
      const receiver = users.get(data.to);
      if (receiver) {
        receiver.sessions.forEach(s => io.to(s.socketId).emit('incoming_call', { offer: data.offer, from: data.from }));
      }
    });

    socket.on('answer_call', (data: { answer: any; to: string }) => {
      const receiver = users.get(data.to);
      if (receiver) {
        receiver.sessions.forEach(s => io.to(s.socketId).emit('call_answered', { answer: data.answer }));
      }
    });

    socket.on('ice_candidate', (data: { candidate: any; to: string }) => {
      const receiver = users.get(data.to);
      if (receiver) {
        receiver.sessions.forEach(s => io.to(s.socketId).emit('ice_candidate', { candidate: data.candidate }));
      }
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
        
        io.emit('groups', Array.from(groups.values()));
        callback({ success: true, group });
      } else {
        callback({ success: false });
      }
    });

    socket.on('admin_broadcast', (data: { senderId: string; content: string; timestamp: number }) => {
      const admin = users.get(data.senderId);
      if (!admin || admin.username !== 'admin') return;

      // Send to all users
      for (const [userId, user] of users.entries()) {
        const payload = {
          id: `broadcast-${Date.now()}-${userId}`,
          senderId: 'bot-safems',
          receiverId: userId,
          content: data.content,
          timestamp: data.timestamp,
          type: 'text'
        };

        if (user.sessions.length > 0) {
          user.sessions.forEach(s => io.to(s.socketId).emit('message', payload));
        } else {
          const pending = offlineMessages.get(userId) || [];
          pending.push(payload);
          offlineMessages.set(userId, pending);
        }
      }
    });

    socket.on('disconnect', () => {
      // Find user by socket ID and mark offline
      let disconnectedUserId: string | null = null;
      for (const [id, user] of users.entries()) {
        const initialLen = user.sessions.length;
        user.sessions = user.sessions.filter(s => s.socketId !== socket.id);
        if (user.sessions.length < initialLen) {
          disconnectedUserId = id;
          if (user.sessions.length === 0) {
            user.lastSeen = Date.now();
          }
          break;
        }
      }

      if (disconnectedUserId) {
        broadcastUsers();
      }
      console.log('User disconnected:', socket.id);
    });
  });

  // API routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    // Fallback for SPA in dev mode to ensure index.html is served for all non-API routes
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) return next();
      
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          vite.ssrFixStacktrace(e as Error);
        }
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    console.log(`Serving static files from: ${distPath}`);
    console.log(`Index path: ${indexPath}, exists: ${fs.existsSync(indexPath)}`);
    
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      console.log(`Fallback to index.html for: ${req.url}`);
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('System Error: index.html not found in dist folder. Please rebuild the application.');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
