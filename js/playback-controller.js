export class PlaybackController {
  constructor(state, ui) {
    this.state = state;
    this.ui = ui;
    this.fps = 30; // Default FPS, consider getting from video info
    this.currentlyDisplayedFrame = null; // To manage closing previous frame
  }

  togglePlayback() {
    console.log('PlaybackController.togglePlayback called. isPlaying:', this.state.isPlaying); // <-- Add log here
    if (this.state.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
    // This state update might be redundant if start/stop already set it
    // this.state.isPlaying = !this.state.isPlaying;
    // this.updatePlayButton(); // This method seems incorrect, uiHandler should update the button
  }

  startPlayback() {
    console.log('PlaybackController.startPlayback called'); // <-- Add log here
    if (this.state.isPlaying || this.state.frames.length === 0) return;

    this.state.isPlaying = true;
    this.ui.updatePlayPauseButton(true); // Use UI handler to update button

    const interval = 1000 / this.fps;

    this.state.playbackInterval = setInterval(() => {
      if (!this.state.isPlaying) {
        this.stopPlayback();
        return;
      }

      const frameIndex = this.state.currentFrameIndex;
      const frameObject = this.state.frames[frameIndex]; // Get the wrapper object

      if (frameObject) {
        // --- Fix close() call ---
        // Close the *previously* displayed frame's videoFrame
        if (this.currentlyDisplayedFrame && this.currentlyDisplayedFrame !== frameObject) {
          try {
            // Check if it's a WebCodecs frame object before closing
            if (this.currentlyDisplayedFrame.videoFrame && typeof this.currentlyDisplayedFrame.videoFrame.close === 'function') {
              this.currentlyDisplayedFrame.videoFrame.close();
            }
          } catch (e) {
            console.warn("Error closing previous frame:", e);
          }
        }
        // Store reference to the current frame *object*
        this.currentlyDisplayedFrame = frameObject;
        // --- End fix ---

        // Draw based on decoder type
        if (this.state.selectedDecoder === 'webcodecs' && frameObject.videoFrame instanceof VideoFrame) {
          this.drawWebCodecsFrame(frameObject);
        } else if (this.state.selectedDecoder === 'ffmpeg') {
          this.displayFFmpegFrame(frameIndex); // FFmpeg uses index
        }

        this.ui.updatePlaybackTime(frameIndex);
        this.ui.highlightFrameInList(frameIndex);

        let nextFrameIndex = frameIndex + 1;
        if (nextFrameIndex >= this.state.frames.length) {
          if (this.state.loopPlayback) {
            nextFrameIndex = 0;
          } else {
            this.stopPlayback();
            return;
          }
        }
        this.state.currentFrameIndex = nextFrameIndex;

      } else {
        console.warn(`Frame at index ${frameIndex} not found or invalid.`);
        let nextFrameIndex = frameIndex + 1;
        if (nextFrameIndex >= this.state.frames.length) {
          if (this.state.loopPlayback) {
            nextFrameIndex = 0;
          } else {
            this.stopPlayback();
            return;
          }
        }
        this.state.currentFrameIndex = nextFrameIndex;
      }
    }, interval);
  }

  stopPlayback() {
    console.log('PlaybackController.stopPlayback called'); // <-- Add log here
    if (this.state.playbackInterval) {
      clearInterval(this.state.playbackInterval);
      this.state.playbackInterval = null;
    }
    this.state.isPlaying = false;
    this.ui.updatePlayPauseButton(false); // Use UI handler to update button

    // --- Fix close() call ---
    // Close the last displayed frame's videoFrame when stopping playback
    if (this.currentlyDisplayedFrame) {
      try {
        // Check if it's a WebCodecs frame object before closing
        if (this.currentlyDisplayedFrame.videoFrame && typeof this.currentlyDisplayedFrame.videoFrame.close === 'function') {
          this.currentlyDisplayedFrame.videoFrame.close();
        }
      } catch (e) {
        console.warn("Error closing frame on stop:", e);
      }
      this.currentlyDisplayedFrame = null;
    }
    // --- End fix ---
  }

  updatePlaybackFps() {
    if (this.state.isPlaying) {
      this.stopPlayback();
      this.startPlayback();
    }
  }

  /*
  updatePlayButton() {
    // This logic should be in UIHandler.updatePlayPauseButton
    const button = document.getElementById('playPauseButton');
    if (this.state.isPlaying) {
      button.textContent = '暂停';
    } else if (this.state.currentFrameIndex >= this.state.frames.length - 1 && !this.state.loopPlayback) {
      button.textContent = '重播';
    } else {
      button.textContent = '播放';
    }
  }
  */

  reset() {
    this.stopPlayback(); // This already handles closing the frame
  }

  drawWebCodecsFrame(frameObject) { // Parameter renamed for clarity
    const canvas = document.getElementById('frameCanvas'); // Correct canvas ID
    const frame = frameObject.videoFrame; // Access the VideoFrame from the wrapper object

    if (canvas && frame instanceof VideoFrame && frame.format) { // Check frame is valid
      const ctx = canvas.getContext('2d');
      // Adjust canvas size only if necessary
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
    } else {
      console.warn("Canvas not found or frame is not a valid VideoFrame for drawing.");
      // Optionally draw a placeholder if frame is invalid during playback
      // const canvas = document.getElementById('frameCanvas'); // Correct ID here too if uncommented
      // if (canvas) {
      //    const ctx = canvas.getContext('2d');
      //    this.ui.drawPlaceholder(ctx, canvas.width, canvas.height, 'Invalid frame');
      // }
    }
  }

  displayFFmpegFrame(frameIndex) {
    const canvas = document.getElementById('frameCanvas'); // Correct canvas ID
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const frameInfo = this.state.frames[frameIndex];

    if (frameInfo && frameInfo.name && this.state.ffmpeg) {
      try {
        const imageData = this.state.ffmpeg.FS('readFile', frameInfo.name);
        const blob = new Blob([imageData], { type: 'image/png' });
        const imageUrl = URL.createObjectURL(blob);

        const img = new Image();
        img.onload = () => {
          if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
          }
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(imageUrl);
        };
        img.onerror = () => {
          console.error(`Failed to load frame image: ${frameInfo.name}`);
          URL.revokeObjectURL(imageUrl);
          this.ui.drawPlaceholder(ctx, canvas.width, canvas.height, `Error loading Frame ${frameIndex + 1}`);
        };
        img.src = imageUrl;
      } catch (e) {
        console.error(`Error reading frame ${frameInfo.name} from FFmpeg FS:`, e);
        this.ui.drawPlaceholder(ctx, canvas.width, canvas.height, `Error reading Frame ${frameIndex + 1}`);
      }
    } else {
      console.warn(`FFmpeg frame info not found for index ${frameIndex}`);
      this.ui.drawPlaceholder(ctx, canvas.width, canvas.height, `FFmpeg Frame ${frameIndex + 1} (Not found)`);
    }
  }

  seekToFrame(index) {
    if (index >= 0 && index < this.state.frames.length) {
      this.state.currentFrameIndex = index;
      if (!this.state.isPlaying) {
        const frameObject = this.state.frames[index];
        this.ui.drawFrameToCanvas(index); // UI handler already handles getting the frame object by index
        this.ui.updateFrameSlider(); // Update slider position and number
        this.ui.highlightFrameInList(index); // Update list highlight
      }
    }
  }
}