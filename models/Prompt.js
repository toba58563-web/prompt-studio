const mongoose = require('mongoose');

const promptSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Portrait', 'Cyberpunk', 'Fantasy', 'Nature', 'Abstract', 'Architecture', 'Character', 'Sci-Fi'],
        default: 'Portrait'
    },
    prompt: {
        type: String,
        required: true
    },
    imageUrl: {
        type: String,
        default: 'https://picsum.photos/400/300'
    },
    likes: {
        type: Number,
        default: 0
    },
    views: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Prompt', promptSchema);
