// code/routes/lineWebhook.js の最初に追加して、一時的に return
module.exports = (lineClient) => (req, res) => {
  const event = req.body.events[0];
  if (event?.replyToken) {
    // ★テスト用固定返信
    lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'テスト返信：サーバーまでは届きました！'
    })
      .then(() => res.status(200).end())
      .catch(err => {
        console.error('LINE reply error:', err);
        res.status(500).end();
      });
    return;          // ← openaiClient へは進まない
  }
  res.status(200).end();
};


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
