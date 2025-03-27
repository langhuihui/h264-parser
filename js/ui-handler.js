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
        this.state.currentFrameIndex = index;
        this.updateFrameHighlight();
        this.displayFrame(this.state.frames[index]);
    }

    updateFrameHighlight() {
        const frameItems = document.querySelectorAll('.frame-item');
        const frameList = document.getElementById('frameList');
        
        frameItems.forEach((item, index) => {
            if (index === this.state.currentFrameIndex) {
                item.classList.add('active');
                this.centerActiveFrame(item, frameList);
            } else {
                item.classList.remove('active');
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
} 