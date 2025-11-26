function register() {
  let u = username.value.trim();
  let p = password.value.trim();

  // Clear previous message
  authMsg.innerText = "";
  authMsg.className = "msg";

  if (!u || !p) {
    authMsg.innerText = "⚠️ Vui lòng điền đầy đủ thông tin!";
    authMsg.classList.add("error");
    return;
  }

  if (u.length < 3) {
    authMsg.innerText = "⚠️ Tên người dùng phải có ít nhất 3 ký tự!";
    authMsg.classList.add("error");
    return;
  }

  if (p.length < 4) {
    authMsg.innerText = "⚠️ Mật khẩu phải có ít nhất 4 ký tự!";
    authMsg.classList.add("error");
    return;
  }

  db.ref("Users/" + u).once("value", snap => {
    if (snap.exists()) {
      authMsg.innerText = "❌ Tên người dùng đã tồn tại!";
      authMsg.classList.add("error");
      return;
    }
    
    db.ref("Users/" + u).set({ password: p });
    authMsg.innerText = "✅ Đăng ký thành công! Đang chuyển hướng...";
    authMsg.classList.add("success");
    setTimeout(() => window.location.href = "login.html", 1200);
  });
}

function login() {
  let u = username.value.trim();
  let p = password.value.trim();

  // Clear previous message
  authMsg.innerText = "";
  authMsg.className = "msg";

  if (!u || !p) {
    authMsg.innerText = "⚠️ Vui lòng điền đầy đủ thông tin!";
    authMsg.classList.add("error");
    return;
  }

  // Kiểm tra tài khoản admin đặc biệt
  if (u === "admin" && p === "admin") {
    localStorage.setItem("currentUser", "admin");
    authMsg.innerText = "✅ Chào mừng Admin! Đang chuyển hướng...";
    authMsg.classList.add("success");
    setTimeout(() => window.location.href = "admin.html", 800);
    return;
  }

  // Đăng nhập bình thường cho user
  db.ref("Users/" + u).once("value", snap => {
    if (!snap.exists()) {
      authMsg.innerText = "❌ Tên người dùng không tồn tại!";
      authMsg.classList.add("error");
      return;
    }
    
    if (snap.val().password !== p) {
      authMsg.innerText = "❌ Mật khẩu không chính xác!";
      authMsg.classList.add("error");
      return;
    }

    localStorage.setItem("currentUser", u);
    authMsg.innerText = "✅ Đăng nhập thành công! Đang chuyển hướng...";
    authMsg.classList.add("success");
    setTimeout(() => window.location.href = "dashboard.html", 800);
  });
}
