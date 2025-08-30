const keyBox = document.getElementById('adminKey');
const unlockBtn = document.getElementById('unlockBtn');
const unlockMsg = document.getElementById('unlockMsg');
const mgr = document.getElementById('mgr');

const placeName = document.getElementById('placeName');
const placeAddr = document.getElementById('placeAddr');
const placeRadius = document.getElementById('placeRadius');
const findBtn = document.getElementById('findBtn');
const latBox = document.getElementById('lat');
const lngBox = document.getElementById('lng');
const geoOut = document.getElementById('geoOut');

const createBtn = document.getElementById('createBtn');
const createOut = document.getElementById('createOut');
const list = document.getElementById('list');

function getKey(){ return sessionStorage.getItem('adminKey') || ''; }
function setKey(k){ sessionStorage.setItem('adminKey', k); }

async function call(method, url, body){
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': getKey() },
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
      const gmaps = `https://www.google.com/maps?q=${p.lat},${p.lng}`;
      row.innerHTML = `
        <img class="qrimg" src="/qr/${p.id}.png" alt="QR">
        <div style="flex:1">
          <div style="font-weight:600">${escapeHtml(p.name)}</div>
          <div class="small">${escapeHtml(p.address || '')}</div>
          <div class="small">Lat/Lng: <a href="${gmaps}" target="_blank">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</a></div>
          <div class="small">Radius: ${p.radius}m</div>
          <div class="small mt-2">
            Join: <a href="/join.html?place=${encodeURIComponent(p.id)}">/join.html?place=${escapeHtml(p.id)}</a>
          </div>
        </div>
        <div><button data-id="${p.id}" class="btn btn-danger">Delete</button></div>`;
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
    await call('GET', '/api/admin/places'); // ping via auth
    unlockMsg.textContent = '';
    mgr.style.display = 'block';
    await loadList();
  } catch (e) {
    unlockMsg.textContent = 'Invalid Admin code.';
    sessionStorage.removeItem('adminKey');
    mgr.style.display = 'none';
  }
});

// Search address and let admin pick the correct candidate
findBtn.addEventListener('click', async () => {
  const q = placeAddr.value.trim();
  geoOut.innerHTML = '';
  if (!q) { geoOut.textContent = 'Type an address, or paste coordinates below.'; return; }
  geoOut.textContent = 'Searching…';
  try {
    const results = await call('GET', `/api/admin/geocode?q=${encodeURIComponent(q)}`);
    if (!results.length) { geoOut.textContent = 'No matches found.'; return; }
    geoOut.innerHTML = results.map((r, i) => {
      const g = `https://www.google.com/maps?q=${r.lat},${r.lng}`;
      return `
        <div class="card">
          <div style="flex:1">
            <div style="font-weight:600">${escapeHtml(r.formatted || '(no label)')}</div>
            <div class="small">Lat/Lng: <a href="${g}" target="_blank">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</a> · confidence ${r.confidence ?? '—'}</div>
          </div>
          <div>
            <button class="btn" data-pick="${i}">Use this</button>
          </div>
        </div>`;
    }).join('');
    geoOut.querySelectorAll('button[data-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-pick'));
        const r = results[idx];
        placeAddr.value = r.formatted || placeAddr.value;
        latBox.value = r.lat;
        lngBox.value = r.lng;
        geoOut.innerHTML = `<span class="success">Selected.</span> <a target="_blank" class="small" href="https://www.google.com/maps?q=${r.lat},${r.lng}">Preview on Google Maps</a>`;
      });
    });
  } catch (e) {
    geoOut.innerHTML = `<span class="warn">${e.message}</span>`;
  }
});

// Create by exact lat/lng (preferred) OR by address
createBtn.addEventListener('click', async () => {
  const name = placeName.value.trim();
  const radius = Number(placeRadius.value || '90');
  const addr = placeAddr.value.trim();
  const lat = Number(latBox.value), lng = Number(lngBox.value);

  createOut.textContent = 'Creating…';
  try {
    let payload;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      payload = { name, radius, lat, lng, address: addr };
    } else if (addr) {
      payload = { name, radius, address: addr };
    } else {
      createOut.textContent = 'Provide address or precise coordinates.'; return;
    }
    const r = await call('POST', '/api/admin/places', payload);
    createOut.innerHTML = `
      <span class="success">Created!</span>
      <div class="small">QR: <a href="${r.qrUrl}" target="_blank">${r.qrUrl}</a></div>
      <div class="small">Join: <a href="${r.joinUrl}" target="_blank">${r.joinUrl}</a></div>`;
    placeAddr.value=''; placeName.value=''; latBox.value=''; lngBox.value='';
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
