const path = require('path');
const fs = require('fs');
const RequestLog = require('../models/RequestLog');
const PurgeLog = require('../models/PurgeLog');
const axios = require('axios');

// --- Live Tracking State ---
const activeConnections = {};
const connectionHistory = {};
const accessLogs = [];

function initMovieTracking(id) {
    if (activeConnections[id] === undefined) activeConnections[id] = 0;
    if (connectionHistory[id] === undefined) {
        connectionHistory[id] = new Array(20).fill(0);
    }
}

// Load initial movies into tracking
try {
    const moviesDir = path.join(__dirname, '../../movies');
    if (fs.existsSync(moviesDir)) {
        fs.readdirSync(moviesDir).forEach(file => {
            const ext = path.extname(file);
            if (ext === '.mp4' || ext === '.webm') {
                initMovieTracking(path.basename(file, ext));
            }
        });
    }
} catch(e) {}

// Track active connections every second for the live graph
setInterval(() => {
    // If the system just started, there may be no activeConnections yet.
    // Ensure all known connections have a baseline history array
    for (const id in activeConnections) {
        if(connectionHistory[id]) {
            connectionHistory[id].shift();
            connectionHistory[id].push(activeConnections[id] || 0);
        }
    }
}, 1000);

// Endpoint to provide stats to the frontend
exports.getStats = (req, res) => {
    res.json({
        activeConnections,
        connectionHistory,
        accessLogs
    });
};

exports.getAllMovies = (req, res) => {
    const moviesDir = path.join(__dirname, '../../movies');
    fs.readdir(moviesDir, (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Could not list movies" });
        }
        res.json({ movies: files });
    });
};

// Handle movie upload
exports.uploadMovie = (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No movie file provided" });
    }
    const id = req.body.id;
    initMovieTracking(id);
    console.log(`[Origin] New movie uploaded: ${id} (${req.file.filename}) has been saved to the movies folder.`);
    
    res.json({ message: `Movie ${id} uploaded successfully`, filename: req.file.filename });
};

// Handle movie deletion
exports.deleteMovie = (req, res) => {
    const { id } = req.params; // this captures the filename passed from frontend
    const filePath = path.join(__dirname, '../../movies', id);

    fs.unlink(filePath, (err) => {
        if (err) {
            console.error(`[Origin] Error deleting ${id}:`, err);
            // Ignore ENOENT (file doesn't exist) errors so UI still clears it
            if (err.code !== 'ENOENT') {
                return res.status(500).json({ error: "Could not delete movie" });
            }
        }
        console.log(`[Origin] Movie deleted: ${id}`);
        // After successfully deleting the local file, broadcast the purge directly to all Edge nodes
        try {
            const movieIdWithoutExt = id.split('.')[0]; // remove .mp4/.webm for the purge ID
            
            // Clean up tracking graph
            delete activeConnections[movieIdWithoutExt];
            delete connectionHistory[movieIdWithoutExt];
            
            // Directly broadcast purge to all Edge nodes
            const EDGE_NODES = [
                `http://192.168.1.11:4000/purge/${movieIdWithoutExt}`,
                `http://192.168.1.12:4000/purge/${movieIdWithoutExt}`,
                `http://192.168.1.13:4000/purge/${movieIdWithoutExt}`
            ];
            
            // Use Promise.allSettled for better error handling
            Promise.allSettled(EDGE_NODES.map(url => axios.post(url).catch(() => null)))
                .then(results => {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    console.log(`[Origin] Purge broadcast complete: ${successful}/${EDGE_NODES.length} edge nodes updated`);
                });
                
            console.log(`[Origin] Purge signal broadcasted for ${id} to all edge nodes.`);

            // DB Logging
            PurgeLog.create({ type: 'SINGLE', movieId: movieIdWithoutExt }).catch(err => {
                console.error("[DB Error] Could not save Purge Log", err);
            });

        } catch(e) {
            console.error(e);
        }

        res.status(200).json({ message: `Movie ${id} deleted successfully` });
    });
};

exports.getMovie = async (req, res) => {
    let { id } = req.params;
    const rawIp = req.ip.replace('::ffff:', ''); 
 
    const allowedNodes = [
        '10.49.147.78', // Node A
        '10.49.147.233', // Node B
        '', // Node C


        '10.42.0.218',  // Test Node
        '127.0.0.1',    // Localhost
        '::1'           // Localhost
    ];

    if (!allowedNodes.includes(rawIp)) {
        console.warn(`[SECURITY] Blocked unauthorized content request from IP: ${rawIp}`);
        return res.status(403).json({ 
            error: "Access Denied", 
            message: `Your IP (${rawIp}) is not a registered CDN Edge Node. Direct origin access is prohibited.`
        });
    }

    // Strip extensions if requested directly
    if (id.endsWith('.mp4') || id.endsWith('.webm')) {
        id = id.substring(0, id.lastIndexOf('.'));
    }

    // Find file regardless of extension (.mp4 or .webm)
    let filePath = path.join(__dirname, '../../movies', `${id}.mp4`);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, '../../movies', `${id}.webm`);
    }

    // Only count it as an active connection if the file actually exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Movie file not found" });
    }

    // Get file size to display
    let fileSizeMB = 'Unknown Size';
    try {
        const stats = fs.statSync(filePath);
        fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
    } catch(e) {}

    // --- Live Tracking Analytics ---
    initMovieTracking(id);
    activeConnections[id] = (activeConnections[id] || 0) + 1;
    const logEntry = {
        time: new Date().toLocaleTimeString(),
        edgeIp: rawIp,
        movieId: id,
        status: `DELAY (2s) - ${fileSizeMB}`
    };
    accessLogs.unshift(logEntry);
    if(accessLogs.length > 8) accessLogs.pop(); // Keep only last 8 logs

    let isDone = false;
    const cleanup = () => {
        if (!isDone) {
            isDone = true;
            if(activeConnections[id] > 0) activeConnections[id]--;
            
            const logIdx = accessLogs.indexOf(logEntry);
            if(logIdx !== -1) {
                accessLogs[logIdx].status = 'COMPLETED / CACHED';
            }
        }
    };
    
    req.on('close', cleanup);
    res.on('finish', cleanup);

    try {
        await RequestLog.create({ movieId: id, edgeIp: rawIp });
    } catch (err) {
        // silently ignore db log errors for now
    }

    console.log(`[Origin] Request for ${id} from ${rawIp}. Delaying 2s...`);

    // Mandatory 2-second "Slow Backbone" simulation happens HERE now, so dashboard tracks it instantly
    setTimeout(() => {
        if (!isDone) {
            const logIdx = accessLogs.indexOf(logEntry);
            if(logIdx !== -1) {
                accessLogs[logIdx].status = 'STREAMING...';
            }
            res.sendFile(filePath);
        }
    }, 2000);
};

// Initiate direct purge to all Edge nodes
exports.triggerPurge = async (req, res) => {
    const { id } = req.params;

    try {
        // Directly broadcast purge to all Edge nodes
        const EDGE_NODES = [
            `http://192.168.1.11:4000/purge/${id}`,
            `http://192.168.1.12:4000/purge/${id}`,
            `http://192.168.1.13:4000/purge/${id}`
        ];

        const results = await Promise.allSettled(EDGE_NODES.map(url => axios.post(url).catch(() => null)));
        const successful = results.filter(r => r.status === 'fulfilled').length;

        console.log(`[Origin] Manual purge broadcast complete: ${successful}/${EDGE_NODES.length} edge nodes updated`);
        res.json({ message: `Purge signal for ${id} sent to ${successful}/${EDGE_NODES.length} edge nodes.` });
    } catch (error) {
        console.error("[Origin] Error during manual purge:", error);
        res.status(500).json({ error: "Could not complete purge operation" });
    }
};

// Initiate a Global Purge across all Edge caches
exports.purgeAll = async (req, res) => {
    try {
        // Log to DB First
        await PurgeLog.create({ type: 'GLOBAL', movieId: 'ALL' });
    } catch (err) {
        console.error("[DB Error] Could not save Global Purge Log", err);
    }

    // Directly broadcast global purge to all Edge nodes
    const EDGE_NODES = [
        'http://192.168.1.11:4000/purge/all',
        'http://192.168.1.12:4000/purge/all',
        'http://192.168.1.13:4000/purge/all'
    ];

    try {
        const results = await Promise.allSettled(EDGE_NODES.map(url => axios.post(url).catch(() => null)));
        const successful = results.filter(r => r.status === 'fulfilled').length;
        
        console.log(`[Origin] Global purge broadcast complete: ${successful}/${EDGE_NODES.length} edge nodes updated`);
        res.json({ message: `Global purge completed: ${successful}/${EDGE_NODES.length} edge nodes updated.` });
    } catch (error) {
        console.error("[Origin] Error during global purge:", error);
        res.status(500).json({ error: 'Error during global purge operation' });
    }
};
exports.dbTerminal = async (req, res) => {
    try {
        const { command } = req.body;
        let result;
        if (command === 'show purgelogs') {
            result = await PurgeLog.find().sort({ timestamp: -1 }).limit(20);
        } else if (command === 'show requestlogs') {
            result = await RequestLog.find().sort({ timestamp: -1 }).limit(20);
        } else if (command.startsWith('clear')) {
            if (command.includes('purgelogs')) {
                 await PurgeLog.deleteMany({});
                 result = 'Purged all PurgeLogs.';
            } else if (command.includes('requestlogs')) {
                 await RequestLog.deleteMany({});
                 result = 'Purged all RequestLogs.';
            } else { 
                result = 'Invalid clear command.';
            }
        } else {
             result = 'Unknown Command. Available: show purgelogs, show requestlogs, clear purgelogs, clear requestlogs';
        }
        res.json({ output: JSON.stringify(result, null, 2) });
    } catch(err) {
        res.status(500).json({ output: err.message });
    }
};

