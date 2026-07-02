module.exports = (req, res, next) => {
    // Simulating the 2s delay for the "Slow Backbone" [cite: 136]
    setTimeout(() => {
        next();
    }, 2000);
};