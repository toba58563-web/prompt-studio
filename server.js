require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const Prompt = require('./models/Prompt');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected!'))
.catch(err => console.error('❌ Connection Error:', err));

// ========== API ROUTES ==========

// Google Auth API
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        res.json({ success: true, user: payload });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Auth failed' });
    }
});

// Prompts Fetch Route
app.get('/api/prompts', async (req, res) => {
    try {
        const prompts = await Prompt.find().sort({ createdAt: -1 });
        res.json(prompts);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Categories Stats
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await Prompt.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        const categoryList = ['All', ...categories.map(c => c._id)];
        res.json({ success: true, categories: categoryList, stats: categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== SERVE HTML FILES ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// FIXED: Is line ki wajah se error aa raha tha
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ========== START SERVER (Hamesha Last Mein) ==========
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin`);
});
