const { OpenAI } = require('openai');
const session = require('./sessionManager');
const fs = require('fs');
const path = require('path');

// 店舗プロンプトを 1 回だけ読み込む
const persona = fs.readFileSync(path.join(__dirname, '..', '..', 'persona.txt'), 'utf8');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async (event, client) => {
  // テキストメッセージ以外は無視
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const uid   = event.source.userId;
  const input = event.message.text;

  // 履歴を取得（まだ要約なし）
  const history = session.get(uid).map(({ role, content }) => ({ role, content }));

  // OpenAI へ投げる
  const { choices } = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: persona },
      ...history,
      { role: 'user', content: input }
    ],
    max_tokens: 256,
    temperature: 0.7
  });

  const reply = choices?.[0]?.message?.content || 'すみません、もう一度お願いします。';

  // 履歴保存
  session.push(uid, 'user', input);
  session.push(uid, 'assistant', reply);

  // LINE に返信
  return client.replyMessage(event.replyToken, { type: 'text', text: reply });
};
