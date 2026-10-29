import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, FolderOpen, Plus, Trash2, CheckCircle2, ExternalLink, RotateCcw, LoaderCircle, Network, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { customHttpRequest } from '@/commands/ai';
import {
  DEFAULT_CANVAS_MOUSE_BINDINGS,
  TRADITIONAL_CANVAS_MOUSE_BINDINGS,
  DEFAULT_IMAGE_HOST_SETTINGS,
  useSettingsStore,
  type CanvasMouseAction,
  type CanvasMouseBindingPreset,
  type CanvasMouseBindingSlot,
  type CanvasMouseBindings,
  type ImageHostProvider,
  type ImageHostSettings,
  type GenerationNetworkRoute,
  type PanoramaControlSensitivity,
} from '@/stores/settingsStore';
import { UiCheckbox, UiSelect } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { listModelProviders } from '@/features/canvas/models';
import type { SettingsCategory } from '@/features/settings/settingsEvents';
import { CustomProvidersSection } from '@/components/settings/CustomProvidersSection';
import { AddProvidersSection, type AddProviderTab } from '@/components/settings/AddProvidersSection';
import { AgnesSettingsSection } from '@/components/settings/AgnesSettingsSection';
import { DreaminaSection } from '@/components/settings/DreaminaSection';
import { PromptManagementSection } from '@/components/settings/PromptManagementSection';
import { PromptPresetsSection } from '@/components/settings/PromptPresetsSection';
import { AudioModelsSection } from '@/components/settings/AudioModelsSection';
import { SettingsPortabilitySection } from '@/components/settings/SettingsPortabilitySection';
import { ExternalAgentConnectionPanel } from '@/features/canvas/agent/ui/ExternalAgentConnectionPanel';
import { buildExternalCanvasMcpManifest } from '@/features/canvas/agent/application/externalAgentToolManifest';
import { useProjectStore } from '@/stores/projectStore';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
  onCheckUpdate?: () => Promise<'has-update' | 'up-to-date' | 'failed'>;
}

interface SettingsCheckboxCardProps {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

import {
  testImageHostUpload,
  fetchVolcengineTosBuckets,
  fetchTencentCosBuckets,
  fetchCloudflareR2Buckets,
  type DiscoveredBucket,
} from '@/features/canvas/application/imageHosting';
import { normalizeImageHostSettings } from '@/stores/settingsStore';

type ImageHostSettingsPatch =
  Partial<Omit<ImageHostSettings, 'volcengineTos' | 'tencentCos' | 'cloudflareR2'>>
  & {
    volcengineTos?: Partial<ImageHostSettings['volcengineTos']>;
    tencentCos?: Partial<ImageHostSettings['tencentCos']>;
    cloudflareR2?: Partial<ImageHostSettings['cloudflareR2']>;
  };

const _UNUSED_PROVIDER_URLS_KEPT_FOR_FUTURE_USE: Record<string, string> = {
  ppio: 'https://ppio.com/user/register?invited_by=WGY0DZ',
  grsai: 'https://grsai.com',
  kie: 'https://kie.ai?ref=eef20ef0b0595cad227d45b29c635f6c',
  fal: 'https://fal.ai',
  ppio_keys: 'https://ppio.com/settings/key-management',
  grsai_keys: 'https://grsai.com/zh/dashboard/api-keys',
  kie_keys: 'https://kie.ai/api-key',
  fal_keys: 'https://fal.ai/dashboard/keys',
};
void _UNUSED_PROVIDER_URLS_KEPT_FOR_FUTURE_USE;

const PROJECT_REPOSITORY_URL = 'https://github.com/ganbo-gab/open-storyboard-canvas';
const ORIGINAL_PROJECT_URL = 'https://github.com/henjicc/Storyboard-Copilot';
const CANVAS_MOUSE_BINDING_SLOTS: CanvasMouseBindingSlot[] = [
  'leftClick',
  'leftDrag',
  'rightClick',
  'rightDrag',
  'middleClick',
  'middleDrag',
];
const CANVAS_MOUSE_ACTIONS: CanvasMouseAction[] = [
  'none',
  'selectNode',
  'panCanvas',
  'selectionBox',
  'nodeMenu',
];
const IMAGE_HOST_PROVIDERS: ImageHostProvider[] = ['volcengineTos', 'tencentCos', 'cloudflareR2'];

function normalizeSettingsCategory(category: SettingsCategory): SettingsCategory {
  if (category === 'providers' || category === 'providersNew' || category === 'providersOld' || category === 'providersChat') {
    return 'providersAdd';
  }
  if (category === 'textAgents') {
    return 'providersAdd';
  }
  return category;
}

function providerTabFromSettingsCategory(category: SettingsCategory): AddProviderTab {
  if (category === 'providersOld') {
    return 'imageOld';
  }
  if (category === 'providersChat' || category === 'textAgents') {
    return 'chat';
  }
  return 'imageNew';
}

function cloneImageHostSettings(settings?: unknown): ImageHostSettings {
  return normalizeImageHostSettings(settings ?? DEFAULT_IMAGE_HOST_SETTINGS);
}

function SettingsCheckboxCard({
  title,
  description,
  checked,
  onCheckedChange,
}: SettingsCheckboxCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCheckedChange(!checked);
        }
      }}
      className="w-full rounded-lg border border-border-dark bg-bg-dark p-4 text-left transition-colors hover:border-[rgba(255,255,255,0.2)]"
    >
      <div className="flex items-start gap-3">
        <UiCheckbox
          checked={checked}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
          onClick={(event) => event.stopPropagation()}
          className="mt-0.5 shrink-0"
        />
        <div>
          <h3 className="text-sm font-medium text-text-dark">{title}</h3>
          <p className="mt-1 text-xs text-text-muted">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({
  isOpen,
  onClose,
  initialCategory = 'general',
  onCheckUpdate,
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const {
    apiKeys,
    grsaiNanoBananaProModel,
    downloadPresetPaths,
    useUploadFilenameAsNodeTitle,
    storyboardGenKeepStyleConsistent,
    storyboardGenDisableTextInImage,
    storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating,
    appendParameterConstraintsToPrompt,
    collapseNodeActionToolbarByDefault,
    showNodePayloadPreview,
    generationNetworkSettings,
    enableAiTextStreaming,
    enableStoryboardGenGridPreviewShortcut,
    showStoryboardGenAdvancedRatioControls,
    useLegacyPanoramaControlDirection,
    panoramaControlSensitivity,
    canvasMouseBindingPreset,
    canvasMouseBindings,
    enableCanvasWasdPan,
    canvasWasdPanSensitivity,
    uiRadiusPreset,
    themeTonePreset,
    accentColor,
    canvasEdgeRoutingMode,
    autoCheckAppUpdateOnLaunch,
    enableUpdateDialog,
    imageHostSettings,
    setProviderApiKey,
    setGrsaiNanoBananaProModel,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setAppendParameterConstraintsToPrompt,
    setCollapseNodeActionToolbarByDefault,
    setShowNodePayloadPreview,
    setGenerationNetworkSettings,
    setEnableAiTextStreaming,
    setEnableStoryboardGenGridPreviewShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setUseLegacyPanoramaControlDirection,
    setPanoramaControlSensitivity,
    setCanvasMouseBindingPreset,
    setCanvasMouseBindings,
    setEnableCanvasWasdPan,
    setCanvasWasdPanSensitivity,
    setUiRadiusPreset,
    setThemeTonePreset,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setAutoCheckAppUpdateOnLaunch,
    setEnableUpdateDialog,
    setImageHostSettings,
  } = useSettingsStore();
  const providers = useMemo(() => {
    // Per product decision: only GRSAI is a built-in provider for now. The
    // others are exposed via the new "Custom provider" and "Dreamina" sections,
    // so we filter them out of the classic provider list here.
    const visibleIds = new Set(['grsai']);
    return listModelProviders().slice().filter((p) => visibleIds.has(p.id));
  }, []);
  const externalAgentProject = useProjectStore((state) => state.currentProject);
  const externalAgentTools = useMemo(() => buildExternalCanvasMcpManifest([
    'canvas', 'diagnostics', 'config', 'asset-read',
  ]).tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, requiresApproval: true })), []);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    normalizeSettingsCategory(initialCategory)
  );
  const [activeProviderAddTab, setActiveProviderAddTab] = useState<AddProviderTab>(
    providerTabFromSettingsCategory(initialCategory)
  );
  const [appVersion, setAppVersion] = useState<string>('');
  const [localApiKeys, setLocalApiKeys] = useState<Record<string, string>>(apiKeys);
  const [localGrsaiNanoBananaProModel, setLocalGrsaiNanoBananaProModel] = useState(
    grsaiNanoBananaProModel
  );
  const [localDownloadPathInput, setLocalDownloadPathInput] = useState('');
  const [localDownloadPresetPaths, setLocalDownloadPresetPaths] = useState(downloadPresetPaths);
  const [localUseUploadFilenameAsNodeTitle, setLocalUseUploadFilenameAsNodeTitle] = useState(
    useUploadFilenameAsNodeTitle
  );
  const [localStoryboardGenKeepStyleConsistent, setLocalStoryboardGenKeepStyleConsistent] =
    useState(storyboardGenKeepStyleConsistent);
  const [localStoryboardGenDisableTextInImage, setLocalStoryboardGenDisableTextInImage] = useState(
    storyboardGenDisableTextInImage
  );
  const [localStoryboardGenAutoInferEmptyFrame, setLocalStoryboardGenAutoInferEmptyFrame] = useState(
    storyboardGenAutoInferEmptyFrame
  );
  const [localIgnoreAtTagWhenCopyingAndGenerating, setLocalIgnoreAtTagWhenCopyingAndGenerating] =
    useState(ignoreAtTagWhenCopyingAndGenerating);
  const [localAppendParameterConstraintsToPrompt, setLocalAppendParameterConstraintsToPrompt] =
    useState(appendParameterConstraintsToPrompt);
  const [localCollapseNodeActionToolbarByDefault, setLocalCollapseNodeActionToolbarByDefault] =
    useState(collapseNodeActionToolbarByDefault);
  const [localShowNodePayloadPreview, setLocalShowNodePayloadPreview] =
    useState(showNodePayloadPreview);
  const [localGenerationNetworkRoute, setLocalGenerationNetworkRoute] =
    useState<GenerationNetworkRoute>(generationNetworkSettings.route);
  const [localCustomProxyUrl, setLocalCustomProxyUrl] =
    useState(generationNetworkSettings.customProxyUrl);
  const [networkTestStatus, setNetworkTestStatus] = useState<'' | 'testing' | 'success' | 'failed'>('');
  const [localEnableAiTextStreaming, setLocalEnableAiTextStreaming] =
    useState(enableAiTextStreaming);
  const [localEnableStoryboardGenGridPreviewShortcut, setLocalEnableStoryboardGenGridPreviewShortcut] =
    useState(enableStoryboardGenGridPreviewShortcut);
  const [localShowStoryboardGenAdvancedRatioControls, setLocalShowStoryboardGenAdvancedRatioControls] =
    useState(showStoryboardGenAdvancedRatioControls);
  const [localUseLegacyPanoramaControlDirection, setLocalUseLegacyPanoramaControlDirection] =
    useState(useLegacyPanoramaControlDirection);
  const [localPanoramaControlSensitivity, setLocalPanoramaControlSensitivity] =
    useState<PanoramaControlSensitivity>(panoramaControlSensitivity);
  const [localCanvasMouseBindingPreset, setLocalCanvasMouseBindingPreset] =
    useState<CanvasMouseBindingPreset>(canvasMouseBindingPreset);
  const [localCanvasMouseBindings, setLocalCanvasMouseBindings] =
    useState<CanvasMouseBindings>(canvasMouseBindings);
  const [localEnableCanvasWasdPan, setLocalEnableCanvasWasdPan] =
    useState(enableCanvasWasdPan);
  const [localCanvasWasdPanSensitivity, setLocalCanvasWasdPanSensitivity] =
    useState(canvasWasdPanSensitivity);
  const [localUiRadiusPreset, setLocalUiRadiusPreset] = useState(uiRadiusPreset);
  const [localThemeTonePreset, setLocalThemeTonePreset] = useState(themeTonePreset);
  const [localAccentColor, setLocalAccentColor] = useState(accentColor);
  const [localCanvasEdgeRoutingMode, setLocalCanvasEdgeRoutingMode] = useState(canvasEdgeRoutingMode);
  const [localAutoCheckAppUpdateOnLaunch, setLocalAutoCheckAppUpdateOnLaunch] = useState(
    autoCheckAppUpdateOnLaunch
  );
  const [localEnableUpdateDialog, setLocalEnableUpdateDialog] = useState(enableUpdateDialog);
  const [localImageHostSettings, setLocalImageHostSettings] = useState<ImageHostSettings>(
    () => cloneImageHostSettings(imageHostSettings ?? DEFAULT_IMAGE_HOST_SETTINGS)
  );
  const [testingImageHost, setTestingImageHost] = useState<ImageHostProvider | null>(null);
  const [testResult, setTestResult] = useState<{ provider: ImageHostProvider; ok: boolean; message: string } | null>(null);
  const [isFetchingBuckets, setIsFetchingBuckets] = useState<ImageHostProvider | null>(null);
  const [discoveredTosBuckets, setDiscoveredTosBuckets] = useState<DiscoveredBucket[]>([]);
  const [discoveredCosBuckets, setDiscoveredCosBuckets] = useState<DiscoveredBucket[]>([]);
  const [discoveredR2Buckets, setDiscoveredR2Buckets] = useState<DiscoveredBucket[]>([]);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string>('');
  const [checkUpdateStatus, setCheckUpdateStatus] = useState<'' | 'checking' | 'has-update' | 'up-to-date' | 'failed'>('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);
  const requestClose = useCallback(() => {
    if (!isSavingSettings) {
      onClose();
    }
  }, [isSavingSettings, onClose]);
  const { dialogRef, onKeyDown } = useModalFocus({ isOpen: isOpen && shouldRender, onClose: requestClose });

  useEffect(() => {
    let mounted = true;
    if (!isTauri()) {
      setAppVersion('');
      return () => {
        mounted = false;
      };
    }
    const loadAppVersion = async () => {
      try {
        const version = await getVersion();
        if (mounted) {
          setAppVersion(version);
        }
      } catch {
        if (mounted) {
          setAppVersion('');
        }
      }
    };
    void loadAppVersion();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLocalApiKeys(apiKeys);
    setLocalDownloadPresetPaths(downloadPresetPaths);
    setLocalGrsaiNanoBananaProModel(grsaiNanoBananaProModel);
    setLocalUseUploadFilenameAsNodeTitle(useUploadFilenameAsNodeTitle);
    setLocalStoryboardGenKeepStyleConsistent(storyboardGenKeepStyleConsistent);
    setLocalStoryboardGenDisableTextInImage(storyboardGenDisableTextInImage);
    setLocalStoryboardGenAutoInferEmptyFrame(storyboardGenAutoInferEmptyFrame);
    setLocalIgnoreAtTagWhenCopyingAndGenerating(ignoreAtTagWhenCopyingAndGenerating);
    setLocalAppendParameterConstraintsToPrompt(appendParameterConstraintsToPrompt);
    setLocalCollapseNodeActionToolbarByDefault(collapseNodeActionToolbarByDefault);
    setLocalShowNodePayloadPreview(showNodePayloadPreview);
    setLocalGenerationNetworkRoute(generationNetworkSettings.route);
    setLocalCustomProxyUrl(generationNetworkSettings.customProxyUrl);
    setNetworkTestStatus('');
    setLocalEnableAiTextStreaming(enableAiTextStreaming);
    setLocalEnableStoryboardGenGridPreviewShortcut(enableStoryboardGenGridPreviewShortcut);
    setLocalShowStoryboardGenAdvancedRatioControls(showStoryboardGenAdvancedRatioControls);
    setLocalUseLegacyPanoramaControlDirection(useLegacyPanoramaControlDirection);
    setLocalPanoramaControlSensitivity(panoramaControlSensitivity);
    setLocalCanvasMouseBindingPreset(canvasMouseBindingPreset);
    setLocalCanvasMouseBindings(canvasMouseBindings);
    setLocalEnableCanvasWasdPan(enableCanvasWasdPan);
    setLocalCanvasWasdPanSensitivity(canvasWasdPanSensitivity);
    setLocalUiRadiusPreset(uiRadiusPreset);
    setLocalThemeTonePreset(themeTonePreset);
    setLocalAccentColor(accentColor);
    setLocalCanvasEdgeRoutingMode(canvasEdgeRoutingMode);
    setLocalAutoCheckAppUpdateOnLaunch(autoCheckAppUpdateOnLaunch);
    setLocalEnableUpdateDialog(enableUpdateDialog);
    setLocalImageHostSettings(cloneImageHostSettings(imageHostSettings ?? DEFAULT_IMAGE_HOST_SETTINGS));
    setDiscoveredTosBuckets([]);
    setDiscoveredR2Buckets([]);
    setIsFetchingBuckets(null);
    setTestResult(null);
    setSettingsSaveError('');
    setIsSavingSettings(false);
    setCheckUpdateStatus('');
    setLocalDownloadPathInput('');
  }, [
    isOpen,
  ]);

  const handleTestGenerationNetwork = useCallback(async () => {
    setNetworkTestStatus('testing');
    try {
      const response = await customHttpRequest({
        url: 'https://www.gstatic.com/generate_204',
        method: 'GET',
        timeoutMs: 12_000,
        networkRoute: localGenerationNetworkRoute,
        customProxyUrl: localGenerationNetworkRoute === 'custom-proxy'
          ? localCustomProxyUrl.trim()
          : undefined,
      });
      setNetworkTestStatus(response.status >= 200 && response.status < 400 ? 'success' : 'failed');
    } catch {
      setNetworkTestStatus('failed');
    }
  }, [localCustomProxyUrl, localGenerationNetworkRoute]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveCategory(normalizeSettingsCategory(initialCategory));
    setActiveProviderAddTab(providerTabFromSettingsCategory(initialCategory));
  }, [initialCategory, isOpen]);

  const handleSave = useCallback(async () => {
    if (isSavingSettings) {
      return;
    }

    setIsSavingSettings(true);
    setSettingsSaveError('');
    try {
      const nextImageHostSettings = cloneImageHostSettings(localImageHostSettings);
      if (
        nextImageHostSettings.enabled
        && nextImageHostSettings.provider === 'volcengineTos'
      ) {
        if (!nextImageHostSettings.volcengineTos.accessKeyId.trim()
          || !nextImageHostSettings.volcengineTos.secretAccessKey.trim()
          || !nextImageHostSettings.volcengineTos.bucketName.trim()) {
          throw new Error('settings.imageHosting.errors.missingVolcengineTosCredentials');
        }
      }
      if (
        nextImageHostSettings.enabled
        && nextImageHostSettings.provider === 'tencentCos'
      ) {
        if (!nextImageHostSettings.tencentCos.secretId.trim()
          || !nextImageHostSettings.tencentCos.secretKey.trim()
          || !nextImageHostSettings.tencentCos.bucketName.trim()) {
          throw new Error('settings.imageHosting.errors.missingTencentCosCredentials');
        }
      }
      if (
        nextImageHostSettings.enabled
        && nextImageHostSettings.provider === 'cloudflareR2'
      ) {
        if (!nextImageHostSettings.cloudflareR2.accountId.trim()
          || !nextImageHostSettings.cloudflareR2.accessKeyId.trim()
          || !nextImageHostSettings.cloudflareR2.secretAccessKey.trim()
          || !nextImageHostSettings.cloudflareR2.bucketName.trim()) {
          throw new Error('settings.imageHosting.errors.missingCloudflareR2Credentials');
        }
      }
      if (localGenerationNetworkRoute === 'custom-proxy') {
        try {
          const proxyUrl = new URL(localCustomProxyUrl.trim());
          if (!/^https?:$/.test(proxyUrl.protocol) || !proxyUrl.hostname) {
            throw new Error('invalid proxy');
          }
        } catch {
          throw new Error('settings.generationNetworkInvalidProxy');
        }
      }

      providers.forEach((provider) => {
        setProviderApiKey(provider.id, localApiKeys[provider.id] ?? '');
      });
      setGrsaiNanoBananaProModel(localGrsaiNanoBananaProModel);
      setDownloadPresetPaths(localDownloadPresetPaths);
      setUseUploadFilenameAsNodeTitle(localUseUploadFilenameAsNodeTitle);
      setStoryboardGenKeepStyleConsistent(localStoryboardGenKeepStyleConsistent);
      setStoryboardGenDisableTextInImage(localStoryboardGenDisableTextInImage);
      setStoryboardGenAutoInferEmptyFrame(localStoryboardGenAutoInferEmptyFrame);
      setIgnoreAtTagWhenCopyingAndGenerating(localIgnoreAtTagWhenCopyingAndGenerating);
      setAppendParameterConstraintsToPrompt(localAppendParameterConstraintsToPrompt);
      setCollapseNodeActionToolbarByDefault(localCollapseNodeActionToolbarByDefault);
      setShowNodePayloadPreview(localShowNodePayloadPreview);
      setGenerationNetworkSettings({
        route: localGenerationNetworkRoute,
        customProxyUrl: localCustomProxyUrl,
      });
      setEnableAiTextStreaming(localEnableAiTextStreaming);
      setEnableStoryboardGenGridPreviewShortcut(localEnableStoryboardGenGridPreviewShortcut);
      setShowStoryboardGenAdvancedRatioControls(localShowStoryboardGenAdvancedRatioControls);
      setUseLegacyPanoramaControlDirection(localUseLegacyPanoramaControlDirection);
      setPanoramaControlSensitivity(localPanoramaControlSensitivity);
      if (localCanvasMouseBindingPreset === 'custom') {
        setCanvasMouseBindings(localCanvasMouseBindings);
      } else {
        setCanvasMouseBindingPreset(localCanvasMouseBindingPreset);
      }
      setEnableCanvasWasdPan(localEnableCanvasWasdPan);
      setCanvasWasdPanSensitivity(localCanvasWasdPanSensitivity);
      setUiRadiusPreset(localUiRadiusPreset);
      setThemeTonePreset(localThemeTonePreset);
      setAccentColor(localAccentColor);
      setCanvasEdgeRoutingMode(localCanvasEdgeRoutingMode);
      setAutoCheckAppUpdateOnLaunch(localAutoCheckAppUpdateOnLaunch);
      setEnableUpdateDialog(localEnableUpdateDialog);
      setImageHostSettings(nextImageHostSettings);
      setLocalImageHostSettings(nextImageHostSettings);
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 1500);
    } catch (error) {
      const messageKey = error instanceof Error ? error.message : '';
      const fallback = t('settings.imageHosting.errors.saveFailed');
      setSettingsSaveError(
        messageKey.startsWith('settings.')
          ? t(messageKey)
          : (messageKey || fallback)
      );
    } finally {
      setIsSavingSettings(false);
    }
  }, [
    isSavingSettings,
    localApiKeys,
    localDownloadPresetPaths,
    localGrsaiNanoBananaProModel,
    localUseUploadFilenameAsNodeTitle,
    localStoryboardGenKeepStyleConsistent,
    localStoryboardGenDisableTextInImage,
    localStoryboardGenAutoInferEmptyFrame,
    localIgnoreAtTagWhenCopyingAndGenerating,
    localAppendParameterConstraintsToPrompt,
    localCollapseNodeActionToolbarByDefault,
    localShowNodePayloadPreview,
    localGenerationNetworkRoute,
    localCustomProxyUrl,
    localEnableAiTextStreaming,
    localEnableStoryboardGenGridPreviewShortcut,
    localShowStoryboardGenAdvancedRatioControls,
    localUseLegacyPanoramaControlDirection,
    localPanoramaControlSensitivity,
    localCanvasMouseBindingPreset,
    localCanvasMouseBindings,
    localEnableCanvasWasdPan,
    localCanvasWasdPanSensitivity,
    localUiRadiusPreset,
    localThemeTonePreset,
    localAccentColor,
    localCanvasEdgeRoutingMode,
    localAutoCheckAppUpdateOnLaunch,
    localEnableUpdateDialog,
    localImageHostSettings,
    imageHostSettings,
    providers,
    t,
    setProviderApiKey,
    setGrsaiNanoBananaProModel,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setAppendParameterConstraintsToPrompt,
    setCollapseNodeActionToolbarByDefault,
    setShowNodePayloadPreview,
    setGenerationNetworkSettings,
    setEnableAiTextStreaming,
    setEnableStoryboardGenGridPreviewShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setUseLegacyPanoramaControlDirection,
    setPanoramaControlSensitivity,
    setCanvasMouseBindingPreset,
    setCanvasMouseBindings,
    setEnableCanvasWasdPan,
    setCanvasWasdPanSensitivity,
    setUiRadiusPreset,
    setThemeTonePreset,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setAutoCheckAppUpdateOnLaunch,
    setEnableUpdateDialog,
    setImageHostSettings,
  ]);

  const handleOpenRepository = useCallback(() => {
    void openUrl(PROJECT_REPOSITORY_URL);
  }, []);

  const handleOpenOriginalProject = useCallback(() => {
    void openUrl(ORIGINAL_PROJECT_URL);
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    if (!onCheckUpdate) {
      return;
    }

    setCheckUpdateStatus('checking');
    const status = await onCheckUpdate();
    setCheckUpdateStatus(status);
  }, [onCheckUpdate]);

  const handlePickDownloadPath = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setLocalDownloadPresetPaths((previous) => {
        if (previous.includes(selected)) {
          return previous;
        }
        return [...previous, selected].slice(0, 8);
      });
    } catch (error) {
      console.error('Failed to pick download path', error);
    }
  }, []);

  const handleAddDownloadPathFromInput = useCallback(() => {
    const next = localDownloadPathInput.trim();
    if (!next) {
      return;
    }
    setLocalDownloadPresetPaths((previous) => {
      if (previous.includes(next)) {
        return previous;
      }
      return [...previous, next].slice(0, 8);
    });
    setLocalDownloadPathInput('');
  }, [localDownloadPathInput]);

  const handleRemoveDownloadPath = useCallback((path: string) => {
    setLocalDownloadPresetPaths((previous) => previous.filter((value) => value !== path));
  }, []);

  const updateLocalImageHostSettings = useCallback((patch: ImageHostSettingsPatch) => {
    setLocalImageHostSettings((previous) => {
      const normalized = normalizeImageHostSettings(previous);
      return {
        ...normalized,
        ...patch,
        volcengineTos: {
          ...normalized.volcengineTos,
          ...(patch.volcengineTos ?? {}),
        },
        tencentCos: {
          ...normalized.tencentCos,
          ...(patch.tencentCos ?? {}),
        },
        cloudflareR2: {
          ...normalized.cloudflareR2,
          ...(patch.cloudflareR2 ?? {}),
        },
      };
    });
    setSettingsSaveError('');
    setTestResult(null);
  }, []);

  const handleTestImageHost = useCallback(
    async (provider: ImageHostProvider) => {
      setTestingImageHost(provider);
      setTestResult(null);
      try {
        const result = await testImageHostUpload(provider, localImageHostSettings);
        if (result.ok) {
          setTestResult({
            provider,
            ok: true,
            message: `${t('settings.imageHosting.testSuccess')}: ${result.url ?? ''}`,
          });
        } else {
          setTestResult({
            provider,
            ok: false,
            message: result.error || t('settings.imageHosting.testFailed'),
          });
        }
      } catch (err) {
        setTestResult({
          provider,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setTestingImageHost(null);
      }
    },
    [localImageHostSettings, t]
  );

  const handleFetchTosBuckets = useCallback(async () => {
    if (
      !localImageHostSettings.volcengineTos.accessKeyId.trim() ||
      !localImageHostSettings.volcengineTos.secretAccessKey.trim()
    ) {
      setTestResult({
        provider: 'volcengineTos',
        ok: false,
        message: t('settings.imageHosting.missingFetchCredentialsTos'),
      });
      return;
    }

    setIsFetchingBuckets('volcengineTos');
    setTestResult(null);
    try {
      const buckets = await fetchVolcengineTosBuckets({
        accessKeyId: localImageHostSettings.volcengineTos.accessKeyId,
        secretAccessKey: localImageHostSettings.volcengineTos.secretAccessKey,
        region: localImageHostSettings.volcengineTos.region,
        endpoint: localImageHostSettings.volcengineTos.endpoint,
      });
      setDiscoveredTosBuckets(buckets);
      if (buckets.length === 0) {
        setTestResult({
          provider: 'volcengineTos',
          ok: false,
          message: t('settings.imageHosting.fetchBucketsEmpty'),
        });
      } else {
        setTestResult({
          provider: 'volcengineTos',
          ok: true,
          message: t('settings.imageHosting.fetchBucketsSuccess', { count: buckets.length }),
        });
      }
    } catch (err) {
      setTestResult({
        provider: 'volcengineTos',
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsFetchingBuckets(null);
    }
  }, [localImageHostSettings.volcengineTos, t]);

  const handleFetchCosBuckets = useCallback(async () => {
    if (
      !localImageHostSettings.tencentCos.secretId.trim() ||
      !localImageHostSettings.tencentCos.secretKey.trim()
    ) {
      setTestResult({
        provider: 'tencentCos',
        ok: false,
        message: t('settings.imageHosting.missingFetchCredentialsCos'),
      });
      return;
    }

    setIsFetchingBuckets('tencentCos');
    setTestResult(null);
    try {
      const buckets = await fetchTencentCosBuckets({
        secretId: localImageHostSettings.tencentCos.secretId,
        secretKey: localImageHostSettings.tencentCos.secretKey,
        region: localImageHostSettings.tencentCos.region,
        endpoint: localImageHostSettings.tencentCos.endpoint,
      });
      setDiscoveredCosBuckets(buckets);
      if (buckets.length === 0) {
        setTestResult({
          provider: 'tencentCos',
          ok: false,
          message: t('settings.imageHosting.fetchBucketsEmpty'),
        });
      } else {
        setTestResult({
          provider: 'tencentCos',
          ok: true,
          message: t('settings.imageHosting.fetchBucketsSuccess', { count: buckets.length }),
        });
      }
    } catch (err) {
      setTestResult({
        provider: 'tencentCos',
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsFetchingBuckets(null);
    }
  }, [localImageHostSettings.tencentCos, t]);

  const handleFetchR2Buckets = useCallback(async () => {
    if (
      !localImageHostSettings.cloudflareR2.accountId.trim() ||
      !localImageHostSettings.cloudflareR2.accessKeyId.trim() ||
      !localImageHostSettings.cloudflareR2.secretAccessKey.trim()
    ) {
      setTestResult({
        provider: 'cloudflareR2',
        ok: false,
        message: t('settings.imageHosting.missingFetchCredentialsR2'),
      });
      return;
    }

    setIsFetchingBuckets('cloudflareR2');
    setTestResult(null);
    try {
      const buckets = await fetchCloudflareR2Buckets({
        accountId: localImageHostSettings.cloudflareR2.accountId,
        accessKeyId: localImageHostSettings.cloudflareR2.accessKeyId,
        secretAccessKey: localImageHostSettings.cloudflareR2.secretAccessKey,
      });
      setDiscoveredR2Buckets(buckets);
      if (buckets.length === 0) {
        setTestResult({
          provider: 'cloudflareR2',
          ok: false,
          message: t('settings.imageHosting.fetchBucketsEmpty'),
        });
      } else {
        setTestResult({
          provider: 'cloudflareR2',
          ok: true,
          message: t('settings.imageHosting.fetchBucketsSuccess', { count: buckets.length }),
        });
      }
    } catch (err) {
      setTestResult({
        provider: 'cloudflareR2',
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsFetchingBuckets(null);
    }
  }, [localImageHostSettings.cloudflareR2, t]);

  const handleCanvasMousePresetChange = useCallback((preset: CanvasMouseBindingPreset) => {
    setLocalCanvasMouseBindingPreset(preset);
    if (preset === 'default') {
      setLocalCanvasMouseBindings({ ...DEFAULT_CANVAS_MOUSE_BINDINGS });
    } else if (preset === 'traditional') {
      setLocalCanvasMouseBindings({ ...TRADITIONAL_CANVAS_MOUSE_BINDINGS });
    }
  }, []);

  const handleCanvasMouseBindingChange = useCallback(
    (slot: CanvasMouseBindingSlot, action: CanvasMouseAction) => {
      setLocalCanvasMouseBindingPreset('custom');
      setLocalCanvasMouseBindings((previous) => ({
        ...previous,
        [slot]: action,
      }));
    },
    []
  );

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/90 transition-opacity duration-[180ms] ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={requestClose}
      />
      <div className="relative w-[min(96vw,1120px)]">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.title')}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={`relative mx-auto flex h-[min(86dvh,760px)] w-full flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl transition-[opacity,transform] duration-[180ms] ease-out sm:flex-row ${isVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-[0.99] opacity-0'}`}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={requestClose}
            className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark sm:right-3 sm:top-3"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>

          {/* Sidebar */}
          <div className="ui-scrollbar flex w-full shrink-0 flex-col overflow-hidden border-b border-border-dark bg-bg-dark sm:h-auto sm:w-[180px] sm:overflow-y-auto sm:border-b-0 sm:border-r">
            <div className="hidden px-4 py-4 sm:block">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                {t('settings.title')}
              </span>
            </div>

            <nav className="ui-scrollbar mr-12 flex flex-1 overflow-x-auto [&>button]:w-auto [&>button]:shrink-0 sm:mr-0 sm:block sm:overflow-visible sm:[&>button]:w-full">
              <button
                onClick={() => setActiveCategory('general')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'general'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.general')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('keybindings')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'keybindings'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.keybindings')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('providersAdd')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'providersAdd'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.addProvider')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('customProviders')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'customProviders'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.myConfigurations')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('dreamina')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'dreamina'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.dreamina.title')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('agnes')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'agnes'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">Agnes</span>
              </button>

              <button
                onClick={() => setActiveCategory('imageHosting')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'imageHosting'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.imageHosting.title')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('audioModels')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'audioModels'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.audioModels.title')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('promptManagement')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'promptManagement'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.promptManagement.title')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('promptPresets')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'promptPresets'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.promptPresets.title')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('appearance')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'appearance'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.appearance')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('externalAgents')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'externalAgents'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.externalAgents')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('portability')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'portability'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('portability.settings.nav')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('about')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'about'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.about')}</span>
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {activeCategory === 'portability' && <SettingsPortabilitySection />}
            {activeCategory === 'externalAgents' && (
              <div className="ui-scrollbar flex-1 overflow-y-auto p-6">
                <div className="mb-4"><h2 className="text-lg font-semibold text-text-dark">{t('settings.externalAgents')}</h2><p className="mt-1 text-sm text-text-muted">{t('settings.externalAgentsDescription')}</p></div>
                <ExternalAgentConnectionPanel projectId={externalAgentProject?.id ?? null} projectName={externalAgentProject?.name ?? null} tools={externalAgentTools} />
              </div>
            )}
            {activeCategory === 'customProviders' && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="ui-scrollbar flex-1 overflow-y-auto px-6 py-5">
                  <CustomProvidersSection
                    mode="list"
                    onRequestAdd={(target) => {
                      setActiveProviderAddTab(
                        target === 'old' ? 'imageOld' : target === 'video' ? 'video' : target === 'chat' ? 'chat' : 'imageNew'
                      );
                      setActiveCategory('providersAdd');
                    }}
                  />
                </div>
              </div>
            )}

            {activeCategory === 'dreamina' && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="ui-scrollbar flex-1 overflow-y-auto px-6 py-5">
                  <DreaminaSection />
                </div>
              </div>
            )}

            {activeCategory === 'promptManagement' && <PromptManagementSection />}

            {activeCategory === 'promptPresets' && <PromptPresetsSection />}

            {activeCategory === 'audioModels' && <AudioModelsSection />}

            {activeCategory === 'providersAdd' && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="ui-scrollbar flex-1 overflow-y-auto px-6 py-5">
                  <AddProvidersSection
                    activeTab={activeProviderAddTab}
                    onTabChange={setActiveProviderAddTab}
                  />
                </div>

                <div className="shrink-0 flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={requestClose}
                    className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </div>
            )}

            {activeCategory === 'agnes' && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="ui-scrollbar flex-1 overflow-y-auto px-6 py-5">
                  <AgnesSettingsSection />
                </div>

                <div className="shrink-0 flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={requestClose}
                    className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </div>
            )}

            {activeCategory === 'imageHosting' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.imageHosting.title')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.imageHosting.desc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="flex items-start gap-3">
                      <UiCheckbox
                        checked={localImageHostSettings.enabled}
                        onCheckedChange={(checked) =>
                          updateLocalImageHostSettings({ enabled: checked })
                        }
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium text-text-dark">
                          {t('settings.imageHosting.enable')}
                        </h3>
                        <p className="mt-1 text-xs text-text-muted">
                          {t('settings.imageHosting.enableDesc')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.imageHosting.provider')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.imageHosting.providerDesc')}
                      </p>
                    </div>
                    <UiSelect
                      value={localImageHostSettings.provider}
                      onChange={(event) =>
                        updateLocalImageHostSettings({
                          provider: event.target.value as ImageHostProvider,
                        })
                      }
                      aria-label={t('settings.imageHosting.provider')}
                    >
                      {IMAGE_HOST_PROVIDERS.map((provider) => (
                        <option key={provider} value={provider}>
                          {t(`settings.imageHosting.providers.${provider}`)}
                        </option>
                      ))}
                    </UiSelect>
                  </div>

                  {localImageHostSettings.provider === 'volcengineTos' && (
                    <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium text-text-dark">
                            {t('settings.imageHosting.volcengineTos.title')}
                          </h3>
                          <p className="mt-1 text-xs text-text-muted">
                            {t('settings.imageHosting.volcengineTos.desc')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            disabled={isFetchingBuckets !== null || testingImageHost !== null}
                            onClick={() => void handleFetchTosBuckets()}
                            title="获取账号下的所有可用存储桶并供选择填充"
                          >
                            {isFetchingBuckets === 'volcengineTos' ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            {isFetchingBuckets === 'volcengineTos'
                              ? t('settings.imageHosting.fetchingBuckets')
                              : t('settings.imageHosting.fetchBuckets')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            disabled={testingImageHost !== null}
                            onClick={() => void handleTestImageHost('volcengineTos')}
                          >
                            {testingImageHost === 'volcengineTos' ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {testingImageHost === 'volcengineTos'
                              ? t('settings.imageHosting.testing')
                              : t('settings.imageHosting.testUpload')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                            onClick={() =>
                              updateLocalImageHostSettings({
                                volcengineTos: { ...DEFAULT_IMAGE_HOST_SETTINGS.volcengineTos },
                              })
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('settings.imageHosting.restoreDefaults')}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.volcengineTos.accessKeyId')}
                          <input
                            value={localImageHostSettings.volcengineTos.accessKeyId}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { accessKeyId: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.accessKeyIdPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.volcengineTos.secretAccessKey')}
                          <input
                            type="password"
                            value={localImageHostSettings.volcengineTos.secretAccessKey}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { secretAccessKey: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.secretAccessKeyPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.volcengineTos.region')}
                          <input
                            value={localImageHostSettings.volcengineTos.region}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { region: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.regionPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <div className="flex flex-col justify-end">
                          <div className="flex items-center justify-between pb-1">
                            <span className="text-xs font-medium text-text-muted">
                              {t('settings.imageHosting.volcengineTos.bucketName')}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-50"
                              disabled={isFetchingBuckets !== null || testingImageHost !== null}
                              onClick={() => void handleFetchTosBuckets()}
                            >
                              {isFetchingBuckets === 'volcengineTos' ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              {t('settings.imageHosting.fetchBuckets')}
                            </button>
                          </div>

                          {discoveredTosBuckets.length > 0 && (
                            <div className="mb-1.5 rounded border border-accent/40 bg-accent/10 p-2">
                              <div className="mb-1 text-[11px] font-medium text-accent">
                                {t('settings.imageHosting.selectBucketPrompt', { count: discoveredTosBuckets.length })}
                              </div>
                              <UiSelect
                                value={localImageHostSettings.volcengineTos.bucketName}
                                onChange={(event) => {
                                  const chosenName = event.target.value;
                                  const chosen = discoveredTosBuckets.find((b) => b.name === chosenName);
                                  if (chosen) {
                                    const nextRegion = chosen.region || localImageHostSettings.volcengineTos.region.trim() || 'cn-beijing';
                                    updateLocalImageHostSettings({
                                      volcengineTos: {
                                        bucketName: chosen.name,
                                        region: nextRegion,
                                        ...(!localImageHostSettings.volcengineTos.endpoint.trim() || localImageHostSettings.volcengineTos.endpoint.includes('tos-s3-')
                                          ? { endpoint: `tos-s3-${nextRegion}.volces.com` }
                                          : {}),
                                      },
                                    });
                                    setTestResult({
                                      provider: 'volcengineTos',
                                      ok: true,
                                      message: t('settings.imageHosting.autoFilledBucket', {
                                        name: chosen.name,
                                        region: nextRegion,
                                      }),
                                    });
                                  }
                                }}
                                className="h-8 w-full text-xs"
                              >
                                <option value="">{t('settings.imageHosting.selectBucketPlaceholder')}</option>
                                {discoveredTosBuckets.map((bucket) => (
                                  <option key={bucket.name} value={bucket.name}>
                                    {bucket.name}{bucket.region ? ` (${bucket.region})` : ''}
                                  </option>
                                ))}
                              </UiSelect>
                            </div>
                          )}

                          <input
                            value={localImageHostSettings.volcengineTos.bucketName}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { bucketName: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.bucketNamePlaceholder')}
                            className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </div>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.volcengineTos.endpoint')}
                          <input
                            value={localImageHostSettings.volcengineTos.endpoint}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { endpoint: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.endpointPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.volcengineTos.publicDomain')}
                          <input
                            value={localImageHostSettings.volcengineTos.publicDomain}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { publicDomain: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.publicDomainPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted sm:col-span-2">
                          {t('settings.imageHosting.volcengineTos.prefix')}
                          <input
                            value={localImageHostSettings.volcengineTos.prefix}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                volcengineTos: { prefix: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.volcengineTos.prefixPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                          />
                        </label>
                      </div>

                      <p className="mt-3 text-xs leading-5 text-text-muted">
                        {t('settings.imageHosting.volcengineTos.dashboardHint')}
                      </p>

                      {testResult && testResult.provider === 'volcengineTos' && (
                        <div
                          role="status"
                          className={`mt-3 rounded border p-2.5 text-xs break-all ${
                            testResult.ok
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-red-500/40 bg-red-500/10 text-red-200'
                          }`}
                        >
                          {testResult.message}
                        </div>
                      )}
                    </div>
                  )}

                  {localImageHostSettings.provider === 'tencentCos' && (
                    <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium text-text-dark">
                            {t('settings.imageHosting.tencentCos.title')}
                          </h3>
                          <p className="mt-1 text-xs text-text-muted">
                            {t('settings.imageHosting.tencentCos.desc')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            disabled={isFetchingBuckets !== null || testingImageHost !== null}
                            onClick={() => void handleFetchCosBuckets()}
                            title="获取账号下的所有可用存储桶并供选择填充"
                          >
                            {isFetchingBuckets === 'tencentCos' ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            {isFetchingBuckets === 'tencentCos'
                              ? t('settings.imageHosting.fetchingBuckets')
                              : t('settings.imageHosting.fetchBuckets')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            disabled={testingImageHost !== null}
                            onClick={() => void handleTestImageHost('tencentCos')}
                          >
                            {testingImageHost === 'tencentCos' ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {testingImageHost === 'tencentCos'
                              ? t('settings.imageHosting.testing')
                              : t('settings.imageHosting.testUpload')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                            onClick={() =>
                              updateLocalImageHostSettings({
                                tencentCos: { ...DEFAULT_IMAGE_HOST_SETTINGS.tencentCos },
                              })
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('settings.imageHosting.restoreDefaults')}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.tencentCos.secretId')}
                          <input
                            value={localImageHostSettings.tencentCos.secretId}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { secretId: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.secretIdPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.tencentCos.secretKey')}
                          <input
                            type="password"
                            value={localImageHostSettings.tencentCos.secretKey}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { secretKey: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.secretKeyPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.tencentCos.region')}
                          <input
                            value={localImageHostSettings.tencentCos.region}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { region: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.regionPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <div className="flex flex-col justify-end">
                          <div className="flex items-center justify-between pb-1">
                            <span className="text-xs font-medium text-text-muted">
                              {t('settings.imageHosting.tencentCos.bucketName')}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-50"
                              disabled={isFetchingBuckets !== null || testingImageHost !== null}
                              onClick={() => void handleFetchCosBuckets()}
                            >
                              {isFetchingBuckets === 'tencentCos' ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              {t('settings.imageHosting.fetchBuckets')}
                            </button>
                          </div>

                          {discoveredCosBuckets.length > 0 && (
                            <div className="mb-1.5 rounded border border-accent/40 bg-accent/10 p-2">
                              <div className="mb-1 text-[11px] font-medium text-accent">
                                {t('settings.imageHosting.selectBucketPrompt', { count: discoveredCosBuckets.length })}
                              </div>
                              <UiSelect
                                value={localImageHostSettings.tencentCos.bucketName}
                                onChange={(event) => {
                                  const chosenName = event.target.value;
                                  const chosen = discoveredCosBuckets.find((b) => b.name === chosenName);
                                  if (chosen) {
                                    const nextRegion = chosen.region?.trim() || localImageHostSettings.tencentCos.region;
                                    updateLocalImageHostSettings({
                                      tencentCos: {
                                        bucketName: chosen.name,
                                        region: nextRegion,
                                      },
                                    });
                                    setTestResult({
                                      provider: 'tencentCos',
                                      ok: true,
                                      message: t('settings.imageHosting.autoFilledBucket', {
                                        name: chosen.name,
                                        region: nextRegion,
                                      }),
                                    });
                                  }
                                }}
                                className="h-8 w-full text-xs"
                              >
                                <option value="">{t('settings.imageHosting.selectBucketPlaceholder')}</option>
                                {discoveredCosBuckets.map((bucket) => (
                                  <option key={bucket.name} value={bucket.name}>
                                    {bucket.name}{bucket.region ? ` (${bucket.region})` : ''}
                                  </option>
                                ))}
                              </UiSelect>
                            </div>
                          )}

                          <input
                            value={localImageHostSettings.tencentCos.bucketName}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { bucketName: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.bucketNamePlaceholder')}
                            className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </div>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.tencentCos.endpoint')}
                          <input
                            value={localImageHostSettings.tencentCos.endpoint}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { endpoint: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.endpointPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.tencentCos.publicDomain')}
                          <input
                            value={localImageHostSettings.tencentCos.publicDomain}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { publicDomain: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.publicDomainPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted sm:col-span-2">
                          {t('settings.imageHosting.tencentCos.prefix')}
                          <input
                            value={localImageHostSettings.tencentCos.prefix}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                tencentCos: { prefix: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.tencentCos.prefixPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                          />
                        </label>
                      </div>

                      <p className="mt-3 text-xs leading-5 text-text-muted">
                        {t('settings.imageHosting.tencentCos.dashboardHint')}
                      </p>

                      {testResult && testResult.provider === 'tencentCos' && (
                        <div
                          role="status"
                          className={`mt-3 rounded border p-2.5 text-xs break-all ${
                            testResult.ok
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-red-500/40 bg-red-500/10 text-red-200'
                          }`}
                        >
                          {testResult.message}
                        </div>
                      )}
                    </div>
                  )}

                  {localImageHostSettings.provider === 'cloudflareR2' && (
                    <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium text-text-dark">
                            {t('settings.imageHosting.cloudflareR2.title')}
                          </h3>
                          <p className="mt-1 text-xs text-text-muted">
                            {t('settings.imageHosting.cloudflareR2.desc')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            disabled={isFetchingBuckets !== null || testingImageHost !== null}
                            onClick={() => void handleFetchR2Buckets()}
                            title="获取账号下的所有可用存储桶并供选择填充"
                          >
                            {isFetchingBuckets === 'cloudflareR2' ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            {isFetchingBuckets === 'cloudflareR2'
                              ? t('settings.imageHosting.fetchingBuckets')
                              : t('settings.imageHosting.fetchBuckets')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            disabled={testingImageHost !== null}
                            onClick={() => void handleTestImageHost('cloudflareR2')}
                          >
                            {testingImageHost === 'cloudflareR2' ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {testingImageHost === 'cloudflareR2'
                              ? t('settings.imageHosting.testing')
                              : t('settings.imageHosting.testUpload')}
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                            onClick={() =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { ...DEFAULT_IMAGE_HOST_SETTINGS.cloudflareR2 },
                              })
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('settings.imageHosting.restoreDefaults')}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.cloudflareR2.accountId')}
                          <input
                            value={localImageHostSettings.cloudflareR2.accountId}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { accountId: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.cloudflareR2.accountIdPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <div className="flex flex-col justify-end">
                          <div className="flex items-center justify-between pb-1">
                            <span className="text-xs font-medium text-text-muted">
                              {t('settings.imageHosting.cloudflareR2.bucketName')}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-50"
                              disabled={isFetchingBuckets !== null || testingImageHost !== null}
                              onClick={() => void handleFetchR2Buckets()}
                            >
                              {isFetchingBuckets === 'cloudflareR2' ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              {t('settings.imageHosting.fetchBuckets')}
                            </button>
                          </div>

                          {discoveredR2Buckets.length > 0 && (
                            <div className="mb-1.5 rounded border border-accent/40 bg-accent/10 p-2">
                              <div className="mb-1 text-[11px] font-medium text-accent">
                                {t('settings.imageHosting.selectBucketPrompt', { count: discoveredR2Buckets.length })}
                              </div>
                              <UiSelect
                                value={localImageHostSettings.cloudflareR2.bucketName}
                                onChange={(event) => {
                                  const chosenName = event.target.value;
                                  const chosen = discoveredR2Buckets.find((b) => b.name === chosenName);
                                  if (chosen) {
                                    updateLocalImageHostSettings({
                                      cloudflareR2: { bucketName: chosen.name },
                                    });
                                    setTestResult({
                                      provider: 'cloudflareR2',
                                      ok: true,
                                      message: t('settings.imageHosting.autoFilledBucketR2', { name: chosen.name }),
                                    });
                                  }
                                }}
                                className="h-8 w-full text-xs"
                              >
                                <option value="">{t('settings.imageHosting.selectBucketPlaceholder')}</option>
                                {discoveredR2Buckets.map((bucket) => (
                                  <option key={bucket.name} value={bucket.name}>
                                    {bucket.name}
                                  </option>
                                ))}
                              </UiSelect>
                            </div>
                          )}

                          <input
                            value={localImageHostSettings.cloudflareR2.bucketName}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { bucketName: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.cloudflareR2.bucketNamePlaceholder')}
                            className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </div>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.cloudflareR2.accessKeyId')}
                          <input
                            value={localImageHostSettings.cloudflareR2.accessKeyId}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { accessKeyId: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.cloudflareR2.accessKeyIdPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.cloudflareR2.secretAccessKey')}
                          <input
                            type="password"
                            value={localImageHostSettings.cloudflareR2.secretAccessKey}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { secretAccessKey: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.cloudflareR2.secretAccessKeyPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted font-mono"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.cloudflareR2.publicDomain')}
                          <input
                            value={localImageHostSettings.cloudflareR2.publicDomain}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { publicDomain: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.cloudflareR2.publicDomainPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                          />
                        </label>

                        <label className="text-xs font-medium text-text-muted">
                          {t('settings.imageHosting.cloudflareR2.prefix')}
                          <input
                            value={localImageHostSettings.cloudflareR2.prefix}
                            onChange={(event) =>
                              updateLocalImageHostSettings({
                                cloudflareR2: { prefix: event.target.value },
                              })
                            }
                            placeholder={t('settings.imageHosting.cloudflareR2.prefixPlaceholder')}
                            className="mt-1 h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                          />
                        </label>
                      </div>

                      <p className="mt-3 text-xs leading-5 text-text-muted">
                        {t('settings.imageHosting.cloudflareR2.dashboardHint')}
                      </p>

                      {testResult && testResult.provider === 'cloudflareR2' && (
                        <div
                          role="status"
                          className={`mt-3 rounded border p-2.5 text-xs break-all ${
                            testResult.ok
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-red-500/40 bg-red-500/10 text-red-200'
                          }`}
                        >
                          {testResult.message}
                        </div>
                      )}
                    </div>
                  )}

                  {settingsSaveError && (
                    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                      {settingsSaveError}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-border-dark px-6 py-4">
                  {settingsSaved && <span role="status" className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t('common.saved')}</span>}
                  <button
                    onClick={requestClose}
                    className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark"
                    disabled={isSavingSettings}
                  >
                    {t('common.close')}
                  </button>
                  <button
                    onClick={() => {
                      void handleSave();
                    }}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSavingSettings}
                  >
                    {isSavingSettings ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'appearance' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.appearance')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.appearanceDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.radiusPreset')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.radiusPresetDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localUiRadiusPreset}
                        onChange={(event) =>
                          setLocalUiRadiusPreset(event.target.value as typeof localUiRadiusPreset)
                        }
                        className="h-9 text-sm"
                      >
                        <option value="compact">{t('settings.radiusCompact')}</option>
                        <option value="default">{t('settings.radiusDefault')}</option>
                        <option value="large">{t('settings.radiusLarge')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.themeTone')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.themeToneDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localThemeTonePreset}
                        onChange={(event) =>
                          setLocalThemeTonePreset(event.target.value as typeof localThemeTonePreset)
                        }
                        className="h-9 text-sm"
                      >
                        <option value="neutral">{t('settings.toneNeutral')}</option>
                        <option value="warm">{t('settings.toneWarm')}</option>
                        <option value="cool">{t('settings.toneCool')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.edgeRoutingMode')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.edgeRoutingModeDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localCanvasEdgeRoutingMode}
                        onChange={(event) =>
                          setLocalCanvasEdgeRoutingMode(
                            event.target.value as typeof localCanvasEdgeRoutingMode
                          )
                        }
                        className="h-9 text-sm"
                      >
                        <option value="spline">{t('settings.edgeRoutingSpline')}</option>
                        <option value="orthogonal">{t('settings.edgeRoutingOrthogonal')}</option>
                        <option value="smartOrthogonal">{t('settings.edgeRoutingSmartOrthogonal')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.accentColor')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.accentColorDesc')}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="color"
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        className="h-9 w-12 rounded border border-border-dark bg-surface-dark p-1"
                      />
                      <input
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        placeholder="#3B82F6"
                        className="h-9 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => setLocalAccentColor('#3B82F6')}
                      >
                        {t('settings.resetAccentColor')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-border-dark px-6 py-4">
                  {settingsSaved && <span role="status" className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t('common.saved')}</span>}
                  <button
                    onClick={requestClose}
                    disabled={isSavingSettings}
                    className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSavingSettings}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingSettings ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'keybindings' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.keybindings')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.keybindingsDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium text-text-dark">
                          {t('settings.canvasInteraction.title')}
                        </h3>
                        <p className="mt-1 text-xs text-text-muted">
                          {t('settings.canvasInteraction.desc')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded border border-border-dark bg-surface-dark px-2.5 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => handleCanvasMousePresetChange('default')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('settings.canvasInteraction.resetDefault')}
                      </button>
                    </div>

                    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]">
                      <label className="text-xs font-medium text-text-muted">
                        {t('settings.canvasInteraction.preset')}
                        <UiSelect
                          value={localCanvasMouseBindingPreset}
                          onChange={(event) =>
                            handleCanvasMousePresetChange(
                              event.target.value as CanvasMouseBindingPreset
                            )
                          }
                          className="mt-1"
                          aria-label={t('settings.canvasInteraction.preset')}
                        >
                          <option value="default">
                            {t('settings.canvasInteraction.presets.default')}
                          </option>
                          <option value="traditional">
                            {t('settings.canvasInteraction.presets.traditional')}
                          </option>
                          <option value="custom">
                            {t('settings.canvasInteraction.presets.custom')}
                          </option>
                        </UiSelect>
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {CANVAS_MOUSE_BINDING_SLOTS.map((slot) => (
                          <label key={slot} className="text-xs font-medium text-text-muted">
                            {t(`settings.canvasInteraction.slots.${slot}`)}
                            <UiSelect
                              value={localCanvasMouseBindings[slot]}
                              onChange={(event) =>
                                handleCanvasMouseBindingChange(
                                  slot,
                                  event.target.value as CanvasMouseAction
                                )
                              }
                              className="mt-1"
                              aria-label={t(`settings.canvasInteraction.slots.${slot}`)}
                            >
                              {CANVAS_MOUSE_ACTIONS.map((action) => (
                                <option key={action} value={action}>
                                  {t(`settings.canvasInteraction.actions.${action}`)}
                                </option>
                              ))}
                            </UiSelect>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border border-border-dark bg-surface-dark/60 p-3">
                      <div className="flex items-start gap-3">
                        <UiCheckbox
                          checked={localEnableCanvasWasdPan}
                          onCheckedChange={setLocalEnableCanvasWasdPan}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium text-text-dark">
                            {t('settings.canvasInteraction.wasdPan')}
                          </h4>
                          <p className="mt-1 text-xs text-text-muted">
                            {t('settings.canvasInteraction.wasdPanDesc')}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <input
                              type="range"
                              min={10}
                              max={180}
                              step={5}
                              value={localCanvasWasdPanSensitivity}
                              onChange={(event) =>
                                setLocalCanvasWasdPanSensitivity(Number(event.target.value))
                              }
                              className="w-48 accent-accent"
                              aria-label={t('settings.canvasInteraction.wasdSensitivity')}
                            />
                            <span className="text-xs text-text-muted">
                              {t('settings.canvasInteraction.wasdSensitivityValue', {
                                value: localCanvasWasdPanSensitivity,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-border-dark px-6 py-4">
                  {settingsSaved && <span role="status" className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t('common.saved')}</span>}
                  <button
                    onClick={requestClose}
                    disabled={isSavingSettings}
                    className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSavingSettings}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingSettings ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'general' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.general')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.generalDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localStoryboardGenKeepStyleConsistent}
                    onCheckedChange={setLocalStoryboardGenKeepStyleConsistent}
                    title={t('settings.storyboardGenKeepStyleConsistent')}
                    description={t('settings.storyboardGenKeepStyleConsistentDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localIgnoreAtTagWhenCopyingAndGenerating}
                    onCheckedChange={setLocalIgnoreAtTagWhenCopyingAndGenerating}
                    title={t('settings.ignoreAtTagWhenCopyingAndGenerating')}
                    description={t('settings.ignoreAtTagWhenCopyingAndGeneratingDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localAppendParameterConstraintsToPrompt}
                    onCheckedChange={setLocalAppendParameterConstraintsToPrompt}
                    title={t('settings.appendParameterConstraintsToPrompt')}
                    description={t('settings.appendParameterConstraintsToPromptDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localCollapseNodeActionToolbarByDefault}
                    onCheckedChange={setLocalCollapseNodeActionToolbarByDefault}
                    title={t('settings.collapseNodeActionToolbarByDefault')}
                    description={t('settings.collapseNodeActionToolbarByDefaultDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localShowNodePayloadPreview}
                    onCheckedChange={setLocalShowNodePayloadPreview}
                    title={t('settings.showNodePayloadPreview')}
                    description={t('settings.showNodePayloadPreviewDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3 flex items-start gap-3">
                      <Network className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      <div>
                        <h3 className="text-sm font-medium text-text-dark">
                          {t('settings.generationNetworkRoute')}
                        </h3>
                        <p className="mt-1 text-xs text-text-muted">
                          {t('settings.generationNetworkRouteDesc')}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <UiSelect
                        value={localGenerationNetworkRoute}
                        onChange={(event) => {
                          setLocalGenerationNetworkRoute(event.target.value as GenerationNetworkRoute);
                          setNetworkTestStatus('');
                        }}
                        aria-label={t('settings.generationNetworkRoute')}
                      >
                        <option value="system">{t('settings.generationNetworkSystem')}</option>
                        <option value="direct">{t('settings.generationNetworkDirect')}</option>
                        <option value="custom-proxy">{t('settings.generationNetworkCustomProxy')}</option>
                      </UiSelect>
                      <button
                        type="button"
                        onClick={() => void handleTestGenerationNetwork()}
                        disabled={networkTestStatus === 'testing'}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-border-dark px-3 text-xs font-medium text-text-dark transition-colors hover:bg-bg-hover disabled:cursor-wait disabled:opacity-60"
                      >
                        {networkTestStatus === 'testing'
                          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          : <Network className="h-3.5 w-3.5" aria-hidden="true" />}
                        {t('settings.generationNetworkTest')}
                      </button>
                    </div>
                    {localGenerationNetworkRoute === 'custom-proxy' && (
                      <input
                        value={localCustomProxyUrl}
                        onChange={(event) => {
                          setLocalCustomProxyUrl(event.target.value);
                          setNetworkTestStatus('');
                        }}
                        placeholder="http://127.0.0.1:7890"
                        className="mt-3 w-full rounded border border-border-dark bg-bg-darker px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                        aria-label={t('settings.generationNetworkProxyUrl')}
                        spellCheck={false}
                      />
                    )}
                    {networkTestStatus === 'success' && (
                      <p role="status" className="mt-2 text-xs text-emerald-400">
                        {t('settings.generationNetworkTestSuccess')}
                      </p>
                    )}
                    {networkTestStatus === 'failed' && (
                      <p role="alert" className="mt-2 text-xs text-red-400">
                        {t('settings.generationNetworkTestFailed')}
                      </p>
                    )}
                  </div>

                  <SettingsCheckboxCard
                    checked={localEnableAiTextStreaming}
                    onCheckedChange={setLocalEnableAiTextStreaming}
                    title={t('settings.enableAiTextStreaming')}
                    description={t('settings.enableAiTextStreamingDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localUseLegacyPanoramaControlDirection}
                    onCheckedChange={setLocalUseLegacyPanoramaControlDirection}
                    title={t('settings.useLegacyPanoramaControlDirection')}
                    description={t('settings.useLegacyPanoramaControlDirectionDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.panoramaControlSensitivity')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.panoramaControlSensitivityDesc')}
                      </p>
                    </div>
                    <UiSelect
                      value={localPanoramaControlSensitivity}
                      onChange={(event) =>
                        setLocalPanoramaControlSensitivity(
                          event.target.value as PanoramaControlSensitivity
                        )
                      }
                      aria-label={t('settings.panoramaControlSensitivity')}
                    >
                      <option value="low">{t('settings.panoramaControlSensitivityLow')}</option>
                      <option value="medium">{t('settings.panoramaControlSensitivityMedium')}</option>
                      <option value="high">{t('settings.panoramaControlSensitivityHigh')}</option>
                    </UiSelect>
                  </div>

                  <SettingsCheckboxCard
                    checked={localStoryboardGenDisableTextInImage}
                    onCheckedChange={setLocalStoryboardGenDisableTextInImage}
                    title={t('settings.storyboardGenDisableTextInImage')}
                    description={t('settings.storyboardGenDisableTextInImageDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localStoryboardGenAutoInferEmptyFrame}
                    onCheckedChange={setLocalStoryboardGenAutoInferEmptyFrame}
                    title={t('settings.storyboardGenAutoInferEmptyFrame')}
                    description={t('settings.storyboardGenAutoInferEmptyFrameDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localEnableStoryboardGenGridPreviewShortcut}
                    onCheckedChange={setLocalEnableStoryboardGenGridPreviewShortcut}
                    title={t('settings.enableStoryboardGenGridPreviewShortcut')}
                    description={t('settings.enableStoryboardGenGridPreviewShortcutDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localShowStoryboardGenAdvancedRatioControls}
                    onCheckedChange={setLocalShowStoryboardGenAdvancedRatioControls}
                    title={t('settings.showStoryboardGenAdvancedRatioControls')}
                    description={t('settings.showStoryboardGenAdvancedRatioControlsDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localUseUploadFilenameAsNodeTitle}
                    onCheckedChange={setLocalUseUploadFilenameAsNodeTitle}
                    title={t('settings.useUploadFilenameAsNodeTitle')}
                    description={t('settings.useUploadFilenameAsNodeTitleDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.downloadPresetPaths')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.downloadPresetPathsDesc')}
                      </p>
                    </div>

                    <div className="mb-2 flex items-center gap-2">
                      <input
                        value={localDownloadPathInput}
                        onChange={(event) => setLocalDownloadPathInput(event.target.value)}
                        placeholder={t('settings.downloadPathPlaceholder')}
                        className="h-9 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={handleAddDownloadPathFromInput}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {t('settings.addPath')}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => {
                          void handlePickDownloadPath();
                        }}
                      >
                        <FolderOpen className="mr-1 h-3.5 w-3.5" />
                        {t('settings.chooseFolder')}
                      </button>
                    </div>

                    <div className="space-y-1">
                      {localDownloadPresetPaths.length > 0 ? (
                        localDownloadPresetPaths.map((path) => (
                          <div
                            key={path}
                            className="flex items-center gap-2 rounded border border-border-dark bg-surface-dark px-2 py-1.5"
                          >
                            <span className="truncate text-xs text-text-dark">{path}</span>
                            <button
                              type="button"
                              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                              onClick={() => handleRemoveDownloadPath(path)}
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-text-muted">{t('settings.noDownloadPresetPaths')}</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-border-dark px-6 py-4">
                  {settingsSaved && <span role="status" className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t('common.saved')}</span>}
                  <button
                    onClick={requestClose}
                    disabled={isSavingSettings}
                    className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSavingSettings}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingSettings ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'about' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.about')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.aboutDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="flex items-start gap-4">
                      <img
                        src="/app-icon.png"
                        alt={t('settings.aboutAppName')}
                        className="h-14 w-14 rounded-lg border border-border-dark object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold text-text-dark">
                          {t('settings.aboutAppName')}
                        </div>
                        <p className="mt-1 text-sm text-text-muted">
                          {t('settings.aboutIntro')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4 space-y-2 text-sm">
                    <p className="text-text-dark">
                      {t('settings.aboutVersionLabel')}: <span className="text-text-muted">{appVersion || t('settings.aboutVersionUnknown')}</span>
                    </p>
                    <p className="text-text-dark">
                      {t('settings.aboutAuthorLabel')}: <span className="text-text-muted">{t('settings.aboutAuthor')}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-text-dark">
                      <span>{t('settings.aboutRepositoryLabel')}:</span>
                      <button
                        type="button"
                        onClick={handleOpenRepository}
                        className="inline-flex items-center gap-1 break-all text-left text-accent hover:underline"
                      >
                        <span>{t('settings.aboutRepositoryUrl')}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </div>
                    <p className="text-text-dark">
                      {t('settings.aboutOriginalAuthorLabel')}: <span className="text-text-muted">{t('settings.aboutOriginalAuthor')}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-text-dark">
                      <span>{t('settings.aboutOriginalProjectLabel')}:</span>
                      <button
                        type="button"
                        onClick={handleOpenOriginalProject}
                        className="inline-flex items-center gap-1 break-all text-left text-accent hover:underline"
                      >
                        <span>{t('settings.aboutOriginalProjectUrl')}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </div>
                    <p className="text-xs leading-relaxed text-text-muted">
                      {t('settings.aboutOriginalAttributionNote')}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <SettingsCheckboxCard
                      checked={localAutoCheckAppUpdateOnLaunch}
                      onCheckedChange={setLocalAutoCheckAppUpdateOnLaunch}
                      title={t('settings.autoCheckUpdateOnLaunch')}
                      description={t('settings.autoCheckUpdateOnLaunchDesc')}
                    />
                    <SettingsCheckboxCard
                      checked={localEnableUpdateDialog}
                      onCheckedChange={setLocalEnableUpdateDialog}
                      title={t('settings.enableUpdateDialog')}
                      description={t('settings.enableUpdateDialogDesc')}
                    />
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          void handleCheckUpdate();
                        }}
                        className="rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={checkUpdateStatus === 'checking'}
                      >
                        {checkUpdateStatus === 'checking'
                          ? t('settings.checkingUpdate')
                          : t('settings.checkUpdateNow')}
                      </button>
                      {checkUpdateStatus !== '' && (
                        <p className="mt-2 text-xs text-text-muted">
                          {checkUpdateStatus === 'has-update' && t('settings.checkUpdateHasUpdate')}
                          {checkUpdateStatus === 'up-to-date' && t('settings.checkUpdateUpToDate')}
                          {checkUpdateStatus === 'failed' && t('settings.checkUpdateFailed')}
                          {checkUpdateStatus === 'checking' && t('settings.checkingUpdate')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  {settingsSaved && <span role="status" className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t('common.saved')}</span>}
                  <div className="flex gap-2">
                    <button
                      onClick={requestClose}
                      disabled={isSavingSettings}
                      className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('common.close')}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSavingSettings}
                      className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingSettings ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
