import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseDataUrlBytes,
  sha256Hex,
  hmacSha256,
  toHex,
  uploadToVolcengineTos,
  uploadToTencentCos,
  uploadToCloudflareR2,
  testImageHostUpload,
  uploadImageToConfiguredHost,
  uploadMediaToConfiguredHost,
  fetchVolcengineTosBuckets,
  fetchTencentCosBuckets,
  fetchCloudflareR2Buckets,
  parseBucketsFromXml,
  parseXmlErrorMessage,
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

  describe('uploadToVolcengineTos', () => {
    const baseTosSettings: ImageHostSettings = {
      ...DEFAULT_IMAGE_HOST_SETTINGS,
      provider: 'volcengineTos',
      volcengineTos: {
        accessKeyId: 'test_ak_123',
        secretAccessKey: 'test_sk_456',
        region: 'cn-beijing',
        bucketName: 'test-tos-bucket',
        endpoint: '',
        publicDomain: 'https://cdn.tos.example.com',
        prefix: 'storyboard-assets',
      },
    };

    it('validates required fields', async () => {
      await expect(
        uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseTosSettings,
          volcengineTos: { ...baseTosSettings.volcengineTos, accessKeyId: '' },
        })
      ).rejects.toThrow('火山引擎 TOS 缺少 AccessKey ID');

      await expect(
        uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseTosSettings,
          volcengineTos: { ...baseTosSettings.volcengineTos, secretAccessKey: '' },
        })
      ).rejects.toThrow('火山引擎 TOS 缺少 SecretAccess Key');

      await expect(
        uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseTosSettings,
          volcengineTos: { ...baseTosSettings.volcengineTos, bucketName: '' },
        })
      ).rejects.toThrow('火山引擎 TOS 缺少存储桶名称 (Bucket)');
    });

    it('sends PUT request with Virtual-hosted style and S3 SigV4 headers, returns custom public domain URL', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const url = await uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, baseTosSettings);
      expect(url).toMatch(/^https:\/\/cdn\.tos\.example\.com\/storyboard-assets\/storyboard-\d+-[a-f0-9]+-1\.png$/);

      expect(customHttpRequestMock).toHaveBeenCalledTimes(1);
      const callArgs = customHttpRequestMock.mock.calls[0][0];
      expect(callArgs.method).toBe('PUT');
      expect(callArgs.bodyMode).toBe('raw');
      expect(callArgs.rawBody).toBe(TEST_1X1_PNG_DATA_URL);
      expect(callArgs.url).toContain('https://test-tos-bucket.tos-s3-cn-beijing.volces.com/storyboard-assets/');

      const headers = callArgs.headers;
      expect(headers.Host).toBe('test-tos-bucket.tos-s3-cn-beijing.volces.com');
      expect(headers['Content-Type']).toBe('image/png');
      expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect(headers.Authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=test_ak_123\/\d{8}\/cn-beijing\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
      );
    });

    it('returns default official TOS public domain when publicDomain is empty', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const noPublicDomainSettings: ImageHostSettings = {
        ...baseTosSettings,
        volcengineTos: {
          ...baseTosSettings.volcengineTos,
          publicDomain: '',
          prefix: '',
        },
      };

      const url = await uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, noPublicDomainSettings);
      expect(url).toMatch(/^https:\/\/test-tos-bucket\.tos-cn-beijing\.volces\.com\/storyboard-\d+-[a-f0-9]+-1\.png$/);
    });

    it('throws error when Volcengine TOS returns non-2xx status', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 403,
        headers: {},
        text: '<Error><Code>InvalidAccessKeyId</Code></Error>',
      });

      await expect(uploadToVolcengineTos(TEST_1X1_PNG_DATA_URL, 0, baseTosSettings)).rejects.toThrow(
        '火山引擎 TOS 上传失败：HTTP 403'
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
    it('returns ok: true on successful test upload for Volcengine TOS', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const result = await testImageHostUpload('volcengineTos', {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        volcengineTos: {
          accessKeyId: 'ak1',
          secretAccessKey: 'sk1',
          region: 'cn-beijing',
          bucketName: 'bucket1',
          endpoint: '',
          publicDomain: 'https://tos.example.com',
          prefix: '',
        },
      });

      expect(result.ok).toBe(true);
      expect(result.url).toContain('https://tos.example.com/');
      expect(result.error).toBeUndefined();
    });

    it('returns ok: false with error message when test upload fails', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 403,
        headers: {},
        text: 'AccessDenied',
      });

      const result = await testImageHostUpload('volcengineTos', {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        volcengineTos: {
          accessKeyId: 'ak1',
          secretAccessKey: 'sk1',
          region: 'cn-beijing',
          bucketName: 'bucket1',
          endpoint: '',
          publicDomain: '',
          prefix: '',
        },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('火山引擎 TOS 上传失败：HTTP 403');
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
      ).rejects.toThrow('当前模型要求参考素材使用对象存储 URL，请先在设置里勾选启用对象存储。');
    });

    it('routes upload to volcengineTos provider when configured', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const result = await uploadImageToConfiguredHost(TEST_1X1_PNG_DATA_URL, 0, {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        enabled: true,
        provider: 'volcengineTos',
        volcengineTos: {
          accessKeyId: 'ak1',
          secretAccessKey: 'sk1',
          region: 'cn-beijing',
          bucketName: 'bucket1',
          endpoint: '',
          publicDomain: 'https://tos.example.com',
          prefix: '',
        },
      });

      expect(result).toContain('https://tos.example.com/');
      expect(customHttpRequestMock.mock.calls[0][0].method).toBe('PUT');
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

    it('uploads video to volcengineTos and generates video object key', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const videoDataUrl = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t';
      const result = await uploadMediaToConfiguredHost(videoDataUrl, 0, {
        ...DEFAULT_IMAGE_HOST_SETTINGS,
        enabled: true,
        provider: 'volcengineTos',
        volcengineTos: {
          accessKeyId: 'ak1',
          secretAccessKey: 'sk1',
          region: 'cn-beijing',
          bucketName: 'bucket1',
          endpoint: '',
          publicDomain: '',
          prefix: 'videos',
        },
      }, 'video');

      expect(result).toContain('https://bucket1.tos-cn-beijing.volces.com/videos/storyboard-video-');
      expect(result).toMatch(/\.mp4$/);
      expect(customHttpRequestMock.mock.calls[0][0].method).toBe('PUT');
    });
  });

  describe('parseBucketsFromXml & parseXmlErrorMessage', () => {
    it('parses bucket list XML with Location and ExtranetEndpoint', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Owner>
    <ID>test-owner</ID>
    <DisplayName>test-display</DisplayName>
  </Owner>
  <Buckets>
    <Bucket>
      <Name>bucket-beijing</Name>
      <CreationDate>2024-01-01T00:00:00.000Z</CreationDate>
      <Location>tos-cn-beijing</Location>
      <ExtranetEndpoint>tos-cn-beijing.volces.com</ExtranetEndpoint>
    </Bucket>
    <Bucket>
      <Name>bucket-shanghai</Name>
      <CreationDate>2024-02-01T00:00:00.000Z</CreationDate>
      <LocationConstraint>cn-shanghai</LocationConstraint>
    </Bucket>
    <Bucket>
      <Name>bucket-guangzhou</Name>
      <CreationDate>2024-03-01T00:00:00.000Z</CreationDate>
      <ExtranetEndpoint>tos-s3-cn-guangzhou.volces.com</ExtranetEndpoint>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>`;

      const buckets = parseBucketsFromXml(xml);
      expect(buckets).toHaveLength(3);
      expect(buckets[0]).toEqual({
        name: 'bucket-beijing',
        region: 'cn-beijing',
        creationDate: '2024-01-01T00:00:00.000Z',
      });
      expect(buckets[1]).toEqual({
        name: 'bucket-shanghai',
        region: 'cn-shanghai',
        creationDate: '2024-02-01T00:00:00.000Z',
      });
      expect(buckets[2]).toEqual({
        name: 'bucket-guangzhou',
        region: 'cn-guangzhou',
        creationDate: '2024-03-01T00:00:00.000Z',
      });
    });

    it('parses friendly error messages from XML', () => {
      const invalidAkXml = `<Error><Code>InvalidAccessKeyId</Code><Message>The Access Key Id you provided does not exist.</Message></Error>`;
      expect(parseXmlErrorMessage(invalidAkXml)).toContain('AccessKey ID 不正确或不存在');

      const sigMismatchXml = `<Error><Code>SignatureDoesNotMatch</Code><Message>Signature mismatch.</Message></Error>`;
      expect(parseXmlErrorMessage(sigMismatchXml)).toContain('SecretAccess Key 不匹配');

      const accessDeniedXml = `<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>`;
      expect(parseXmlErrorMessage(accessDeniedXml)).toContain('tos:ListBuckets');

      const customErrorXml = `<Error><Code>QuotaExceeded</Code><Message>Limit reached</Message></Error>`;
      expect(parseXmlErrorMessage(customErrorXml)).toBe('[QuotaExceeded] Limit reached');

      expect(parseXmlErrorMessage('non-xml text')).toBeNull();
    });
  });

  describe('fetchVolcengineTosBuckets', () => {
    it('validates required AK/SK', async () => {
      await expect(
        fetchVolcengineTosBuckets({ accessKeyId: '', secretAccessKey: 'sk' })
      ).rejects.toThrow('缺少 AccessKey ID');

      await expect(
        fetchVolcengineTosBuckets({ accessKeyId: 'ak', secretAccessKey: '' })
      ).rejects.toThrow('缺少 SecretAccess Key');
    });

    it('sends signed GET request and returns parsed buckets', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: `<ListAllMyBucketsResult>
          <Buckets>
            <Bucket>
              <Name>my-vlog-media</Name>
              <Location>cn-beijing</Location>
              <CreationDate>2024-05-01T00:00:00.000Z</CreationDate>
            </Bucket>
          </Buckets>
        </ListAllMyBucketsResult>`,
      });

      const buckets = await fetchVolcengineTosBuckets({
        accessKeyId: 'test_ak',
        secretAccessKey: 'test_sk',
        region: 'cn-beijing',
      });

      expect(buckets).toHaveLength(1);
      expect(buckets[0].name).toBe('my-vlog-media');
      expect(buckets[0].region).toBe('cn-beijing');

      const call = customHttpRequestMock.mock.calls[0][0];
      expect(call.method).toBe('GET');
      expect(call.url).toBe('https://tos-s3-cn-beijing.volces.com/');
      expect(call.headers.Authorization).toContain('AWS4-HMAC-SHA256');
    });

    it('handles error response and throws parsed message', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 403,
        headers: {},
        text: `<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`,
      });

      await expect(
        fetchVolcengineTosBuckets({
          accessKeyId: 'test_ak',
          secretAccessKey: 'test_sk',
        })
      ).rejects.toThrow('tos:ListBuckets');
    });
  });

  describe('fetchCloudflareR2Buckets', () => {
    it('validates required fields', async () => {
      await expect(
        fetchCloudflareR2Buckets({ accountId: '', accessKeyId: 'ak', secretAccessKey: 'sk' })
      ).rejects.toThrow('缺少 Account ID');

      await expect(
        fetchCloudflareR2Buckets({ accountId: 'acc', accessKeyId: '', secretAccessKey: 'sk' })
      ).rejects.toThrow('缺少 Access Key ID');

      await expect(
        fetchCloudflareR2Buckets({ accountId: 'acc', accessKeyId: 'ak', secretAccessKey: '' })
      ).rejects.toThrow('缺少 Secret Access Key');
    });

    it('sends signed GET request and returns parsed buckets', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: `<ListAllMyBucketsResult>
          <Buckets>
            <Bucket>
              <Name>r2-canvas-bucket</Name>
              <CreationDate>2024-06-01T00:00:00.000Z</CreationDate>
            </Bucket>
          </Buckets>
        </ListAllMyBucketsResult>`,
      });

      const buckets = await fetchCloudflareR2Buckets({
        accountId: 'acc123',
        accessKeyId: 'ak123',
        secretAccessKey: 'sk123',
      });

      expect(buckets).toHaveLength(1);
      expect(buckets[0].name).toBe('r2-canvas-bucket');

      const call = customHttpRequestMock.mock.calls[0][0];
      expect(call.method).toBe('GET');
      expect(call.url).toBe('https://acc123.r2.cloudflarestorage.com/');
    });
  });

  describe('uploadToTencentCos', () => {
    const baseCosSettings: ImageHostSettings = {
      ...DEFAULT_IMAGE_HOST_SETTINGS,
      provider: 'tencentCos',
      tencentCos: {
        secretId: 'test_cos_secret_id',
        secretKey: 'test_cos_secret_key',
        region: 'ap-guangzhou',
        bucketName: 'test-bucket-1250000000',
        endpoint: '',
        publicDomain: 'https://cdn.cos.example.com',
        prefix: 'storyboard-assets',
      },
    };

    it('validates required fields', async () => {
      await expect(
        uploadToTencentCos(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseCosSettings,
          tencentCos: { ...baseCosSettings.tencentCos, secretId: '' },
        })
      ).rejects.toThrow('腾讯云 COS 缺少 SecretId');

      await expect(
        uploadToTencentCos(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseCosSettings,
          tencentCos: { ...baseCosSettings.tencentCos, secretKey: '' },
        })
      ).rejects.toThrow('腾讯云 COS 缺少 SecretKey');

      await expect(
        uploadToTencentCos(TEST_1X1_PNG_DATA_URL, 0, {
          ...baseCosSettings,
          tencentCos: { ...baseCosSettings.tencentCos, bucketName: '' },
        })
      ).rejects.toThrow('腾讯云 COS 缺少存储桶名称 (Bucket)');
    });

    it('performs Virtual-Hosted SigV4 PUT upload and returns URL with publicDomain', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '',
      });

      const url = await uploadToTencentCos(TEST_1X1_PNG_DATA_URL, 0, baseCosSettings);
      expect(url).toMatch(/^https:\/\/cdn\.cos\.example\.com\/storyboard-assets\/storyboard-\d+-[a-f0-9]+-1\.png$/);

      expect(customHttpRequestMock).toHaveBeenCalledTimes(1);
      const call = customHttpRequestMock.mock.calls[0][0];
      expect(call.method).toBe('PUT');
      expect(call.url).toMatch(/^https:\/\/test-bucket-1250000000\.cos\.ap-guangzhou\.myqcloud\.com\/storyboard-assets\//);
      expect(call.headers.Authorization).toContain('AWS4-HMAC-SHA256');
      expect(call.headers.Authorization).toContain('Credential=test_cos_secret_id/');
    });
  });

  describe('fetchTencentCosBuckets', () => {
    it('validates required fields', async () => {
      await expect(
        fetchTencentCosBuckets({ secretId: '', secretKey: 'sk' })
      ).rejects.toThrow('缺少 SecretId');

      await expect(
        fetchTencentCosBuckets({ secretId: 'id', secretKey: '' })
      ).rejects.toThrow('缺少 SecretKey');
    });

    it('sends signed GET request and returns parsed buckets', async () => {
      customHttpRequestMock.mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: `<ListAllMyBucketsResult>
          <Buckets>
            <Bucket>
              <Name>my-bucket-1250000000</Name>
              <Location>ap-guangzhou</Location>
              <CreationDate>2024-06-01T00:00:00.000Z</CreationDate>
            </Bucket>
          </Buckets>
        </ListAllMyBucketsResult>`,
      });

      const buckets = await fetchTencentCosBuckets({
        secretId: 'cos_id',
        secretKey: 'cos_key',
        region: 'ap-guangzhou',
      });

      expect(buckets).toHaveLength(1);
      expect(buckets[0].name).toBe('my-bucket-1250000000');
      expect(buckets[0].region).toBe('ap-guangzhou');

      const call = customHttpRequestMock.mock.calls[0][0];
      expect(call.method).toBe('GET');
      expect(call.url).toBe('https://cos.ap-guangzhou.myqcloud.com/');
    });
  });
});
