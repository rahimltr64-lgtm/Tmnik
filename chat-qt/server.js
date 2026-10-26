import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));

app.use(
  "/vendor/html5-qrcode",
  express.static(
    path.join(__dirname, "node_modules", "html5-qrcode")
  )
);

app.use(express.static(path.join(__dirname, "public")));

const dataDirectory = path.join(__dirname, "data");
const groupsFile = path.join(dataDirectory, "groups.json");

fs.mkdirSync(dataDirectory, { recursive: true });

let groups = {};

try {
  groups = JSON.parse(fs.readFileSync(groupsFile, "utf8"));
} catch {
  groups = {};
}

function saveGroups() {
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(groups, null, 2),
    "utf8"
  );
}

const onlineUsers = new Map();

function getGroupMembers(groupId) {
  const sockets = io.sockets.adapter.rooms.get(groupId);

  if (!sockets) return [];

  return [...sockets]
    .map((socketId) => onlineUsers.get(socketId))
    .filter(Boolean)
    .map((user) => ({
      memberId: user.memberId,
      name: user.name
    }));
}

function cleanText(value, maxLength = 100) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u001F]/g, "")
    .slice(0, maxLength);
}

/**
 * إنشاء مجموعة
 */
app.post("/api/groups", async (req, res) => {
  try {
    const creatorName = cleanText(req.body.creatorName, 40);
    const title = cleanText(req.body.title, 60) || "مجموعة الأصدقاء";

    if (!creatorName) {
      return res.status(400).json({
        error: "الرجاء إدخال اسمك أولًا"
      });
    }

    const id = randomUUID();

    groups[id] = {
      id,
      title,
      createdBy: creatorName,
      createdAt: new Date().toISOString()
    };

    saveGroups();

    const configuredOrigin = process.env.PUBLIC_URL?.replace(/\/$/, "");

    const origin =
      configuredOrigin ||
      `${req.protocol}://${req.get("host") || "localhost:3000"}`;

    const inviteUrl = `${origin}/group/${id}`;

    const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#111827",
        light: "#ffffff"
      }
    });

    res.json({
      group: groups[id],
      inviteUrl,
      qrDataUrl
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "حدث خطأ أثناء إنشاء المجموعة"
    });
  }
});

/**
 * معلومات المجموعة
 */
app.get("/api/groups/:id", (req, res) => {
  const group = groups[req.params.id];

  if (!group) {
    return res.status(404).json({
      error: "المجموعة غير موجودة"
    });
  }

  res.json({ group });
});

/**
 * فتح صفحة المجموعة مباشرة
 */
app.get("/group/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  socket.on("join-room", (payload, callback) => {
    const groupId = cleanText(payload?.groupId, 80);
    const name = cleanText(payload?.name, 40);
    const group = groups[groupId];

    if (!group) {
      return callback?.({
        ok: false,
        error: "المجموعة غير موجودة"
      });
    }

    if (!name) {
      return callback?.({
        ok: false,
        error: "الرجاء إدخال اسمك"
      });
    }

    const previousSession = onlineUsers.get(socket.id);

    if (previousSession) {
      socket.leave(previousSession.groupId);

      io.to(previousSession.groupId).emit("member-left", {
        name: previousSession.name
      });

      io.to(previousSession.groupId).emit(
        "members",
        getGroupMembers(previousSession.groupId)
      );
    }

    const memberId = randomUUID();

    onlineUsers.set(socket.id, {
      groupId,
      memberId,
      name
    });

    socket.join(groupId);

    io.to(groupId).emit("member-joined", {
      name
    });

    callback?.({
      ok: true,
      group,
      memberId,
      members: getGroupMembers(groupId)
    });

    io.to(groupId).emit(
      "members",
      getGroupMembers(groupId)
    );
  });

  socket.on("group-message", (payload, callback) => {
    const session = onlineUsers.get(socket.id);
    const text = cleanText(payload?.text, 1000);

    if (!session) {
      return callback?.({
        ok: false,
        error: "انضم إلى المجموعة أولًا"
      });
    }

    if (payload?.groupId !== session.groupId) {
      return callback?.({
        ok: false,
        error: "غير مصرح لك الإرسال في هذه المجموعة"
      });
    }

    if (!text) {
      return callback?.({
        ok: false,
        error: "الرسالة فارغة"
      });
    }

    const message = {
      id: randomUUID(),
      senderId: session.memberId,
      sender: session.name,
      text,
      sentAt: new Date().toISOString()
    };

    io.to(session.groupId).emit("group-message", message);

    callback?.({
      ok: true
    });
  });

  socket.on("leave-room", () => {
    const session = onlineUsers.get(socket.id);

    if (!session) return;

    socket.leave(session.groupId);
    onlineUsers.delete(socket.id);

    io.to(session.groupId).emit("member-left", {
      name: session.name
    });

    io.to(session.groupId).emit(
      "members",
      getGroupMembers(session.groupId)
    );
  });

  socket.on("disconnect", () => {
    const session = onlineUsers.get(socket.id);

    if (!session) return;

    onlineUsers.delete(socket.id);

    io.to(session.groupId).emit("member-left", {
      name: session.name
    });

    io.to(session.groupId).emit(
      "members",
      getGroupMembers(session.groupId)
    );
  });
});

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
  console.log(`Chat QR يعمل على http://localhost:${port}`);
});
