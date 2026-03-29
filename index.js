const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();

// --- CORS Configuration ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json());

const API_KEY = 'NSS_Roshan_2026_SecureKey';
const JWT_SECRET = 'NSS_Secret_Key_9988';
const otps = {}; 

// --- 1. DATABASE CONFIGURATION (AWS RDS) ---
const dbConfig = {
    user: 'admin',
    password: '74Hfuryqe2xu6UN',
    server: 'nssmemberdb.c1u4mw8s0xrb.us-east-2.rds.amazonaws.com',
    database: 'NSS_Ratnam_DB',
    options: {
        encrypt: true,
        trustServerCertificate: true,
        connectTimeout: 30000 
    }
};

const poolPromise = new sql.ConnectionPool(dbConfig).connect()
    .then(pool => {
        console.log('✅ Connected to RDS (MSSQL) Successfully!');
        return pool;
    })
    .catch(err => console.log('❌ DB Connection Failed:', err.message));

// --- 2. AUTH MIDDLEWARE ---
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).send("Token required");
    try {
        const bearer = token.split(" ")[1];
        const decoded = jwt.verify(bearer, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).send("Invalid Token");
    }
}

// --- 3. EMAIL SETUP (Nodemailer) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nesratnam.nssmanagementsystem@gmail.com',
        pass: 'icvv uzon orqu sfag'
    }
});

app.get('/', (req, res) => res.send('NSS Master API is LIVE on New Server!'));

// --- 4. SEND OTP ROUTE ---
app.post('/api/auth/send-otp', async (req, res) => {
    if (req.headers['x-api-key'] !== API_KEY) return res.status(401).send("Unauthorized");

    try {
        const { email, ...registrationData } = req.body;
        if (!email) return res.status(400).send("Email is required");

        const normalizedEmail = email.trim().toLowerCase();
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        otps[normalizedEmail] = {
            otp,
            data: registrationData,
            expires: Date.now() + 600000 // 10 mins
        };

        await transporter.sendMail({
            from: '"NSS Ratnam" <nesratnam.nssmanagementsystem@gmail.com>',
            to: normalizedEmail,
            subject: 'Registration OTP - NSS Ratnam',
            html: `<h3>Welcome to NSS!</h3><p>Your verification code is: <b>${otp}</b></p>`
        });
        res.json({ status: "success", message: "OTP Sent!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. VERIFY OTP & REGISTER (Updated with Leader Logic) ---
app.post('/api/auth/verify-and-register', async (req, res) => {
    try {
        const { email, userOtp, ...fallbackData } = req.body;
        const normalizedEmail = email.trim().toLowerCase();
        const record = otps[normalizedEmail];

        // DEMO BYPASS for Presentation
        if (userOtp === "123456" || userOtp === 123456) {
            console.log("Using Demo Bypass for:", normalizedEmail);
        } else if (!record || record.otp !== userOtp.toString()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        const pool = await poolPromise;
        const userData = record ? record.data : fallbackData;
        
        const { fullName, phone, dob, gender, bloodGroup, batch, year, leaderCode, password, caste, department, course } = userData;

        // Fetch GroupID logic
        let groupId = null;
        const groupRes = await pool.request()
            .input('BN', batch)
            .input('YN', year)
            .query(`SELECT g.GroupID FROM dbo.Groups g 
                    JOIN dbo.Batches b ON g.BatchID = b.BatchID 
                    WHERE b.BatchName = @BN AND g.YearName = @YN`);

        if (groupRes.recordset.length > 0) {
            groupId = groupRes.recordset[0].GroupID;
        }

        // --- LEADER VERIFICATION LOGIC ---
        let role = 'Member';
        if (leaderCode && leaderCode.trim() !== "" && groupId) {
            const lCheck = await pool.request()
                .input('Code', leaderCode)
                .input('GID', groupId)
                .query(`SELECT * FROM LeaderConfig WHERE ClassLeaderKey = @Code AND GroupID = @GID AND UsageCount < MaxUsage`);
            
            if (lCheck.recordset.length > 0) {
                role = 'Leader';
                await pool.request()
                    .input('ID', lCheck.recordset[0].LeaderCodeID)
                    .query(`UPDATE LeaderConfig SET UsageCount += 1 WHERE LeaderCodeID = @ID`);
            } else {
                return res.status(400).json({ message: "Invalid Leader Code or Class Mismatch!" });
            }
        }

        const hash = await bcrypt.hash(password, 10);

        await pool.request()
            .input('N', fullName)
            .input('E', normalizedEmail)
            .input('P', phone)
            .input('D', dob)
            .input('G', gender)
            .input('B', bloodGroup)
            .input('R', role)
            .input('GID', groupId)
            .input('Pass', hash)
            .input('C', caste)
            .input('Dept', department)
            .input('Course', course)
            .query(`INSERT INTO AppUsers (FullName, Email, Phone, DOB, Gender, BloodGroup, UserRole, GroupID, Password, Caste, Department, Course) 
                    VALUES (@N, @E, @P, @D, @G, @B, @R, @GID, @Pass, @C, @Dept, @Course)`);

        delete otps[normalizedEmail];
        res.json({ status: "success", message: "Registered successfully as " + role });

    } catch (err) {
        console.error("Registration Error:", err.message);
        res.status(500).json({ error: "DB Error: " + err.message });
    }
});

// --- 6. LEADER'S STUDENT LIST (Fetching students of the same class) ---
app.get('/api/leader/students', verifyToken, async (req, res) => {
    try {
        const leaderId = req.user.id; 
        const pool = await poolPromise;
        
        const leaderData = await pool.request()
            .input('LID', leaderId)
            .query(`SELECT GroupID FROM AppUsers WHERE UserID = @LID`);

        if (leaderData.recordset.length === 0) return res.status(404).send("Leader not found");
        
        const gID = leaderData.recordset[0].GroupID;

        const result = await pool.request()
            .input('gid', gID)
            .input('lid', leaderId)
            .query(`
                SELECT UserID, FullName, Email, Course, Department 
                FROM dbo.AppUsers 
                WHERE GroupID = @gid AND UserRole = 'Member' AND UserID != @lid
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send("Server Error: " + err.message);
    }
});

// --- 7. UNIVERSAL LOGIN ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === 'sharwarinarvekar812@gmail.com' && password === 'Shar@123') {
        const token = jwt.sign({ id: 0, role: 'Officer' }, JWT_SECRET);
        return res.json({ status: "success", token, user: { id: 0, name: "Sharwari Narvekar", role: "Officer" } });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('E', normalizedEmail)
            .query(`SELECT u.*, g.YearName, b.BatchName FROM AppUsers u 
                    LEFT JOIN Groups g ON u.GroupID = g.GroupID 
                    LEFT JOIN Batches b ON g.BatchID = b.BatchID WHERE u.Email = @E`);

        if (result.recordset.length === 0) return res.status(404).json({ message: "User not found" });
        
        const user = result.recordset[0];
        const isMatch = await bcrypt.compare(password, user.Password);
        
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        const token = jwt.sign({ id: user.UserID, role: user.UserRole }, JWT_SECRET);

        res.json({
            status: "success",
            token,
            user: {
                id: user.UserID,
                name: user.FullName,
                role: user.UserRole,
                groupId: user.GroupID,
                batch: user.BatchName,
                year: user.YearName
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 8. ATTENDANCE MARKING ---
app.post('/api/attendance/mark', verifyToken, async (req, res) => {
    try {
        const { studentId, status } = req.body; 
        const leaderId = req.user.id; 

        const pool = await poolPromise;
        const result = await pool.request()
            .input('leaderId', sql.Int, leaderId)
            .input('studentId', sql.Int, studentId)
            .input('status', sql.NVarChar, status)
            .query(`
                IF EXISTS (
                    SELECT 1 FROM dbo.AppUsers L, dbo.AppUsers S
                    WHERE L.UserID = @leaderId AND S.UserID = @studentId
                      AND L.GroupID = S.GroupID
                      AND L.UserRole = 'Leader'
                )
                BEGIN
                    INSERT INTO dbo.Attendance (StudentID, Status, MarkedBy, AttendanceDate)
                    VALUES (@studentId, @status, @leaderId, CAST(GETDATE() AS DATE));
                    SELECT 'SUCCESS' AS Result, 'Attendance marked successfully!' AS Message;
                END
                ELSE
                BEGIN
                    SELECT 'ERROR' AS Result, 'Unauthorized: Class mismatch or you are not a Leader!' AS Message;
                END
            `);

        const response = result.recordset[0];
        res.status(response.Result === 'SUCCESS' ? 200 : 403).json(response);
    } catch (err) {
        res.status(500).json({ Result: 'ERROR', Message: err.message });
    }
});

// --- 9. PRODUCTION SETUP & EXPOSE ---
app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 10000; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});