require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static('public'));

// ========== MONGODB CONNECTION ==========
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://souvik_admin:hwWiy9Uzxx756zqO@cluster0.cll1rp4.mongodb.net/prompt_studio?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// ========== ADMIN USER SCHEMA ==========
const adminUserSchema = new mongoose.Schema({
    name: { type: String, default: 'Admin' },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'admin' },
    createdAt: { type: Date, default: Date.now },
    lastPasswordChange: { type: Date, default: Date.now }
});

const AdminUser = mongoose.model('AdminUser', adminUserSchema);

// ========== INITIALIZE DEFAULT ADMIN (Run once) ==========
async function initializeAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@promptstudio.com';
    const existingAdmin = await AdminUser.findOne({ email: adminEmail });
    
    if (!existingAdmin) {
        const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@2025';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        
        await AdminUser.create({
            email: adminEmail,
            password: hashedPassword,
            name: 'Super Admin'
        });
        console.log('✅ Default admin user created');
    }
}

// ========== AUTH MIDDLEWARE ==========
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key');
        const admin = await AdminUser.findById(decoded.userId).select('-password');
        
        if (!admin) {
            return res.status(401).json({ success: false, error: 'Admin not found' });
        }
        
        req.admin = admin;
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

// ========== ADMIN LOGIN (Checks MongoDB) ==========
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find admin in database
        const admin = await AdminUser.findOne({ email: email });
        
        if (!admin) {
            return res.status(401).json({ success: false, error: 'Admin not found' });
        }
        
        // Compare password with hashed password in MongoDB
        const isValidPassword = await bcrypt.compare(password, admin.password);
        
        if (!isValidPassword) {
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: admin._id, email: admin.email, role: admin.role },
            process.env.JWT_SECRET || 'secret-key',
            { expiresIn: '30m' }
        );
        
        res.json({
            success: true,
            token: token,
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== CHANGE PASSWORD API ==========
app.post('/api/admin/change-password', authenticateAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        // Get current admin from database with password
        const admin = await AdminUser.findById(req.admin._id);
        
        if (!admin) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }
        
        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, admin.password);
        
        if (!isValidPassword) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }
        
        // Validate new password strength
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }
        
        // Hash new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        
        // Update password in database
        admin.password = hashedNewPassword;
        admin.lastPasswordChange = new Date();
        await admin.save();
        
        console.log(`✅ Password changed for admin: ${admin.email}`);
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
        
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GET ADMIN PROFILE ==========
app.get('/api/admin/profile', authenticateAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            admin: {
                id: req.admin._id,
                name: req.admin.name,
                email: req.admin.email,
                role: req.admin.role,
                lastPasswordChange: req.admin.lastPasswordChange
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== PROMPT SCHEMA (Your existing) ==========
const promptSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, required: true },
    prompt: { type: String, required: true },
    imageUrl: { type: String, default: 'https://picsum.photos/400/300' },
    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const Prompt = mongoose.model('Prompt', promptSchema);

// ========== EXISTING API ROUTES ==========
app.get('/api/prompts', async (req, res) => {
    try {
        const prompts = await Prompt.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, prompts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/prompts', authenticateAdmin, async (req, res) => {
    try {
        const { title, category, prompt, imageUrl } = req.body;
        const newPrompt = await Prompt.create({ title, category, prompt, imageUrl });
        res.json({ success: true, prompt: newPrompt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== START SERVER ==========
app.listen(PORT, async () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔐 Admin Login: http://localhost:${PORT}/admin.html`);
    await initializeAdmin(); // Create default admin if not exists
});
