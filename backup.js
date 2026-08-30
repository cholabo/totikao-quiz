// 学習の進み具合を、短い文字列に詰めたり戻したりする。
// backup.html（出す側）と restore.html（受ける側）の両方が使う。
//
// 素直に localStorage を JSON で出すと全肢で30万字になり、
// LINE やメモに貼れる長さではない。要るのは肢ごとに
//   ・最後の結果（未回答／正解／復習中／？）  2ビット
//   ・復習の連続正解数（0〜3）              2ビット
// の4ビットだけなので、そこまで削ってから圧縮する。回答回数や日時は表示に使っていない。
//
// 並びは questions.json の順。ラベルを持たないぶん短くなるが、順番がずれると
// 全部食い違うので、肢数と、ラベルから作った検査値を頭に入れて突き合わせる。

const BACKUP = (() => {
  const FORMAT = 1;

  const RESULT = { none: 0, correct: 1, wrong: 2, unknown: 3 };
  const RESULT_NAME = [null, 'correct', 'wrong', 'unknown'];

  // ラベルの並びが同じかどうかを見るための検査値
  function checksum(labels) {
    let h = 0;
    for (const l of labels) {
      for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) & 0xFFFF;
    }
    return h;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function toBase64url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2];
      out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
      if (b === undefined) break;
      out += B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
      if (c === undefined) break;
      out += B64[c & 63];
    }
    return out;
  }
  function fromBase64url(text) {
    const clean = String(text).trim().replace(/[^A-Za-z0-9\-_]/g, '');
    const out = [];
    for (let i = 0; i < clean.length; i += 4) {
      const n = [0, 1, 2, 3].map(k => B64.indexOf(clean[i + k]));
      out.push(((n[0] << 2) | (n[1] >> 4)) & 0xFF);
      if (n[2] >= 0) out.push((((n[1] & 15) << 4) | (n[2] >> 2)) & 0xFF);
      if (n[3] >= 0) out.push((((n[2] & 3) << 6) | n[3]) & 0xFF);
    }
    return Uint8Array.from(out);
  }

  async function deflate(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch { return null; }
  }
  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('この端末では展開できません');
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // ===== 出す =====
  async function encode(labels, state, passCount, resumeLabel) {
    const n = labels.length;
    const body = new Uint8Array(8 + Math.ceil(n / 2));
    const sum = checksum(labels);
    const resumeIndex = resumeLabel ? labels.indexOf(resumeLabel) : -1;
    body[0] = n >> 8; body[1] = n & 0xFF;
    body[2] = sum >> 8; body[3] = sum & 0xFF;
    body[4] = (passCount >> 8) & 0xFF; body[5] = passCount & 0xFF;
    const ri = resumeIndex >= 0 ? resumeIndex + 1 : 0;
    body[6] = ri >> 8; body[7] = ri & 0xFF;

    for (let i = 0; i < n; i++) {
      const st = state[labels[i]] || {};
      const r = RESULT[st.lastResult] || 0;
      const streak = Math.max(0, Math.min(3, Number(st.reviewCorrectStreak) || 0));
      const nib = (streak << 2) | r;
      if (i % 2 === 0) body[8 + (i >> 1)] |= nib;
      else body[8 + (i >> 1)] |= nib << 4;
    }

    const packed = await deflate(body);
    const useZip = packed && packed.length < body.length;
    const payload = useZip ? packed : body;
    const out = new Uint8Array(2 + payload.length);
    out[0] = FORMAT;
    out[1] = useZip ? 1 : 0;
    out.set(payload, 2);
    return toBase64url(out);
  }

  // ===== 受ける =====
  async function decode(code, labels) {
    const raw = fromBase64url(code);
    if (raw.length < 10) throw new Error('コードが短すぎます');
    if (raw[0] !== FORMAT) throw new Error('見たことのない形式のコードです');
    let body = raw.slice(2);
    if (raw[1] & 1) body = await inflate(body);
    if (body.length < 8) throw new Error('コードが壊れています');

    const n = (body[0] << 8) | body[1];
    const sum = (body[2] << 8) | body[3];
    const passCount = (body[4] << 8) | body[5];
    const ri = (body[6] << 8) | body[7];
    if (n <= 0 || n > labels.length) throw new Error('この端末の問題数（' + labels.length + '肢）と合いません');
    // 年度が増えたときのために、頭からn肢ぶんだけで突き合わせる
    if (checksum(labels.slice(0, n)) !== sum) throw new Error('問題の並びが違います。アプリを更新してから試してください');
    if (body.length < 8 + Math.ceil(n / 2)) throw new Error('コードが途中で切れています');

    const state = {};
    let answered = 0;
    for (let i = 0; i < n; i++) {
      const byte = body[8 + (i >> 1)];
      const nib = (i % 2 === 0) ? (byte & 15) : (byte >> 4);
      const r = nib & 3;
      if (!r) continue;
      answered++;
      const name = RESULT_NAME[r];
      state[labels[i]] = {
        attempts: 1,
        correctCount: name === 'correct' ? 1 : 0,
        wrongCount: name === 'correct' ? 0 : 1,
        lastResult: name,
        lastAnsweredAt: '',
        reviewCorrectStreak: (nib >> 2) & 3,
      };
    }
    return { state, passCount, resumeLabel: ri > 0 ? labels[ri - 1] : '', answered, total: n };
  }

  return { encode, decode, checksum };
})();

if (typeof module !== 'undefined') module.exports = BACKUP;
