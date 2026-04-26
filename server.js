require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CORS - TOP LEVEL (CRITICAL FOR MOBILE APP) ==========
app.use(cors({
    origin: true, // Allows any origin (Render, localhost, mobile app)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 30 * 60 * 1000 }
}));

// ========== MONGODB CONNECTION (YOUR CREDENTIALS) ==========
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://souvik_admin:hwWiy9Uzxx756zqO@cluster0.cll1rp4.mongodb.net/prompt_studio?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected Successfully!'))
.catch(err => console.error('❌ MongoDB Error:', err));

// ========== PROMPT SCHEMA (SIMPLIFIED FOR FRONTEND) ==========
const promptSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, required: true, default: 'General' },
    prompt: { type: String, required: true },
    imageUrl: { type: String, default: 'https://picsum.photos/400/300' },
    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'hidden'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const Prompt = mongoose.model('Prompt', promptSchema);

// ========== USER SCHEMA (FOR ADMIN PANEL) ==========
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    deviceId: { type: String },
    deviceModel: { type: String },
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ========== TRANSACTION SCHEMA ==========
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userEmail: { type: String },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['success', 'failed', 'pending'], default: 'pending' },
    transactionId: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// ========== ADMIN SESSION SCHEMA ==========
const adminSessionSchema = new mongoose.Schema({
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 1800 }
});

const AdminSession = mongoose.model('AdminSession', adminSessionSchema);

// ========== AUTH MIDDLEWARE ==========
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    try {
        const session = await AdminSession.findOne({ token });
        if (!session) {
            return res.status(401).json({ success: false, error: 'Session expired' });
        }
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

// ========== FRONTEND API ROUTES (MATCHES YOUR index.html) ==========

// GET /api/prompts - Returns prompts in format { success: true, prompts: [...] }
app.get('/api/prompts', async (req, res) => {
    try {
        const prompts = await Prompt.find({ status: 'active' })
            .sort({ createdAt: -1 })
            .lean();
        
        console.log(`✅ Fetched ${prompts.length} active prompts`);
        
        // ✅ CRITICAL: Return format matches frontend expectation (data.prompts)
        res.json({
            success: true,
            prompts: prompts
        });
    } catch (error) {
        console.error('Error fetching prompts:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch prompts',
            prompts: [] 
        });
    }
});

// POST /api/prompt/like - Increment like count
app.post('/api/prompt/like', async (req, res) => {
    try {
        const { id } = req.body;
        const prompt = await Prompt.findByIdAndUpdate(
            id,
            { $inc: { likes: 1 } },
            { new: true }
        );
        if (!prompt) {
            return res.status(404).json({ success: false, error: 'Prompt not found' });
        }
        res.json({ success: true, likes: prompt.likes });
    } catch (error) {
        console.error('Error updating like:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/prompt/view - Increment view count
app.post('/api/prompt/view', async (req, res) => {
    try {
        const { id } = req.body;
        const prompt = await Prompt.findByIdAndUpdate(
            id,
            { $inc: { views: 1 } },
            { new: true }
        );
        if (!prompt) {
            return res.status(404).json({ success: false, error: 'Prompt not found' });
        }
        res.json({ success: true, views: prompt.views });
    } catch (error) {
        console.error('Error updating view:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/categories - Get all unique categories
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await Prompt.distinct('category');
        res.json({ success: true, categories: ['All', ...categories.sort()] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADMIN AUTH ROUTES ==========
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@promptstudio.com';
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@2025';
        
        if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ email }, process.env.JWT_SECRET || 'secret-key', { expiresIn: '30m' });
        await AdminSession.create({ token });
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/logout', authenticateAdmin, async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    await AdminSession.deleteOne({ token });
    res.json({ success: true });
});

// ========== ADMIN PROMPT MANAGEMENT ==========
app.get('/api/admin/prompts', authenticateAdmin, async (req, res) => {
    try {
        const prompts = await Prompt.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, prompts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/prompts', authenticateAdmin, async (req, res) => {
    try {
        const { title, category, prompt, imageUrl, adminKey } = req.body;
        
        // Admin key validation (from your requirement)
        if (adminKey !== 'hwWiy9Uzxx756zqO') {
            return res.status(401).json({ success: false, error: 'Invalid admin key' });
        }
        
        const newPrompt = await Prompt.create({
            title,
            category: category || 'General',
            prompt,
            imageUrl: imageUrl || 'https://picsum.photos/400/300',
            status: 'active'
        });
        
        res.json({ success: true, prompt: newPrompt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/prompts/:id', authenticateAdmin, async (req, res) => {
    try {
        const { title, category, prompt, imageUrl, status } = req.body;
        const updated = await Prompt.findByIdAndUpdate(req.params.id, 
            { title, category, prompt, imageUrl, status }, 
            { new: true }
        );
        res.json({ success: true, prompt: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/prompts/:id', authenticateAdmin, async (req, res) => {
    try {
        await Prompt.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADMIN USER MANAGEMENT ==========
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/block', authenticateAdmin, async (req, res) => {
    try {
        const { userId, action } = req.body;
        await User.findByIdAndUpdate(userId, { status: action === 'block' ? 'blocked' : 'active' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/premium', authenticateAdmin, async (req, res) => {
    try {
        const { userId, duration } = req.body;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + (duration || 30));
        await User.findByIdAndUpdate(userId, { plan: 'premium', premiumExpiry: expiryDate });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADMIN TRANSACTIONS ==========
app.get('/api/admin/transactions', authenticateAdmin, async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(50).lean();
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADMIN STATS ==========
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const totalPrompts = await Prompt.countDocuments();
        const totalUsers = await User.countDocuments();
        const premiumUsers = await User.countDocuments({ plan: 'premium' });
        
        res.json({
            success: true,
            stats: {
                totalPrompts,
                totalUsers,
                premiumUsers,
                conversionRate: totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== START SERVER ==========
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Main API: http://localhost:${PORT}/api/prompts`);
    console.log(`🔐 Admin Login: ${process.env.ADMIN_EMAIL || 'admin@promptstudio.com'}`);
    console.log(`\n✅ CORS enabled for all origins`);
    console.log(`✅ MongoDB connected to: prompt_studio`);
});
