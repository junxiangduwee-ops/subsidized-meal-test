import cron from 'node-cron';

const SECRET = process.env.CRON_SECRET ?? 'dev';
const BASE = 'http://localhost:3000';

async function call(path) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${SECRET}` },
    });
    const json = await res.json();
    console.log(`[${new Date().toLocaleTimeString('en-MY')}] ${path}`, json);
}

// These run on MYT since your local machine is MYT
cron.schedule('0 18 * * *', () => call('/api/cron/confirm-meals'));
cron.schedule('0 17 * * *', () => call('/api/cron/close-cycles'));
cron.schedule('0 10 * * *', () => call('/api/cron/expire-orders'));

console.log('Local cron runner started. Keep this terminal open.');