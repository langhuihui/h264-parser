import { Utils } from './utils.js';

export class UIHandler {
  constructor(state) {
    this.state = state;
  }

  updateProgress(percent, message) {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    if (!progressContainer || !progressBar || !progressText) return;

    progressContainer.style.display = 'block';
    progressBar.style.width = `${percent}%`;
    progressText.textContent = message || `${percent}%`;
  }

  hideProgress() {
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
      progressContainer.style.display = 'none';
    }
  }

  updateFrameList() {
    const frameList = document.getElementById('frameList');
    frameList.innerHTML = '';

    this.state.frames.forEach((frame, index) => {
      const frameDiv = document.createElement('div');
      frameDiv.className = 'frame-item';
      if (this.state.frameErrors.has(index)) {
        frameDiv.classList.add('error');
      }

      frameDiv.innerHTML = `
                <div class="frame-number">${index + 1}</div>
                <div class="frame-type">${frame.type}</div>
                ${frame.pts !== undefined ? `<div class="frame-pts">PTS: ${frame.pts.toFixed(3)}</div>` : ''}
                ${frame.dts !== undefined ? `<div class="frame-dts">DTS: ${frame.dts.toFixed(3)}</div>` : ''}
            `;

      frameDiv.onclick = () => this.selectFrame(index);
      frameList.appendChild(frameDiv);
    });
  }

  updateNALUInfo(nalu) {
    const naluInfo = document.getElementById('naluInfo');
    const type = Utils.NALU_TYPES[nalu.type] || { name: "未知类型", color: "#000000" };

    naluInfo.innerHTML = `
            <div class="nalu-type-header">
                <div class="type-indicator" style="width: 100%; background-color: ${type.color}">
                    <span class="type-name">${type.name}</span>
                    <span class="nalu-size">类型: ${nalu.type}</span>
                    <div class="type-value"> ${nalu.length.toLocaleString()} 字节</div>
                </div>
            </div>
            <div class="nalu-byte-info">
                <h4>NALU 字节说明</h4>
                <div class="byte-meaning">
                    <span class="label">起始码 (${nalu.startCode}字节):</span>
                    <span class="value">${nalu.startCode === 3 ? '00 00 01' : '00 00 00 01'}</span>
                </div>
                <div class="byte-meaning">
                    <span class="label">NALU 头部:</span>
                    <span class="value">${this.formatNALUHeader(nalu)}</span>
                </div>
            </div>
            ${this.generateNALUSpecificInfo(nalu)}
        `;
  }

  generateNALUSpecificInfo(nalu) {
    // 根据NALU类型生成特定的信息
    switch (nalu.type) {
      case 7: // SPS
        return this.generateSPSInfo(nalu);
      // 可以为其他类型的NALU添加特定的处理方法
      default:
        return '';
    }
  }

  generateSPSInfo(nalu) {
    // 检查是否有SPS信息
    if (!nalu.spsInfo || nalu.spsInfo.error) {
      return `
        <div class="sps-info error">
          <h4>SPS解析错误</h4>
          <p>${nalu.spsInfo?.error || '未知错误'}</p>
          ${nalu.spsInfo?.errorDetails ? `<p class="error-details">${nalu.spsInfo.errorDetails}</p>` : ''}
        </div>
      `;
    }

    const sps = nalu.spsInfo;

    return `
      <div class="sps-info">
        <h4>序列参数集 (SPS) 详细信息</h4>
        
        <div class="sps-section">
          <h5>基本信息</h5>
          <table class="sps-table">
            <tr>
              <td>视频配置 (profile_idc):</td>
              <td>${sps.profile_idc} (${sps.profile_name})</td>
            </tr>
            <tr>
              <td>Level:</td>
              <td>${sps.level_idc / 10}</td>
            </tr>
            <tr>
              <td>序列参数集ID:</td>
              <td>${sps.seq_parameter_set_id}</td>
            </tr>
          </table>
        </div>
        
        <div class="sps-section">
          <h5>图像尺寸信息</h5>
          <table class="sps-table">
            <tr>
              <td>宽度:</td>
              <td>${sps.width} 像素</td>
            </tr>
            <tr>
              <td>高度:</td>
              <td>${sps.height} 像素</td>
            </tr>
            <tr>
              <td>宽度(宏块数):</td>
              <td>${sps.width_in_mbs} (${sps.pic_width_in_mbs_minus1 + 1})</td>
            </tr>
            <tr>
              <td>高度(映射单元数):</td>
              <td>${sps.height_in_map_units} (${sps.pic_height_in_map_units_minus1 + 1})</td>
            </tr>
          </table>
        </div>
        
        <div class="sps-section">
          <h5>视频格式</h5>
          <table class="sps-table">
            <tr>
              <td>帧编码模式:</td>
              <td>${sps.frame_mbs_only_flag ? '帧编码' : '场编码'}</td>
            </tr>
            <tr>
              <td>隔行扫描:</td>
              <td>${sps.interlaced ? '是' : '否'}</td>
            </tr>
            ${sps.chroma_format !== undefined ? `
            <tr>
              <td>色度格式:</td>
              <td>${sps.chroma_format || '未知'}</td>
            </tr>` : ''}
            ${sps.bit_depth_luma !== undefined ? `
            <tr>
              <td>亮度位深度:</td>
              <td>${sps.bit_depth_luma} 位</td>
            </tr>` : ''}
            ${sps.bit_depth_chroma !== undefined ? `
            <tr>
              <td>色度位深度:</td>
              <td>${sps.bit_depth_chroma} 位</td>
            </tr>` : ''}
          </table>
        </div>
        
        <div class="sps-section">
          <h5>参考帧信息</h5>
          <table class="sps-table">
            <tr>
              <td>最大帧编号:</td>
              <td>${sps.max_frame_num}</td>
            </tr>
            <tr>
              <td>最大参考帧数量:</td>
              <td>${sps.max_num_ref_frames}</td>
            </tr>
            <tr>
              <td>帧序列类型:</td>
              <td>类型 ${sps.pic_order_cnt_type}</td>
            </tr>
          </table>
        </div>

        ${sps.frame_cropping_flag ? `
        <div class="sps-section">
          <h5>裁剪信息</h5>
          <table class="sps-table">
            <tr>
              <td>左边界裁剪:</td>
              <td>${sps.frame_crop_left_offset}</td>
            </tr>
            <tr>
              <td>右边界裁剪:</td>
              <td>${sps.frame_crop_right_offset}</td>
            </tr>
            <tr>
              <td>上边界裁剪:</td>
              <td>${sps.frame_crop_top_offset}</td>
            </tr>
            <tr>
              <td>下边界裁剪:</td>
              <td>${sps.frame_crop_bottom_offset}</td>
            </tr>
          </table>
        </div>
        ` : ''}

        ${sps.aspect_ratio ? `
        <div class="sps-section">
          <h5>显示比例</h5>
          <table class="sps-table">
            <tr>
              <td>宽高比:</td>
              <td>${sps.aspect_ratio}</td>
            </tr>
          </table>
        </div>
        ` : ''}
        
        <div class="sps-section">
          <h5>约束标志</h5>
          <table class="sps-table">
            <tr>
              <td>constraint_set0_flag:</td>
              <td>${sps.constraint_set0_flag}</td>
            </tr>
            <tr>
              <td>constraint_set1_flag:</td>
              <td>${sps.constraint_set1_flag}</td>
            </tr>
            <tr>
              <td>constraint_set2_flag:</td>
              <td>${sps.constraint_set2_flag}</td>
            </tr>
            <tr>
              <td>constraint_set3_flag:</td>
              <td>${sps.constraint_set3_flag}</td>
            </tr>
            <tr>
              <td>constraint_set4_flag:</td>
              <td>${sps.constraint_set4_flag}</td>
            </tr>
            <tr>
              <td>constraint_set5_flag:</td>
              <td>${sps.constraint_set5_flag}</td>
            </tr>
          </table>
        </div>
      </div>
    `;
  }

  formatNALUHeader(nalu) {
    const header = nalu.data[nalu.startCode];
    return `${header.toString(16).padStart(2, '0')} - 
            forbidden_bit(1bit): ${(header >> 7) & 1},
            nal_ref_idc(2bits): ${(header >> 5) & 3},
            nal_unit_type(5bits): ${nalu.type}`;
  }

  selectFrame(index) {
    if (index < 0 || index >= this.state.frames.length) return;

    this.state.currentFrameIndex = index;
    this.updateFrameSlider(); // Updates slider position and number display

    // Highlight in the list
    this.highlightFrameInList(index); // Call the new highlight method

    // Update NALU info if relevant (optional, depends on desired behavior)
    // this.updateNALUInfoForFrame(index);

    // Draw the selected frame to the canvas
    this.drawFrameToCanvas(index);
  }

  drawFrameToCanvas(index) {
    const frameObject = this.state.frames[index]; // Get the wrapper object
    const canvas = document.getElementById('frameCanvas'); // Correct canvas ID
    if (!canvas || !frameObject) return;
    const ctx = canvas.getContext('2d');

    let frameType = '?';
    let resolutionText = '-';

    if (this.state.selectedDecoder === 'webcodecs') {
      const frame = frameObject.videoFrame; // Get the VideoFrame from the wrapper
      frameType = frameObject.type || '?'; // Use type from wrapper

      if (frame && frame instanceof VideoFrame) {
        // Adjust canvas size only if necessary
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
        resolutionText = `${frame.displayWidth}x${frame.displayHeight}`;
        document.getElementById('frameError').style.display = 'none'; // Hide error overlay
      } else {
        console.warn(`WebCodecs frame at index ${index} is not a valid VideoFrame.`);
        this.drawPlaceholder(ctx, canvas.width, canvas.height, 'No WebCodecs frame available');
        document.getElementById('frameError').style.display = 'flex'; // Show error overlay
      }
    } else if (this.state.selectedDecoder === 'ffmpeg') {
      // Assuming frameObject for FFmpeg has { name: '...', type: 'I/P/B' }
      frameType = frameObject.type || '?';
      // FFmpeg resolution is typically set once during analysis, but we can try reading from canvas if needed
      // resolutionText = `${canvas.width}x${canvas.height}`; // Or get from state if stored
      console.log(`FFmpeg frame preview for index ${index}`);
      // Use displayFFmpegFrame from playback controller for actual drawing if needed
      // For now, just draw placeholder on manual select
      this.drawPlaceholder(ctx, canvas.width, canvas.height, `FFmpeg Frame ${index + 1} (${frameType})`);
      // We need a way to get resolution for FFmpeg frames here if not already set
      resolutionText = document.getElementById('resolution').textContent; // Keep existing if available
    } else {
      this.drawPlaceholder(ctx, canvas.width, canvas.height, 'Decoder not selected or frame invalid');
    }

    // --- Update UI Elements ---
    document.getElementById('currentFrameInfo').textContent = `帧 ${index + 1}`;
    document.getElementById('frameType').textContent = frameType; // Use extracted/placeholder type
    document.getElementById('resolution').textContent = resolutionText; // Update resolution
    // --- End Update UI --- 
  }

  drawPlaceholder(ctx, width, height, text) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'grey';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '16px sans-serif';
    ctx.fillText(text, width / 2, height / 2);
  }

  updateFrameSlider() {
    const slider = document.getElementById('frameSlider');
    const frameCount = this.state.frames.length;
    const frameNumberDisplay = document.getElementById('currentFrameNumber');
    const totalFrameDisplay = document.getElementById('totalFrameCount');

    if (slider) {
      slider.max = frameCount > 0 ? frameCount - 1 : 0;
      slider.value = this.state.currentFrameIndex;
      slider.disabled = frameCount === 0;
    }
    if (frameNumberDisplay) {
      frameNumberDisplay.textContent = frameCount > 0 ? this.state.currentFrameIndex + 1 : 0;
    }
    if (totalFrameDisplay) {
      totalFrameDisplay.textContent = frameCount;
    }
  }

  updatePlaybackTime(frameIndex) {
    const slider = document.getElementById('frameSlider');
    if (slider) {
      slider.value = frameIndex;
    }
    // Update the displayed frame number next to the slider
    const frameNumberDisplay = document.getElementById('currentFrameNumber');
    if (frameNumberDisplay) {
      frameNumberDisplay.textContent = frameIndex + 1; // Display 1-based index
    }
  }

  highlightFrameInList(frameIndex) {
    const frameList = document.getElementById('frameList');
    if (frameList) {
      const items = frameList.querySelectorAll('li');
      items.forEach((item, index) => {
        if (index === frameIndex) {
          item.classList.add('active');
          // Optional: Scroll into view
          // item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          item.classList.remove('active');
        }
      });
    }
  }

  updateFrameHighlight() {
    const frameItems = document.querySelectorAll('.frame-item'); // Assuming frame list items have this class
    const frameList = document.getElementById('frameList'); // Assuming this is the container

    if (!frameList || frameItems.length === 0) return; // Exit if list or items don't exist

    frameItems.forEach((item, index) => {
      if (index === this.state.currentFrameIndex) {
        item.classList.add('active'); // Add 'active' class to the current frame item
        // Optional: Scroll the active item into view if needed
        // item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        item.classList.remove('active'); // Remove 'active' class from other items
      }
    });
  }

  centerActiveFrame(activeItem, frameList) {
    const itemRect = activeItem.getBoundingClientRect();
    const listRect = frameList.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const listCenter = listRect.left + listRect.width / 2;
    const offset = itemCenter - listCenter;

    frameList.scrollTo({
      left: frameList.scrollLeft + offset,
      behavior: this.state.isPlaying ? 'auto' : 'smooth'
    });
  }

  async displayFrame(frame) {
    try {
      const frameData = this.state.ffmpeg.FS('readFile', frame.name);
      const canvas = document.getElementById('frameCanvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);

        document.getElementById('resolution').textContent =
          `${img.width}x${img.height}`;
      };

      const blob = new Blob([frameData.buffer], { type: 'image/png' });
      img.src = URL.createObjectURL(blob);

      document.getElementById('currentFrameInfo').textContent =
        `帧 ${this.state.currentFrameIndex + 1}`;
      document.getElementById('frameType').textContent =
        Utils.FRAME_TYPES[frame.type];
      document.getElementById('frameError').style.display = 'none';
    } catch (error) {
      console.error('帧显示错误:', error);
      document.getElementById('frameError').style.display = 'flex';
      this.state.frameErrors.add(this.state.currentFrameIndex);
    }
  }

  updateNALUCounter() {
    document.getElementById('naluCounter').textContent =
      `${this.state.currentNALUIndex + 1}/${this.state.currentNALUs.length}`;
  }

  clearFileUI() {
    const uploadSection = document.getElementById('uploadSection');
    const fileInput = document.getElementById('fileInput');
    const fileName = document.querySelector('.file-name');
    const fileSize = document.querySelector('.file-size');
    const clearButton = document.getElementById('clearFile');

    uploadSection.classList.remove('has-file');
    uploadSection.classList.add('expanded');
    fileInput.value = '';
    fileName.textContent = '';
    fileSize.textContent = '';
    clearButton.style.display = 'none';

    document.getElementById('frameList').innerHTML = '';
    document.getElementById('currentFrameInfo').textContent = '未加载';
    document.getElementById('resolution').textContent = '-';
    document.getElementById('frameType').textContent = '-';
    document.getElementById('bitrate').textContent = '-';
    document.getElementById('framerate').textContent = '-';
    document.getElementById('frameCount').textContent = '0';
    document.getElementById('playPauseButton').disabled = true;

    const canvas = document.getElementById('frameCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  resetVideoInfo() {
    const elements = {
      'resolution': '分辨率',
      'frameType': '帧类型',
      'bitrate': '码率',
      'framerate': '帧率',
      'frameCount': '总帧数'
    };

    for (const [id, placeholder] of Object.entries(elements)) {
      const element = document.getElementById(id);
      if (element) {
        element.innerHTML = `<span class="placeholder">${placeholder}</span>`;
      }
    }

    // 清空帧列表
    const frameList = document.getElementById('frameList');
    if (frameList) {
      frameList.innerHTML = '<div class="empty-state">未加载文件</div>';
    }

    // 重置当前帧信息
    const currentFrameInfo = document.getElementById('currentFrameInfo');
    if (currentFrameInfo) {
      currentFrameInfo.innerHTML = '<span class="placeholder">未加载帧</span>';
    }

    // 重置 NALU 信息
    const naluInfo = document.getElementById('naluInfo');
    if (naluInfo) {
      naluInfo.innerHTML = '<div class="empty-state">未加载 NALU 数据</div>';
    }

    // 清空十六进制查看器
    const hexContent = document.getElementById('hexContent');
    if (hexContent) {
      hexContent.innerHTML = '<div class="empty-state">未加载数据</div>';
    }

    // 重置 NALU 计数器
    const naluCounter = document.getElementById('naluCounter');
    if (naluCounter) {
      naluCounter.textContent = '0/0';
    }
  }

  updateUploadSection(hasFile) {
    const uploadSection = document.getElementById('uploadSection');
    const fileInput = document.getElementById('fileInput');
    const fileName = document.querySelector('.file-name');
    const fileSize = document.querySelector('.file-size');
    const clearButton = document.getElementById('clearFile');
    const dropText = document.querySelector('.drop-text');

    if (hasFile) {
      uploadSection.classList.remove('expanded');
      uploadSection.classList.add('has-file');
      clearButton.style.display = 'block';
      if (dropText) {
        dropText.style.display = 'none';
      }
    } else {
      uploadSection.classList.remove('has-file');
      uploadSection.classList.add('expanded');
      fileInput.value = '';
      fileName.textContent = '';
      fileSize.textContent = '';
      clearButton.style.display = 'none';
      if (dropText) {
        dropText.style.display = 'block';
      }
    }
  }

  updatePlayPauseButton(isPlaying) {
    const button = document.getElementById('playPauseButton');
    if (button) {
      if (isPlaying) {
        button.textContent = '暂停'; // Or use an icon
        // button.innerHTML = '<i class="fas fa-pause"></i>';
      } else {
        // Consider 'Replay' state if at the end and not looping
        // if (this.state.currentFrameIndex >= this.state.frames.length - 1 && !this.state.loopPlayback) {
        //    button.textContent = '重播';
        // } else {
        button.textContent = '播放'; // Or use an icon
        //    button.innerHTML = '<i class="fas fa-play"></i>';
        // }
      }
      button.disabled = this.state.frames.length === 0;
    }
  }

  // 添加 updateResolution 方法，用于更新和设置分辨率信息
  updateResolution(width, height) {
    // 更新分辨率文本
    const resolutionElement = document.getElementById('resolution');
    if (resolutionElement) {
      resolutionElement.textContent = `${width}x${height}`;
    }

    // 如果需要，调整 Canvas 大小以匹配视频分辨率
    const canvas = document.getElementById('frameCanvas');
    if (canvas) {
      // 检查当前 Canvas 尺寸是否与视频尺寸不同
      if (canvas.width !== width || canvas.height !== height) {
        console.log(`Adjusting canvas size to ${width}x${height}`);
        canvas.width = width;
        canvas.height = height;
      }
    }

    // 可能需要存储分辨率到 state 中以便后续使用
    if (this.state) {
      this.state.videoWidth = width;
      this.state.videoHeight = height;
    }
  }
}