try {
    require('dotenv').config();
} catch (e) {
    console.log("Variabili dotenv non trovate. Uso configurazione fallback.");
}

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURAZIONE CREDENZIALI
const CONFIG = {
    CLIENT_ID: process.env.CLIENT_ID || 'INSERISCI_DISCORD_CLIENT_ID',
    CLIENT_SECRET: process.env.CLIENT_SECRET || 'INSERISCI_DISCORD_CLIENT_SECRET',
    BOT_TOKEN: process.env.BOT_TOKEN || 'INSERISCI_DISCORD_BOT_TOKEN',
    REDIRECT_URI: process.env.REDIRECT_URI || 'https://zetaversobot.bot-keep.xyz/api/auth/callback',
    SESSION_SECRET: process.env.SESSION_SECRET || 'zetaverso_secret_key_2026_botkeep'
};

// Data Settings JSON
const DB_PATH = path.join(__dirname, '../data/settings.json');
if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
}
if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
}

function getSettings() {
    try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveSettings(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Middleware
app.enable('trust proxy');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SERVE SIA LA RADICE SIA LA CARTELLA PUBLIC
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname, '../public')));

// Sessioni
app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 86400000 
    }
}));

function checkAuth(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: 'Non autenticato' });
}

// ==================================================================
// ROTTE PAGINE HTML (Sia per URL puliti che con .html)
// ==================================================================

// Home Page (in radice)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Pagine dentro public/ (con e senza estensione .html)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/manage', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/manage.html'));
});
app.get('/manage.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/manage.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/docs.html'));
});
app.get('/docs.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/docs.html'));
});

// ==================================================================
// ROTTE DISCORD OAUTH2
// ==================================================================
app.get('/login-discord', (req, res) => {
    const redirectUri = encodeURIComponent(CONFIG.REDIRECT_URI);
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login.html?error=no_code');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
            client_id: CONFIG.CLIENT_ID,
            client_secret: CONFIG.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: CONFIG.REDIRECT_URI
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.user = userResponse.data;
        req.session.accessToken = accessToken;

        res.redirect('/dashboard.html');
    } catch (error) {
        console.error('Errore OAuth2:', error.response?.data || error.message);
        res.redirect('/login.html?error=auth_failed');
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/user', checkAuth, (req, res) => {
    res.json(req.session.user);
});

// API Guilds
app.get('/api/guilds', checkAuth, async (req, res) => {
    try {
        const userGuildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.session.accessToken}` }
        });
        const userGuilds = userGuildsRes.data;

        const adminGuilds = userGuilds.filter(g => 
            g.owner || (BigInt(g.permissions) & BigInt(0x20)) || (BigInt(g.permissions) & BigInt(0x8))
        );

        const botGuildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bot ${CONFIG.BOT_TOKEN}` }
        });
        const botGuildIds = new Set(botGuildsRes.data.map(g => g.id));

        const formattedGuilds = adminGuilds.map(guild => {
            const isBotPresent = botGuildIds.has(guild.id);
            const redirectUrl = encodeURIComponent(`https://zetaversobot.bot-keep.xyz/dashboard.html`);
            
            return {
                id: guild.id,
                name: guild.name,
                icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                botPresent: isBotPresent,
                inviteUrl: `https://discord.com/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&scope=bot%20applications.commands&permissions=8&guild_id=${guild.id}&disable_guild_select=true&redirect_uri=${redirectUrl}`
            };
        });

        res.json(formattedGuilds);
    } catch (error) {
        console.error('Errore recupero server:', error.response?.data || error.message);
        res.status(500).json({ error: 'Impossibile recuperare i server da Discord' });
    }
});

// API Settings
app.get('/api/settings/:guildId', checkAuth, (req, res) => {
    const { guildId } = req.params;
    const allSettings = getSettings();
    const defaultSettings = {
        antiRaid: true, antiNuke: true, antiSpam: true, antiLink: true,
        antiFlame: true, antiPrune: false, antiBot: true, joinGate: false,
        autoMod: true, ticketEnabled: true, partnershipEnabled: true
    };
    res.json(allSettings[guildId] || defaultSettings);
});

app.post('/api/settings/:guildId', checkAuth, (req, res) => {
    const { guildId } = req.params;
    const allSettings = getSettings();
    allSettings[guildId] = { ...allSettings[guildId], ...req.body, updatedAt: new Date().toISOString() };
    saveSettings(allSettings);
    res.json({ success: true, message: 'Impostazioni aggiornate con successo!' });
});

// Fallback a index.html se la rotta non esiste
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`⚡ ZetaVerso Bot attivo su https://zetaversobot.bot-keep.xyz (Porta ${PORT})`);
});