import { Utils } from './utils.js';

export class NALUHandler {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }

    previousNALU() {
        if (this.state.currentNALUIndex > 0) {
            this.state.currentNALUIndex--;
            this.displayNALU(this.state.currentNALUIndex);
        }
    }

    nextNALU() {
        if (this.state.currentNALUIndex < this.state.currentNALUs.length - 1) {
            this.state.currentNALUIndex++;
            this.displayNALU(this.state.currentNALUIndex);
        }
    }

    displayNALU(index) {
        const nalu = this.state.currentNALUs[index];
        if (!nalu) return;

        console.log('Displaying NALU:', {
            index,
            startIndex: nalu.startIndex,
            length: nalu.length,
            startCode: nalu.startCode,
            type: nalu.type
        });

        this.ui.updateNALUInfo(nalu);
        this.displayHexView(nalu);
        this.ui.updateNALUCounter();
    }

    displayHexView(nalu) {
        const hexContent = document.getElementById('hexContent');
        if (!hexContent) return;
        
        hexContent.innerHTML = '';
        const data = nalu.data;

        // 添加调试信息
        console.log('HexView data:', {
            dataLength: data.length,
            startCode: data.slice(0, nalu.startCode),
            naluType: data[nalu.startCode]
        });

        for (let i = 0; i < data.length; i += 16) {
            const rowDiv = this.createHexRow(data, i, nalu);
            hexContent.appendChild(rowDiv);
        }

        this.setupHexViewTooltips(hexContent);
    }

    createHexRow(data, offset, nalu) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'hex-row';

        // 添加偏移量
        const offsetSpan = document.createElement('span');
        offsetSpan.className = 'hex-offset';
        offsetSpan.textContent = offset.toString(16).padStart(8, '0');
        rowDiv.appendChild(offsetSpan);

        // 添加十六进制字节
        const bytesDiv = this.createHexBytes(data, offset, nalu);
        rowDiv.appendChild(bytesDiv);

        // 添加ASCII表示
        const asciiDiv = this.createAsciiView(data, offset);
        rowDiv.appendChild(asciiDiv);

        return rowDiv;
    }

    createHexBytes(data, offset, nalu) {
        const bytesDiv = document.createElement('div');
        bytesDiv.className = 'hex-bytes';

        for (let j = 0; j < 16; j++) {
            if (offset + j < data.length) {
                const byte = data[offset + j];
                const byteSpan = this.createByteSpan(byte, offset + j, nalu);
                bytesDiv.appendChild(byteSpan);
            } else {
                const emptySpan = document.createElement('span');
                emptySpan.className = 'hex-byte';
                emptySpan.textContent = '  ';
                bytesDiv.appendChild(emptySpan);
            }
        }

        return bytesDiv;
    }

    createByteSpan(byte, position, nalu) {
        const byteSpan = document.createElement('span');
        byteSpan.className = 'hex-byte';

        // 计算相对于数据开始的位置
        const isStartCode = position < nalu.startCode;
        const isNaluType = position === nalu.startCode;

        if (isStartCode) {
            byteSpan.classList.add('start-code');
            byteSpan.dataset.tooltip = '起始码';
        }
        
        if (isNaluType) {
            byteSpan.classList.add('nalu-type');
            const naluTypeInfo = Utils.NALU_TYPES[byte & 0x1F];
            byteSpan.dataset.tooltip = `NALU类型字节: ${naluTypeInfo?.name || '未知类型'}`;
        }

        byteSpan.textContent = byte.toString(16).padStart(2, '0');
        return byteSpan;
    }

    createAsciiView(data, offset) {
        const asciiDiv = document.createElement('div');
        asciiDiv.className = 'hex-ascii';
        
        const ascii = [];
        for (let j = 0; j < 16 && offset + j < data.length; j++) {
            const byte = data[offset + j];
            ascii.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.');
        }
        
        asciiDiv.textContent = ascii.join('');
        return asciiDiv;
    }

    setupHexViewTooltips(hexContent) {
        const tooltip = document.createElement('div');
        tooltip.className = 'hex-byte-tooltip';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);

        hexContent.addEventListener('mouseover', (e) => {
            const target = e.target;
            if (target.classList.contains('hex-byte') && target.dataset.tooltip) {
                tooltip.textContent = target.dataset.tooltip;
                tooltip.style.display = 'block';
                this.updateTooltipPosition(tooltip, e);
            }
        });

        hexContent.addEventListener('mouseout', () => {
            tooltip.style.display = 'none';
        });

        hexContent.addEventListener('mousemove', (e) => {
            if (tooltip.style.display === 'block') {
                this.updateTooltipPosition(tooltip, e);
            }
        });
    }

    updateTooltipPosition(tooltip, event) {
        tooltip.style.left = `${event.pageX + 10}px`;
        tooltip.style.top = `${event.pageY + 10}px`;
    }
} 