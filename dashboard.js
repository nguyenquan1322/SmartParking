let selectedSlot = "";
let currentUser = localStorage.getItem("currentUser");
let paymentDialog = document.getElementById("paymentDialog");
let bookingInfoDialog = null;
let confirmDialog = null;
let currentBookingData = null;

// Map slot ID sang display name
const slotDisplayNames = {
  "Slot01": "A1",
  "Slot02": "A2",
  "Slot03": "A3"
};

// Hàm chuyển đổi slot ID sang display name
function getSlotDisplayName(slotId) {
  return slotDisplayNames[slotId] || slotId;
}

// Bảo vệ trang - chỉ cho phép user đã đăng nhập
if (!currentUser) {
  window.location.href = "login.html";
}

// Không cho admin vào trang dashboard
if (currentUser === "admin") {
  window.location.href = "admin.html";
}

// Khởi tạo sau khi DOM load
document.addEventListener('DOMContentLoaded', function() {
  bookingInfoDialog = document.getElementById("bookingInfoDialog");
  confirmDialog = document.getElementById("confirmDialog");
});

function logout() {
  localStorage.removeItem("currentUser");
  window.location.href = "login.html";
}

// ========== NOTIFICATION TOAST ==========
function showNotification(type, title, message) {
  let toast = document.getElementById("notificationToast");
  let icon = document.getElementById("toastIcon");
  let toastTitle = document.getElementById("toastTitle");
  let toastMessage = document.getElementById("toastMessage");
  
  // Set icon và class
  icon.className = "toast-icon " + type;
  
  switch(type) {
    case "success":
      icon.innerText = "✅";
      break;
    case "error":
      icon.innerText = "❌";
      break;
    case "warning":
      icon.innerText = "⚠️";
      break;
    case "info":
      icon.innerText = "ℹ️";
      break;
  }
  
  toastTitle.innerText = title;
  toastMessage.innerText = message;
  
  // Show toast
  toast.classList.add("show");
  
  // Auto hide sau 4 giây
  setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}

// ========== BOOKING INFO DIALOG ==========
function showBookingInfo(slotId, slotData) {
  currentBookingData = { slotId, ...slotData };
  
  // Điền thông tin
  document.getElementById("infoSlotId").innerText = getSlotDisplayName(slotId);
  document.getElementById("infoBookedBy").innerText = slotData.booked_by;
  
  // Format thời gian
  let bookedAt = new Date(slotData.booked_at).toLocaleString("vi-VN");
  let expireTime = new Date(slotData.expire_time).toLocaleString("vi-VN");
  
  document.getElementById("infoBookedAt").innerText = bookedAt;
  document.getElementById("infoExpireTime").innerText = expireTime;
  
  // Tính thời gian còn lại
  let remain = slotData.expire_time - Date.now();
  let remainText = "";
  
  if (remain > 0) {
    let totalSeconds = Math.floor(remain / 1000);
    let days = Math.floor(totalSeconds / 86400);
    let hours = Math.floor((totalSeconds % 86400) / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    
    if (days > 0) {
      remainText = `${days} ngày ${hours} giờ`;
    } else if (hours > 0) {
      remainText = `${hours} giờ ${minutes} phút`;
    } else {
      remainText = `${minutes} phút`;
    }
  } else {
    remainText = "Đã hết hạn";
  }
  
  document.getElementById("infoRemaining").innerText = remainText;
  
  // Số tiền
  let payment = slotData.payment || 0;
  document.getElementById("infoPayment").innerText = payment.toLocaleString('vi-VN') + " đ";
  
  // Hiển thị dialog
  bookingInfoDialog.style.display = "block";
}

function closeBookingInfo() {
  bookingInfoDialog.style.display = "none";
  currentBookingData = null;
}

function confirmCancelBooking() {
  if (!currentBookingData) return;
  
  // Hiển thị confirm dialog
  document.getElementById("confirmTitle").innerText = "Hủy đặt chỗ";
  document.getElementById("confirmMessage").innerText = 
    `Bạn có chắc chắn muốn hủy đặt chỗ ${getSlotDisplayName(currentBookingData.slotId)}?\n\nSố tiền ${(currentBookingData.payment || 0).toLocaleString('vi-VN')} đ sẽ không được hoàn lại.`;
  
  confirmDialog.style.display = "block";
  
  // Xử lý nút Yes
  document.getElementById("confirmYes").onclick = function() {
    confirmDialog.style.display = "none";
    bookingInfoDialog.style.display = "none";
    cancelMyBooking(currentBookingData.slotId);
  };
  
  // Xử lý nút No
  document.getElementById("confirmNo").onclick = function() {
    confirmDialog.style.display = "none";
  };
}

function openBooking(slot) {
  selectedSlot = slot;
  
  // Kiểm tra slot có đang được đặt không
  db.ref("Slots/" + slot).once("value", snap => {
    let slotData = snap.val();
    
    // Nếu slot đang có xe
    if (slotData && slotData.has_car === true) {
      showNotification("warning", "Không thể đặt chỗ", "Chỗ này đang có xe đậu! Vui lòng chọn chỗ khác.");
      return;
    }
    
    // Nếu slot đang booked
    if (slotData && slotData.status === "booked") {
      // Kiểm tra xem có phải booking của mình không
      if (slotData.booked_by === currentUser) {
        // Hiển thị thông tin booking của mình
        showBookingInfo(slot, slotData);
      } else {
        // Không cho đặt chỗ của người khác
        showNotification("warning", "Không thể đặt chỗ", "Chỗ này đã có người đặt rồi! Vui lòng chọn chỗ khác.");
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
    booked_at: null,
    payment: null
  })
  .then(() => {
    showNotification("success", "Hủy thành công", "Đã hủy đặt chỗ thành công!");
  })
  .catch(err => {
    showNotification("error", "Lỗi", err.message);
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
// TÍNH TIỀN THEO QUY TẮC
function calculatePayment() {
  let selectedDate = document.getElementById('bookDate').value;
  let selectedTime = document.getElementById('bookTime').value;
  
  if (!selectedDate || !selectedTime) {
    return null;
  }
  
  let [year, month, day] = selectedDate.split('-').map(Number);
  let [hours, minutes] = selectedTime.split(':').map(Number);
  
  let bookUntil = new Date(year, month - 1, day, hours, minutes, 0, 0);
  let now = new Date();
  
  if (bookUntil <= now) {
    return null;
  }
  
  // Tính số milliseconds
  let durationMs = bookUntil.getTime() - now.getTime();
  
  // Chuyển sang giờ và làm tròn LÊN
  let durationHours = Math.ceil(durationMs / (1000 * 60 * 60));
  
  // Công thức: 5,000 + (số giờ × 3,000)
  const BASE_FEE = 5000;
  const HOURLY_RATE = 3000;
  
  let hourlyFee = durationHours * HOURLY_RATE;
  let totalFee = BASE_FEE + hourlyFee;
  
  return {
    hours: durationHours,
    hourlyFee: hourlyFee,
    totalFee: totalFee,
    expireTime: bookUntil.getTime(),
    displayDate: day.toString().padStart(2, '0') + '/' + 
                 month.toString().padStart(2, '0') + '/' + 
                 year,
    displayTime: hours.toString().padStart(2, '0') + ':' + 
                 minutes.toString().padStart(2, '0')
  };
}

function confirmBooking() {
  let selectedDate = document.getElementById('bookDate').value;
  let selectedTime = document.getElementById('bookTime').value;
  
  if (!selectedDate || !selectedTime) {
    showNotification("warning", "Thiếu thông tin", "Vui lòng chọn đầy đủ ngày và giờ!");
    return;
  }
  
  let payment = calculatePayment();
  
  if (!payment) {
    showNotification("warning", "Thời gian không hợp lệ", "Thời gian đặt phải sau thời gian hiện tại!");
    return;
  }
  
  // Hiển thị thông tin thanh toán
  document.getElementById('paymentDuration').innerText = payment.hours + ' giờ';
  document.getElementById('paymentHourlyFee').innerText = payment.hourlyFee.toLocaleString('vi-VN') + ' đ';
  document.getElementById('paymentTotal').innerText = payment.totalFee.toLocaleString('vi-VN') + ' đ';
  
  // Ẩn booking dialog, hiện payment dialog
  bookDialog.style.display = "none";
  paymentDialog.style.display = "block";
  
  // Reset trạng thái
  document.getElementById('paymentProcessing').classList.add('hidden');
  document.getElementById('paymentSuccess').classList.add('hidden');
  paymentDialog.querySelectorAll('.dialog-buttons')[0].style.display = 'flex';
}

function closePaymentDialog() {
  paymentDialog.style.display = "none";
  // Mở lại booking dialog nếu muốn sửa
  bookDialog.style.display = "block";
}

function processPayment() {
  // Ẩn buttons
  paymentDialog.querySelectorAll('.dialog-buttons')[0].style.display = 'none';
  
  // Hiện processing
  document.getElementById('paymentProcessing').classList.remove('hidden');
  
  // Fake processing 2-3 giây
  setTimeout(() => {
    // Ẩn processing
    document.getElementById('paymentProcessing').classList.add('hidden');
    
    // Hiện success
    document.getElementById('paymentSuccess').classList.remove('hidden');
    
    // Sau 2 giây nữa thì hoàn tất booking
    setTimeout(() => {
      completeBooking();
    }, 2000);
  }, 2500);
}

function completeBooking() {
  let payment = calculatePayment();
  
  if (!payment) {
    showNotification("error", "Lỗi", "Không thể hoàn tất đặt chỗ");
    paymentDialog.style.display = "none";
    return;
  }
  
  let selectedDate = document.getElementById('bookDate').value;
  let selectedTime = document.getElementById('bookTime').value;
  
  // Gửi lệnh booking xuống ESP32
  db.ref("Slots/" + selectedSlot).update({
    status: "booked",
    booked_by: currentUser,
    expire_time: payment.expireTime,
    book_date: selectedDate,
    book_time: selectedTime,
    booked_at: Date.now(),
    payment: payment.totalFee
  })
  .then(() => {
    showNotification("success", "Đặt chỗ thành công", 
      `Đã thanh toán ${payment.totalFee.toLocaleString('vi-VN')} đ - Đặt đến ${payment.displayDate} ${payment.displayTime}`);
    paymentDialog.style.display = "none";
  })
  .catch(err => {
    showNotification("error", "Lỗi", err.message);
    paymentDialog.style.display = "none";
  });
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
          booked_at: null,
          payment: null
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
