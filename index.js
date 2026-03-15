const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = 'NSS_Roshan_2026_SecureKey';
const otps = {}; // Temporary storage for OTPs

// --- 1. DATABASE CONFIGURATION ---
const dbConfig = {
    user: 'admin',
    password: '74Hfuryqe2xu6UN',
    server: 'nssmemberdb.c1u4mw8s0xrb.us-east-2.rds.amazonaws.com',
    database: 'NSS_Ratnam_DB',
    options: { 
        encrypt: true, 
        trustServerCertificate: true 
    }
};

// Database Connection Pool
const poolPromise = new sql.ConnectionPool(dbConfig).connect()
    .then(pool => { 
        console.log('✅ Connected to RDS (MSSQL) Successfully!'); 
        return pool; 
    })
    .catch(err => console.log('❌ DB Connection Failed:', err.message));

// --- 2. EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
        user: 'nesratnam.nssmanagementsystem@gmail.com', 
        pass: 'icvv uzon orqu sfag' 
    }
});

app.get('/', (req, res) => res.send('NSS Master API is LIVE!'));

// --- 3. SEND OTP ROUTE ---
app.post('/api/auth/send-otp', async (req, res) => {
    if (req.headers['x-api-key'] !== API_KEY) return res.status(401).send("Unauthorized");
    
    const { email, ...registrationData } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const normalizedEmail = email.trim().toLowerCase();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    otps[normalizedEmail] = { 
        otp, 
        data: registrationData, 
        expires: Date.now() + 600000 
    };

    try {
        await transporter.sendMail({
            from: '"NSS Ratnam" <nesratnam.nssmanagementsystem@gmail.com>',
            to: normalizedEmail,
            subject: 'Registration OTP - NSS Ratnam',
            html: `<h3>Welcome to NSS!</h3><p>Your verification code is: <b style="font-size: 20px;">${otp}</b></p>`
        });
        res.json({ status: "success", message: "OTP Sent!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. VERIFY OTP & REGISTER ---
app.post('/api/auth/verify-and-register', async (req, res) => {
    const { email, userOtp } = req.body;
    const normalizedEmail = email.trim().toLowerCase();
    const record = otps[normalizedEmail];

    if (!record || record.otp !== userOtp.toString()) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    try {
        const pool = await poolPromise;
        const { fullName, phone, dob, gender, bloodGroup, batch, year, leaderCode, password, caste, department, course } = record.data;

        const groupRes = await pool.request()
            .input('BN', batch).input('YN', year)
            .query(`SELECT g.GroupID FROM dbo.Groups g 
                    JOIN Batches b ON g.BatchID = b.BatchID 
                    WHERE b.BatchName = @BN AND g.YearName = @YN`);

        if (groupRes.recordset.length === 0) return res.status(400).json({ message: "Selected Batch/Year not found." });
        
        const groupId = groupRes.recordset[0].GroupID;
        let role = 'Member';

        if (leaderCode && leaderCode.trim() !== "") {
            const lCheck = await pool.request().input('Code', leaderCode).input('GID', groupId)
                .query(`SELECT * FROM LeaderConfig WHERE ClassLeaderKey = @Code AND GroupID = @GID AND UsageCount < MaxUsage`);
            if (lCheck.recordset.length > 0) {
                role = 'Leader';
                await pool.request().input('ID', lCheck.recordset[0].LeaderCodeID).query(`UPDATE LeaderConfig SET UsageCount += 1 WHERE LeaderCodeID = @ID`);
            }
        }

        const hash = await bcrypt.hash(password, 10);
        await pool.request()
            .input('N', fullName).input('E', normalizedEmail).input('P', phone).input('D', dob).input('G', gender)
            .input('B', bloodGroup).input('R', role).input('GID', groupId).input('Pass', hash)
            .input('C', caste).input('Dept', department).input('Course', course)
            .query(`INSERT INTO AppUsers (FullName, Email, Contact, DOB, Gender, BloodGroup, UserRole, GroupID, Password, UserStatus, Caste, Department, Course) 
                    VALUES (@N, @E, @P, @D, @G, @B, @R, @GID, @Pass, 'Active', @C, @Dept, @Course)`);

        delete otps[normalizedEmail];
        res.json({ status: "success", message: "Registered successfully as " + role });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. UNIVERSAL LOGIN ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === 'sharwarinarvekar812@gmail.com' && password === 'Shar@123') {
        return res.json({ status: "success", user: { id: 0, name: "Sharwari Narvekar", role: "Officer", groupId: null } });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request().input('E', normalizedEmail)
            .query(`SELECT u.*, g.YearName, b.BatchName FROM AppUsers u 
                    LEFT JOIN Groups g ON u.GroupID = g.GroupID 
                    LEFT JOIN Batches b ON g.BatchID = b.BatchID WHERE u.Email = @E`);

        if (result.recordset.length === 0) return res.status(404).json({ message: "User not found" });
        const user = result.recordset[0];

        const isMatch = await bcrypt.compare(password, user.Password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        res.json({ status: "success", user: { id: user.UserID, name: user.FullName, role: user.UserRole, groupId: user.GroupID, batch: user.BatchName, year: user.YearName } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Port configuration for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Master API Server running on port ${PORT}`));