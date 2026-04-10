import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 ВАЖНО: сервер уже внутри dist
const distPath = __dirname;

// ===== 1. СТАТИКА (ПЕРВАЯ!) =====
app.use(express.static(distPath));

// ===== SOCKET =====
io.on("connection", (socket) => {
  socket.on("call_user", (data) => {
    io.to(data.to).emit("incoming_call", data);
  });

  socket.on("answer_call", (data) => {
    io.to(data.to).emit("call_answered", data);
  });

  socket.on("ice_candidate", (data) => {
    io.to(data.to).emit("ice_candidate", data);
  });
});

// ===== 2. ТОЛЬКО ДЛЯ HTML =====
app.get("*", (req, res) => {
  // ❗ если это НЕ файл — тогда index.html
  if (req.path.startsWith("/assets")) {
    return res.status(404).end();
  }

  res.sendFile(path.join(distPath, "index.html"));
});

// ===== START =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
