export class PlaybackController {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }

    togglePlayback() {
        if (this.state.isPlaying) {
            this.stopPlayback();
        } else {
            this.startPlayback();
        }
        this.state.isPlaying = !this.state.isPlaying;
        this.updatePlayButton();
    }

    startPlayback() {
        if (this.state.playbackInterval) clearInterval(this.state.playbackInterval);
        const fps = parseInt(document.getElementById('playbackFps').value) || 30;
        const interval = 1000 / fps;
        
        // 如果是重播状态先重置到第一帧
        if (this.state.currentFrameIndex >= this.state.frames.length - 1 && !this.state.loopPlayback) {
            this.state.currentFrameIndex = 0;
            this.ui.updateFrameHighlight();
            this.ui.displayFrame(this.state.frames[this.state.currentFrameIndex]);
        }
        
        this.state.playbackInterval = setInterval(() => {
            if (this.state.currentFrameIndex >= this.state.frames.length - 1) {
                if (this.state.loopPlayback) {
                    this.state.currentFrameIndex = 0;
                } else {
                    this.stopPlayback();
                    this.state.isPlaying = false;
                    this.updatePlayButton();
                    return;
                }
            } else {
                this.state.currentFrameIndex++;
            }
            this.ui.updateFrameHighlight();
            this.ui.displayFrame(this.state.frames[this.state.currentFrameIndex]);
        }, interval);
    }

    stopPlayback() {
        if (this.state.playbackInterval) {
            clearInterval(this.state.playbackInterval);
            this.state.playbackInterval = null;
        }
    }

    updatePlaybackFps() {
        if (this.state.isPlaying) {
            this.stopPlayback();
            this.startPlayback();
        }
    }

    updatePlayButton() {
        const button = document.getElementById('playPauseButton');
        if (this.state.isPlaying) {
            button.textContent = '暂停';
        } else if (this.state.currentFrameIndex >= this.state.frames.length - 1 && !this.state.loopPlayback) {
            button.textContent = '重播';
        } else {
            button.textContent = '播放';
        }
    }
} 