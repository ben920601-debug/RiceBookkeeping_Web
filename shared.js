// ==========================================
// 🔧 記帳米粒 監控後台 - 共用邏輯（shared.js）
// ------------------------------------------
// 被 index.html / manage.html / orders.html / trips.html / finance.html 共同載入。
// 拆成獨立檔案後，每個頁面各自是一個實體 .html 檔案；「跨頁面共用登入狀態」
// 是靠 sessionStorage（同一個瀏覽器分頁內有效，分頁關掉就清除，不會留下明碼痕跡）。
// ==========================================

const API_BASE_URL = "https://ricebookkeeping.ricecook.org";
const ADMIN_API_BASE_URL = "https://ricebookkeepingadmin.ricecook.org";
const MY_LIFF_ID = "2010446205-W1G1WDQQ";
const POLL_INTERVAL_MS = 5000;

async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒逾時保護，避免request卡住讓整頁永遠沒反應
    let res;
    try {
        res = await fetch(`${API_BASE_URL}${path}`, {
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            ...options
        });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('連線逾時，請稍後再試');
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
    if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).detail || ""; } catch (e) {}
        throw new Error(detail || `API 錯誤 (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function catEmptyState(text, sizeClass) {
    return `<div class="text-center ${sizeClass || 'py-8'} text-white/30 text-xs font-mono">
        <div class="text-3xl mb-2 select-none">😴🐱</div>
        <div>${text}</div>
    </div>`;
}

// ==========================================
// 🔐 跨頁面 Session
// ==========================================
function saveSession(mode, targetId, displayName, pictureUrl) {
    sessionStorage.setItem('rb_verified', '1');
    sessionStorage.setItem('rb_mode', mode);
    sessionStorage.setItem('rb_target_id', targetId);
    sessionStorage.setItem('rb_display_name', displayName || '');
    sessionStorage.setItem('rb_picture_url', pictureUrl || '');
}

function getSession() {
    return {
        verified: sessionStorage.getItem('rb_verified') === '1',
        mode: sessionStorage.getItem('rb_mode'),
        targetId: sessionStorage.getItem('rb_target_id'),
        displayName: sessionStorage.getItem('rb_display_name') || '',
        pictureUrl: sessionStorage.getItem('rb_picture_url') || '',
        isGroup: sessionStorage.getItem('rb_mode') === 'group',
    };
}

function requireSession() {
    const s = getSession();
    if (!s.verified || !s.targetId) {
        window.location.href = 'index.html';
        return null;
    }
    return s;
}

// ==========================================
// 🖥️ 監控後台總開關／跑馬燈／維護密碼繞過
// ==========================================
let globalFeatureStatuses = {};
let lastFeatureStatusesStr = null;

function applyMarquee(s) {
    const bar = document.getElementById('marquee-bar');
    const inner = document.getElementById('marquee-text-inner');
    const maintBox = document.getElementById('maintenance-marquee');
    const maintText = document.getElementById('maintenance-marquee-text');
    if (!bar || !inner) return;
    if (s.marquee_enabled && s.marquee_text) {
        inner.textContent = s.marquee_text;
        inner.style.color = s.marquee_color || '#F59E0B';
        inner.style.animation = `marquee ${s.marquee_speed_seconds || 18}s linear infinite`;
        bar.classList.remove('hidden');
        if (maintText && maintBox) {
            maintText.textContent = s.marquee_text;
            maintText.style.color = s.marquee_color || '#F59E0B';
            maintBox.classList.remove('hidden');
        }
    } else {
        bar.classList.add('hidden');
        if (maintBox) maintBox.classList.add('hidden');
    }
}

function showReloadPrompt() {
    const bar = document.getElementById('marquee-bar');
    const inner = document.getElementById('marquee-text-inner');
    if (!bar || !inner) return;
    inner.textContent = '⚙️ 後台功能狀態已更新（圖示標籤已自動套用最新內容）';
    inner.style.color = '#F87171';
    inner.style.animation = `marquee 14s linear infinite`;
    bar.classList.remove('hidden');
}

async function checkDashboardSettings() {
    try {
        const s = await apiFetch('/api/dashboard-settings');
        globalFeatureStatuses = s.feature_statuses || {};
        lastFeatureStatusesStr = JSON.stringify(globalFeatureStatuses);
        applyMarquee(s);

        const bypassed = sessionStorage.getItem('maintenance_bypass') === '1';
        if (s.dashboard_enabled === false && !bypassed) {
            const scr = document.getElementById('maintenance-screen');
            if (scr) scr.classList.remove('hidden');
            return false;
        }
        return true;
    } catch (e) {
        console.error('監控後台設定讀取失敗，預設當作正常開放：', e);
        return true;
    }
}

function startSettingsPolling(onStatusChange) {
    setInterval(async () => {
        try {
            const s = await apiFetch('/api/dashboard-settings');
            applyMarquee(s);

            const bypassed = sessionStorage.getItem('maintenance_bypass') === '1';
            const scr = document.getElementById('maintenance-screen');
            if (s.dashboard_enabled === false && !bypassed) {
                if (scr) scr.classList.remove('hidden');
                return;
            }
            if (scr) scr.classList.add('hidden');

            const newStatusesStr = JSON.stringify(s.feature_statuses || {});
            if (lastFeatureStatusesStr !== null && newStatusesStr !== lastFeatureStatusesStr) {
                globalFeatureStatuses = s.feature_statuses || {};
                if (typeof onStatusChange === 'function') onStatusChange();
                showReloadPrompt();
            }
            lastFeatureStatusesStr = newStatusesStr;
        } catch (e) {
            console.error('設定輪詢失敗：', e);
        }
    }, 30000);
}

window.submitMaintenanceBypass = async function() {
    const pwd = document.getElementById('maintenance-password-input').value;
    const errorEl = document.getElementById('maintenance-password-error');
    errorEl.classList.add('hidden');
    if (!pwd) return;
    try {
        const res = await fetch(`${ADMIN_API_BASE_URL}/api/admin/verify-gate-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            sessionStorage.setItem('maintenance_bypass', '1');
            document.getElementById('maintenance-screen').classList.add('hidden');
            if (typeof onMaintenanceBypassed === 'function') onMaintenanceBypassed();
        } else {
            errorEl.classList.remove('hidden');
        }
    } catch (e) {
        errorEl.textContent = '⚠️ 驗證失敗，請確認網路狀況';
        errorEl.classList.remove('hidden');
    }
}

// ==========================================
// 🚦 導覽列圖示：Beta／維護中／不開放 標籤與可見性
// ==========================================
const FEATURE_KEY_MAP = { manage: null, orders: 'orders_dashboard', trips: 'trips_dashboard', finance: 'finance_dashboard' };

function applyFeatureBadge(btnId, featureKey) {
    const status = globalFeatureStatuses[featureKey];
    const btn = document.getElementById(btnId);
    const anchor = document.querySelector(`#${btnId} .badge-anchor`);

    if (status === 'hidden') {
        if (btn) btn.classList.add('hidden');
        return;
    }
    if (btn) {
        const pageKey = Object.keys(FEATURE_KEY_MAP).find(k => FEATURE_KEY_MAP[k] === featureKey);
        const session = getSession();
        const modeHidden = (pageKey === 'orders' && !session.isGroup) || (pageKey === 'finance' && session.isGroup);
        if (!modeHidden) btn.classList.remove('hidden');
    }

    if (!anchor) return;
    if (status === 'beta' || status === 'maintenance') {
        anchor.className = 'badge-anchor absolute -top-1 -right-2 text-[6px] px-1 py-px rounded-full font-bold leading-none whitespace-nowrap ' +
            (status === 'beta' ? 'bg-amber-400 text-[#0A1128]' : 'bg-rose-500 text-white');
        anchor.textContent = status === 'beta' ? 'Beta' : '維護';
    } else {
        anchor.className = 'badge-anchor absolute -top-1 -right-2';
        anchor.textContent = '';
    }
}

function revealNavFooter() {
    const footer = document.getElementById("nav-footer");
    if (footer) footer.classList.remove("invisible");
}

function applyAllNavBadges() {
    try {
        applyFeatureBadge("btn-nav-orders", "orders_dashboard");
        applyFeatureBadge("btn-nav-trips", "trips_dashboard");
        applyFeatureBadge("btn-nav-finance", "finance_dashboard");
    } catch (e) {
        console.error('導覽列標籤套用失敗（不影響導覽列本身顯示）：', e);
    }
    // 判斷都做完了，才把整條導覽列一次顯示出來，避免使用者看到「全部顯示→突然藏起來/冒出來」的閃爍
    revealNavFooter();
}

// 🛟 保險機制：不管上面判斷邏輯有沒有正常執行到，最多 1.5 秒後一定強制顯示導覽列，
// 避免任何一個環節出錯就讓整條導覽列永久消失、使用者完全點不到任何東西。
setTimeout(revealNavFooter, 1500);

function applyNavModeVisibility() {
    const session = getSession();
    const btnOrders = document.getElementById("btn-nav-orders");
    const btnFinance = document.getElementById("btn-nav-finance");
    if (btnOrders) btnOrders.classList.toggle("hidden", !session.isGroup);
    if (btnFinance) btnFinance.classList.toggle("hidden", session.isGroup);
}

// ==========================================
// 🔒 頁面層級守門：manage/orders/trips/finance.html 開頭呼叫
// 回傳 true = 可以繼續渲染頁面內容；false = 已導回首頁或顯示密碼輸入覆蓋層
// ==========================================
async function guardPageAccess(pageKey) {
    const featureKey = FEATURE_KEY_MAP[pageKey];
    if (!featureKey) return true;
    const status = globalFeatureStatuses[featureKey];

    if (status === 'hidden') {
        window.location.href = 'index.html';
        return false;
    }
    if (status !== 'beta' && status !== 'maintenance') return true;

    const unlockKey = `rb_gate_${pageKey}`;
    if (sessionStorage.getItem(unlockKey) === '1') return true;

    showGateOverlay(status, unlockKey);
    return false;
}

function showGateOverlay(status, unlockKey) {
    const label = status === 'beta' ? 'Beta 測試功能' : '維護中功能';
    const overlay = document.createElement('div');
    overlay.id = 'page-gate-overlay';
    overlay.className = 'fixed inset-0 bg-[#0A1128] z-[55] flex flex-col items-center justify-center px-6';
    overlay.innerHTML = `
        <div class="text-center space-y-3 max-w-xs w-full">
            <div class="text-4xl">🔒</div>
            <h1 class="text-base font-bold tracking-widest">目前功能為「${label}」狀態</h1>
            <p class="text-xs text-white/40">請輸入密碼進入開發與維護</p>
            <div class="flex gap-2 pt-2">
                <input type="password" id="page-gate-password-input" placeholder="密碼" class="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" />
                <button id="page-gate-submit-btn" class="bg-white text-[#0A1128] font-bold text-xs px-4 rounded-xl hover:bg-white/90 transition cursor-pointer">進入</button>
            </div>
            <p id="page-gate-error" class="text-[10px] text-rose-400 hidden">❌ 密碼錯誤</p>
            <button id="page-gate-back-btn" class="text-[10px] text-white/30 hover:text-white/60 mt-2 cursor-pointer">← 返回首頁</button>
        </div>`;
    document.body.appendChild(overlay);

    document.getElementById('page-gate-back-btn').addEventListener('click', () => { window.location.href = 'index.html'; });
    document.getElementById('page-gate-submit-btn').addEventListener('click', () => submitPageGate(unlockKey));
    document.getElementById('page-gate-password-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPageGate(unlockKey); });
}

async function submitPageGate(unlockKey) {
    const pwd = document.getElementById('page-gate-password-input').value;
    const errorEl = document.getElementById('page-gate-error');
    errorEl.classList.add('hidden');
    if (!pwd) return;
    try {
        const res = await fetch(`${ADMIN_API_BASE_URL}/api/admin/verify-gate-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            sessionStorage.setItem(unlockKey, '1');
            window.location.reload();
        } else {
            errorEl.classList.remove('hidden');
        }
    } catch (e) {
        errorEl.textContent = '⚠️ 驗證失敗，請確認網路狀況';
        errorEl.classList.remove('hidden');
    }
}

// ==========================================
// 📊 圖表共用工具
// ==========================================
const EXPENSE_CHART_COLORS = ['#FFFFFF', '#E2E8F0', '#94A3B8', '#64748B', '#475569', '#334155', '#1E293B', '#0F172A', '#CBD5E1', '#475569'];
const SECONDARY_CHART_COLORS = ['#FFFFFF', '#34D399', '#60A5FA', '#FBBF24', '#F87171', '#A78BFA', '#38BDF8', '#FB923C', '#4ADE80', '#F472B6'];

function renderLegendList(containerId, labels, values, colors) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!labels.length) {
        el.innerHTML = `<div class="text-white/20 text-center py-6">😴 尚無資料</div>`;
        return;
    }
    const total = values.reduce((a, b) => a + b, 0);
    el.innerHTML = labels.map((label, i) => {
        const val = values[i];
        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
        const color = colors[i % colors.length];
        return `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color}"></span>
                    <span class="text-white/70 truncate">${escapeHtml(label)}</span>
                </div>
                <span class="text-white/90 font-bold whitespace-nowrap">$${val.toLocaleString()} <span class="text-white/30 font-normal">${pct}%</span></span>
            </div>`;
    }).join('');
}

function renderDoughnutChart(canvasId, chartRef, dataMap, setChartRef, legendContainerId, colors) {
    const el = document.getElementById(canvasId); if (!el) return;
    const ctx = el.getContext('2d'); const labels = Object.keys(dataMap); const vals = Object.values(dataMap);
    const palette = colors || SECONDARY_CHART_COLORS;
    if (chartRef) { chartRef.destroy(); }
    if (legendContainerId) renderLegendList(legendContainerId, labels, vals, palette);
    if (labels.length === 0) { ctx.clearRect(0, 0, el.width, el.height); return; }
    const newChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: vals, backgroundColor: palette, borderWidth: 2, borderColor: '#1C2541' }] },
        options: { responsive: true, plugins: { legend: { display: false } }, cutout: '70%' }
    });
    setChartRef(newChart);
}

// ==========================================
// 👥 群組成員選擇器
// ==========================================
let _groupMembersCache = [];
let _memberPickerResolve = null;

async function loadGroupMembersCache(targetId) {
    try {
        _groupMembersCache = await apiFetch(`/api/groups/${encodeURIComponent(targetId)}/members`);
    } catch (e) {
        console.error('群組成員清單讀取失敗：', e);
        _groupMembersCache = [];
    }
    return _groupMembersCache;
}

function pickGroupMember(title) {
    return new Promise((resolve) => {
        const modal = document.getElementById('member-picker-modal');
        const listEl = document.getElementById('member-picker-list');
        document.getElementById('member-picker-title').textContent = title;
        if (!_groupMembersCache.length) {
            listEl.innerHTML = `<div class="text-white/30 text-xs py-4 text-center">目前無法取得群組成員清單，請按下方「取消」後改用其他方式輸入。</div>`;
        } else {
            listEl.innerHTML = _groupMembersCache.map(m => `
                <button onclick="resolveMemberPicker('${m.user_id}', '${escapeHtml(m.display_name).replace(/'/g, "\\'")}')" class="w-full text-left px-3 py-2.5 rounded-xl bg-[#0A1128]/50 hover:bg-white/10 text-xs text-white/90 cursor-pointer transition">${escapeHtml(m.display_name)}</button>
            `).join('');
        }
        _memberPickerResolve = resolve;
        modal.classList.remove('hidden');
    });
}

window.resolveMemberPicker = function(userId, displayName) {
    document.getElementById('member-picker-modal').classList.add('hidden');
    if (_memberPickerResolve) _memberPickerResolve({ user_id: userId, display_name: displayName });
    _memberPickerResolve = null;
}

window.closeMemberPicker = function() {
    document.getElementById('member-picker-modal').classList.add('hidden');
    if (_memberPickerResolve) _memberPickerResolve(null);
    _memberPickerResolve = null;
}

// ==========================================
// 🧭 子頁面共用啟動流程（manage/orders/trips/finance.html 開頭呼叫）
// ------------------------------------------
// 1. 檢查 session，沒有就導回首頁
// 2. 檢查監控後台總開關（維護中則顯示維護畫面，並停止往下執行）
// 3. 套用導覽列的模式可見性與功能狀態標籤
// 4. 檢查這個頁面本身的 Beta/維護中/不開放 狀態
// 回傳 session 物件；若中途被擋下則回傳 null（呼叫端應該直接 return，不要繼續渲染頁面內容）。
// ==========================================
async function bootstrapSubPage(pageKey) {
    const session = requireSession();
    if (!session) return null;

    document.getElementById("user-name").innerText = session.isGroup ? `${session.displayName || '群組成員'} (成員)` : (session.displayName || "個人帳本主");
    document.getElementById("mode-badge").innerText = session.isGroup ? "👥 群組" : "👤 個人";
    document.getElementById("mode-badge").className = session.isGroup
        ? "text-[9px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-medium tracking-wider"
        : "text-[9px] bg-white/10 text-white/70 px-2 py-0.5 rounded-full font-medium tracking-wider";
    if (session.pictureUrl) {
        document.getElementById("user-avatar").style.backgroundImage = `url('${session.pictureUrl}')`;
    }

    const dashboardOk = await checkDashboardSettings();
    if (!dashboardOk) return null;

    applyNavModeVisibility();
    applyAllNavBadges();
    startSettingsPolling(applyAllNavBadges);

    const allowed = await guardPageAccess(pageKey);
    if (!allowed) return null;

    return session;
}
