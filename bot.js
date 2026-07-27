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
// Render tự đặt sẵn biến này = địa chỉ public của web service, VD:
// https://botvideonologo.onrender.com — không cần tự khai báo nếu
// đang chạy trên Render. Nếu chạy nơi khác, khai báo tay WEBHOOK_URL.
const WEBHOOK_BASE_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error("❌ Thiếu biến môi trường BOT_TOKEN. Vào BotFather lấy token rồi khai báo trong Render > Environment.");
  process.exit(1);
}
if (!OWNER_CHAT_ID) {
  console.error("❌ Thiếu biến môi trường OWNER_CHAT_ID. Xem README để biết cách lấy ID Telegram của bạn.");
  process.exit(1);
}
if (!WEBHOOK_BASE_URL) {
  console.error("❌ Không xác định được địa chỉ public của service (WEBHOOK_URL/RENDER_EXTERNAL_URL). Xem README.");
  process.exit(1);
}

// KHÔNG dùng polling nữa — dùng webhook để Telegram tự "gọi" đến
// server mỗi khi có tin nhắn mới, giúp Render tự tỉnh dậy khi có
// tin nhắn đến, không cần bạn tự vào web đánh thức thủ công nữa.
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const WEBHOOK_PATH = `/webhook/${BOT_TOKEN}`;

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
// PHẦN RIÊNG CHO INSTAGRAM
// Dùng "trang embed" của Instagram (vốn dùng để nhúng video lên
// website khác) — thường ít bị chặn hơn trang xem bình thường và
// không cần đăng nhập. Instagram chỉ cung cấp đúng 1 bản chất
// lượng (không có nhiều mức như RedNote).
// --------------------------------------------------------------

function extractInstagramShortcode(text) {
  const match = text.match(
    /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i
  );
  return match ? match[1] : null;
}

async function getInstagramQualities(rawText) {
  const shortcode = extractInstagramShortcode(rawText);
  if (!shortcode) throw new Error("Không tìm thấy link Instagram hợp lệ trong nội dung bạn gửi.");

  const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;
  const res = await fetch(embedUrl, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Không tải được trang Instagram, mã lỗi: ${res.status}`);
  const html = await res.text();

  // Tìm URL video trong dữ liệu JSON nhúng sẵn trong trang (dạng
  // "video_url":"https:\/\/..." — dấu / bị escape nên cần thay lại)
  let match = html.match(/"video_url":"([^"]+)"/);
  let videoUrl = match ? match[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&") : null;

  // Nếu không thấy trong JSON, thử tìm trực tiếp thẻ <video src="...">
  if (!videoUrl) {
    match = html.match(/<video[^>]+src="([^"]+)"/);
    videoUrl = match ? match[1].replace(/&amp;/g, "&") : null;
  }

  if (!videoUrl) {
    throw new Error("Không tìm thấy video (có thể bài viết này là ảnh, ở chế độ riêng tư, hoặc Instagram đã đổi cấu trúc).");
  }

  return [{ label: "Bản gốc — không logo", height: 0, bitrate: 0, url: videoUrl }];
}

// --------------------------------------------------------------
// Nhận diện link thuộc nền tảng nào (RedNote hay Instagram) và gọi
// đúng hàm xử lý tương ứng
// --------------------------------------------------------------
async function getQualitiesForAnyPlatform(text) {
  if (/xiaohongshu\.com|xhslink\.(com|cn)/i.test(text)) {
    return getRedNoteQualities(text);
  }
  if (/instagram\.com/i.test(text)) {
    return getInstagramQualities(text);
  }
  throw new Error("Chưa nhận diện được đây là link RedNote hay Instagram. Gửi đúng link bài viết nhé.");
}

// --------------------------------------------------------------
// Xử lý tin nhắn Telegram
// --------------------------------------------------------------

// Lưu tạm kết quả gần nhất theo từng chat, để khi bấm nút inline
// biết phải trả về link nào (Telegram không gửi kèm dữ liệu lớn
// qua callback_data được, nên phải lưu tạm ở bộ nhớ server)
const pendingResults = new Map();

bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text || "";

    // Chỉ trả lời đúng chủ sở hữu, bỏ qua hoàn toàn tin nhắn từ người khác
    if (String(chatId) !== String(OWNER_CHAT_ID)) {
      console.log(`Bỏ qua tin nhắn từ chat lạ: ${chatId}`);
      return;
    }

    if (text === "/start") {
      await safeSend(chatId, "Chào bạn 👋 Dán link RedNote hoặc Instagram vào đây, mình sẽ tìm video không logo cho bạn.");
      return;
    }

    if (!text.trim()) return;

    const processingMsg = await safeSend(chatId, "Đang xử lý link, đợi chút...");

    try {
      const qualities = await getQualitiesForAnyPlatform(text);

      const keyboard = qualities.slice(0, 10).map((q, i) => [
        { text: q.label, callback_data: `dl_${i}` },
      ]);

      // Lưu tạm danh sách link theo chatId để dùng khi bấm nút
      pendingResults.set(chatId, qualities);

      await safeEdit(chatId, processingMsg?.message_id, `Tìm thấy ${qualities.length} độ phân giải, chọn 1 cái bên dưới:`, {
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (err) {
      console.error("Lỗi khi xử lý link:", err);
      await safeEdit(chatId, processingMsg?.message_id, `❌ Lỗi: ${err.message}`);
    }
  } catch (outerErr) {
    // Lưới an toàn cuối cùng — dù có lỗi gì bất ngờ xảy ra, KHÔNG để
    // nó làm sập cả tiến trình server. Chỉ ghi log để biết mà thôi.
    console.error("Lỗi không mong muốn trong message handler:", outerErr);
  }
});

// Gửi tin nhắn kiểu "an toàn" — nếu gọi API Telegram lỗi, chỉ ghi
// log chứ không throw ra ngoài làm sập tiến trình.
async function safeSend(chatId, text, extra) {
  try {
    return await bot.sendMessage(chatId, text, extra);
  } catch (err) {
    console.error("Lỗi khi gửi tin nhắn:", err.message);
    return null;
  }
}

// Sửa tin nhắn kiểu "an toàn" — nếu sửa lỗi (VD tin nhắn đã bị xóa),
// tự động chuyển sang gửi tin nhắn mới thay vì làm sập tiến trình.
async function safeEdit(chatId, messageId, text, extra = {}) {
  if (!messageId) return safeSend(chatId, text, extra);
  try {
    return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...extra });
  } catch (err) {
    console.error("Lỗi khi sửa tin nhắn, chuyển sang gửi tin mới:", err.message);
    return safeSend(chatId, text, extra);
  }
}

bot.on("callback_query", async (query) => {
  try {
    const chatId = query.message.chat.id;
    if (String(chatId) !== String(OWNER_CHAT_ID)) return;

    const match = query.data.match(/^dl_(\d+)$/);
    if (!match) return;

    const qualities = pendingResults.get(chatId);
    const q = qualities?.[Number(match[1])];

    if (!q) {
      await bot.answerCallbackQuery(query.id, { text: "Link đã hết hạn, gửi lại link RedNote nhé." }).catch(() => {});
      return;
    }

    await bot.answerCallbackQuery(query.id).catch(() => {});
    await safeSend(chatId, `🎬 ${q.label}\n${q.url}`);
  } catch (err) {
    console.error("Lỗi trong callback_query handler:", err);
  }
});

// Lưới an toàn cấp cao nhất — chặn mọi lỗi bất ngờ (kể cả lỗi ở nơi
// mình không lường trước) khiến toàn bộ tiến trình Node bị sập.
// Không có 2 dòng này, Node mặc định sẽ TỰ TẮT server khi gặp lỗi
// dạng "unhandled rejection" — đây chính là nguyên nhân khiến bot
// im lặng hẳn trước đó.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection (đã chặn, server vẫn sống):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception (đã chặn, server vẫn sống):", err);
});

// (Không còn dòng log "polling" nữa — bot giờ chạy theo kiểu webhook,
// xem log "Đã đăng ký webhook" ở cuối file để biết đã sẵn sàng chưa)

// --------------------------------------------------------------
// Server Express nhận webhook từ Telegram (thay cho polling).
// Mỗi khi bạn gửi tin nhắn, Telegram sẽ tự gọi vào đúng đường dẫn
// WEBHOOK_PATH này — nếu Render đang "ngủ", chính request này sẽ
// khiến Render tự khởi động lại service, không cần bạn vào web
// thủ công nữa.
// --------------------------------------------------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("Bot đang chạy."));

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  console.log(`Web server đang chạy ở cổng ${PORT}`);
  try {
    await bot.setWebHook(`${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`);
    console.log(`✅ Đã đăng ký webhook: ${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`);
  } catch (err) {
    console.error("❌ Đăng ký webhook thất bại:", err.message);
  }
});
