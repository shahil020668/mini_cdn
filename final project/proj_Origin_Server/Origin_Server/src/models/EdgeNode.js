const mongoose = require('mongoose');

const EdgeNodeSchema = new mongoose.Schema({
    ip: { type: String, required: true, unique: true },
    nodeName: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EdgeNode', EdgeNodeSchema);