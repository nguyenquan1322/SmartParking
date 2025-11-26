#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <time.h>   // ⭐ NTP for ms timestamp

// ===================== WIFI =====================
const char* WIFI_SSID     = "CHIEN_tq_1_5G";
const char* WIFI_PASSWORD = "Chiendeptrai1";

// ===================== FIREBASE =================
const char* FIREBASE_HOST = "https://smartpaking-72448-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH = "";

// ===================== SLOTS ====================
const int NUM_SLOTS = 3;
String slotIds[NUM_SLOTS] = {"Slot01", "Slot02", "Slot03"};

const int ledPins[NUM_SLOTS]  = {21, 4, 16};
const int trigPins[NUM_SLOTS] = {33, 27, 14};
const int echoPins[NUM_SLOTS] = {25, 26, 12};

const float OCCUPIED_DISTANCE_CM = 20.0;

String slotStatus[NUM_SLOTS] = {"empty", "empty", "empty"};
bool   slotHasCar[NUM_SLOTS] = {false, false, false};

// ===================== RC522 =====================
#define RC522_SS_PIN   5
#define RC522_RST_PIN  22
MFRC522 mfrc522(RC522_SS_PIN, RC522_RST_PIN);

// ===================== SERVO =====================
#define SERVO_PIN          13
#define SERVO_ANGLE_CLOSED 0
#define SERVO_ANGLE_OPEN   90
#define GATE_OPEN_TIME_MS  5000
Servo gateServo;

// ===================== RFID CACHE =====================
const int MAX_CARDS = 100;
String cardIds[MAX_CARDS];
String cardStatus[MAX_CARDS];
int cardCount = 0;

// ai đang trong bãi
String cardsInside[MAX_CARDS];
int insideCount = 0;

// ===================== REGISTRATION CMD =====================
bool isWaitingForCard = false;
String currentCommandId = "";

WiFiClientSecure fbClient;

// ===================== TIMERS =====================
unsigned long lastSensorCheck = 0;
unsigned long lastFirebaseUpdate = 0;
unsigned long lastSlotSync = 0;
unsigned long lastCardRegCheck = 0;
unsigned long lastCardCacheSync = 0;

const unsigned long SENSOR_INTERVAL = 50;
const unsigned long FIREBASE_INTERVAL = 1000;
const unsigned long SLOT_SYNC_INTERVAL = 2000;
const unsigned long CARD_REG_INTERVAL = 1000;
const unsigned long CARD_CACHE_SYNC = 30000;

bool needFirebaseUpdate[NUM_SLOTS] = {false, false, false};


// =================================================================
// ======================  NTP MILLISECONDS  =======================
// =================================================================

long long getUnixMs() {
  return (long long)time(nullptr) * 1000LL;
}

void initNTP() {
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("⏳ Syncing NTP...");
  delay(1500);

  while (time(nullptr) < 100000) {
    Serial.print(".");
    delay(1000);
  }
  Serial.println("\n✅ NTP OK");
}


// =================================================================
// ======================== FIREBASE REST ==========================
// =================================================================

String makeURL(const String &path) {
  String url = String(FIREBASE_HOST) + path + ".json";
  return url;
}

bool GET_FB(const String &path, String &resp) {
  HTTPClient http;
  fbClient.setInsecure();
  if (!http.begin(fbClient, makeURL(path))) return false;
  int code = http.GET();
  if (code == 200) {
    resp = http.getString();
    http.end();
    return true;
  }
  http.end();
  return false;
}

bool PATCH_FB(const String &path, const String &payload) {
  HTTPClient http;
  fbClient.setInsecure();
  if (!http.begin(fbClient, makeURL(path))) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH(payload);
  http.end();
  return code == 200;
}

bool PUT_FB(const String &path, const String &payload) {
  HTTPClient http;
  fbClient.setInsecure();
  if (!http.begin(fbClient, makeURL(path))) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(payload);
  http.end();
  return code == 200;
}


// =================================================================
// ========================= SENSOR ================================
// =================================================================

float readDistanceCM(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  long d = pulseIn(echo, HIGH, 30000);
  if (d == 0) return 999.0;
  return d * 0.034 / 2.0;
}

void updateLEDs() {
  for (int i = 0; i < NUM_SLOTS; i++) {
    bool ledOn =
      (slotHasCar[i]) ||
      (slotStatus[i] == "booked");
    digitalWrite(ledPins[i], ledOn ? HIGH : LOW);
  }
}

void checkSensors() {
  for (int i = 0; i < NUM_SLOTS; i++) {

    // giữ nguyên logic code cũ — booked thì không đo cảm biến
    if (slotStatus[i] == "booked") continue;

    float dist = readDistanceCM(trigPins[i], echoPins[i]);
    bool hasCarNow = (dist > 0 && dist < OCCUPIED_DISTANCE_CM);

    if (hasCarNow != slotHasCar[i]) {

      Serial.print(">>> CHANGE: ");
      Serial.print(slotIds[i]);
      Serial.print(" = ");
      Serial.print(hasCarNow);
      Serial.print("  (");
      Serial.print(dist);
      Serial.println(" cm)");

      slotHasCar[i] = hasCarNow;

      if (hasCarNow)
        slotStatus[i] = "occupied";
      else if (slotStatus[i] != "booked")
        slotStatus[i] = "empty";

      needFirebaseUpdate[i] = true;

      updateLEDs();
    }
  }
}


// =================================================================
// ========================= UPDATE FIREBASE =======================
// =================================================================

void updateFirebaseIfNeeded() {
  for (int i = 0; i < NUM_SLOTS; i++) {

    if (needFirebaseUpdate[i]) {
      needFirebaseUpdate[i] = false;

      String p = "{";
      p += "\"has_car\":" + String(slotHasCar[i] ? "true" : "false");
      p += ",\"status\":\"" + slotStatus[i] + "\"";
      p += "}";

      Serial.print("📤 Firebase: ");
      Serial.println(slotIds[i]);

      PATCH_FB("/Slots/" + slotIds[i], p);
    }
  }
}


// =================================================================
// ========================= SLOT SYNC =============================
// =================================================================

void syncSlotsFromFirebase() {
  String resp;
  if (!GET_FB("/Slots", resp)) return;

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, resp)) return;

  for (int i = 0; i < NUM_SLOTS; i++) {
    JsonObject o = doc[slotIds[i]];

    if (o.containsKey("status"))
      slotStatus[i] = o["status"].as<String>();

    if (o.containsKey("has_car"))
      slotHasCar[i] = o["has_car"];
  }

  updateLEDs();
}


// =================================================================
// ======================= CARD CACHE ==============================
// =================================================================

bool cardValid(const String &id) {
  for (int i = 0; i < cardCount; i++)
    if (cardIds[i] == id && cardStatus[i] == "active")
      return true;
  return false;
}

bool isInside(const String &id) {
  for (int i = 0; i < insideCount; i++)
    if (cardsInside[i] == id)
      return true;
  return false;
}

void addInside(const String &id) {
  if (!isInside(id) && insideCount < MAX_CARDS)
    cardsInside[insideCount++] = id;
}

void removeInside(const String &id) {
  for (int i = 0; i < insideCount; i++) {
    if (cardsInside[i] == id) {
      for (int j = i; j < insideCount - 1; j++)
        cardsInside[j] = cardsInside[j + 1];
      insideCount--;
      return;
    }
  }
}

void loadCardsFromFirebase() {
  String resp;
  if (!GET_FB("/RegisteredCards", resp)) return;
  if (resp == "null") {
    cardCount = 0;
    return;
  }

  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, resp)) return;

  JsonObject root = doc.as<JsonObject>();
  cardCount = 0;

  for (JsonPair kv : root) {
    String id = kv.key().c_str();
    String st = kv.value()["status"].as<String>();

    cardIds[cardCount] = id;
    cardStatus[cardCount] = st;
    cardCount++;
    if (cardCount >= MAX_CARDS) break;
  }

  Serial.print("📋 Cards loaded: ");
  Serial.println(cardCount);
}


// =================================================================
// ===================== CARD REGISTRATION =========================
// =================================================================

void checkCardRegistrationCommand() {
  String resp;
  if (!GET_FB("/Commands/CardRegistration", resp)) return;
  if (resp == "null") { isWaitingForCard = false; return; }

  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, resp)) return;

  String st = doc["status"].as<String>();
  String cmdId = doc["command_id"].as<String>();

  if (st == "waiting" && cmdId != currentCommandId) {
    currentCommandId = cmdId;
    isWaitingForCard = true;
    Serial.println("🎫 WAITING FOR CARD...");
  }
  else if (st == "completed" || st == "failed") {
    isWaitingForCard = false;
  }
}

void registerNewCard(const String &id) {
  String payload =
    "{\"card_id\":\"" + id + "\",\"status\":\"completed\"}";

  PATCH_FB("/Commands/CardRegistration", payload);

  delay(1200);
  loadCardsFromFirebase();
}


// =================================================================
// ========================== RFID ================================
// =================================================================

String readRFID() {
  if (!mfrc522.PICC_IsNewCardPresent()) return "";
  if (!mfrc522.PICC_ReadCardSerial()) return "";

  String uid = "";
  for (int i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  return uid;
}


// =================================================================
// ======================== LOG ENTRY/EXIT ==========================
// =================================================================

void logEntryExit(const String &id, bool isEntry) {

  long long ts = getUnixMs();

  String path = "/AccessLogs/" + String(ts);

  String p = "{";
  p += "\"card_id\":\"" + id + "\",";
  p += "\"type\":\"" + String(isEntry ? "entry" : "exit") + "\",";
  p += "\"timestamp\":" + String(ts);
  p += "}";

  PUT_FB(path, p);
}


// =================================================================
// ========================= HANDLE RFID ===========================
// =================================================================

void openBarrier() {
  gateServo.write(SERVO_ANGLE_OPEN);
  delay(GATE_OPEN_TIME_MS);
  gateServo.write(SERVO_ANGLE_CLOSED);
}

void handleRFID() {
  String id = readRFID();
  if (id == "") return;

  Serial.print("🎫 CARD: ");
  Serial.println(id);

  if (isWaitingForCard) {
    registerNewCard(id);
    return;
  }

  if (!cardValid(id)) {
    Serial.println("❌ CARD INVALID");
    return;
  }

  if (isInside(id)) {
    Serial.println("→ EXIT");
    removeInside(id);
    logEntryExit(id, false);
    openBarrier();
  }
  else {
    Serial.println("→ ENTER");
    addInside(id);
    logEntryExit(id, true);
    openBarrier();
  }
}


// =================================================================
// ============================ SETUP ==============================
// =================================================================

void connectWiFi() {
  Serial.print("WiFi connecting: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println("\n✅ WiFi OK");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);

  for (int i = 0; i < NUM_SLOTS; i++) {
    pinMode(ledPins[i], OUTPUT);
    pinMode(trigPins[i], OUTPUT);
    pinMode(echoPins[i], INPUT);
  }

  gateServo.attach(SERVO_PIN);
  gateServo.write(SERVO_ANGLE_CLOSED);

  SPI.begin();
  mfrc522.PCD_Init();

  connectWiFi();
  initNTP();

  loadCardsFromFirebase();
  syncSlotsFromFirebase();

  lastSensorCheck = millis();
  lastFirebaseUpdate = millis();
  lastSlotSync = millis();
  lastCardRegCheck = millis();
  lastCardCacheSync = millis();

  Serial.println("🚀 SYSTEM READY");
}


// =================================================================
// ============================= LOOP ==============================
// =================================================================

void loop() {
  unsigned long now = millis();

  if (now - lastSensorCheck >= SENSOR_INTERVAL) {
    lastSensorCheck = now;
    checkSensors();
  }

  if (now - lastFirebaseUpdate >= FIREBASE_INTERVAL) {
    lastFirebaseUpdate = now;
    updateFirebaseIfNeeded();
  }

  if (now - lastSlotSync >= SLOT_SYNC_INTERVAL) {
    lastSlotSync = now;
    syncSlotsFromFirebase();
  }

  if (now - lastCardRegCheck >= CARD_REG_INTERVAL) {
    lastCardRegCheck = now;
    checkCardRegistrationCommand();
  }

  if (now - lastCardCacheSync >= CARD_CACHE_SYNC) {
    lastCardCacheSync = now;
    loadCardsFromFirebase();
  }

  handleRFID();
}
