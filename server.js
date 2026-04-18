require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const Prompt = require('./models/Prompt');

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
    console.log('📀 Database: prompt_studio');
})
.catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
});

// ========== API ROUTES ==========

// Get all prompts (with filters)
app.get('/api/prompts', async (req, res) => {
    try {
        const { category, search, limit = 50 } = req.query;
        let filter = {};
        
        if (category && category !== 'All') {
            filter.category = category;
        }
        
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { prompt: { $regex: search, $options: 'i' } }
            ];
        }
        
        const prompts = await Prompt.find(filter)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));
        
        res.json({ success: true, prompts });
    } catch (error) {
        console.error('Error fetching prompts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single prompt
app.get('/api/prompt/:id', async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);
        if (!prompt) {
            return res.status(404).json({ success: false, error: 'Prompt not found' });
        }
        res.json({ success: true, prompt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add new prompt (Admin)
app.post('/api/admin/prompts', async (req, res) => {
    try {
        const { title, category, prompt, imageUrl, adminKey } = req.body;
        
        // Simple admin authentication
        if (adminKey !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        
        const newPrompt = new Prompt({
            title,
            category,
            prompt,
            imageUrl: imageUrl || 'https://picsum.photos/400/300'
        });
        
        await newPrompt.save();
        res.json({ success: true, prompt: newPrompt });
    } catch (error) {
        console.error('Error adding prompt:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update prompt views
app.post('/api/prompt/view', async (req, res) => {
    try {
        const { id } = req.body;
        await Prompt.findByIdAndUpdate(id, { $inc: { views: 1 } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Like prompt
app.post('/api/prompt/like', async (req, res) => {
    try {
        const { id } = req.body;
        await Prompt.findByIdAndUpdate(id, { $inc: { likes: 1 } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get categories stats
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

// Get total stats
app.get('/api/stats', async (req, res) => {
    try {
        const totalPrompts = await Prompt.countDocuments();
        const totalLikes = await Prompt.aggregate([{ $group: { _id: null, total: { $sum: '$likes' } } }]);
        const totalViews = await Prompt.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]);
        
        res.json({
            success: true,
            stats: {
                totalPrompts,
                totalLikes: totalLikes[0]?.total || 0,
                totalViews: totalViews[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start server
// Database se saare prompts fetch karne ka rasta
app.get('/api/prompts', async (req, res) => {
    try {
        const prompts = await Prompt.find().sort({ createdAt: -1 });
        res.json(prompts);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Main App: http://localhost:${PORT}`);
    console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`\n⚡ Admin Credentials:`);
    console.log(`   Password: ${process.env.ADMIN_PASSWORD}`);
});
