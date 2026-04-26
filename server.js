require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 30 * 60 * 1000 } // 30 minutes
}));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('MongoDB Error:', err));

// ========== SCHEMAS ==========

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    deviceId: { type: String },
    deviceModel: { type: String },
    ipAddress: { type: String },
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    premiumExpiry: { type: Date },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date }
});

// Prompt Schema
const promptSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, required: true },
    prompt: { type: String, required: true },
    imageUrl: { type: String, default: 'https://picsum.photos/400/300' },
    status: { type: String, enum: ['active', 'hidden', 'pending'], default: 'active' },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// Transaction Schema
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userEmail: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['success', 'failed', 'pending'], default: 'pending' },
    paymentMethod: { type: String, enum: ['stripe', 'razorpay', 'manual'], default: 'stripe' },
    planType: { type: String, enum: ['monthly', 'yearly', 'lifetime'], default: 'monthly' },
    transactionId: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now }
});

// App Config Schema
const appConfigSchema = new mongoose.Schema({
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: 'App is under maintenance. Please check back later.' },
    adSettings: {
        bannerAds: { type: Boolean, default: true },
        interstitialAds: { type: Boolean, default: true },
        rewardAds: { type: Boolean, default: true }
    },
    updateSettings: {
        minVersion: { type: String, default: '1.0.0' },
        updateUrl: { type: String, default: '' },
        forceUpdate: { type: Boolean, default: false }
    },
    updatedAt: { type: Date, default: Date.now }
});

// Analytics Schema
const analyticsSchema = new mongoose.Schema({
    date: { type: Date, required: true, unique: true },
    downloads: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 }
});

// Admin Session
const adminSessionSchema = new mongoose.Schema({
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 1800 } // 30 minutes expiry
});

const User = mongoose.model('User', userSchema);
const Prompt = mongoose.model('Prompt', promptSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const AppConfig = mongoose.model('AppConfig', appConfigSchema);
const Analytics = mongoose.model('Analytics', analyticsSchema);
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

// ========== AUTH ROUTES ==========
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '30m' });
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

app.get('/api/admin/check-session', authenticateAdmin, async (req, res) => {
    res.json({ success: true });
});

// ========== DASHBOARD STATS ==========
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const [totalDownloads, activeUsers24h, totalRevenue, totalUsers, premiumUsers] = await Promise.all([
            Analytics.aggregate([{ $group: { _id: null, total: { $sum: '$downloads' } } }]),
            Analytics.findOne({ date: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
            Transaction.aggregate([{ $match: { status: 'success' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
            User.countDocuments(),
            User.countDocuments({ plan: 'premium', premiumExpiry: { $gt: new Date() } })
        ]);
        
        const conversionRate = totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : 0;
        
        res.json({
            success: true,
            stats: {
                totalDownloads: totalDownloads[0]?.total || 0,
                activeUsers24h: activeUsers24h?.activeUsers || 0,
                totalRevenue: totalRevenue[0]?.total || 0,
                conversionRate: parseFloat(conversionRate),
                totalUsers,
                premiumUsers
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== USER GROWTH CHART (7 Days) ==========
app.get('/api/admin/user-growth', authenticateAdmin, async (req, res) => {
    try {
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            last7Days.push(date);
        }
        
        const growthData = await Promise.all(last7Days.map(async (date) => {
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            const count = await User.countDocuments({
                createdAt: { $gte: date, $lt: nextDate }
            });
            return { date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count };
        }));
        
        res.json({ success: true, data: growthData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== USER MANAGEMENT ==========
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
        const { userId, action } = req.body; // action: 'block' or 'unblock'
        await User.findByIdAndUpdate(userId, { status: action === 'block' ? 'blocked' : 'active' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/reset-password', authenticateAdmin, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(userId, { password: hashedPassword });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/premium', authenticateAdmin, async (req, res) => {
    try {
        const { userId, planType, duration } = req.body; // duration in days
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + duration);
        
        await User.findByIdAndUpdate(userId, { plan: 'premium', premiumExpiry: expiryDate });
        
        // Create transaction record
        await Transaction.create({
            userId,
            userEmail: req.body.userEmail,
            amount: planType === 'monthly' ? 9.99 : planType === 'yearly' ? 99.99 : 199.99,
            status: 'success',
            paymentMethod: 'manual',
            planType,
            transactionId: `MANUAL_${Date.now()}`
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== TRANSACTIONS ==========
app.get('/api/admin/transactions', authenticateAdmin, async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(50).lean();
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/subscription-stats', authenticateAdmin, async (req, res) => {
    try {
        const premiumUsers = await User.find({ plan: 'premium', premiumExpiry: { $gt: new Date() } }).select('name email premiumExpiry').lean();
        const freeUsers = await User.countDocuments({ plan: 'free' });
        
        res.json({
            success: true,
            stats: {
                premium: premiumUsers,
                premiumCount: premiumUsers.length,
                freeCount: freeUsers
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== PROMPT MANAGEMENT ==========
app.get('/api/admin/prompts', authenticateAdmin, async (req, res) => {
    try {
        const prompts = await Prompt.find().sort({ createdAt: -1 }).populate('submittedBy', 'name email').lean();
        res.json({ success: true, prompts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/prompts', authenticateAdmin, async (req, res) => {
    try {
        const { title, category, prompt, imageUrl, status } = req.body;
        const newPrompt = await Prompt.create({ title, category, prompt, imageUrl, status });
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

// ========== APP CONFIGURATION ==========
app.get('/api/admin/config', authenticateAdmin, async (req, res) => {
    try {
        let config = await AppConfig.findOne();
        if (!config) {
            config = await AppConfig.create({});
        }
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/config', authenticateAdmin, async (req, res) => {
    try {
        const { maintenanceMode, maintenanceMessage, adSettings, updateSettings } = req.body;
        let config = await AppConfig.findOne();
        if (!config) {
            config = new AppConfig();
        }
        
        config.maintenanceMode = maintenanceMode;
        if (maintenanceMessage) config.maintenanceMessage = maintenanceMessage;
        if (adSettings) config.adSettings = adSettings;
        if (updateSettings) config.updateSettings = updateSettings;
        config.updatedAt = new Date();
        
        await config.save();
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== USER-SUBMITTED PROMPTS ==========
app.get('/api/admin/pending-prompts', authenticateAdmin, async (req, res) => {
    try {
        const pendingPrompts = await Prompt.find({ status: 'pending' }).populate('submittedBy', 'name email').lean();
        res.json({ success: true, prompts: pendingPrompts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/approve-prompt/:id', authenticateAdmin, async (req, res) => {
    try {
        const { action } = req.body; // 'approve' or 'reject'
        await Prompt.findByIdAndUpdate(req.params.id, { status: action === 'approve' ? 'active' : 'hidden' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Admin Dashboard running on http://localhost:${PORT}`);
    console.log(`🔐 Admin Login: ${process.env.ADMIN_EMAIL}`);
});
