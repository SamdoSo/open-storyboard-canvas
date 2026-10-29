import { v4 as uuidv4 } from 'uuid';
import { customHttpRequest } from '@/commands/ai';
import {
  normalizeImageHostSettings,
  type ImageHostProvider,
  type ImageHostSettings,
} from '@/stores/settingsStore';
import { imageUrlToDataUrl, blobToDataUrl } from './imageData';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { loadImage } from '@/commands/image';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export const TEST_1X1_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function mediaSourceToDataUrl(source: string): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (HTTP_URL_PATTERN.test(trimmed)) {
    try {
      const response = await fetch(trimmed);
      if (response.ok) {
        const blob = await response.blob();
        return await blobToDataUrl(blob);
      }
    } catch {
      // ignore
    }
  }
  if (isTauri()) {
    try {
      const cleanPath = trimmed.replace(/^file:\/\//i, '').replace(/^\/([A-Za-z]:[\\/])/, '$1');
      const assetUrl = convertFileSrc(cleanPath);
      const res = await fetch(assetUrl);
      if (res.ok) {
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      }
    } catch {
      // fallback
    }
    try {
      return await loadImage(trimmed);
    } catch {
      // fallback
    }
  }
  return await imageUrlToDataUrl(trimmed);
}

export function dataUrlExtension(dataUrl: string): string {
  const match = /^data:([^;,/]+)\/([a-z0-9.+-]+);/i.exec(dataUrl);
  const type = match?.[1]?.toLowerCase() ?? '';
  const raw = match?.[2]?.toLowerCase() ?? '';
  if (raw === 'jpeg') return 'jpg';
  if (raw === 'quicktime') return 'mov';
  if (raw === 'mpeg') return 'mp3';
  if (type === 'video') {
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(raw)) return raw;
    return 'mp4';
  }
  if (type === 'audio') {
    if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(raw)) return raw;
    return 'mp3';
  }
  if (['png', 'jpg', 'webp', 'gif', 'bmp', 'avif', 'svg+xml'].includes(raw)) {
    return raw === 'svg+xml' ? 'svg' : raw;
  }
  return 'png';
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

export interface DiscoveredBucket {
  name: string;
  region?: string;
  creationDate?: string;
}

export function parseBucketsFromXml(xmlText: string): DiscoveredBucket[] {
  const buckets: DiscoveredBucket[] = [];
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const bucketNodes = doc.getElementsByTagName('Bucket');
      for (let i = 0; i < bucketNodes.length; i++) {
        const node = bucketNodes[i];
        const name = node.getElementsByTagName('Name')[0]?.textContent?.trim() || '';
        let region =
          node.getElementsByTagName('Location')[0]?.textContent?.trim() ||
          node.getElementsByTagName('LocationConstraint')[0]?.textContent?.trim() ||
          '';
        if (region.startsWith('tos-')) {
          region = region.replace(/^tos-/, '');
        }
        const extranet = node.getElementsByTagName('ExtranetEndpoint')[0]?.textContent?.trim() || '';
        if (!region && extranet) {
          const m = /tos-(?:s3-)?([a-z0-9-]+)\.volces\.com/i.exec(extranet);
          if (m) region = m[1];
        }
        const creationDate = node.getElementsByTagName('CreationDate')[0]?.textContent?.trim() || '';
        if (name) {
          buckets.push({ name, region: region || undefined, creationDate: creationDate || undefined });
        }
      }
      if (buckets.length > 0) return buckets;
    } catch {
      // fallback to regex
    }
  }

  const bucketBlockRegex = /<Bucket>([\s\S]*?)<\/Bucket>/gi;
  let match: RegExpExecArray | null;
  while ((match = bucketBlockRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const nameMatch = /<Name>([^<]+)<\/Name>/i.exec(block);
    const locMatch = /<(?:Location|LocationConstraint)>([^<]+)<\/(?:Location|LocationConstraint)>/i.exec(block);
    const extranetMatch = /<ExtranetEndpoint>([^<]+)<\/ExtranetEndpoint>/i.exec(block);
    const dateMatch = /<CreationDate>([^<]+)<\/CreationDate>/i.exec(block);

    const name = nameMatch?.[1]?.trim() || '';
    let region = locMatch?.[1]?.trim() || '';
    if (region.startsWith('tos-')) {
      region = region.replace(/^tos-/, '');
    }
    if (!region && extranetMatch?.[1]) {
      const m = /tos-(?:s3-)?([a-z0-9-]+)\.volces\.com/i.exec(extranetMatch[1]);
      if (m) region = m[1];
    }
    const creationDate = dateMatch?.[1]?.trim() || '';
    if (name) {
      buckets.push({ name, region: region || undefined, creationDate: creationDate || undefined });
    }
  }

  return buckets;
}

export function parseXmlErrorMessage(xmlText: string): string | null {
  const codeMatch = /<Code>([^<]+)<\/Code>/i.exec(xmlText);
  const msgMatch = /<Message>([^<]+)<\/Message>/i.exec(xmlText);
  const code = codeMatch?.[1]?.trim() || '';
  const message = msgMatch?.[1]?.trim() || '';
  if (!code && !message) return null;

  if (code === 'InvalidAccessKeyId') {
    return 'AccessKey ID 不正确或不存在，请检查火山引擎 IAM 访问密钥。';
  }
  if (code === 'SignatureDoesNotMatch') {
    return 'SecretAccess Key 不匹配或签名错误，请检查密钥。';
  }
  if (code === 'AccessDenied') {
    return '访问被拒绝（AccessDenied），请确保该密钥具有 tos:ListBuckets 权限。';
  }
  return `[${code || 'Error'}] ${message || '请求失败'}`;
}

export async function fetchVolcengineTosBuckets(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  endpoint?: string;
}): Promise<DiscoveredBucket[]> {
  const accessKeyId = params.accessKeyId.trim();
  const secretAccessKey = params.secretAccessKey.trim();
  if (!accessKeyId) {
    throw new Error('缺少 AccessKey ID，无法获取存储桶列表。');
  }
  if (!secretAccessKey) {
    throw new Error('缺少 SecretAccess Key，无法获取存储桶列表。');
  }

  const region = params.region?.trim() || 'cn-beijing';
  const cleanEndpoint = (params.endpoint?.trim() || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const host = cleanEndpoint || `tos-s3-${region}.volces.com`;
  const url = `https://${host}/`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';

  const payloadSha256 = await sha256Hex('');
  const canonicalUri = '/';
  const canonicalQuery = '';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadSha256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
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
    method: 'GET',
    headers: {
      Host: host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadSha256,
      Authorization: authHeader,
    },
    timeoutMs: 15000,
  });

  if (response.status < 200 || response.status >= 300) {
    const parsed = parseXmlErrorMessage(response.text);
    if (parsed) {
      throw new Error(`火山引擎 TOS: ${parsed}`);
    }
    let detail = '';
    try {
      detail = response.text.slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`获取火山引擎 TOS 存储桶失败：HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  return parseBucketsFromXml(response.text);
}

export async function fetchTencentCosBuckets(params: {
  secretId: string;
  secretKey: string;
  region?: string;
  endpoint?: string;
}): Promise<DiscoveredBucket[]> {
  const secretId = params.secretId.trim();
  const secretKey = params.secretKey.trim();
  if (!secretId) {
    throw new Error('缺少 SecretId，无法获取存储桶列表。');
  }
  if (!secretKey) {
    throw new Error('缺少 SecretKey，无法获取存储桶列表。');
  }

  const region = params.region?.trim() || 'ap-guangzhou';
  const cleanEndpoint = (params.endpoint?.trim() || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const host = cleanEndpoint || `cos.${region}.myqcloud.com`;
  const url = `https://${host}/`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';

  const payloadSha256 = await sha256Hex('');
  const canonicalUri = '/';
  const canonicalQuery = '';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadSha256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
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

  const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await customHttpRequest({
    url,
    method: 'GET',
    headers: {
      Host: host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadSha256,
      Authorization: authHeader,
    },
    timeoutMs: 15000,
  });

  if (response.status < 200 || response.status >= 300) {
    const parsed = parseXmlErrorMessage(response.text);
    if (parsed) {
      throw new Error(`腾讯云 COS: ${parsed}`);
    }
    let detail = '';
    try {
      detail = response.text.slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`获取腾讯云 COS 存储桶失败：HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  return parseBucketsFromXml(response.text);
}

export async function fetchCloudflareR2Buckets(params: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<DiscoveredBucket[]> {
  const accountId = params.accountId.trim();
  const accessKeyId = params.accessKeyId.trim();
  const secretAccessKey = params.secretAccessKey.trim();
  if (!accountId) {
    throw new Error('缺少 Account ID，无法获取存储桶列表。');
  }
  if (!accessKeyId) {
    throw new Error('缺少 Access Key ID，无法获取存储桶列表。');
  }
  if (!secretAccessKey) {
    throw new Error('缺少 Secret Access Key，无法获取存储桶列表。');
  }

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/`;
  const region = 'auto';
  const service = 's3';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadSha256 = await sha256Hex('');
  const canonicalUri = '/';
  const canonicalQuery = '';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadSha256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
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
    method: 'GET',
    headers: {
      Host: host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadSha256,
      Authorization: authHeader,
    },
    timeoutMs: 15000,
  });

  if (response.status < 200 || response.status >= 300) {
    const parsed = parseXmlErrorMessage(response.text);
    if (parsed) {
      throw new Error(`Cloudflare R2: ${parsed}`);
    }
    let detail = '';
    try {
      detail = response.text.slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`获取 Cloudflare R2 存储桶失败：HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  return parseBucketsFromXml(response.text);
}

export async function uploadToTencentCos(
  source: string,
  index: number,
  settings: ImageHostSettings,
  mediaType: 'image' | 'video' | 'audio' = 'image'
): Promise<string> {
  const { secretId, secretKey, region: rawRegion, bucketName, endpoint: rawEndpoint, publicDomain, prefix } = settings.tencentCos;
  if (!secretId) {
    throw new Error('腾讯云 COS 缺少 SecretId，请在设置中配置。');
  }
  if (!secretKey) {
    throw new Error('腾讯云 COS 缺少 SecretKey，请在设置中配置。');
  }
  if (!bucketName) {
    throw new Error('腾讯云 COS 缺少存储桶名称 (Bucket)，请在设置中配置。');
  }

  const region = rawRegion.trim() || 'ap-guangzhou';
  const dataUrl = await mediaSourceToDataUrl(source);
  const { bytes, mimeType, extension } = parseDataUrlBytes(dataUrl);

  const cleanPrefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const filePrefix = mediaType === 'video' ? 'storyboard-video' : (mediaType === 'audio' ? 'storyboard-audio' : 'storyboard');
  const objectKey = `${cleanPrefix}${filePrefix}-${Date.now()}-${uuidv4().slice(0, 8)}-${index + 1}.${extension}`;

  // 腾讯云 COS 必须采用 Virtual-hosted 访问风格：<BucketName-APPID>.cos.<Region>.myqcloud.com
  const cleanEndpoint = rawEndpoint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const baseHost = cleanEndpoint || `cos.${region}.myqcloud.com`;
  const host = baseHost.startsWith(`${bucketName}.`) ? baseHost : `${bucketName}.${baseHost}`;
  const url = `https://${host}/${objectKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';

  const payloadSha256 = await sha256Hex(bytes);

  const canonicalUri = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
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

  const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

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
    throw new Error(`腾讯云 COS 上传失败：HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  if (publicDomain.trim()) {
    return `${publicDomain.trim().replace(/\/+$/, '')}/${objectKey}`;
  }
  return `https://${host}/${objectKey}`;
}

export async function uploadToVolcengineTos(
  source: string,
  index: number,
  settings: ImageHostSettings,
  mediaType: 'image' | 'video' | 'audio' = 'image'
): Promise<string> {
  const { accessKeyId, secretAccessKey, region: rawRegion, bucketName, endpoint: rawEndpoint, publicDomain, prefix } = settings.volcengineTos;
  if (!accessKeyId) {
    throw new Error('火山引擎 TOS 缺少 AccessKey ID，请在设置中配置。');
  }
  if (!secretAccessKey) {
    throw new Error('火山引擎 TOS 缺少 SecretAccess Key，请在设置中配置。');
  }
  if (!bucketName) {
    throw new Error('火山引擎 TOS 缺少存储桶名称 (Bucket)，请在设置中配置。');
  }

  const region = rawRegion.trim() || 'cn-beijing';
  const dataUrl = await mediaSourceToDataUrl(source);
  const { bytes, mimeType, extension } = parseDataUrlBytes(dataUrl);

  const cleanPrefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const filePrefix = mediaType === 'video' ? 'storyboard-video' : (mediaType === 'audio' ? 'storyboard-audio' : 'storyboard');
  const objectKey = `${cleanPrefix}${filePrefix}-${Date.now()}-${uuidv4().slice(0, 8)}-${index + 1}.${extension}`;

  // 火山引擎 TOS S3 兼容接入：
  // 外网标准域名：tos-s3-{region}.volces.com，必须采用 Virtual-hosted 访问风格：{bucket}.tos-s3-{region}.volces.com
  const cleanEndpoint = rawEndpoint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const baseHost = cleanEndpoint || `tos-s3-${region}.volces.com`;
  const host = baseHost.startsWith(`${bucketName}.`) ? baseHost : `${bucketName}.${baseHost}`;
  const url = `https://${host}/${objectKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';

  const payloadSha256 = await sha256Hex(bytes);

  // Virtual-hosted 风格下，Canonical URI 不包含 bucket 名称
  const canonicalUri = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
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
    throw new Error(`火山引擎 TOS 上传失败：HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  if (publicDomain.trim()) {
    return `${publicDomain.trim().replace(/\/+$/, '')}/${objectKey}`;
  }
  return `https://${bucketName}.tos-${region}.volces.com/${objectKey}`;
}

export async function uploadToCloudflareR2(
  source: string,
  index: number,
  settings: ImageHostSettings,
  mediaType: 'image' | 'video' | 'audio' = 'image'
): Promise<string> {
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

  const dataUrl = await mediaSourceToDataUrl(source);
  const { bytes, mimeType, extension } = parseDataUrlBytes(dataUrl);

  const cleanPrefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const filePrefix = mediaType === 'video' ? 'storyboard-video' : (mediaType === 'audio' ? 'storyboard-audio' : 'storyboard');
  const objectKey = `${cleanPrefix}${filePrefix}-${Date.now()}-${uuidv4().slice(0, 8)}-${index + 1}.${extension}`;

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
      case 'volcengineTos':
        url = await uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
      case 'tencentCos':
        url = await uploadToTencentCos(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
      case 'cloudflareR2':
      default:
        url = await uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, settings);
        break;
    }
    return { ok: true, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function uploadMediaToConfiguredHost(
  source: string,
  index: number,
  rawSettings: ImageHostSettings,
  mediaType: 'image' | 'video' | 'audio' = 'image'
): Promise<string> {
  const settings = normalizeImageHostSettings(rawSettings);
  if (!settings.enabled) {
    throw new Error('当前模型要求参考素材使用对象存储 URL，请先在设置里勾选启用对象存储。');
  }
  if (HTTP_URL_PATTERN.test(source.trim())) {
    return source.trim();
  }
  switch (settings.provider) {
    case 'tencentCos':
      return uploadToTencentCos(source, index, settings, mediaType);
    case 'cloudflareR2':
      return uploadToCloudflareR2(source, index, settings, mediaType);
    case 'volcengineTos':
    default:
      return uploadToVolcengineTos(source, index, settings, mediaType);
  }
}

export async function uploadImageToConfiguredHost(
  source: string,
  index: number,
  rawSettings: ImageHostSettings
): Promise<string> {
  return uploadMediaToConfiguredHost(source, index, rawSettings, 'image');
}
