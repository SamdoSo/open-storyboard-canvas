import { v4 as uuidv4 } from 'uuid';
import { customHttpRequest, type CustomHttpMultipartBody } from '@/commands/ai';
import {
  DEFAULT_IMAGE_HOST_SETTINGS,
  normalizeImageHostSettings,
  type ImageHostProvider,
  type ImageHostSettings,
} from '@/stores/settingsStore';
import { imageUrlToDataUrl } from './imageData';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export const TEST_1X1_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function joinApiPath(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('图床返回内容不是有效 JSON。');
  }
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractStringByPath(value: unknown, path: string): string | null {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (Number.isInteger(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      return null;
    }
    const record = asPlainRecord(current);
    if (!record) {
      return null;
    }
    current = record[part];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null;
}

function firstStringByPath(value: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const found = extractStringByPath(value, path);
    if (found) {
      return found;
    }
  }
  return null;
}

function dataUrlExtension(dataUrl: string): string {
  const match = /^data:image\/([a-z0-9.+-]+);/i.exec(dataUrl);
  const raw = match?.[1]?.toLowerCase() ?? '';
  if (raw === 'jpeg') return 'jpg';
  if (raw === 'png' || raw === 'jpg' || raw === 'webp' || raw === 'gif' || raw === 'bmp' || raw === 'avif') {
    return raw;
  }
  return 'png';
}

function imageFileFromDataUrl(dataUrl: string, index: number, fieldName: string): NonNullable<CustomHttpMultipartBody['files']>[number] {
  const extension = dataUrlExtension(dataUrl);
  return {
    name: fieldName,
    fileName: `reference-${index + 1}.${extension}`,
    dataUrl,
  };
}

export function parseDataUrlBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string; extension: string } {
  const match = /^data:([^;,]+)(?:;[^,]+)*;base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) {
    throw new Error('无效的图片 DataURL 格式。');
  }
  const mimeType = match[1].toLowerCase();
  const binaryString = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const extension = dataUrlExtension(dataUrl);
  return { bytes, mimeType, extension };
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacSha256(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const keyBuffer = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

export function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function uploadToPixhost(source: string, index: number, settings: ImageHostSettings): Promise<string> {
  const dataUrl = await imageUrlToDataUrl(source);
  const response = await customHttpRequest({
    url: joinApiPath(settings.pixhost.apiBaseUrl, '/images'),
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    bodyMode: 'multipart',
    multipart: {
      fields: [
        { name: 'content_type', value: settings.pixhost.contentType || DEFAULT_IMAGE_HOST_SETTINGS.pixhost.contentType },
        { name: 'max_th_size', value: settings.pixhost.maxThumbnailSize || DEFAULT_IMAGE_HOST_SETTINGS.pixhost.maxThumbnailSize },
      ],
      files: [imageFileFromDataUrl(dataUrl, index, 'img')],
    },
    timeoutMs: 60000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`PiXhost 上传失败：HTTP ${response.status}`);
  }
  const parsed = parseJsonResponse(response.text);
  const url = firstStringByPath(parsed, [
    'show_url',
    'image.show_url',
    'data.show_url',
    'data.url',
    'url',
  ]);
  if (!url) {
    throw new Error('PiXhost 上传成功但没有返回图片 URL。');
  }
  return url;
}

async function uploadToSeedvault(source: string, index: number, settings: ImageHostSettings): Promise<string> {
  const token = settings.seedvault.token.trim();
  if (!token) {
    throw new Error('私域图床缺少 token，请先在设置里保存账号密码生成 token。');
  }
  const dataUrl = await imageUrlToDataUrl(source);
  const fields: NonNullable<CustomHttpMultipartBody['fields']> = [];
  if (settings.seedvault.strategyId.trim()) {
    fields.push({ name: 'strategy_id', value: settings.seedvault.strategyId.trim() });
  }
  const response = await customHttpRequest({
    url: joinApiPath(settings.seedvault.apiBaseUrl, '/upload'),
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    bodyMode: 'multipart',
    multipart: {
      fields,
      files: [imageFileFromDataUrl(dataUrl, index, 'file')],
    },
    timeoutMs: 60000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`私域图床上传失败：HTTP ${response.status}`);
  }
  const parsed = parseJsonResponse(response.text);
  const url = firstStringByPath(parsed, [
    'data.links.url',
    'data.url',
    'url',
  ]);
  if (!url) {
    throw new Error('私域图床上传成功但没有返回图片 URL。');
  }
  return url;
}

export async function uploadToSuperbed(source: string, index: number, settings: ImageHostSettings): Promise<string> {
  const token = settings.superbed.token.trim();
  if (!token) {
    throw new Error('聚合图床缺少 token，请先在设置中填写并保存您的 API Token。');
  }
  const dataUrl = await imageUrlToDataUrl(source);
  const fields: NonNullable<CustomHttpMultipartBody['fields']> = [
    { name: 'token', value: token },
  ];
  if (settings.superbed.categories.trim()) {
    fields.push({ name: 'categories', value: settings.superbed.categories.trim() });
  }

  const response = await customHttpRequest({
    url: 'https://api.superbed.cn/upload',
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    bodyMode: 'multipart',
    multipart: {
      fields,
      files: [imageFileFromDataUrl(dataUrl, index, 'file')],
    },
    timeoutMs: 60000,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`聚合图床上传失败：HTTP ${response.status}`);
  }

  const parsed = parseJsonResponse(response.text);
  const record = asPlainRecord(parsed);
  if (record && typeof record.err === 'number' && record.err !== 0) {
    const msg = typeof record.msg === 'string' && record.msg.trim()
      ? record.msg.trim()
      : `错误码 ${record.err}`;
    throw new Error(`聚合图床上传失败：${msg}`);
  }

  const url = firstStringByPath(parsed, [
    'url',
    'urls.0',
    'data.url',
    'data.links.url',
  ]);
  if (!url) {
    throw new Error('聚合图床上传成功但没有返回有效图片 URL。');
  }
  return url;
}

export async function uploadToCloudflareR2(source: string, index: number, settings: ImageHostSettings): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucketName, publicDomain, prefix } = settings.cloudflareR2;
  if (!accountId) {
    throw new Error('Cloudflare R2 缺少 Account ID，请在设置中配置。');
  }
  if (!accessKeyId) {
    throw new Error('Cloudflare R2 缺少 Access Key ID，请在设置中配置。');
  }
  if (!secretAccessKey) {
    throw new Error('Cloudflare R2 缺少 Secret Access Key，请在设置中配置。');
  }
  if (!bucketName) {
    throw new Error('Cloudflare R2 缺少 Bucket Name，请在设置中配置。');
  }

  const dataUrl = await imageUrlToDataUrl(source);
  const { bytes, mimeType, extension } = parseDataUrlBytes(dataUrl);

  const cleanPrefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const objectKey = `${cleanPrefix}storyboard-${Date.now()}-${uuidv4().slice(0, 8)}-${index + 1}.${extension}`;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${objectKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadSha256 = await sha256Hex(bytes);

  const canonicalUri = `/${bucketName}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const canonicalHeaders = `content-type:${mimeType}\nhost:${host}\nx-amz-content-sha256:${payloadSha256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await customHttpRequest({
    url,
    method: 'PUT',
    headers: {
      Host: host,
      'Content-Type': mimeType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadSha256,
      Authorization: authHeader,
    },
    bodyMode: 'raw',
    rawBody: dataUrl,
    timeoutMs: 60000,
  });

  if (response.status < 200 || response.status >= 300) {
    let detail = '';
    try {
      detail = response.text.slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`Cloudflare R2 上传失败：HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  if (publicDomain.trim()) {
    return `${publicDomain.trim().replace(/\/+$/, '')}/${objectKey}`;
  }
  return `https://${bucketName}.${accountId}.r2.dev/${objectKey}`;
}

export async function testImageHostUpload(
  provider: ImageHostProvider,
  settings: ImageHostSettings
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    let url = '';
    switch (provider) {
      case 'superbed':
        url = await uploadToSuperbed(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
      case 'cloudflareR2':
        url = await uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
      case 'seedvault':
        url = await uploadToSeedvault(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
      case 'pixhost':
      default:
        url = await uploadToPixhost(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
    }
    return { ok: true, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function uploadImageToConfiguredHost(
  source: string,
  index: number,
  rawSettings: ImageHostSettings
): Promise<string> {
  const settings = normalizeImageHostSettings(rawSettings);
  if (!settings.enabled) {
    throw new Error('当前模型要求参考图使用图床 URL，请先在设置里勾选启用图床。');
  }
  if (HTTP_URL_PATTERN.test(source.trim())) {
    return source.trim();
  }
  switch (settings.provider) {
    case 'seedvault':
      return uploadToSeedvault(source, index, settings);
    case 'superbed':
      return uploadToSuperbed(source, index, settings);
    case 'cloudflareR2':
      return uploadToCloudflareR2(source, index, settings);
    case 'pixhost':
    default:
      return uploadToPixhost(source, index, settings);
  }
}
