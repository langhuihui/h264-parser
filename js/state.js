export class AppState {
    constructor() {
        this.ffmpeg = null;
        this.frames = [];
        this.currentFrameIndex = 0;
        this.isPlaying = false;
        this.playbackInterval = null;
        this.currentNALUs = [];
        this.currentNALUIndex = 0;
        this.frameErrors = new Set();
        this.loopPlayback = true;
    }

    async init() {
        try {
            const { createFFmpeg } = FFmpeg;
            this.ffmpeg = createFFmpeg({ 
                log: true,
                corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
            });
            await this.ffmpeg.load();
            console.log('FFmpeg 初始化成功');
        } catch (error) {
            console.error('FFmpeg 初始化失败:', error);
            throw new Error('FFmpeg 初始化失败，请刷新页面重试');
        }
    }

    reset() {
        this.frames = [];
        this.currentFrameIndex = 0;
        this.isPlaying = false;
        this.currentNALUs = [];
        this.currentNALUIndex = 0;
        this.frameErrors.clear();
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
    }
} 