#!/usr/bin/env node
/**
 * Daily recap graphic generator for Better Season Golf.
 * Run: node recap/generate.js
 * Cron: 0 8 * * * (8am daily)
 * Generates a styled recap image from yesterday's puzzle, saves locally, sends to Telegram.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { buildPuzzleForSeed } = require('./puzzle-builder');

const DAILY_TIMEZONE = 'America/Chicago';
const GOLF_SHARE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SUPABASE_URL = 'https://rtpzyzajksvufblksyup.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0cHp5emFqa3N2dWZibGtzeXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzOTIwNTEsImV4cCI6MjA4Nzk2ODA1MX0.BTDVsO5BidPbBJRUksfEmmmCsZivZ19wOqiAO_gx1a4';

function getYesterdayCentralDateString() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const parts = formatter.formatToParts(yesterday);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (year && month && day) return { dateStr: `${year}-${month}-${day}`, year, month, day };
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return {
    dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, '0'),
    day: String(d.getDate()).padStart(2, '0'),
  };
}

function formatDateLabel(dateStr) {
  const parts = dateStr.split('-').map(Number);
  if (parts.length >= 3) {
    const month = parts[1];
    const day = parts[2];
    if (month >= 1 && month <= 12) return `${GOLF_SHARE_MONTHS[month - 1]} ${day} Recap`;
  }
  return 'Daily Recap';
}

function getModeLabel(seed) {
  if (seed.endsWith('_masters')) return 'The Masters';
  if (seed.endsWith('_all')) return 'Best Ball (Hard)';
  return 'Best Ball';
}

function formatScore(n) {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

async function fetchSupabaseStats(puzzleId) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase
    .from('scores')
    .select('score')
    .eq('puzzle_id', puzzleId)
    .order('score', { ascending: true });
  if (error || !data) return { totalPlayers: 0, averageScore: null };
  const totalPlayers = data.length;
  if (totalPlayers === 0) return { totalPlayers: 0, averageScore: null };
  const sum = data.reduce((a, r) => a + r.score, 0);
  const averageScore = sum / totalPlayers;
  return { totalPlayers, averageScore };
}

async function captureRecapImage(htmlPath, outputPath) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 720, deviceScaleFactor: 2 });
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    const card = await page.$('#recap-card');
    if (!card) throw new Error('Recap card element not found');
    await card.screenshot({ path: outputPath, type: 'png' });
  } finally {
    await browser.close();
  }
}

async function sendToTelegram(imagePath) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; skipping Telegram send.');
    return;
  }
  const FormData = require('form-data');
  const axios = require('axios');
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', fs.createReadStream(imagePath));
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const res = await axios.post(url, form, { headers: form.getHeaders() });
  if (res.status !== 200) throw new Error(`Telegram send failed: ${res.status}`);
}

async function main() {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const { dateStr } = getYesterdayCentralDateString();
  const seed = `${dateStr}_majors`;

  console.log('Building puzzle for seed:', seed);
  let puzzle;
  try {
    puzzle = buildPuzzleForSeed(seed);
  } catch (err) {
    console.error('Failed to build puzzle:', err.message);
    process.exit(1);
  }

  console.log('Fetching Supabase stats...');
  const { totalPlayers, averageScore } = await fetchSupabaseStats(seed);

  const recapData = {
    dateLabel: formatDateLabel(dateStr),
    modeLabel: getModeLabel(seed),
    totalPlayers,
    averageScore,
    puzzle,
  };

  const templatePath = path.join(__dirname, 'recap-card.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  const dataJson = JSON.stringify(recapData).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  html = html.replace('__RECAP_DATA_PLACEHOLDER__', dataJson);

  const tempPath = path.join(__dirname, 'temp-recap.html');
  fs.writeFileSync(tempPath, html, 'utf8');

  const outputPath = path.join(outputDir, `recap-${dateStr}.png`);
  console.log('Capturing image to', outputPath);
  await captureRecapImage(tempPath, outputPath);
  fs.unlinkSync(tempPath);

  console.log('Sending to Telegram...');
  try {
    await sendToTelegram(outputPath);
    console.log('Sent to Telegram.');
  } catch (err) {
    console.warn('Telegram send failed (image still saved):', err.message);
  }

  console.log('Done. Recap saved to', outputPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
