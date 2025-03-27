export class Utils {
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    showError(message) {
        alert(message);
    }

    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    // NALU 类型常量
    static NALU_TYPES = {
        1: { name: "非IDR图像片", color: "#4CAF50" },
        5: { name: "IDR图像片", color: "#2196F3" },
        6: { name: "SEI", color: "#9C27B0" },
        7: { name: "SPS", color: "#F44336" },
        8: { name: "PPS", color: "#FF9800" },
        9: { name: "分隔符", color: "#795548" },
        10: { name: "序列结束", color: "#607D8B" },
        11: { name: "码流结束", color: "#9E9E9E" },
        12: { name: "填充", color: "#BDBDBD" }
    };

    // 帧类型名称映射
    static FRAME_TYPES = {
        'I': 'I帧 (关键帧)',
        'P': 'P帧 (预测帧)',
        'B': 'B帧 (双向预测帧)',
        '?': '未知'
    };
} 