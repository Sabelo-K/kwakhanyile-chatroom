const keyBox = document.getElementById('adminKey');
const unlockBtn = document.getElementById('unlockBtn');
const unlockMsg = document.getElementById('unlockMsg');
const mgr = document.getElementById('mgr');

const placeName = document.getElementById('placeName');
const placeAddr = document.getElementById('placeAddr');
const placeRadius = document.getElementById('placeRadius');
const createBtn = document.getElementById('createBtn');
const createOut = document.getElementById('createOut');
const list = document.getElementById('list');

function getKey(){ return sessionStorage.getItem('adminKey') || ''; }
function setKey(k){ sessionStorage.setItem('adminKey', k); }

async function call(method, url, body){
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': getKey()
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

async function loadList(){
  list.innerHTML = 'Loading…';
  try {
    const items = await call('GET', '/api/admin/places');
    list.innerHTML = '';
    items.forEach(p => {
      const row = document.createElement('div');
      row.className = 'card';
      row.innerHTML = `
        <img class="qrimg" src="/qr/${p.id}.png" alt="QR">
        <div style="flex:1">
          <div style="font-weight:600">${escapeHtml(p.name)}</div>
          <div class="small">${p.address || (p.lat + ', ' + p.lng)}</div>
          <div class="small">Radius: ${p.radius}m</div>
          <div class="small mt-2">
            Join link:
            <a href="/join.html?place=${encodeURIComponent(p.id)}">/join.html?place=${escapeHtml(p.id)}</a>
          </div>
        </div>
        <div>
          <button data-id="${p.id}" class="btn btn-danger">Delete</button>
        </div>`;
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<span class="warn">${e.message}</span>`;
  }
}

unlockBtn.addEventListener('click', async () => {
  const k = keyBox.value.trim();
  if (!k) { unlockMsg.textContent = 'Enter your Admin code.'; return; }
  setKey(k);
  try {
    await call('GET', '/api/admin/ping');
    unlockMsg.textContent = '';
    mgr.style.display = 'block';
    await loadList();
  } catch (e) {
    unlockMsg.textContent = 'Invalid Admin code.';
    sessionStorage.removeItem('adminKey');
    mgr.style.display = 'none';
  }
});

createBtn.addEventListener('click', async () => {
  const addr = placeAddr.value.trim();
  const name = placeName.value.trim();
  const radius = Number(placeRadius.value || '90');
  if (!addr) { createOut.textContent = 'Address is required.'; return; }
  createOut.textContent = 'Creating…';
  try {
    const r = await call('POST', '/api/admin/places', { address: addr, name, radius });
    createOut.innerHTML = `
      <span class="success">Created!</span>
      <div class="small">QR: <a href="${r.qrUrl}" target="_blank">${r.qrUrl}</a></div>
      <div class="small">Join: <a href="${r.joinUrl}" target="_blank">${r.joinUrl}</a></div>`;
    placeAddr.value=''; placeName.value='';
    await loadList();
  } catch (e) {
    createOut.innerHTML = `<span class="warn">${e.message}</span>`;
  }
});

list.addEventListener('click', async (e) => {
  const btn = e.target.closest('button.btn-danger');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  if (!confirm(`Delete place "${id}"?`)) return;
  try {
    await call('DELETE', `/api/admin/places/${encodeURIComponent(id)}`);
    await loadList();
  } catch (e2) {
    alert(e2.message);
  }
});

function escapeHtml(str){ return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }
