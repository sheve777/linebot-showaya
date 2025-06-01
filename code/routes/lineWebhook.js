// lineWebhook.js ─ LINE から届いたイベントを OpenAI へ橋渡し
const handleEvent = require('../services/openaiClient');

module.exports = (lineClient) => async (req, res) => {
  // 念のためイベント配列をチェック
  if (!Array.isArray(req.body.events)) {
    console.error('[ERROR] no events array');
    return res.status(200).end();
  }

  try {
    await Promise.all(
      req.body.events.map(async (ev) => {
        console.log('[DEBUG] event type:', ev.type);
        const result = await handleEvent(ev, lineClient);

        // handleEvent が null を返すケースもあるので出力しておく
        console.log('[DEBUG] handleEvent result:', result);
      })
    );

    console.log('[DEBUG] all events handled');
    res.status(200).end();
  } catch (err) {
    console.error('[ERROR] Webhook handler failed:', err);
    res.status(500).end();
  }
};
