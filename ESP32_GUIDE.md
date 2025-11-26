# 📡 Hướng dẫn ESP32 - Smart Parking System

> **Tài liệu cho lập trình viên ESP32**  
> Chỉ mô tả cấu trúc Firebase và logic hoạt động

---

## 🎯 Phần cứng đơn giản

```
- 3 Slot đỗ xe (Slot01, Slot02, Slot03)
- 3 Cảm biến HC-SR04 (mỗi slot 1 cảm biến)
- 3 LED đỏ (mỗi slot 1 LED)
- 1 Đầu đọc RFID (RC522) - Dùng chung để vào/ra bãi
- 1 Servo barrier
```

---

## 🔥 Firebase URL

```
https://smartpaking-72448-default-rtdb.firebaseio.com/
```

---

## 📊 Cấu trúc Firebase

### 1. **Slots/** - Trạng thái 3 slot

```json
{
  "Slots": {
    "Slot01": {
      "status": "empty",
      "has_car": false,
      "booked_by": null,
      "expire_time": null
    },
    "Slot02": {
      "status": "booked",
      "has_car": false,
      "booked_by": "user123",
      "expire_time": 1732612800000
    },
    "Slot03": {
      "status": "occupied",
      "has_car": true,
      "booked_by": null,
      "expire_time": null
    }
  }
}
```

**Giải thích:**
- `status`: `"empty"` | `"booked"` | `"occupied"`
- `has_car`: `true`/`false` - **ESP32 ghi**
- `booked_by`: Username người đặt (do Web ghi)
- `expire_time`: Thời gian hết hạn booking (timestamp milliseconds)

### 2. **RegisteredCards/** - Danh sách thẻ RFID

```json
{
  "RegisteredCards": {
    "A1B2C3D4": {
      "card_id": "A1B2C3D4",
      "registered_at": 1732520000000,
      "status": "active"
    },
    "E5F6G7H8": {
      "card_id": "E5F6G7H8",
      "registered_at": 1732520100000,
      "status": "inactive"
    }
  }
}
```

**Giải thích:**
- `card_id`: UID của thẻ RFID (VD: "A1B2C3D4")
- `status`: `"active"` (cho phép vào) hoặc `"inactive"` (bị khóa)

### 3. **Commands/CardRegistration** - Đăng ký thẻ

```json
{
  "Commands": {
    "CardRegistration": {
      "type": "card_registration",
      "command_id": "reg_1732520000000",
      "timestamp": 1732520000000,
      "status": "waiting",
      "card_id": null
    }
  }
}
```

**Giải thích:**
- `status`: 
  - `"waiting"` - ESP32 phải đọc thẻ
  - `"completed"` - ESP32 đã đọc xong
- `card_id`: **ESP32 ghi** UID thẻ vào đây khi đọc được

---

## 🔄 Logic hoạt động

### 📌 Nhiệm vụ 1: Điều khiển LED theo booking

**Web → Firebase:**
```
User book Slot01
→ Slots/Slot01/status = "booked"
→ Slots/Slot01/expire_time = 1732612800000
```

**ESP32 phải làm:**
1. Đọc `Slots/Slot01/status` từ Firebase
2. Đọc `Slots/Slot01/has_car` từ Firebase
3. Điều khiển LED:
   ```
   Nếu has_car = true       → LED ĐỎ
   Nếu status = "booked"    → LED ĐỎ
   Nếu status = "empty"     → LED TẮT (hoặc xanh)
   ```

**Ưu tiên:**
```
1. has_car = true     → ĐỎ (ưu tiên cao nhất)
2. status = "booked"  → ĐỎ
3. status = "empty"   → TẮT
```

---

### 📌 Nhiệm vụ 2: Đọc cảm biến HC-SR04 và cập nhật Firebase

**ESP32 phải làm:**

1. **Đọc cảm biến** (mỗi 500ms):
   ```
   Khoảng cách < 20cm → Có xe
   Khoảng cách > 20cm → Không có xe
   ```

2. **Ghi lên Firebase** khi có thay đổi:
   ```
   Có xe:
     Slots/Slot01/has_car = true
     Slots/Slot01/status = "occupied"
   
   Không có xe:
     Slots/Slot01/has_car = false
     Nếu status không phải "booked":
       Slots/Slot01/status = "empty"
   ```

**Lưu ý:** Chỉ ghi khi có thay đổi, không ghi liên tục!

---

### 📌 Nhiệm vụ 3: Đăng ký thẻ RFID

**Khi Admin nhấn "Đăng ký thẻ" trên web:**

Web ghi:
```json
Commands/CardRegistration: {
  "status": "waiting",
  "command_id": "reg_1732520000000"
}
```

**ESP32 phải làm:**

1. **Lắng nghe** `Commands/CardRegistration/status`
2. **Khi status = "waiting":**
   - Bật chế độ đọc thẻ
   - Đợi user quẹt thẻ
3. **Khi đọc được thẻ:**
   - Lấy UID thẻ (VD: "A1B2C3D4")
   - Ghi lên Firebase:
     ```
     Commands/CardRegistration/card_id = "A1B2C3D4"
     Commands/CardRegistration/status = "completed"
     ```

**Web sẽ tự động nhận `card_id` và lưu vào `RegisteredCards/`**

---

### 📌 Nhiệm vụ 4: Quẹt thẻ để vào/ra bãi

**User quẹt thẻ RFID vào đầu đọc:**

**ESP32 phải làm:**

1. **Đọc thẻ RFID** → Lấy UID (VD: "A1B2C3D4")

2. **Kiểm tra trong Firebase:**
   ```
   Đọc: RegisteredCards/A1B2C3D4
   ```

3. **Xử lý:**
   ```
   Nếu thẻ TỒN TẠI và status = "active":
     → Mở barrier (Servo 90°)
     → Đợi 5 giây
     → Đóng barrier (Servo 0°)
   
   Nếu thẻ KHÔNG TỒN TẠI hoặc status = "inactive":
     → Báo lỗi (LED nhấp nháy)
     → Không mở barrier
   ```

**Lưu ý:** RFID chỉ để VÀO/RA bãi, KHÔNG LIÊN QUAN đến slot cụ thể!

---

## 📋 Tóm tắt công việc ESP32

### ✅ Đọc từ Firebase:
1. `Slots/<SlotID>/status` → Điều khiển LED
2. `Commands/CardRegistration/status` → Check lệnh đăng ký thẻ
3. `RegisteredCards/<CardID>` → Check thẻ hợp lệ

### ✅ Ghi lên Firebase:
1. `Slots/<SlotID>/has_car` → true/false
2. `Slots/<SlotID>/status` → "occupied" hoặc "empty"
3. `Commands/CardRegistration/card_id` → UID thẻ
4. `Commands/CardRegistration/status` → "completed"

### ✅ Điều khiển:
1. **3 LED đỏ** (theo status + has_car)
2. **Servo barrier** (theo RFID check)

---

## 🎬 Các kịch bản cụ thể

### Kịch bản 1: User đặt chỗ từ Web

```
1. Web ghi: Slots/Slot01/status = "booked"
2. ESP32 đọc realtime
3. ESP32 bật LED đỏ Slot01
```

### Kịch bản 2: Xe vào slot

```
1. Cảm biến HC-SR04 đo < 20cm
2. ESP32 ghi: 
   - Slots/Slot01/has_car = true
   - Slots/Slot01/status = "occupied"
3. Web nhận realtime → Đổi màu UI
4. LED đỏ vẫn sáng
```

### Kịch bản 3: Xe ra khỏi slot

```
1. Cảm biến HC-SR04 đo > 20cm
2. ESP32 ghi:
   - Slots/Slot01/has_car = false
3. Kiểm tra status:
   - Nếu status = "booked" → Giữ nguyên (vẫn đỏ)
   - Nếu status != "booked" → Ghi status = "empty" (LED tắt)
```

### Kịch bản 4: Đăng ký thẻ

```
1. Admin click "Đăng ký thẻ" trên web
2. Web ghi: Commands/CardRegistration/status = "waiting"
3. ESP32 nhận lệnh → Bật chế độ đọc thẻ
4. User quẹt thẻ
5. ESP32 đọc UID: "A1B2C3D4"
6. ESP32 ghi:
   - Commands/CardRegistration/card_id = "A1B2C3D4"
   - Commands/CardRegistration/status = "completed"
7. Web nhận card_id → Lưu vào RegisteredCards/A1B2C3D4
```

### Kịch bản 5: Xe vào bãi bằng thẻ

```
1. User quẹt thẻ tại cổng
2. ESP32 đọc UID: "A1B2C3D4"
3. ESP32 check: RegisteredCards/A1B2C3D4
4. Nếu tồn tại và status = "active":
   - Servo quay 90° (mở)
   - Đợi 5 giây
   - Servo quay 0° (đóng)
5. Nếu không hợp lệ:
   - LED nhấp nháy 3 lần
   - Không mở barrier
```

---

## 🔍 Quan trọng - Đừng nhầm lẫn!

### ❌ SAI:
- RFID để biết xe vào slot nào
- Mỗi slot có 1 đầu đọc RFID
- Phải quẹt thẻ cho từng slot

### ✅ ĐÚNG:
- RFID CHỈ để vào/ra bãi (barrier)
- Chỉ có 1 đầu đọc RFID ở cổng
- Cảm biến HC-SR04 mới biết slot nào có xe

---

## 📊 Sơ đồ kết nối đơn giản

```
┌─────────────────────────────────────┐
│  ESP32                              │
├─────────────────────────────────────┤
│                                     │
│  3 Cảm biến HC-SR04:                │
│    - Slot01 (Trig/Echo)             │
│    - Slot02 (Trig/Echo)             │
│    - Slot03 (Trig/Echo)             │
│                                     │
│  3 LED đỏ:                          │
│    - LED Slot01                     │
│    - LED Slot02                     │
│    - LED Slot03                     │
│                                     │
│  1 RFID RC522 (SPI):                │
│    - SDA, SCK, MOSI, MISO, RST      │
│                                     │
│  1 Servo:                           │
│    - PWM pin                        │
│                                     │
└─────────────────────────────────────┘
```

---

## ⏱️ Timing đề xuất

```
- Đọc cảm biến: Mỗi 500ms
- Đọc Firebase (Slots): Realtime listener
- Đọc RFID: Continuous scan
- Ghi Firebase: Chỉ khi có thay đổi
```

---

## 🎯 Checklist cho lập trình viên ESP32

### Phase 1: Firebase
- [ ] Kết nối WiFi
- [ ] Kết nối Firebase
- [ ] Test đọc/ghi data

### Phase 2: LED theo booking
- [ ] Đọc `Slots/<SlotID>/status` realtime
- [ ] Đọc `Slots/<SlotID>/has_car` realtime
- [ ] Bật/tắt LED theo logic ưu tiên

### Phase 3: Cảm biến
- [ ] Đọc 3 HC-SR04
- [ ] Ghi `has_car` lên Firebase khi thay đổi
- [ ] Ghi `status` lên Firebase khi cần

### Phase 4: Đăng ký thẻ
- [ ] Lắng nghe `Commands/CardRegistration/status`
- [ ] Đọc thẻ RFID khi `status = "waiting"`
- [ ] Ghi `card_id` và `status = "completed"`

### Phase 5: Check-in RFID
- [ ] Scan thẻ RFID liên tục
- [ ] Check `RegisteredCards/<CardID>`
- [ ] Mở barrier nếu hợp lệ

---

## 📝 Notes quan trọng

1. **Chỉ ghi Firebase khi có thay đổi** - Tránh spam
2. **RFID chỉ để vào/ra bãi** - Không liên quan slot
3. **Cảm biến HC-SR04 quyết định slot có xe** - Không phải RFID
4. **LED đỏ khi**: `has_car = true` HOẶC `status = "booked"`
5. **Web tự động check expire** - ESP32 không cần làm

---

## ❓ FAQ

**Q: ESP32 có cần check expire_time không?**  
A: KHÔNG. Web tự động check mỗi 2 giây và cập nhật status.

**Q: RFID để làm gì?**  
A: CHỈ để vào/ra bãi (mở barrier). Không liên quan đến slot cụ thể.

**Q: Làm sao biết xe vào slot nào?**  
A: Dùng cảm biến HC-SR04 ở mỗi slot.

**Q: Khi nào LED đỏ sáng?**  
A: Khi `has_car = true` HOẶC `status = "booked"`.

**Q: Có cần code phức tạp không?**  
A: KHÔNG. Chỉ cần:
- Đọc cảm biến → Ghi Firebase
- Đọc Firebase → Bật LED
- Đọc RFID → Check → Mở barrier

---

**Chúc code thành công! 🚀**

