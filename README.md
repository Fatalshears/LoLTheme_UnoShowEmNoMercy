# Chơi Tới Bến

Game thẻ bài xả bài kết hợp sinh tồn, chủ đề Liên Minh Huyền Thoại, chơi 2–8 người qua mạng LAN (có bot).
Luật chơi: [`research/luat_choi_toi_ben_v4.md`](research/luat_choi_toi_ben_v4.md).

## Chạy game

Cần **Node.js 18 trở lên** (tải bản LTS tại https://nodejs.org).

- **Windows:** bấm đúp `start.bat`. Lần đầu nó tự cài thư viện.
- **Cách khác:** mở terminal trong thư mục này rồi chạy:

```
npm install
npm start
```

Cửa sổ server sẽ in ra địa chỉ, ví dụ:

```
Máy này:        http://localhost:3000
Trong mạng LAN: http://192.168.1.25:3000
```

- Máy chủ mở `http://localhost:3000`.
- Máy khác cùng mạng mở địa chỉ LAN. Lần đầu Windows có thể hỏi cho phép Node.js qua tường lửa: chọn **Allow** (mạng Private).
- Đổi cổng: `set PORT=4000` rồi chạy lại.

## Cách chơi

1. Nhập tên và bấm **Vào bàn**. Người vào đầu tiên là **Chủ phòng**.
2. Chủ phòng có thể **+ Thêm bot** để đủ người (2–8), rồi bấm **Bắt đầu**.
3. Bài đánh được sẽ nổi lên và có viền vàng; bấm để đánh. Lá Đa Sắc sẽ hỏi màu, số 7 sẽ hỏi người để tráo.
4. Không có bài hợp lệ: bấm **Rút bài** (hoặc bấm vào chồng rút ở góc trên bên trái) một lần, hệ thống tự rút đến khi ra lá đánh được hoặc đủ 3 lá.
5. Bị cộng dồn: đánh đè lá phạt có giá trị lớn hơn hoặc bằng, hoặc bấm **Chịu phạt**.
6. Còn 1 lá: khung tên người đó tự sáng hiệu ứng để cả bàn biết, không cần bấm gì.
7. Mỗi lượt có 45 giây; hết giờ hệ thống tự đánh thay.
8. ❓ mở bảng tra cứu hiệu ứng lá bài, 😀 mở bảng emote. Rê chuột lên lá bài để xem hiệu ứng.
9. Chủ phòng bấm ⚙ để **tạm dừng / tiếp tục** ván (đồng hồ lượt cũng dừng) hoặc **giải tán phòng** (mọi người về màn hình chính, điểm bị xoá).

**Rớt mạng / F5:** trình duyệt nhớ ghế của bạn; mở lại trang là vào lại đúng ghế. Ai mất kết nối quá 30 giây khi tới lượt thì hệ thống tự đánh thay.
Đổi sang máy khác: mở trang, bấm **Lấy lại ghế cũ?** và chọn tên mình.
Chủ phòng **bấm đúp vào ghế** của một người để bật/tắt tự đánh cho ghế đó.

**Server tắt giữa chừng:** trạng thái bàn được lưu ở `data/snapshot.json`; chạy lại server là chơi tiếp.

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `shared/engine.js` | Toàn bộ luật chơi (dùng chung server và trình duyệt) |
| `shared/bot.js` | Bot và tự đánh thay |
| `server/index.js` | Server LAN (Express + Socket.io), phòng chờ, vào lại ghế, lưu snapshot |
| `public/` | Giao diện bàn chơi, hiệu ứng, emote |
| `assets/cards/` | Hình lá bài, mặt sau, nền bàn |
| `assets/fx/` | Hiệu ứng đã tách từ Super Pixel Effects Gigapack và Effect and FX Pixel |
| `assets/ui/` | Biểu tượng nút (Free Icon Pack v3.1) |
| `assets/emotes/` | Emote (WebM, TGS, WebP) |
| `tools/` | `make_color_backs.py` (tạo mặt sau 4 màu), `prepare_fx.py` rồi `prepare_ui_assets.py` (tách hiệu ứng và biểu tượng từ các gói asset gốc) |
| `tests/` | `npm test`: chạy 1.500 ván bot và các tình huống luật |

Thêm emote: thả file `.webm`, `.tgs` hoặc `.webp` vào `assets/emotes/`, tải lại trang.

## Ghi công

- Hình lá bài, mặt sau và nền bàn: Duc.
- Hiệu ứng: **Super Pixel Effects Gigapack - Will Tice / unTied Games** (bản Free). Giấy phép cho phép đóng gói kèm game nhưng không cho phát tán lại riêng bộ asset, nên chỉ những hiệu ứng game dùng được đưa vào `assets/fx/`.
- Hiệu ứng pixel đổi màu, xúc xắc, chiến thắng: **Effect and FX Pixel** (bản Free).
- Biểu tượng nút, cúp, vương miện: **Free Icon Pack v3.1 (Basic)**.
- Font: Bungee và Be Vietnam Pro (Google Fonts).
