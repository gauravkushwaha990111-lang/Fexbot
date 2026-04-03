const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    userName: String,
    isMainAdmin: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    lastClaim: { type: Date, default: null },
    referCount: { type: Number, default: 0 },
    videosWatched: { type: Number, default: 0 },
    credits: { type: Number, default: 0 },
    telegramUsername: String,
    botState: { type: String, default: '' },
    lastWatchedVideoTime: { type: Date, default: null },
    watchedVideos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Video' }],
    joinedAt: { type: Date, default: Date.now }
});

const VideoSchema = new mongoose.Schema({
    fileId: String,
    uniqueId: { type: String, unique: true }
});

const ChannelSchema = new mongoose.Schema({
    username: { type: String, unique: true }
});

const User = mongoose.model('User', UserSchema);
const Video = mongoose.model('Video', VideoSchema);
const Channel = mongoose.model('Channel', ChannelSchema);

module.exports = { User, Video, Channel };