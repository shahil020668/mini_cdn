const mongoose = require('mongoose');

const RequestLogSchema = new mongoose.Schema({
    movieId: { type: String, required: true },
    edgeIp: { type: String, required: true }, // Captures which Edge PC (2, 3, or 4) requested data
    timestamp: { type: Date, default: Date.now },
    status: { type: String, default: 'MISS' } // Reaching the Origin always implies a Cache Miss [cite: 22, 133]
});

module.exports = mongoose.model('RequestLog', RequestLogSchema);