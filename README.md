# Pulse Music Hub

A responsive music streaming web app built with Node.js, Express, MongoDB, and a browser-based player UI. It supports search, playlists, auth, and a mobile-friendly player.

## Features

- Search music with YouTube Music and Audius fallbacks
- JWT-based auth with user registration/login
- Playlist creation and saved tracks
- Responsive layout for mobile, tablet, and desktop
- Mini-player and mobile-friendly controls
- Secure Express setup with Helmet and rate limiting

## Local setup

1. Install dependencies:
   npm install
2. Copy the example env file:
   copy .env.example .env
3. Replace placeholder secrets and MongoDB URI in .env
4. Start the app:
   npm start

## Environment variables

- PORT: app port
- MONGODB_URI: MongoDB connection string
- JWT_SECRET: secret used for JWT signing
- JWT_EXPIRES_IN: token lifespan
- CORS_ORIGIN: comma-separated allowed origins
- YTDLP_PATH: optional path to yt-dlp binary

## Deployment

### Render

1. Push this repo to GitHub
2. Create a new Web Service on Render
3. Connect the repository
4. Use the following values:
   - Build command: npm install
   - Start command: npm start
   - Environment variables: set all values from .env.example
5. Add a MongoDB Atlas database and update MONGODB_URI

### Railway / Fly.io

The app is compatible with standard Node.js hosting providers. Set the same environment variables and ensure MongoDB Atlas is reachable.

## Security notes

- Never commit a real .env file
- Rotate JWT_SECRET if it was exposed before
- Use MongoDB Atlas instead of local MongoDB in production
- Keep CORS_ORIGIN restricted to trusted domains

## GitHub repo creation

After authenticating GitHub CLI:

```bash
gh auth login
gh repo create pulse-music-hub --source=. --public --remote=origin --push
```

If the repo already exists, replace the remote with your desired GitHub URL:

```bash
git remote add origin https://github.com/your-username/pulse-music-hub.git
git push -u origin main
```
