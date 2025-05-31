// メモリ上の簡易セッション（TTL 10 分）
const TTL = 10 * 60 * 1000;
const store = new Map();

exports.get = (uid) => {
  const now = Date.now();
  return (store.get(uid) || []).filter(m => now - m.t < TTL);
};

exports.push = (uid, role, content) => {
  const arr = exports.get(uid);          // TTL でクリーンした配列
  arr.push({ role, content, t: Date.now() });
  store.set(uid, arr);
};
