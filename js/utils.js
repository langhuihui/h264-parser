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

  showSuccess(message) {
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

  // SPS中常见的视频格式定义
  static PROFILE_IDC = {
    66: "Baseline Profile",
    77: "Main Profile",
    88: "Extended Profile",
    100: "High Profile",
    110: "High 10 Profile",
    122: "High 4:2:2 Profile",
    244: "High 4:4:4 Profile"
  };

  // 色度格式
  static CHROMA_FORMAT_IDC = {
    0: "单色(Monochrome)",
    1: "YUV 4:2:0",
    2: "YUV 4:2:2",
    3: "YUV 4:4:4"
  };

  // 解析SPS NALU数据
  static parseSPS(data, startIndex, length) {
    // 跳过起始码和NALU头
    const startCode = data[startIndex] === 0 && data[startIndex + 1] === 0 && data[startIndex + 2] === 1 ? 3 :
      (data[startIndex] === 0 && data[startIndex + 1] === 0 && data[startIndex + 2] === 0 && data[startIndex + 3] === 1 ? 4 : 0);

    if (startCode === 0) {
      return { error: "无效的起始码" };
    }

    // 创建一个新的Uint8Array，仅包含SPS数据(不含起始码和NALU头)
    const spsData = new Uint8Array(data.slice(startIndex + startCode + 1, startIndex + length));
    const bitReader = new BitReader(spsData);

    try {
      const sps = {};

      // 解析SPS基本信息
      sps.profile_idc = bitReader.readBits(8);
      sps.profile_name = Utils.PROFILE_IDC[sps.profile_idc] || "未知配置";

      // constraint_set 标志位和保留位 (共8位)
      sps.constraint_flags = bitReader.readBits(8);
      sps.constraint_set0_flag = (sps.constraint_flags >> 7) & 1;
      sps.constraint_set1_flag = (sps.constraint_flags >> 6) & 1;
      sps.constraint_set2_flag = (sps.constraint_flags >> 5) & 1;
      sps.constraint_set3_flag = (sps.constraint_flags >> 4) & 1;
      sps.constraint_set4_flag = (sps.constraint_flags >> 3) & 1;
      sps.constraint_set5_flag = (sps.constraint_flags >> 2) & 1;
      sps.reserved_zero_2bits = sps.constraint_flags & 3;

      // 层级
      sps.level_idc = bitReader.readBits(8);

      // 序列参数集ID
      sps.seq_parameter_set_id = bitReader.readUE();

      // 根据不同的Profile解析不同的参数
      if (sps.profile_idc === 100 || sps.profile_idc === 110 ||
        sps.profile_idc === 122 || sps.profile_idc === 244 ||
        sps.profile_idc === 44 || sps.profile_idc === 83 ||
        sps.profile_idc === 86 || sps.profile_idc === 118 ||
        sps.profile_idc === 128 || sps.profile_idc === 138) {

        // 色度格式
        sps.chroma_format_idc = bitReader.readUE();
        sps.chroma_format = Utils.CHROMA_FORMAT_IDC[sps.chroma_format_idc] || "未知";

        if (sps.chroma_format_idc === 3) {
          sps.separate_colour_plane_flag = bitReader.readBit();
        }

        // 位深度相关
        sps.bit_depth_luma_minus8 = bitReader.readUE();
        sps.bit_depth_chroma_minus8 = bitReader.readUE();
        sps.bit_depth_luma = sps.bit_depth_luma_minus8 + 8;
        sps.bit_depth_chroma = sps.bit_depth_chroma_minus8 + 8;

        sps.qpprime_y_zero_transform_bypass_flag = bitReader.readBit();

        // 缩放矩阵
        sps.scaling_matrix_present_flag = bitReader.readBit();
        if (sps.scaling_matrix_present_flag) {
          // 这里可以提取缩放矩阵，但可能较为复杂，暂略
          sps.scaling_matrix_info = "存在缩放矩阵，详细数据略";
        }
      }

      // 图片顺序计数类型
      sps.log2_max_frame_num_minus4 = bitReader.readUE();
      sps.max_frame_num = 1 << (sps.log2_max_frame_num_minus4 + 4);

      // 图片顺序计数类型
      sps.pic_order_cnt_type = bitReader.readUE();

      if (sps.pic_order_cnt_type === 0) {
        sps.log2_max_pic_order_cnt_lsb_minus4 = bitReader.readUE();
        sps.max_pic_order_cnt_lsb = 1 << (sps.log2_max_pic_order_cnt_lsb_minus4 + 4);
      } else if (sps.pic_order_cnt_type === 1) {
        sps.delta_pic_order_always_zero_flag = bitReader.readBit();
        sps.offset_for_non_ref_pic = bitReader.readSE();
        sps.offset_for_top_to_bottom_field = bitReader.readSE();
        sps.num_ref_frames_in_pic_order_cnt_cycle = bitReader.readUE();

        sps.offset_for_ref_frame = [];
        for (let i = 0; i < sps.num_ref_frames_in_pic_order_cnt_cycle; i++) {
          sps.offset_for_ref_frame.push(bitReader.readSE());
        }
      }

      // 参考帧相关
      sps.max_num_ref_frames = bitReader.readUE();
      sps.gaps_in_frame_num_value_allowed_flag = bitReader.readBit();

      // 图片尺寸相关参数
      sps.pic_width_in_mbs_minus1 = bitReader.readUE();
      sps.pic_height_in_map_units_minus1 = bitReader.readUE();

      // 计算实际图像尺寸(以像素为单位)
      sps.width_in_mbs = sps.pic_width_in_mbs_minus1 + 1;
      sps.height_in_map_units = sps.pic_height_in_map_units_minus1 + 1;

      // 宏块是16x16像素
      sps.width = sps.width_in_mbs * 16;

      // 帧/场相关
      sps.frame_mbs_only_flag = bitReader.readBit();

      if (sps.frame_mbs_only_flag) {
        // 帧编码，高度等于map_units * 16
        sps.height = sps.height_in_map_units * 16;
      } else {
        // 场编码，高度等于map_units * 16 * 2
        sps.mb_adaptive_frame_field_flag = bitReader.readBit();
        sps.height = sps.height_in_map_units * 16 * 2;
      }

      // 直接模式
      sps.direct_8x8_inference_flag = bitReader.readBit();

      // 裁剪参数
      sps.frame_cropping_flag = bitReader.readBit();
      if (sps.frame_cropping_flag) {
        sps.frame_crop_left_offset = bitReader.readUE();
        sps.frame_crop_right_offset = bitReader.readUE();
        sps.frame_crop_top_offset = bitReader.readUE();
        sps.frame_crop_bottom_offset = bitReader.readUE();

        // 根据裁剪参数调整最终尺寸
        // 详细计算方式参考H.264规范，这里使用简化版本
        const cropUnitX = 1; // 4:2:0和4:2:2的色度格式为2，4:4:4为1
        const cropUnitY = 2; // 4:2:0为2，其他为1

        sps.width -= (sps.frame_crop_left_offset + sps.frame_crop_right_offset) * cropUnitX;
        sps.height -= (sps.frame_crop_top_offset + sps.frame_crop_bottom_offset) * cropUnitY;
      }

      // VUI参数
      sps.vui_parameters_present_flag = bitReader.readBit();
      if (sps.vui_parameters_present_flag) {
        // 这里可以解析VUI参数，但较为复杂，现在只提取最常用的一些参数
        sps.aspect_ratio_info_present_flag = bitReader.readBit();
        if (sps.aspect_ratio_info_present_flag) {
          sps.aspect_ratio_idc = bitReader.readBits(8);
          if (sps.aspect_ratio_idc === 255) { // Extended_SAR
            sps.sar_width = bitReader.readBits(16);
            sps.sar_height = bitReader.readBits(16);
            sps.aspect_ratio = `${sps.sar_width}:${sps.sar_height}`;
          } else {
            // 可以添加预定义的宽高比
            const ASPECT_RATIOS = {
              1: "1:1",
              2: "12:11",
              3: "10:11",
              4: "16:11",
              5: "40:33",
              // ...其他宽高比
            };
            sps.aspect_ratio = ASPECT_RATIOS[sps.aspect_ratio_idc] || "未知";
          }
        }

        // 以下是VUI中的其他参数，可以根据需要解析
        // 目前只提取最基本的信息，如果需要更多参数可以继续添加
      }

      // 使用简单的方式判断是否是交错扫描(隔行扫描)视频
      sps.interlaced = !sps.frame_mbs_only_flag;

      return sps;
    } catch (e) {
      console.error("解析SPS时出错:", e);
      return {
        error: "解析SPS时出错",
        errorDetails: e.toString(),
        partialData: true
      };
    }
  }
}

export class BitReader {
  constructor(uint8Array) {
    this.uint8Array = uint8Array;
    this.byteIndex = 0;
    this.bitIndex = 0; // from left (MSB)
  }

  readBit() {
    if (this.byteIndex >= this.uint8Array.length) {
      throw new Error("Attempted to read past end of buffer");
    }
    const byte = this.uint8Array[this.byteIndex];
    const bit = (byte >> (7 - this.bitIndex)) & 1;
    this.bitIndex++;
    if (this.bitIndex === 8) {
      this.bitIndex = 0;
      this.byteIndex++;
    }
    return bit;
  }

  readBits(n) {
    let value = 0;
    for (let i = 0; i < n; i++) {
      value = (value << 1) | this.readBit();
    }
    return value;
  }

  // Read unsigned Exp-Golomb coded number ue(v)
  readUE() {
    let leadingZeroBits = 0;
    while (this.readBit() === 0 && leadingZeroBits < 32) {
      leadingZeroBits++;
    }
    if (leadingZeroBits === 32) return (1 << 32) - 1; // Indicate overflow or error
    const codeNum = this.readBits(leadingZeroBits);
    return (1 << leadingZeroBits) - 1 + codeNum;
  }

  // Read signed Exp-Golomb coded number se(v)
  readSE() {
    const ue = this.readUE();
    if (ue % 2 === 0) { // k is even
      return -1 * (ue / 2);
    } else { // k is odd
      return (ue + 1) / 2;
    }
  }

  // 计算剩余可读位数
  remainingBits() {
    if (this.byteIndex >= this.uint8Array.length) {
      return 0;
    }

    // 当前字节中剩余的位数 + 后续字节中的所有位数
    return (8 - this.bitIndex) + (this.uint8Array.length - this.byteIndex - 1) * 8;
  }

  // Check if more data is available (heuristic)
  hasMoreData() {
    // Check if we are on the last byte and have read all bits,
    // or if we are beyond the last byte.
    return !(this.byteIndex >= this.uint8Array.length ||
      (this.byteIndex === this.uint8Array.length - 1 && this.bitIndex >= 8));
    // A more robust check might be needed depending on SPS structure variations
  }

  // Skip bits for alignment or unparsed fields
  skipBits(n) {
    for (let i = 0; i < n; i++) {
      this.readBit();
    }
  }

  // Align to the next byte boundary
  byteAlign() {
    if (this.bitIndex !== 0) {
      this.skipBits(8 - this.bitIndex);
    }
  }
}
