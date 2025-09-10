import { AppState } from './state.js';
import { UIHandler } from './ui-handler.js';
import { FileHandler } from './file-handler.js';
import { NALUHandler } from './nalu-handler.js';
import { PlaybackController } from './playback-controller.js';
import { Utils } from './utils.js';

class App {
  constructor() {
    // 首先创建状态管理器
    this.state = new AppState();

    // 然后创建 UI 处理器
    this.ui = new UIHandler(this.state);

    // 创建 NALU 处理器
    this.naluHandler = new NALUHandler(this.state, this.ui);

    // 最后创建文件处理器，并传入 NALU 处理器
    this.fileHandler = new FileHandler(this.state, this.ui, this.naluHandler);

    // 创建播放控制器
    this.playback = new PlaybackController(this.state, this.ui);

    // 工具类
    this.utils = new Utils();

    // Helper function to check if the *currently selected* decoder is ready
    this.isDecoderReady = () => {
      if (this.state.selectedDecoder === 'ffmpeg') {
        return !!this.state.ffmpeg; // Check if ffmpeg instance exists and is loaded
      } else if (this.state.selectedDecoder === 'webcodecs') {
        return this.state.isWebCodecsReady; // Use the new flag from state
      }
      return false; // Should not happen if a decoder is selected
    };

    // --- Add Frame Type Stats ---
    this.frameTypeStats = { I: 0, P: 0, B: 0, '?': 0 }; // Initialize stats object
    // --- End Add ---
  }

  async init() {
    try {
      this.setUIEnabled(false);
      const initialDecoder = document.getElementById('decoderSelect').value;
      this.state.selectedDecoder = initialDecoder;
      let decoderName = initialDecoder === 'ffmpeg' ? 'FFmpeg' : 'WebCodecs';
      this.ui.updateProgress(0, `正在初始化 ${decoderName}...`);

      try {
        await this.state.init(); // First attempt to initialize selected decoder
        this.ui.hideProgress();
        this.setUIEnabled(true);
        this.setupEventListeners();

      } catch (initError) {
        console.warn(`${decoderName} 初始化失败:`, initError);

        if (this.state.selectedDecoder === 'ffmpeg' && 'VideoDecoder' in window) {
          console.log('FFmpeg 初始化失败，尝试回退到 WebCodecs...');
          this.ui.updateProgress(0, 'FFmpeg 初始化失败，尝试 WebCodecs...');
          document.getElementById('decoderSelect').value = 'webcodecs';

          try {
            this.state.setDecoder('webcodecs');
            await this.state.init();
            console.log('WebCodecs 回退初始化成功');
            this.ui.hideProgress();
            this.setUIEnabled(true);
            this.setupEventListeners();

          } catch (webCodecsError) {
            console.error('WebCodecs 回退初始化失败:', webCodecsError);
            this.ui.hideProgress();
            this.setUIEnabled(false);
            this.utils.showError(`FFmpeg 和 WebCodecs 初始化均失败: ${webCodecsError.message}. 请刷新页面重试.`);
          }
        } else {
          this.ui.hideProgress();
          this.setUIEnabled(false);
          this.utils.showError(`${decoderName} 初始化失败: ${initError.message}. 请刷新页面重试.`);
        }
      }
    } catch (outerError) {
      console.error('初始化过程中发生意外错误:', outerError);
      this.ui.hideProgress();
      this.setUIEnabled(false);
      this.utils.showError(`初始化失败: ${outerError.message}.`);
    }
  }

  setUIEnabled(enabled) {
    // 需要禁用/启用的元素ID列表
    const elements = [
      'fileInput',
      'clearFile',
      'playPauseButton',
      'playbackFps',
      'loopPlayback',
      'prevNalu',
      'nextNalu'
    ];

    elements.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.disabled = !enabled;
      }
    });

    // 更新上传区域的状态
    const uploadSection = document.getElementById('uploadSection');
    if (uploadSection) {
      if (enabled) {
        uploadSection.classList.remove('disabled');
        uploadSection.classList.add('expanded');
      } else {
        uploadSection.classList.add('disabled');
        uploadSection.classList.remove('expanded');
      }
    }
  }

  setupEventListeners() {
    // 文件上传
    document.getElementById('fileInput').addEventListener('change', (e) => {
      if (!this.isDecoderReady()) {
        this.utils.showError('解码器还未加载完成，请稍候...');
        return;
      }
      const file = e.target.files[0];
      if (file) {
        this.clearFrameTypeStats();
        this.fileHandler.processFile(file);
      }
    });

    // 清除文件
    document.getElementById('clearFile').addEventListener('click', () => {
      if (!this.isDecoderReady()) return;
      this.clearFrameTypeStats();
      this.fileHandler.clearFile();
    });

    // 播放控制
    const playPauseButton = document.getElementById('playPauseButton');
    if (playPauseButton) {
      playPauseButton.addEventListener('click', () => {
        console.log('Play/Pause button clicked'); // <-- Add log here
        this.playback.togglePlayback();
      });
    } else {
      console.error('Play/Pause button not found!');
    }

    document.getElementById('playbackFps').addEventListener('change', () => {
      if (!this.isDecoderReady()) return;
      this.playback.updatePlaybackFps();
    });

    document.getElementById('loopPlayback').addEventListener('change', (e) => {
      if (!this.isDecoderReady()) return;
      this.state.loopPlayback = e.target.checked;
    });

    // 帧率限制
    document.getElementById('playbackFps').addEventListener('input', (e) => {
      if (!this.isDecoderReady()) return;
      let value = parseInt(e.target.value);
      e.target.value = Math.max(1, Math.min(120, value));
    });

    // 拖放处理
    this.setupDragAndDrop();

    // NALU导航
    document.getElementById('prevNalu').addEventListener('click', () => {
      if (!this.isDecoderReady()) return;
      this.naluHandler.previousNALU();
    });

    document.getElementById('nextNalu').addEventListener('click', () => {
      if (!this.isDecoderReady()) return;
      this.naluHandler.nextNALU();
    });

    // Decoder Selection
    document.getElementById('decoderSelect').addEventListener('change', async (e) => {
      const newDecoder = e.target.value;
      if (newDecoder === this.state.selectedDecoder) return;

      if (newDecoder === 'webcodecs' && !('VideoDecoder' in window)) {
        this.utils.showError('当前浏览器不支持 WebCodecs API，无法切换。');
        e.target.value = this.state.selectedDecoder; // Revert selection to current state
        return;
      }

      console.log(`请求切换解码器到: ${newDecoder}`);
      this.setUIEnabled(false);
      this.ui.updateProgress(0, `正在切换到 ${newDecoder === 'ffmpeg' ? 'FFmpeg' : 'WebCodecs'}...`);

      try {
        this.fileHandler.clearFile();
        this.state.setDecoder(newDecoder);
        await this.state.init();
        this.ui.hideProgress();
        console.log(`成功切换到 ${newDecoder === 'ffmpeg' ? 'FFmpeg' : 'WebCodecs'}`);
        this.setUIEnabled(true); // Enable UI after successful switch and init
      } catch (error) {
        console.error('解码器切换失败:', error);
        this.ui.hideProgress();
        this.utils.showError(`切换解码器失败: ${error.message}`);
        document.getElementById('decoderSelect').value = this.state.selectedDecoder === 'ffmpeg' ? 'webcodecs' : 'ffmpeg'; // Revert UI to the *previous* selection before the failed attempt
        this.setUIEnabled(false);
      }
    });

    // 选卡切换
    this.setupTabSwitching();

    // 帧列表导航
    this.setupFrameListNavigation();
  }

  setupDragAndDrop() {
    const uploadSection = document.getElementById('uploadSection');

    uploadSection.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadSection.classList.add('drag-over');
    });

    uploadSection.addEventListener('dragleave', (e) => {
      e.preventDefault();
      uploadSection.classList.remove('drag-over');
    });

    uploadSection.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadSection.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        const fileInput = document.getElementById('fileInput');
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
  }

  setupTabSwitching() {
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab-button').forEach(btn =>
          btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content =>
          content.classList.remove('active'));

        button.classList.add('active');
        const tabId = button.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
      });
    });
  }

  setupFrameListNavigation() {
    const frameList = document.getElementById('frameList');
    const prevFrames = document.getElementById('prevFrames');
    const nextFrames = document.getElementById('nextFrames');

    const updateFrameNavButtons = this.utils.debounce(() => {
      const maxScroll = frameList.scrollWidth - frameList.clientWidth;
      prevFrames.disabled = frameList.scrollLeft <= 1;
      nextFrames.disabled = frameList.scrollLeft >= maxScroll - 1;
    }, 100);

    frameList.addEventListener('scroll', updateFrameNavButtons);

    prevFrames.addEventListener('click', () => {
      const itemWidth = frameList.querySelector('.frame-item')?.offsetWidth || 0;
      const visibleItems = Math.floor(frameList.clientWidth / (itemWidth + 4));
      const scrollAmount = itemWidth * Math.floor(visibleItems / 2);

      frameList.scrollTo({
        left: frameList.scrollLeft - scrollAmount,
        behavior: 'smooth'
      });
    });

    nextFrames.addEventListener('click', () => {
      const itemWidth = frameList.querySelector('.frame-item')?.offsetWidth || 0;
      const visibleItems = Math.floor(frameList.clientWidth / (itemWidth + 4));
      const scrollAmount = itemWidth * Math.floor(visibleItems / 2);

      frameList.scrollTo({
        left: frameList.scrollLeft + scrollAmount,
        behavior: 'smooth'
      });
    });

    window.addEventListener('resize', updateFrameNavButtons);
  }

  async loadSampleData() {
    try {
      this.ui.updateProgress(0, '正在加载样例数据...');

      const sampleType = document.getElementById('sampleSelect').value;
      const response = await fetch(`/sample/${sampleType}`);
      if (!response.ok) {
        throw new Error('样例文件加载失败');
      }

      const data = await response.blob();
      const file = new File([data], `sample_${sampleType}.h264`, { type: 'video/h264' });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      document.getElementById('fileInput').files = dataTransfer.files;

      // 清除之前的统计信息
      this.clearFrameTypeStats();
      await this.fileHandler.processFile(file);
    } catch (error) {
      console.error('加载样例数据失败:', error);
      this.utils.showError('加载样例数据失败：' + error.message);
    }
  }

  // --- Add Frame Type Stat Methods ---
  updateFrameTypeStats(frameType) {
    const typeKey = frameType === 'I' ? 'I' : (frameType === 'P' || frameType === 'B' ? 'P' : '?'); // Group B into P for now
    if (typeKey in this.frameTypeStats) {
      this.frameTypeStats[typeKey]++;
    }

    // 实时更新统计显示（每10帧更新一次，避免过于频繁）
    const total = Object.values(this.frameTypeStats).reduce((a, b) => a + b, 0);
    if (total % 10 === 0 || total <= 5) {
      this.displayFrameTypeStats();
    }
  }

  displayFrameTypeStats() {
    const total = Object.values(this.frameTypeStats).reduce((a, b) => a + b, 0);
    const statsElement = document.getElementById('frameTypeStats');
    if (!statsElement) return;

    if (total === 0) {
      statsElement.textContent = '-';
      return;
    }

    const statsText = Object.entries(this.frameTypeStats)
      .filter(([type, count]) => count > 0 && type !== '?') // Only show I, P, B if they exist
      .map(([type, count]) => {
        const percentage = ((count / total) * 100).toFixed(1);
        return `${type}:${percentage}%`;
      })
      .join(' ');

    statsElement.textContent = statsText || '-'; // Show '-' if only '?' frames exist
  }

  clearFrameTypeStats() {
    this.frameTypeStats = { I: 0, P: 0, B: 0, '?': 0 };
    const statsElement = document.getElementById('frameTypeStats');
    if (statsElement) {
      statsElement.textContent = '-';
    }
  }
  // --- End Add ---
}

// 创建应用实例并初始化
const app = new App();
window.addEventListener('load', () => app.init());

// 导出应用实例供全局使用
window.app = app;
