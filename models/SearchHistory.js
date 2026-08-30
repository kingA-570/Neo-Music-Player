const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  query: {
    type: String,
    required: true,
    trim: true
  },
  searchedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient querying
searchHistorySchema.index({ userId: 1, searchedAt: -1 });

// Limit history to last 50 entries per user
searchHistorySchema.statics.addSearch = async function (userId, query) {
  const history = await this.create({ userId, query });
  
  // Keep only the latest 50 searches per user
  const count = await this.countDocuments({ userId });
  if (count > 50) {
    const oldest = await this.find({ userId })
      .sort({ searchedAt: 1 })
      .limit(count - 50);
    const ids = oldest.map((item) => item._id);
    await this.deleteMany({ _id: { $in: ids } });
  }
  
  return history;
};

module.exports = mongoose.model('SearchHistory', searchHistorySchema);

