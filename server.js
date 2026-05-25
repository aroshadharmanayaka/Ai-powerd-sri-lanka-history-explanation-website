const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const cors = require('cors');
const path = require('path');
const wav = require('wav');
const argon2 = require('argon2');
const jwt = require("jsonwebtoken");
const cookieParser = require('cookie-parser');

require('dotenv').config()

const app = express(); // app 

app.use(express.json());
app.use(cors({
    credentials: true
}));

//  HTML 
app.use(express.static('public'));
app.use(cookieParser())

let db;

// Database 
(async () => {
    db = await open({
        filename: './lionlanka.db',
        driver: sqlite3.Database
    });

    // Users save
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);
    console.log("Database & Table Ready!");
})();


const verifyToken = (req, res, next) => {
    const token = req.cookies.auth_token
    if (!token) {
        return res.status(401).json({ success: false, message: "Unauthorized" })
    }
    try {
        jwt.verify(token, process.env.JWT_HASH_SECRET)
    } catch (e) {
        return res.status(401).json({success:false,message:"Invalid JWT"})
    }
    next()
}


app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await argon2.hash(password, { secret: Buffer.from(process.env.PASSWORD_HASH_SECRET) })
        await db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        res.json({ success: true });
    } catch (err) {
        console.log(err)
        res.json({ success: false, message: "Username exists!" });
    }
});


app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (user) {
        const isValidPassword = await argon2.verify(user.password, password, { secret: Buffer.from(process.env.PASSWORD_HASH_SECRET) })
        if (!isValidPassword) {
            res.status(401).json({ success: false, message: "Invalid username or password" })
        } else {
            const { username, id } = user
            const jwtUser = { username, id }
            const token = jwt.sign(jwtUser, process.env.JWT_HASH_SECRET)
            res.cookie('auth_token', token, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: `${24 * 60 * 60}` }).json({ success: true });
        }
    } else {
        res.status(404).json({ success: false, message: "User does not exist" });
    }
});
const { GoogleGenAI } = require("@google/genai")


const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });


app.post('/api/chat', verifyToken, async (req, res) => {
    const message = req.body.message || req.body.prompt;

    if (!message) {
        return res.json({ success: false, error: "පණිවිඩයක් ලැබුණේ නැත!" });
    }

    try {
        const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: message,
        });
        const response = result.text;
        res.json({ success: true, reply: response });
    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tts',verifyToken, async (req, res) => {
    const response = await genAI.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: req.body.text }] }],
        config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Kore' },
                },
            },
        },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    const audioBuffer = Buffer.from(data, 'base64');
    //    res.writeHead(200,{
    //     'content-type':'audio/wav',
    //     'content-length':audioBuffer.length
    //    });
    const wavBuffer = await toWavBuffer(audioBuffer)
    res.setHeader('Content-Type', 'audio/wav')
    res.send(wavBuffer)

})


app.listen(3000, () => {
    console.log("Server is running on http://localhost:3000/final.html");
});

function toWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1, bitDepth = 16) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const writer = new wav.Writer({ sampleRate, channels, bitDepth });

        writer.on('data', chunk => chunks.push(chunk));
        writer.on('end', () => resolve(Buffer.concat(chunks)));
        writer.on('error', reject);

        writer.end(pcmBuffer);
    });
}

