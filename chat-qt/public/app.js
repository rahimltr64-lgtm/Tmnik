const socket = io();

const elements = {
  authView: document.querySelector("#authView"),
  chatView: document.querySelector("#chatView"),

  displayName: document.querySelector("#displayName"),
  groupTitle: document.querySelector("#groupTitle"),

  createGroupBtn: document.querySelector("#createGroupBtn"),
  joinButton: document.querySelector("#joinButton"),
  scanButton: document.querySelector("#scanButton"),

  inviteInput: document.querySelector("#inviteInput"),
  scannerSection: document.querySelector("#scannerSection"),

  groupName: document.querySelector("#groupName"),
  connectionStatus: document.querySelector("#connectionStatus"),

  messages: document.querySelector("#messages"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),

  membersList: document.querySelector("#membersList"),
  memberCount: document.querySelector("#memberCount"),

  inviteCard: document.querySelector("#inviteCard"),
  qrImage: document.querySelector("#qrImage"),
  inviteLink: document.querySelector("#inviteLink"),

  copyButton: document.querySelector("#copyButton"),
  shareButton: document.querySelector("#shareButton"),
  leaveButton: document.querySelector("#leaveButton")
};

const state = {
  groupId: null,
  memberId: null,
  isCreator: false,
  joined: false,
  joining: false
};

let scanner = null;
let scannerRunning = false;

elements.displayName.value = localStorage.getItem("chat_name") || "";

function getDisplayName() {
  const name = elements.displayName.value.trim();

  if (!name) {
    elements.displayName.focus();
    showAlert("الرجاء إدخال اسمك أولًا");
    return "";
  }

  localStorage.setItem("chat_name", name);
  return name;
}

function showAlert(message) {
  window.alert(message);
}

function getGroupId(value) {
  const input = String(value || "").trim();

  if (!input) return null;

  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/group\/([^/?#]+)/);

    if (match) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    const match = input.match(
      /\/group\/([a-zA-Z0-9-]+)/
    );

    if (match) {
      return match[1];
    }
  }

  if (
    /^[a-zA-Z0-9-]{20,50}$/.test(input)
  ) {
    return input;
  }

  return null;
}

function showChat(title) {
  elements.authView.hidden = true;
  elements.chatView.hidden = false;
  elements.groupName.textContent = title || "مجموعة الأصدقاء";

  setTimeout(() => {
    elements.messageInput.focus();
  }, 100);
}

function prepareInvite(data) {
  state.isCreator = true;

  elements.inviteCard.hidden = false;
  elements.qrImage.src = data.qrDataUrl;
  elements.inviteLink.value = data.inviteUrl;
}

function renderMembers(members = []) {
  elements.memberCount.textContent = members.length;
  elements.membersList.replaceChildren();

  for (const member of members) {
    const row = document.createElement("div");
    row.className = "member";

    const avatar = document.createElement("span");
    avatar.className = "member-avatar";
    avatar.textContent = member.name.charAt(0).toUpperCase();

    const name = document.createElement("span");
    name.textContent = member.name;

    row.append(avatar, name);
    elements.membersList.append(row);
  }
}

function appendSystemMessage(text) {
  const item = document.createElement("div");
  item.className = "system-message";
  item.textContent = text;

  elements.messages.append(item);
  scrollMessages();
}

function appendMessage(message) {
  const item = document.createElement("div");
  item.className = "message";

  if (message.senderId === state.memberId) {
    item.classList.add("mine");
  }

  const header = document.createElement("div");
  header.className = "message-header";

  const sender = document.createElement("span");
  sender.className = "message-sender";
  sender.textContent = message.sender;

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = new Date(message.sentAt).toLocaleTimeString(
    "ar",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = message.text;

  header.append(sender, time);
  item.append(header, text);

  elements.messages.append(item);
  scrollMessages();
}

function scrollMessages() {
  elements.messages.scrollTop =
    elements.messages.scrollHeight;
}

function joinGroup(groupId) {
  const name = getDisplayName();

  if (!name) return;

  state.groupId = groupId;
  state.joining = true;

  socket.emit(
    "join-room",
    {
      groupId,
      name
    },
    (response) => {
      state.joining = false;

      if (!response?.ok) {
        showAlert(
          response?.error || "تعذر الانضمام إلى المجموعة"
        );
        return;
      }

      state.joined = true;
      state.memberId = response.memberId;

      showChat(response.group.title);
      renderMembers(response.members);

      appendSystemMessage(
        `أنت الآن عضوًا في مجموعة ${response.group.title}`
      );
    }
  );
}

elements.createGroupBtn.addEventListener("click", async () => {
  const creatorName = getDisplayName();

  if (!creatorName) return;

  elements.createGroupBtn.disabled = true;
  elements.createGroupBtn.textContent = "جارٍ إنشاء المجموعة...";

  try {
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        creatorName,
        title: elements.groupTitle.value.trim()
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر إنشاء المجموعة");
    }

    prepareInvite(data);
    joinGroup(data.group.id);
  } catch (error) {
    showAlert(error.message);
  } finally {
    elements.createGroupBtn.disabled = false;
    elements.createGroupBtn.textContent =
      "إنشاء المجموعة وعرض QR";
  }
});

elements.joinButton.addEventListener("click", () => {
  const groupId = getGroupId(elements.inviteInput.value);

  if (!groupId) {
    showAlert("أدخل رابط الدعوة أو كود المجموعة الصحيح");
    return;
  }

  state.isCreator = false;
  elements.inviteCard.hidden = true;

  joinGroup(groupId);
});

elements.messageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = elements.messageInput.value.trim();

  if (!text || !state.groupId) return;

  socket.emit(
    "group-message",
    {
      groupId: state.groupId,
      text
    },
    (response) => {
      if (!response?.ok) {
        showAlert(
          response?.error || "تعذر إرسال الرسالة"
        );
      }
    }
  );

  elements.messageInput.value = "";
  elements.messageInput.focus();
});

elements.copyButton.addEventListener("click", async () => {
  await copyText(elements.inviteLink.value);
  showAlert("تم نسخ رابط الدعوة");
});

elements.shareButton.addEventListener("click", async () => {
  const shareData = {
    title: "دعوة إلى مجموعة الدردشة",
    text: "انضم إلى مجموعة الدردشة عبر هذا الرابط",
    url: elements.inviteLink.value
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      // تم إلغاء المشاركة
    }
  } else {
    await copyText(elements.inviteLink.value);
    showAlert("تم نسخ رابط الدعوة");
  }
});

elements.leaveButton.addEventListener("click", () => {
  socket.emit("leave-room");

  state.groupId = null;
  state.memberId = null;
  state.joined = false;

  elements.chatView.hidden = true;
  elements.authView.hidden = false;
  elements.inviteCard.hidden = true;
  elements.messages.replaceChildren();
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";

    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function stopScanner() {
  if (!scanner) return;

  try {
    if (scannerRunning) {
      await scanner.stop();
    }

    scanner.clear();
  } catch {
    // تجاهل أخطاء إيقاف الكاميرا
  }

  scanner = null;
  scannerRunning = false;
  elements.scannerSection.hidden = true;
}

elements.scanButton.addEventListener("click", async () => {
  if (scanner) {
    await stopScanner();
    return;
  }

  if (!getDisplayName()) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showAlert(
      "الكاميرا غير مدعومة. استخدم HTTPS أو localhost."
    );
    return;
  }

  elements.scannerSection.hidden = false;
  scanner = new Html5Qrcode("qrReader");

  try {
    await scanner.start(
      {
        facingMode: "environment"
      },
      {
        fps: 10,
        qrbox: {
          width: 250,
          height: 250
        }
      },
      async (decodedText) => {
        const groupId = getGroupId(decodedText);

        if (!groupId) return;

        await stopScanner();

        state.isCreator = false;
        elements.inviteCard.hidden = true;

        elements.inviteInput.value = decodedText;
        joinGroup(groupId);
      },
      () => {
        // يتم تجاهل المحاولات التي لا تحتوي على QR
      }
    );

    scannerRunning = true;
  } catch (error) {
    await stopScanner();
    showAlert(
      "تعذر تشغيل الكاميرا. تأكد من السماح باستخدامها."
    );
  }
});

socket.on("connect", () => {
  elements.connectionStatus.textContent = "متصل";

  if (
    state.groupId &&
    !state.joined &&
    !state.joining
  ) {
    joinGroup(state.groupId);
  }
});

socket.on("disconnect", () => {
  state.joined = false;
  elements.connectionStatus.textContent = "غير متصل";
});

socket.on("members", (members) => {
  renderMembers(members);
});

socket.on("member-joined", ({ name }) => {
  appendSystemMessage(`${name} انضم إلى المجموعة`);
});

socket.on("member-left", ({ name }) => {
  appendSystemMessage(`${name} غادر المجموعة`);
});

socket.on("group-message", (message) => {
  appendMessage(message);
});

/**
 * فتح مجموعة مباشرة عند القدوم من رابط QR
 */
const pathMatch = window.location.pathname.match(
  /\/group\/([^/?#]+)/
);

if (pathMatch) {
  const groupId = decodeURIComponent(pathMatch[1]);

  elements.inviteInput.value = window.location.href;
  elements.groupTitle.value = "";
  elements.displayName.focus();
}
