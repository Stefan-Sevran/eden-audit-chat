const fs = require('fs');
const path = require('path');

function normalizeUrl(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('A website URL is required.');
  }
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http/https URLs are supported.');
  }
  return url.toString();
}

function slugFromUrl(input) {
  const url = new URL(normalizeUrl(input));
  return (url.hostname || 'clinic')
    .replace(/^www\./i, '')
    .replace(/[^a-z0-9.-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'clinic';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return filePath;
}

module.exports = { normalizeUrl, slugFromUrl, ensureDir, writeJson };
