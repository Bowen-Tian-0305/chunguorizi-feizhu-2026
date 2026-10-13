const invalid = message => Object.assign(new Error(message), {status:400});

// The browser normalizes every recording to mono, 16 kHz, 16-bit PCM WAV.
// Check actual sample bytes so direct API callers cannot bypass the 90 s cap.
export function validateWavAudio(audio) {
  if (typeof audio !== 'string' || audio.length > 6_000_000 || !/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(audio))
    throw invalid('请提交90秒以内的WAV录音');
  const bytes = Buffer.from(audio.slice(audio.indexOf(',') + 1), 'base64');
  if (bytes.length < 44 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WAVE' || bytes.readUInt32LE(4) !== bytes.length - 8)
    throw invalid('录音格式无法读取，请重新录制');
  let format = false, samples = null, offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw invalid('录音文件不完整，请重新录制');
    const kind = bytes.toString('ascii',offset,offset+4), size = bytes.readUInt32LE(offset+4);
    const start = offset + 8, end = start + size;
    if (end + size % 2 > bytes.length) throw invalid('录音文件不完整，请重新录制');
    if (kind === 'fmt ') {
      if (format || size < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start+2) !== 1 ||
          bytes.readUInt32LE(start+4) !== 16000 || bytes.readUInt32LE(start+8) !== 32000 ||
          bytes.readUInt16LE(start+12) !== 2 || bytes.readUInt16LE(start+14) !== 16)
        throw invalid('请通过页面上传或录制16kHz单声道WAV录音');
      format = true;
    }
    if (kind === 'data') {
      if (samples !== null || !size || size % 2) throw invalid('录音数据无法读取，请重新录制');
      samples = size / 2;
    }
    offset = end + size % 2;
  }
  if (!format || samples === null) throw invalid('录音数据无法读取，请重新录制');
  const duration = samples / 16000;
  if (duration > 90) throw invalid('录音请控制在90秒以内');
  return {duration};
}
