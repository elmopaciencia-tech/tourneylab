import { REPORT_CLIENT_SCRIPT } from '../../report-client.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const REPORT_BUNDLE_MAGIC = encoder.encode('TLABRB1\n');
export const REPORT_BUNDLE_HEADER_BYTES = REPORT_BUNDLE_MAGIC.length + 4;
export const MAX_BUNDLE_FILES = 5000;
export const MAX_BUNDLE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BUNDLE_CONTENT_BYTES = 25 * 1024 * 1024;
export const MAX_BUNDLE_ARCHIVE_BYTES = 30 * 1024 * 1024;

const contentTypes = new Set([
  'text/html; charset=utf-8',
  'text/css; charset=utf-8',
  'text/csv; charset=utf-8',
  'text/javascript; charset=utf-8', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png'
]);

export interface BundleFileRecord {
  path: string;
  contentType: string;
  offset: number;
  length: number;
  sha256: string;
}

export interface BundleManifest {
  format: 'tourneylab-report-bundle';
  version: 1;
  entry: string;
  files: BundleFileRecord[];
}

export interface ParsedReportArchive {
  bytes: ArrayBuffer;
  manifest: BundleManifest;
  payloadOffset: number;
  totalContentBytes: number;
  sha256: string;
}

export function validBundlePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

export async function sha256Bytes(value: BufferSource) {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function readManifestLength(bytes: Uint8Array) {
  if (bytes.length < REPORT_BUNDLE_HEADER_BYTES) throw new Error('The report archive header is truncated.');
  for (let index = 0; index < REPORT_BUNDLE_MAGIC.length; index++) {
    if (bytes[index] !== REPORT_BUNDLE_MAGIC[index]) throw new Error('The report archive signature is invalid.');
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(REPORT_BUNDLE_MAGIC.length, false);
}

export function parseBundleManifest(header: Uint8Array, manifestBytes: Uint8Array): BundleManifest {
  const manifestLength = readManifestLength(header);
  if (manifestLength !== manifestBytes.byteLength || manifestLength <= 0 || manifestLength > 4 * 1024 * 1024) {
    throw new Error('The report archive manifest length is invalid.');
  }
  let manifest: BundleManifest;
  try { manifest = JSON.parse(decoder.decode(manifestBytes)); }
  catch { throw new Error('The report archive manifest is not valid UTF-8 JSON.'); }
  if (manifest?.format !== 'tourneylab-report-bundle' || manifest.version !== 1) throw new Error('Unsupported report archive format.');
  if (!validBundlePath(manifest.entry)) throw new Error('The report archive entry path is invalid.');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_BUNDLE_FILES) throw new Error('The report archive file count is invalid.');
  return manifest;
}

function resolvedBundleTarget(fromPath: string, href: string) {
  const cleanHref = href.split('#', 1)[0].split('?', 1)[0];
  if (!cleanHref || /^(?:https?:|mailto:|data:)/i.test(cleanHref)) return null;
  if (cleanHref.startsWith('/') || cleanHref.includes('\\')) throw new Error(`Unsafe report link in ${fromPath}.`);
  const segments = fromPath.split('/').slice(0, -1);
  for (const part of cleanHref.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segments.length) throw new Error(`Report link escapes the bundle from ${fromPath}.`);
      segments.pop();
    } else segments.push(part);
  }
  return segments.join('/');
}

function validateHtml(path: string, html: string, paths: Set<string>) {
  if (!/<meta\s+name=["']generator["']\s+content=["']TourneyLab["']/i.test(html)
    || !/<meta\s+name=["']tourneylab-report["']\s+content=["']event["']/i.test(html)
    || !/<meta\s+name=["']tourneylab-page["']\s+content=["'][a-z-]+["']/i.test(html)) {
    throw new Error(`Report page ${path} is missing TourneyLab metadata.`);
  }
  const checkedHtml = html.replace(/<script src="((?:\.\.\/)*assets\/report-search\.js)" defer><\/script>/g, (tag, src) => {
    if (resolvedBundleTarget(path, src) !== 'assets/report-search.js' || !paths.has('assets/report-search.js')) throw new Error('Invalid report script link.');
    return '';
  });
  if (/<(?:script|iframe|frame|object|embed|form|base|style)\b/i.test(checkedHtml)
    || /\son[a-z]+\s*=/i.test(html)
    || /javascript\s*:/i.test(html)) {
    throw new Error(`Report page ${path} contains unsafe HTML.`);
  }
  for (const match of html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) {
    const target = resolvedBundleTarget(path, match[1]);
    if (target && !paths.has(target)) throw new Error(`Report page ${path} links to missing file ${target}.`);
  }
}

function validateCss(path: string, css: string) {
  if (/@import\b|url\s*\(|expression\s*\(|javascript\s*:/i.test(css)) throw new Error(`Report stylesheet ${path} contains unsafe CSS.`);
}

export async function parseReportArchive(bytes: ArrayBuffer): Promise<ParsedReportArchive> {
  if (bytes.byteLength > MAX_BUNDLE_ARCHIVE_BYTES) throw new Error('Report bundle exceeds the 30 MiB archive limit.');
  const source = new Uint8Array(bytes);
  const manifestLength = readManifestLength(source);
  const payloadOffset = REPORT_BUNDLE_HEADER_BYTES + manifestLength;
  if (payloadOffset > source.byteLength) throw new Error('The report archive manifest is truncated.');
  const manifest = parseBundleManifest(source.subarray(0, REPORT_BUNDLE_HEADER_BYTES), source.subarray(REPORT_BUNDLE_HEADER_BYTES, payloadOffset));
  const paths = new Set<string>();
  let expectedOffset = 0;
  let totalContentBytes = 0;
  for (const file of manifest.files) {
    if (!validBundlePath(file.path) || paths.has(file.path)) throw new Error(`Invalid or duplicate report path: ${file.path ?? ''}`);
    if (!contentTypes.has(file.contentType)) throw new Error(`Unsupported report content type: ${file.contentType}`);
    if (!Number.isInteger(file.offset) || !Number.isInteger(file.length) || file.offset !== expectedOffset || file.length < 0 || file.length > MAX_BUNDLE_FILE_BYTES) throw new Error(`Invalid report file range: ${file.path}`);
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid report file hash: ${file.path}`);
    expectedOffset += file.length;
    totalContentBytes += file.length;
    if (totalContentBytes > MAX_BUNDLE_CONTENT_BYTES || payloadOffset + expectedOffset > source.byteLength) throw new Error('Report bundle content exceeds its declared range.');
    paths.add(file.path);
  }
  if (payloadOffset + expectedOffset !== source.byteLength) throw new Error('Report archive contains undeclared trailing data.');
  if (!paths.has(manifest.entry)) throw new Error('Report archive entry file is missing.');

  for (const file of manifest.files) {
    const payload = source.subarray(payloadOffset + file.offset, payloadOffset + file.offset + file.length);
    if (await sha256Bytes(payload) !== file.sha256) throw new Error(`Report file hash mismatch: ${file.path}`);
    if (!file.contentType.startsWith('text/')) {
      const signature = file.contentType === 'application/pdf' ? [37,80,68,70,45] : file.contentType === 'image/png' ? [137,80,78,71,13,10,26,10] : [80,75,3,4];
      if (!signature.every((byte, i) => payload[i] === byte)) throw new Error(`Invalid asset signature: ${file.path}`);
      continue;
    }
    let text: string;
    try { text = decoder.decode(payload); }
    catch { throw new Error(`Report file ${file.path} is not valid UTF-8.`); }
    if (file.contentType.startsWith('text/javascript') && (file.path !== 'assets/report-search.js' || text !== REPORT_CLIENT_SCRIPT)) throw new Error('Only the built-in report search script is allowed.');
    if (file.contentType.startsWith('text/html')) validateHtml(file.path, text, paths);
    else if (file.contentType.startsWith('text/css')) validateCss(file.path, text);
  }
  return { bytes, manifest, payloadOffset, totalContentBytes, sha256: await sha256Bytes(bytes) };
}

export function archiveManifestLength(header: Uint8Array) {
  return readManifestLength(header);
}
