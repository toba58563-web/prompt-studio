// init-admin.js - Run this once to create admin user in MongoDB
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = 'mongodb+srv://souvik_admin:hwWiy9Uzxx756zqO@cluster0.cll1rp4.mongodb.net/prompt_studio?retryWrites=true&w=majority';

const adminSchema = new mongoose.Schema({
    email: String,
    password: String,
    name: String,
    role: String
});

const Admin = mongoose.model('Admin', adminSchema);

async function init() {
    await mongoose.connect(MONGODB_URI);
    
    const hashedPassword = await bcrypt.hash('Admin@2025', 10);
    
    await Admin.findOneAndUpdate(
        { email: 'admin@promptstudio.com' },
        { 
            email: 'admin@promptstudio.com',
            password: hashedPassword,
            name: 'Super Admin',
            role: 'admin'
        },
        { upsert: true }
    );
    
    console.log('✅ Admin user created/updated');
    process.exit();
}

init();
