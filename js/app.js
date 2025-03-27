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
        
        // FFmpeg 状态标志
        this.isFFmpegReady = false;

        // 帧类型统计
        this.frameTypeStats = {
            I: 0,
            P: 0,
            B: 0
        };
    }

    async init() {
        try {
            // 初始化时禁用所有操作按钮
            this.setUIEnabled(false);
            
            // 显示初始化进度
            this.ui.updateProgress(0, '正在初始化 FFmpeg...');
            
            // 初始化 FFmpeg
            await this.state.init();
            this.isFFmpegReady = true;
            
            // 隐藏进度条
            this.ui.hideProgress();
            
            // FFmpeg 加载完成后启用操作按钮
            this.setUIEnabled(true);
            
            // 设置事件监听器
            this.setupEventListeners();
        } catch (error) {
            console.error('初始化失败:', error);
            this.utils.showError('初始化失败，请刷新页面重试');
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
            if (!this.isFFmpegReady) {
                this.utils.showError('FFmpeg 还未加载完成，请稍候...');
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
            if (!this.isFFmpegReady) return;
            this.clearFrameTypeStats();
            this.fileHandler.clearFile();
        });

        // 播放控制
        document.getElementById('playPauseButton').addEventListener('click', () => {
            if (!this.isFFmpegReady) return;
            this.playback.togglePlayback();
        });

        document.getElementById('playbackFps').addEventListener('change', () => {
            if (!this.isFFmpegReady) return;
            this.playback.updatePlaybackFps();
        });

        document.getElementById('loopPlayback').addEventListener('change', (e) => {
            if (!this.isFFmpegReady) return;
            this.state.loopPlayback = e.target.checked;
        });

        // 帧率限制
        document.getElementById('playbackFps').addEventListener('input', (e) => {
            if (!this.isFFmpegReady) return;
            let value = parseInt(e.target.value);
            e.target.value = Math.max(1, Math.min(120, value));
        });

        // 拖放处理
        this.setupDragAndDrop();

        // NALU导航
        document.getElementById('prevNalu').addEventListener('click', () => {
            if (!this.isFFmpegReady) return;
            this.naluHandler.previousNALU();
        });
        
        document.getElementById('nextNalu').addEventListener('click', () => {
            if (!this.isFFmpegReady) return;
            this.naluHandler.nextNALU();
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

    updateFrameTypeStats(frameType) {
        if (frameType in this.frameTypeStats) {
            this.frameTypeStats[frameType]++;
            this.displayFrameTypeStats();
        }
    }

    displayFrameTypeStats() {
        const total = Object.values(this.frameTypeStats).reduce((a, b) => a + b, 0);
        if (total === 0) return;

        const stats = Object.entries(this.frameTypeStats).map(([type, count]) => {
            const percentage = ((count / total) * 100).toFixed(1);
            return `${type}:${percentage}%`;
        }).join(' ');

        document.getElementById('frameTypeStats').textContent = stats;
    }

    clearFrameTypeStats() {
        this.frameTypeStats = {
            I: 0,
            P: 0,
            B: 0
        };
        document.getElementById('frameTypeStats').textContent = '-';
    }
}

// 创建应用实例并初始化
const app = new App();
window.addEventListener('load', () => app.init());

// 导出应用实例供全局使用
window.app = app; 