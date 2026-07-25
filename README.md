# Bot Telegram tải video RedNote (dùng riêng cá nhân)

## Bước 1 — Tạo bot Telegram
1. Mở Telegram, tìm tài khoản **@BotFather**, bấm Start.
2. Gõ `/newbot`, đặt tên hiển thị (VD: RedNote Downloader) rồi đặt username (phải kết thúc bằng "bot", VD: `rednote_dl_bot`).
3. BotFather sẽ trả về 1 đoạn **token** dạng `123456:ABC-DEF...` — copy lại, đây chính là `BOT_TOKEN`.

## Bước 2 — Lấy Telegram User ID của bạn (để bot chỉ nghe lời bạn)
1. Trong Telegram, tìm tài khoản **@userinfobot**, bấm Start.
2. Nó sẽ trả về ID dạng số (VD: `123456789`) — đây chính là `OWNER_CHAT_ID`.

## Bước 3 — Đưa code lên GitHub
Giống cách bạn đã làm với web trước đó: tạo 1 repository mới, tải 3 file (`bot.js`, `package.json`, `README.md`) lên.

## Bước 4 — Deploy lên Render
1. Vào render.com, đăng nhập bằng GitHub.
2. Bấm "New" > "Web Service", chọn đúng repository vừa tạo.
3. Build Command: `npm install`. Start Command: `npm start`.
4. Vào tab "Environment", thêm 2 biến:
   - `BOT_TOKEN` = token lấy ở Bước 1
   - `OWNER_CHAT_ID` = ID lấy ở Bước 2
5. Bấm "Create Web Service", đợi vài phút để Render build và chạy.

## Bước 5 — Dùng thử
Mở Telegram, tìm đúng bot bạn vừa tạo, bấm Start, dán link RedNote vào — bot sẽ trả lời danh sách độ phân giải, bấm vào 1 lựa chọn để nhận link video gốc.

## Lưu ý
- Bot chỉ trả lời đúng tài khoản Telegram có ID trùng `OWNER_CHAT_ID` — người khác nhắn tin vào bot sẽ bị bot lặng lẽ bỏ qua, không phản hồi gì.
- Không có bước quảng cáo/chuyển hướng nào trong bot này.
- Vì Render free tier có thể "ngủ" sau 1 thời gian không hoạt động, bot polling có thể mất vài giây để "tỉnh dậy" sau khi bạn gửi tin nhắn đầu tiên sau 1 lúc lâu không dùng — đây là bình thường.
- Nếu muốn bot luôn phản hồi tức thì 24/7 không có độ trễ, cân nhắc nâng cấp lên gói trả phí của Render (~7$/tháng) giống như đã bàn với web trước đó.
