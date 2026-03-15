const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const sequelize = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Email Transporter Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Test Route
app.get('/', (req, res) => res.send('NSS Node API is Live and Running!'));

// API to Send Email (C# logic converted)
app.post('/api/send-email', async (req, res) => {
    const { to, subject, message } = req.body;

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        text: message
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Email sent successfully!' });
    } catch (error) {
        console.error('Email Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 8080;

sequelize.authenticate()
    .then(() => {
        console.log('✅ Database Connected!');
        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    })
    .catch(err => {
        console.error('❌ DB Connection Error:', err);
    });