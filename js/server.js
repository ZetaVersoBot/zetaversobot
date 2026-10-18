require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Abilita 'trust proxy' per funzionare correttamente dietro Nginx / Cloudflare su HTTPS
app.enable('trust proxy');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'zetaverso_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Imposta true con HTTPS attivo
        maxAge: 86400000 // 24 ore
    }
}));

// Middleware di controllo autenticazione
function checkAuth(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: 'Non autenticato' });
}

// ------------------------------------------------------------------
// ROUTE AUTENTICAZIONE OAUTH2 DISCORD
// ------------------------------------------------------------------

// Rotta per avviare il login Discord
app.get('/login-discord', (req, res) => {
    const redirectUri = encodeURIComponent(process.env.REDIRECT_URI);
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// Callback di ritorno da Discord
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login.html?error=no_code');

    try {
        // Scambio del codice di autorizzazione per l'Access Token
        const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.REDIRECT_URI
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // Recupero profilo dell'utente loggato
        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.user = userResponse.data;
        req.session.accessToken = accessToken;

        res.redirect('/dashboard.html');
    } catch (error) {
        console.error('Errore durante l\'autenticazione OAuth2:', error.response?.data || error.message);
        res.redirect('/login.html?error=auth_failed');
    }
});

// Logout
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Dati profilo utente
app.get('/api/user', checkAuth, (req, res) => {
    res.json(req.session.user);
});

// ------------------------------------------------------------------
// RECUPERO SERVER IN TEMPO REALE CON VERIFICA BOT
// ------------------------------------------------------------------

app.get('/api/guilds', checkAuth, async (req, res) => {
    try {
        // 1. Recupera i server dell'utente
        const userGuildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.session.accessToken}` }
        });
        const userGuilds = userGuildsRes.data;

        // Filtra solo i server in cui l'utente ha i permessi di amministrazione (Owner, Administrator 0x8 o Manage Guild 0x20)
        const adminGuilds = userGuilds.filter(g => 
            g.owner || (BigInt(g.permissions) & BigInt(0x20)) || (BigInt(g.permissions) & BigInt(0x8))
        );

        // 2. Recupera i server in cui il bot ZetaVerso è attualmente presente
        const botGuildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }
        });
        const botGuildIds = new Set(botGuildsRes.data.map(g => g.id));

        // 3. Struttura i dati includendo lo stato e il link di invito specifico
        const formattedGuilds = adminGuilds.map(guild => {
            const isBotPresent = botGuildIds.has(guild.id);
            const redirectUrl = encodeURIComponent(`https://zetaversobot.bot-keep.xyz/dashboard.html`);
            
            return {
                id: guild.id,
                name: guild.name,
                icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
                botPresent: isBotPresent,
                inviteUrl: `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot%20applications.commands&permissions=8&guild_id=${guild.id}&disable_guild_select=true&redirect_uri=${redirectUrl}`
            };
        });

        res.json(formattedGuilds);
    } catch (error) {
        console.error('Errore nel recupero server:', error.response?.data || error.message);
        res.status(500).json({ error: 'Impossibile recuperare i server da Discord' });
    }
});

// Avvio Server
app.listen(PORT, () => {
    console.log(`🚀 ZetaVerso Bot Dashboard attiva su https://zetaversobot.bot-keep.xyz (Porta ${PORT})`);
});