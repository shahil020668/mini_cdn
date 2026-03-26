const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');
const latency = require('../middleware/latency');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../movies'));
    },
    filename: (req, file, cb) => {
        const id = req.body.id;
        const ext = path.extname(file.originalname);
        cb(null, `${id}${ext}`);
    }
});
const upload = multer({ storage: storage });

// Get all available movies
router.get('/', movieController.getAllMovies);

// Live Stats Dashboard Endpoint (Must be above /:id)
router.get('/stats', movieController.getStats);

// Upload a movie
router.post('/upload', upload.single('movie'), movieController.uploadMovie);

// Global Purge all Edge nodes
router.post('/purge-all', movieController.purgeAll);

// DB Terminal Interactive Route
router.post('/db-terminal', movieController.dbTerminal);

// Delete a movie
router.delete('/:id', movieController.deleteMovie);

// Get a movie (Removed latency middleware here so it shows on dashboard IMMEDIATELY)
router.get('/:id', movieController.getMovie);

module.exports = router;