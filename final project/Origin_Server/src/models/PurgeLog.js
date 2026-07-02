const mongoose = require('mongoose');

const PurgeLogSchema = new mongoose.Schema({
    type: { type: String, required: true }, // 'SINGLE' or 'GLOBAL'
    movieId: { type: String, required: true }, // ID of the movie or 'ALL'
    timestamp: { type: Date, default: Date.now },
    status: { type: String, default: 'SIGNAL_SENT' }
});

module.exports = mongoose.model('PurgeLog', PurgeLogSchema);