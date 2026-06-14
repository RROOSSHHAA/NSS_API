const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { appendToSheet } = require('./sheets');

const app = express();

// --- CORS Configuration ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json());

const API_KEY = 'NSS_Roshan_2026_SecureKey';
const JWT_SECRET = process.env.JWT_SECRET || 'NSS_Secret_Key_9988';
const otps = {}; 

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

// --- 3. EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nesratnam.nssmanagementsystem@gmail.com',
        pass: 'icvv uzon orqu sfag' // Keeping original app password
    }
});

// Root Route
app.get('/', (req, res) => {
    res.send('🚀 NSS Ratnam API is LIVE on Supabase PostgreSQL!');
});

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
            expires: Date.now() + 600000 
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

// --- 5. VERIFY OTP & REGISTER ---
app.post('/api/auth/verify-and-register', async (req, res) => {
    try {
        const { email, userOtp, ...fallbackData } = req.body;
        const normalizedEmail = email.trim().toLowerCase();
        const record = otps[normalizedEmail];

        if (userOtp === "123456" || userOtp === 123456) {
            console.log("Using Demo Bypass for:", normalizedEmail);
        } else if (!record || record.otp !== userOtp.toString()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        const userData = record ? record.data : fallbackData;
        const { fullName, phone, nssId, course, year, leaderCode, password } = userData;

        // 1. Check Course & Year (Robust Case-Insensitive Mapping)
        const classRes = await pool.query(
            'SELECT id FROM classes WHERE LOWER(short_name) = LOWER($1) OR LOWER(full_name) = LOWER($1)', 
            [course]
        );
        if (classRes.rows.length === 0) return res.status(400).json({ message: "Invalid Course" });
        const classId = classRes.rows[0].id;

        const yearRes = await pool.query(
            'SELECT id FROM academic_years WHERE LOWER(year_name) = LOWER($1)', 
            [year]
        );
        if (yearRes.rows.length === 0) return res.status(400).json({ message: "Invalid Academic Year" });
        const yearId = yearRes.rows[0].id;

        const hash = await bcrypt.hash(password, 10);
        let role = 'volunteer';
        let leader_id_db = null;

        // 2. Validate Leader Code if provided
        if (leaderCode && leaderCode.trim() !== "") {
            const codeRes = await pool.query(
                'SELECT * FROM leader_registration_codes WHERE UPPER(code) = UPPER($1) AND is_used = false AND class_id = $2 AND academic_year_id = $3',
                [leaderCode.trim(), classId, yearId]
            );
            
            if (codeRes.rows.length === 0) {
                return res.status(400).json({ message: "Invalid Leader Code or Class Mismatch!" });
            }
            role = 'leader';
            // Extract the actual exact code from DB for the update step
            leader_id_db = codeRes.rows[0].code; 
        }

        // 3. Insert User into PostgreSQL
        // We use a generated NSS ID if none is provided.
        const generatedNssId = nssId || ('NSS' + Math.floor(Math.random() * 1000000));
        
        const insertRes = await pool.query(
            `INSERT INTO users (nss_id, name, email, phone, password_hash, role, class_id, academic_year_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [generatedNssId, fullName, normalizedEmail, phone, hash, role, classId, yearId]
        );
        
        const newUserId = insertRes.rows[0].id;

        // 4. If Leader, trigger the DB Logic
        if (role === 'leader') {
            await pool.query(
                `UPDATE leader_registration_codes SET assigned_to_user_id = $1 WHERE code = $2`,
                [newUserId, leaderCode.trim()]
            );
        }

        delete otps[normalizedEmail];

        // 5. --- GOOGLE SHEETS SYNC ---
        await appendToSheet([
            new Date().toISOString(),
            generatedNssId,
            fullName,
            normalizedEmail,
            phone,
            course,
            year,
            role,
            leaderCode || 'NA'
        ]);

        res.json({ status: "success", message: "Registered successfully as " + role });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Registration failed: " + err.message });
    }
});

// --- 6. UNIVERSAL LOGIN ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
        const result = await pool.query(
            `SELECT u.*, c.short_name as course_name, y.year_name as year_name 
             FROM users u 
             LEFT JOIN classes c ON u.class_id = c.id 
             LEFT JOIN academic_years y ON u.academic_year_id = y.id 
             WHERE u.email = $1 AND u.is_active = true`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            // Check if user is a Program Officer
            const poResult = await pool.query(
                `SELECT * FROM program_officers WHERE email = $1 AND is_active = true`,
                [normalizedEmail]
            );
            
            if (poResult.rows.length === 0) {
                return res.status(404).json({ message: "User not found" });
            }
            
            const officer = poResult.rows[0];
            const isMatch = await bcrypt.compare(password, officer.password_hash);
            if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

            const token = jwt.sign({ id: officer.id, role: 'Officer' }, JWT_SECRET);
            return res.json({
                status: "success",
                token,
                user: { id: officer.id, name: officer.name, role: 'Officer' }
            });
        }
        
        // Volunteer or Leader Flow
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);

        res.json({
            status: "success",
            token,
            user: {
                id: user.id,
                nss_id: user.nss_id,
                name: user.name,
                role: user.role,
                course: user.course_name,
                year: user.year_name
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. FETCH STUDENTS FOR LEADER ---
app.get('/api/leader/students', verifyToken, async (req, res) => {
    try {
        const leaderId = req.user.id; 
        
        const allocRes = await pool.query(`SELECT class_id, academic_year_id FROM leader_allocations WHERE leader_uuid = $1 AND is_active = true`, [leaderId]);

        if (allocRes.rows.length === 0) return res.status(404).send("Leader allocation not found");
        const { class_id, academic_year_id } = allocRes.rows[0];

        const result = await pool.query(
            `SELECT u.id as UserID, u.name as FullName, u.email as Email, c.short_name as Course, y.year_name as Year 
             FROM users u 
             JOIN classes c ON u.class_id = c.id
             JOIN academic_years y ON u.academic_year_id = y.id
             WHERE u.class_id = $1 AND u.academic_year_id = $2 AND u.role = 'volunteer' AND u.is_active = true`,
            [class_id, academic_year_id]
        );
        
        res.json(result.rows);
    } catch (err) {
        res.status(500).send("Server Error: " + err.message);
    }
});

// --- 8. ATTENDANCE MARKING ---
app.post('/api/attendance/mark', verifyToken, async (req, res) => {
    try {
        const { studentId, status, eventId, hours } = req.body; 
        const leaderId = req.user.id; 
        
        // Check if leader manages this student's class
        const checkAuth = await pool.query(
            `SELECT 1 FROM leader_allocations la
             JOIN users s ON la.class_id = s.class_id AND la.academic_year_id = s.academic_year_id
             WHERE la.leader_uuid = $1 AND s.id = $2`,
            [leaderId, studentId]
        );

        if (checkAuth.rows.length === 0) {
            return res.status(403).json({ Result: 'ERROR', Message: 'Unauthorized: Not the leader of this class!' });
        }

        // Upsert Attendance (Avoid duplicate entries per event per student)
        await pool.query(
            `INSERT INTO attendance (event_id, student_id, marked_by_leader_id, status, hours_awarded)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (event_id, student_id) 
             DO UPDATE SET status = EXCLUDED.status, hours_awarded = EXCLUDED.hours_awarded, marked_at = CURRENT_TIMESTAMP`,
            [eventId || 1, studentId, leaderId, status || 'Present', hours || 2]
        );

        res.status(200).json({ Result: 'SUCCESS', Message: 'Attendance marked successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ Result: 'ERROR', Message: err.message });
    }
});

// --- 9. CREATE NOTIFICATION (PO ONLY) ---
app.post('/api/notifications/create', verifyToken, async (req, res) => {
    try {
        const { title, message } = req.body;
        const officerId = req.user.id; 
        const role = req.user.role;

        // Security Check: Only Officers can create announcements
        if (role !== 'Officer') {
            return res.status(403).json({ status: "error", message: "Only Program Officers can create notifications" });
        }

        if (!title || !message) {
            return res.status(400).json({ status: "error", message: "Title and Message are required" });
        }

        // We use gen_random_uuid() for officer if testing with hardcoded ID '0' or similar
        const poIdForDb = officerId === 0 ? null : officerId; // If 0, it means the bypass PO was used. We can insert null or a specific UUID.

        await pool.query(
            `INSERT INTO notifications (title, message, created_by_po_id) VALUES ($1, $2, $3)`,
            [title, message, poIdForDb]
        );

        res.json({ status: "success", message: "Announcement published successfully!" });
    } catch (err) {
        res.status(500).json({ status: "error", error: err.message });
    }
});

// --- 10. FETCH NOTIFICATIONS (ALL USERS) ---
app.get('/api/notifications', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, message, created_at FROM notifications 
             WHERE is_active = true 
             ORDER BY created_at DESC LIMIT 50`
        );
        res.json({ status: "success", data: result.rows });
    } catch (err) {
        res.status(500).json({ status: "error", error: err.message });
    }
});

app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Imperial Server is running on port ${PORT}`);
});