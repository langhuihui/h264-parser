export class AppState {
  constructor() {
    this.ffmpeg = null;
    this.webDecoder = null; // Add state for WebCodecs decoder
    this.isWebCodecsReady = false; // Add readiness flag for WebCodecs
    this.selectedDecoder = 'ffmpeg'; // Default to ffmpeg
    this.frames = [];
    this.currentFrameIndex = 0;
    this.isPlaying = false;
    this.playbackInterval = null;
    this.currentNALUs = [];
    this.currentNALUIndex = 0;
    this.frameErrors = new Set();
    this.loopPlayback = true;
    this.webCodecChunks = []; // Store prepared chunks with inferred types
  }

  async init() {
    // Initialize based on the selected decoder
    if (this.selectedDecoder === 'ffmpeg') {
      await this.initFFmpeg();
    } else if (this.selectedDecoder === 'webcodecs') {
      await this.initWebCodecs();
    }
  }

  async initFFmpeg() {
    try {
      if (!this.ffmpeg) { // Initialize only if not already done
        const { createFFmpeg } = FFmpeg;
        this.ffmpeg = createFFmpeg({
          log: true,
          corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
        });
        await this.ffmpeg.load();
        console.log('FFmpeg 初始化成功');
      }
    } catch (error) {
      console.error('FFmpeg 初始化失败:', error);
      throw new Error('FFmpeg 初始化失败，请刷新页面重试');
    }
  }

  async initWebCodecs() {
    if (!('VideoDecoder' in window)) {
      console.error('WebCodecs API 不支持');
      this.isWebCodecsReady = false;
      throw new Error('浏览器不支持 WebCodecs API');
    }
    console.log('初始化 WebCodecs...');
    try {
      this.webDecoder = new VideoDecoder({
        output: this.handleDecodedFrame.bind(this),
        error: this.handleDecodeError.bind(this)
      });
      // 配置通常在收到 SPS/PPS NALU 后进行
      // 例如: await this.webDecoder.configure({ codec: 'avc1.64001f', // 示例编解码器字符串
      //                                description: videotrack.decoderConfig.description });
      console.log('WebCodecs VideoDecoder 创建成功');
      // 暂时将 isWebCodecsReady 设为 true，表示解码器已创建
      // 实际的“就绪”状态可能取决于配置是否成功
      this.isWebCodecsReady = true;
    } catch (error) {
      console.error('WebCodecs VideoDecoder 创建失败:', error);
      this.isWebCodecsReady = false;
      throw error; // 重新抛出错误
    }
  }

  // 处理 WebCodecs 解码后的帧
  handleDecodedFrame(frame) {
    console.log('handleDecodedFrame called. Frame timestamp:', frame.timestamp);

    // --- Find corresponding chunk and get inferredType ---
    const originalChunk = this.webCodecChunks?.find(chunk => chunk.timestamp === frame.timestamp);
    const inferredType = originalChunk ? originalChunk.inferredType : '?';
    // --- End find ---

    // --- Update frame type stats ---
    if (window.app && typeof window.app.updateFrameTypeStats === 'function') {
      window.app.updateFrameTypeStats(inferredType);
    }
    // --- End update stats ---

    const frameObject = {
      videoFrame: frame,
      type: inferredType, // Use inferred type
      timestamp: frame.timestamp
    };
    this.frames.push(frameObject);

    // --- Update progress and UI on each decoded frame ---
    this.updateDecodingProgress();
    // --- End update progress ---
  }

  // 新增：更新解码进度
  updateDecodingProgress() {
    if (!this.webCodecChunks || this.webCodecChunks.length === 0) return;

    const totalChunks = this.webCodecChunks.length;
    const decodedFrames = this.frames.length;
    const progressPercent = Math.min(90, Math.round((decodedFrames / totalChunks) * 100));

    // 更新进度条
    if (window.app && window.app.ui) {
      window.app.ui.updateProgress(progressPercent, `解码进度: ${decodedFrames}/${totalChunks} 帧`);
    }

    // 实时更新帧列表（每解码5帧更新一次，避免过于频繁）
    if (decodedFrames % 5 === 0 || decodedFrames === totalChunks) {
      if (window.app && window.app.ui) {
        window.app.ui.updateFrameList();
        window.app.ui.updateFrameSlider();
      }
    }

    // 如果是第一帧，立即显示
    if (decodedFrames === 1 && window.app && window.app.ui) {
      window.app.ui.selectFrame(0);
    }

    console.log(`解码进度: ${decodedFrames}/${totalChunks} 帧 (${progressPercent}%)`);
  }

  // 处理 WebCodecs 解码错误
  handleDecodeError(error) {
    // --- Add detailed logging ---
    console.error('handleDecodeError called. WebCodecs decode error:', error.message, error);
    // 可以在这里添加错误处理逻辑，例如更新 UI
    // Example: Display error to user
    // if (window.app && window.app.utils) {
    //   window.app.utils.showError(`WebCodecs 解码错误: ${error.message}`);
    // }
    // --- End logging ---
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
    if (this.webDecoder) {
      if (this.webDecoder.state !== 'closed') {
        try {
          // 尝试重置或关闭解码器
          // 如果解码器正在解码，直接 close 可能会报错
          // 可以先尝试 reset()
          if (this.webDecoder.state === 'configured') {
            this.webDecoder.reset();
          }
          this.webDecoder.close();
          console.log('WebCodecs decoder closed.');
        } catch (e) {
          console.warn('Error closing or resetting WebCodecs decoder:', e);
        }
      }
      this.webDecoder = null;
    }
    this.isWebCodecsReady = false; // Reset ready flag
  }

  // 新增：使用 WebCodecs 解码 NALU 数据
  async decodeWithWebCodecs(naluData, timestamp) {
    if (!this.webDecoder || this.webDecoder.state === 'closed') {
      console.warn('WebCodecs decoder 未初始化或已关闭');
      return;
    }

    // 检查解码器是否已配置，如果未配置，尝试配置（需要 SPS/PPS）
    // 实际应用中，配置逻辑会更复杂，通常在解析到 SPS/PPS 时进行
    if (this.webDecoder.state === 'unconfigured') {
      console.warn('WebCodecs decoder 未配置，需要 SPS/PPS NALUs');
      // 尝试从 NALU 中提取配置信息（简化示例）
      // if (isSPS(naluData) || isPPS(naluData)) {
      //   try {
      //     await this.configureDecoder(naluData); // 需要实现 configureDecoder
      //   } catch (e) {
      //     console.error('Decoder configuration failed:', e);
      //     return;
      //   }
      // } else {
      //   return; // 没有配置信息，无法解码普通 NALU
      // }
      // 暂时返回，因为我们还没有配置逻辑
      return;
    }

    try {
      const chunk = new EncodedVideoChunk({
        type: 'key', // 需要根据 NALU 类型判断是 key frame 还是 delta frame
        timestamp: timestamp, // 使用传入的时间戳
        data: naluData
      });
      if (this.webDecoder.state === 'configured') {
        console.log('Calling decode() on WebCodecs decoder...', chunk);
        this.webDecoder.decode(chunk);
      }
    } catch (error) {
      console.error('WebCodecs decode() 调用失败:', error);
    }
  }

  // 占位符：配置解码器的方法
  async configureDecoder(/* 参数可能包含 SPS/PPS 数据 */) {
    // 实际实现需要解析 SPS/PPS 来获取编解码器字符串和描述
    const codecConfig = {
      codec: 'avc1.64001f', // 这是一个示例，需要动态生成
      optimizeForLatency: true,
      // description: extracted_description, // 从 SPS/PPS 提取
      // hardwareAcceleration: 'prefer-hardware',
    };
    try {
      await this.webDecoder.configure(codecConfig);
      console.log('WebCodecs decoder configured successfully.');
    } catch (e) {
      console.error('WebCodecs decoder configuration failed:', e);
      throw e;
    }
  }

  setDecoder(decoderType) {
    if (decoderType === this.selectedDecoder) return; // No change

    console.log(`切换解码器到: ${decoderType}`);
    this.selectedDecoder = decoderType;
    // Potentially reset state or re-initialize components
    this.reset();
    // Re-initialization might be needed depending on implementation
    // For now, we assume init() will be called again or handled elsewhere
  }
}