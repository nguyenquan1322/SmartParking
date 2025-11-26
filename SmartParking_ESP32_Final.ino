#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <time.h>  // ✨ THÊM MỚI: Để lấy thời gian thực

// ===================== CONFIG WIFI =====================
const char* WIFI_SSID     = "CHIEN_tq_1_5G";
const char* WIFI_PASSWORD = "Chiendeptrai1";

// ===================== CONFIG FIREBASE =================
// Dạng: "https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app"
const char* FIREBASE_HOST = "https://smartpaking-72448-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH = ""; // nếu dùng rules mở hết thì để trống

// ✨ THÊM MỚI: CONFIG NTP (Thời gian Việt Nam)
const char* NTP_SERVER = "pool.ntp.org";
const long  GMT_OFFSET_SEC = 7 * 3600;  // GMT+7
const int   DAYLIGHT_OFFSET_SEC = 0;

// ===================== CONFIG SLOT =====================
const int NUM_SLOTS = 3;

// Tên node trên Firebase
String slotIds[NUM_SLOTS] = {"Slot01", "Slot02", "Slot03"};

// 1 LED / slot
const int ledPins[NUM_SLOTS]  = {21, 4, 16};

// HC-SR04: TRIG + ECHO
const int trigPins[NUM_SLOTS] = {33, 26, 14};
const int echoPins[NUM_SLOTS] = {25, 26, 12};

// Ngưỡng phát hiện có xe
const float OCCUPIED_DISTANCE_CM = 20.0;

// Trạng thái slot (local cache)
String slotStatus[NUM_SLOTS] = {"empty", "empty", "empty"};
bool   slotHasCar[NUM_SLOTS] = {false, false, false};
float  lastDistance[NUM_SLOTS] = {999, 999, 999};

// ===================== CONFIG RC522 =====================
#define RC522_SS_PIN   5
#define RC522_RST_PIN  22

MFRC522 mfrc522(RC522_SS_PIN, RC522_RST_PIN);

// ===================== CONFIG SERVO ====================
#define SERVO_PIN          13
#define SERVO_ANGLE_CLOSED 0
#define SERVO_ANGLE_OPEN   90
#define GATE_OPEN_TIME_MS  3000

Servo gateServo;

// ===================== CACHE REGISTERED CARDS ==========
const int MAX_CARDS = 100;
String cardIds[MAX_CARDS];
int cardCount = 0;

// Chế độ đăng ký thẻ (do Firebase điều khiển)
bool registerMode = false;

// ✨ THÊM MỚI: Tracking xe vào/ra (1 đầu đọc RFID)
String cardsInside[MAX_CARDS];  // Danh sách thẻ đang trong bãi
int cardsInsideCount = 0;

// ===================== WIFI/FIREBASE CLIENT ============
WiFiClientSecure fbClient;

// ===================== TIMER ===========================
unsigned long lastSensorUpdate   = 0;
unsigned long lastSlotsPoll      = 0;
unsigned long lastRegisterPoll   = 0;

const unsigned long SENSOR_INTERVAL_MS   = 1000;  // đọc HC-SR04 + update Firebase
const unsigned long SLOTS_POLL_MS        = 2000;  // poll Slots từ Firebase
const unsigned long REGISTER_POLL_MS     = 1500;  // poll System/registerCard

// =======================================================
// ✨ THÊM MỚI: HÀM LẤY TIMESTAMP THỰC (MILLISECONDS) ====
// =======================================================

unsigned long getCurrentTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("⚠️ Chưa đồng bộ NTP, dùng millis()");
    return millis();  // Fallback
  }
  
  time_t now;
  time(&now);
  return (unsigned long)(now * 1000ULL);  // Convert to milliseconds
}

void printCurrentTime() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    Serial.print("🕐 ");
    Serial.println(&timeinfo, "%d/%m/%Y %H:%M:%S");
  }
}

// =======================================================
// ==========  HÀM TIỆN ÍCH FIREBASE (REST)  =============
// =======================================================

String makeFirebaseURL(const String &path) {
  String url = String(FIREBASE_HOST) + path + ".json";
  if (String(FIREBASE_AUTH).length() > 0) {
    url += "?auth=";
    url += FIREBASE_AUTH;
  }
  return url;
}

bool firebaseGET(const String &path, String &response) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = makeFirebaseURL(path);
  Serial.print("[GET] "); Serial.println(url);

  fbClient.setInsecure(); // bỏ check chứng chỉ cho nhanh
  if (!http.begin(fbClient, url)) {
    Serial.println("http.begin failed");
    return false;
  }

  int httpCode = http.GET();
  if (httpCode > 0) {
    response = http.getString();
    Serial.print("HTTP GET code: "); Serial.println(httpCode);
    http.end();
    return (httpCode == 200);
  } else {
    Serial.print("HTTP GET failed: "); Serial.println(httpCode);
    http.end();
    return false;
  }
}

bool firebasePATCH(const String &path, const String &payload) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = makeFirebaseURL(path);
  Serial.print("[PATCH] "); Serial.println(url);
  Serial.print("Payload: "); Serial.println(payload);

  fbClient.setInsecure();
  if (!http.begin(fbClient, url)) {
    Serial.println("http.begin failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  int httpCode = http.PATCH(payload);

  Serial.print("HTTP PATCH code: "); Serial.println(httpCode);
  http.end();
  return (httpCode == 200);
}

bool firebasePUT(const String &path, const String &payload) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = makeFirebaseURL(path);
  Serial.print("[PUT] "); Serial.println(url);
  Serial.print("Payload: "); Serial.println(payload);

  fbClient.setInsecure();
  if (!http.begin(fbClient, url)) {
    Serial.println("http.begin failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  int httpCode = http.PUT(payload);

  Serial.print("HTTP PUT code: "); Serial.println(httpCode);
  http.end();
  return (httpCode == 200);
}

// =======================================================
// ==========  HCSR04 ĐO KHOẢNG CÁCH  ====================
// =======================================================

float readDistanceCM(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH, 30000); // timeout 30ms
  if (duration == 0) {
    return 999.0; // out of range
  }

  float distance = duration * 0.034 / 2.0;
  return distance;
}

// =======================================================
// ==========  QUẢN LÝ SLOTS (SENSOR -> FIREBASE)  =======
// =======================================================

void updateSlotsFromSensors() {
  Serial.println("------ SENSOR SCAN ------");

  for (int i = 0; i < NUM_SLOTS; i++) {

    float d = readDistanceCM(trigPins[i], echoPins[i]);
    lastDistance[i] = d;

    // In ra log khoảng cách từng slot
    Serial.print("Slot ");
    Serial.print(slotIds[i]);          // VD: Slot01
    Serial.print(" | Distance = ");
    Serial.print(d);
    Serial.println(" cm");

    bool carNow = (d > 0 && d < OCCUPIED_DISTANCE_CM);

    // In thêm log: có xe hay không
    Serial.print(" -> has_car = ");
    Serial.println(carNow ? "TRUE" : "FALSE");

    // Nếu trạng thái thay đổi thì update Firebase
    if (carNow != slotHasCar[i]) {

      Serial.print(" >>> CHANGE DETECTED @ ");
      Serial.println(slotIds[i]);

      slotHasCar[i] = carNow;
      slotStatus[i] = carNow ? "occupied" : "empty";

      // In log thay đổi
      Serial.print("    Updated status = ");
      Serial.println(slotStatus[i]);

      // Gửi lên Firebase
      String path = "/Slots/" + slotIds[i];
      String payload = "{";
      payload += "\"has_car\":";
      payload += (slotHasCar[i] ? "true" : "false");
      payload += ",\"status\":\"";
      payload += slotStatus[i];
      payload += "\"}";

      Serial.print("    -> PATCH Firebase: ");
      Serial.println(payload);

      firebasePATCH(path, payload);
    }

    Serial.println();
  }

  Serial.println("-------------------------");
}


// =======================================================
// ==========  QUẢN LÝ SLOTS (FIREBASE -> ESP32)  ========
// =======================================================

void pollSlotsFromFirebase() {
  // GET /Slots
  String resp;
  if (!firebaseGET("/Slots", resp)) {
    Serial.println("pollSlotsFromFirebase: GET /Slots failed");
    return;
  }

  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("deserializeJson /Slots error: ");
    Serial.println(err.c_str());
    return;
  }

  for (int i = 0; i < NUM_SLOTS; i++) {
    String sId = slotIds[i];
    if (!doc.containsKey(sId)) continue;

    JsonObject s = doc[sId];

    // Cập nhật status nếu có
    if (s.containsKey("status")) {
      String newStatus = s["status"].as<String>();
      slotStatus[i] = newStatus;
    }

    // Cập nhật has_car nếu có
    if (s.containsKey("has_car")) {
      bool newHasCar = s["has_car"];
      slotHasCar[i] = newHasCar;
    }
  }
}

// =======================================================
// ==========  LED: 1 LED / SLOT =========================
// =======================================================
// Rule:
//  - ON  nếu has_car == true
//         hoặc status == "booked"
//         hoặc status == "occupied"
//  - OFF nếu status == "empty" và has_car == false

void updateSlotLEDs() {
  for (int i = 0; i < NUM_SLOTS; i++) {
    bool ledOn = false;

    if (slotHasCar[i]) {
      ledOn = true;
    } else if (slotStatus[i] == "booked" || slotStatus[i] == "occupied") {
      ledOn = true;
    } else {
      ledOn = false;
    }

    digitalWrite(ledPins[i], ledOn ? HIGH : LOW);
  }
}

// =======================================================
// ==========  SERVO / BARRIER ===========================
// =======================================================

void openGate() {
  Serial.println("Opening gate...");
  gateServo.write(SERVO_ANGLE_OPEN);
  delay(GATE_OPEN_TIME_MS);
  Serial.println("Closing gate...");
  gateServo.write(SERVO_ANGLE_CLOSED);
}

// =======================================================
// ==========  CACHE THẺ RFID ============================
// =======================================================

bool isCardInCache(const String &cardId) {
  for (int i = 0; i < cardCount; i++) {
    if (cardIds[i] == cardId) return true;
  }
  return false;
}

bool addCardToCache(const String &cardId) {
  if (isCardInCache(cardId)) return true;   // đã có
  if (cardCount >= MAX_CARDS) return false; // hết chỗ
  cardIds[cardCount++] = cardId;
  return true;
}

// Load toàn bộ RegisteredCards từ Firebase lúc khởi động
void loadRegisteredCardsFromFirebase() {
  String resp;
  if (!firebaseGET("/RegisteredCards", resp)) {
    Serial.println("GET /RegisteredCards failed");
    return;
  }

  if (resp == "null") {
    Serial.println("No RegisteredCards yet.");
    return;
  }

  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("deserializeJson /RegisteredCards error: ");
    Serial.println(err.c_str());
    return;
  }

  if (!doc.is<JsonObject>()) {
    Serial.println("/RegisteredCards is not JsonObject");
    return;
  }

  cardCount = 0;
  JsonObject root = doc.as<JsonObject>();
  for (JsonPair kv : root) {
    const char* key = kv.key().c_str();       // key chính là card_id
    JsonObject card = kv.value().as<JsonObject>();

    // chỉ lấy thẻ status = "active"
    if (card.containsKey("status")) {
      String st = card["status"].as<String>();
      if (st == "active") {
        if (cardCount < MAX_CARDS) {
          cardIds[cardCount++] = String(key);
        }
      }
    }
  }

  Serial.print("Loaded ");
  Serial.print(cardCount);
  Serial.println(" active cards into cache.");
  for (int i = 0; i < cardCount; i++) {
    Serial.print("  ["); Serial.print(i); Serial.print("] ");
    Serial.println(cardIds[i]);
  }
}

// Đăng ký thẻ mới: đẩy lên Firebase + thêm vào mảng
bool addCardToFirebaseAndCache(const String &cardId) {
  String path = "/RegisteredCards/" + cardId;

  String payload = "{";
  payload += "\"card_id\":\"" + cardId + "\",";
  payload += "\"registered_at\":" + String(getCurrentTimestamp()) + ",";  // ✨ DÙNG TIMESTAMP THỰC
  payload += "\"status\":\"active\"";
  payload += "}";

  if (!firebasePUT(path, payload)) {
    Serial.println("PUT RegisteredCards failed");
    return false;
  }

  if (!addCardToCache(cardId)) {
    Serial.println("Add to cache failed (full?).");
    return false;
  }

  Serial.print("Card registered & cached: ");
  Serial.println(cardId);
  return true;
}

// =======================================================
// ✨ THÊM MỚI: TRACKING VÀO/RA (1 ĐẦU ĐỌC RFID) =========
// =======================================================

bool isCardInside(const String &cardId) {
  for (int i = 0; i < cardsInsideCount; i++) {
    if (cardsInside[i] == cardId) return true;
  }
  return false;
}

void addCardInside(const String &cardId) {
  if (isCardInside(cardId)) return;
  if (cardsInsideCount >= MAX_CARDS) return;
  cardsInside[cardsInsideCount++] = cardId;
}

void removeCardInside(const String &cardId) {
  for (int i = 0; i < cardsInsideCount; i++) {
    if (cardsInside[i] == cardId) {
      // Xóa bằng cách shift mảng
      for (int j = i; j < cardsInsideCount - 1; j++) {
        cardsInside[j] = cardsInside[j + 1];
      }
      cardsInsideCount--;
      return;
    }
  }
}

void logEntryExit(const String &cardId, bool isEntry) {
  unsigned long timestamp = getCurrentTimestamp();
  
  String path = "/AccessLogs/" + String(timestamp);
  String payload = "{";
  payload += "\"card_id\":\"" + cardId + "\",";
  payload += "\"type\":\"" + String(isEntry ? "entry" : "exit") + "\",";
  payload += "\"timestamp\":" + String(timestamp);
  payload += "}";
  
  firebasePUT(path, payload);
  
  Serial.print(isEntry ? "🟢 VÀO: " : "🔴 RA: ");
  Serial.print(cardId);
  Serial.print(" | ");
  printCurrentTime();
}

// =======================================================
// ==========  LỆNH REGISTER MODE TỪ FIREBASE ============
// =======================================================
// Node: /System/registerCard (bool)

void pollRegisterCommandFromFirebase() {
  String resp;
  if (!firebaseGET("/System/registerCard", resp)) {
    return;
  }

  bool cmd = false;
  if (resp == "true") cmd = true;
  else cmd = false;

  if (cmd && !registerMode) {
    registerMode = true;
    Serial.println(">>> REGISTER MODE ON (quet the de dang ky) <<<");
  } else if (!cmd && registerMode) {
    registerMode = false;
    Serial.println(">>> REGISTER MODE OFF <<<");
  }
}

// =======================================================
// ==========  RFID (READ + HANDLE)  =====================
// =======================================================

// Format card_id: "A1B2C3D4"
String getUIDStringNoDash() {
  String uidStr = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uidStr += "0";
    uidStr += String(mfrc522.uid.uidByte[i], HEX);
  }
  uidStr.toUpperCase();
  return uidStr;
}

void handleRFID() {
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial())   return;

  String cardId = getUIDStringNoDash();
  Serial.print("RFID card_id = ");
  Serial.println(cardId);

  if (registerMode) {
    // ĐANG ĐĂNG KÝ THẺ MỚI
    if (isCardInCache(cardId)) {
      Serial.println("Card already registered (in cache).");
    } else {
      if (addCardToFirebaseAndCache(cardId)) {
        Serial.println("Register new card OK.");
        // Tắt luôn chế độ đăng ký (hoặc để app tự tắt, tùy bạn)
        firebasePUT("/System/registerCard", "false");
        registerMode = false;
      } else {
        Serial.println("Register new card FAILED.");
      }
    }
  } else {
    // ✨ THÊM MỚI: CHẾ ĐỘ BÌNH THƯỜNG - TRACKING VÀO/RA
    if (isCardInCache(cardId)) {
      // Thẻ hợp lệ
      if (isCardInside(cardId)) {
        // Thẻ đang TRONG bãi -> RA
        Serial.println("→ XE RA KHỎI BÃI");
        removeCardInside(cardId);
        logEntryExit(cardId, false);  // Log exit
        openGate();
      } else {
        // Thẻ đang NGOÀI bãi -> VÀO
        Serial.println("→ XE VÀO BÃI");
        addCardInside(cardId);
        logEntryExit(cardId, true);   // Log entry
        openGate();
      }
    } else {
      Serial.println("Card NOT REGISTERED -> deny");
    }
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}

// =======================================================
// ==========  WIFI & SETUP ==============================
// =======================================================

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 30) {
    delay(500);
    Serial.print(".");
    retry++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP = ");
    Serial.println(WiFi.localIP());
    
    // ✨ THÊM MỚI: Đồng bộ thời gian NTP
    Serial.println("⏰ Đồng bộ thời gian NTP...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
    
    // Đợi đồng bộ
    int ntpRetry = 0;
    struct tm timeinfo;
    while (!getLocalTime(&timeinfo) && ntpRetry < 20) {
      delay(1000);
      Serial.print(".");
      ntpRetry++;
    }
    Serial.println();
    
    if (getLocalTime(&timeinfo)) {
      Serial.println("✅ Đồng bộ NTP thành công");
      printCurrentTime();
    } else {
      Serial.println("⚠️ Không thể đồng bộ NTP (sẽ dùng millis)");
    }
  } else {
    Serial.println("WiFi connect FAILED!");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // LED + sensor pin
  for (int i = 0; i < NUM_SLOTS; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);

    pinMode(trigPins[i], OUTPUT);
    pinMode(echoPins[i], INPUT);
  }

  // Servo
  gateServo.attach(SERVO_PIN);
  gateServo.write(SERVO_ANGLE_CLOSED);

  // SPI + RC522
  SPI.begin(); // SCK=18, MISO=19, MOSI=23
  mfrc522.PCD_Init();
  Serial.println("RC522 initialized.");

  // WiFi
  connectWiFi();

  // Load danh sách thẻ 1 lần
  loadRegisteredCardsFromFirebase();

  // Lần đầu sync Slots
  pollSlotsFromFirebase();

  lastSensorUpdate = millis();
  lastSlotsPoll    = millis();
  lastRegisterPoll = millis();
}

void loop() {
  unsigned long now = millis();

  // 1. Cập nhật từ cảm biến -> Firebase (has_car, status)
  if (now - lastSensorUpdate >= SENSOR_INTERVAL_MS) {
    lastSensorUpdate = now;
    updateSlotsFromSensors();
  }

  // 2. Poll trạng thái Slots (status, has_car) từ Firebase (web có thể đổi status=booked/empty)
  if (now - lastSlotsPoll >= SLOTS_POLL_MS) {
    lastSlotsPoll = now;
    pollSlotsFromFirebase();
  }

  // 3. Poll lệnh registerCard từ Firebase
  if (now - lastRegisterPoll >= REGISTER_POLL_MS) {
    lastRegisterPoll = now;
    pollRegisterCommandFromFirebase();
  }

  // 4. Cập nhật LED theo rule (status + has_car)
  updateSlotLEDs();

  // 5. Xử lý RFID
  handleRFID();
}
