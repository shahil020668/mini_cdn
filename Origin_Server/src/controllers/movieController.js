const path = require('path');
const fs = require('fs');
const net = require('net');
const RequestLog = require('../models/RequestLog');
const PurgeLog = require('../models/PurgeLog');
const EdgeNode = require('../models/EdgeNode');
const axios = require('axios');

// --- AUTO-INITIALIZE DIRECTORY ---
const moviesDir = path.join(__dirname, '../../movies');

if (!fs.existsSync(moviesDir)) {
    try {
        // recursive: true ensures it creates parent folders if needed
        fs.mkdirSync(moviesDir, { recursive: true });
        // Give full permissions so Docker can write to it
        fs.chmodSync(moviesDir, '777'); 
        console.log(`[System] Created missing movies directory at: ${moviesDir}`);
    } catch (err) {
        console.error(`[Critical] Could not create movies directory:`, err);
    }
}

// --- Live Tracking State ---
const activeConnections = {};
const connectionHistory = {};
const accessLogs = [];

const edgeNodeIps = [];
const edgeNodeLabels = {
    // '10.49.147.78': 'Node A',
    // '10.49.147.233': 'Node B',
    // '172.39.10.32': 'Node C'
};
const fixedNodeLabels = {
    '127.0.0.1': 'Localhost',
    '::1': 'Localhost'
};
const RUNNING_IN_DOCKER = fs.existsSync('/.dockerenv');
const EDGE_PURGE_PORT = process.env.EDGE_PURGE_PORT || '3002';
const EDGE_DOCKER_LOOPBACK_HOST = process.env.EDGE_DOCKER_LOOPBACK_HOST || 'host.docker.internal';
const DEFAULT_EDGE_PURGE_HOST = RUNNING_IN_DOCKER ? EDGE_DOCKER_LOOPBACK_HOST : '127.0.0.1';
const EDGE_REGION_ENDPOINTS = [
    process.env.EDGE_INDIA_URL,
    process.env.EDGE_CHINA_URL,
    process.env.EDGE_RUSSIA_URL
].filter(Boolean);
const DEFAULT_EDGE_PURGE_ENDPOINT = `http://${DEFAULT_EDGE_PURGE_HOST}:${EDGE_PURGE_PORT}`;
const EDGE_PURGE_ENDPOINTS = String(
    process.env.EDGE_PURGE_ENDPOINTS ||
    (EDGE_REGION_ENDPOINTS.length > 0 ? EDGE_REGION_ENDPOINTS.join(',') : DEFAULT_EDGE_PURGE_ENDPOINT)
)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

// Load dynamic edge nodes from DB on startup
(async () => {
    try {
        const nodes = await EdgeNode.find().sort({ timestamp: 1 });
        nodes.forEach(node => {
            if (!edgeNodeLabels[node.ip]) {
                edgeNodeIps.push(node.ip);
                edgeNodeLabels[node.ip] = node.nodeName;
            }
        });
        console.log(`[Origin] Loaded ${nodes.length} dynamic edge nodes from DB`);
    } catch (err) {
        console.error('[DB Error] Could not load edge nodes:', err);
    }
})();

function indexToNodeLabel(index) {
    let n = index + 1;
    let label = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        label = String.fromCharCode(65 + rem) + label;
        n = Math.floor((n - 1) / 26);
    }
    return `Node ${label}`;
}

function getNextNodeLabel() {
    return indexToNodeLabel(edgeNodeIps.length);
}

function normalizePurgeHost(host) {
    if (!host) {
        return host;
    }

    if (RUNNING_IN_DOCKER && (host === '127.0.0.1' || host === 'localhost')) {
        return EDGE_DOCKER_LOOPBACK_HOST;
    }

    return host;
}

function toPurgeBaseFromIp(ip) {
    const host = normalizePurgeHost(ip);
    return `http://${host}:${EDGE_PURGE_PORT}`;
}

function toPurgeBaseFromUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const host = normalizePurgeHost(parsed.hostname);
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
        return `${parsed.protocol}//${host}:${port}`;
    } catch (err) {
        console.warn(`[Origin] Invalid EDGE_PURGE_ENDPOINTS entry skipped: ${rawUrl}`);
        return null;
    }
}

function getEdgeNodePurgeUrls(movieIdOrAll) {
    const edgeBases = new Set();

    edgeNodeIps.forEach(ip => {
        edgeBases.add(toPurgeBaseFromIp(ip));
    });

    EDGE_PURGE_ENDPOINTS.forEach(endpoint => {
        const purgeBase = toPurgeBaseFromUrl(endpoint);
        if (purgeBase) {
            edgeBases.add(purgeBase);
        }
    });

    const encodedMovieId = encodeURIComponent(movieIdOrAll);
    return Array.from(edgeBases).map(base => `${base}/purge/${encodedMovieId}`);
}

async function broadcastPurgeRequests(edgeUrls) {
    const results = await Promise.allSettled(
        edgeUrls.map(url => axios.post(url, null, { timeout: 5000 }))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failedTargets = [];
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            failedTargets.push({
                url: edgeUrls[index],
                error: result.reason?.message || 'Request failed'
            });
        }
    });

    return {
        successful,
        total: edgeUrls.length,
        failed: failedTargets.length,
        failedTargets
    };
}

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
        accessLogs,
        nodeMap: {
            ...fixedNodeLabels,
            ...edgeNodeLabels
        }
    });
};

exports.addEdgeNode = async (req, res) => {
    const rawIp = String(req.body?.ip || '').trim();

    if (!rawIp) {
        return res.status(400).json({ error: 'Edge IP is required' });
    }

    if (net.isIP(rawIp) !== 4) {
        return res.status(400).json({ error: 'Please provide a valid IPv4 address' });
    }

    if (edgeNodeLabels[rawIp]) {
        return res.status(200).json({
            message: `Edge node already registered as ${edgeNodeLabels[rawIp]}`,
            ip: rawIp,
            nodeName: edgeNodeLabels[rawIp]
        });
    }

    const nextLabel = getNextNodeLabel();
    edgeNodeIps.push(rawIp);
    edgeNodeLabels[rawIp] = nextLabel;

    // Save to DB
    try {
        await EdgeNode.create({ ip: rawIp, nodeName: nextLabel });
    } catch (err) {
        console.error('[DB Error] Could not save edge node:', err);
        // Remove from memory if DB save fails
        edgeNodeIps.pop();
        delete edgeNodeLabels[rawIp];
        return res.status(500).json({ error: 'Failed to save edge node to database' });
    }

    console.log(`[Origin] Registered new edge server: ${rawIp} as ${nextLabel}`);

    return res.status(201).json({
        message: `Edge server registered successfully as ${nextLabel}`,
        ip: rawIp,
        nodeName: nextLabel
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
            const EDGE_NODES = getEdgeNodePurgeUrls(movieIdWithoutExt);

            if (EDGE_NODES.length === 0) {
                console.warn('[Origin] No edge purge targets configured. Skipping movie purge broadcast.');
                return;
            }
            
            // Use Promise.allSettled for better error handling
            broadcastPurgeRequests(EDGE_NODES)
                .then(({ successful, total, failed, failedTargets }) => {
                    console.log(`[Origin] Purge broadcast complete: ${successful}/${total} edge nodes updated`);
                    if (failed > 0) {
                        console.warn(`[Origin] Purge broadcast had ${failed} failed edge nodes`);
                        failedTargets.forEach(target => {
                            console.warn(`[Origin] Failed purge target: ${target.url} -> ${target.error}`);
                        });
                    }
                })
                .catch(error => {
                    console.error('[Origin] Purge broadcast failed:', error.message);
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
        ...edgeNodeIps,
        ...Object.keys(fixedNodeLabels)
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
        const EDGE_NODES = getEdgeNodePurgeUrls(id);

        if (EDGE_NODES.length === 0) {
            return res.status(400).json({ error: 'No edge purge targets configured' });
        }

        const { successful, total, failed, failedTargets } = await broadcastPurgeRequests(EDGE_NODES);

        console.log(`[Origin] Manual purge broadcast complete: ${successful}/${total} edge nodes updated`);
        if (failed > 0) {
            console.warn(`[Origin] Manual purge had ${failed} failed edge nodes`);
        }
        res.json({
            message: `Purge signal for ${id} sent to ${successful}/${total} edge nodes.`,
            successful,
            total,
            failed,
            failedTargets,
            targets: EDGE_NODES
        });
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
    const EDGE_NODES = getEdgeNodePurgeUrls('all');

    if (EDGE_NODES.length === 0) {
        return res.status(400).json({ error: 'No edge purge targets configured' });
    }

    try {
        const { successful, total, failed, failedTargets } = await broadcastPurgeRequests(EDGE_NODES);
        
        console.log(`[Origin] Global purge broadcast complete: ${successful}/${total} edge nodes updated`);
        if (failed > 0) {
            console.warn(`[Origin] Global purge had ${failed} failed edge nodes`);
        }
        res.json({
            message: `Global purge completed: ${successful}/${total} edge nodes updated.`,
            successful,
            total,
            failed,
            failedTargets,
            targets: EDGE_NODES
        });
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
        } else if (command === 'show edgenodes') {
            result = await EdgeNode.find().sort({ timestamp: -1 });
        } else if (command.startsWith('delete edgenode ')) {
            const ip = command.replace('delete edgenode ', '').trim();
            if (!ip) {
                result = 'Please provide an IP address. Usage: delete edgenode <ip>';
            } else {
                const deleted = await EdgeNode.findOneAndDelete({ ip });
                if (deleted) {
                    // Remove from memory
                    const index = edgeNodeIps.indexOf(ip);
                    if (index > -1) edgeNodeIps.splice(index, 1);
                    delete edgeNodeLabels[ip];
                    result = `Deleted edge node: ${ip} (${deleted.nodeName})`;
                } else {
                    result = `Edge node with IP ${ip} not found.`;
                }
            }
        } else if (command.startsWith('clear')) {
            if (command.includes('purgelogs')) {
                 await PurgeLog.deleteMany({});
                 result = 'Purged all PurgeLogs.';
            } else if (command.includes('requestlogs')) {
                 await RequestLog.deleteMany({});
                 result = 'Purged all RequestLogs.';
            } else if (command.includes('edgenodes')) {
                 await EdgeNode.deleteMany({});
                 result = 'Purged all EdgeNodes.';
            } else { 
                result = 'Invalid clear command.';
            }
        } else {
             result = 'Unknown Command. Available: show purgelogs, show requestlogs, show edgenodes, delete edgenode <ip>, clear purgelogs, clear requestlogs, clear edgenodes';
        }
        res.json({ output: JSON.stringify(result, null, 2) });
    } catch(err) {
        res.status(500).json({ output: err.message });
    }
};

