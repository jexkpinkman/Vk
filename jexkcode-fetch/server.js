const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const cheerio = require('cheerio');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeDownloads = new Map();

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 120);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('vk.com') || u.includes('vkvideo.ru')) return 'vk';
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('dailymotion.com')) return 'dailymotion';
    if (u.includes('vimeo.com')) return 'vimeo';
    if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
    return 'generic';
}

async function analyzeVK(url) {
    try {
        const match = url.match(/video(-?\d+)_(\d+)/);
        if (!match) return { supported: false, error: 'Invalid VK video URL format' };
        const oid = match[1];
        const vid = match[2];

        const htmlRes = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://vk.com/'
            },
            timeout: 15000
        });
        if (!htmlRes.ok) return { supported: false, error: 'VK page unavailable' };
        const html = await htmlRes.text();
        const $ = cheerio.load(html);

        let title = $('meta[property="og:title"]').attr('content') ||
                    $('title').text() || 'VK Video';
        let thumbnail = $('meta[property="og:image"]').attr('content') || '';
        let durationText = '';
        let durationSec = 0;

        const ldJson = $('script[type="application/ld+json"]').html();
        if (ldJson) {
            try {
                const ld = JSON.parse(ldJson);
                if (ld.name) title = ld.name;
                if (ld.thumbnailUrl) thumbnail = ld.thumbnailUrl;
                if (ld.duration) {
                    durationText = ld.duration;
                    const m = ld.duration.match(/PT(\d+)M(\d+)S/);
                    if (m) durationSec = parseInt(m[1]) * 60 + parseInt(m[2]);
                }
            } catch (e) {}
        }

        const formats = [];
        const mp4Regex = /"url\d+"\s*:\s*"(https?:\\/\\/[^"]+\.mp4[^"]*)"/gi;
        const mp4Matches = [...html.matchAll(mp4Regex)];
        const seenUrls = new Set();

        const resMap = [
            { key: 'url1080', label: '1080p', height: 1080 },
            { key: 'url720',  label: '720p',  height: 720 },
            { key: 'url480',  label: '480p',  height: 480 },
            { key: 'url360',  label: '360p',  height: 360 },
            { key: 'url240',  label: '240p',  height: 240 }
        ];

        for (const r of resMap) {
            const rx = new RegExp(`"${r.key}"\\s*:\\s*"(https?:\\\\/\\\\/[^"]+)"`, 'i');
            const m = html.match(rx);
            if (m) {
                let raw = m[1].replace(/\\\//g, '/');
                if (!seenUrls.has(raw)) {
                    seenUrls.add(raw);
                    formats.push({
                        formatId: r.key,
                        label: `${r.label} MP4`,
                        resolution: r.label,
                        height: r.height,
                        ext: 'mp4',
                        url: raw,
                        vcodec: 'h264',
                        acodec: 'aac'
                    });
                }
            }
        }

        for (const mm of mp4Matches) {
            let raw = mm[1].replace(/\\\//g, '/');
            if (!seenUrls.has(raw)) {
                seenUrls.add(raw);
                let h = 360;
                if (raw.includes('1080')) h = 1080;
                else if (raw.includes('720')) h = 720;
                else if (raw.includes('480')) h = 480;
                else if (raw.includes('240')) h = 240;
                const label = h + 'p';
                formats.push({
                    formatId: `url_${label}`,
                    label: `${label} MP4`,
                    resolution: label,
                    height: h,
                    ext: 'mp4',
                    url: raw,
                    vcodec: 'h264',
                    acodec: 'aac'
                });
            }
        }

        if (formats.length === 0) {
            const playerRx = /"mp4_\d+"\s*:\s*"(https?:\\/\\/[^"]+\.mp4[^"]*)"/gi;
            const pms = [...html.matchAll(playerRx)];
            for (const pm of pms) {
                let raw = pm[1].replace(/\\\//g, '/');
                if (!seenUrls.has(raw)) {
                    seenUrls.add(raw);
                    let h = 360;
                    if (raw.includes('1080')) h = 1080;
                    else if (raw.includes('720')) h = 720;
                    else if (raw.includes('480')) h = 480;
                    else if (raw.includes('240')) h = 240;
                    const label = h + 'p';
                    formats.push({
                        formatId: `mp4_${label}`,
                        label: `${label} MP4`,
                        resolution: label,
                        height: h,
                        ext: 'mp4',
                        url: raw,
                        vcodec: 'h264',
                        acodec: 'aac'
                    });
                }
            }
        }

        formats.sort((a, b) => b.height - a.height);

        if (formats.length === 0) {
            return { supported: false, error: 'No downloadable formats found. Video may be private or restricted.' };
        }

        return {
            supported: true,
            platform: 'vk',
            title,
            thumbnail,
            duration: durationSec,
            durationText,
            formats
        };
    } catch (err) {
        return { supported: false, error: 'VK analysis failed: ' + err.message };
    }
}

async function analyzeYouTube(url) {
    try {
        if (!ytdl.validateURL(url)) return { supported: false, error: 'Invalid YouTube URL' };
        const info = await ytdl.getInfo(url);
        const formats = info.formats
            .filter(f => f.hasVideo && f.url)
            .map(f => ({
                formatId: f.itag,
                label: `${f.qualityLabel} ${f.container.toUpperCase()}`,
                resolution: f.qualityLabel,
                height: f.height || 0,
                ext: f.container,
                url: f.url,
                vcodec: f.videoCodec || 'unknown',
                acodec: f.audioCodec || 'unknown',
                bitrate: f.bitrate || 0
            }))
            .sort((a, b) => b.height - a.height);

        const audioFormats = info.formats
            .filter(f => !f.hasVideo && f.hasAudio && f.url)
            .map(f => ({
                formatId: f.itag,
                label: `Audio ${f.audioBitrate || '?'}kbps ${f.container.toUpperCase()}`,
                resolution: 'audio',
                height: 0,
                ext: f.container,
                url: f.url,
                vcodec: 'none',
                acodec: f.audioCodec || 'unknown',
                bitrate: f.bitrate || 0
            }));

        return {
            supported: true,
            platform: 'youtube',
            title: info.videoDetails.title,
            thumbnail: info.videoDetails.thumbnails.pop()?.url || '',
            duration: parseInt(info.videoDetails.lengthSeconds) || 0,
            durationText: '',
            formats: [...formats, ...audioFormats]
        };
    } catch (err) {
        return { supported: false, error: 'YouTube analysis failed: ' + err.message };
    }
}

async function analyzeGeneric(url) {
    try {
        const head = await fetch(url, { method: 'HEAD', timeout: 10000 });
        const ct = head.headers.get('content-type') || '';
        const cl = head.headers.get('content-length');
        if (ct.includes('video') || ct.includes('audio') || ct.includes('application/octet-stream')) {
            return {
                supported: true,
                platform: 'direct',
                title: 'Direct Video',
                thumbnail: '',
                duration: 0,
                durationText: '',
                formats: [{
                    formatId: 'direct',
                    label: 'Direct Download',
                    resolution: 'original',
                    height: 0,
                    ext: 'mp4',
                    url,
                    vcodec: 'unknown',
                    acodec: 'unknown',
                    size: cl ? parseInt(cl) : undefined
                }]
            };
        }
        return { supported: false, error: 'Unsupported URL or no direct video detected.' };
    } catch (err) {
        return { supported: false, error: 'Generic analysis failed: ' + err.message };
    }
}

app.post('/api/analyze', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const platform = detectPlatform(url);
    let result;
    if (platform === 'vk') result = await analyzeVK(url);
    else if (platform === 'youtube') result = await analyzeYouTube(url);
    else result = await analyzeGeneric(url);
    res.json(result);
});

app.post('/api/download', async (req, res) => {
    const { url, formatId, title, ext } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = uuidv4();
    const safeTitle = sanitizeFilename(title || 'video');
    const filename = `${safeTitle}_${id}.${ext || 'mp4'}`;
    const filepath = path.join(DOWNLOAD_DIR, filename);

    const dlState = {
        id,
        filename,
        filepath,
        url,
        status: 'downloading',
        downloaded: 0,
        total: 0,
        speed: 0,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        error: null
    };
    activeDownloads.set(id, dlState);

    res.json({ id, filename });

    (async () => {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://vk.com/'
                },
                timeout: 0
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const total = parseInt(response.headers.get('content-length')) || 0;
            dlState.total = total;

            const fileStream = fs.createWriteStream(filepath);
            const body = response.body;

            let lastBytes = 0;
            let lastTime = Date.now();

            body.on('data', chunk => {
                dlState.downloaded += chunk.length;
                const now = Date.now();
                const dt = (now - lastTime) / 1000;
                if (dt >= 0.5) {
                    dlState.speed = (dlState.downloaded - lastBytes) / dt;
                    lastBytes = dlState.downloaded;
                    lastTime = now;
                }
                dlState.lastUpdate = now;
            });

            body.on('end', () => {
                dlState.status = 'completed';
                dlState.speed = 0;
                dlState.lastUpdate = Date.now();
            });

            body.on('error', err => {
                dlState.status = 'failed';
                dlState.error = err.message;
                dlState.speed = 0;
            });

            await streamPipeline(body, fileStream);

            if (dlState.status === 'downloading') {
                dlState.status = 'completed';
                dlState.speed = 0;
            }
        } catch (err) {
            dlState.status = 'failed';
            dlState.error = err.message;
            dlState.speed = 0;
            try { fs.unlinkSync(filepath); } catch (e) {}
        }
    })();
});

app.get('/api/download/:id', (req, res) => {
    const dl = activeDownloads.get(req.params.id);
    if (!dl) return res.status(404).json({ error: 'Download not found' });
    const now = Date.now();
    const elapsed = (now - dl.startTime) / 1000;
    let eta = null;
    if (dl.total > 0 && dl.speed > 0) {
        const remaining = dl.total - dl.downloaded;
        eta = Math.ceil(remaining / dl.speed);
    }
    res.json({
        id: dl.id,
        filename: dl.filename,
        status: dl.status,
        downloaded: dl.downloaded,
        total: dl.total,
        speed: dl.speed,
        eta,
        elapsed,
        error: dl.error
    });
});

app.get('/api/file/:id', (req, res) => {
    const dl = activeDownloads.get(req.params.id);
    if (!dl) return res.status(404).json({ error: 'Not found' });
    if (dl.status !== 'completed') return res.status(400).json({ error: 'Not ready' });
    if (!fs.existsSync(dl.filepath)) return res.status(404).json({ error: 'File missing' });
    res.setHeader('Content-Disposition', `attachment; filename="${dl.filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = fs.createReadStream(dl.filepath);
    stream.pipe(res);
    stream.on('close', () => {
        try { fs.unlinkSync(dl.filepath); } catch (e) {}
        activeDownloads.delete(req.params.id);
    });
});

app.listen(PORT, () => {
    console.log(`JexkCode Fetch running on http://localhost:${PORT}`);
});
