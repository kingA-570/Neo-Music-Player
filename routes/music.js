const express = require('express');
const YouTubeMusic = require('youtube-music-api');
const { execFile } = require('child_process');
const SearchHistory = require('../models/SearchHistory');
const Playlist = require('../models/Playlist');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const api = new YouTubeMusic();

// ── yt-dlp audio stream helper ──────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');

// Try env var, PATH, then common install locations
const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH,
  'yt-dlp',
  path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
  '/usr/local/bin/yt-dlp',
  '/opt/homebrew/bin/yt-dlp',
  '/usr/bin/yt-dlp'
].filter(Boolean);

function findYtDlp() {
  for (const candidate of YTDLP_CANDIDATES) {
    if (candidate === 'yt-dlp') continue;
    try {
      if (fs.existsSync(candidate)) return { command: candidate, args: [] };
    } catch (e) { /* ignore */ }
  }

  const pythonCandidates = [
    process.env.PYTHON,
    process.env.PYTHONPATH ? path.join(process.env.PYTHONPATH, '..', 'python.exe') : '',
    'python',
    'py',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Python314', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Python313', 'python.exe')
  ].filter(Boolean);

  for (const candidate of pythonCandidates) {
    try {
      const { execSync } = require('child_process');
      execSync(`"${candidate}" -c "import yt_dlp"`, { stdio: 'ignore' });
      return { command: candidate, args: ['-m', 'yt_dlp'] };
    } catch (e) { /* ignore */ }
  }

  try {
    if (fs.existsSync('C:/Windows/System32/where.exe')) {
      const { execSync } = require('child_process');
      const found = execSync('where yt-dlp', { stdio: 'pipe', encoding: 'utf8' }).trim();
      if (found) return { command: found.split('\n')[0], args: [] };
    } else {
      const { execSync } = require('child_process');
      const found = execSync('which yt-dlp', { stdio: 'pipe', encoding: 'utf8' }).trim();
      if (found) return { command: found.split('\n')[0], args: [] };
    }
  } catch (e) { /* not in PATH */ }
  return null;
}

let YTDLP = findYtDlp();

// ── Audius API (fallback streaming) ─────────────────────────────────
const AUDIUS_BASE = 'https://discoveryprovider.audius.co';

function formatDurationFromSeconds(seconds) {
  if (!seconds || isNaN(seconds)) return '--:--';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatAudiusTrack(item) {
  const artist = item.user?.name || 'Unknown Artist';
  const thumbnail = item.artwork?.['480x480'] || item.artwork?.['150x150'] || '';
  return {
    videoId: '',
    source: 'audius',
    id: item.id || '',
    title: item.title || 'Unknown Title',
    artist: artist,
    artists: [artist],
    album: item.album_name || '',
    duration: formatDurationFromSeconds(item.duration),
    thumbnail: thumbnail,
    cover: thumbnail,
    preview: item.id ? `${AUDIUS_BASE}/v1/tracks/${item.id}/stream` : '',
    previewUrl: item.id ? `${AUDIUS_BASE}/v1/tracks/${item.id}/stream` : '',
    streamUrl: item.id ? `${AUDIUS_BASE}/v1/tracks/${item.id}/stream` : '',
    youtubeMusicUrl: ''
  };
}

async function searchAudius(query, limit = 20) {
  const url = `${AUDIUS_BASE}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Audius search failed: ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(formatAudiusTrack);
}

async function getAudiusTrending(limit = 20) {
  const url = `${AUDIUS_BASE}/v1/tracks/trending?time=week&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Audius trending failed: ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(formatAudiusTrack);
}
// ── End Audius API ──────────────────────────────────────────────────

// ── iTunes Search API (real audio fallback, no key / yt-dlp needed) ──
function formatITunesTrack(item) {
  let duration = '--:--';
  if (item.trackTimeMillis) {
    const totalSec = Math.floor(item.trackTimeMillis / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    duration = `${m}:${s.toString().padStart(2, '0')}`;
  }
  const baseThumb = item.artworkUrl100 || '';
  // Request a higher-resolution cover instead of the tiny 100x100 default.
  const thumbnail = baseThumb.replace(/100x100bb\.jpg$/, '300x300bb.jpg').replace(/100x100\.jpg$/, '300x300.jpg');
  const previewUrl = item.previewUrl || '';
  return {
    videoId: '',
    source: 'itunes',
    id: String(item.trackId || ''),
    title: item.trackName || item.collectionName || 'Unknown Title',
    artist: item.artistName || 'Unknown Artist',
    artists: item.artistName ? [item.artistName] : [],
    album: item.collectionName || '',
    duration: duration,
    thumbnail: thumbnail,
    cover: thumbnail,
    preview: previewUrl,
    previewUrl: previewUrl,
    streamUrl: previewUrl,
    youtubeMusicUrl: ''
  };
}

async function searchITunes(query, limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=${limit}&entity=song`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
  const data = await res.json();
  return (data.results || []).filter((r) => r.previewUrl).map(formatITunesTrack);
}
// ── End iTunes API ───────────────────────────────────────────────────

async function getAudioStreamUrl(videoId) {
  if (!videoId) return '';
  if (!YTDLP) {
    YTDLP = findYtDlp();
  }
  if (!YTDLP) {
    console.error('yt-dlp not found. Install it or set YTDLP_PATH env var.');
    return '';
  }

  const command = YTDLP.command;
  const extraArgs = YTDLP.args || [];
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const attempts = [
    [
      ...extraArgs,
      '--get-url',
      '--format', 'bestaudio[ext=m4a]/bestaudio/best',
      '--extractor-args', 'youtube:player_client=android,web',
      '--no-warnings',
      '--no-playlist',
      '--force-ipv4',
      watchUrl
    ],
    [
      ...extraArgs,
      '--get-url',
      '--format', 'bestaudio/best',
      '--no-warnings',
      '--no-playlist',
      '--force-ipv4',
      watchUrl
    ],
    [
      ...extraArgs,
      '-g',
      '--format', 'bestaudio/best',
      '--no-warnings',
      '--no-playlist',
      '--force-ipv4',
      watchUrl
    ]
  ];

  for (const args of attempts) {
    const streamUrl = await new Promise((resolve) => {
      execFile(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`yt-dlp failed for ${videoId}:`, (stderr || err.message || '').trim());
          return resolve('');
        }
        const url = (stdout || '')
          .split('\n')
          .map((line) => line.trim())
          .find((line) => /^https?:\/\//i.test(line));
        resolve(url || '');
      });
    });

    if (streamUrl) {
      return streamUrl;
    }
  }

  return '';
}
// ── End yt-dlp helper ───────────────────────────────────────────────

async function resolveAudioSource(videoId) {
  const youtubeUrl = await getAudioStreamUrl(videoId);
  if (youtubeUrl) {
    return { url: youtubeUrl, source: 'youtube' };
  }

  if (!videoId) {
    return null;
  }

  try {
    const audiusRes = await fetch(`${AUDIUS_BASE}/v1/tracks/${encodeURIComponent(videoId)}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (audiusRes.ok) {
      const data = await audiusRes.json();
      if (data.data && data.data.id) {
        return { url: `${AUDIUS_BASE}/v1/tracks/${data.data.id}/stream`, source: 'audius' };
      }
    }
  } catch (audiusError) {
    console.error('Audius stream fallback error:', audiusError.message);
  }

  return null;
}

async function fetchUpstreamResponse(url, rangeHeader) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': '*/*'
  };
  if (rangeHeader) headers.Range = rangeHeader;

  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(headerTimer);
  }
}

// Initialize the YouTube Music API
let apiInitialized = false;
async function initAPI() {
  if (!apiInitialized) {
    try {
      // NOTE: library method has a typo - 'initalize' not 'initialize'
      await api.initalize();
      apiInitialized = true;
      console.log('YouTube Music API initialized successfully.');
    } catch (error) {
      console.error('Failed to initialize YouTube Music API:', error.message);
      console.log('ytdl-core will be used for audio extraction.');
      apiInitialized = true;
    }
  }
}

// Initialize on module load
initAPI();

// Mock fallback data when YouTube Music API fails
const mockTracks = [
  { title: 'Neon Skyline', artists: ['Luma'], album: 'Glow State', duration: '3:41' },
  { title: 'Midnight Echo', artists: ['Nova Lane'], album: 'After Dark', duration: '2:58' },
  { title: 'Ocean Drive', artists: ['Mira'], album: 'Coastline', duration: '4:11' },
  { title: 'Golden Hour', artists: ['Ari Sol'], album: 'Sunset', duration: '3:26' },
  { title: 'Urban Lights', artists: ['The Volt'], album: 'Cityscape', duration: '3:15' },
  { title: 'Starlight', artists: ['Celeste'], album: 'Night Sky', duration: '4:05' }
];
const mockPreviews = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3'
];

function getFallbackTracks(query) {
  return mockTracks.map((track, index) => ({
    videoId: `mock-${index + 1}-${track.title.toLowerCase().replace(/\s+/g, '-')}`,
    title: track.title,
    artist: track.artists.join(', '),
    artists: track.artists,
    album: track.album,
    duration: track.duration,
    thumbnail: `card${index + 1}img.jpeg`,
    cover: `card${index + 1}img.jpeg`,
    preview: '',
    previewUrl: '',
    streamUrl: '',
    youtubeMusicUrl: `https://music.youtube.com/search?q=${encodeURIComponent(`${query} ${track.title}`)}`
  }));
}

// Helper to format YouTube Music results
function formatTrack(item) {
  // artist field from parser: array of {name,browseId} or single {name,browseId} or []
  let artistField = item.artist;
  if (!Array.isArray(artistField)) {
    artistField = artistField && typeof artistField === 'object' ? [artistField] : [];
  }
  const artists = artistField.map(a => (a && a.name ? a.name : '')).filter(Boolean);
  const artistName = artists.length > 0 ? artists.join(', ') : 'Unknown Artist';

  let duration = item.duration || '--:--';
  if (typeof duration === 'number') {
    const totalSec = Math.floor(duration / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    duration = `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Prefer a real, high-resolution YouTube video thumbnail derived from the videoId.
  // The parser's "thumbnail" field is usually a tiny 60x60 channel avatar which looks
  // blurry when stretched over the large homepage cards.
  let thumbnail = '';
  if (item.videoId) {
    thumbnail = `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
  }
  if (!thumbnail) {
    const thumbs = item.thumbnails || item.thumbnail;
    if (Array.isArray(thumbs) && thumbs.length > 0) {
      // Pick the highest-quality entry instead of the smallest (first) one.
      const candidate = thumbs.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
      thumbnail = candidate?.url || thumbs[0] || '';
    } else if (typeof thumbs === 'object' && thumbs !== null) {
      thumbnail = thumbs.url || thumbs[0]?.url || '';
    } else if (typeof thumbs === 'string') {
      thumbnail = thumbs;
    }
  }

  let album = '';
  if (item.album) {
    album = typeof item.album === 'object' ? (item.album.name || '') : item.album;
  }

  return {
    videoId: item.videoId || '',
    title: item.name || item.title || 'Unknown Title',
    artist: artistName,
    artists: artists,
    album: album,
    duration: duration,
    thumbnail: thumbnail,
    cover: thumbnail,
    preview: item.previewUrl || '',
    previewUrl: item.previewUrl || '',
    streamUrl: item.streamUrl || '',
    youtubeMusicUrl: item.videoId ? `https://music.youtube.com/watch?v=${item.videoId}` : ''
  };
}

// GET /api/search?q=query
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const query = (req.query.q || 'trending music').trim();
    if (!query) {
      return res.json({ tracks: [], message: 'Search query is required.' });
    }

    // Ensure API is initialized
    if (!apiInitialized) {
      await initAPI();
    }

    let tracks = [];
    let searchSource = 'youtube';
    try {
      // Search using YouTube Music API
      let results = await api.search(query, 'SONG');

      if (results && results.content) {
        tracks = results.content.slice(0, 20).map(formatTrack);
      } else if (Array.isArray(results)) {
        tracks = results.slice(0, 20).map(formatTrack);
      }

      // Fill in real stream URLs when yt-dlp is available.
      if (tracks.length > 0 && YTDLP) {
        for (const track of tracks) {
          if (!track.videoId || (track.streamUrl && /^https?:\/\//.test(track.streamUrl))) continue;
          const streamUrl = await getAudioStreamUrl(track.videoId);
          if (streamUrl) {
            track.streamUrl = streamUrl;
            track.previewUrl = streamUrl;
            track.preview = streamUrl;
          }
        }
      }

      // On servers without yt-dlp (e.g. Render), YouTube search still returns results but
      // none of them are playable (streams need yt-dlp and are IP-locked). Drop them here so
      // the fallback chain moves on to reliable real-audio sources (Audius / iTunes) instead
      // of surfacing songs that silently fail to play.
      if (tracks.length > 0 && !YTDLP) {
        tracks = tracks.filter((t) => t.streamUrl && /^https?:\/\//.test(t.streamUrl));
        if (tracks.length) searchSource = 'youtube';
      }
    } catch (searchError) {
      console.error('YouTube Music search error:', searchError.message);
      tracks = [];
    }

    // Fallback #1: Audius API (real, directly-streamable audio without yt-dlp)
    if (tracks.length === 0) {
      try {
        console.log('Falling back to Audius search...');
        tracks = await searchAudius(query, 20);
        searchSource = 'audius';
      } catch (audiusError) {
        console.error('Audius search error:', audiusError.message);
        tracks = [];
      }
    }

    // Fallback #2: iTunes Search API (real 30s preview MP3s, no key / yt-dlp needed)
    if (tracks.length === 0) {
      try {
        console.log('Falling back to iTunes search...');
        tracks = await searchITunes(query, 20);
        searchSource = 'itunes';
      } catch (itunesError) {
        console.error('iTunes search error:', itunesError.message);
        tracks = [];
      }
    }

    // Fallback #3: mock data only when there are truly no results to show.
    if (tracks.length === 0) {
      tracks = getFallbackTracks(query);
      searchSource = 'mock';
    }

    tracks = tracks.map((track) => {
      if (!track.preview && track.previewUrl) {
        track.preview = track.previewUrl;
      }
      return track;
    });

    console.log(`Search source: ${searchSource}, tracks: ${tracks.length}`);

    // Save search history if user is authenticated
    if (req.userId) {
      try {
        // Check if same query already exists (avoid duplicates)
        const existing = await SearchHistory.findOne({
          userId: req.userId,
          query: query.toLowerCase()
        });
        
        if (!existing) {
          await SearchHistory.addSearch(req.userId, query.toLowerCase());
        } else {
          // Update timestamp
          existing.searchedAt = Date.now();
          await existing.save();
        }
      } catch (historyError) {
        console.error('Error saving search history:', historyError.message);
      }
    }

    // Get history for authenticated user
    let history = [];
    if (req.userId) {
      try {
        history = await SearchHistory.find({ userId: req.userId })
          .sort({ searchedAt: -1 })
          .limit(10)
          .lean();
      } catch (e) {
        // Ignore history fetch errors
      }
    }

    res.json({
      tracks,
      history,
      message: tracks.length ? `Found ${tracks.length} results for "${query}".` : `No results found for "${query}".`
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ tracks: [], message: 'Search failed. Please try again.' });
  }
});

// GET /api/history
router.get('/history', auth, async (req, res) => {
  try {
    const history = await SearchHistory.find({ userId: req.userId })
      .sort({ searchedAt: -1 })
      .limit(10)
      .lean();
    res.json(history);
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch search history.' });
  }
});

// GET /api/playlists
router.get('/playlists', auth, async (req, res) => {
  try {
    const playlists = await Playlist.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .lean();
    res.json(playlists);
  } catch (error) {
    console.error('Playlists fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch playlists.' });
  }
});

// POST /api/playlists
router.post('/playlists', auth, async (req, res) => {
  try {
    const { name, tracks } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Playlist name is required.' });
    }

    const playlist = await Playlist.create({
      name: name.trim(),
      userId: req.userId,
      tracks: tracks || []
    });

    res.status(201).json(playlist);
  } catch (error) {
    console.error('Playlist create error:', error);
    res.status(500).json({ message: 'Failed to create playlist.' });
  }
});

// POST /api/playlists/:id/tracks
router.post('/playlists/:id/tracks', auth, async (req, res) => {
  try {
    const { track } = req.body;
    if (!track || !track.videoId) {
      return res.status(400).json({ message: 'Track data with videoId is required.' });
    }

    const playlist = await Playlist.findOne({ _id: req.params.id, userId: req.userId });
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found.' });
    }

    // Check if track already exists
    const exists = playlist.tracks.some((t) => t.videoId === track.videoId);
    if (!exists) {
      playlist.tracks.push(track);
      await playlist.save();
    }

    res.json(playlist);
  } catch (error) {
    console.error('Add track error:', error);
    res.status(500).json({ message: 'Failed to add track to playlist.' });
  }
});

// DELETE /api/playlists/:id/tracks/:videoId
router.delete('/playlists/:id/tracks/:videoId', auth, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, userId: req.userId });
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found.' });
    }

    playlist.tracks = playlist.tracks.filter((t) => t.videoId !== req.params.videoId);
    await playlist.save();

    res.json(playlist);
  } catch (error) {
    console.error('Remove track error:', error);
    res.status(500).json({ message: 'Failed to remove track from playlist.' });
  }
});

// DELETE /api/playlists/:id
router.delete('/playlists/:id', auth, async (req, res) => {
  try {
    const playlist = await Playlist.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found.' });
    }
    res.json({ message: 'Playlist deleted successfully.' });
  } catch (error) {
    console.error('Playlist delete error:', error);
    res.status(500).json({ message: 'Failed to delete playlist.' });
  }
});

// GET /api/stream/:videoId - get direct audio stream URL
router.get('/stream/:videoId', async (req, res) => {
  try {
    const source = await resolveAudioSource(req.params.videoId);
    if (source && source.url) {
      res.json({ url: source.url, source: source.source, videoId: req.params.videoId });
    } else {
      res.status(404).json({ error: 'No audio stream found' });
    }
  } catch (error) {
    console.error('Stream error:', error.message);
    res.status(500).json({ error: 'Failed to get stream URL' });
  }
});

// GET /api/play/:videoId - proxy audio stream through server (avoids CORS)
router.get('/play/:videoId', async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: 'Stream timed out' });
  }, 20000);

  try {
    let source = await resolveAudioSource(req.params.videoId);
    if (!source || !source.url) {
      clearTimeout(timeout);
      return res.status(404).json({ error: 'No audio stream found' });
    }

    let upstream = await fetchUpstreamResponse(source.url, req.headers.range);
    if ((!upstream.ok || !upstream.body) && source.source === 'youtube') {
      const refreshed = await getAudioStreamUrl(req.params.videoId);
      if (refreshed && refreshed !== source.url) {
        source = { url: refreshed, source: 'youtube' };
        upstream = await fetchUpstreamResponse(source.url, req.headers.range);
      }
    }
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstream stream request failed' });
    }

    if (!upstream.body) {
      return res.status(502).json({ error: 'Upstream returned no audio body' });
    }

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    const { Readable } = require('stream');
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', (streamError) => {
      console.error('Stream proxy error:', streamError.message);
      res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    clearTimeout(timeout);
    console.error('Play proxy error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio' });
    } else {
      res.destroy();
    }
  }
});

// ── Favorites (for React client) ─────────────────────────────────────
const userFavorites = {};

router.get('/favorites', auth, async (req, res) => {
  try {
    res.json(userFavorites[req.userId] || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch favorites.' });
  }
});

router.post('/favorites', auth, async (req, res) => {
  try {
    if (!userFavorites[req.userId]) userFavorites[req.userId] = [];
    const exists = userFavorites[req.userId].some(f => f.videoId === req.body.videoId);
    if (!exists) {
      userFavorites[req.userId].push(req.body);
    }
    res.json(userFavorites[req.userId]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to save favorite.' });
  }
});

router.delete('/favorites/:id', auth, async (req, res) => {
  try {
    if (userFavorites[req.userId]) {
      userFavorites[req.userId] = userFavorites[req.userId].filter(f => f._id !== req.params.id && f.videoId !== req.params.id);
    }
    res.json(userFavorites[req.userId] || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove favorite.' });
  }
});

module.exports = router;
