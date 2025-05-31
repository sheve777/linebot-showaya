// lineWebhook.js ＝ LINE から届いたイベントを OpenAI へ橋渡しするルータ
const handleEvent = require('../services/openaiClient');

module.exports = (lineClient) => (req, res) => {
  // 複数イベントを Promise.all で並列処理
  Promise.all(
    req.body.events.map(ev => handleEvent(ev, lineClient))
  )
    .then(() =>     res.status(200).end())
    .catch((err) => {
      console.error('Webhook error:', err);
      res.status(500).end();
    });
};
