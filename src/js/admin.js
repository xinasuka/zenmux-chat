// js/admin.js
// Client-side administrative controller for ZenMux user token and profile governance.

const STORAGE_KEY = 'zm_admin_token';
let currentAdminToken = sessionStorage.getItem(STORAGE_KEY) || '';

const el = {
  loginView: document.getElementById('login-view'),
  dashboardView: document.getElementById('dashboard-view'),
  loginForm: document.getElementById('login-form'),
  adminTokenInput: document.getElementById('admin-token-input'),
  loginSubmitBtn: document.getElementById('login-submit-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  createUserForm: document.getElementById('create-user-form'),
  userNameInput: document.getElementById('user-name-input'),
  createUserBtn: document.getElementById('create-user-btn'),
  newTokenCallout: document.getElementById('new-token-callout'),
  newTokenDisplay: document.getElementById('new-token-display'),
  copyNewTokenBtn: document.getElementById('copy-new-token-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  userCountBadge: document.getElementById('user-count-badge'),
  usersTableBody: document.getElementById('users-table-body'),
  toastContainer: document.getElementById('toast-container'),
  editModal: document.getElementById('edit-modal'),
  editModalClose: document.getElementById('edit-modal-close'),
  editModalCancel: document.getElementById('edit-modal-cancel'),
  editUserForm: document.getElementById('edit-user-form'),
  editUserOrigToken: document.getElementById('edit-user-orig-token'),
  editUserName: document.getElementById('edit-user-name'),
  editUserToken: document.getElementById('edit-user-token'),
  editUserRegenBtn: document.getElementById('edit-user-regen-btn'),
  editModalSubmit: document.getElementById('edit-modal-submit'),
};

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  el.toastContainer.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// 格式化时间戳
function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// 统一发送后台管理请求
async function adminFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Token': currentAdminToken,
    ...(options.headers || {})
  };
  const res = await fetch(endpoint, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// 模态弹窗与编辑口令控制
function openEditModal(token, name) {
  el.editUserOrigToken.value = token;
  el.editUserName.value = name || '';
  el.editUserToken.value = token;
  el.editModal.classList.remove('hidden');
  el.editUserName.focus();
}

function closeEditModal() {
  el.editModal.classList.add('hidden');
}

function generateRandomToken(len = 8) {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz';
  let res = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    res += chars[bytes[i] % chars.length];
  }
  return res;
}

// 加载并渲染用户列表
async function loadUsers() {
  try {
    const data = await adminFetch('/api/admin/users');
    const users = data.users || [];
    el.userCountBadge.textContent = `${users.length} 个用户`;

    if (users.length === 0) {
      el.usersTableBody.innerHTML = '<tr><td colspan="5" class="empty-placeholder">暂无任何用户口令，请在上表单中输入名称并生成。</td></tr>';
      return;
    }

    el.usersTableBody.innerHTML = '';
    users.forEach((u) => {
      const tr = document.createElement('tr');
      const isRevoked = u.status === 'revoked';

      tr.innerHTML = `
        <td style="font-weight: 500;">${escapeHtml(u.name || '未命名')}</td>
        <td>
          <span class="token-cell">
            <span>${escapeHtml(u.token)}</span>
            <button class="copy-btn" title="复制口令" data-token="${escapeHtml(u.token)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </span>
        </td>
        <td>
          <span class="status-badge ${isRevoked ? 'status-revoked' : 'status-active'}">
            ${isRevoked ? '已禁用' : '正常'}
          </span>
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">${formatTime(u.createdAt)}</td>
        <td style="text-align: right;">
          <div class="table-actions" style="justify-content: flex-end;">
            <button class="btn-action edit-btn" data-token="${escapeHtml(u.token)}" data-name="${escapeHtml(u.name || '')}">
              编辑
            </button>
            <button class="btn-action toggle-btn" data-token="${escapeHtml(u.token)}" data-status="${isRevoked ? 'active' : 'revoked'}">
              ${isRevoked ? '恢复启用' : '禁用'}
            </button>
            <button class="btn-action btn-action-danger delete-btn" data-token="${escapeHtml(u.token)}" data-name="${escapeHtml(u.name)}">
              删除
            </button>
          </div>
        </td>
      `;
      el.usersTableBody.appendChild(tr);
    });

    // 绑定编辑按钮
    el.usersTableBody.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const token = btn.getAttribute('data-token');
        const name = btn.getAttribute('data-name');
        openEditModal(token, name);
      });
    });

    // 绑定复制按钮
    el.usersTableBody.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const token = btn.getAttribute('data-token');
        navigator.clipboard.writeText(token);
        toast(`已复制口令: ${token}`, 'success');
      });
    });

    // 绑定切换状态按钮
    el.usersTableBody.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const token = btn.getAttribute('data-token');
        const targetStatus = btn.getAttribute('data-status');
        btn.disabled = true;
        try {
          await adminFetch('/api/admin/users', {
            method: 'PATCH',
            body: JSON.stringify({ token, status: targetStatus })
          });
          toast(`用户口令状态已更新为：${targetStatus === 'active' ? '正常' : '已禁用'}`, 'success');
          loadUsers();
        } catch (err) {
          toast(`操作失败: ${err.message}`, 'error');
          btn.disabled = false;
        }
      });
    });

    // 绑定删除按钮
    el.usersTableBody.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const token = btn.getAttribute('data-token');
        const name = btn.getAttribute('data-name');
        if (!confirm(`确定彻底删除用户「${name}」(${token}) 吗？删除后该口令将立即失去所有访问权限。`)) return;
        btn.disabled = true;
        try {
          await adminFetch(`/api/admin/users?token=${encodeURIComponent(token)}`, {
            method: 'DELETE'
          });
          toast('用户口令已成功删除', 'success');
          loadUsers();
        } catch (err) {
          toast(`删除失败: ${err.message}`, 'error');
          btn.disabled = false;
        }
      });
    });

  } catch (err) {
    el.usersTableBody.innerHTML = `<tr><td colspan="5" class="empty-placeholder" style="color: #ef4444;">无法读取数据: ${escapeHtml(err.message)}</td></tr>`;
    if (err.message.includes('401') || err.message.includes('认证失败')) {
      logout();
    }
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// 登录处理
async function handleLogin(token) {
  el.loginSubmitBtn.disabled = true;
  el.loginSubmitBtn.textContent = '正在验证...';
  try {
    currentAdminToken = token.trim();
    // 尝试发包验证
    await adminFetch('/api/admin/users');
    sessionStorage.setItem(STORAGE_KEY, currentAdminToken);
    el.loginView.classList.add('hidden');
    el.dashboardView.classList.remove('hidden');
    el.logoutBtn.classList.remove('hidden');
    toast('管理员身份验证成功', 'success');
    loadUsers();
  } catch (err) {
    toast(`登录失败: ${err.message}`, 'error');
    currentAdminToken = '';
    sessionStorage.removeItem(STORAGE_KEY);
  } finally {
    el.loginSubmitBtn.disabled = false;
    el.loginSubmitBtn.textContent = '验证并登录';
  }
}

function logout() {
  currentAdminToken = '';
  sessionStorage.removeItem(STORAGE_KEY);
  el.loginView.classList.remove('hidden');
  el.dashboardView.classList.add('hidden');
  el.logoutBtn.classList.add('hidden');
  el.adminTokenInput.value = '';
  el.newTokenCallout.classList.add('hidden');
  toast('已退出管理会话', 'info');
}

// 事件监听器绑定
el.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleLogin(el.adminTokenInput.value);
});

el.logoutBtn.addEventListener('click', logout);

el.refreshBtn.addEventListener('click', () => {
  toast('正在刷新数据...', 'info');
  loadUsers();
});

el.createUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el.userNameInput.value.trim();
  if (!name) return;

  el.createUserBtn.disabled = true;
  el.createUserBtn.textContent = '正在生成...';
  try {
    const data = await adminFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const user = data.user;
    el.userNameInput.value = '';
    el.newTokenDisplay.textContent = user.token;
    el.newTokenCallout.classList.remove('hidden');
    toast(`用户「${user.name}」已创建，口令为: ${user.token}`, 'success');
    loadUsers();
  } catch (err) {
    toast(`创建失败: ${err.message}`, 'error');
  } finally {
    el.createUserBtn.disabled = false;
    el.createUserBtn.textContent = '生成访问口令';
  }
});

el.copyNewTokenBtn.addEventListener('click', () => {
  const token = el.newTokenDisplay.textContent;
  if (token && token !== '--------') {
    navigator.clipboard.writeText(token);
    toast(`已复制口令: ${token}`, 'success');
  }
});

el.editModalClose.addEventListener('click', closeEditModal);
el.editModalCancel.addEventListener('click', closeEditModal);
el.editModal.addEventListener('click', (e) => {
  if (e.target === el.editModal) closeEditModal();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.editModal.classList.contains('hidden')) {
    closeEditModal();
  }
});

el.editUserRegenBtn.addEventListener('click', () => {
  el.editUserToken.value = generateRandomToken(8);
  toast('已随机生成新口令', 'info');
});

el.editUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const origToken = el.editUserOrigToken.value.trim();
  const name = el.editUserName.value.trim();
  const newToken = el.editUserToken.value.trim();

  if (!name) {
    toast('用户备注名称不能为空', 'error');
    return;
  }
  if (!newToken) {
    toast('访问口令不能为空', 'error');
    return;
  }
  if (newToken.length < 3 || newToken.length > 64) {
    toast('访问口令长度需在 3 到 64 个字符之间', 'error');
    return;
  }
  if (!/^[a-zA-Z0-9_\-]+$/.test(newToken)) {
    toast('访问口令仅支持字母、数字、下划线及连字符', 'error');
    return;
  }

  el.editModalSubmit.disabled = true;
  el.editModalSubmit.textContent = '正在保存...';

  try {
    const payload = { token: origToken, name };
    if (newToken !== origToken) {
      payload.newToken = newToken;
    }

    await adminFetch('/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    toast('用户信息与口令已成功更新', 'success');
    closeEditModal();
    loadUsers();
  } catch (err) {
    toast(`更新失败: ${err.message}`, 'error');
  } finally {
    el.editModalSubmit.disabled = false;
    el.editModalSubmit.textContent = '保存更改';
  }
});

// 页面初始化：若已有 session 则尝试自动免密进入
if (currentAdminToken) {
  handleLogin(currentAdminToken);
}
