const sessionId = sessionStorage.getItem('sessionId');
const placeId = sessionStorage.getItem('placeId');
if (!sessionId || !placeId) { alert('Session expired. Please scan the venue QR again.'); location.href = '/'; }

const roomTitle = document.getElementById('roomTitle');
const geoStatus = document.getElementById('geoStatus');
const log = document.getElementById('log');
const roster = document.getElementById('roster');
const msgForm = document.getElementById('msgForm');
const msgInput = document.getElementById('msg');
const leaveBtn = document.getElementById('leaveBtn');

const dmPanel = document.getElementById('dmPanel');
const dmTitle = document.getElementById('dmTitle');
const dmLog = document.getElementById('dmLog');
const dmForm = document.getElementById('dmForm');
const dmMsg = document.getElementById('dmMsg');
const dmClose = document.getElementById('dmClose');

const toast = document.getElementById('toast');
const debugBox = document.getElementById('debugBox');
const showDebug = new URLSearchParams(location.search).get('debug') === '1';

const socket = io();

const users = new Map();
let currentDM = null;

function genderChip(g){
  if (!g) return '';
  const icon = g === 'Female' ? '♀️' : g === 'Male' ? '♂️' : g === 'Non-binary' ? '⚧️' : '—';
  return `<span class="chip">${icon} ${escapeHtml(g)}</span>`;
}
function avatarImg(url, alt){
  const safe = url ? url : '/client/placeholder.svg';
  return `<img class="avatar" src="${safe}" alt="${escapeHtml(alt||'')}" onerror="this.src='/client/placeholder.svg'">`;
}
function renderRoster(){
  roster.innerHTML = '';
  users.forEach((u, id) => {
    if (!u.alias) return;
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `${avatarImg(u.avatarUrl, u.alias)} <div class="name">${escapeHtml(u.alias)} ${genderChip(u.gender)}</div>`;
    roster.appendChild(tile);
  });
}
function addLine(html){
  const wrap = document.createElement('div');
  wrap.className = 'msgrow';
  wrap.innerHTML = html;
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}
function addDM(html){
  const div = document.createElement('div');
  div.className = 'p-2';
  div.innerHTML = html;
  dmLog.appendChild(div);
  dmLog.scrollTop = dmLog.scrollHeight;
}
function showToast(text, actionLabel, action){
  toast.textContent = text;
  toast.style.display = 'block';
  if (actionLabel && action) {
    toast.innerHTML = text + ' <a href="#" id="toastAction" style="color:#a5b4fc; text-decoration:underline; margin-left:.5rem;">' + actionLabel + '</a>';
    document.getElementById('toastAction').onclick = (e) => { e.preventDefault(); action(); toast.style.display = 'none'; };
  }
  setTimeout(() => { toast.style.display = 'none'; }, 5000);
}
function openDM(id){
  if (!id) return;
  const u = users.get(id);
  const alias = (u && u.alias) || id;
  currentDM = { id, alias };
  dmTitle.textContent = alias;
  dmPanel.style.display = 'block';
  document.getElementById('roomPanel').style.display = 'none';
}
function closeDM(){
  currentDM = null;
  dmPanel.style.display = 'none';
  document.getElementById('roomPanel').style.display = 'block';
  dmLog.innerHTML = '';
}

socket.on('connect', () => {
  socket.emit('auth', { sessionId });
  fetch(`/api/rooms/${placeId}/members`).then(r=>r.json()).then(list => {
    list.forEach(m => { users.set(m.sessionId, { alias: m.alias, gender: m.gender, avatarUrl: m.avatarUrl }); });
    renderRoster();
  }).catch(()=>{});
});
socket.on('auth_error', (m) => { alert(m || 'Auth failed'); location.href = '/'; });

socket.on('welcome', ({ alias, place, gender, avatarUrl }) => {
  users.set(sessionId, { alias, gender, avatarUrl });
  renderRoster();
  roomTitle.textContent = `${place.name} — Chat`;
  addLine(`${avatarImg(avatarUrl, alias)} <div><div><button class="link-alias" data-uid="${sessionId}">${escapeHtml(alias)}</button> ${genderChip(gender)}</div><div class="small">You joined the room.</div></div>`);
});
socket.on('presence', (evt) => {
  if (evt.type === 'join') {
    users.set(evt.id, { alias: evt.alias, gender: evt.gender, avatarUrl: evt.avatarUrl });
    renderRoster();
    addLine(`${avatarImg(evt.avatarUrl, evt.alias)} <div><div><button class="link-alias" data-uid="${evt.id}">${escapeHtml(evt.alias)}</button> ${genderChip(evt.gender)}</div><div class="small join">joined</div></div>`);
  }
  if (evt.type === 'leave') {
    addLine(`<div></div><div><div><strong>${escapeHtml(evt.alias)}</strong></div><div class="small leave">left</div></div>`);
    users.delete(evt.id); renderRoster();
    if (currentDM && evt.id === currentDM.id) { showToast(`${evt.alias} left the room`); closeDM(); }
  }
});
socket.on('message', (m) => {
  if (m.from) users.set(m.from, { alias: m.alias, gender: m.gender, avatarUrl: m.avatarUrl });
  renderRoster();
  const aliasHtml = m.from ? `<button class="link-alias" data-uid="${m.from}">${escapeHtml(m.alias)}</button>` : `<span style="font-weight:600">${escapeHtml(m.alias)}</span>`;
  const time = new Date(m.at).toLocaleTimeString();
  addLine(`${avatarImg(m.avatarUrl, m.alias)} <div><div>${aliasHtml} ${genderChip(m.gender)} <span class="small">(${time})</span></div><div>${escapeHtml(m.text)}</div></div>`);
});
socket.on('geofence', (g) => {
  const { state, distance, accuracy, radius, outCount, countdownSec } = g;
  if (state === 'inside') geoStatus.textContent = '✅ Inside the venue';
  if (state === 'borderline') geoStatus.textContent = '… Checking position…';
  if (state === 'outside') geoStatus.innerHTML = `⚠️ You appear outside. You will be removed in ${countdownSec}s if you remain out.`;
  if (showDebug) {
    debugBox.style.display = 'block';
    debugBox.textContent = `d=${distance||'?'}m  acc=${accuracy||'?'}m  radius=${radius||'?'}m  outCount=${outCount||0}  state=${state}`;
  }
});
socket.on('geodebug', (g) => {
  if (showDebug) {
    debugBox.style.display = 'block';
    debugBox.textContent = `IGNORED FIX — d=${Math.round(g.distance)}m  acc=${Math.round(g.accuracy)}m  r=${g.radius}`;
  }
});
socket.on('kicked', () => {
  alert('You left the venue and have been removed from chat.');
  sessionStorage.removeItem('sessionId'); sessionStorage.removeItem('placeId');
  location.href = '/kicked.html';
});
socket.on('dm_message', (payload) => {
  const { from, alias, text, at, peer, avatarUrl } = payload;
  const otherId = (from === sessionId) ? peer : from;
  const other = users.get(otherId) || { alias, avatarUrl };
  const line = `<div><span style="font-weight:600">${escapeHtml(from === sessionId ? 'You' : (other.alias || 'Someone'))}</span> <span class="small">(${new Date(at).toLocaleTimeString()})</span><br>${escapeHtml(text)}</div>`;
  if (!currentDM || currentDM.id !== otherId) { showToast(`New private message from ${other.alias || 'Someone'}`, 'Open', () => openDM(otherId)); }
  if (!currentDM || currentDM.id !== otherId) return;
  addDM(line);
});

msgForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = msgInput.value.trim(); if (!t) return;
  socket.emit('message', t); msgInput.value = '';
});
dmForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = dmMsg.value.trim(); if (!t || !currentDM) return;
  socket.emit('dm_send', { to: currentDM.id, text: t });
  addDM(`<div><span style="font-weight:600">You</span> <span class="small">(${new Date().toLocaleTimeString()})</span><br>${escapeHtml(t)}</div>`);
  dmMsg.value='';
});
leaveBtn.addEventListener('click', () => { sessionStorage.removeItem('sessionId'); sessionStorage.removeItem('placeId'); location.href = '/'; });
log.addEventListener('click', (e) => {
  const btn = e.target.closest('.link-alias');
  if (!btn) return;
  const uid = btn.getAttribute('data-uid');
  if (!uid || uid === sessionId) return;
  openDM(uid);
});
dmClose.addEventListener('click', () => closeDM());

// ----------------- Location permission helper -----------------
const overlay = document.getElementById('locOverlay');
const locMsg = document.getElementById('locMsg');
const locHowTo = document.getElementById('locHowTo');
const btnEnable = document.getElementById('locEnable');
const btnRetry = document.getElementById('locRetry');
const btnClose = document.getElementById('locClose');

let watchId = null;
const geoOpts = { enableHighAccuracy: true, maximumAge: 1000, timeout: 6000 };

function showOverlay(msg, showHowTo=false) {
  locMsg.textContent = msg || 'We need your device location to verify you are inside the venue.';
  if (showHowTo) {
    locHowTo.style.display = 'block';
    locHowTo.innerHTML = platformHowTo();
  } else {
    locHowTo.style.display = 'none';
    locHowTo.innerHTML = '';
  }
  overlay.style.display = 'block';
}
function hideOverlay(){ overlay.style.display = 'none'; }

function startWatch(triggerPrompt=false) {
  if (!('geolocation' in navigator)) {
    geoStatus.textContent = 'This device does not support geolocation.';
    return;
  }
  if (watchId) return; // already watching
  const success = (pos) => {
    hideOverlay();
    const { latitude, longitude, accuracy } = pos.coords;
    socket.emit('gps', { lat: latitude, lng: longitude, accuracy });
    if (!watchId) watchId = navigator.geolocation.watchPosition(success, error, geoOpts);
  };
  const error = (err) => {
    geoStatus.textContent = `Location error: ${err.message}`;
    showOverlay('We could not get your location. Please allow location access.', true);
  };

  if (triggerPrompt) {
    // One-shot call to trigger the native permission prompt
    navigator.geolocation.getCurrentPosition(success, error, geoOpts);
  } else {
    watchId = navigator.geolocation.watchPosition(success, error, geoOpts);
  }
}

async function checkPermissionAndStart() {
  if (!('permissions' in navigator) || !navigator.permissions.query) {
    // Older browsers: just show helper to trigger prompt
    showOverlay('This room needs your location. Tap "Enable location".');
    return;
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    handlePermission(status.state);
    status.onchange = () => handlePermission(status.state);
  } catch {
    showOverlay('This room needs your location. Tap "Enable location".');
  }
}
function handlePermission(state) {
  if (state === 'granted') {
    hideOverlay();
    startWatch(false);
  } else if (state === 'prompt') {
    showOverlay('Please allow location when prompted to join this room.');
  } else if (state === 'denied') {
    showOverlay('Location is blocked for this site. Follow the steps below, then tap "Retry".', true);
  }
}

function platformHowTo() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) {
    return `
      <ul>
        <li>Open Safari ⋯ menu → <b>Website Settings</b> → <b>Location</b> → <b>Allow</b>.</li>
        <li>Also enable <b>Precise Location</b> in iOS Settings → Privacy & Security → Location Services → Safari Websites.</li>
      </ul>`;
  }
  if (/Android/i.test(ua)) {
    return `
      <ul>
        <li>Tap the lock icon in the address bar → <b>Permissions</b> → <b>Location</b> → <b>Allow</b>.</li>
        <li>If still blocked: Android Settings → Apps → your browser → Permissions → enable <b>Location</b>.</li>
      </ul>`;
  }
  return `
    <ul>
      <li>Click the lock icon near the address bar → <b>Site settings</b> → allow <b>Location</b> for this site.</li>
    </ul>`;
}

// Overlay buttons
btnEnable?.addEventListener('click', () => startWatch(true));
btnRetry?.addEventListener('click', () => { watchId = null; checkPermissionAndStart(); });
btnClose?.addEventListener('click', () => hideOverlay());

// Kick it off
checkPermissionAndStart();

function escapeHtml(str){ return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }
