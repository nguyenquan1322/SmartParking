# 🔥 Cấu trúc Firebase Realtime Database

## 📊 Cấu trúc chính

```json
{
  "Slots": {
    "Slot01": {
      "slot_id": "Slot01",
      "display_name": "A1",
      "status": "empty",         // "empty", "booked", "occupied"
      "has_car": false,           // true/false từ cảm biến ESP32
      "booked_by": null,
      "expire_time": null,
      "book_date": null,
      "book_time": null,
      "booked_at": null
    },
    "Slot02": {
      "slot_id": "Slot02",
      "display_name": "A2",
      "status": "booked",
      "has_car": false,
      "booked_by": "user123",
      "expire_time": 1732612800000,
      "book_date": "2025-11-26",
      "book_time": "10:00",
      "booked_at": 1732520000000
    },
    "Slot03": {
      "slot_id": "Slot03",
      "display_name": "A3",
      "status": "occupied",
      "has_car": true,            // Xe đã vào (từ ESP32)
      "booked_by": null,
      "expire_time": null,
      "book_date": null,
      "book_time": null,
      "booked_at": null
    }
  },
  
  "RegisteredCards": {
    "A1B2C3D4": {
      "card_id": "A1B2C3D4",
      "registered_at": 1732520000000,
      "status": "active"
    }
  },
  
  "Users": {
    "user123": {
      "password": "pass123"
    }
  }
}
```

## 🔄 Quy trình hoạt động

### 1️⃣ USER BOOK CHỖ (Web → Firebase)

**Web ghi vào `Slots/<SlotID>`:**
```javascript
Slots/Slot01: {
  status: "booked",
  booked_by: "user123",
  expire_time: 1732612800000,    // Timestamp
  book_date: "2025-11-26",
  book_time: "10:00",
  booked_at: 1732520000000
}
```

### 2️⃣ ESP32 NHẬN BOOKING (Firebase → ESP32)

**ESP32 lắng nghe `Slots/<SlotID>`:**
```cpp
// ESP32 Code
firebase.on("Slots/Slot01", [](FirebaseData data) {
  if (data.get("status") == "booked") {
    // BẬT ĐÈN ĐỎ Ở SLOT 1
    digitalWrite(RED_LED_SLOT01, HIGH);
  }
});
```

### 3️⃣ HẾT THỜI GIAN BOOKING (Web Auto-Check)

**Web check mỗi 2 giây, nếu hết hạn:**
```javascript
// Web tự động ghi
Slots/Slot01: {
  status: "empty",
  booked_by: null,
  expire_time: null,
  book_date: null,
  book_time: null,
  booked_at: null
}
```

**ESP32 nhận và TẮT ĐÈN:**
```cpp
if (data.get("status") == "empty") {
  digitalWrite(RED_LED_SLOT01, LOW);  // TẮT ĐÈN ĐỎ
}
```

### 4️⃣ XE VÀO BÃI (ESP32 → Firebase)

**ESP32 phát hiện xe và ghi:**
```cpp
// Cảm biến phát hiện xe
if (sensorValue == HIGH) {
  firebase.set("Slots/Slot01/has_car", true);
  firebase.set("Slots/Slot01/status", "occupied");
}
```

**Web nhận realtime và đổi màu:**
```javascript
// Web tự động cập nhật UI
if (slot.has_car === true) {
  box.classList.add("occupied");  // Màu đỏ
  status.innerText = "CÓ XE";
}
```

### 5️⃣ XE RA KHỎI BÃI (ESP32 → Firebase)

**ESP32 cảm biến không thấy xe:**
```cpp
if (sensorValue == LOW) {
  firebase.set("Slots/Slot01/has_car", false);
  firebase.set("Slots/Slot01/status", "empty");
}
```

**Web nhận và đổi sang màu xanh:**
```javascript
if (slot.has_car === false && slot.status !== "booked") {
  box.classList.add("empty");  // Màu xanh
  status.innerText = "TRỐNG";
}
```

## 🎯 Logic ưu tiên trạng thái

```
1. has_car === true     → OCCUPIED (Màu đỏ)    [Xe thật có]
2. status === "booked"  → BOOKED (Màu vàng)    [Đã đặt chỗ]
3. Còn lại             → EMPTY (Màu xanh)     [Trống]
```

## 🚦 ESP32 - Điều khiển đèn LED

### Slot có 2 LED:

**🔴 ĐÈN ĐỎ** (Không được vào):
- Bật khi: `status === "booked"` hoặc `has_car === true`
- Tắt khi: `status === "empty"` và `has_car === false`

**🟢 ĐÈN XANH** (Được vào):
- Bật khi: `status === "empty"` và `has_car === false`
- Tắt khi: có người book hoặc có xe

### Code ESP32 mẫu:

```cpp
void updateSlotLED(String slotId, String status, bool hasCar) {
  int redLED = getRedLEDPin(slotId);
  int greenLED = getGreenLEDPin(slotId);
  
  if (status == "booked" || hasCar) {
    digitalWrite(redLED, HIGH);    // ĐỎ bật
    digitalWrite(greenLED, LOW);   // XANH tắt
  } else {
    digitalWrite(redLED, LOW);     // ĐỎ tắt
    digitalWrite(greenLED, HIGH);  // XANH bật
  }
}

// Lắng nghe Firebase
void listenFirebase() {
  Firebase.readStream(fbdo, "/Slots");
  
  if (fbdo.streamAvailable()) {
    String slotId = fbdo.dataPath();  // VD: "Slot01"
    
    String status = Firebase.getString(fbdo, "/Slots/" + slotId + "/status");
    bool hasCar = Firebase.getBool(fbdo, "/Slots/" + slotId + "/has_car");
    
    updateSlotLED(slotId, status, hasCar);
  }
}
```

## 📱 Web - Realtime Listener

```javascript
// Lắng nghe realtime (không cần reload)
db.ref("Slots").on("value", snap => {
  let slots = snap.val();
  
  // Tự động cập nhật UI
  Object.keys(slots).forEach(slotId => {
    let slot = slots[slotId];
    updateSlotUI(slotId, slot);
  });
});
```

## ⚡ Realtime Flow

```
┌─────────────────────────────────────────────────────────┐
│  USER BOOK CHỖ                                          │
└─────────────────────────────────────────────────────────┘
Web → Firebase (Slots/Slot01/status = "booked")
       ↓
ESP32 ← Firebase (Nhận realtime)
       ↓
ESP32: BẬT ĐÈN ĐỎ


┌─────────────────────────────────────────────────────────┐
│  XE VÀO BÃI                                             │
└─────────────────────────────────────────────────────────┘
ESP32: Cảm biến phát hiện xe
       ↓
ESP32 → Firebase (Slots/Slot01/has_car = true)
       ↓
Web ← Firebase (Nhận realtime)
       ↓
Web: Đổi màu thành ĐỎ (OCCUPIED)


┌─────────────────────────────────────────────────────────┐
│  HẾT THỜI GIAN BOOKING                                  │
└─────────────────────────────────────────────────────────┘
Web: Check mỗi 2s, phát hiện hết hạn
       ↓
Web → Firebase (Slots/Slot01/status = "empty")
       ↓
ESP32 ← Firebase (Nhận realtime)
       ↓
ESP32: TẮT ĐÈN ĐỎ, BẬT ĐÈN XANH


┌─────────────────────────────────────────────────────────┐
│  XE RA KHỎI BÃI                                         │
└─────────────────────────────────────────────────────────┘
ESP32: Cảm biến không thấy xe
       ↓
ESP32 → Firebase (Slots/Slot01/has_car = false)
       ↓
Web ← Firebase (Nhận realtime)
       ↓
Web: Đổi màu thành XANH (EMPTY)
```

## 🔐 RFID Check-in

```
User quẹt thẻ RFID
       ↓
ESP32: Đọc card_id
       ↓
ESP32 → Check Firebase: RegisteredCards/<card_id>
       ↓
   Nếu tồn tại và active:
       ↓
ESP32: Mở barrier
       ↓
ESP32: Cảm biến phát hiện xe vào
       ↓
ESP32 → Firebase: Slots/<SlotID>/has_car = true
       ↓
Web: Nhận realtime → Đổi màu đỏ
```

## 📊 Tóm tắt

✅ **Web**: Ghi booking, auto-check expire, lắng nghe realtime  
✅ **ESP32**: Điều khiển LED, đọc cảm biến, ghi has_car, check RFID  
✅ **Firebase**: Trung tâm realtime, không cần Commands riêng  
✅ **Realtime 100%**: Không cần reload trang, mọi thay đổi tức thì  

---

## 🛠️ Setup Firebase Rules

```json
{
  "rules": {
    "Slots": {
      ".read": true,
      ".write": true
    },
    "RegisteredCards": {
      ".read": true,
      ".write": "auth != null"
    },
    "Users": {
      ".read": true,
      ".write": true
    }
  }
}
```

