const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = "beqa1007";

const users = new Map();
const bannedUsers = new Set();

function findUserByName(name) {
  const target = String(name || "").trim().toLowerCase();
  for (const user of users.values()) {
    if (user.username.toLowerCase() === target) return user;
  }
  return null;
}

function getUser(id) {
  return users.get(id);
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "moderator") {
    return ["kick", "mute", "announce"].includes(permission);
  }
  return false;
}

function sendUserList() {
  const list = [...users.values()].map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    mutedUntil: u.mutedUntil
  }));

  io.emit("userList", list);
  io.emit("online", list.map(u => u.username));
}

io.on("connection", socket => {
  socket.on("join", data => {
    let username = "";
    let adminKey = "";

    if (data && typeof data === "object") {
      username = data.username;
      adminKey = data.adminKey || "";
    } else {
      username = data;
    }

    username = String(username || "Guest").trim().slice(0, 24) || "Guest";

    if (bannedUsers.has(username.toLowerCase())) {
      socket.emit("joinError", "🚫 ეს მომხმარებელი დაბლოკილია.");
      socket.disconnect(true);
      return;
    }

    if (findUserByName(username)) {
      socket.emit("joinError", "❌ ეს სახელი უკვე დაკავებულია.");
      socket.disconnect(true);
      return;
    }

    const role = String(adminKey).trim() === ADMIN_KEY ? "admin" : "member";

    users.set(socket.id, {
      id: socket.id,
      username,
      role,
      mutedUntil: null
    });

    socket.emit("role", role);
    socket.emit("system", `კეთილი იყოს შენი მობრძანება, ${username}! 👋`);

    if (role === "admin") {
      socket.emit("system", "🛡️ შენ შესული ხარ როგორც ADMIN.");
    }

    socket.broadcast.emit("system", `${username} შემოვიდა ჩატში 🟢`);
    sendUserList();
  });

  socket.on("chatMessage", text => {
    const user = getUser(socket.id);
    if (!user) return;

    if (user.mutedUntil && Date.now() < user.mutedUntil) {
      const seconds = Math.ceil((user.mutedUntil - Date.now()) / 1000);
      socket.emit("system", `🔇 დადუმებული ხარ კიდევ ${seconds} წამით.`);
      return;
    }

    text = String(text || "").trim().slice(0, 1000);
    if (!text) return;

    if (text.startsWith("/")) {
      const parts = text.split(" ");
      const command = parts[0].toLowerCase();

      if (command === "/kick") {
        if (!hasPermission(user, "kick")) {
          socket.emit("system", "❌ ამის უფლება არ გაქვს.");
          return;
        }
        const target = findUserByName(parts.slice(1).join(" "));
        if (!target) {
          socket.emit("system", "❌ მომხმარებელი ვერ მოიძებნა.");
          return;
        }
        if (target.role === "admin") {
          socket.emit("system", "❌ Admin-ის გაგდება შეუძლებელია.");
          return;
        }
        const s = io.sockets.sockets.get(target.id);
        if (s) {
          s.emit("system", "🚫 შენ გაგაგდეს ჩატიდან.");
          s.disconnect(true);
        }
        io.emit("system", `🚫 ${target.username} გაგდებულია ჩატიდან.`);
        return;
      }

      if (command === "/mute") {
        if (!hasPermission(user, "mute")) {
          socket.emit("system", "❌ ამის უფლება არ გაქვს.");
          return;
        }
        const target = findUserByName(parts[1]);
        const seconds = Math.max(1, Number(parts[2]) || 60);
        if (!target) {
          socket.emit("system", "❌ მომხმარებელი ვერ მოიძებნა.");
          return;
        }
        if (target.role === "admin") {
          socket.emit("system", "❌ Admin-ის დადუმება შეუძლებელია.");
          return;
        }
        target.mutedUntil = Date.now() + seconds * 1000;
        const s = io.sockets.sockets.get(target.id);
        if (s) s.emit("system", `🔇 შენ დადუმებული ხარ ${seconds} წამით.`);
        io.emit("system", `🔇 ${target.username} დადუმებულია ${seconds} წამით.`);
        sendUserList();
        return;
      }

      if (command === "/ban") {
        if (!hasPermission(user, "kick")) {
          socket.emit("system", "❌ ამის უფლება არ გაქვს.");
          return;
        }
        const target = findUserByName(parts.slice(1).join(" "));
        if (!target) {
          socket.emit("system", "❌ მომხმარებელი ვერ მოიძებნა.");
          return;
        }
        if (target.role === "admin") {
          socket.emit("system", "❌ Admin-ის დაბლოკვა შეუძლებელია.");
          return;
        }
        bannedUsers.add(target.username.toLowerCase());
        const s = io.sockets.sockets.get(target.id);
        if (s) {
          s.emit("system", "🔨 შენ დაბლოკილი ხარ.");
          s.disconnect(true);
        }
        io.emit("system", `🔨 ${target.username} დაბლოკილია.`);
        sendUserList();
        return;
      }

      if (command === "/promote") {
        if (user.role !== "admin") {
          socket.emit("system", "❌ მხოლოდ Admin-ს შეუძლია Moderator-ის დანიშვნა.");
          return;
        }
        const target = findUserByName(parts.slice(1).join(" "));
        if (!target) {
          socket.emit("system", "❌ მომხმარებელი ვერ მოიძებნა.");
          return;
        }
        if (target.role === "admin") {
          socket.emit("system", "❌ ისედაც Admin-ია.");
          return;
        }
        target.role = "moderator";
        const s = io.sockets.sockets.get(target.id);
        if (s) {
          s.emit("role", "moderator");
          s.emit("system", "🔵 შენ გახდი Moderator.");
        }
        io.emit("system", `🔵 ${target.username} გახდა Moderator.`);
        sendUserList();
        return;
      }

      if (command === "/demote") {
        if (user.role !== "admin") {
          socket.emit("system", "❌ მხოლოდ Admin-ს შეუძლია Moderator-ის ჩამორთმევა.");
          return;
        }
        const target = findUserByName(parts.slice(1).join(" "));
        if (!target) {
          socket.emit("system", "❌ მომხმარებელი ვერ მოიძებნა.");
          return;
        }
        if (target.role !== "moderator") {
          socket.emit("system", "❌ ეს მომხმარებელი Moderator არ არის.");
          return;
        }
        target.role = "member";
        const s = io.sockets.sockets.get(target.id);
        if (s) {
          s.emit("role", "member");
          s.emit("system", "თქვენ აღარ ხართ Moderator.");
        }
        io.emit("system", `⬇️ ${target.username}-ს ჩამოერთვა Moderator-ის წოდება.`);
        sendUserList();
        return;
      }

      if (command === "/announce") {
        if (!hasPermission(user, "announce")) {
          socket.emit("system", "❌ ამის უფლება არ გაქვს.");
          return;
        }
        const message = parts.slice(1).join(" ").trim();
        if (!message) {
          socket.emit("system", "გამოყენება: /announce ტექსტი");
          return;
        }
        io.emit("announcement", { from: user.username, text: message });
        return;
      }

      if (command === "/users") {
        const list = [...users.values()].map(u => `${u.username} [${u.role}]`).join(", ");
        socket.emit("system", `👥 Online: ${list || "არავინაა"}`);
        return;
      }

      if (command === "/help") {
        socket.emit("system", `ბრძანებები:
/users
/kick username
/mute username seconds
/announce ტექსტი

Admin:
/ban username
/promote username
/demote username`);
        return;
      }
    }

    io.emit("chatMessage", {
      username: user.username,
      text,
      role: user.role,
      time: new Date().toLocaleTimeString("ka-GE", {
        hour: "2-digit",
        minute: "2-digit"
      }),
      id: socket.id
    });
  });

  socket.on("typing", isTyping => {
    const user = getUser(socket.id);
    if (!user) return;
    socket.broadcast.emit("typing", {
      username: user.username,
      isTyping: !!isTyping
    });
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (!user) return;
    users.delete(socket.id);
    socket.broadcast.emit("system", `${user.username} გავიდა ჩატიდან 🔴`);
    sendUserList();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chat running at http://localhost:${PORT}`);
});
