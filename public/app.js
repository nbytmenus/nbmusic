const state = {
  user: null,
  devUnlocked: false,
  tracks: []
};

const userArea = document.getElementById('userArea');
const trackGrid = document.getElementById('trackGrid');
const nowPlaying = document.getElementById('nowPlaying');
const nowArtist = document.getElementById('nowArtist');
const audioPlayer = document.getElementById('audioPlayer');

const authDialog = document.getElementById('authDialog');
const authForm = document.getElementById('authForm');
const authMsg = document.getElementById('authMsg');

const devDialog = document.getElementById('devDialog');
const unlockForm = document.getElementById('unlockForm');
const unlockMsg = document.getElementById('unlockMsg');
const uploadForm = document.getElementById('uploadForm');
const uploadMsg = document.getElementById('uploadMsg');

const openAuth = document.getElementById('openAuth');
const closeAuth = document.getElementById('closeAuth');
const registerBtn = document.getElementById('registerBtn');
const logoutBtn = document.getElementById('logoutBtn');
const openDevPanel = document.getElementById('openDevPanel');
const closeDev = document.getElementById('closeDev');

function setMsg(el, message, success = false) {
  el.textContent = message;
  el.style.color = success ? '#6be58f' : '#ff8fa3';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function renderUser() {
  if (!state.user) {
    userArea.innerHTML = '<strong>Guest</strong><p class="muted">Login to stream and manage your library.</p>';
    openAuth.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    openDevPanel.classList.add('hidden');
    return;
  }

  userArea.innerHTML = `<strong>${state.user.username}</strong><p class="muted">${state.user.is_admin ? 'Admin account' : 'Standard account'}</p>`;
  openAuth.classList.add('hidden');
  logoutBtn.classList.remove('hidden');
  if (state.user.is_admin) {
    openDevPanel.classList.remove('hidden');
  }
}

function renderTracks() {
  if (!state.user) {
    trackGrid.innerHTML = '<p class="muted">Please login to view your streaming library.</p>';
    return;
  }
  if (!state.tracks.length) {
    trackGrid.innerHTML = '<p class="muted">No tracks yet. Admin can upload from Dev Panel.</p>';
    return;
  }

  trackGrid.innerHTML = state.tracks
    .map((track) => `
      <article class="track">
        <h3>${track.title}</h3>
        <p class="muted">${track.artist}</p>
        <p class="muted">Uploaded by ${track.uploader || 'unknown'}</p>
        <button class="btn primary" data-play="${track.id}">Play</button>
      </article>
    `)
    .join('');

  document.querySelectorAll('[data-play]').forEach((button) => {
    button.addEventListener('click', () => {
      const track = state.tracks.find((item) => item.id === Number(button.dataset.play));
      if (!track) return;
      nowPlaying.textContent = track.title;
      nowArtist.textContent = track.artist;
      audioPlayer.src = `/stream/${track.id}`;
      audioPlayer.play();
    });
  });
}

async function refreshSession() {
  const data = await api('/api/me');
  state.user = data.user;
  state.devUnlocked = data.devUnlocked;
  if (state.devUnlocked) {
    uploadForm.classList.remove('hidden');
  } else {
    uploadForm.classList.add('hidden');
  }
  renderUser();
  if (state.user) {
    await loadTracks();
  } else {
    state.tracks = [];
    renderTracks();
  }
}

async function loadTracks() {
  const data = await api('/api/tracks');
  state.tracks = data.tracks;
  renderTracks();
}

openAuth.addEventListener('click', () => authDialog.showModal());
closeAuth.addEventListener('click', () => authDialog.close());
openDevPanel.addEventListener('click', () => devDialog.showModal());
closeDev.addEventListener('click', () => devDialog.close());

registerBtn.addEventListener('click', async () => {
  try {
    const formData = new FormData(authForm);
    await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    });
    setMsg(authMsg, 'Registered successfully. You can now login.', true);
  } catch (error) {
    setMsg(authMsg, error.message);
  }
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(authForm);
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    });
    setMsg(authMsg, 'Login successful', true);
    await refreshSession();
    setTimeout(() => authDialog.close(), 400);
  } catch (error) {
    setMsg(authMsg, error.message);
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  state.tracks = [];
  renderUser();
  renderTracks();
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(unlockForm);
    await api('/api/admin/unlock', {
      method: 'POST',
      body: JSON.stringify({ password: formData.get('password') })
    });
    state.devUnlocked = true;
    uploadForm.classList.remove('hidden');
    setMsg(unlockMsg, 'Dev panel unlocked', true);
  } catch (error) {
    setMsg(unlockMsg, error.message);
  }
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(uploadForm);
    const file = data.get('audioFile');
    const title = encodeURIComponent(data.get('title'));
    const artist = encodeURIComponent(data.get('artist'));
    const filename = encodeURIComponent(file.name || 'track.mp3');
    await api(`/api/tracks/upload?title=${title}&artist=${artist}&filename=${filename}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'audio/mpeg' }
    });
    setMsg(uploadMsg, 'Track uploaded successfully', true);
    uploadForm.reset();
    await loadTracks();
  } catch (error) {
    setMsg(uploadMsg, error.message);
  }
});

refreshSession().catch(() => renderTracks());
