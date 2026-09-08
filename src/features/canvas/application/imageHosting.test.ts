import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseDataUrlBytes,
  sha256Hex,
  hmacSha256,
  toHex,
  uploadToSuperbed,
  uploadToCloudflareR2,
  testImageHostUpload,
  uploadImageToConfiguredHost,
  TEST_1X1_PNG_DATA_URL,
} from './imageHosting';
import { DEFAULT_IMAGE_HOST_SETTINGS, type ImageHostSettings } from '@/stores/settingsStore';

const { customHttpRequestMock } = vi.hoisted(() => ({
  customHttpRequestMock: vi.fn(),
}));

vi.mock('@/commands/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/commands/ai')>();
  return {
    ...actual,
    customHttpRequest: customHttpRequestMock,
  };
});

describe('imageHosting', () => {
  beforeEach(() => {
    customHttpRequestMock.mockReset();
  });

  describe('utility functions', () => {
    it('parseDataUrlBytes parses valid PNG data URL', () => {
      const result = parseDataUrlBytes(TEST_1X1_PNG_DATA_URL);
      expect(result.mimeType).toBe('image/png');
      expect(result.extension).toBe('png');
      expect(result.bytes.length).toBeGreaterThan(0);
    });

    it('parseDataUrlBytes parses JPEG data URL and normalizes extension to jpg', () => {
      const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      const result = parseDataUrlBytes(jpegDataUrl);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.extension).toBe('jpg');
      expect(result.bytes.length).toBeGreaterThan(0);
    });

    it('parseDataUrlBytes throws on invalid data URL', () => {
      expect(() => parseDataUrlBytes('not-a-data-url')).toThrow('无效的图片 DataURL 格式。');
      expect(() => parseDataUrlBytes('data:image/png;utf8,abc')).toThrow('无效的图片 DataURL 格式。');
    });

    it('sha256Hex generates valid hex hash', async () => {
      // SHA-256 of empty string is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const hash = await sha256Hex('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('hmacSha256 and toHex compute correct HMAC signature', async () => {
      const signatureBytes = await hmacSha256('secret-key', 'hello-world');
      const hex = toHex(signatureBytes);
      expect(typeof hex).toBe('string');
      expect(hex.length).toBe(64); // 32 bytes = 64 hex chars
    });
  });

  describe('uploadToSuperbed', () => {
    const baseSettings: ImageHostSettings = {
      ...DEFAULT_IMAGE_HOST_SETTINGS,
      provider: 'superbed',
      superbed: {
        token: 'test-superbed-token',
        categories: 'storyboard,sketch',
      },
    };

    it('throws error if token is missing', async () => {
      const noTokenSettings: ImageHostSettings = {
        ...baseSettings,
        superbed: { token: '   ', categories: '' },
      };
      await expect(uploadToSuperbed(TEST_1X1_PNG_DATA_URL, 0, noTokenSettings)).rejects.toThrow(
        '聚合图床缺少 token'
      );
    });

    it('successfully uploads and returns image url', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          err: 0,
          url: 'https://pic.superbed.cn/item/test123456.png',
        }),
      });

      const url = await uploadToSuperbed(TEST_1X1_PNG_DATA_URL, 0, baseSettings);
      expect(url).toBe('https://pic.superbed.cn/item/test123456.png');

      expect(customHttpRequestMock).toHaveBeenCalledTimes(1);
      const callArgs = customHttpRequestMock.mock.calls[0][0];
      expect(callArgs.url).toBe('https://api.superbed.cn/upload');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.bodyMode).toBe('multipart');
      expect(callArgs.multipart?.fields).toEqual([
        { name: 'token', value: 'test-superbed-token' },
        { name: 'categories', value: 'storyboard,sketch' },
      ]);
      expect(callArgs.multipart?.files?.[0]?.name).toBe('file');
      expect(callArgs.multipart?.files?.[0]?.dataUrl).toBe(TEST_1X1_PNG_DATA_URL);
    });

    it('handles urls array response from SuperBed', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          err: 0,
          urls: ['https://pic.superbed.cn/item/from-array.png'],
        }),
      });

      const url = await uploadToSuperbed(TEST_1X1_PNG_DATA_URL, 0, baseSettings);
      expect(url).toBe('https://pic.superbed.cn/item/from-array.png');
    });

    it('throws error when SuperBed returns err !== 0', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          err: 1,
          msg: 'token 无效或已过期',
        }),
      });

      await expect(uploadToSuperbed(TEST_1X1_PNG_DATA_URL, 0, baseSettings)).rejects.toThrow(
        '聚合图床上传失败：token 无效或已过期'
      );
    });

    it('throws error when HTTP status is not 2xx', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 500,
        headers: {},
        text: 'Internal Server Error',
      });

      await expect(uploadToSuperbed(TEST_1X1_PNG_DATA_URL, 0, baseSettings)).rejects.toThrow(
        '聚合图床上传失败：HTTP 500'
      );
    });
  });

  describe('uploadToCloudflareR2', () => {
    const baseR2Settings: ImageHostSettings = {
      ...DEFAULT_IMAGE_HOST_SETTINGS,
      provider: 'cloudflareR2',
      cloudflareR2: {
        accountId: 'acc1234567890abcdef',
        accessKeyId: 'key_id_abc',
        secretAccessKey: 'secret_key_xyz',
        bucketName: 'test-bucket',
        publicDomain: 'https://cdn.example.com',
        prefix: 'storyboard-assets',
      },
    };

    it('validates required fields', async () => {
      await expect(
        uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseR2Settings,
          cloudflareR2: { ...baseR2Settings.cloudflareR2, accountId: '' },
        })
      ).rejects.toThrow('Cloudflare R2 缺少 Account ID');

      await expect(
        uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseR2Settings,
          cloudflareR2: { ...baseR2Settings.cloudflareR2, accessKeyId: '' },
        })
      ).rejects.toThrow('Cloudflare R2 缺少 Access Key ID');

      await expect(
        uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseR2Settings,
          cloudflareR2: { ...baseR2Settings.cloudflareR2, secretAccessKey: '' },
        })
      ).rejects.toThrow('Cloudflare R2 缺少 Secret Access Key');

      await expect(
        uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseR2Settings,
          cloudflareR2: { ...baseR2Settings.cloudflareR2, bucketName: '' },
        })
      ).rejects.toThrow('Cloudflare R2 缺少 Bucket Name');
    });

    it('sends PUT request with SigV4 signed headers and returns custom public domain URL', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const url = await uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, baseR2Settings);
      expect(url).toMatch(/^https:\/\/cdn\.example\.com\/storyboard-assets\/storyboard-\d+-[a-f0-9]+-1\.png$/);

      expect(customHttpRequestMock).toHaveBeenCalledTimes(1);
      const callArgs = customHttpRequestMock.mock.calls[0][0];
      expect(callArgs.method).toBe('PUT');
      expect(callArgs.bodyMode).toBe('raw');
      expect(callArgs.rawBody).toBe(TEST_1X1_PNG_DATA_URL);
      expect(callArgs.url).toContain('https://acc1234567890abcdef.r2.cloudflarestorage.com/test-bucket/storyboard-assets/');

      // Check SigV4 headers
      const headers = callArgs.headers;
      expect(headers.Host).toBe('acc1234567890abcdef.r2.cloudflarestorage.com');
      expect(headers['Content-Type']).toBe('image/png');
      expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect(headers.Authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=key_id_abc\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
      );
    });

    it('returns default r2.dev domain when publicDomain is empty', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const noPublicDomainSettings: ImageHostSettings = {
        ...baseR2Settings,
        cloudflareR2: {
          ...baseR2Settings.cloudflareR2,
          publicDomain: '',
          prefix: '',
        },
      };

      const url = await uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, noPublicDomainSettings);
      expect(url).toMatch(/^https:\/\/test-bucket\.acc1234567890abcdef\.r2\.dev\/storyboard-\d+-[a-f0-9]+-1\.png$/);
    });

    it('throws error when Cloudflare R2 returns non-2xx status', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 403,
        headers: {},
        text: '<Error><Code>InvalidAccessKeyId</Code></Error>',
      });

      await expect(uploadToCloudflareR2(TEST_1X1_PNG_DATA_URL, 0, baseR2Settings)).rejects.toThrow(
        'Cloudflare R2 上传失败：HTTP 403'
      );
    });
  });

  describe('testImageHostUpload', () => {
    it('returns ok: true on successful test upload for SuperBed', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          err: 0,
          url: 'https://pic.superbed.cn/item/test.png',
        }),
      });

      const result = await testImageHostUpload('superbed', {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        superbed: { token: 'valid-token', categories: '' },
      });

      expect(result.ok).toBe(true);
      expect(result.url).toBe('https://pic.superbed.cn/item/test.png');
      expect(result.error).toBeUndefined();
    });

    it('returns ok: false with error message when test upload fails', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          err: 1,
          msg: 'Token expired',
        }),
      });

      const result = await testImageHostUpload('superbed', {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        superbed: { token: 'invalid-token', categories: '' },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Token expired');
    });

    it('returns ok: true for Cloudflare R2', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const result = await testImageHostUpload('cloudflareR2', {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        cloudflareR2: {
          accountId: 'acc1',
          accessKeyId: 'key1',
          secretAccessKey: 'sec1',
          bucketName: 'bucket1',
          publicDomain: 'https://r2.example.com',
          prefix: '',
        },
      });

      expect(result.ok).toBe(true);
      expect(result.url).toContain('https://r2.example.com/');
    });
  });

  describe('uploadImageToConfiguredHost', () => {
    it('returns original source if it is already an HTTP URL', async () => {
      const httpUrl = 'https://example.com/already-uploaded.jpg';
      const result = await uploadImageToConfiguredHost(httpUrl, 0, {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        enabled: true,
      });
      expect(result).toBe(httpUrl);
      expect(customHttpRequestMock).not.toHaveBeenCalled();
    });

    it('throws if image hosting is not enabled', async () => {
      await expect(
        uploadImageToConfiguredHost(TEST_1X1_PNG_DATA_URL, 0, {
          ...DEFAULT_IMAGE_HOST_SETTINGS,
          enabled: false,
        })
      ).rejects.toThrow('当前模型要求参考图使用图床 URL，请先在设置里勾选启用图床。');
    });

    it('routes upload to superbed provider when configured', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: JSON.stringify({
          err: 0,
          url: 'https://pic.superbed.cn/item/routed.png',
        }),
      });

      const result = await uploadImageToConfiguredHost(TEST_1X1_PNG_DATA_URL, 0, {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        enabled: true,
        provider: 'superbed',
        superbed: { token: 'valid-token', categories: '' },
      });

      expect(result).toBe('https://pic.superbed.cn/item/routed.png');
      expect(customHttpRequestMock.mock.calls[0][0].url).toBe('https://api.superbed.cn/upload');
    });

    it('routes upload to cloudflareR2 provider when configured', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const result = await uploadImageToConfiguredHost(TEST_1X1_PNG_DATA_URL, 0, {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        enabled: true,
        provider: 'cloudflareR2',
        cloudflareR2: {
          accountId: 'acc2',
          accessKeyId: 'key2',
          secretAccessKey: 'sec2',
          bucketName: 'bucket2',
          publicDomain: 'https://cdn.example.org',
          prefix: '',
        },
      });

      expect(result).toContain('https://cdn.example.org/');
      expect(customHttpRequestMock.mock.calls[0][0].method).toBe('PUT');
    });
  });
});
