import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// фикс __dirname для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 путь к dist (ВАЖНО)
const distPath = path.join(__dirname, "dist");

// ===== SOCKET.IO =====
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("call_user", (data) => {
    io.to(data.to).emit("incoming_call", data);
  });

  socket.on("answer_call", (data) => {
    io.to(data.to).emit("call_answered", data);
  });

  socket.on("ice_candidate", (data) => {
    io.to(data.to).emit("ice_candidate", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ===== СТАТИКА (САМОЕ ВАЖНОЕ) =====
app.use(express.static(distPath));

// ===== REACT ROUTING =====
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ===== СТАРТ =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});