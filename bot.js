// ============================================================
// BOT.JS — Bot Telegram cá nhân
// Dán link RedNote vào chat với bot, bot trả về danh sách độ
// phân giải kèm link video gốc (không logo). Chỉ 1 mình bạn
// (chủ sở hữu, xác định qua OWNER_CHAT_ID) mới dùng được bot này.
// Không có bước quảng cáo/chuyển hướng nào.
// ============================================================

import TelegramBot from "node-telegram-bot-api";
import express from "express";

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID; // ID Telegram của bạn (dạng số)
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("❌ Thiếu biến môi trường BOT_TOKEN. Vào BotFather lấy token rồi khai báo trong Render > Environment.");
  process.exit(1);
}
if (!OWNER_CHAT_ID) {
  console.error("❌ Thiếu biến môi trường OWNER_CHAT_ID. Xem README để biết cách lấy ID Telegram của bạn.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// --------------------------------------------------------------
// Các hàm xử lý RedNote — giống hệt logic bên web, chỉ copy sang
// --------------------------------------------------------------

function extractUrlFromText(text) {
  const match = text.match(
    /https?:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.(?:com|cn))\/\S+/i
  );
  if (!match) return null;
  return match[0].replace(/[),.。!!?？]+$/, "");
}

async function resolveShortLink(url) {
  const res = await fetch(url, { method: "GET", redirect: "follow", headers: BROWSER_HEADERS });
  return res.url;
}

async function fetchNoteHtml(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Không tải được trang, mã lỗi: ${res.status}`);
  return res.text();
}

function extractInitialState(html) {
  const marker = "window.__INITIAL_STATE__=";
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) {
    throw new Error("Không tìm thấy dữ liệu bài viết (RedNote đổi cấu trúc, hoặc cần đăng nhập).");
  }
  const jsonStart = startIdx + marker.length;
  const scriptEnd = html.indexOf("</script>", jsonStart);
  let raw = html.slice(jsonStart, scriptEnd).trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1);
  raw = raw.replace(/undefined/g, "null");
  return JSON.parse(raw);
}

function findAllVideoStreams(node, found = [], seenUrls = new Set()) {
  if (!node) return found;

  if (typeof node === "string" && (node.startsWith("{") || node.startsWith("["))) {
    try {
      findAllVideoStreams(JSON.parse(node), found, seenUrls);
    } catch {
      // bỏ qua nếu không phải JSON hợp lệ
    }
    return found;
  }

  if (typeof node !== "object") return found;

  const url = node.masterUrl || node.master_url ||
    (Array.isArray(node.backupUrls) && node.backupUrls[0]) ||
    (Array.isArray(node.backup_urls) && node.backup_urls[0]);
  const width = node.width;
  const height = node.height;
  const looksLikeStream = url && typeof url === "string" && url.startsWith("http") && (width || height);

  if (looksLikeStream && !seenUrls.has(url)) {
    seenUrls.add(url);
    found.push({
      width: width || 0,
      height: height || 0,
      bitrate: node.videoBitrate || node.video_bitrate || node.avgBitrate || node.avg_bitrate || 0,
      size: node.size || node.videoSize || 0,
      url,
    });
  }

  for (const key of ["default_screencast_stream", "hd_screencast_stream"]) {
    const extraUrl = node?.opaque1?.[key];
    if (extraUrl && typeof extraUrl === "string" && extraUrl.startsWith("http") && !seenUrls.has(extraUrl)) {
      seenUrls.add(extraUrl);
      found.push({ width: 0, height: 0, bitrate: 0, size: 0, url: extraUrl, unknownQuality: true });
    }
  }

  for (const key of Object.keys(node)) {
    const child = node[key];
    if (child && (typeof child === "object" || typeof child === "string")) {
      findAllVideoStreams(child, found, seenUrls);
    }
  }
  return found;
}

function extractVideoQualities(state) {
  const noteMap = state?.note?.noteDetailMap;
  if (!noteMap) throw new Error("Không tìm thấy dữ liệu note trong state.");

  const firstNoteId = Object.keys(noteMap)[0];
  const note = noteMap[firstNoteId]?.note;
  if (!note?.video) throw new Error("Bài viết này có thể không phải là video (có thể là ảnh).");

  const allStreams = findAllVideoStreams(note.video);

  return allStreams.map((s) => {
    if (s.unknownQuality) {
      return { label: "Bản dự phòng (chưa rõ độ phân giải)", height: 0, bitrate: -1, url: s.url };
    }
    const sizeLabel = s.size ? ` · ${(s.size / 1024 / 1024).toFixed(1)}MB` : "";
    return { label: `${s.height}p${sizeLabel}`, height: s.height, bitrate: s.bitrate, url: s.url };
  });
}

async function getRedNoteQualities(rawText) {
  const url = extractUrlFromText(rawText);
  if (!url) throw new Error("Không tìm thấy link RedNote hợp lệ trong nội dung bạn gửi.");

  let fullUrl = url;
  if (url.includes("xhslink.com") || url.includes("xhslink.cn")) {
    fullUrl = await resolveShortLink(url);
  }

  const html = await fetchNoteHtml(fullUrl);
  const state = extractInitialState(html);
  const qualities = extractVideoQualities(state);

  if (qualities.length === 0) throw new Error("Không tìm thấy video nào trong link này.");

  qualities.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return qualities;
}

// --------------------------------------------------------------
// Xử lý tin nhắn Telegram
// --------------------------------------------------------------

// Lưu tạm kết quả gần nhất theo từng chat, để khi bấm nút inline
// biết phải trả về link nào (Telegram không gửi kèm dữ liệu lớn
// qua callback_data được, nên phải lưu tạm ở bộ nhớ server)
const pendingResults = new Map();

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  // Chỉ trả lời đúng chủ sở hữu, bỏ qua hoàn toàn tin nhắn từ người khác
  if (String(chatId) !== String(OWNER_CHAT_ID)) {
    console.log(`Bỏ qua tin nhắn từ chat lạ: ${chatId}`);
    return;
  }

  if (text === "/start") {
    bot.sendMessage(chatId, "Chào bạn 👋 Dán link RedNote vào đây, mình sẽ tìm video không logo cho bạn.");
    return;
  }

  if (!text.trim()) return;

  const processingMsg = await bot.sendMessage(chatId, "Đang xử lý link, đợi chút...");

  try {
    const qualities = await getRedNoteQualities(text);

    const keyboard = qualities.slice(0, 10).map((q, i) => [
      { text: q.label, callback_data: `dl_${i}` },
    ]);

    // Lưu tạm danh sách link theo chatId để dùng khi bấm nút
    pendingResults.set(chatId, qualities);

    await bot.editMessageText(`Tìm thấy ${qualities.length} độ phân giải, chọn 1 cái bên dưới:`, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    await bot.editMessageText(`❌ Lỗi: ${err.message}`, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
    });
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  if (String(chatId) !== String(OWNER_CHAT_ID)) return;

  const match = query.data.match(/^dl_(\d+)$/);
  if (!match) return;

  const qualities = pendingResults.get(chatId);
  const q = qualities?.[Number(match[1])];

  if (!q) {
    await bot.answerCallbackQuery(query.id, { text: "Link đã hết hạn, gửi lại link RedNote nhé." });
    return;
  }

  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(chatId, `🎬 ${q.label}\n${q.url}`);
});

console.log("🤖 Bot Telegram đang chạy (polling)...");

// --------------------------------------------------------------
// Server Express nhỏ chỉ để Render nhận diện có cổng đang mở
// (Render yêu cầu Web Service phải lắng nghe 1 cổng để không tự
// tắt) — không phục vụ chức năng gì khác ngoài việc "báo còn sống"
// --------------------------------------------------------------
const app = express();
app.get("/", (req, res) => res.send("Bot đang chạy."));
app.listen(PORT, () => console.log(`Web server phụ đang chạy ở cổng ${PORT} (chỉ để Render không tắt bot)`));
