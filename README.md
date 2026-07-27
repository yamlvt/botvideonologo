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
   - (Không cần tự thêm `WEBHOOK_URL` — Render tự động cấp sẵn biến `RENDER_EXTERNAL_URL`, code đã tự dùng biến này.)
5. Bấm "Create Web Service", đợi vài phút để Render build và chạy.
6. Vào tab "Logs", tìm dòng "✅ Đã đăng ký webhook: https://...". Thấy dòng này là bot đã sẵn sàng nhận tin nhắn.

## Vì sao đổi từ "polling" sang "webhook"?
Ban đầu bot dùng kiểu polling (tự hỏi Telegram liên tục "có tin gì mới không?"). Vấn đề: khi Render "ngủ" do không có ai gửi yêu cầu HTTP trong 15 phút, polling cũng dừng theo — và gửi tin nhắn Telegram thì KHÔNG tính là yêu cầu HTTP tới Render, nên bot ngủ luôn, không tự thức dậy được.

Với webhook: mỗi tin nhắn bạn gửi trong Telegram sẽ khiến Telegram tự gọi thẳng 1 yêu cầu HTTP đến server bot — chính yêu cầu này sẽ đánh thức Render tự động. Bạn không cần vào web thủ công nữa.

**Lưu ý nhỏ:** nếu bot đã ngủ lâu, tin nhắn ĐẦU TIÊN sau khi ngủ có thể không có phản hồi ngay (vì Render cần 30-60 giây để khởi động lại, trong khi Telegram chỉ chờ khoảng vài chục giây trước khi bỏ qua) — nhưng Telegram sẽ tự động gửi lại (retry) sau đó, nên thường chỉ cần đợi thêm chút hoặc gửi lại tin nhắn 1 lần nữa là bot phản hồi bình thường.

## Bước 5 — Dùng thử
Mở Telegram, tìm đúng bot bạn vừa tạo, bấm Start, dán link RedNote vào — bot sẽ trả lời danh sách độ phân giải, bấm vào 1 lựa chọn để nhận link video gốc.

## Lưu ý
- Bot chỉ trả lời đúng tài khoản Telegram có ID trùng `OWNER_CHAT_ID` — người khác nhắn tin vào bot sẽ bị bot lặng lẽ bỏ qua, không phản hồi gì.
- Không có bước quảng cáo/chuyển hướng nào trong bot này.
- Bot dùng webhook nên khi Render "ngủ", tin nhắn Telegram của bạn sẽ tự đánh thức lại — không cần vào web thủ công (xem thêm phần giải thích phía trên).
- Nếu muốn bot luôn phản hồi tức thì 24/7 không có độ trễ dù mới ngủ dậy, cân nhắc nâng cấp lên gói trả phí của Render (~7$/tháng) giống như đã bàn với web trước đó.

## Về phần Instagram (dùng Puppeteer)
- Instagram cần mở hẳn 1 trình duyệt Chrome ẩn để lấy được video (không có cách đơn giản như RedNote), nên:
  - **Build lần đầu trên Render sẽ lâu hơn** (thêm ~1-2 phút vì phải tải Chromium ~300MB).
  - **Mỗi lần xử lý 1 link Instagram sẽ chậm hơn** (vài giây đến chục giây, tùy mạng) và **tốn RAM hơn nhiều** so với RedNote.
  - Gói Render miễn phí (RAM giới hạn, thường 512MB) **có thể bị hết bộ nhớ (out of memory) và tự khởi động lại** nếu máy đang tải nhiều việc cùng lúc — nếu gặp tình trạng bot xử lý Instagram hay bị "treo" hoặc tự restart, đây là dấu hiệu cần cân nhắc nâng cấp lên gói trả phí có nhiều RAM hơn.
- TikTok và Douyin vẫn CHƯA được hỗ trợ — cả 2 đều chống bot ở mức cao hơn Instagram, cần thêm công sức đáng kể nếu muốn làm tiếp.
