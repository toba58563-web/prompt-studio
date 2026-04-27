require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
const Prompt = require('./models/Prompt');

const app = express();
const PORT = process.env.PORT || 3000;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ========== USER SCHEMA ==========
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true, unique: true },
    password: { type: String }, // Manual signup ke liye
    profilePic: String,
    isPremium: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser()); // Cookies read karne ke liye
app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB Connected with Auth Support!'))
.catch((err) => console.error('❌ Connection Error:', err));

// ========== AUTH ROUTES (NEW) ==========

// 1. Manual Signup
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: 'Email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();

        res.json({ success: true, message: 'Account created!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Manual Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !user.password) return res.status(400).json({ success: false, message: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Wrong password' });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true }).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Google One-Tap Login
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const { name, email, picture } = ticket.getPayload();

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ name, email, profilePic: picture });
            await user.save();
        }

        const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', jwtToken, { httpOnly: true }).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== API ROUTES (YOUR ORIGINAL ROUTES) ==========

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

app.get('/api/prompt/:id', async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);
        res.json({ success: true, prompt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/prompts', async (req, res) => {
    try {
        const { title, category, prompt, imageUrl, adminKey } = req.body;
        if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const newPrompt = new Prompt({ title, category, prompt, imageUrl: imageUrl || 'https://picsum.photos/400/300' });
        await newPrompt.save();
        res.json({ success: true, prompt: newPrompt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/prompt/view', async (req, res) => {
    try {
        const { id } = req.body;
        await Prompt.findByIdAndUpdate(id, { $inc: { views: 1 } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/prompt/like', async (req, res) => {
    try {
        const { id } = req.body;
        await Prompt.findByIdAndUpdate(id, { $inc: { likes: 1 } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/categories', async (req, res) => {
    try {
        const categories = await Prompt.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
        const categoryList = ['All', ...categories.map(c => c._id)];
        res.json({ success: true, categories: categoryList, stats: categories });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const totalPrompts = await Prompt.countDocuments();
        const totalUsers = await User.countDocuments(); // Added User count
        const totalLikes = await Prompt.aggregate([{ $group: { _id: null, total: { $sum: '$likes' } } }]);
        res.json({ success: true, stats: { totalPrompts, totalUsers, totalLikes: totalLikes[0]?.total || 0 } });
    } catch (error) { res.status(500).json({ success: false }); }
});

// ========== SERVE HTML ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
