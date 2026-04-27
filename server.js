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
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('✅ MongoDB Connected Successfully!');
})
.catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
});

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
        console.error('Google Auth Error:', error);
        res.status(500).json({ success: false, error: 'Auth failed' });
    }
});

// Get all prompts
app.get('/api/prompts', async (req, res) => {
    try {
        const { category, search, limit = 50 } = req.query;
        let filter = {};
        if (category && category !== 'All') filter.category = category;
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { prompt: { $regex: search, $options: 'i' } }
            ];
        }
        const prompts = await Prompt.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
        res.json({ success: true, prompts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add new prompt (Admin)
app.post('/api/admin/prompts', async (req, res) => {
    try {
        const { title, category, prompt, imageUrl, adminKey } = req.body;
        if (adminKey !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const newPrompt = new Prompt({
            title, category, prompt,
            imageUrl: imageUrl || 'https://picsum.photos/400/300'
        });
        await newPrompt.save();
        res.json({ success: true, prompt: newPrompt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update prompt views & likes
app.post('/api/prompt/view', async (req, res) => {
    try {
        await Prompt.findByIdAndUpdate(req.body.id, { $inc: { views: 1 } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/prompt/like', async (req, res) => {
    try {
        await Prompt.findByIdAndUpdate(req.body.id, { $inc: { likes: 1 } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// Get categories
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await Prompt.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
        const categoryList = ['All', ...categories.map(c => c._id)];
        res.json({ success: true, categories: categoryList });
    } catch (error) { res.status(500).json({ success: false }); }
});

// ========== SERVE HTML FILES (Fixed Routes) ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// LOGIN ROUTE (Iski wajah se error aa raha tha)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
