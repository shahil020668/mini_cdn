const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const movieRoutes = require('./src/routes/movieRoutes');
const app = express();
const PORT = 4000;

// Connect to MongoDB
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/origin_db';
mongoose.connect(mongoURI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routing
app.use('/api', movieRoutes);

app.listen(PORT, () => {
    console.log(`Origin Master (PC1) running on port ${PORT}`);
});