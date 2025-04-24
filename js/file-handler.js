import { Utils } from './utils.js';

export class FileHandler {
  constructor(state, ui, naluHandler) {
    this.state = state;
    this.ui = ui;
    this.naluHandler = naluHandler;
    this.utils = new Utils();
    this.timestamp = 0; // Simple timestamp counter for WebCodecs chunks
  }

  async processFile(file) {
    try {
      // --- Clear stats at the beginning ---
      if (window.app && typeof window.app.clearFrameTypeStats === 'function') {
        window.app.clearFrameTypeStats();
      }
      // --- End clear ---

      // 重置所有显示
      this.ui.resetVideoInfo();
      this.timestamp = 0; // Reset timestamp on new file

      // 更新文件信息显示
      this.ui.updateUploadSection(true);
      const fileName = document.querySelector('.file-name');
      const fileSize = document.querySelector('.file-size');
      fileName.textContent = file.name;
      fileSize.textContent = this.utils.formatFileSize(file.size);

      this.ui.updateProgress(0, '开始处理文件...');

      // 读取文件
      const fileData = await file.arrayBuffer();
      const fileArray = new Uint8Array(fileData);
      this.ui.updateProgress(20, '文件读取完成，开始分析...');

      if (this.state.selectedDecoder === 'webcodecs') {
        // WebCodecs specific processing
        this.ui.updateProgress(30, '分析 NALU 并准备解码块...');
        // Ensure decoder is ready before preparing chunks that might configure it
        if (!this.state.isWebCodecsReady) {
          await this.state.initWebCodecs(); // Ensure decoder is initialized
        }
        await this.prepareWebCodecsChunks(fileArray); // This might configure the decoder

        // --- Start Decoding Chunks ---
        if (this.state.webDecoder && this.state.webDecoder.state === 'configured') {
          this.ui.updateProgress(60, '解码视频帧...');
          console.log(`Decoding ${this.state.webCodecChunks.length} prepared chunks...`);
          let i=0
          for (const chunkData of this.state.webCodecChunks) {
            try {
              const chunk = new EncodedVideoChunk(chunkData);
              console.log(++i,'Sending chunk to decoder:', chunkData);
              this.state.webDecoder.decode(chunk);
              await new Promise(resolve => setTimeout(resolve, 40)); // Small delay
            } catch (decodeError) {
              console.error('Error decoding chunk:', chunkData, decodeError);
              // Optionally handle individual chunk errors
            }
          }
          console.log("Finished sending chunks to decoder. Flushing...");
          await this.state.webDecoder.flush(); // Wait for all decoding to finish
          console.log("Decoder flushed.");
        } else {
          console.warn("WebCodecs decoder not configured after preparing chunks. Cannot decode.");
          throw new Error("解码器未能成功配置，无法解码。");
        }
        // --- End Decoding Chunks ---

        // Update NALU display info (remains the same)
        document.getElementById('frameCount').textContent = this.state.webCodecChunks?.length || 0; // Might want to update this based on decoded frames later
        if (this.state.currentNALUs.length > 0) {
          this.state.currentNALUIndex = 0;
          this.ui.updateNALUInfo(this.state.currentNALUs[0]);
          this.ui.updateNALUCounter();
          if (this.naluHandler) {
            this.naluHandler.displayNALU(0);
          }
        }

        // --- Display First Frame & Final Stats ---
        this.ui.updateProgress(90, '检查解码结果...');

        if (this.state.frames.length > 0) {
          console.log(`${this.state.frames.length} frames decoded. Displaying frame 0.`);
          this.ui.selectFrame(0); // Select and draw the first frame
          document.getElementById('frameCount').textContent = this.state.frames.length; // Update frame count based on decoded frames
          this.ui.updateFrameSlider(); // Ensure slider reflects the available frames
          this.ui.updateFrameList(); // Update the list display

          // --- Display final stats --- 
          if (window.app && typeof window.app.displayFrameTypeStats === 'function') {
            window.app.displayFrameTypeStats();
          }
          // --- End display stats ---

        } else {
          console.warn("No frames were available after flushing the decoder.");
          const canvas = document.getElementById('videoCanvas');
          if (canvas) {
            const ctx = canvas.getContext('2d');
            this.ui.drawPlaceholder(ctx, canvas.width, canvas.height, '未能解码任何帧');
          }
        }
        // --- End Display First Frame & Final Stats ---

      } else {
        // FFmpeg processing (existing logic)
        this.state.ffmpeg.FS('writeFile', 'input.264', fileArray);
        this.ui.updateProgress(30, '分析视频信息 (FFmpeg)...');
        await this.analyzeFrames(); // FFmpeg analysis
        this.ui.updateProgress(50, '提取帧数据 (FFmpeg)...');
        await this.extractFrames(); // FFmpeg frame extraction
        this.ui.updateProgress(80, '分析 NALU 数据 (FFmpeg)...');
        await this.analyzeNALUs(fileArray); // NALU analysis for display

        if (this.state.frames.length > 0) {
          this.ui.selectFrame(0);
        }

        if (window.app && typeof window.app.displayFrameTypeStats === 'function') {
          window.app.displayFrameTypeStats(); // Display stats after FFmpeg processing too
        }
      }

      // 完成处理
      this.ui.updateProgress(100, '处理完成！');
      setTimeout(() => {
        this.ui.hideProgress();
      }, 1000);

    } catch (error) {
      console.error('文件处理错误:', error);
      this.utils.showError(`文件处理失败: ${error.message || error}`);
      this.ui.resetVideoInfo();
      this.ui.updateUploadSection(false);
      this.ui.hideProgress();
    }
  }

  async analyzeFrames() {
    try {
      const outputName = 'stdout.txt';
      await this.state.ffmpeg.FS('writeFile', outputName, new Uint8Array());

      await this.state.ffmpeg.run(
        '-i', 'input.264',
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,bit_rate',
        outputName
      );

      try {
        const outputData = this.state.ffmpeg.FS('readFile', outputName);
        const outputText = new TextDecoder().decode(outputData);

        if (outputText.trim()) {
          const videoInfo = JSON.parse(outputText);

          if (videoInfo.streams && videoInfo.streams[0]) {
            const stream = videoInfo.streams[0];

            if (stream.r_frame_rate) {
              const [num, den] = stream.r_frame_rate.split('/');
              const fps = Math.round((parseInt(num) / parseInt(den) * 100)) / 100;
              const framerateElement = document.getElementById('framerate');
              if (framerateElement) {
                framerateElement.textContent = `${fps} fps`;
              }
            }

            if (stream.bit_rate) {
              const kbps = Math.round(parseInt(stream.bit_rate) / 1000);
              const bitrateElement = document.getElementById('bitrate');
              if (bitrateElement) {
                bitrateElement.textContent = `${kbps} kb/s`;
              }
            }
          }
        }
      } catch (parseError) {
        console.error('解析视频信息失败:', parseError);
        await this.analyzeFromSPS();
      } finally {
        try {
          this.state.ffmpeg.FS('unlink', outputName);
        } catch (e) { }
      }

      const framerateElement = document.getElementById('framerate');
      if (framerateElement && !framerateElement.textContent.includes('fps')) {
        await this.analyzeFromSPS();
      }

      await this.state.ffmpeg.run(
        '-i', 'input.264',
        '-c:v', 'copy',
        '-f', 'null',
        '-stats',
        'output.null'
      );

    } catch (error) {
      console.error('帧分析错误:', error);
      this.setDefaultVideoInfo();
    }
  }

  setDefaultVideoInfo() {
    document.getElementById('framerate').textContent = '未知';
    document.getElementById('bitrate').textContent = '未知';
  }

  async analyzeFromSPS() {
    const spsNALU = this.state.currentNALUs?.find(nalu => nalu.type === 7);
    if (spsNALU) {
      const spsData = spsNALU.data.slice(spsNALU.startCode + 1);
      if (spsData.length > 10) {
        this.extractTimingInfo(spsData);
      }
    }
  }

  extractTimingInfo(spsData) {
    const timingInfoPresentFlag = (spsData[7] & 0x80) !== 0;
    if (timingInfoPresentFlag) {
      const timeScale = (spsData[8] << 8) | spsData[9];
      const numUnitsInTick = (spsData[10] << 8) | spsData[11];
      if (timeScale && numUnitsInTick) {
        const fps = Math.round((timeScale / (2 * numUnitsInTick)) * 100) / 100;
        document.getElementById('framerate').textContent = `~${fps} fps (SPS估算)`;
      }
    }
  }

  async extractFrames() {
    try {
      await this.state.ffmpeg.run(
        '-i', 'input.264',
        '-vf', 'select=1',
        '-vsync', '0',
        '-frame_pts', '1',
        '-f', 'image2',
        'frame_%d.png'
      );

      const frameFiles = this.state.ffmpeg.FS('readdir', '/')
        .filter(name => name.startsWith('frame_'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)[0]);
          const numB = parseInt(b.match(/\d+/)[0]);
          return numA - numB;
        });

      const h264Data = this.state.ffmpeg.FS('readFile', 'input.264');
      const frameTypes = this.analyzeFrameTypes(h264Data);

      this.state.frames = this.createFrameObjects(frameFiles, frameTypes);
      this.updateFrameInfo();
    } catch (error) {
      console.error('帧提取错误:', error);
      throw error;
    }
  }

  analyzeFrameTypes(h264Data) {
    const nalus = this.findNALUs(h264Data);
    return nalus
      .filter(nalu => nalu.type === 1 || nalu.type === 5)
      .map(nalu => nalu.type === 5 ? 'I' : 'P');
  }

  createFrameObjects(frameFiles, frameTypes) {
    // --- Clear stats before FFmpeg processing ---
    if (window.app && typeof window.app.clearFrameTypeStats === 'function') {
      window.app.clearFrameTypeStats();
    }
    // --- End clear ---
    return frameFiles.map((name, index) => {
      const type = frameTypes[index] || '?';
      // --- Update stats during FFmpeg processing ---
      if (window.app && typeof window.app.updateFrameTypeStats === 'function') {
        window.app.updateFrameTypeStats(type);
      }
      // --- End update ---
      return {
        name,
        type
      };
    });
  }

  updateFrameInfo() {
    document.getElementById('frameCount').textContent = this.state.frames.length;
    document.getElementById('playPauseButton').disabled = this.state.frames.length === 0;

    if (this.state.frames.length > 0) {
      this.ui.selectFrame(0);
    }

    this.ui.updateFrameList();
  }

  async analyzeNALUs(data) {
    try {
      this.state.currentNALUs = this.findNALUs(data);
    } catch (error) {
      console.error('NALU分析错误:', error);
    }
  }

  async prepareWebCodecsChunks(fileArray) {
    console.log("Preparing chunks for WebCodecs...");
    this.state.webCodecChunks = [];
    this.state.currentNALUs = [];
    let latestSPS = null;
    let latestPPS = null;
    let foundFirstIFrame = false;
    let spsPpsPrefix = null;
    let vuiTimingInfo = null; // Variable to store timing info

    const nalus = this.findNALUs(fileArray);
    this.state.currentNALUs = nalus;

    for (const nalu of nalus) {
      const naluType = nalu.type;

      if (naluType === 7) { // SPS
        console.log("Found SPS NALU");
        latestSPS = nalu.data;
        // --- Try to extract VUI timing info ---
        vuiTimingInfo = this.extractVuiTimingInfo(latestSPS);
        if (vuiTimingInfo) {
          console.log("Extracted VUI timing info:", vuiTimingInfo);
          // Update UI immediately if possible
          this.updateFramerateUI(vuiTimingInfo);
        } else {
          // If VUI fails, update UI with placeholder/unknown
          this.updateFramerateUI(null);
        }
        // --- End VUI extraction ---

        if (this.state.webDecoder && this.state.webDecoder.state === 'unconfigured') {
          try {
            const config = this.extractDecoderConfig(latestSPS);
            if (config) {
              await this.state.configureDecoder(config); // Use state's configureDecoder
              console.log("WebCodecs decoder configured.");
              // Update resolution after configuration (if possible from config)
              // Note: config from extractDecoderConfig doesn't have resolution yet
              // Resolution is known after first frame decode in handleDecodedFrame
            } else {
              console.warn("Could not extract config from SPS");
            }
          } catch (e) {
            console.error("Error configuring WebCodecs decoder:", e);
            throw new Error("Failed to configure WebCodecs decoder from SPS.");
          }
        }
        // Combine SPS/PPS prefix logic
        if (latestPPS) {
          spsPpsPrefix = this.combineNALUs([latestSPS, latestPPS]);
        } else {
          spsPpsPrefix = latestSPS;
        }
        continue; // Continue to next NALU
      }

      if (naluType === 8) { // PPS
        console.log("Found PPS NALU");
        latestPPS = nalu.data;
        if (latestSPS) {
          spsPpsPrefix = this.combineNALUs([latestSPS, latestPPS]);
        } else {
          spsPpsPrefix = latestPPS;
        }
        continue; // Continue to next NALU
      }

      // --- Store inferred type with chunk data ---
      if (naluType === 5) { // I-Frame
        console.log("Found I-Frame NALU");
        if (this.state.webDecoder && this.state.webDecoder.state !== 'configured' && spsPpsPrefix) {
          console.warn("Found I-Frame before decoder was configured. SPS/PPS might be missing needed config info.");
        }

        let chunkData = nalu.data;
        if (!foundFirstIFrame && spsPpsPrefix) {
          console.log("Prepending SPS/PPS to first I-Frame");
          chunkData = this.combineNALUs([spsPpsPrefix, nalu.data]);
        }

        this.state.webCodecChunks.push({
          type: 'key',
          timestamp: this.timestamp += 1,
          data: chunkData,
          inferredType: 'I' // Store inferred type
        });
        foundFirstIFrame = true;
        spsPpsPrefix = null; // Reset prefix after use
        continue;
      }

      if (foundFirstIFrame) {
        if (naluType === 1) { // P-Frame (or B)
          console.log("Found P-Frame NALU");
          this.state.webCodecChunks.push({
            type: 'delta',
            timestamp: this.timestamp += 1,
            data: nalu.data,
            inferredType: 'P' // Store inferred type (simplification)
          });
        } else if (naluType >= 2 && naluType <= 4) {
          console.log(`Found Data Partition ${String.fromCharCode(65 + naluType - 2)} NALU`);
          this.state.webCodecChunks.push({
            type: 'delta',
            timestamp: this.timestamp += 1,
            data: nalu.data,
            inferredType: 'P' // Treat data partitions like P for stats
          });
        } else if (naluType === 6) {
          console.log("Found SEI NALU - Skipping for decoding");
        } else if (naluType === 9) {
          console.log("Found Access Unit Delimiter NALU - Skipping");
        }
      } else {
        console.log(`Skipping NALU type ${naluType} before first I-Frame`);
      }
      // --- End storing inferred type ---

    } // End NALU loop

    if (!foundFirstIFrame) {
      console.warn("No I-Frame found in the stream.");
    }
    if (this.state.webDecoder && this.state.webDecoder.state !== 'configured') {
      console.warn("WebCodecs decoder was not configured (missing SPS/PPS or config extraction failed).");
    }

    console.log(`Prepared ${this.state.webCodecChunks.length} chunks for WebCodecs.`);
  }

  // --- New method to extract VUI timing info from SPS ---
  extractVuiTimingInfo(spsData) {
    try {
      let offset = 1; // Skip NAL unit type byte
      offset += 3; // Rough skip

      console.warn("Full VUI parsing from SPS not implemented. Cannot reliably determine framerate from SPS.");
      return null;
    } catch (e) {
      console.error("Error parsing SPS for VUI timing info:", e);
      return null;
    }
  }

  // --- New method to update framerate UI ---
  updateFramerateUI(timingInfo) {
    const framerateElement = document.getElementById('framerate');
    const bitrateElement = document.getElementById('bitrate');

    if (timingInfo && timingInfo.time_scale > 0 && timingInfo.num_units_in_tick > 0) {
      const fps = timingInfo.time_scale / (2 * timingInfo.num_units_in_tick);
      if (framerateElement) {
        framerateElement.textContent = `${fps.toFixed(2)} fps (VUI)`;
      }
    } else {
      if (framerateElement && (framerateElement.textContent === '-' || framerateElement.textContent === '帧率')) {
        framerateElement.textContent = '未知 (无VUI)';
      }
    }
    if (bitrateElement && (bitrateElement.textContent === '-' || bitrateElement.textContent === '码率')) {
      bitrateElement.textContent = '未知';
    }
  }

  combineNALUs(naluArrays) {
    const totalLength = naluArrays.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    // --- Fix variable name --- 
    for (const arr of naluArrays) { // Use the parameter name 'naluArrays'
      combined.set(arr, offset);
      offset += arr.length;
    }
    // --- End fix ---
    return combined;
  }

  extractDecoderConfig(spsData) {
    console.log("Attempting to extract config from SPS (Placeholder)");
    try {
      if (spsData.length > 4) {
        const profile_idc = spsData[1];
        const profile_compatibility = spsData[2];
        const level_idc = spsData[3];

        const pp = profile_idc.toString(16).padStart(2, '0');
        const ll = level_idc.toString(16).padStart(2, '0');
        const cc = profile_compatibility.toString(16).padStart(2, '0');

        const codecString = `avc1.${pp}${cc}${ll}`;
        console.log(`Extracted placeholder codec string: ${codecString}`);

        return {
          codec: codecString,
        };
      }
    } catch (e) {
      console.error("Error during placeholder SPS parsing:", e);
    }
    return null;
  }

  findNALUs(data) {
    const nalus = [];
    let i = 0;

    while (i < data.length) {
      const startCodeLen = this.findStartCode(data, i);
      if (startCodeLen) {
        const naluStart = i;
        const nextStartCodePos = this.findNextStartCode(data, i + startCodeLen);
        const naluEnd = nextStartCodePos;

        const nalu = this.createNALU(data, naluStart, naluEnd, startCodeLen);

        nalus.push(nalu);
        i = naluEnd;
      } else {
        console.warn("Could not find start code, stopping NALU search.");
        break;
      }
    }
    return nalus;
  }

  findStartCode(data, index) {
    if (index + 3 >= data.length) return null;

    if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
      return 3;
    }

    if (index + 4 <= data.length &&
      data[index] === 0 && data[index + 1] === 0 &&
      data[index + 2] === 0 && data[index + 3] === 1) {
      return 4;
    }

    return null;
  }

  findNextStartCode(data, startIndex) {
    let i = startIndex;
    while (i < data.length - 3) {
      if (data[i] === 0 && data[i + 1] === 0) {
        if (data[i + 2] === 1) {
          return i;
        } else if (i + 3 < data.length && data[i + 2] === 0 && data[i + 3] === 1) {
          return i;
        }
        i += 2;
      } else {
        i++;
      }
    }
    return data.length;
  }

  createNALU(data, start, end, startCodeLen) {
    const naluTypeByte = data[start + startCodeLen];
    return {
      startIndex: start,
      length: end - start,
      type: naluTypeByte & 0x1F,
      startCode: startCodeLen,
      data: data.slice(start, end)
    };
  }

  clearFile() {
    this.state.reset();

    if (this.state.ffmpeg) {
      try {
        const files = this.state.ffmpeg.FS('readdir', '/');
        files.forEach(file => {
          if (file !== '.' && file !== '..') {
            try {
              this.state.ffmpeg.FS('unlink', file);
            } catch (e) { }
          }
        });
      } catch (error) {
        console.error('清除文件系统错误:', error);
      }
    }

    this.ui.clearFileUI();

    // --- Clear stats when clearing file ---
    if (window.app && typeof window.app.clearFrameTypeStats === 'function') {
      window.app.clearFrameTypeStats();
    }
    // --- End clear ---
  }
}
