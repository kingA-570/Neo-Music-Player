let currentTracks = [];
let currentTrackIndex = -1;
let isPlaying = false;
let authToken = null;
let currentUser = null;
let playlists = [];
let isRegisterMode = false;
let selectedPlaylistId = null;
let isMinimized = false;
let currentTrackSources = [];
let sourceFallbackIndex = 0;
let shouldPlayCurrentTrack = false;

const recentCards = document.getElementById('recent-cards');
const trackList = document.getElementById('track-list');
const searchInput = document.getElementById('search-input');
const trackTitle = document.getElementById('track-title');
const trackMeta = document.getElementById('track-meta');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');
const playButton = document.getElementById('play-button');
const prevButton = document.getElementById('prev-button');
const nextButton = document.getElementById('next-button');
const progressBar = document.getElementById('progress-bar');
const audioPlayer = document.getElementById('audio-player');
const playerBar = document.getElementById('player-bar');
const nowPlayingCover = document.getElementById('now-playing-cover');
const minimizePlayerBtn = document.getElementById('minimize-player-btn');
const miniPlayer = document.getElementById('mini-player');
const miniCover = document.getElementById('mini-cover');
const miniTitle = document.getElementById('mini-title');
const miniMeta = document.getElementById('mini-meta');
const miniPrev = document.getElementById('mini-prev');
const miniPlay = document.getElementById('mini-play');
const miniNext = document.getElementById('mini-next');
const miniClose = document.getElementById('mini-close');
const volumeBtn = document.getElementById('volume-btn');
const volumeBar = document.getElementById('volume-bar');
let wasMuted = false;
const authModal = document.getElementById('auth-modal');
const authToggle = document.getElementById('auth-toggle');
const profileButton = document.getElementById('profile-button');
const quickPills = document.getElementById('trend-pills');
const loginForm = document.getElementById('login-form');
const closeAuth = document.getElementById('close-auth');
const authStatus = document.getElementById('auth-status');
const authMessage = document.getElementById('auth-message');
const authModeToggle = document.getElementById('auth-mode-toggle');
const authModalTitle = document.getElementById('auth-modal-title');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const playlistList = document.getElementById('playlist-list');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const addToPlaylistBtn = document.getElementById('add-to-playlist-btn');

const STORAGE_KEYS = {
    token: 'pulse-token',
    user: 'pulse-user'
};

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const mockPreviews = [
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3'
];

const API_BASE = '/api';

// ── Auth API helpers ─────────────────────────────────────────────────

async function apiRequest(endpoint, options = {}) {
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    };

    if (authToken) {
        config.headers['Authorization'] = `Bearer ${authToken}`;
    }

    if (!options.body) {
        delete config.headers['Content-Type'];
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Request failed');
    }

    return data;
}

async function registerUser(username, email, password) {
    return apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password })
    });
}

async function loginUser(username, password) {
    return apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
}

async function fetchPlaylistsFromApi() {
    if (!authToken) return [];
    try {
        return await apiRequest('/playlists');
    } catch (error) {
        console.error('Failed to fetch playlists:', error);
        return [];
    }
}

async function createPlaylistOnApi(name, tracks) {
    return apiRequest('/playlists', {
        method: 'POST',
        body: JSON.stringify({ name, tracks: tracks || [] })
    });
}

async function addTrackToPlaylistOnApi(playlistId, track) {
    return apiRequest(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ track })
    });
}

async function deletePlaylistOnApi(playlistId) {
    return apiRequest(`/playlists/${playlistId}`, {
        method: 'DELETE'
    });
}

function formatArtists(artists) {
    if (!artists) return 'Unknown Artist';
    if (Array.isArray(artists)) return artists.join(', ');
    return String(artists);
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isHttpAudioSource(source) {
    return typeof source === 'string' && /^https?:\/\//.test(source);
}

function buildTrackSources(track, index) {
    const mockPreview = mockPreviews[((index % mockPreviews.length) + mockPreviews.length) % mockPreviews.length] || mockPreviews[0] || '';
    const sources = [
        isHttpAudioSource(track.streamUrl) ? track.streamUrl : '',
        track.videoId ? `/api/play/${encodeURIComponent(track.videoId)}` : '',
        isHttpAudioSource(track.preview) ? track.preview : '',
        isHttpAudioSource(track.previewUrl) ? track.previewUrl : '',
        mockPreview
    ];
    return [...new Set(sources.filter(Boolean))];
}

function retryCurrentTrackSource(attemptIndex) {
    if (!shouldPlayCurrentTrack || attemptIndex !== sourceFallbackIndex) {
        return;
    }

    if (sourceFallbackIndex < currentTrackSources.length - 1) {
        sourceFallbackIndex += 1;
        playCurrentSource();
        return;
    }

    shouldPlayCurrentTrack = false;
    isPlaying = false;
    updatePlayButton();
    if (trackMeta) trackMeta.textContent = 'Stream unavailable.';
}

function playCurrentSource() {
    if (!currentTrackSources.length || sourceFallbackIndex >= currentTrackSources.length) {
        shouldPlayCurrentTrack = false;
        isPlaying = false;
        updatePlayButton();
        if (trackMeta) trackMeta.textContent = 'Stream unavailable.';
        return;
    }

    const attemptIndex = sourceFallbackIndex;
    audioPlayer.src = currentTrackSources[attemptIndex];
    audioPlayer.load();

    if (!shouldPlayCurrentTrack) {
        isPlaying = false;
        updatePlayButton();
        return;
    }

    audioPlayer.play().then(() => {
        isPlaying = true;
        updatePlayButton();
    }).catch((error) => {
        if (error && error.name === 'NotAllowedError') {
            shouldPlayCurrentTrack = false;
            isPlaying = false;
            updatePlayButton();
            return;
        }
        retryCurrentTrackSource(attemptIndex);
    });
}

function getStoredUser() {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.user);
        return stored ? JSON.parse(stored) : null;
    } catch (error) {
        return null;
    }
}

function getStoredToken() {
    try {
        return localStorage.getItem(STORAGE_KEYS.token);
    } catch (error) {
        return null;
    }
}

function saveAuth(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem(STORAGE_KEYS.token, token);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
}

function clearAuth() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.user);
}

function getStoredPlaylists() {
    return playlists;
}

function savePlaylists() {
    renderPlaylists();
}

function renderPlaylists() {
    if (!playlists.length) {
        playlistList.innerHTML = '<p class="empty-state">No playlists yet.</p>';
        return;
    }

    playlistList.innerHTML = playlists.map((playlist) => {
        const pid = playlist._id || playlist.id;
        const safeName = escapeHtml(playlist.name || 'Untitled Playlist');
        return `
            <div class="playlist-item ${pid === selectedPlaylistId ? 'active' : ''}" data-id="${pid}">
                <strong>${safeName}</strong>
                <small>${(playlist.tracks || []).length} songs</small>
            </div>
        `;
    }).join('');
}

function renderCards(trackArray) {
    if (!trackArray.length) {
        recentCards.innerHTML = '<div class="card empty-card">No songs found.</div>';
        return;
    }

    recentCards.innerHTML = trackArray.map((track, index) => {
        const title = escapeHtml(track.title || 'Untitled Track');
        const artist = escapeHtml(formatArtists(track.artists));
        const cover = track.cover ? track.cover : 'card1img.jpeg';
        const safeAlt = escapeHtml(track.title || 'Track cover');
        return `
        <article class="card ${index === currentTrackIndex ? 'active' : ''}" data-index="${index}">
            <div class="card-thumb-wrap">
                <img src="${cover}" alt="${safeAlt}">
                <span class="card-play-overlay"><i class="fa-solid fa-play"></i></span>
            </div>
            <div class="card-copy">
                <strong>${title}</strong>
                <span>${artist}</span>
            </div>
        </article>
    `;
    }).join('');
}

function renderTrackList(trackArray) {
    if (!trackArray.length) {
        trackList.innerHTML = '<div class="track-row no-results">No tracks found for this search.</div>';
        return;
    }

    trackList.innerHTML = trackArray.map((track, index) => {
        const title = escapeHtml(track.title || 'Untitled Track');
        const artist = escapeHtml(formatArtists(track.artists));
        const album = escapeHtml(track.album || 'Unknown album');
        const duration = escapeHtml(track.duration || '--:--');
        return `
        <div class="track-row ${index === currentTrackIndex ? 'active' : ''}" data-index="${index}">
            <div class="track-info">
                <span class="row-play-overlay"><i class="fa-solid fa-play"></i></span>
                <strong class="track-title-text">${title}</strong>
                <small>${artist}</small>
            </div>
            <span>${album}</span>
            <span>${duration}</span>
        </div>
    `;
    }).join('');
}

function updatePlayerInfo(track) {
    if (!track) {
        trackTitle.textContent = 'Choose a track';
        trackMeta.textContent = 'Pulse • Streaming demo';
        currentTimeEl.textContent = '0:00';
        durationEl.textContent = '--:--';
        progressBar.value = 0;
        miniTitle.textContent = 'Choose a track';
        miniMeta.textContent = 'Pulse';
        return;
    }

    trackTitle.textContent = track.title;
    trackMeta.textContent = `${formatArtists(track.artists)} · ${track.album || 'Unknown album'}`;
    durationEl.textContent = track.duration || '--:--';

    const cover = track.cover || track.thumbnail || '';
    if (cover) {
        nowPlayingCover.src = cover;
        miniCover.src = cover;
    }

    miniTitle.textContent = track.title;
    miniMeta.textContent = formatArtists(track.artists);
    updateMiniPlayButton();
}

function updateMiniPlayButton() {
    miniPlay.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function updateVolumeIcon() {
    const v = audioPlayer.volume;
    if (v === 0) {
        volumeBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else if (v < 0.5) {
        volumeBtn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
    } else {
        volumeBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
}

function minimizePlayer() {
    if (isMinimized) return;
    isMinimized = true;
    playerBar.classList.add('minimized');
    miniPlayer.classList.remove('hidden');
    updateMiniPlayButton();
}

function expandPlayer() {
    if (!isMinimized) return;
    isMinimized = false;
    playerBar.classList.remove('minimized');
    miniPlayer.classList.add('hidden');
    updatePlayButton();
}

function togglePlayerMode() {
    isMinimized ? expandPlayer() : minimizePlayer();
}

function updatePlayButton() {
    playButton.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    updateMiniPlayButton();
}

function pausePlayback() {
    audioPlayer.pause();
    shouldPlayCurrentTrack = false;
    isPlaying = false;
    updatePlayButton();
}

function updateAuthUi() {
    if (!currentUser) {
        authStatus.textContent = 'Log in to save playlists';
        authMessage.textContent = 'Sign in to sync your playlists across devices.';
        profileButton.innerHTML = '<i class="fa-regular fa-user"></i> Me';
        return;
    }

    const safeUsername = escapeHtml(currentUser.username || 'User');
    authStatus.textContent = `Signed in as ${currentUser.username}`;
    authMessage.textContent = 'Your playlists are synced to the cloud.';
    profileButton.innerHTML = `<i class="fa-regular fa-user"></i> ${safeUsername}`;
}

function toggleAuthModal(forceOpen) {
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !authModal.classList.contains('open');
    authModal.classList.toggle('open', shouldOpen);
    authModal.setAttribute('aria-hidden', String(!shouldOpen));
}

async function fetchSearch(query) {
    if (!query) {
        currentTracks = [];
        currentTrackIndex = -1;
        renderCards(currentTracks);
        renderTrackList(currentTracks);
        updatePlayerInfo(null);
        pausePlayback();
        return;
    }

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) {
            throw new Error('Search failed');
        }

        const results = await response.json();
        currentTracks = Array.isArray(results) ? results : results.tracks || [];

        if (!currentTracks.length) {
            currentTrackIndex = -1;
        } else if (currentTrackIndex < 0 || currentTrackIndex >= currentTracks.length) {
            currentTrackIndex = 0;
        }

        renderCards(currentTracks);
        renderTrackList(currentTracks);
        updatePlayerInfo(currentTracks[currentTrackIndex] || null);
    } catch (error) {
        recentCards.innerHTML = '<div class="card empty-card">Search failed, please try again.</div>';
        trackList.innerHTML = '<div class="track-row no-results">Search failed, please try again.</div>';
        updatePlayerInfo(null);
        pausePlayback();
    }
}

function playTrack(index) {
    const track = currentTracks[index];
    if (!track) {
        return;
    }

    currentTrackIndex = index;
    updatePlayerInfo(track);
    renderCards(currentTracks);
    renderTrackList(currentTracks);

    currentTrackSources = buildTrackSources(track, index);
    sourceFallbackIndex = 0;
    shouldPlayCurrentTrack = true;

    if (!currentTrackSources.length) {
        trackMeta.textContent = 'Preview unavailable for this track.';
        pausePlayback();
        return;
    }

    playCurrentSource();
}

// When a source fails, retry the next fallback source for the current track
audioPlayer.addEventListener('error', function () {
    retryCurrentTrackSource(sourceFallbackIndex);
});

function togglePlayback() {
    if (!currentTracks.length) {
        return;
    }

    if (currentTrackIndex < 0) {
        playTrack(0);
        return;
    }

    if (audioPlayer.paused) {
        shouldPlayCurrentTrack = true;
        audioPlayer.play().then(() => {
            isPlaying = true;
            updatePlayButton();
        }).catch(() => {
            shouldPlayCurrentTrack = false;
            isPlaying = false;
            updatePlayButton();
        });
    } else {
        pausePlayback();
    }
}

function playNextTrack() {
    if (!currentTracks.length) {
        return;
    }
    const nextIndex = (currentTrackIndex + 1) % currentTracks.length;
    playTrack(nextIndex);
}

function playPreviousTrack() {
    if (!currentTracks.length) {
        return;
    }
    const prevIndex = (currentTrackIndex - 1 + currentTracks.length) % currentTracks.length;
    playTrack(prevIndex);
}

async function createPlaylist() {
    if (!currentUser) {
        toggleAuthModal(true);
        return;
    }

    const baseTracks = currentTracks.length ? currentTracks : [];
    if (!baseTracks.length) {
        return;
    }

    try {
        const playlist = await createPlaylistOnApi(`${currentUser.username}'s Mix`, baseTracks);
        playlists = [playlist, ...playlists];
        selectedPlaylistId = playlist._id;
        savePlaylists();
    } catch (error) {
        console.error('Failed to create playlist:', error);
    }
}

async function addCurrentTrackToPlaylist() {
    if (!currentUser) {
        toggleAuthModal(true);
        return;
    }

    if (!currentTracks.length || currentTrackIndex < 0) {
        return;
    }

    const track = currentTracks[currentTrackIndex];
    
    // Convert track format for API
    const apiTrack = {
        videoId: track.id || track.videoId || `yt-${Date.now()}`,
        title: track.title,
        artist: formatArtists(track.artists),
        album: track.album || '',
        duration: track.duration || '--:--',
        thumbnail: track.cover || '',
        preview: track.preview || '',
        streamUrl: track.streamUrl || '',
        youtubeMusicUrl: track.link || ''
    };

    if (!playlists.length) {
        await createPlaylist();
    }

    const target = playlists.find((item) => (item._id || item.id) === selectedPlaylistId) || playlists[0];
    if (!target) {
        return;
    }

    try {
        const updated = await addTrackToPlaylistOnApi(target._id || target.id, apiTrack);
        // Update local playlists
        const idx = playlists.findIndex((p) => (p._id || p.id) === (updated._id || updated.id));
        if (idx >= 0) {
            playlists[idx] = updated;
        }
        savePlaylists();
    } catch (error) {
        console.error('Failed to add track to playlist:', error);
    }
}

function bindEvents() {
    quickPills?.addEventListener('click', (event) => {
        const button = event.target.closest('.quick-pill');
        if (!button) return;
        const query = button.dataset.query || 'trending music';
        searchInput.value = query;
        fetchSearch(query);
    });

    searchInput.addEventListener('input', (event) => {
        const query = event.target.value.trim();
        fetchSearch(query || 'trending music');
    });

    searchInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            const query = event.target.value.trim();
            fetchSearch(query || 'trending music');
        }
    });

    searchInput.addEventListener('change', (event) => {
        const query = event.target.value.trim();
        fetchSearch(query || 'trending music');
    });

    recentCards.addEventListener('click', (event) => {
        const card = event.target.closest('.card');
        if (!card) return;
        playTrack(Number(card.dataset.index));
    });

    trackList.addEventListener('click', (event) => {
        const row = event.target.closest('.track-row');
        if (!row || row.classList.contains('header-row')) return;
        playTrack(Number(row.dataset.index));
    });

    playButton.addEventListener('click', togglePlayback);
    prevButton.addEventListener('click', playPreviousTrack);
    nextButton.addEventListener('click', playNextTrack);

    // Mini player controls
    minimizePlayerBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        minimizePlayer();
    });
    miniPlayer.addEventListener('click', expandPlayer);
    miniClose.addEventListener('click', (event) => {
        event.stopPropagation();
        expandPlayer();
    });
    miniPlay.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePlayback();
    });
    miniNext.addEventListener('click', (event) => {
        event.stopPropagation();
        playNextTrack();
    });
    miniPrev.addEventListener('click', (event) => {
        event.stopPropagation();
        playPreviousTrack();
    });

    // Auto-minimize when searching
    searchInput.addEventListener('focus', () => {
        if (isPlaying && !isMinimized) {
            minimizePlayer();
        }
    });

    // Volume controls
    volumeBar.addEventListener('input', () => {
        audioPlayer.volume = Number(volumeBar.value);
        wasMuted = audioPlayer.volume === 0;
        updateVolumeIcon();
    });
    volumeBtn.addEventListener('click', () => {
        if (audioPlayer.volume > 0) {
            wasMuted = true;
            audioPlayer.volume = 0;
            volumeBar.value = 0;
        } else {
            wasMuted = false;
            audioPlayer.volume = 0.8;
            volumeBar.value = 0.8;
        }
        updateVolumeIcon();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        const target = event.target;
        const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (isTyping) return;
        if (event.code === 'Space') {
            event.preventDefault();
            togglePlayback();
        } else if (event.code === 'ArrowRight') {
            playNextTrack();
        } else if (event.code === 'ArrowLeft') {
            playPreviousTrack();
        }
    });

    audioPlayer.addEventListener('timeupdate', () => {
        if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration === 0) {
            return;
        }
        currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
        progressBar.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        if (currentTracks[currentTrackIndex]) {
            durationEl.textContent = formatTime(audioPlayer.duration);
            renderTrackList(currentTracks);
        }
    });

    audioPlayer.addEventListener('ended', () => {
        playNextTrack();
    });

    progressBar.addEventListener('input', () => {
        if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration === 0) {
            return;
        }
        audioPlayer.currentTime = (Number(progressBar.value) / 100) * audioPlayer.duration;
    });

    authToggle.addEventListener('click', () => toggleAuthModal(true));
    profileButton.addEventListener('click', () => toggleAuthModal(true));
    closeAuth.addEventListener('click', () => toggleAuthModal(false));
    authModal.addEventListener('click', (event) => {
        if (event.target === authModal) {
            toggleAuthModal(false);
        }
    });

    authModeToggle.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        const emailField = document.getElementById('email');
        if (isRegisterMode) {
            authModalTitle.textContent = 'Create an account';
            authSubmitBtn.textContent = 'Register';
            authModeToggle.textContent = 'Already have an account? Sign in';
            emailField.style.display = 'block';
            emailField.required = true;
        } else {
            authModalTitle.textContent = 'Sign in to Pulse';
            authSubmitBtn.textContent = 'Sign In';
            authModeToggle.textContent = 'Create account instead';
            emailField.style.display = 'none';
            emailField.required = false;
        }
    });

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const email = document.getElementById('email')?.value?.trim();
        
        if (!username || !password) {
            return;
        }

        try {
            let result;
            if (isRegisterMode) {
                if (!email) {
                    alert('Email is required for registration.');
                    return;
                }
                result = await registerUser(username, email, password);
            } else {
                result = await loginUser(username, password);
            }

            saveAuth(result.token, result.user);
            updateAuthUi();
            toggleAuthModal(false);
            loginForm.reset();
            
            // Load playlists from server
            loadUserPlaylists();
        } catch (error) {
            alert(error.message || 'Authentication failed. Please try again.');
        }
    });

    createPlaylistBtn.addEventListener('click', createPlaylist);
    addToPlaylistBtn.addEventListener('click', addCurrentTrackToPlaylist);

    playlistList.addEventListener('click', async (event) => {
        const item = event.target.closest('.playlist-item');
        if (!item) return;
        const playlistId = item.dataset.id;
        const playlist = playlists.find((entry) => (entry._id || entry.id) === playlistId);
        if (!playlist) return;
        selectedPlaylistId = playlist._id || playlist.id;
        currentTracks = playlist.tracks || [];
        currentTrackIndex = 0;
        renderCards(currentTracks);
        renderTrackList(currentTracks);
        updatePlayerInfo(currentTracks[0]);
        renderPlaylists();
        if (currentTracks.length) {
            playTrack(0);
        }
    });
}

async function loadUserPlaylists() {
    if (!authToken) return;
    try {
        playlists = await fetchPlaylistsFromApi();
        renderPlaylists();
    } catch (error) {
        console.error('Failed to load playlists:', error);
    }
}

function initApp() {
    const storedToken = getStoredToken();
    const storedUser = getStoredUser();
    
    if (storedToken && storedUser) {
        authToken = storedToken;
        currentUser = storedUser;
    }
    
    playlists = [];
    bindEvents();
    updateAuthUi();
    renderPlaylists();
    updatePlayButton();
    audioPlayer.volume = Number(volumeBar.value) || 0.8;
    updateVolumeIcon();
    fetchSearch('trending music');
    
    // Load playlists if authenticated
    if (authToken) {
        loadUserPlaylists();
    }
}

initApp();
