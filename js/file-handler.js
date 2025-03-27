import { Utils } from './utils.js';

export class FileHandler {
    constructor(state, ui, naluHandler) {
        this.state = state;
        this.ui = ui;
        this.naluHandler = naluHandler;
        this.utils = new Utils();
    }

    async processFile(file) {
        try {
            // 重置所有显示
            this.ui.resetVideoInfo();
            
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
            
            // 写入文件到 FFmpeg
            this.state.ffmpeg.FS('writeFile', 'input.264', fileArray);
            this.ui.updateProgress(30, '分析视频信息...');
            
            // 分析帧信息
            await this.analyzeFrames();
            this.ui.updateProgress(50, '提取帧数据...');
            
            // 提取帧
            await this.extractFrames();
            this.ui.updateProgress(80, '分析 NALU 数据...');
            
            // 分析 NALU
            await this.analyzeNALUs(fileArray);
            
            // 完成处理
            this.ui.updateProgress(100, '处理完成！');
            setTimeout(() => {
                this.ui.hideProgress();
            }, 1000);
            
        } catch (error) {
            console.error('文件处理错误:', error);
            this.utils.showError('文件处理失败');
            this.ui.resetVideoInfo();
            this.ui.updateUploadSection(false);
            this.ui.hideProgress();
        }
    }

    async analyzeFrames() {
        try {
            // 创建一个内存输出文件
            const outputName = 'stdout.txt';
            await this.state.ffmpeg.FS('writeFile', outputName, new Uint8Array());
            
            // 获取视频基本信息
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
                // 读取输出数据
                const outputData = this.state.ffmpeg.FS('readFile', outputName);
                const outputText = new TextDecoder().decode(outputData);
                
                if (outputText.trim()) {
                    const videoInfo = JSON.parse(outputText);
                    
                    // 处理视频信息
                    if (videoInfo.streams && videoInfo.streams[0]) {
                        const stream = videoInfo.streams[0];
                        
                        // 处理帧率
                        if (stream.r_frame_rate) {
                            const [num, den] = stream.r_frame_rate.split('/');
                            const fps = Math.round((parseInt(num) / parseInt(den) * 100)) / 100;
                            const framerateElement = document.getElementById('framerate');
                            if (framerateElement) {
                                framerateElement.textContent = `${fps} fps`;
                            }
                        }
                        
                        // 处理码率
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
                // 如果解析失败，尝试使用 SPS 数据
                await this.analyzeFromSPS();
            } finally {
                // 清理临时文件
                try {
                    this.state.ffmpeg.FS('unlink', outputName);
                } catch (e) {
                    // 忽略清理错误
                }
            }

            // 如果还没有帧率信息，使用SPS数据进行补充分析
            const framerateElement = document.getElementById('framerate');
            if (framerateElement && !framerateElement.textContent.includes('fps')) {
                await this.analyzeFromSPS();
            }

            // 获取帧统计信息
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
        return frameFiles.map((name, index) => {
            const type = frameTypes[index] || '?';
            // ���新帧类型统计
            window.app.updateFrameTypeStats(type);
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
            if (this.state.currentNALUs.length > 0) {
                this.state.currentNALUIndex = 0;
                // 使用 Promise 确保 NALU 分析完成后再显示
                await new Promise(resolve => {
                    // 确保 UI 更新在下一个事件循环中执行
                    setTimeout(() => {
                        this.ui.updateNALUInfo(this.state.currentNALUs[0]);
                        this.ui.updateNALUCounter();
                        // 手动触发 NALU 显示
                        if (this.naluHandler) {
                            this.naluHandler.displayNALU(0);
                        }
                        resolve();
                    }, 0);
                });
            }
        } catch (error) {
            console.error('NALU分析错误:', error);
            throw error;
        }
    }

    findNALUs(data) {
        const nalus = [];
        let i = 0;
        
        while (i < data.length) {
            const startCode = this.findStartCode(data, i);
            if (startCode) {
                const nextStart = this.findNextStartCode(data, i + startCode);
                const nalu = this.createNALU(data, i, nextStart, startCode);
                
                // 添加调试信息
                console.log('Found NALU:', {
                    startIndex: nalu.startIndex,
                    length: nalu.length,
                    startCode: nalu.startCode,
                    type: nalu.type,
                    nextStart
                });
                
                nalus.push(nalu);
                i = nextStart;
            } else {
                i++;
            }
        }
        return nalus;
    }

    findStartCode(data, index) {
        if (index + 3 >= data.length) return null;
        
        if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
            return 3;
        }
        
        if (index + 4 < data.length &&
            data[index] === 0 && data[index + 1] === 0 && 
            data[index + 2] === 0 && data[index + 3] === 1) {
            return 4;
        }
        
        return null;
    }

    findNextStartCode(data, startIndex) {
        let i = startIndex;
        while (i < data.length - 3) {
            if (this.findStartCode(data, i)) {
                break;
            }
            i++;
        }
        return i;
    }

    createNALU(data, start, end, startCode) {
        return {
            startIndex: start,
            length: end - start,
            type: data[start + startCode] & 0x1F,
            startCode: startCode,
            data: data.slice(start, end)
        };
    }

    clearFile() {
        // 重置状态
        this.state.reset();
        
        // 清除文件系统中的文件
        try {
            const files = this.state.ffmpeg.FS('readdir', '/');
            files.forEach(file => {
                if (file !== '.' && file !== '..') {
                    try {
                        this.state.ffmpeg.FS('unlink', file);
                    } catch (e) {
                        // 忽略删除错误
                    }
                }
            });
        } catch (error) {
            console.error('清除文件系统错误:', error);
        }

        // 清除UI显示
        this.ui.clearFileUI();
        
        // 清除帧类型统计
        window.app.clearFrameTypeStats();
    }
}
