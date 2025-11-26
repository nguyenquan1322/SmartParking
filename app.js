let currentUser = localStorage.getItem("currentUser");
document.getElementById("currentUserName").innerText = "👤 " + currentUser;

let selectedSlot = "";

// ========== HIỆN DIALOG CHỌN THỜI GIAN ==========
function tryBook(slot) {
  selectedSlot = slot;
  bookDialog.style.display = "block";
}

function closeDialog() {
  bookDialog.style.display = "none";
}

// ========== CONFIRM BOOK ==========
function confirmBooking() {
  let minutes = parseInt(document.getElementById("bookTime").value);

  db.ref("Parking/" + selectedSlot).once("value", snap => {
    let s = snap.val();

    if (s.sensor === 1) return alert("Slot đang có xe thật!");

    if (s.status === "booked") return alert("Slot đã có người đặt!");

    db.ref("Parking/" + selectedSlot).update({
      status: "booked",
      booked_by: currentUser,
      book_expire: Date.now() + minutes * 60000
    });

    closeDialog();
  });
}


// ========== REALTIME UI UPDATE ==========
db.ref("Parking").on("value", snap => {
  const data = snap.val();

  Object.keys(data).forEach(slot => {
    const info = data[slot];

    const box = document.getElementById(slot + "Box");
    const status = document.getElementById(slot + "Status");
    const timer = document.getElementById(slot + "Timer");

    // Reset class
    box.className = "slot";

    // 1) Nếu cảm biến báo có xe → occupied
    if (info.sensor === 1) {
      box.classList.add("occupied");
      status.innerText = "Có xe (ESP32)";
      timer.innerText = "";

      // Nếu đang booked thì AUTO hủy
      if (info.status === "booked") {
        db.ref("Parking/" + slot).update({
          status: "occupied",
          booked_by: "",
          book_expire: 0
        });
      }
      return;
    }

    // 2) Nếu đang booked
    if (info.status === "booked") {
      box.classList.add("booked");
      status.innerText = "Đặt bởi: " + info.booked_by;

      let remain = info.book_expire - Date.now();
      timer.innerText = "Còn lại: " + Math.max(0, Math.floor(remain / 1000)) + "s";

      return;
    }

    // 3) Trống hoàn toàn
    box.classList.add("empty");
    status.innerText = "Trống";
    timer.innerText = "";
  });
});


// ========== AUTO EXPIRE ==========
setInterval(() => {
  db.ref("Parking").once("value", snap => {
    let data = snap.val();

    Object.keys(data).forEach(slot => {
      let s = data[slot];

      if (s.status === "booked" && Date.now() > s.book_expire) {
        db.ref("Parking/" + slot).update({
          status: "empty",
          booked_by: "",
          book_expire: 0
        });
      }
    });
  });
}, 2000);


// ========== LOGOUT ==========
function logout() {
  localStorage.removeItem("currentUser");
  window.location.href = "login.html";
}
