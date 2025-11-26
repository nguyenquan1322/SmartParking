// Kiểm tra quyền admin
let currentUser = localStorage.getItem("currentUser");
if (!currentUser || currentUser !== "admin") {
  alert("⚠️ Bạn không có quyền truy cập trang này!");
  window.location.href = "login.html";
}

let allCards = []; // Lưu toàn bộ danh sách thẻ để tìm kiếm

// ========== ĐĂNG XUẤT ==========
function logout() {
  localStorage.removeItem("currentUser");
  window.location.href = "login.html";
}

// ========== BẮT ĐẦU ĐĂNG KÝ THẺ ==========
function startCardRegistration() {
  // Gửi lệnh xuống ESP32
  let commandId = "reg_" + Date.now();
  db.ref("Commands/CardRegistration").set({
    type: "card_registration",
    command_id: commandId,
    timestamp: Date.now(),
    status: "waiting" // waiting, completed, failed
  });

  showStatus("waiting", "⏳ Đang chờ ESP32 đọc thẻ RFID...\n📱 Vui lòng quẹt thẻ vào đầu đọc!");

  // Lắng nghe phản hồi từ ESP32
  let listener = db.ref("Commands/CardRegistration").on("value", snap => {
    let data = snap.val();
    
    if (data && data.command_id === commandId) {
      if (data.status === "completed" && data.card_id) {
        // ESP đã đọc được thẻ và gửi ID lên
        saveCardToDatabase(data.card_id);
        
        // Dọn dẹp listener
        db.ref("Commands/CardRegistration").off("value", listener);
      } else if (data.status === "failed") {
        showStatus("error", "❌ Đăng ký thất bại! Vui lòng thử lại.");
        db.ref("Commands/CardRegistration").off("value", listener);
      }
    }
  });

  // Timeout sau 60 giây
  setTimeout(() => {
    db.ref("Commands/CardRegistration").once("value", snap => {
      let data = snap.val();
      if (data && data.command_id === commandId && data.status === "waiting") {
        showStatus("error", "⏱️ Hết thời gian chờ! Vui lòng thử lại.");
        db.ref("Commands/CardRegistration").off("value", listener);
      }
    });
  }, 60000);
}

// ========== LƯU THẺ VÀO DATABASE ==========
function saveCardToDatabase(cardId) {
  // Kiểm tra thẻ đã tồn tại chưa
  db.ref("RegisteredCards/" + cardId).once("value", snap => {
    if (snap.exists()) {
      showStatus("error", "⚠️ Thẻ này đã được đăng ký trước đó!\nID thẻ: " + cardId);
      return;
    }

    // Lưu thẻ mới
    let cardData = {
      card_id: cardId,
      registered_at: Date.now(),
      status: "active" // active, inactive
    };

    db.ref("RegisteredCards/" + cardId).set(cardData)
      .then(() => {
        showStatus("success", "✅ Đăng ký thẻ thành công!\n🆔 ID thẻ: " + cardId);
        loadAllCards(); // Reload danh sách
      })
      .catch(err => {
        showStatus("error", "❌ Lỗi lưu dữ liệu: " + err.message);
      });
  });
}

// ========== HIỂN THỊ TRẠNG THÁI ==========
function showStatus(type, message) {
  let statusBox = document.getElementById("registrationStatus");
  statusBox.className = "status-box " + type;
  statusBox.innerText = message;
}

// ========== TẢI DANH SÁCH THẺ ==========
function loadAllCards() {
  db.ref("RegisteredCards").on("value", snap => {
    let data = snap.val();
    allCards = [];
    
    if (!data) {
      cardsList.innerHTML = '<div class="empty-state">📭 Chưa có thẻ nào được đăng ký</div>';
      return;
    }

    Object.keys(data).forEach(key => {
      allCards.push(data[key]);
    });

    // Sắp xếp theo thời gian đăng ký mới nhất
    allCards.sort((a, b) => b.registered_at - a.registered_at);

    displayCards(allCards);
  });
}

// ========== HIỂN THỊ DANH SÁCH THẺ ==========
function displayCards(cards) {
  if (cards.length === 0) {
    cardsList.innerHTML = '<div class="empty-state">🔍 Không tìm thấy kết quả</div>';
    return;
  }

  let html = "";
  cards.forEach(card => {
    let registeredDate = new Date(card.registered_at).toLocaleString("vi-VN");
    let statusBadge = card.status === "active" ? "🟢 Hoạt động" : "🔴 Đã khóa";

    html += `
      <div class="card-item" data-card-id="${card.card_id}">
        <div class="card-item-header">
          <div class="card-item-name">🎫 Thẻ RFID</div>
          <div class="card-item-id">${card.card_id}</div>
        </div>
        <div class="card-item-info">
          <span><strong>📅 Đăng ký:</strong> ${registeredDate}</span>
          <span><strong>📊 Trạng thái:</strong> ${statusBadge}</span>
        </div>
        <div class="card-item-actions">
          <button class="btn-edit" onclick="toggleCardStatus('${card.card_id}', '${card.status}')">
            ${card.status === "active" ? "🔒 Khóa thẻ" : "🔓 Kích hoạt"}
          </button>
          <button class="btn-delete" onclick="deleteCard('${card.card_id}')">
            🗑️ Xóa thẻ
          </button>
        </div>
      </div>
    `;
  });

  cardsList.innerHTML = html;
}

// ========== TÌM KIẾM THẺ ==========
function filterCards() {
  let searchText = searchCard.value.toLowerCase().trim();
  
  if (searchText === "") {
    displayCards(allCards);
    return;
  }

  let filtered = allCards.filter(card => {
    return card.card_id.toLowerCase().includes(searchText);
  });

  displayCards(filtered);
}

// ========== KHÓA/MỞ KHÓA THẺ ==========
function toggleCardStatus(cardId, currentStatus) {
  let newStatus = currentStatus === "active" ? "inactive" : "active";
  let action = newStatus === "active" ? "kích hoạt" : "khóa";
  
  if (confirm(`Bạn có chắc muốn ${action} thẻ này?`)) {
    db.ref("RegisteredCards/" + cardId).update({
      status: newStatus
    })
    .then(() => {
      alert(`✅ Đã ${action} thẻ thành công!`);
    })
    .catch(err => {
      alert("❌ Lỗi: " + err.message);
    });
  }
}

// ========== XÓA THẺ ==========
function deleteCard(cardId) {
  if (confirm(`⚠️ Bạn có chắc muốn xóa thẻ "${cardId}"?\nHành động này không thể hoàn tác!`)) {
    db.ref("RegisteredCards/" + cardId).remove()
      .then(() => {
        alert("✅ Đã xóa thẻ thành công!");
      })
      .catch(err => {
        alert("❌ Lỗi: " + err.message);
      });
  }
}

// ========== QUẢN LÝ BOOKING ==========
function loadBookings() {
  db.ref("Slots").on("value", snap => {
    let slots = snap.val();
    let bookingsList = document.getElementById("bookingsList");
    
    if (!slots) {
      bookingsList.innerHTML = '<div class="empty-state">📭 Chưa có booking nào</div>';
      return;
    }
    
    let bookings = [];
    Object.keys(slots).forEach(slotId => {
      let slot = slots[slotId];
      if (slot.status === "booked") {
        bookings.push({
          slotId: slotId,
          ...slot
        });
      }
    });
    
    if (bookings.length === 0) {
      bookingsList.innerHTML = '<div class="empty-state">📭 Chưa có booking nào</div>';
      return;
    }
    
    // Sắp xếp theo thời gian đặt gần nhất
    bookings.sort((a, b) => b.booked_at - a.booked_at);
    
    let html = "";
    bookings.forEach(booking => {
      let bookedTime = new Date(booking.booked_at).toLocaleString("vi-VN");
      let expireDate = new Date(booking.expire_time).toLocaleString("vi-VN");
      
      // Tính thời gian còn lại
      let remain = booking.expire_time - Date.now();
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
      
      html += `
        <div class="booking-item">
          <div class="booking-info-left">
            <div class="booking-slot">🅿️ ${booking.slotId}</div>
            <div class="booking-user">👤 ${booking.booked_by}</div>
            <div class="booking-time">
              📅 Đặt lúc: ${bookedTime}<br>
              ⏰ Đến: ${expireDate}<br>
              ⏱️ Còn lại: <strong>${remainText}</strong>
            </div>
          </div>
          <div class="booking-actions">
            <button class="btn-cancel-booking" onclick="cancelBooking('${booking.slotId}', '${booking.booked_by}')">
              ❌ Hủy
            </button>
          </div>
        </div>
      `;
    });
    
    bookingsList.innerHTML = html;
  });
}

function cancelBooking(slotId, userName) {
  if (confirm(`⚠️ Hủy booking của "${userName}" tại ${slotId}?`)) {
    db.ref("Slots/" + slotId).update({
      status: "empty",
      booked_by: null,
      expire_time: null,
      book_date: null,
      book_time: null,
      booked_at: null
    })
    .then(() => {
      alert("✅ Đã hủy booking!");
    })
    .catch(err => {
      alert("❌ Lỗi: " + err.message);
    });
  }
}

// ========== LỊCH SỬ RA/VÀO ==========================
let allLogs = [];

function loadAccessLogs() {
  db.ref("AccessLogs").limitToLast(100).on("value", snap => {
    let logs = snap.val();
    allLogs = [];
    
    if (!logs) {
      document.getElementById("accessLogs").innerHTML = 
        '<div class="empty-state">📭 Chưa có lịch sử ra/vào</div>';
      return;
    }

    // Chuyển thành array
    Object.keys(logs).forEach(key => {
      allLogs.push({
        id: key,
        ...logs[key]
      });
    });

    // Sắp xếp theo thời gian mới nhất
    allLogs.sort((a, b) => b.timestamp - a.timestamp);

    displayLogs(allLogs);
  });
}

function displayLogs(logs) {
  if (logs.length === 0) {
    document.getElementById("accessLogs").innerHTML = 
      '<div class="empty-state">🔍 Không tìm thấy kết quả</div>';
    return;
  }

  let html = "";
  
  // Tính thời gian đậu xe (ghép entry-exit)
  let cardLastEntry = {};  // Lưu entry gần nhất của mỗi thẻ
  
  logs.forEach((log, index) => {
    let time = new Date(log.timestamp).toLocaleString("vi-VN");
    let icon = log.type === "entry" ? "🟢" : "🔴";
    let typeClass = log.type;
    let typeText = log.type === "entry" ? "VÀO" : "RA";
    
    // Tính thời gian đậu nếu là exit
    let durationHtml = "";
    if (log.type === "exit" && cardLastEntry[log.card_id]) {
      let entryTime = cardLastEntry[log.card_id];
      let duration = log.timestamp - entryTime;
      let hours = Math.floor(duration / 3600000);
      let minutes = Math.floor((duration % 3600000) / 60000);
      
      if (hours > 0) {
        durationHtml = `<span class="log-duration">⏱️ ${hours}h ${minutes}m</span>`;
      } else {
        durationHtml = `<span class="log-duration">⏱️ ${minutes}m</span>`;
      }
    }
    
    // Lưu entry để tính duration cho exit sau
    if (log.type === "entry") {
      cardLastEntry[log.card_id] = log.timestamp;
    }
    
    html += `
      <div class="log-item ${typeClass}">
        <div class="log-icon">${icon}</div>
        <div class="log-card-id">${log.card_id}</div>
        <div class="log-time">${time}</div>
        <div style="font-weight: 600; color: ${log.type === 'entry' ? '#28a745' : '#dc3545'}; min-width: 50px;">
          ${typeText}
        </div>
        ${durationHtml}
      </div>
    `;
  });

  document.getElementById("accessLogs").innerHTML = html;
}

function filterLogs() {
  let filterType = document.getElementById("filterType").value;
  let searchText = document.getElementById("searchLog").value.toLowerCase().trim();
  
  let filtered = allLogs.filter(log => {
    // Filter by type
    if (filterType !== "all" && log.type !== filterType) {
      return false;
    }
    
    // Filter by card_id
    if (searchText !== "" && !log.card_id.toLowerCase().includes(searchText)) {
      return false;
    }
    
    return true;
  });
  
  displayLogs(filtered);
}

// ========== KHỞI TẠO ==========
loadAllCards();
loadBookings();
loadAccessLogs();

