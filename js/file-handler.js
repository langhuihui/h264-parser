import { Utils, BitReader } from './utils.js';
const waitTime = 40000;
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
          this.ui.updateProgress(60, '开始解码视频帧...');
          console.log(`Decoding ${this.state.webCodecChunks.length} prepared chunks...`);
          let i = 0;
          const totalChunks = this.state.webCodecChunks.length;

          for (const chunkData of this.state.webCodecChunks) {
            try {
              const chunk = new EncodedVideoChunk(chunkData);
              console.log(++i, 'Sending chunk to decoder:', chunkData);
              this.state.webDecoder.decode(chunk);

              // 更新发送进度（60-85%）
              const sendProgress = 60 + Math.round((i / totalChunks) * 25);
              this.ui.updateProgress(sendProgress, `发送解码数据: ${i}/${totalChunks} 块`);

              await new Promise(resolve => setTimeout(resolve, 40)); // Small delay
            } catch (decodeError) {
              console.error('Error decoding chunk:', chunkData, decodeError);
              // Optionally handle individual chunk errors
            }
          }
          console.log("Finished sending chunks to decoder. Flushing...");
          this.ui.updateProgress(85, '等待解码完成...');
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
        this.ui.updateProgress(95, '检查解码结果...');

        if (this.state.frames.length > 0) {
          console.log(`${this.state.frames.length} frames decoded. Displaying frame 0.`);
          // 添加帧类型映射到帧对象
          this.mapFrameTypesToWebCodecsFrames();

          // 确保显示第一帧（如果还没有显示的话）
          if (this.state.currentFrameIndex === 0) {
            this.ui.selectFrame(0); // Select and draw the first frame
          }

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
          const canvas = document.getElementById('frameCanvas');
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
    let spsInfo = null; // Variable to store parsed SPS info

    const nalus = this.findNALUs(fileArray);
    this.state.currentNALUs = nalus;

    for (const nalu of nalus) {
      const naluType = nalu.type;

      if (naluType === 7) { // SPS
        console.log("Found SPS NALU");
        latestSPS = nalu.data;
        // --- Parse SPS ---
        spsInfo = this.parseSPS(latestSPS);
        if (spsInfo) {
          console.log("Parsed SPS info:", spsInfo);
          // Update UI immediately if possible
          this.updateVideoInfoUI(spsInfo);
          // Store resolution in state if needed later
          if (spsInfo.width && spsInfo.height) {
            this.state.videoWidth = spsInfo.width;
            this.state.videoHeight = spsInfo.height;
            console.log(`Stored resolution: ${this.state.videoWidth}x${this.state.videoHeight}`);
          }
        } else {
          console.warn("Failed to parse SPS NALU.");
          // Update UI with placeholders if parsing failed
          this.updateVideoInfoUI(null);
        }
        // --- End SPS Parsing ---

        if (this.state.webDecoder && this.state.webDecoder.state === 'unconfigured') {
          try {
            // Use parsed info for config if available, otherwise fallback
            const config = spsInfo?.decoderConfig || this.extractDecoderConfig(latestSPS);
            if (config) {
              // Add description if available from parsed SPS
              if (spsInfo?.description) {
                config.description = spsInfo.description;
              }
              await this.state.configureDecoder(config);
              console.log("WebCodecs decoder configured.");
              // Resolution is now known from spsInfo, update UI if needed
              if (spsInfo?.width && spsInfo?.height) {
                this.ui.updateResolution(spsInfo.width, spsInfo.height);
              }
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
          // Attempt re-configuration if SPS arrived late? Risky.
        }

        let chunkData = nalu.data;
        if (!foundFirstIFrame && spsPpsPrefix) {
          console.log("Prepending SPS/PPS to first I-Frame");
          chunkData = this.combineNALUs([spsPpsPrefix, nalu.data]);
        }

        this.state.webCodecChunks.push({
          type: 'key',
          timestamp: this.timestamp += waitTime,
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
            timestamp: this.timestamp += waitTime,
            data: nalu.data,
            inferredType: 'P' // Store inferred type (simplification)
          });
        } else if (naluType >= 2 && naluType <= 4) {
          console.log(`Found Data Partition ${String.fromCharCode(65 + naluType - 2)} NALU`);
          this.state.webCodecChunks.push({
            type: 'delta',
            timestamp: this.timestamp += waitTime,
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

  // --- Enhanced SPS Parser ---
  parseSPS(spsData) {
    // 添加初始数据有效性检查
    if (!spsData || spsData.length < 4) {
      console.warn("SPS 数据太短，无法解析");
      return null;
    }

    try {
      // Skip NAL unit header (1 byte: forbidden_zero_bit + nal_ref_idc + nal_unit_type)
      // We start reading from the actual SPS payload
      const reader = new BitReader(spsData.slice(1));
      const info = {
        profile_idc: 0,
        profile_compatibility: 0, // constraint_set flags
        level_idc: 0,
        seq_parameter_set_id: 0,
        chroma_format_idc: 1, // Default to 4:2:0 if not present
        separate_colour_plane_flag: 0,
        bit_depth_luma_minus8: 0,
        bit_depth_chroma_minus8: 0,
        log2_max_frame_num_minus4: 0,
        pic_order_cnt_type: 0,
        log2_max_pic_order_cnt_lsb_minus4: 0,
        num_ref_frames: 0,
        gaps_in_frame_num_value_allowed_flag: 0,
        pic_width_in_mbs_minus1: 0,
        pic_height_in_map_units_minus1: 0,
        frame_mbs_only_flag: 0,
        mb_adaptive_frame_field_flag: 0,
        direct_8x8_inference_flag: 0,
        frame_cropping_flag: 0,
        frame_crop_left_offset: 0,
        frame_crop_right_offset: 0,
        frame_crop_top_offset: 0,
        frame_crop_bottom_offset: 0,
        vui_parameters_present_flag: 0,
        vui: null, // Will hold parsed VUI data
        width: 0,
        height: 0,
        fps: null,
        decoderConfig: null,
        description: null // Optional description for WebCodecs config
      };

      // 检查剩余数据是否足够基本SPS解析
      if (reader.remainingBits() < 24) {
        throw new Error("SPS数据不足以解析基本头信息");
      }

      info.profile_idc = reader.readBits(8);
      info.profile_compatibility = reader.readBits(8); // constraint_set flags
      info.level_idc = reader.readBits(8);

      // 检查是否还有足够的数据读取seq_parameter_set_id
      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取seq_parameter_set_id");
      }

      info.seq_parameter_set_id = reader.readUE();

      // 检查profile_idc值是否需要额外的参数解析
      if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(info.profile_idc)) {
        // 检查是否有足够的数据读取chroma_format_idc
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取chroma_format_idc");
        }

        info.chroma_format_idc = reader.readUE();

        if (info.chroma_format_idc === 3) {
          // 检查是否有足够的数据读取separate_colour_plane_flag
          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取separate_colour_plane_flag");
          }

          info.separate_colour_plane_flag = reader.readBit();
        }

        // 检查是否有足够的数据读取bit_depth参数
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取bit_depth参数");
        }

        info.bit_depth_luma_minus8 = reader.readUE();

        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取bit_depth_chroma_minus8");
        }

        info.bit_depth_chroma_minus8 = reader.readUE();

        // 检查是否有足够的数据读取qpprime_y_zero_transform_bypass_flag
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取qpprime_y_zero_transform_bypass_flag");
        }

        reader.skipBits(1); // qpprime_y_zero_transform_bypass_flag

        // 检查是否有足够的数据读取seq_scaling_matrix_present_flag
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取seq_scaling_matrix_present_flag");
        }

        const seq_scaling_matrix_present_flag = reader.readBit();
        if (seq_scaling_matrix_present_flag) {
          // 缩放矩阵是复杂结构，这里添加错误处理
          try {
            // Skip scaling lists (complex parsing)
            const limit = (info.chroma_format_idc !== 3) ? 8 : 12;
            for (let i = 0; i < limit; i++) {
              // 检查是否有足够的数据读取seq_scaling_list_present_flag
              if (reader.remainingBits() < 1) {
                throw new Error(`SPS数据不足以读取第${i}个seq_scaling_list_present_flag`);
              }

              const seq_scaling_list_present_flag = reader.readBit();
              if (seq_scaling_list_present_flag) {
                // 这里简化处理，实际上应该有更复杂的计算
                let lastScale = 8, nextScale = 8;
                const sizeOfScalingList = (i < 6) ? 16 : 64;

                for (let j = 0; j < sizeOfScalingList; j++) {
                  if (nextScale !== 0) {
                    // 检查是否有足够的数据读取delta_scale
                    if (reader.remainingBits() < 1) {
                      throw new Error(`SPS数据不足以读取第${i}个缩放列表的delta_scale`);
                    }

                    const delta_scale = reader.readSE();
                    nextScale = (lastScale + delta_scale + 256) % 256;
                  }
                  lastScale = (nextScale === 0) ? lastScale : nextScale;
                }
              }
            }
          } catch (scaleErr) {
            console.warn("解析缩放矩阵时出错，尝试继续:", scaleErr);
            // 这里我们不中断整个解析，尝试继续解析其余部分
          }
        }
      } else {
        info.chroma_format_idc = 1; // Default for baseline/main/extended
      }

      // 后续参数解析，添加数据有效性检查
      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取log2_max_frame_num_minus4");
      }

      info.log2_max_frame_num_minus4 = reader.readUE();

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取pic_order_cnt_type");
      }

      info.pic_order_cnt_type = reader.readUE();

      if (info.pic_order_cnt_type === 0) {
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取log2_max_pic_order_cnt_lsb_minus4");
        }

        info.log2_max_pic_order_cnt_lsb_minus4 = reader.readUE();
      } else if (info.pic_order_cnt_type === 1) {
        try {
          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取delta_pic_order_always_zero_flag");
          }

          reader.skipBits(1); // delta_pic_order_always_zero_flag

          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取offset_for_non_ref_pic");
          }

          reader.readSE(); // offset_for_non_ref_pic

          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取offset_for_top_to_bottom_field");
          }

          reader.readSE(); // offset_for_top_to_bottom_field

          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取num_ref_frames_in_pic_order_cnt_cycle");
          }

          const num_ref_frames_in_pic_order_cnt_cycle = reader.readUE();

          for (let i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i++) {
            if (reader.remainingBits() < 1) {
              throw new Error(`SPS数据不足以读取第${i}个offset_for_ref_frame`);
            }

            reader.readSE(); // offset_for_ref_frame[i]
          }
        } catch (picOrderErr) {
          console.warn("解析pic_order_cnt时出错，尝试继续:", picOrderErr);
          // 尝试继续解析
        }
      }

      // 检查剩余数据是否足够
      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取num_ref_frames");
      }

      info.num_ref_frames = reader.readUE();

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取gaps_in_frame_num_value_allowed_flag");
      }

      info.gaps_in_frame_num_value_allowed_flag = reader.readBit();

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取pic_width_in_mbs_minus1");
      }

      info.pic_width_in_mbs_minus1 = reader.readUE();

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取pic_height_in_map_units_minus1");
      }

      info.pic_height_in_map_units_minus1 = reader.readUE();

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取frame_mbs_only_flag");
      }

      info.frame_mbs_only_flag = reader.readBit();

      if (!info.frame_mbs_only_flag) {
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取mb_adaptive_frame_field_flag");
        }

        info.mb_adaptive_frame_field_flag = reader.readBit();
      }

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取direct_8x8_inference_flag");
      }

      info.direct_8x8_inference_flag = reader.readBit();

      if (reader.remainingBits() < 1) {
        throw new Error("SPS数据不足以读取frame_cropping_flag");
      }

      info.frame_cropping_flag = reader.readBit();

      let cropUnitX = 1;
      let cropUnitY = (2 - info.frame_mbs_only_flag); // 2 for interlaced, 1 for progressive

      if (info.chroma_format_idc === 1) { // 4:2:0
        cropUnitX = 2;
        cropUnitY *= 2;
      } else if (info.chroma_format_idc === 2) { // 4:2:2
        cropUnitX = 2;
      } // 4:4:4 or 4:0:0 -> cropUnitX=1, cropUnitY already set

      if (info.frame_cropping_flag) {
        try {
          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取frame_crop_left_offset");
          }

          info.frame_crop_left_offset = reader.readUE();

          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取frame_crop_right_offset");
          }

          info.frame_crop_right_offset = reader.readUE();

          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取frame_crop_top_offset");
          }

          info.frame_crop_top_offset = reader.readUE();

          if (reader.remainingBits() < 1) {
            throw new Error("SPS数据不足以读取frame_crop_bottom_offset");
          }

          info.frame_crop_bottom_offset = reader.readUE();
        } catch (cropErr) {
          console.warn("解析裁剪参数时出错，尝试继续:", cropErr);
          // 重置裁剪标志和值以避免后续计算错误
          info.frame_cropping_flag = 0;
          info.frame_crop_left_offset = 0;
          info.frame_crop_right_offset = 0;
          info.frame_crop_top_offset = 0;
          info.frame_crop_bottom_offset = 0;
        }
      }

      // 计算尺寸，即使裁剪参数解析失败也能获得基本尺寸
      const widthInMbs = info.pic_width_in_mbs_minus1 + 1;
      const heightInMapUnits = info.pic_height_in_map_units_minus1 + 1;
      info.width = widthInMbs * 16;
      info.height = (2 - info.frame_mbs_only_flag) * heightInMapUnits * 16;

      // 应用裁剪，只有在成功解析了裁剪参数的情况下
      if (info.frame_cropping_flag) {
        info.width -= (info.frame_crop_left_offset + info.frame_crop_right_offset) * cropUnitX;
        info.height -= (info.frame_crop_top_offset + info.frame_crop_bottom_offset) * cropUnitY;
      }

      // VUI参数是可选的，如果没有足够的数据则跳过
      try {
        if (reader.remainingBits() < 1) {
          throw new Error("SPS数据不足以读取vui_parameters_present_flag");
        }

        info.vui_parameters_present_flag = reader.readBit();
        if (info.vui_parameters_present_flag) {
          info.vui = this.parseVUI(reader);
          if (info.vui?.fps) {
            info.fps = info.vui.fps;
          }
        }
      } catch (vuiErr) {
        console.warn("解析VUI参数时出错，将跳过:", vuiErr);
        // VUI解析失败，但不影响基本的SPS解析
        info.vui_parameters_present_flag = 0;
        info.vui = null;
      }

      // 即使有错误发生，也尝试生成解码器配置
      const pp = info.profile_idc.toString(16).padStart(2, '0');
      const ll = info.level_idc.toString(16).padStart(2, '0');
      const cc = info.profile_compatibility.toString(16).padStart(2, '0');
      const codecString = `avc1.${pp}${cc}${ll}`;
      info.decoderConfig = { codec: codecString };

      // 创建描述，即使有些参数可能没有成功解析
      let desc = `Profile: ${info.profile_idc}, Level: ${info.level_idc}`;
      if (info.width && info.height) desc += `, Res: ${info.width}x${info.height}`;
      if (info.fps) desc += `, FPS: ${info.fps.toFixed(2)}`;
      if (info.bit_depth_luma_minus8 > 0) desc += `, Depth: ${info.bit_depth_luma_minus8 + 8}bit`;

      // 传递原始SPS NALU数据以供WebCodecs使用
      info.description = new Uint8Array(spsData);

      return info;

    } catch (e) {
      console.error("Error parsing SPS:", e);

      // 即使解析失败，也尝试提供最基本的配置信息
      if (spsData.length > 4) {
        try {
          const basicProfile = spsData[1];
          const basicConstraints = spsData[2];
          const basicLevel = spsData[3];

          const pp = basicProfile.toString(16).padStart(2, '0');
          const cc = basicConstraints.toString(16).padStart(2, '0');
          const ll = basicLevel.toString(16).padStart(2, '0');

          return {
            profile_idc: basicProfile,
            level_idc: basicLevel,
            decoderConfig: { codec: `avc1.${pp}${cc}${ll}` },
            description: new Uint8Array(spsData),
            parseError: e.message // 标记发生了解析错误
          };
        } catch (fallbackErr) {
          console.error("Even fallback SPS extraction failed:", fallbackErr);
        }
      }

      return null; // 完全失败时返回null
    }
  }

  // --- VUI Parser ---
  parseVUI(reader) {
    const vui = {
      aspect_ratio_info_present_flag: 0,
      aspect_ratio_idc: 0,
      sar_width: 0,
      sar_height: 0,
      overscan_info_present_flag: 0,
      overscan_appropriate_flag: 0,
      video_signal_type_present_flag: 0,
      video_format: 5, // Default: Unspecified
      video_full_range_flag: 0,
      colour_description_present_flag: 0,
      colour_primaries: 2, // Default: Unspecified
      transfer_characteristics: 2, // Default: Unspecified
      matrix_coefficients: 2, // Default: Unspecified
      chroma_loc_info_present_flag: 0,
      chroma_sample_loc_type_top_field: 0,
      chroma_sample_loc_type_bottom_field: 0,
      timing_info_present_flag: 0,
      num_units_in_tick: 0,
      time_scale: 0,
      fixed_frame_rate_flag: 0,
      nal_hrd_parameters_present_flag: 0,
      vcl_hrd_parameters_present_flag: 0,
      pic_struct_present_flag: 0,
      bitstream_restriction_flag: 0,
      fps: null
    };

    try {
      vui.aspect_ratio_info_present_flag = reader.readBit();
      if (vui.aspect_ratio_info_present_flag) {
        vui.aspect_ratio_idc = reader.readBits(8);
        if (vui.aspect_ratio_idc === 255 /* Extended_SAR */) {
          vui.sar_width = reader.readBits(16);
          vui.sar_height = reader.readBits(16);
        }
      }

      vui.overscan_info_present_flag = reader.readBit();
      if (vui.overscan_info_present_flag) {
        vui.overscan_appropriate_flag = reader.readBit();
      }

      vui.video_signal_type_present_flag = reader.readBit();
      if (vui.video_signal_type_present_flag) {
        vui.video_format = reader.readBits(3);
        vui.video_full_range_flag = reader.readBit();
        vui.colour_description_present_flag = reader.readBit();
        if (vui.colour_description_present_flag) {
          vui.colour_primaries = reader.readBits(8);
          vui.transfer_characteristics = reader.readBits(8);
          vui.matrix_coefficients = reader.readBits(8);
        }
      }

      vui.chroma_loc_info_present_flag = reader.readBit();
      if (vui.chroma_loc_info_present_flag) {
        vui.chroma_sample_loc_type_top_field = reader.readUE();
        vui.chroma_sample_loc_type_bottom_field = reader.readUE();
      }

      vui.timing_info_present_flag = reader.readBit();
      if (vui.timing_info_present_flag) {
        vui.num_units_in_tick = reader.readBits(32);
        vui.time_scale = reader.readBits(32);
        vui.fixed_frame_rate_flag = reader.readBit();

        if (vui.num_units_in_tick > 0 && vui.time_scale > 0) {
          // H.264 spec: time_scale/num_units_in_tick is the number of clock ticks per output frame period
          // For frame rate, it's often time_scale / (2 * num_units_in_tick) due to field coding?
          // Let's use the simpler formula first, adjust if needed.
          // Using the common interpretation:
          vui.fps = vui.time_scale / (2 * vui.num_units_in_tick);
        }
      }

      // Skipping HRD parameters parsing for brevity
      vui.nal_hrd_parameters_present_flag = reader.readBit();
      if (vui.nal_hrd_parameters_present_flag) {
        console.warn("Skipping NAL HRD parameters parsing in VUI.");
        this.skipHRDParameters(reader);
      }
      vui.vcl_hrd_parameters_present_flag = reader.readBit();
      if (vui.vcl_hrd_parameters_present_flag) {
        console.warn("Skipping VCL HRD parameters parsing in VUI.");
        this.skipHRDParameters(reader);
      }
      if (vui.nal_hrd_parameters_present_flag || vui.vcl_hrd_parameters_present_flag) {
        reader.skipBits(1); // low_delay_hrd_flag
      }

      vui.pic_struct_present_flag = reader.readBit();
      vui.bitstream_restriction_flag = reader.readBit();
      if (vui.bitstream_restriction_flag) {
        reader.skipBits(1); // motion_vectors_over_pic_boundaries_flag
        reader.readUE(); // max_bytes_per_pic_denom
        reader.readUE(); // max_bits_per_mb_denom
        reader.readUE(); // log2_max_mv_length_horizontal
        reader.readUE(); // log2_max_mv_length_vertical
        reader.readUE(); // max_num_reorder_frames
        reader.readUE(); // max_dec_frame_buffering
      }

      return vui;
    } catch (e) {
      console.error("Error parsing VUI parameters:", e);
      return null; // Indicate failure
    }
  }

  // Helper to skip HRD parameters (complex structure)
  skipHRDParameters(reader) {
    const cpb_cnt_minus1 = reader.readUE();
    reader.skipBits(4); // bit_rate_scale
    reader.skipBits(4); // cpb_size_scale
    for (let i = 0; i <= cpb_cnt_minus1; i++) {
      reader.readUE(); // bit_rate_value_minus1[i]
      reader.readUE(); // cpb_size_value_minus1[i]
      reader.readBit();  // cbr_flag[i]
    }
    reader.skipBits(5); // initial_cpb_removal_delay_length_minus1
    reader.skipBits(5); // cpb_removal_delay_length_minus1
    reader.skipBits(5); // dpb_output_delay_length_minus1
    reader.skipBits(5); // time_offset_length
  }

  // --- Update UI based on parsed SPS info ---
  updateVideoInfoUI(spsInfo) {
    const framerateElement = document.getElementById('framerate');
    const bitrateElement = document.getElementById('bitrate'); // Bitrate not in SPS
    const resolutionElement = document.getElementById('resolution'); // Assuming you have this element

    if (spsInfo?.fps) {
      if (framerateElement) {
        framerateElement.textContent = `${spsInfo.fps.toFixed(2)} fps (VUI)`;
      }
    } else {
      // Keep existing FFmpeg value or set to unknown if not yet determined
      if (framerateElement && (framerateElement.textContent === '-' || framerateElement.textContent === '帧率' || framerateElement.textContent.includes('未知'))) {
        framerateElement.textContent = '未知 (无VUI)';
      }
    }

    if (spsInfo?.width && spsInfo?.height) {
      if (resolutionElement) {
        resolutionElement.textContent = `${spsInfo.width}x${spsInfo.height}`;
      }

      // 安全地调用 updateResolution 方法（如果存在）
      if (this.ui && typeof this.ui.updateResolution === 'function') {
        this.ui.updateResolution(spsInfo.width, spsInfo.height);
      }
    } else {
      if (resolutionElement && (resolutionElement.textContent === '-' || resolutionElement.textContent === '分辨率')) {
        resolutionElement.textContent = '未知';
      }
    }

    // Bitrate is generally not available directly in SPS
    if (bitrateElement && (bitrateElement.textContent === '-' || bitrateElement.textContent === '码率')) {
      bitrateElement.textContent = '未知';
    }
  }

  combineNALUs(naluArrays) {
    const totalLength = naluArrays.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of naluArrays) {
      combined.set(arr, offset);
      offset += arr.length;
    }
    return combined;
  }

  extractDecoderConfig(spsData) {
    console.warn("Using fallback decoder config extraction (less info).");
    try {
      // Basic extraction from the first few bytes if full parsing failed
      if (spsData.length > 4) {
        const profile_idc = spsData[1];
        const profile_compatibility = spsData[2];
        const level_idc = spsData[3];

        const pp = profile_idc.toString(16).padStart(2, '0');
        const ll = level_idc.toString(16).padStart(2, '0');
        const cc = profile_compatibility.toString(16).padStart(2, '0');

        const codecString = `avc1.${pp}${cc}${ll}`;
        console.log(`Extracted fallback codec string: ${codecString}`);
        return { codec: codecString };
      }
    } catch (e) {
      console.error("Error during fallback SPS parsing:", e);
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

  mapFrameTypesToWebCodecsFrames() {
    if (!this.state.frames || !this.state.frames.length || !this.state.webCodecChunks) return;

    console.log("正在映射 WebCodecs 帧类型...");

    // 为每一帧添加正确的类型属性
    for (let i = 0; i < this.state.frames.length; i++) {
      const frame = this.state.frames[i];

      // 检查是否已有帧类型
      if (!frame.type && i < this.state.webCodecChunks.length) {
        // 使用预先存储的推断类型
        const inferredType = this.state.webCodecChunks[i].inferredType || '?';
        frame.type = inferredType;

        // 更新帧类型统计
        if (window.app && typeof window.app.updateFrameTypeStats === 'function') {
          window.app.updateFrameTypeStats(inferredType);
        }

        console.log(`Frame ${i}: 设置类型为 ${inferredType}`);
      }
    }

    console.log("WebCodecs 帧类型映射完成");
  }
}
