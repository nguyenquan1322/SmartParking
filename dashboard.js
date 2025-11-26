let selectedSlot = "";
let currentUser = localStorage.getItem("currentUser");

// Bảo vệ trang - chỉ cho phép user đã đăng nhập
if (!currentUser) {
  window.location.href = "login.html";
}

// Không cho admin vào trang dashboard
if (currentUser === "admin") {
  window.location.href = "admin.html";
}

function logout() {
  localStorage.removeItem("currentUser");
  window.location.href = "login.html";
}

function openBooking(slot) {
  selectedSlot = slot;
  
  // Kiểm tra slot có đang được đặt không
  db.ref("Slots/" + slot).once("value", snap => {
    let slotData = snap.val();
    
    // Nếu slot đang có xe
    if (slotData && slotData.has_car === true) {
      alert("⚠️ Chỗ này đang có xe đậu!\nVui lòng chọn chỗ khác.");
      return;
    }
    
    // Nếu slot đang booked
    if (slotData && slotData.status === "booked") {
      // Kiểm tra xem có phải booking của mình không
      if (slotData.booked_by === currentUser) {
        // Cho phép hủy booking của mình
        if (confirm("🅿️ Bạn đã đặt chỗ này rồi.\n\nBạn muốn HỦY đặt chỗ không?")) {
          cancelMyBooking(slot);
        }
      } else {
        // Không cho đặt chỗ của người khác
        alert("⚠️ Chỗ này đã có người đặt rồi!\nVui lòng chọn chỗ khác.");
      }
      return;
    }
    
    // Slot trống, cho phép đặt
    // Set ngày và giờ mặc định: 1 giờ sau
    let now = new Date();
    now.setHours(now.getHours() + 1);
    
    // Set ngày (format YYYY-MM-DD)
    let defaultDate = now.getFullYear() + '-' + 
                      (now.getMonth() + 1).toString().padStart(2, '0') + '-' + 
                      now.getDate().toString().padStart(2, '0');
    document.getElementById('bookDate').value = defaultDate;
    
    // Set giờ (format HH:MM)
    let defaultTime = now.getHours().toString().padStart(2, '0') + ':' + 
                      now.getMinutes().toString().padStart(2, '0');
    document.getElementById('bookTime').value = defaultTime;
    
    updateBookingDuration();
    bookDialog.style.display = "block";
  });
}

// HỦY BOOKING CỦA MÌNH
function cancelMyBooking(slotId) {
  db.ref("Slots/" + slotId).update({
    status: "empty",
    booked_by: null,
    expire_time: null,
    book_date: null,
    book_time: null,
    booked_at: null
  })
  .then(() => {
    alert("✅ Đã hủy đặt chỗ thành công!");
  })
  .catch(err => {
    alert("❌ Lỗi: " + err.message);
  });
}

function closeDialog() {
  bookDialog.style.display = "none";
}

// Cập nhật hiển thị thời gian còn lại
function updateBookingDuration() {
  let selectedDate = document.getElementById('bookDate').value;
  let selectedTime = document.getElementById('bookTime').value;
  
  if (!selectedDate || !selectedTime) return;
  
  // Parse ngày và giờ đã chọn
  let [year, month, day] = selectedDate.split('-').map(Number);
  let [hours, minutes] = selectedTime.split(':').map(Number);
  
  let bookUntil = new Date(year, month - 1, day, hours, minutes, 0, 0);
  let now = new Date();
  let diffMs = bookUntil - now;
  
  if (diffMs <= 0) {
    document.getElementById('bookingDuration').innerText = 
      '⚠️ Thời gian phải sau hiện tại!';
    return;
  }
  
  // Tính toán số ngày, giờ, phút
  let diffMinutes = Math.floor(diffMs / 60000);
  let diffHours = Math.floor(diffMinutes / 60);
  let diffDays = Math.floor(diffHours / 24);
  
  let remainHours = diffHours % 24;
  let remainMinutes = diffMinutes % 60;
  
  // Hiển thị
  let durationText = '⏱️ Giữ chỗ: ';
  if (diffDays > 0) {
    durationText += diffDays + ' ngày ';
  }
  if (remainHours > 0) {
    durationText += remainHours + ' giờ ';
  }
  if (remainMinutes > 0 || (diffDays === 0 && remainHours === 0)) {
    durationText += remainMinutes + ' phút';
  }
  
  document.getElementById('bookingDuration').innerText = durationText;
}

// Lắng nghe thay đổi ngày và giờ
document.addEventListener('DOMContentLoaded', function() {
  let dateInput = document.getElementById('bookDate');
  let timeInput = document.getElementById('bookTime');
  
  if (dateInput) {
    dateInput.addEventListener('change', updateBookingDuration);
  }
  if (timeInput) {
    timeInput.addEventListener('change', updateBookingDuration);
  }
});

// GỬI LỆNH BOOK CHO ESP
function confirmBooking() {
  let selectedDate = document.getElementById('bookDate').value;
  let selectedTime = document.getElementById('bookTime').value;
  
  if (!selectedDate || !selectedTime) {
    alert('⚠️ Vui lòng chọn đầy đủ ngày và giờ!');
    return;
  }
  
  // Parse ngày và giờ
  let [year, month, day] = selectedDate.split('-').map(Number);
  let [hours, minutes] = selectedTime.split(':').map(Number);
  
  let bookUntil = new Date(year, month - 1, day, hours, minutes, 0, 0);
  let now = new Date();
  
  if (bookUntil <= now) {
    alert('⚠️ Thời gian đặt phải sau thời gian hiện tại!');
    return;
  }
  
  let expireTime = bookUntil.getTime();
  
  // Format ngày giờ hiển thị
  let displayDate = day.toString().padStart(2, '0') + '/' + 
                    month.toString().padStart(2, '0') + '/' + 
                    year;
  let displayTime = hours.toString().padStart(2, '0') + ':' + 
                    minutes.toString().padStart(2, '0');

  // Gửi lệnh booking xuống ESP32
  db.ref("Slots/" + selectedSlot).update({
    status: "booked",
    booked_by: currentUser,
    expire_time: expireTime,
    book_date: selectedDate,
    book_time: selectedTime,
    booked_at: Date.now()
  });

  alert("✅ Đã đặt chỗ đến:\n📅 " + displayDate + " ⏰ " + displayTime);
  closeDialog();
}

// AUTO CHECK EXPIRED BOOKINGS
setInterval(() => {
  let now = Date.now();
  
  db.ref("Slots").once("value", snap => {
    let slots = snap.val();
    if (!slots) return;
    
    Object.keys(slots).forEach(slotId => {
      let slot = slots[slotId];
      
      // Nếu đang booked và hết hạn
      if (slot.status === "booked" && slot.expire_time && now > slot.expire_time) {
        // Gửi lệnh hết hạn xuống ESP32
        db.ref("Slots/" + slotId).update({
          status: "empty",
          booked_by: null,
          expire_time: null,
          book_date: null,
          book_time: null,
          booked_at: null
        });
      }
    });
  });
}, 2000); // Check mỗi 2 giây

// CẬP NHẬT THỐNG KÊ
function updateStats(data) {
  let available = 0;
  let occupied = 0;
  let booked = 0;

  Object.keys(data).forEach(slot => {
    let info = data[slot];
    if (info.has_car) {
      occupied++;
    } else if (info.status === "booked") {
      booked++;
    } else {
      available++;
    }
  });

  document.getElementById("availableCount").innerText = available;
  document.getElementById("occupiedCount").innerText = occupied;
  document.getElementById("bookedCount").innerText = booked;
}

// REALTIME UPDATE TỪ ESP32
db.ref("Slots").on("value", snap => {
  let data = snap.val();
  
  if (!data) return;

  // Cập nhật thống kê
  updateStats(data);

  Object.keys(data).forEach(slotId => {
    let info = data[slotId];

    let box = document.getElementById(slotId + "Box");
    let statusEl = document.getElementById(slotId + "Status");
    let timer = document.getElementById(slotId + "Timer");

    if (!box) return; // Bỏ qua slot không tồn tại

    box.className = "parking-slot"; // reset

    // Ưu tiên 1: Xe thật (cảm biến phát hiện từ ESP32)
    if (info.has_car === true) {
      box.classList.add("occupied");
      statusEl.innerText = "CÓ XE";
      timer.innerText = "";
      return;
    }

    // Ưu tiên 2: Đang book
    if (info.status === "booked") {
      box.classList.add("booked");
      
      // Kiểm tra xem có phải booking của mình không
      if (info.booked_by === currentUser) {
        box.classList.add("my-booking");
        statusEl.innerText = "BẠN ĐÃ ĐẶT";
      } else {
        statusEl.innerText = "ĐÃ ĐẶT";
      }

      // Đếm ngược thời gian
      let remain = info.expire_time - Date.now();
      if (remain > 0) {
        let totalSeconds = Math.floor(remain / 1000);
        let days = Math.floor(totalSeconds / 86400);
        let hours = Math.floor((totalSeconds % 86400) / 3600);
        let minutes = Math.floor((totalSeconds % 3600) / 60);
        let seconds = totalSeconds % 60;
        
        let timeText = "";
        if (days > 0) {
          timeText = `⏱️ ${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
          timeText = `⏱️ ${hours}h ${minutes}m`;
        } else if (minutes > 0) {
          timeText = `⏱️ ${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
          timeText = `⏱️ ${seconds}s`;
        }
        
        timer.innerText = timeText;
      } else {
        timer.innerText = "";
      }
      return;
    }

    // Ưu tiên 3: Trống
    box.classList.add("empty");
    statusEl.innerText = "TRỐNG";
    timer.innerText = "";
  });
});
