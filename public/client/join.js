const qs = new URLSearchParams(location.search);
const placeId = qs.get('place');
if (!placeId) { alert('Missing place id'); location.href = '/'; }

const venueName = document.getElementById('venueName');
const venueAddr = document.getElementById('venueAddr');

fetch(`/api/places/${placeId}`).then(r => r.json()).then(p => {
  if (p.error) throw new Error('Invalid place');
  venueName.textContent = p.name;
  venueAddr.textContent = p.address ? ('Address: ' + p.address) : ('Coordinates: ' + p.lat + ', ' + p.lng);
}).catch(() => { alert('Unknown venue'); location.href = '/'; });

const form = document.getElementById('joinForm');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const alias = document.getElementById('alias').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const gender = document.getElementById('gender').value;
  const fun = document.getElementById('fun').value.trim();
  const file = document.getElementById('avatar').files[0];

  let avatarUrl = null;
  if (file) {
    const fd = new FormData();
    fd.append('avatar', file);
    const up = await fetch('/api/upload', { method: 'POST', body: fd });
    const upJson = await up.json();
    if (!up.ok) { alert(upJson.error || 'Image upload failed'); return; }
    avatarUrl = upJson.url;
  }

  const res = await fetch('/api/session/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, alias, phone, gender, funFact: fun, avatarUrl })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Failed');
  sessionStorage.setItem('sessionId', data.sessionId);
  sessionStorage.setItem('placeId', placeId);
  location.href = `/chat.html?place=${encodeURIComponent(placeId)}`;
});
