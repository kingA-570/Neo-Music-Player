const mongoose = require('mongoose');

const trackSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  title: { type: String, required: true },
  artist: { type: String, default: 'Unknown Artist' },
  album: { type: String, default: '' },
  duration: { type: String, default: '--:--' },
  thumbnail: { type: String, default: '' },
  preview: { type: String, default: '' },
  streamUrl: { type: String, default: '' },
  youtubeMusicUrl: { type: String, default: '' }
}, { _id: false });

const playlistSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Playlist name is required'],
    trim: true,
    maxlength: [100, 'Playlist name cannot exceed 100 characters']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tracks: [trackSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
playlistSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Playlist', playlistSchema);

