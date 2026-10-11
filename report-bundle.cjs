const crypto = require('crypto');

const REPORT_BUNDLE_MAGIC = Buffer.from('TLABRB1\n', 'ascii');
const REPORT_BUNDLE_VERSION = 1;
const MAX_BUNDLE_FILES = 5000;
const MAX_BUNDLE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_CONTENT_TYPES = new Set([
  'text/html; charset=utf-8',
  'text/css; charset=utf-8',
  'text/csv; charset=utf-8',
  'text/javascript; charset=utf-8', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png'
]);

function validRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

function filePayload(file) {
  if (file.contentType.startsWith('text/')) {
    if (typeof file.content !== 'string') throw new Error(`Report file ${file.path} must contain UTF-8 text.`);
    return Buffer.from(file.content, 'utf8');
  }
  if (typeof file.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) throw new Error('Invalid binary report asset.');
  const bytes = Buffer.from(file.contentBase64, 'base64');
  const signature = file.contentType === 'application/pdf' ? Buffer.from('%PDF-') : file.contentType === 'image/png' ? Buffer.from([137,80,78,71,13,10,26,10]) : Buffer.from([80,75,3,4]);
  if (!bytes.subarray(0, signature.length).equals(signature)) throw new Error(`Invalid asset signature: ${file.path}`);
  return bytes;
}

function validateReportBundle(bundle) {
  if (!bundle || bundle.format !== 'tourneylab-report-bundle' || bundle.version !== REPORT_BUNDLE_VERSION) {
    throw new Error('Invalid TourneyLab report bundle.');
  }
  if (!Array.isArray(bundle.files) || !bundle.files.length || bundle.files.length > MAX_BUNDLE_FILES) {
    throw new Error(`Report bundles must contain between 1 and ${MAX_BUNDLE_FILES} files.`);
  }
  if (!validRelativePath(bundle.entry)) throw new Error('The report bundle entry path is invalid.');
  const paths = new Set();
  let totalBytes = 0;
  for (const file of bundle.files) {
    if (!validRelativePath(file?.path)) throw new Error(`Invalid report file path: ${file?.path ?? ''}`);
    if (paths.has(file.path)) throw new Error(`Duplicate report file path: ${file.path}`);
    if (!SUPPORTED_CONTENT_TYPES.has(file.contentType)) throw new Error(`Unsupported report file type: ${file.contentType}`);
    const byteLength = filePayload(file).length;
    if (byteLength > MAX_BUNDLE_FILE_BYTES) throw new Error(`Report file ${file.path} exceeds 2 MiB.`);
    totalBytes += byteLength;
    if (totalBytes > MAX_BUNDLE_BYTES) throw new Error('Report bundle exceeds 25 MiB.');
    paths.add(file.path);
  }
  if (!paths.has(bundle.entry)) throw new Error('Report bundle entry file is missing.');
  return { paths, totalBytes };
}

function createReportArchive(bundle) {
  validateReportBundle(bundle);
  const payloads = [];
  const files = [];
  let offset = 0;
  for (const file of bundle.files) {
    const payload = filePayload(file);
    payloads.push(payload);
    files.push({
      path: file.path,
      contentType: file.contentType,
      offset,
      length: payload.length,
      sha256: crypto.createHash('sha256').update(payload).digest('hex')
    });
    offset += payload.length;
  }
  const manifest = Buffer.from(JSON.stringify({
    format: bundle.format,
    version: bundle.version,
    entry: bundle.entry,
    files
  }), 'utf8');
  const header = Buffer.alloc(REPORT_BUNDLE_MAGIC.length + 4);
  REPORT_BUNDLE_MAGIC.copy(header);
  header.writeUInt32BE(manifest.length, REPORT_BUNDLE_MAGIC.length);
  return Buffer.concat([header, manifest, ...payloads]);
}

function safeDirectoryName(value) {
  const name = String(value || 'tournament-report')
    .replace(/[\\/:*?"<>|\0]+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return name || 'tournament-report';
}

function writeReportBundle(fileSystem, pathModule, parentDirectory, suggestedName, bundle) {
  validateReportBundle(bundle);
  const parent = pathModule.resolve(parentDirectory);
  const baseName = safeDirectoryName(suggestedName);
  let outputDirectory = pathModule.join(parent, baseName);
  let suffix = 2;
  while (fileSystem.existsSync(outputDirectory)) outputDirectory = pathModule.join(parent, `${baseName}-${suffix++}`);
  if (!outputDirectory.startsWith(`${parent}${pathModule.sep}`)) throw new Error('Report output directory escapes the selected location.');

  const temporaryDirectory = `${outputDirectory}.tmp-${crypto.randomBytes(5).toString('hex')}`;
  fileSystem.mkdirSync(temporaryDirectory, { recursive: false });
  try {
    for (const file of bundle.files) {
      const destination = pathModule.resolve(temporaryDirectory, ...file.path.split('/'));
      if (!destination.startsWith(`${temporaryDirectory}${pathModule.sep}`)) throw new Error(`Report file escapes the output directory: ${file.path}`);
      fileSystem.mkdirSync(pathModule.dirname(destination), { recursive: true });
      fileSystem.writeFileSync(destination, filePayload(file));
    }
    fileSystem.renameSync(temporaryDirectory, outputDirectory);
  } catch (error) {
    try { fileSystem.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch {}
    throw error;
  }
  return {
    directory: outputDirectory,
    indexPath: pathModule.join(outputDirectory, ...bundle.entry.split('/'))
  };
}

module.exports = {
  REPORT_BUNDLE_MAGIC,
  REPORT_BUNDLE_VERSION,
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_FILE_BYTES,
  MAX_BUNDLE_BYTES,
  SUPPORTED_CONTENT_TYPES,
  validRelativePath,
  validateReportBundle,
  createReportArchive,
  writeReportBundle
};
